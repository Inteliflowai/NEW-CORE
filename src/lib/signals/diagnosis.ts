// src/lib/signals/diagnosis.ts
// Pure. No imports from next/server, no throws on bad input.
// findRecurringError lifted verbatim from V1 lib/reports/diagnosis.ts:61-74.
// diagnose: signals-layer first-match pattern table (spec §3 diagnosis.ts).

export const RECURRING_ERROR_THRESHOLD = 3;

// Thresholds (spec §3 / Barb-ratified)
const DIVERGENCE_THRESHOLD = 25;
const LOW_HW    = 50;
const OK_QUIZ   = 60;
const LOW_QUIZ  = 50;

/**
 * Find the most-frequent non-trivial error_type, or null when nothing
 * recurs >= threshold times. 'none'/'' are filtered out
 * because they aren't real error categories.
 *
 * Verbatim lift of V1 lib/reports/diagnosis.ts:61-74.
 * The caller is responsible for pre-filtering to one skill's error_types.
 */
export function findRecurringError(
  errorTypes: string[],
  threshold: number = RECURRING_ERROR_THRESHOLD,
): { type: string; count: number } | null {
  const counts: Record<string, number> = {};
  for (const e of errorTypes) {
    if (!e || e === 'none') continue;
    counts[e] = (counts[e] || 0) + 1;
  }
  let best: { type: string; count: number } | null = null;
  for (const [type, count] of Object.entries(counts)) {
    if (count >= threshold && (!best || count > best.count)) {
      best = { type, count };
    }
  }
  return best;
}

export interface DiagnoseInput {
  /** Pre-computed divergence score (0-100) */
  divergence_score: number;
  /** Average homework score 0-100; null when no data */
  hw_avg: number | null;
  /** Average quiz score 0-100; null when no data */
  quiz_avg: number | null;
  /** Recent error_type strings for this student+skill (duplicates kept) */
  error_types: string[];
}

export interface DiagnoseResult {
  /** Suggested teacher action */
  suggestedAction: 'reteach' | 'practice' | 'verbal_check' | 'profile';
  /** 1 (mild) to 3 (urgent) */
  severity: 1 | 2 | 3;
  /** Human-readable one-liner for the teacher */
  diagnosis: string;
}

/**
 * Classify one student+skill combination into a suggested action.
 * Returns null when there is nothing actionable (suppress surfacing).
 *
 * Pattern table (first match wins):
 *   1. divergence >= 25 AND hw_avg < 50 AND quiz_avg >= 60 -> verbal_check   sev 2
 *   2. divergence >= 25 AND quiz_avg < 50                  -> reteach         sev 3
 *   3. divergence >= 25 (generic)                          -> profile         sev 1
 *   4. recurring error type                                -> practice        sev 2
 *   5. otherwise -> null
 */
export function diagnose(input: DiagnoseInput): DiagnoseResult | null {
  const { divergence_score, hw_avg, quiz_avg, error_types } = input;

  // 1. High divergence: doing HW but tanking quizzes (potential copying / coaching)
  if (
    divergence_score >= DIVERGENCE_THRESHOLD &&
    hw_avg != null && hw_avg < LOW_HW &&
    quiz_avg != null && quiz_avg >= OK_QUIZ
  ) {
    return {
      suggestedAction: 'verbal_check',
      severity: 2,
      diagnosis: `HW avg ${Math.round(hw_avg)}% diverges from quiz avg ${Math.round(quiz_avg)}% — consider a verbal check.`,
    };
  }

  // 2. High divergence + low quiz -> reteach urgent
  if (divergence_score >= DIVERGENCE_THRESHOLD && quiz_avg != null && quiz_avg < LOW_QUIZ) {
    return {
      suggestedAction: 'reteach',
      severity: 3,
      diagnosis: `Quiz avg ${Math.round(quiz_avg)}% with divergence score ${Math.round(divergence_score)} — concept likely needs reteaching.`,
    };
  }

  // 3. High divergence (generic) -> flag for closer look
  if (divergence_score >= DIVERGENCE_THRESHOLD) {
    return {
      suggestedAction: 'profile',
      severity: 1,
      diagnosis: `Divergence score ${Math.round(divergence_score)} — check student profile for context.`,
    };
  }

  // 4. Recurring error type -> targeted practice
  const recurring = findRecurringError(error_types);
  if (recurring) {
    return {
      suggestedAction: 'practice',
      severity: 2,
      diagnosis: `Recurring "${recurring.type}" errors (x${recurring.count}) — targeted practice recommended.`,
    };
  }

  // 5. Nothing actionable
  return null;
}
