// ============================================================
// CORE V2 — Scoring Utilities
// src/lib/utils/scoring.ts
// LIFT V1 lib/utils/scoring.ts (band thresholds — single source, never re-hardcode).
// ============================================================

import type { MasteryBand, AlertSeverity, AssignmentMode } from '@/types/core';

/** LOCKED: score % → mastery band. Signals never change this. */
export function computeMasteryBand(scorePct: number): MasteryBand {
  if (scorePct <= 50) return 'reteach';
  if (scorePct <= 79) return 'grade_level';
  return 'advanced';
}

/**
 * Canonical "what band is this student in *right now*" rule:
 * the most-recent quiz wins (tied by `submitted_at`, falling back to
 * `created_at`). The dashboard API already uses this implicitly — this
 * helper exists so every UI surface reads from the same logic instead
 * of re-implementing "ORDER BY submitted_at DESC LIMIT 1" inline.
 *
 * Pedagogical rationale (2026-04-27 with Marvin + Barb): mastery is a
 * *current* read, not a historical average. A student who was Advanced
 * last week and is Reteach this week is currently in Reteach territory.
 * Trajectory lives separately on `consistency_label`, `band_history`,
 * and the Coach surfaces — not in this rule.
 *
 * Returns null when the student has no quiz attempts yet.
 *
 * Inputs: ordered or unordered list of `{ mastery_band, submitted_at }`.
 * The fn does the sort; callers don't have to pre-sort.
 */
export interface QuizAttemptForBand {
  mastery_band: MasteryBand | string | null;
  submitted_at: string | null;
  created_at?: string | null;
  is_complete?: boolean | null;
}

export function currentMasteryBand(attempts: ReadonlyArray<QuizAttemptForBand>): MasteryBand | null {
  // Filter to attempts that actually have a band. `is_complete=false`
  // attempts are excluded — incomplete is not a current read.
  const valid = attempts.filter(
    (a) => a.mastery_band != null && (a.is_complete === undefined || a.is_complete === true),
  );
  if (valid.length === 0) return null;
  // Sort newest-first using submitted_at, falling back to created_at.
  const sorted = [...valid].sort((a, b) => {
    const aTs = a.submitted_at ?? a.created_at ?? '';
    const bTs = b.submitted_at ?? b.created_at ?? '';
    return bTs.localeCompare(aTs);
  });
  const band = sorted[0].mastery_band;
  if (band === 'reteach' || band === 'grade_level' || band === 'advanced') return band;
  return null;
}

/**
 * "Is this student volatile across recent quizzes?" — returns true when
 * the last N quizzes span MORE than one mastery band. Default N=3.
 *
 * Cheap fix from coreplatform.md §10 (Alex Bitner question): a teacher
 * scanning a row sees a single band ("Grade Level") and might miss
 * that the student is volatile. Use the ↕ marker (see VolatilityMarker)
 * to flag it without changing the canonical "current band" read.
 *
 * Returns false when fewer than 2 attempts exist (no volatility to
 * report yet).
 */
export function bandIsVolatile(
  attempts: ReadonlyArray<QuizAttemptForBand>,
  windowSize = 3,
): boolean {
  const valid = attempts.filter(
    (a) => a.mastery_band != null && (a.is_complete === undefined || a.is_complete === true),
  );
  if (valid.length < 2) return false;
  const sorted = [...valid].sort((a, b) => {
    const aTs = a.submitted_at ?? a.created_at ?? '';
    const bTs = b.submitted_at ?? b.created_at ?? '';
    return bTs.localeCompare(aTs);
  });
  const window = sorted.slice(0, windowSize);
  const distinctBands = new Set(window.map((a) => a.mastery_band));
  return distinctBands.size > 1;
}

/** LOCKED: default alert severity */
export function defaultAlertSeverity(scorePct: number, isComplete: boolean): AlertSeverity {
  if (!isComplete) return 'urgent';
  if (scorePct < 40) return 'urgent';
  if (scorePct < 60) return 'watch';
  return 'info';
}

export function bandToAssignmentMode(band: MasteryBand): AssignmentMode {
  return { reteach: 'scaffolded', grade_level: 'standard', advanced: 'extension' }[band] as AssignmentMode;
}

/** Single source of truth for level(mode)→band, shared by assignmentModeToBand and the
 *  sectioned prompt (avoids a duplicated literal map drifting out of sync). */
export const MODE_TO_BAND: Record<AssignmentMode, MasteryBand> = {
  scaffolded: 'reteach',
  standard: 'grade_level',
  extension: 'advanced',
};

export function assignmentModeToBand(mode: AssignmentMode): MasteryBand {
  return MODE_TO_BAND[mode];
}

export function scoreMCQ(studentAnswer: string, correctAnswer: string): number {
  if (!studentAnswer || !correctAnswer) return 0;
  const a = studentAnswer.trim().toLowerCase();
  const b = correctAnswer.trim().toLowerCase();
  return a === b ? 1 : 0;
}

/**
 * 3 MCQ × 1pt + 2 open × 1pt = 5 total.
 * LIFT V1 computeFinalScore — MCQ weight = OEQ weight per V1's locked scaling.
 *
 * C5 correction: scorePct is the UN-ROUNDED float (raw/max)*100.
 * Do NOT Math.round here — rounding re-bands boundary scores like 79.5
 * (which should stay grade_level but rounds to 80 = advanced).
 * Round only at a display layer.
 */
export function computeFinalScore(mcqScores: number[], openScores: number[]) {
  const raw = [...mcqScores, ...openScores].reduce((a, b) => a + b, 0);
  return { rawScore: raw, scorePct: (raw / 5) * 100 };
}

export function computeBehavioralSummary(responses: Array<{
  response_time_ms?: number;
  hesitation_ms?: number;
  answer_changes: number;
}>) {
  const n = responses.length || 1;
  void n; // used below via responses.length
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const totalChanges = responses.reduce((s, r) => s + r.answer_changes, 0);
  const avgTime = avg(responses.map(r => r.response_time_ms ?? 0));
  return {
    avg_time_on_question_ms: Math.round(avgTime),
    total_answer_changes: totalChanges,
    avg_hesitation_ms: Math.round(avg(responses.map(r => r.hesitation_ms ?? 0))),
    completion_timing: avgTime < 15000 ? 'fast' : avgTime < 45000 ? 'normal' : 'slow',
  };
}

export function formatSignalsForPrompt(behavioral: ReturnType<typeof computeBehavioralSummary>, wordCounts: number[]): string {
  const avgWords = wordCounts.length
    ? Math.round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length)
    : 0;
  return `
- Average time per question: ${behavioral.avg_time_on_question_ms}ms
- Average hesitation before answering: ${behavioral.avg_hesitation_ms}ms
- Total answer changes: ${behavioral.total_answer_changes}
- Completion pace: ${behavioral.completion_timing}
- Average word count on open responses: ${avgWords} words
`.trim();
}

export function getAlertTriggerReason(scorePct: number, isComplete: boolean): string {
  if (!isComplete) return 'incomplete_attempt';
  if (scorePct < 40) return 'score_below_40';
  if (scorePct < 60) return 'score_40_to_60';
  return 'strong_performance';
}

export function shouldCreateAlert(scorePct: number, isComplete: boolean): boolean {
  const s = defaultAlertSeverity(scorePct, isComplete);
  return s === 'urgent' || s === 'watch' || scorePct > 80;
}
