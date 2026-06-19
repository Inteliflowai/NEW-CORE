// src/lib/copy/__tests__/leakGuard.test.ts
import { describe, it, expect } from 'vitest';
import { hasLeak, assertNoLeak } from '../leakGuard';

describe('leakGuard', () => {
  it('flags bare digits, %, "avg", "score N", percentiles, rank words', () => {
    [
      'missed 25%',
      'HW avg 80',
      'score 42',
      '73rd percentile',
      'ranked 2nd',
      'divergence score 30',
    ].forEach((t) => expect(hasLeak(t)).toBe(true));
  });

  it('passes clean soft copy', () => {
    [
      'missed about a quarter',
      'worked hard and got there',
      'this is working — keep going',
    ].forEach((t) => expect(hasLeak(t)).toBe(false));
  });

  it('assertNoLeak throws on a leak, is silent on clean text', () => {
    expect(() => assertNoLeak('avg 80%')).toThrow();
    expect(() => assertNoLeak('missed about half')).not.toThrow();
  });
});
