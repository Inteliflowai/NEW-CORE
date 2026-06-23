import { describe, it, expect, beforeEach } from 'vitest';
import { loadGradebook } from '@/lib/gradebook/loadGradebook';

// Scriptable tables.
let ENROLLMENTS: unknown[]; let ASSIGNMENTS: unknown[]; let HW: unknown[];
let QUIZZES: unknown[]; let QUIZ_ATTEMPTS: unknown[]; let LESSONS: unknown[];

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
    if (t === 'lessons') return table(() => LESSONS);
    return table(() => []);
  },
} as unknown as Parameters<typeof loadGradebook>[0];

beforeEach(() => {
  LESSONS = [];
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
    expect(gb.assignments[0].assignment_key).toBe('lesson:L1:2026-06-01');
  });

  it('override-wins: displayed_grade = teacher_score ?? score_pct, is_override set', async () => {
    HW = [{ id: 'h1', assignment_id: 'a_s1', student_id: 's1', status: 'graded', score_pct: 70, teacher_score: 90, allow_redo: false, is_redo: false, attempt_no: 1, submitted_on_time: true, graded_at: '2026-06-11T00:00:00Z' }];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    const cell = gb.cells['s1']['lesson:L1:2026-06-01'];
    expect(cell.status).toBe('graded');
    expect(cell.displayed_grade).toBe(90);
    expect(cell.is_override).toBe(true);
  });

  it('submitted-but-ungraded is its own status, excluded from the average', async () => {
    HW = [{ id: 'h2', assignment_id: 'a_s1', student_id: 's1', status: 'submitted', score_pct: null, teacher_score: null, allow_redo: false, is_redo: false, attempt_no: 1, submitted_on_time: true, submitted_at: '2026-06-09T00:00:00Z' }];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.cells['s1']['lesson:L1:2026-06-01'].status).toBe('submitted');
    expect(gb.cells['s1']['lesson:L1:2026-06-01'].displayed_grade).toBeNull();
    expect(gb.column_averages['lesson:L1:2026-06-01']).toBeNull(); // nothing graded → excluded
  });

  it('redo_in_progress keeps the prior graded grade visible', async () => {
    HW = [
      { id: 'g1', assignment_id: 'a_s1', student_id: 's1', status: 'graded', score_pct: 80, teacher_score: null, allow_redo: true, is_redo: false, attempt_no: 1, graded_at: '2026-06-11T00:00:00Z' },
      { id: 'g2', assignment_id: 'a_s1', student_id: 's1', status: 'in_progress', score_pct: null, teacher_score: null, allow_redo: false, is_redo: true, attempt_no: 2, created_at: '2026-06-12T00:00:00Z' },
    ];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    const cell = gb.cells['s1']['lesson:L1:2026-06-01'];
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

  it('a student with no assignment row in a column is `none` (never assigned), not `missing`', async () => {
    // Differentiated column: only s1 is assigned (no a_s2 row), due date is in the past.
    ASSIGNMENTS = [
      { id: 'a_s1', lesson_id: 'L1', content: {}, due_at: '2026-06-10T00:00:00Z', created_at: '2026-06-01T00:00:00Z', student_id: 's1' },
    ];
    HW = [];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.cells['s1']['lesson:L1:2026-06-01'].status).toBe('missing'); // assigned + past + no attempt → real miss
    expect(gb.cells['s2']['lesson:L1:2026-06-01'].status).toBe('none');    // never assigned → inert, NOT a miss
    expect(gb.missing_count).toBe(1);                            // s2's `none` excluded from the count
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

  // I2 — a lone in_progress attempt on a PAST-DUE column is a real miss, not "submitted".
  // loadAssignmentForPlay inserts status:'in_progress' the moment a student OPENS the work;
  // that must not masquerade as turned-in.
  it('a lone in_progress attempt on a past-due column is `missing` (counted), not `submitted`', async () => {
    // Only s1 is assigned this past-due column, and s1 merely OPENED it (lone in_progress).
    ASSIGNMENTS = [
      { id: 'a_s1', lesson_id: 'L1', content: {}, due_at: '2026-06-10T00:00:00Z', created_at: '2026-06-01T00:00:00Z', student_id: 's1' },
    ];
    HW = [{ id: 'ip1', assignment_id: 'a_s1', student_id: 's1', status: 'in_progress', score_pct: null, teacher_score: null, allow_redo: false, is_redo: false, attempt_no: 1, created_at: '2026-06-09T00:00:00Z' }];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.cells['s1']['lesson:L1:2026-06-01'].status).toBe('missing'); // opened-but-never-submitted, past due → miss
    expect(gb.cells['s2']['lesson:L1:2026-06-01'].status).toBe('none');    // s2 never assigned → inert, not counted
    expect(gb.missing_count).toBe(1);                            // only the lone in_progress is counted
  });

  // I2 — same lone in_progress but NOT yet past due → not_due (cannot be a miss yet).
  it('a lone in_progress attempt before the due date is `not_due`, not `submitted`', async () => {
    ASSIGNMENTS = [
      { id: 'a_s1', lesson_id: 'L1', content: {}, due_at: '2099-01-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z', student_id: 's1' },
      { id: 'a_s2', lesson_id: 'L1', content: {}, due_at: '2099-01-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z', student_id: 's2' },
    ];
    HW = [{ id: 'ip1', assignment_id: 'a_s1', student_id: 's1', status: 'in_progress', score_pct: null, teacher_score: null, allow_redo: false, is_redo: false, attempt_no: 1, created_at: '2026-06-09T00:00:00Z' }];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.cells['s1']['lesson:L1:2026-06-01'].status).toBe('not_due');
    expect(gb.missing_count).toBe(0);
  });

  // I3 — quiz latest-attempt selection must prefer the COMPLETED attempt over a newer
  // in-progress retake (null submitted_at). Postgres sorts NULLs first, so a naive
  // .order('submitted_at') would hand the in-progress row the win and mask the result.
  it('quiz cell prefers the completed attempt over a newer in-progress (null submitted_at) retake', async () => {
    QUIZ_ATTEMPTS = [
      // In-progress retake — null submitted_at would sort FIRST under Postgres NULLS FIRST.
      { id: 'qa_ip', quiz_id: 'q1', student_id: 's1', score_pct: null, mastery_band: null, is_complete: false, submitted_at: null },
      // The real completed result.
      { id: 'qa_done', quiz_id: 'q1', student_id: 's1', score_pct: 88, mastery_band: 'grade_level', is_complete: true, submitted_at: '2026-06-08T00:00:00Z' },
    ];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    const cell = gb.quiz_cells['s1']['q1'];
    expect(cell.is_complete).toBe(true);      // the completed attempt wins
    expect(cell.score_pct).toBe(88);          // its score, not the in-progress null
    expect(cell.quiz_attempt_id).toBe('qa_done');
  });

  // I4 — effort_label is carried from the graded attempt when present, else recomputed.
  it('carries effort_label from the graded attempt, recomputes when absent, null when ungraded', async () => {
    HW = [
      // s1: stored effort_label present → carried verbatim.
      { id: 'h1', assignment_id: 'a_s1', student_id: 's1', status: 'graded', score_pct: 90, teacher_score: null, effort_label: 'effortful_success', teli_hint_count: 3, allow_redo: false, is_redo: false, attempt_no: 1, graded_at: '2026-06-11T00:00:00Z' },
      // s2: no stored effort_label → recomputed from {score:60, hints:2} → struggling_trying.
      { id: 'h2', assignment_id: 'a_s2', student_id: 's2', status: 'graded', score_pct: 60, teacher_score: null, effort_label: null, teli_hint_count: 2, allow_redo: false, is_redo: false, attempt_no: 1, graded_at: '2026-06-11T00:00:00Z' },
    ];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.cells['s1']['lesson:L1:2026-06-01'].effort_label).toBe('effortful_success');
    expect(gb.cells['s2']['lesson:L1:2026-06-01'].effort_label).toBe('struggling_trying'); // recomputed
  });

  it('effort_label recompute uses the override grade (teacher_score) when present', async () => {
    HW = [
      // No stored effort_label; teacher overrode 60 → 90 with no hints → independent_success.
      { id: 'h1', assignment_id: 'a_s1', student_id: 's1', status: 'graded', score_pct: 60, teacher_score: 90, effort_label: null, teli_hint_count: 0, allow_redo: false, is_redo: false, attempt_no: 1, graded_at: '2026-06-11T00:00:00Z' },
    ];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.cells['s1']['lesson:L1:2026-06-01'].effort_label).toBe('independent_success');
  });

  it('non-graded cells carry no effort_label (null)', async () => {
    HW = [{ id: 'h2', assignment_id: 'a_s1', student_id: 's1', status: 'submitted', score_pct: null, teacher_score: null, effort_label: null, teli_hint_count: null, allow_redo: false, is_redo: false, attempt_no: 1, submitted_at: '2026-06-09T00:00:00Z' }];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.cells['s1']['lesson:L1:2026-06-01'].effort_label).toBeNull();
  });

  // M7 — a not_due cell (no attempt, future due) and a redo cell (graded + allow_redo, no newer attempt).
  it('a not_due cell (no attempt, future due) and a redo cell (graded + allow_redo) derive correctly', async () => {
    ASSIGNMENTS = [
      { id: 'a_s1', lesson_id: 'L1', content: {}, due_at: '2099-01-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z', student_id: 's1' },
      { id: 'a_s2', lesson_id: 'L1', content: {}, due_at: '2099-01-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z', student_id: 's2' },
    ];
    HW = [
      // s2 graded with allow_redo and NO newer attempt → status `redo` (prior grade retained).
      { id: 'h2', assignment_id: 'a_s2', student_id: 's2', status: 'graded', score_pct: 75, teacher_score: null, allow_redo: true, is_redo: false, attempt_no: 1, graded_at: '2026-06-11T00:00:00Z' },
    ];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.cells['s1']['lesson:L1:2026-06-01'].status).toBe('not_due');   // no attempt, future due
    expect(gb.cells['s2']['lesson:L1:2026-06-01'].status).toBe('redo');      // graded + allow_redo, no newer attempt
    expect(gb.cells['s2']['lesson:L1:2026-06-01'].displayed_grade).toBe(75); // prior grade retained
  });

  // M7 — the `due:` key (null lesson_id, collapse by due_at) and `id:` key (both null) derivations.
  it('groups by due_at when lesson_id is null (`due:` key), and by id when both are null (`id:` key)', async () => {
    ASSIGNMENTS = [
      // Two no-lesson assignments sharing one due_at → collapse to one `due:` column.
      { id: 'a_s1', lesson_id: null, content: {}, due_at: '2026-06-10T00:00:00Z', created_at: '2026-06-01T00:00:00Z', student_id: 's1' },
      { id: 'a_s2', lesson_id: null, content: {}, due_at: '2026-06-10T00:00:00Z', created_at: '2026-06-01T00:00:00Z', student_id: 's2' },
      // A no-lesson, no-due assignment → its own `id:` column.
      { id: 'a_s3', lesson_id: null, content: {}, due_at: null, created_at: '2026-06-02T00:00:00Z', student_id: 's1' },
    ];
    HW = [];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    const keys = gb.assignments.map(a => a.assignment_key);
    expect(keys).toContain('due:2026-06-10T00:00:00Z');
    expect(keys).toContain('id:a_s3');
  });

  // A-C3 — quiz_cells must be bounded to the KEPT quiz columns (MAX_QUIZ_COLS=8). With >8
  // quizzes-with-attempts, quiz_cells keys must be a subset of the returned quizzes' ids, so
  // the matrix can never carry orphaned cells for sliced-off columns.
  it('bounds quiz_cells to the kept quiz columns (no orphaned cells past MAX_QUIZ_COLS)', async () => {
    const N = 11; // > MAX_QUIZ_COLS (8)
    QUIZZES = Array.from({ length: N }, (_, i) => ({
      id: `q${i}`, title: `Quiz ${i}`,
      // created_at descending so the slice keeps the highest-index quizzes deterministically.
      created_at: `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    }));
    QUIZ_ATTEMPTS = Array.from({ length: N }, (_, i) => ({
      id: `qa${i}`, quiz_id: `q${i}`, student_id: 's1', score_pct: 80,
      mastery_band: 'grade_level', is_complete: true, submitted_at: '2026-06-08T00:00:00Z',
    }));
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.quizzes.length).toBe(8); // sliced to MAX_QUIZ_COLS
    const keptIds = new Set(gb.quizzes.map((q) => q.quiz_id));
    // Every quiz_cells key for every student must be one of the kept columns.
    for (const sid of Object.keys(gb.quiz_cells)) {
      for (const qid of Object.keys(gb.quiz_cells[sid])) {
        expect(keptIds.has(qid), `orphaned quiz_cell ${qid} for ${sid}`).toBe(true);
      }
    }
  });

  // A-C6 / A-U5 / A-C7 — a graded cell carries its teacher_notes + submitted_at (now needed
  // by the drill-in); non-graded / no-attempt cells carry null for both.
  it('a graded cell carries teacher_notes and submitted_at; empty cells carry null', async () => {
    HW = [
      { id: 'h1', assignment_id: 'a_s1', student_id: 's1', status: 'graded', score_pct: 88, teacher_score: null, teacher_notes: 'great reasoning', allow_redo: false, is_redo: false, attempt_no: 1, submitted_on_time: true, submitted_at: '2026-06-09T00:00:00Z', graded_at: '2026-06-11T00:00:00Z' },
    ];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    const graded = gb.cells['s1']['lesson:L1:2026-06-01'];
    expect(graded.teacher_notes).toBe('great reasoning');
    expect(graded.submitted_at).toBe('2026-06-09T00:00:00Z');
    // s2 has no attempt → both null.
    const empty = gb.cells['s2']['lesson:L1:2026-06-01'];
    expect(empty.teacher_notes).toBeNull();
    expect(empty.submitted_at).toBeNull();
  });

  // A-C4 — the loader takes an optional `now` (no globalThis seam). A past-due column with no
  // attempt reads `missing` only relative to the injected clock.
  it('honors an injected now: a column due before `now` is missing, after `now` is not_due', async () => {
    ASSIGNMENTS = [
      { id: 'a_s1', lesson_id: 'L1', content: {}, due_at: '2026-06-10T00:00:00Z', created_at: '2026-06-01T00:00:00Z', student_id: 's1' },
      { id: 'a_s2', lesson_id: 'L1', content: {}, due_at: '2026-06-10T00:00:00Z', created_at: '2026-06-01T00:00:00Z', student_id: 's2' },
    ];
    HW = [];
    const after = await loadGradebook(admin, { classId: 'c1', teacherId: 't1', now: new Date('2026-06-15T00:00:00Z') });
    expect(after.cells['s1']['lesson:L1:2026-06-01'].status).toBe('missing'); // now is past the due date
    const before = await loadGradebook(admin, { classId: 'c1', teacherId: 't1', now: new Date('2026-06-05T00:00:00Z') });
    expect(before.cells['s1']['lesson:L1:2026-06-01'].status).toBe('not_due'); // now is before the due date
  });

  // M1 — a logical column's due_at is deterministic across the group (max non-null), not row-order-dependent.
  it('picks a deterministic column due_at across the group regardless of row order', async () => {
    ASSIGNMENTS = [
      // Same lesson, divergent due dates and reversed order — the column must pick the MAX non-null.
      { id: 'a_s1', lesson_id: 'L1', content: {}, due_at: '2026-06-05T00:00:00Z', created_at: '2026-06-01T00:00:00Z', student_id: 's1' },
      { id: 'a_s2', lesson_id: 'L1', content: {}, due_at: '2026-06-20T00:00:00Z', created_at: '2026-06-01T00:00:00Z', student_id: 's2' },
    ];
    HW = [];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.assignments[0].due_at).toBe('2026-06-20T00:00:00Z'); // max non-null, stable
  });

  it('splits same-lesson assignments by assigned day into separate dated columns', async () => {
    ASSIGNMENTS = [
      // Same lesson L1, two distinct assigned days → two columns; per-student fan-out within a day stays one.
      { id: 'd1_s1', lesson_id: 'L1', content: {}, due_at: '2026-06-12T00:00:00Z', assigned_at: '2026-06-10T00:00:00Z', created_at: '2026-06-10T00:00:00Z', student_id: 's1' },
      { id: 'd1_s2', lesson_id: 'L1', content: {}, due_at: '2026-06-12T00:00:00Z', assigned_at: '2026-06-10T00:00:00Z', created_at: '2026-06-10T00:00:00Z', student_id: 's2' },
      { id: 'd2_s1', lesson_id: 'L1', content: {}, due_at: '2026-06-14T00:00:00Z', assigned_at: '2026-06-13T00:00:00Z', created_at: '2026-06-13T00:00:00Z', student_id: 's1' },
      { id: 'd2_s2', lesson_id: 'L1', content: {}, due_at: '2026-06-14T00:00:00Z', assigned_at: '2026-06-13T00:00:00Z', created_at: '2026-06-13T00:00:00Z', student_id: 's2' },
    ];
    HW = [];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    const keys = gb.assignments.map(a => a.assignment_key);
    expect(keys).toEqual(['lesson:L1:2026-06-10', 'lesson:L1:2026-06-13']); // chronological asc
    expect(gb.assignments).toHaveLength(2);
  });

  it('orders columns oldest → newest by assigned day', async () => {
    ASSIGNMENTS = [
      { id: 'late_s1', lesson_id: 'L1', content: {}, due_at: null, assigned_at: '2026-06-15T00:00:00Z', created_at: '2026-06-15T00:00:00Z', student_id: 's1' },
      { id: 'early_s1', lesson_id: 'L2', content: {}, due_at: null, assigned_at: '2026-06-05T00:00:00Z', created_at: '2026-06-05T00:00:00Z', student_id: 's1' },
    ];
    HW = [];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.assignments.map(a => a.assignment_key)).toEqual(['lesson:L2:2026-06-05', 'lesson:L1:2026-06-15']);
  });

  it('uses the lesson title as the column title when available', async () => {
    LESSONS = [{ id: 'L1', title: 'Fractions' }];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.assignments[0].title).toBe('Fractions');
    expect(gb.assignments[0].assigned_at).toBe('2026-06-01T00:00:00Z');
  });
});
