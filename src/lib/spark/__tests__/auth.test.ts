import { describe, it, expect } from 'vitest';
import { safeEqual, bearerMatches } from '../auth';

describe('safeEqual', () => {
  it('true for equal strings, false otherwise (incl. length mismatch)', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('bearerMatches', () => {
  const secret = 'test-spark-secret';
  it('true only for an exact "Bearer <secret>" header', () => {
    expect(bearerMatches(`Bearer ${secret}`, secret)).toBe(true);
    expect(bearerMatches(`Bearer wrong`, secret)).toBe(false);
    expect(bearerMatches(secret, secret)).toBe(false);     // missing prefix
    expect(bearerMatches(null, secret)).toBe(false);
    expect(bearerMatches(`Bearer ${secret}`, '')).toBe(false); // empty secret never matches
  });
});
