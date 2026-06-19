import { describe, it, expect } from 'vitest';
import { buildTrialRows } from '../buildTrialRows';
import { DEMO_STUDENTS } from '@/lib/demo/demoCast';

const NOW = new Date('2026-06-19T12:00:00Z');

// Trial provisioning pre-creates the first student (Alex), so buildTrialRows must
// build students 2-8 (the rest of the cast) plus the class/lesson/quiz scaffold.
const IDS = { schoolId: 'school-uuid', schoolIdShort: 'school-u', teacherId: 'teacher-uuid' };

describe('buildTrialRows', () => {
  const rows = buildTrialRows(DEMO_STUDENTS, IDS, NOW);

  it('builds auth-user specs for students 2-8 (Alex pre-created in provisionTrial)', () => {
    // 8-student cast minus the pre-created first student
    expect(rows.students).toHaveLength(DEMO_STUDENTS.length - 1);
    expect(rows.students.some(s => s.key === DEMO_STUDENTS[0].key)).toBe(false);
    // synthesised emails are scoped to the trial school short id
    expect(rows.students.every(s => s.email.includes(IDS.schoolIdShort))).toBe(true);
  });

  it('emits one class scoped to the trial school + teacher', () => {
    expect(rows.class.school_id).toBe(IDS.schoolId);
    expect(rows.class.teacher_id).toBe(IDS.teacherId);
    expect(typeof rows.class.name).toBe('string');
  });

  it('enrolls all 8 students (including the pre-created first student)', () => {
    expect(rows.enrollments).toHaveLength(DEMO_STUDENTS.length);
    expect(rows.enrollments.some(e => e.student_key === DEMO_STUDENTS[0].key)).toBe(true);
  });

  it('emits one published lesson + quiz with 5 questions (3 mcq + 2 open) using valid enums', () => {
    expect(rows.lesson.status).toBe('published');
    expect(rows.quiz.status).toBe('published');
    expect(rows.quiz_questions).toHaveLength(5);
    const QTYPE = new Set(['mcq', 'open', 'numeric']);
    rows.quiz_questions.forEach(q => expect(QTYPE.has(q.question_type)).toBe(true));
    expect(rows.quiz_questions.filter(q => q.question_type === 'mcq')).toHaveLength(3);
    expect(rows.quiz_questions.filter(q => q.question_type === 'open')).toHaveLength(2);
  });

  it('emits quiz_attempts only for assessed students, all with valid mastery_band', () => {
    const BAND = new Set(['reteach', 'grade_level', 'advanced']);
    rows.quiz_attempts.forEach(q => expect(BAND.has(q.mastery_band)).toBe(true));
    // Nadia (no quizzes) gets no attempt → null-band cold-start path
    expect(rows.quiz_attempts.some(q => q.student_key === 'nadia')).toBe(false);
  });

  it('every assignment has non-null content jsonb (C9 NOT NULL)', () => {
    expect(rows.assignments.length).toBeGreaterThan(0);
    expect(rows.assignments.every(a => a.content != null)).toBe(true);
  });

  it('homework_attempts carry score_pct + responses.response_text and NEVER class_id (C10)', () => {
    expect(rows.homework_attempts.length).toBeGreaterThan(0);
    rows.homework_attempts.forEach(h => {
      expect('class_id' in h).toBe(false);
      expect(typeof h.responses.response_text).toBe('string');
    });
    // graded rows carry a numeric score_pct
    expect(rows.homework_attempts.some(h => h.status === 'graded' && typeof h.score_pct === 'number')).toBe(true);
  });

  it('only uses valid effort_label enum values', () => {
    const EFFORT = new Set(['effortful_success', 'struggling_trying', 'independent_success', 'independent_struggle']);
    rows.homework_attempts.forEach(h => h.effort_label && expect(EFFORT.has(h.effort_label)).toBe(true));
  });

  it('gives every student >=4 dated snapshots for GrowthMotif', () => {
    DEMO_STUDENTS.forEach(s =>
      expect(rows.snapshots.filter(r => r.student_key === s.key).length).toBeGreaterThanOrEqual(4));
  });

  it('only uses valid snapshot mastery_band enum values (or null)', () => {
    const BAND = new Set(['reteach', 'grade_level', 'advanced', null]);
    rows.snapshots.forEach(s => expect(BAND.has(s.mastery_band)).toBe(true));
  });

  it('emits >=1 skill_learning_state row per assessed student with valid state enum', () => {
    const VALID_STATES = new Set([
      'needs_different_instruction',
      'needs_more_time',
      'on_track',
      'ready_to_extend',
      'insufficient_data',
      'not_attempted',
    ]);
    // Every student has exactly one SLS row
    DEMO_STUDENTS.forEach(s =>
      expect(rows.skill_learning_state.filter(r => r.student_key === s.key).length).toBeGreaterThanOrEqual(1)
    );
    // All state values are schema-valid
    rows.skill_learning_state.forEach(r => expect(VALID_STATES.has(r.state)).toBe(true));
    // Multiple distinct states spread across students (mirrors 6-state enum spread intent)
    const statesUsed = new Set(rows.skill_learning_state.map(r => r.state));
    expect(statesUsed.size).toBeGreaterThanOrEqual(4);
    // Keyed on demo-skill-1
    rows.skill_learning_state.forEach(r => expect(r.skill_key).toBe('demo-skill-1'));
  });

  it('emits >=1 misconception_observations row with a valid error_type', () => {
    const VALID_ERROR_TYPES = new Set([
      'none', 'factual_error', 'reasoning_gap', 'incomplete',
      'misunderstood_question', 'vocabulary_confusion', 'off_topic', 'blank',
    ]);
    expect(rows.misconceptions.length).toBeGreaterThanOrEqual(1);
    rows.misconceptions.forEach(m => expect(VALID_ERROR_TYPES.has(m.error_type)).toBe(true));
    // Targets the struggling students (darius + emma)
    const misconceptionStudents = new Set(rows.misconceptions.map(m => m.student_key));
    expect(misconceptionStudents.has('darius')).toBe(true);
    expect(misconceptionStudents.has('emma')).toBe(true);
  });
});
