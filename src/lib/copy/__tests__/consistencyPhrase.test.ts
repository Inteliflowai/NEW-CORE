import { describe, it, expect } from 'vitest';
import { consistencyPhrase } from '../consistencyPhrase';
import { assertNoLeak } from '../leakGuard';

describe('consistencyPhrase', () => {
  it('returns distinct copy for each consistency label', () => {
    const phrases = (['consistent', 'variable', 'erratic'] as const).map(consistencyPhrase);
    expect(new Set(phrases).size).toBe(3);
  });

  it('returns a fallback for null', () => {
    expect(consistencyPhrase(null).length).toBeGreaterThan(0);
  });

  it('every output passes assertNoLeak', () => {
    ([null, 'consistent', 'variable', 'erratic'] as const).forEach((l) => {
      expect(() => assertNoLeak(consistencyPhrase(l as never))).not.toThrow();
    });
  });
});
