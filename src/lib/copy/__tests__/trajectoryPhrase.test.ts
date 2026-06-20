import { describe, it, expect } from 'vitest';
import { trajectoryPhrase } from '../trajectoryPhrase';
import { assertNoLeak } from '../leakGuard';

describe('trajectoryPhrase', () => {
  it('returns distinct copy for each trajectory direction', () => {
    const phrases = (['improving', 'stable', 'worsening'] as const).map(trajectoryPhrase);
    expect(new Set(phrases).size).toBe(3);
  });

  it('every output is a non-empty string', () => {
    (['improving', 'stable', 'worsening'] as const).forEach((d) => {
      expect(trajectoryPhrase(d).length).toBeGreaterThan(0);
    });
  });

  it('returns a fallback for null', () => {
    expect(trajectoryPhrase(null).length).toBeGreaterThan(0);
  });

  it('every output passes assertNoLeak (words, no raw numbers)', () => {
    ([null, 'improving', 'stable', 'worsening'] as const).forEach((d) => {
      expect(() => assertNoLeak(trajectoryPhrase(d as never))).not.toThrow();
    });
  });
});
