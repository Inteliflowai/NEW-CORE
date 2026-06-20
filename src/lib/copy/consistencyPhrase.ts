// src/lib/copy/consistencyPhrase.ts
// Maps a consistency label to teacher-safe, words-only copy.
// Describes steadiness of performance, never a raw consistency_score.
// Pure + import-safe.

import { assertNoLeak } from './leakGuard';
import type { ConsistencyLabel } from '@/lib/signals/consistency';

const CONSISTENCY_COPY: Record<ConsistencyLabel, string> = {
  consistent: 'Performance has been steady.',
  variable: 'Results bounce around some day to day.',
  erratic: 'Results have been all over the place lately.',
};

const FALLBACK = 'Not enough data to gauge steadiness yet.';

export function consistencyPhrase(label: ConsistencyLabel | null): string {
  const copy = label != null && label in CONSISTENCY_COPY
    ? CONSISTENCY_COPY[label]
    : FALLBACK;
  assertNoLeak(copy, 'consistencyPhrase');
  return copy;
}
