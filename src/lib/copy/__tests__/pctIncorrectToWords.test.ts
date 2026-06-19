// src/lib/copy/__tests__/pctIncorrectToWords.test.ts
import { describe, it, expect } from 'vitest';
import { pctIncorrectToWords } from '../pctIncorrectToWords';
import { assertNoLeak } from '../leakGuard';

describe('pctIncorrectToWords', () => {
  it('maps proportion to soft words with no digits', () => {
    expect(pctIncorrectToWords(0.25)).toMatch(/quarter/);
    expect(pctIncorrectToWords(50)).toMatch(/half/); // accepts 0–1 or 0–100
    [0.1, 0.25, 0.5, 0.75, 90].forEach((p) =>
      assertNoLeak(pctIncorrectToWords(p)),
    );
  });

  it('normalises a value ≥1 by /100', () => {
    // 50 → 0.5 → "about half"
    expect(pctIncorrectToWords(50)).toEqual(pctIncorrectToWords(0.5));
  });

  it('returns distinct phrases for each bucket', () => {
    const phrases = [0.05, 0.15, 0.35, 0.6, 0.85].map(pctIncorrectToWords);
    // all must be distinct
    expect(new Set(phrases).size).toBe(5);
  });

  it('every output passes assertNoLeak', () => {
    [0, 0.1, 0.25, 0.5, 0.75, 1, 10, 25, 50, 75, 100].forEach((p) => {
      const out = pctIncorrectToWords(p);
      expect(() => assertNoLeak(out)).not.toThrow();
    });
  });
});
