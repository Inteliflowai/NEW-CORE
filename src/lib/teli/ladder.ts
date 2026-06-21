export const RUNGS = ['nudge', 'cue', 'step', 'encourage'] as const;
export type HintRung = (typeof RUNGS)[number];
export const HINTS_PER_TASK = 3;
export function rungForHelpCount(priorHelpCount: number): HintRung {
  return RUNGS[Math.min(Math.max(priorHelpCount, 0), RUNGS.length - 1)];
}
export function hintsRemaining(priorHelpCount: number): number {
  return Math.max(0, HINTS_PER_TASK - (priorHelpCount + 1));
}
