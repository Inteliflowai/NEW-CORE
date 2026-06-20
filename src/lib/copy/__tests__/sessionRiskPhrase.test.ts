import { describe, it, expect } from 'vitest';
import { sessionRiskPhrase } from '../sessionRiskPhrase';
import { assertNoLeak } from '../leakGuard';

describe('sessionRiskPhrase', () => {
  it('returns a calm phrase for low session-risk scores', () => {
    const out = sessionRiskPhrase({ score: 0.1, factors: [] });
    expect(out.length).toBeGreaterThan(0);
  });

  it('returns a more concerned phrase as score rises (distinct from low)', () => {
    const low = sessionRiskPhrase({ score: 0.1, factors: [] });
    const high = sessionRiskPhrase({ score: 0.8, factors: ['rushing'] });
    expect(low).not.toBe(high);
  });

  it('never leaks the raw 0–1 score (words only)', () => {
    [0, 0.2, 0.5, 0.85, 1].forEach((score) => {
      const out = sessionRiskPhrase({ score, factors: [] });
      expect(() => assertNoLeak(out)).not.toThrow();
    });
  });
});
