import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeConditions, type ReconcileInput, reconcileAlerts } from '@/lib/alerts/reconcileAlerts';

const NOW = new Date('2026-06-22T12:00:00Z');
const base: ReconcileInput = { students: [{ id: 's1', full_name: 'Ann' }], quizAttempts: [], hwAttempts: [] };

describe('computeConditions', () => {
  it('flags a low quiz urgent under 40, watch in 40–60', () => {
    const urgent = computeConditions({ ...base, quizAttempts: [{ id: 'q1', student_id: 's1', is_complete: true, score_pct: 30, submitted_at: '2026-06-22T10:00:00Z' }] }, NOW);
    expect(urgent).toContainEqual({ student_id: 's1', source_kind: 'low_quiz', source_ref: 'q1', severity: 'urgent' });
    const watch = computeConditions({ ...base, quizAttempts: [{ id: 'q2', student_id: 's1', is_complete: true, score_pct: 50, submitted_at: '2026-06-22T10:00:00Z' }] }, NOW);
    expect(watch).toContainEqual({ student_id: 's1', source_kind: 'low_quiz', source_ref: 'q2', severity: 'watch' });
  });
  it('uses the LATEST quiz attempt only', () => {
    const c = computeConditions({ ...base, quizAttempts: [
      { id: 'old', student_id: 's1', is_complete: true, score_pct: 20, submitted_at: '2026-06-20T10:00:00Z' },
      { id: 'new', student_id: 's1', is_complete: true, score_pct: 90, submitted_at: '2026-06-22T10:00:00Z' },
    ] }, NOW);
    expect(c.find((x) => x.source_kind === 'low_quiz')).toBeUndefined(); // latest is fine
    expect(c.find((x) => x.source_kind === 'strong_result')?.source_ref).toBe('new');
  });
  it('flags a low assignment using teacher_score over score_pct (override wins)', () => {
    const c = computeConditions({ ...base, hwAttempts: [
      { id: 'h1', student_id: 's1', assignment_id: 'a1', status: 'graded', score_pct: 30, teacher_score: 80, allow_redo: false, is_redo: false, submitted_at: '2026-06-22T10:00:00Z' },
    ] }, NOW);
    expect(c.find((x) => x.source_kind === 'low_assignment')).toBeUndefined(); // override 80 is fine
  });
  it('flags reteach_flag when allow_redo and no redo exists yet', () => {
    const c = computeConditions({ ...base, hwAttempts: [
      { id: 'h1', student_id: 's1', assignment_id: 'a1', status: 'graded', score_pct: 70, teacher_score: null, allow_redo: true, is_redo: false, submitted_at: '2026-06-22T10:00:00Z' },
    ] }, NOW);
    expect(c).toContainEqual({ student_id: 's1', source_kind: 'reteach_flag', source_ref: 'h1', severity: 'watch' });
  });
  it('flags reteach_review for a submitted-but-ungraded redo', () => {
    const c = computeConditions({ ...base, hwAttempts: [
      { id: 'r1', student_id: 's1', assignment_id: 'a1', status: 'submitted', score_pct: null, teacher_score: null, allow_redo: false, is_redo: true, submitted_at: '2026-06-22T10:00:00Z' },
    ] }, NOW);
    expect(c).toContainEqual({ student_id: 's1', source_kind: 'reteach_review', source_ref: 'r1', severity: 'urgent' });
  });
  it('preserves reteach_flag when an IN-PROGRESS redo exists (only a COMPLETED redo clears it)', () => {
    // allow_redo original attempt + an in_progress redo → reteach_flag must still fire
    const c = computeConditions({ ...base, hwAttempts: [
      { id: 'h1', student_id: 's1', assignment_id: 'a1', status: 'graded', score_pct: 70, teacher_score: null, allow_redo: true, is_redo: false, submitted_at: '2026-06-22T09:00:00Z' },
      { id: 'r1', student_id: 's1', assignment_id: 'a1', status: 'in_progress', score_pct: null, teacher_score: null, allow_redo: false, is_redo: true, submitted_at: null },
    ] }, NOW);
    expect(c).toContainEqual({ student_id: 's1', source_kind: 'reteach_flag', source_ref: 'h1', severity: 'watch' });
  });
  it('flags a strong result (info) at or above 85 when not low', () => {
    const c = computeConditions({ ...base, quizAttempts: [{ id: 'q1', student_id: 's1', is_complete: true, score_pct: 92, submitted_at: '2026-06-22T10:00:00Z' }] }, NOW);
    expect(c).toContainEqual({ student_id: 's1', source_kind: 'strong_result', source_ref: 'q1', severity: 'info' });
  });
});

// ── reconcileAlerts integration test (mock-admin pattern mirrors loadGradebook.test.ts) ────────────
//
// Seeded data:
// - class c1, school sc1, enrolled student s1 (Ann)
// - one assignment a1, one quiz qz1
// - one hw attempt: graded, score_pct=30 (low, urgent) → condition: low_assignment
// - one quiz attempt: complete, score_pct=30 (low, urgent) → condition: low_quiz
// - one open alert (different occurrence) that is NOT in the new condition set → auto-cleared

