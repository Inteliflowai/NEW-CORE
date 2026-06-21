import { rungForHelpCount, hintsRemaining, RUNGS, HINTS_PER_TASK } from '@/lib/teli/ladder';
describe('hint ladder', () => {
  it('escalates nudge → cue → step → encourage and stays', () => {
    expect(rungForHelpCount(0)).toBe('nudge'); expect(rungForHelpCount(1)).toBe('cue');
    expect(rungForHelpCount(2)).toBe('step'); expect(rungForHelpCount(3)).toBe('encourage');
    expect(rungForHelpCount(9)).toBe('encourage');
  });
  it('reports hints_remaining 2,1,0,0', () => {
    expect(hintsRemaining(0)).toBe(2); expect(hintsRemaining(1)).toBe(1);
    expect(hintsRemaining(2)).toBe(0); expect(hintsRemaining(3)).toBe(0);
  });
  it('exposes the canonical rungs + cap', () => { expect(RUNGS).toEqual(['nudge','cue','step','encourage']); expect(HINTS_PER_TASK).toBe(3); });
});
