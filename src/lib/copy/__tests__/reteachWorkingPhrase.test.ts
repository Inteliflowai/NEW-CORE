// src/lib/copy/__tests__/reteachWorkingPhrase.test.ts
import { describe, it, expect } from 'vitest';
import { reteachWorkingPhrase } from '../reteachWorkingPhrase';
import { assertNoLeak } from '../leakGuard';

describe('reteachWorkingPhrase', () => {
  it('non-null outcome returns soft "working / keep going" copy', () => {
    const out = reteachWorkingPhrase('improved');
    expect(out).toMatch(/working|keep going|progress|paying off/i);
  });

  it('never contains % or the word "failed"', () => {
    ['improved', 'some improvement', 'no change', 'worse', 'mastered'].forEach(
      (outcome) => {
        const out = reteachWorkingPhrase(outcome);
        expect(out).not.toContain('%');
        expect(out.toLowerCase()).not.toContain('failed');
      },
    );
  });

  it('null returns a safe fallback', () => {
    const out = reteachWorkingPhrase(null);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('every output passes assertNoLeak', () => {
    ['improved', 'no change', null].forEach((outcome) => {
      const out = reteachWorkingPhrase(outcome);
      expect(() => assertNoLeak(out)).not.toThrow();
    });
  });
});