let CLASSES: unknown[]; let ENROLLMENTS: unknown[]; let USERS: unknown[];
let ASSIGNMENTS: unknown[]; let QUIZZES: unknown[];
let HW: unknown[]; let QUIZ_ATTEMPTS: unknown[];
let OPEN_ALERTS: unknown[];
const upsertCalls: unknown[] = [];
const updateCalls: unknown[] = [];

// Minimal chainable query stub mirroring the loadGradebook.test.ts harness.
// Supports eq() scalar filters and in() set filters so tests that assert on
// active-only enrollments and per-student scoping can verify the real behaviour.
function table(rows: () => unknown[]) {
  const eqFilters: { field: string; value: unknown }[] = [];
  const inFilters: { field: string; values: unknown[] }[] = [];
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['select', 'order', 'gte']) q[m] = chain;
  q['eq'] = (field: string, value: unknown) => { eqFilters.push({ field, value }); return q; };
  q['in'] = (field: string, values: unknown[]) => { inFilters.push({ field, values }); return q; };
  const resolve = () => rows().filter((r) => {
    const row = r as Record<string, unknown>;
    const eqOk = eqFilters.every(({ field, value }) => row[field] === value);
    const inOk = inFilters.every(({ field, values }) => values.includes(row[field]));
    return eqOk && inOk;
  });
  // maybeSingle: resolves with first row or null (single-row variant)
  q['maybeSingle'] = () => Promise.resolve({ data: (resolve()[0] ?? null), error: null });
  q['upsert'] = (data: unknown, opts?: unknown) => {
    upsertCalls.push({ data, opts });
    const u: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in']) u[m] = () => u;
    (u as { then: unknown }).then = (cb: (v: { error: null }) => void) => cb({ error: null });
    return u;
  };
  q['update'] = (data: unknown) => {
    updateCalls.push({ data });
    const u: Record<string, unknown> = {};
    for (const m of ['eq', 'in']) u[m] = () => u;
    (u as { then: unknown }).then = (cb: (v: { error: null }) => void) => cb({ error: null });
    return u;
  };
  (q as { then: unknown }).then = (cb: (v: { data: unknown[]; error: null }) => void) =>
    cb({ data: resolve(), error: null });
  return q;
}

function mockAdmin() {
  return {
    from: (t: string) => {
      if (t === 'classes') return table(() => CLASSES);
      if (t === 'enrollments') return table(() => ENROLLMENTS);
      if (t === 'users') return table(() => USERS);
      if (t === 'assignments') return table(() => ASSIGNMENTS);
      if (t === 'quizzes') return table(() => QUIZZES);
      if (t === 'homework_attempts') return table(() => HW);
      if (t === 'quiz_attempts') return table(() => QUIZ_ATTEMPTS);
      if (t === 'alerts') return table(() => OPEN_ALERTS);
      return table(() => []);
    },
  } as unknown as Parameters<typeof reconcileAlerts>[0];
}

beforeEach(() => {
  upsertCalls.length = 0;
  updateCalls.length = 0;
  CLASSES = [{ id: 'c1', school_id: 'sc1' }];
  ENROLLMENTS = [{ student_id: 's1', class_id: 'c1', is_active: true }];
  USERS = [{ id: 's1', full_name: 'Ann' }];
  ASSIGNMENTS = [{ id: 'a1', class_id: 'c1' }];
  QUIZZES = [{ id: 'qz1', class_id: 'c1' }];
  HW = [{ id: 'h1', student_id: 's1', assignment_id: 'a1', status: 'graded', score_pct: 30, teacher_score: null, allow_redo: false, is_redo: false, submitted_at: '2026-06-22T10:00:00Z' }];
  QUIZ_ATTEMPTS = [{ id: 'qa1', student_id: 's1', quiz_id: 'qz1', is_complete: true, score_pct: 30, submitted_at: '2026-06-22T10:00:00Z' }];
  // A stale open alert whose occurrence key (strong_result / old_qa) is NOT in the new condition set
  OPEN_ALERTS = [
    { id: 'stale1', student_id: 's1', source_kind: 'strong_result', source_ref: 'old_qa', severity: 'info', class_id: 'c1', status: 'open', created_at: '2026-06-20T00:00:00Z' },
  ];
});

