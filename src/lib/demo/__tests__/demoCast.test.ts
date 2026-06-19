import { describe, it, expect } from 'vitest';
import { DEMO_STUDENTS } from '../demoCast';
import { diagnose } from '@/lib/signals/diagnosis';
import { computeHwQuizDivergence } from '@/lib/signals/computeHwQuizDivergence';
import { computeRosterRiskIndex } from '@/lib/signals/computeRosterRiskIndex';
import { currentMasteryBand, bandIsVolatile } from '@/lib/utils/scoring';
import { detectCompletedReteachCycles, aggregateReteachStats } from '@/lib/signals/computeReteachEffectiveness';

const REF = new Date('2026-06-19T12:00:00Z');
const iso = (d: number) => new Date(REF.getTime() - d * 864e5).toISOString();

// Mirror roster-signals/route.ts exactly: hw_avg/quiz_avg from graded score_pct,
// divergence via computeHwQuizDivergence, error_types: [], real dated submitted_at.
function deriveSignals(s: typeof DEMO_STUDENTS[number]) {
  const quizScores = s.quizzes.map(q => q.score_pct);
  const hwScores = s.homework.filter(h => h.score_pct != null).map(h => h.score_pct as number);
  const hw_avg = hwScores.length ? hwScores.reduce((a,b)=>a+b,0)/hwScores.length : null;
  const quiz_avg = quizScores.length ? quizScores.reduce((a,b)=>a+b,0)/quizScores.length : null;
  const div = computeHwQuizDivergence({ homeworkScores: hwScores, quizScores });
  const diagResult = diagnose({ divergence_score: div.divergence_score, hw_avg, quiz_avg, error_types: [] });
  const quizForBand = s.quizzes.map(q => ({ mastery_band: q.mastery_band, submitted_at: iso(q.daysAgo), is_complete: true }));
  const band = currentMasteryBand(quizForBand);
  const volatile = bandIsVolatile(quizForBand);
  const risk = computeRosterRiskIndex({
    homeworkAttempts: s.homework.map(h => ({
      score: h.score_pct, allow_redo: !!h.allow_redo, is_redo: !!h.is_redo, submitted_at: iso(h.daysAgo),
    })),
    quizAttempts: s.quizzes.map(q => ({ score: q.score_pct, submitted_at: iso(q.daysAgo) })),
    totalAssigned: s.homework.length,
  }, REF);
  return { band, volatile, diagnose: diagResult?.suggestedAction ?? null, risk: risk.risk_level };
}

describe('demoCast — each profile produces its engineered signal case', () => {
  for (const s of DEMO_STUDENTS) {
    it(`${s.full_name}: band/volatile/diagnose/risk match expect`, () => {
      const got = deriveSignals(s);
      expect(got.band).toBe(s.expect.band);
      expect(got.volatile).toBe(s.expect.volatile);
      expect(got.diagnose).toBe(s.expect.diagnose);
      expect(got.risk).toBe(s.expect.risk);
    });
  }
});

describe('demoCast — class-wide coverage (every screen case renders)', () => {
  it('covers all three mastery bands + a null (not-yet-assessed)', () => {
    expect(new Set(DEMO_STUDENTS.map(s => deriveSignals(s).band)))
      .toEqual(new Set(['reteach', 'grade_level', 'advanced', null]));
  });
  it('focus_group covers verbal_check, reteach, profile, monitor', () => {
    expect(new Set(DEMO_STUDENTS.map(s => deriveSignals(s).diagnose).filter(Boolean)))
      .toEqual(new Set(['verbal_check', 'reteach', 'profile', 'monitor']));
  });
  it('risk spread covers low, medium, high, critical', () => {
    expect(new Set(DEMO_STUDENTS.map(s => deriveSignals(s).risk)))
      .toEqual(new Set(['low', 'medium', 'high', 'critical']));
  });
  it('has all four effort labels', () => {
    expect(new Set(DEMO_STUDENTS.map(s => s.effort_label)).size).toBe(4);
  });
  it('has at least two volatile students', () => {
    expect(DEMO_STUDENTS.filter(s => deriveSignals(s).volatile).length).toBeGreaterThanOrEqual(2);
  });
  it("yields Jordan's improving reteach cycle (sign-checked) and no inverted cycle", () => {
    const rowsFor = (s: typeof DEMO_STUDENTS[number]) => s.homework.map((h, hi) => ({
      id: `${s.key}-${hi}`, student_id: s.key, assignment_id: `${s.key}-a`,
      score: h.score_pct, allow_redo: !!h.allow_redo, is_redo: !!h.is_redo,
      flagged_by: (h.flagged_by ?? null) as 'auto' | 'teacher' | null,
      submitted_at: iso(h.daysAgo), created_at: iso(h.daysAgo),
    }));
    const jordan = DEMO_STUDENTS.find(s => s.key === 'jordan')!;
    const jCycles = detectCompletedReteachCycles(rowsFor(jordan), new Set());
    expect(jCycles.length).toBeGreaterThanOrEqual(1);
    expect(jCycles.every(c => c.improvement > 0)).toBe(true);          // +25, never a regression
    const all = DEMO_STUDENTS.flatMap(s => detectCompletedReteachCycles(rowsFor(s), new Set()));
    const stats = aggregateReteachStats(all);
    expect(stats.success_rate).toBe(100);                               // only Jordan's cycle; no inverted cycles
  });
});
