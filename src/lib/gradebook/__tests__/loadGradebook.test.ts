import { describe, it, expect, beforeEach } from 'vitest';
import { loadGradebook } from '@/lib/gradebook/loadGradebook';

// Scriptable tables.
let ENROLLMENTS: unknown[]; let ASSIGNMENTS: unknown[]; let HW: unknown[];
let QUIZZES: unknown[]; let QUIZ_ATTEMPTS: unknown[];

// Minimal chainable query stub: every filter returns `this`; awaiting yields { data }.
function table(rows: () => unknown[]) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['select', 'eq', 'in', 'order']) q[m] = chain;
  (q as { then: unknown }).then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: rows(), error: null });
  return q;
}
const admin = {
  from: (t: string) => {
    if (t === 'enrollments') return table(() => ENROLLMENTS);
    if (t === 'assignments') return table(() => ASSIGNMENTS);
    if (t === 'homework_attempts') return table(() => HW);
    if (t === 'quizzes') return table(() => QUIZZES);
    if (t === 'quiz_attempts') return table(() => QUIZ_ATTEMPTS);
    return table(() => []);
  },
} as unknown as Parameters<typeof loadGradebook>[0];

beforeEach(() => {
  ENROLLMENTS = [
    { student_id: 's1', users: { id: 's1', full_name: 'Ana Diaz', display_name: null } },
    { student_id: 's2', users: { id: 's2', full_name: 'Ben Cole', display_name: null } },
  ];
  // Per-student fan-out: two students × one logical assignment (shared lesson_id 'L1').
  ASSIGNMENTS = [
    { id: 'a_s1', lesson_id: 'L1', content: {}, due_at: '2026-06-10T00:00:00Z', created_at: '2026-06-01T00:00:00Z', student_id: 's1' },
    { id: 'a_s2', lesson_id: 'L1', content: {}, due_at: '2026-06-10T00:00:00Z', created_at: '2026-06-01T00:00:00Z', student_id: 's2' },
  ];
  HW = [];
  QUIZZES = [{ id: 'q1', title: 'Demo Quiz' }];
  QUIZ_ATTEMPTS = [];
});

describe('loadGradebook', () => {
  it('builds rows from active enrollments and collapses per-student assignments by lesson_id', async () => {
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.students.map(s => s.name)).toEqual(['Ana Diaz', 'Ben Cole']);
    expect(gb.assignments).toHaveLength(1);              // a_s1 + a_s2 collapse to ONE column
    expect(gb.assignments[0].assignment_key).toBe('lesson:L1');
  });

  it('override-wins: displayed_grade = teacher_score ?? score_pct, is_override set', async () => {
    HW = [{ id: 'h1', assignment_id: 'a_s1', student_id: 's1', status: 'graded', score_pct: 70, teacher_score: 90, allow_redo: false, is_redo: false, attempt_no: 1, submitted_on_time: true, graded_at: '2026-06-11T00:00:00Z' }];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    const cell = gb.cells['s1']['lesson:L1'];
    expect(cell.status).toBe('graded');
    expect(cell.displayed_grade).toBe(90);
    expect(cell.is_override).toBe(true);
  });

  it('submitted-but-ungraded is its own status, excluded from the average', async () => {
    HW = [{ id: 'h2', assignment_id: 'a_s1', student_id: 's1', status: 'submitted', score_pct: null, teacher_score: null, allow_redo: false, is_redo: false, attempt_no: 1, submitted_on_time: true, submitted_at: '2026-06-09T00:00:00Z' }];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.cells['s1']['lesson:L1'].status).toBe('submitted');
    expect(gb.cells['s1']['lesson:L1'].displayed_grade).toBeNull();
    expect(gb.column_averages['lesson:L1']).toBeNull(); // nothing graded → excluded
  });

  it('redo_in_progress keeps the prior graded grade visible', async () => {
    HW = [
      { id: 'g1', assignment_id: 'a_s1', student_id: 's1', status: 'graded', score_pct: 80, teacher_score: null, allow_redo: true, is_redo: false, attempt_no: 1, graded_at: '2026-06-11T00:00:00Z' },
      { id: 'g2', assignment_id: 'a_s1', student_id: 's1', status: 'in_progress', score_pct: null, teacher_score: null, allow_redo: false, is_redo: true, attempt_no: 2, created_at: '2026-06-12T00:00:00Z' },
    ];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    const cell = gb.cells['s1']['lesson:L1'];
    expect(cell.status).toBe('redo_in_progress');
    expect(cell.displayed_grade).toBe(80); // prior grade NOT lost
  });

  it('quiz columns key on quiz_id so two students share one column', async () => {
    QUIZ_ATTEMPTS = [
      { id: 'qa1', quiz_id: 'q1', student_id: 's1', score_pct: 88, mastery_band: 'grade_level', is_complete: true, submitted_at: '2026-06-08T00:00:00Z' },
      { id: 'qa2', quiz_id: 'q1', student_id: 's2', score_pct: 60, mastery_band: 'reteach', is_complete: true, submitted_at: '2026-06-08T00:00:00Z' },
    ];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.quizzes).toHaveLength(1);
    expect(gb.quizzes[0].quiz_id).toBe('q1');
    expect(gb.quiz_cells['s1']['q1'].score_pct).toBe(88);
    expect(gb.quiz_cells['s2']['q1'].score_pct).toBe(60);
  });

  it('class_average is the mean of graded cells and excludes quizzes; null when nothing graded', async () => {
    HW = [
      { id: 'h1', assignment_id: 'a_s1', student_id: 's1', status: 'graded', score_pct: 80, teacher_score: null, allow_redo: false, is_redo: false, attempt_no: 1, graded_at: '2026-06-11T00:00:00Z' },
      { id: 'h2', assignment_id: 'a_s2', student_id: 's2', status: 'graded', score_pct: 60, teacher_score: null, allow_redo: false, is_redo: false, attempt_no: 1, graded_at: '2026-06-11T00:00:00Z' },
    ];
    QUIZ_ATTEMPTS = [{ id: 'qa1', quiz_id: 'q1', student_id: 's1', score_pct: 10, mastery_band: 'reteach', is_complete: true, submitted_at: '2026-06-08T00:00:00Z' }];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.class_average).toBe(70);  // (80+60)/2 — quiz 10 NOT included
  });
});