describe('reconcileAlerts (integration)', () => {
  it('upserts conditions with onConflict + ignoreDuplicates when conditions exist', async () => {
    await reconcileAlerts(mockAdmin(), { classId: 'c1', now: NOW });
    expect(upsertCalls.length).toBeGreaterThan(0);
    const call = upsertCalls[0] as { data: unknown[]; opts: { onConflict: string; ignoreDuplicates: boolean } };
    expect(call.opts.onConflict).toBe('student_id,class_id,source_kind,source_ref');
    expect(call.opts.ignoreDuplicates).toBe(true);
    const rows = call.data as { source_kind: string }[];
    expect(rows.some((r) => r.source_kind === 'low_quiz')).toBe(true);
  });

  it('auto-clears a stale open alert (no longer in condition set) via update to resolved', async () => {
    await reconcileAlerts(mockAdmin(), { classId: 'c1', now: NOW });
    // stale1 (strong_result / old_qa) is NOT in the new condition set → should be cleared
    expect(updateCalls.length).toBeGreaterThan(0);
    const call = updateCalls[0] as { data: { status: string; resolved_at: string } };
    expect(call.data.status).toBe('resolved');
    expect(call.data.resolved_at).toBeTruthy();
  });

  it('returns AlertView[] sorted urgent → watch → info with ≥2 live results', async () => {
    // Seed two students: s1 gets a low quiz (urgent), s2 gets a strong result (info).
    // Both alerts are in OPEN_ALERTS with keys matching the computed conditions → both survive
    // reconcile and the sort loop must execute (result.length === 2).
    ENROLLMENTS = [{ student_id: 's1', class_id: 'c1', is_active: true }, { student_id: 's2', class_id: 'c1', is_active: true }];
    USERS = [{ id: 's1', full_name: 'Ann' }, { id: 's2', full_name: 'Bob' }];
    QUIZ_ATTEMPTS = [
      { id: 'qa1', student_id: 's1', quiz_id: 'qz1', is_complete: true, score_pct: 30, submitted_at: '2026-06-22T10:00:00Z' },
      { id: 'qa2', student_id: 's2', quiz_id: 'qz1', is_complete: true, score_pct: 90, submitted_at: '2026-06-22T10:00:00Z' },
    ];
    HW = [];
    // OPEN_ALERTS contains one row for each live condition key
    OPEN_ALERTS = [
      { id: 'a_info', student_id: 's2', source_kind: 'strong_result', source_ref: 'qa2', severity: 'info', class_id: 'c1', status: 'open', created_at: '2026-06-22T00:00:00Z' },
      { id: 'a_urg', student_id: 's1', source_kind: 'low_quiz', source_ref: 'qa1', severity: 'urgent', class_id: 'c1', status: 'open', created_at: '2026-06-22T00:00:00Z' },
    ];
    const result = await reconcileAlerts(mockAdmin(), { classId: 'c1', now: NOW });
    expect(result.length).toBeGreaterThanOrEqual(2); // loop must execute
    const severityOrder: Record<string, number> = { urgent: 0, watch: 1, info: 2 };
    for (let i = 1; i < result.length; i++) {
      expect(severityOrder[result[i].severity]).toBeGreaterThanOrEqual(severityOrder[result[i - 1].severity]);
    }
  });

  it('excludes inactive enrollments (is_active filter): withdrawn student generates no alerts', async () => {
    // s_inactive is enrolled but NOT active; seeded enrollment has is_active: false.
    // The mock honours eq() calls by chaining (all rows returned), so we test the
    // impl adds .eq('is_active', true) by seeding ONLY an inactive student and verifying
    // no conditions are upserted and the return is empty when is_active filtering works.
    // We do this by seeding a second, inactive enrollment entry and confirming the
    // upserted conditions only reference active students.
    ENROLLMENTS = [
      { student_id: 's1', class_id: 'c1', is_active: true },
      { student_id: 's_inactive', class_id: 'c1', is_active: false },
    ];
    USERS = [
      { id: 's1', full_name: 'Ann' },
      { id: 's_inactive', full_name: 'Withdrawn' },
    ];
    // The impl must filter enrollments to is_active:true → only s1 appears in studentIds
    // (in the mock the chain always returns all rows, so we test the impl calls
    // .eq('is_active', true) by checking the upserted student_ids never include s_inactive)
    HW = [
      { id: 'h_inactive', student_id: 's_inactive', assignment_id: 'a1', status: 'graded', score_pct: 20, teacher_score: null, allow_redo: false, is_redo: false, submitted_at: '2026-06-22T10:00:00Z' },
    ];
    QUIZ_ATTEMPTS = [];
    OPEN_ALERTS = [];
    await reconcileAlerts(mockAdmin(), { classId: 'c1', now: NOW });
    // If is_active filter works, s_inactive is excluded from studentIds and their attempts
    // are never in the .in(student_id) filter → no condition for s_inactive is upserted.
    // The mock returns ALL HW rows regardless, so we verify via the condition computation:
    // if s_inactive is not in students list, computeConditions won't generate a condition for them.
    // We check: no upsert row has student_id === 's_inactive'
    const allUpserted = upsertCalls.flatMap((c) => (c as { data: { student_id: string }[] }).data);
    expect(allUpserted.every((r) => r.student_id !== 's_inactive')).toBe(true);
  });
});
