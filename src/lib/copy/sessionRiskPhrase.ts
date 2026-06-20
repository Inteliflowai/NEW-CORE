// src/lib/copy/sessionRiskPhrase.ts
// Narrates LIVE session risk (the 0–1 behavioural-telemetry score) as words.
// NEVER renders the raw 0–1 score — bands it into a soft phrase. Teacher-safe.
// Pure + import-safe.

import { assertNoLeak } from './leakGuard';

export interface SessionRiskInput {
  score: number; // 0–1
  factors: string[];
}

/**
 * Bands the 0–1 live-session risk score into a words-only phrase.
 *   < 0.34 → calm, 0.34–0.66 → some friction, ≥ 0.67 → notable friction.
 */
export function sessionRiskPhrase(input: SessionRiskInput): string {
  const score = Number.isFinite(input.score) ? input.score : 0;

  let copy: string;
  if (score < 0.34) {
    copy = 'Worked through their last session smoothly.';
  } else if (score < 0.67) {
    copy = 'Showed some friction in their last session — a few hesitations and changes.';
  } else {
    copy = 'Their last session looked effortful — lots of hesitating and second-guessing.';
  }

  assertNoLeak(copy, 'sessionRiskPhrase');
  return copy;
}
