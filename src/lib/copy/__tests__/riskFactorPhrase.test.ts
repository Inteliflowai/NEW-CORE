import { describe, it, expect } from 'vitest';
import { riskFactorPhrase } from '../riskFactorPhrase';
import { hasLeak } from '../leakGuard';

// The real factor strings produced by computeRosterRiskIndex.ts.
const REAL_FACTORS = [
  'Low average assignment score (48%)',
  'No graded assignments on record',
  'Low average quiz score (42%)',
  'Low submission rate (60% of assignments submitted)',
  'Missing some assignments (73% submitted)',
  'Scores are declining over recent assignments',
  'High redo frequency (30% of assignments)',
  'No submissions in the past 12 days',
  'No submissions on record',
];

describe('riskFactorPhrase', () => {
  it('strips the parenthetical numeric tail', () => {
    expect(riskFactorPhrase('Low average quiz score (42%)')).toBe('Low average quiz score');
    expect(riskFactorPhrase('Low submission rate (60% of assignments submitted)')).toBe('Low submission rate');
    expect(riskFactorPhrase('High redo frequency (30% of assignments)')).toBe('High redo frequency');
  });

  it('rewrites the inline "past N days" factor to words', () => {
    expect(riskFactorPhrase('No submissions in the past 12 days')).toBe('No submissions recently');
  });

  it('passes already-clean factors through unchanged', () => {
    expect(riskFactorPhrase('No graded assignments on record')).toBe('No graded assignments on record');
    expect(riskFactorPhrase('Scores are declining over recent assignments')).toBe('Scores are declining over recent assignments');
  });

  it('every real factor becomes digit-free (no leak)', () => {
    for (const f of REAL_FACTORS) {
      const out = riskFactorPhrase(f);
      expect(hasLeak(out), `"${f}" -> "${out}" still leaks`).toBe(false);
    }
  });

  it('falls back without throwing on an unexpected digit-bearing factor', () => {
    expect(() => riskFactorPhrase('Weird new factor 5 things')).not.toThrow();
    expect(hasLeak(riskFactorPhrase('Weird new factor 5 things'))).toBe(false);
  });
});
