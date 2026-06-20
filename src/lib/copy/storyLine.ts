// src/lib/copy/storyLine.ts
//
// Top-of-rail "whole child" narrative sentence for the One-Student screen.
// Opens on EFFORT / GROWTH (the strengths-first framing); risk appears only as a
// trailing clause, and only as WORDS — never a raw risk score or band enum dump.
// Pure + import-safe; words only → passes assertNoLeak.

import { assertNoLeak } from './leakGuard';
import type { EffortLabel } from './effortPhrase';
import type { TrajectoryDirection } from '@/lib/signals/consistency';
import type { RiskBand } from './riskBandLabel';

export interface StoryLineInput {
  effort: EffortLabel | null;
  trajectory: TrajectoryDirection;
  riskLevel: RiskBand;
}

// Opening clause — leads on effort, coloured by trajectory.
const EFFORT_LEAD: Record<EffortLabel, string> = {
  high: 'Putting in strong effort',
  medium: 'Putting in steady effort',
  low: 'Effort has been light lately',
  inconsistent: 'Effort has been uneven lately',
};

const TRAJECTORY_TAIL: Record<TrajectoryDirection, string> = {
  improving: 'and the trend is moving in the right direction',
  stable: 'and holding steady',
  worsening: 'though the trend has dipped a little',
};

// Trailing risk clause — only for elevated bands, words only.
const RISK_CLAUSE: Record<RiskBand, string> = {
  low: '',
  medium: ' — worth keeping an eye on.',
  high: ' — worth a closer look this week.',
  critical: ' — flag this one for a closer look soon.',
};

export function storyLine(input: StoryLineInput): string {
  const lead =
    input.effort != null && input.effort in EFFORT_LEAD
      ? EFFORT_LEAD[input.effort]
      : 'Still building a picture here';

  const tail = TRAJECTORY_TAIL[input.trajectory] ?? 'and settling in';
  const riskClause = RISK_CLAUSE[input.riskLevel] ?? '';

  // When there's no risk clause, close the sentence with a period.
  const base = `${lead}, ${tail}`;
  const sentence = riskClause ? `${base}${riskClause}` : `${base}.`;

  assertNoLeak(sentence, 'storyLine');
  return sentence;
}
