// src/lib/parent/perChildReportData.ts
//
// Print-only period-over-period context for the printable parent report.
//
// Four-audience rules:
//   • NEVER returns digits, band enum, CL verbs, risk, or peer comparisons.
//   • recentDirection and priorDirection are direction words ONLY.
//   • Two calendar windows: recent ~6 weeks vs prior ~6 weeks (need ≥3 pts each).
//   • Strips digits from assignment titles (mirrors loadParentNarrativeContext §I9).
//
// FORBIDDEN imports (never add these):
//   ✗ src/lib/signals/loadStudentSignals
//   ✗ src/lib/gradebook/loadStudentGradeTrend   (requires classId; per-class)
//
// Pure, admin-client-injected, import-safe.
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadStudentAssignments } from '@/lib/spark/loadStudentAssignments';
import { normalizeLearningStyle } from '@/lib/utils/learningStyle';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Snapshots per period window (~6 weeks at one snapshot per week). */
const WINDOW_SIZE = 6;

/**
 * Minimum number of data points in a window before a direction can be computed.
 * Below this threshold, computeDirection returns null (cold-start for that window).
 * M6: unified with GrowthMotif's COLD_START_THRESHOLD so direction and the motif agree.
 */
const MIN_WINDOW_POINTS = 4;

/**
 * avg_score delta (in snapshot units) required to call a window 'climbing' or
 * 'sliding'. Values within this band are 'steady'.
 */
const DIRECTION_DELTA = 3;

/** Maximum assignment titles surfaced as topic words. */
const MAX_TOPICS = 5;

// ── Interface ─────────────────────────────────────────────────────────────────

/**
 * Qualitative-only parent report context.
 * ZERO raw digits, no band/CL/risk labels, no peer references.
 * Safe to pass directly to the print-report renderer.
 */
export interface ParentReport {
  /** Student's first name only. */
  firstName: string;
  /**
   * Direction of the most-recent ~6-week window.
   * null when that window has fewer than MIN_WINDOW_POINTS scored snapshots.
   */
  recentDirection: 'climbing' | 'steady' | 'sliding' | null;
  /**
   * Direction of the ~6-week window immediately before the recent one.
   * null when that window has insufficient data.
   */
  priorDirection: 'climbing' | 'steady' | 'sliding' | null;
  /**
   * True when recentDirection is non-null — i.e. enough data to say something
   * meaningful about the current period.
   */
  hasEnoughData: boolean;
  /** Friendly canonical learning-style label; null if emerging/unknown. */
  learningStyleLabel: string | null;
  /** Up to MAX_TOPICS assignment titles with digits and section-prefix keywords stripped. */
  recentTopics: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute a direction word from a chronologically-sorted avg_score series.
 * Splits the series in half (first floor(n/2) vs the rest), compares means,
 * and returns a direction word — NEVER the raw scores.
 *
 * Returns null when n < MIN_WINDOW_POINTS (cold-start gate).
 */
function computeDirection(
  scores: number[],
): 'climbing' | 'steady' | 'sliding' | null {
  const n = scores.length;
  if (n < MIN_WINDOW_POINTS) return null;

  const mid = Math.floor(n / 2);
  const earlier = scores.slice(0, mid);
  const recent = scores.slice(mid);
  const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const delta = mean(recent) - mean(earlier);

  if (delta > DIRECTION_DELTA) return 'climbing';
  if (delta < -DIRECTION_DELTA) return 'sliding';
  return 'steady';
}

/**
 * Strip digits and leading section-keyword prefixes from an assignment title.
 * Returns null when nothing meaningful remains.
 *
 * Examples:
 *   'Unit 3: Fractions'          → 'Fractions'
 *   'Chapter 2 — The Water Cycle' → 'The Water Cycle'
 *   'Lesson 5'                   → null
 *   'Algebra 2'                  → 'Algebra'
 */
function stripTopicDigits(title: string): string | null {
  let t = title
    .replace(/^(?:unit|lesson|chapter|week)\s*\d+\s*[:\-–—·]?\s*/i, '')
    .trim();
  t = t.replace(/\d+/g, '').trim();
  t = t.replace(/\s+/g, ' ').trim();
  return t.length > 0 ? t : null;
}

// ── Public loader ─────────────────────────────────────────────────────────────

/**
 * Assembles the qualitative-only parent report context for one student.
 *
 * Data sources:
 *   - `users.full_name`              → firstName
 *   - `student_model_snapshots`      → recentDirection / priorDirection / hasEnoughData / learningStyleLabel
 *   - `loadStudentAssignments`       → recentTopics (digit-stripped)
 *
 * All diagnostic fields (mastery_band, risk_score, divergence_*, etc.) are
 * intentionally NOT selected — the column list is the four-audience wall.
 */
export async function perChildReportData(
  admin: SupabaseClient,
  studentId: string,
): Promise<ParentReport> {
  // ── 1. First name ──────────────────────────────────────────────────────────
  const { data: userRows } = await admin
    .from('users')
    .select('full_name')
    .eq('id', studentId)
    .limit(1);

  const fullName =
    ((userRows as { full_name: string | null }[] | null)?.[0]?.full_name) ?? null;
  const firstName = fullName?.split(/\s+/)[0] ?? 'Student';

  // ── 2. Snapshot series (parent-safe fields only) ───────────────────────────
  //
  // Selecting ONLY avg_score + snapshot_date + learning_style.
  // Diagnostic columns (mastery_band, risk_score, divergence_*) are NOT selected.
  const { data: snapshotRows } = await admin
    .from('student_model_snapshots')
    .select('avg_score, snapshot_date, learning_style')
    .eq('student_id', studentId)
    .order('snapshot_date', { ascending: true });

  type SnapshotRow = {
    avg_score: number | null;
    snapshot_date: string;
    learning_style: string | null;
  };

  const snapshots: SnapshotRow[] =
    (snapshotRows as SnapshotRow[] | null) ?? [];

  // Only non-null scores count. Raw values stay in this scope — NEVER returned.
  const scores: number[] = snapshots
    .map((s) => s.avg_score)
    .filter((v): v is number => v != null);

  // ── 3. Two-window period comparison ───────────────────────────────────────
  //
  // recent = last WINDOW_SIZE entries; prior = WINDOW_SIZE before that.
  // computeDirection returns null when a window < MIN_WINDOW_POINTS.
  const recentScores = scores.slice(-WINDOW_SIZE);
  const priorScores = scores.slice(-(WINDOW_SIZE * 2), -WINDOW_SIZE);

  const recentDirection = computeDirection(recentScores);
  const priorDirection = computeDirection(priorScores);

  // hasEnoughData = we can say something about the current period
  const hasEnoughData = recentDirection !== null;

  // ── 4. Learning style (most-recent snapshot) ──────────────────────────────
  const latestStyle =
    snapshots.length > 0 ? snapshots[snapshots.length - 1].learning_style : null;
  const normalized = normalizeLearningStyle(latestStyle);
  const learningStyleLabel = normalized === 'emerging' ? null : normalized;

  // ── 5. Topics (digit-stripped) ────────────────────────────────────────────
  const assignments = await loadStudentAssignments(admin, studentId);
  const recentTopics: string[] = assignments
    .slice(0, MAX_TOPICS)
    .map((a) => stripTopicDigits(a.title))
    .filter((t): t is string => t !== null);

  return {
    firstName,
    recentDirection,
    priorDirection,
    hasEnoughData,
    learningStyleLabel,
    recentTopics,
  };
}
