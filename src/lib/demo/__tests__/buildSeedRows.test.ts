import { describe, it, expect } from 'vitest';
import { buildSeedRows } from '../buildSeedRows';
import { DEMO_STUDENTS } from '../demoCast';

const NOW = new Date('2026-06-19T12:00:00Z');

describe('buildSeedRows', () => {
  const rows = buildSeedRows(DEMO_STUDENTS, NOW);

  it('emits 4 assignments with due_at relative to now (one in the future)', () => {
    expect(rows.assignments).toHaveLength(4);
    expect(rows.assignments.filter(a => new Date(a.due_at) > NOW).length).toBeGreaterThanOrEqual(1);
  });
  it('every assignment has non-null content jsonb (C9 NOT NULL)', () => {
    expect(rows.assignments.every(a => a.content != null)).toBe(true);
  });
  it('produces all four Gradebook cell states across the matrix', () => {
    const graded   = rows.homework_attempts.some(h => h.status === 'graded' && h.score_pct != null && h.graded_at);
    const submitted= rows.homework_attempts.some(h => h.status === 'submitted' && h.score_pct == null && h.submitted_at && !h.graded_at);
    const pastDue  = rows.assignments.filter(a => new Date(a.due_at) < NOW).map(a => a.key);
    const missing  = pastDue.some(ak => DEMO_STUDENTS.some(s =>
      !rows.homework_attempts.some(h => h.student_key === s.key && h.assignment_key === ak)));
    const notDue   = rows.assignments.some(a => new Date(a.due_at) > NOW);
    expect(graded && submitted && missing && notDue).toBe(true);
  });
  it('only uses valid effort_label + mastery_band enum values', () => {
    const EFFORT = new Set(['effortful_success','struggling_trying','independent_success','independent_struggle']);
    rows.homework_attempts.forEach(h => h.effort_label && expect(EFFORT.has(h.effort_label)).toBe(true));
    const BAND = new Set(['reteach','grade_level','advanced']);
    rows.quiz_attempts.forEach(q => expect(BAND.has(q.mastery_band)).toBe(true));
  });
  it('gives every student >=4 dated snapshots for GrowthMotif', () => {
    DEMO_STUDENTS.forEach(s =>
      expect(rows.snapshots.filter(r => r.student_key === s.key).length).toBeGreaterThanOrEqual(4));
  });
  it('never writes class_id on homework_attempts (C10)', () => {
    rows.homework_attempts.forEach(h => expect('class_id' in h).toBe(false));
  });
});
