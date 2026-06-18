import { describe, it, expect, vi, afterEach } from 'vitest';
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

describe('C12 — below-50 warning', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fires console.warn for a below-50 scope so interim PASS is never mistaken for real coverage', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The interim corpus has 1 tuple — well below MIN_TUPLES_FOR_GATE=50
    const report = runScope('grading');
    expect(report.gate).toBe('pass');
    expect(warnSpy).toHaveBeenCalledOnce();
    const msg: string = warnSpy.mock.calls[0][0] as string;
    expect(msg).toMatch(/\[eval\]/);
    expect(msg).toMatch(/grading/);
    expect(msg).toMatch(/short-circuit PASS/);
    expect(msg).toMatch(/NOT real coverage/);
  });
});
