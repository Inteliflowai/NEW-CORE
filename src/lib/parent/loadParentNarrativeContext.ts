// src/lib/parent/loadParentNarrativeContext.ts
//
// Assembles the parent-SAFE translated context that feeds the AI narrative engine.
//
// Four-audience rules enforced here:
//   • NEVER returns digits, band enum, CL verbs, risk, or divergence values.
//   • gradeTrendDirection is a direction word ('climbing'|'steady'|'sliding') only.
//   • Derives trend class-agnostically from student_model_snapshots.avg_score (I1).
//   • Strips digits + section-keyword prefixes from assignment titles (I9).
//
// FORBIDDEN imports (never add these):
//   ✗ src/lib/signals/loadStudentSignals
//   ✗ src/lib/gradebook/loadStudentGradeTrend   (requires classId; per-class)
//
// Pure, admin-client-injected, import-safe (no next/server, no Supabase SDK direct import).
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadStudentAssignments } from '@/lib/spark/loadStudentAssignments';
import { normalizeLearningStyle } from '@/lib/utils/learningStyle';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Minimum dataPoints before hasGrowth is true.
 * Mirrors GrowthMotif's COLD_START_THRESHOLD.
 */
const COLD_START_THRESHOLD = 4;

/**
 * avg_score delta (in same units as the score) required to call a half-series
 * 'climbing' or 'sliding'. Deltas within this band are 'steady'.
 */
const DIRECTION_DELTA_THRESHOLD = 3;

/** Number of recent assignment titles to surface. */
const MAX_RECENT_TOPICS = 5;

// ── Exported interface ───────────────────────────────────────────────────────

/**
 * Qualitative-only parent context.  ZERO digits, band labels, CL verbs, or risk
 * fields — any diagnostic value is deliberately absent.
 */
export interface ParentContext {
  /** Student's first name only. */
  firstName: string;
  /** Direction word from the class-agnostic snapshot series; null when cold-start (<4 pts). */
  gradeTrendDirection: 'climbing' | 'steady' | 'sliding' | null;
  /** True when there are ≥4 scored snapshots (enough for a meaningful trend narrative). */
  hasGrowth: boolean;
  /** Count of scored weekly snapshots. Numeric but never surfaces as a string digit. */
  dataPoints: number;
  /** Friendly canonical style label ('visual', 'auditory', …); null if emerging/unknown. */
  learningStyleLabel: string | null;
  /** Recent assignment topic words — digits and section-prefix keywords stripped (I9). */
  recentTopics: string[];
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Strip digits and leading section-keyword prefixes from an assignment title
 * so no number reaches the AI prompt (I9 requirement).
 *
 * Examples:
 *   'Unit 3: Fractions'       → 'Fractions'
 *   'Chapter 2 — The Water Cycle' → 'The Water Cycle'
 *   'Lesson 5'                → null  (nothing left → caller drops it)
 *   'Algebra 2'               → 'Algebra'
 *   'The Civil War'           → 'The Civil War'  (unchanged)
 */
function stripTopicDigits(title: string): string | null {
  // 1. Remove a leading section keyword + number + optional separator
  //    Handles: 'Unit 3:', 'Lesson 5', 'Chapter 2 —', 'Week 4 '
  let t = title
    .replace(
      /^(?:unit|lesson|chapter|week)\s*\d+\s*[:\-–—·]?\s*/i,
      '',
    )
    .trim();

  // 2. Remove any remaining digit sequences (e.g. 'Algebra 2' → 'Algebra')
  t = t.replace(/\d+/g, '').trim();

  // 3. Collapse multiple internal spaces
  t = t.replace(/\s+/g, ' ').trim();

  return t.length > 0 ? t : null;
}

/**
 * Compute a direction word from a chronologically-sorted avg_score series.
 * Splits into earlier half (first floor(n/2) points) and recent half (the rest),
 * compares their means, and returns a direction word — NEVER the raw scores.
 *
 * Returns null when there are fewer than 4 data points (cold-start, M6: unified
 * with GrowthMotif's COLD_START_THRESHOLD so direction and the motif agree).
 */
function computeDirection(
  scores: number[],
): 'climbing' | 'steady' | 'sliding' | null {
  const n = scores.length;
  if (n < 4) return null;

  const mid = Math.floor(n / 2);
  const earlier = scores.slice(0, mid);
  const recent = scores.slice(mid);

  const mean = (arr: number[]) =>
    arr.reduce((sum, v) => sum + v, 0) / arr.length;

  const delta = mean(recent) - mean(earlier);

  if (delta > DIRECTION_DELTA_THRESHOLD) return 'climbing';
  if (delta < -DIRECTION_DELTA_THRESHOLD) return 'sliding';
  return 'steady';
}

// ── Public loader ────────────────────────────────────────────────────────────

/**
 * Builds the parent-safe context object for the AI narrative.
 *
 * Data sources:
 *  - `users.full_name`                → firstName
 *  - `student_model_snapshots`         → gradeTrendDirection / hasGrowth / dataPoints / learningStyleLabel
 *  - `loadStudentAssignments`          → recentTopics (digit-stripped)
 *
 * All diagnostic fields (band, risk_score, divergence_*, mastery_band, etc.) are
 * intentionally ignored even though they live in the snapshot row.
 */
export async function loadParentNarrativeContext(
  admin: SupabaseClient,
  studentId: string,
): Promise<ParentContext> {
  // ── 1. firstName ───────────────────────────────────────────────────────────
  const { data: userRows } = await admin
    .from('users')
    .select('full_name')
    .eq('id', studentId)
    .limit(1);

  const fullName =
    ((userRows as { full_name: string | null }[] | null)?.[0]?.full_name) ??
    null;
  const firstName = fullName?.split(/\s+/)[0] ?? 'Student';

  // ── 2. Grade trend (class-agnostic from student_model_snapshots) ───────────
  //
  // We query the avg_score series ordered chronologically (ASC) so indices
  // map to time order.  DIAGNOSTIC fields (mastery_band, risk_score, etc.)
  // are NOT selected — the column list is the four-audience wall.
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
    ((snapshotRows as SnapshotRow[] | null) ?? []);

  // Only non-null scores count toward the trend computation.
  const scores: number[] = snapshots
    .map((s) => s.avg_score)
    .filter((v): v is number => v != null);

  const dataPoints = scores.length;
  const hasGrowth = dataPoints >= COLD_START_THRESHOLD;

  // Direction is the ONLY thing that leaves this function — raw scores stay here.
  const gradeTrendDirection = computeDirection(scores);

  // ── 3. Learning style (most recent snapshot) ───────────────────────────────
  //
  // Use the last row (snapshots are ASC-ordered → last = most recent).
  const latestStyle =
    snapshots.length > 0 ? snapshots[snapshots.length - 1].learning_style : null;
  const normalized = normalizeLearningStyle(latestStyle);
  const learningStyleLabel = normalized === 'emerging' ? null : normalized;

  // ── 4. Recent topics (digit-stripped assignment titles) ────────────────────
  const assignments = await loadStudentAssignments(admin, studentId);
  const recentTopics: string[] = assignments
    .slice(0, MAX_RECENT_TOPICS)
    .map((a) => stripTopicDigits(a.title))
    .filter((t): t is string => t !== null);

  return {
    firstName,
    gradeTrendDirection,
    hasGrowth,
    dataPoints,
    learningStyleLabel,
    recentTopics,
  };
}
