// src/lib/copy/__tests__/effortPhrase.test.ts
import { describe, it, expect } from 'vitest';
import { effortPhrase } from '../effortPhrase';
import { assertNoLeak } from '../leakGuard';

describe('effortPhrase', () => {
  it('returns distinct copy for each of the 4 enum values', () => {
    const values = ['low', 'medium', 'high', 'inconsistent'] as const;
    const phrases = values.map(effortPhrase);
    expect(new Set(phrases).size).toBe(4);
  });

  it('returns a neutral fallback for null/unknown', () => {
    const fallback = effortPhrase(null);
    expect(typeof fallback).toBe('string');
    expect(fallback.length).toBeGreaterThan(0);
    // unknown string should also return fallback
    expect(effortPhrase('unknown_value' as never)).toBe(fallback);
  });

  it('every output passes assertNoLeak', () => {
    ['low', 'medium', 'high', 'inconsistent', null].forEach((v) => {
      const out = effortPhrase(v as never);
      expect(() => assertNoLeak(out)).not.toThrow();
    });
  });
});
