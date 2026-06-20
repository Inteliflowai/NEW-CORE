// src/lib/copy/trajectoryPhrase.ts
// Maps a trajectory direction to teacher-safe, words-only copy.
// "You vs your own past" framing — never peer-relative, never a raw number.
// Pure + import-safe.

import { assertNoLeak } from './leakGuard';
import type { TrajectoryDirection } from '@/lib/signals/consistency';

const TRAJECTORY_COPY: Record<TrajectoryDirection, string> = {
  improving: 'Trending upward lately.',
  stable: 'Holding steady.',
  worsening: 'Slipping a little recently.',
};

const FALLBACK = 'Not enough history to read a trend yet.';

export function trajectoryPhrase(direction: TrajectoryDirection | null): string {
  const copy = direction != null && direction in TRAJECTORY_COPY
    ? TRAJECTORY_COPY[direction]
    : FALLBACK;
  assertNoLeak(copy, 'trajectoryPhrase');
  return copy;
}
