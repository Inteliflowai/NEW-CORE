import { describe, it, expect } from 'vitest';
import { storyLine } from '../storyLine';
import { assertNoLeak } from '../leakGuard';

const BASE = {
  effort: 'high' as const,
  trajectory: 'improving' as const,
  riskLevel: 'low' as const,
};

describe('storyLine', () => {
  it('opens on effort/growth, not on risk', () => {
    const out = storyLine(BASE);
    // The sentence should lead with the positive (effort/trajectory) framing.
    // Risk word, if present, must not be the opening token.
    expect(out.length).toBeGreaterThan(0);
    expect(out.toLowerCase().startsWith('at risk')).toBe(false);
    expect(out.toLowerCase().startsWith('high risk')).toBe(false);
  });

  it('adds a trailing risk clause only when risk is elevated', () => {
    const calm = storyLine({ ...BASE, riskLevel: 'low' });
    const elevated = storyLine({ ...BASE, riskLevel: 'high' });
    expect(elevated).not.toBe(calm);
    // elevated mentions watching/keeping an eye; calm does not carry the risk clause
    expect(elevated.toLowerCase()).toMatch(/watch|eye|closer|flag/);
  });

  it('never leaks raw numbers (words only, even with risk)', () => {
    (['low', 'medium', 'high', 'critical'] as const).forEach((riskLevel) => {
      (['improving', 'stable', 'worsening'] as const).forEach((trajectory) => {
        (['low', 'medium', 'high', 'inconsistent', null] as const).forEach((effort) => {
          const out = storyLine({ effort: effort as never, trajectory, riskLevel });
          expect(() => assertNoLeak(out)).not.toThrow();
        });
      });
    });
  });

  it('handles a cold-start (null effort) gracefully', () => {
    const out = storyLine({ effort: null, trajectory: 'stable', riskLevel: 'low' });
    expect(out.length).toBeGreaterThan(0);
  });
});
