// ============================================================
// src/lib/signals/computeEffortLabel.ts
// CORE V2 — verbatim lift from V1 lib/signals/computeEffortLabel.ts
//
// Exactly one function in the system classifies a homework attempt
// into an effort label. Called from:
//   - /api/attempts/[attemptId]/submit/route.ts (populates new rows)
//   - any consumer reading effort_label that encounters NULL on a
//     historical row and wants a live classification against the
//     raw signals on the row
//
// Never duplicate this logic elsewhere. Every consumer calls this
// function — migration-time and runtime rules must not diverge.
// ============================================================

export type EffortLabel =
  | 'effortful_success'
  | 'struggling_trying'
  | 'independent_success'
  | 'independent_struggle';

// ─── THRESHOLDS ────────────────────────────────────────────
// SUCCESS_THRESHOLD = 75: score at or above this counts as "success".
// EFFORT_THRESHOLD = 2: hint count at or above this counts as "effortful".
// Barb-approved (2026-06-18; previously pending, now ratified for Plan 3).
export const SUCCESS_THRESHOLD = 75;
export const EFFORT_THRESHOLD = 2;

export interface EffortSignals {
  /** Graded score 0–100, or null if the attempt is ungraded/pending. */
  score: number | null | undefined;
  /** Hints requested from Teli on this attempt. null treated as 0. */
  teliHintCount: number | null | undefined;
}

/**
 * Classify a single homework attempt's effort shape.
 *
 * Returns null when score is unavailable — ungraded attempts cannot be
 * classified yet, and callers must handle null (either skip the
 * derived signal, or wait for a grading pass to complete).
 */
export function computeEffortLabel(signals: EffortSignals): EffortLabel | null {
  const { score, teliHintCount } = signals;
  if (score === null || score === undefined) return null;

  const hints = teliHintCount ?? 0;
  const isSuccess = score >= SUCCESS_THRESHOLD;
  const isEffortful = hints >= EFFORT_THRESHOLD;

  if (isSuccess && isEffortful) return 'effortful_success';
  if (!isSuccess && isEffortful) return 'struggling_trying';
  if (isSuccess && !isEffortful) return 'independent_success';
  return 'independent_struggle';
}

/**
 * Known effort-label values. Use for type-safe consumers, enum checks,
 * and to keep the migration 0011 CHECK constraint aligned with this file.
 */
export const EFFORT_LABELS: ReadonlyArray<EffortLabel> = [
  'effortful_success',
  'struggling_trying',
  'independent_success',
  'independent_struggle',
];

/** Labels indicating real effort regardless of outcome. */
export const STRUGGLING_LABELS: ReadonlyArray<EffortLabel> = [
  'struggling_trying',
  'independent_struggle',
];
