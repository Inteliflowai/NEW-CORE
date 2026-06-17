import { describe, it, expect } from 'vitest';
import { ALL_SCOPES } from '../types';
import { MIN_TUPLES_FOR_GATE, loadCorpus, runScope, runAll } from '../runner';

describe('eval harness', () => {
  it('ALL_SCOPES has 6 entries', () => {
    expect(ALL_SCOPES).toHaveLength(6);
    expect(ALL_SCOPES).toContain('grading');
    expect(ALL_SCOPES).toContain('quiz-generation');
    expect(ALL_SCOPES).toContain('homework-generation');
    expect(ALL_SCOPES).toContain('spark-generation');
    expect(ALL_SCOPES).toContain('spark-rubric');
    expect(ALL_SCOPES).toContain('learner-profile');
  });

  it('loads an empty corpus per scope without throwing', () => {
    for (const scope of ALL_SCOPES) expect(Array.isArray(loadCorpus(scope))).toBe(true);
  });

  it('short-circuits "corpus too small" below MIN_TUPLES_FOR_GATE (gate=pass)', () => {
    const report = runScope('grading');
    expect(report.total_tuples).toBeLessThan(MIN_TUPLES_FOR_GATE);
    expect(report.gate).toBe('pass');
    expect(report.gate_reason).toMatch(/corpus too small/i);
  });

  it('runAll returns one report per scope and never regresses on empty corpus', () => {
    const reports = runAll();
    expect(reports).toHaveLength(ALL_SCOPES.length);
    expect(reports.every(r => r.gate === 'pass')).toBe(true);
  });
});
