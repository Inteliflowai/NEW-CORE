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
// maybeSingle() returns the first row (or null) as a Promise<{ data, error }>.
function table(rows: () => unknown[]) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['select', 'eq', 'in', 'order', 'gte']) q[m] = chain;
  // maybeSingle: resolves with first row or null (single-row variant)
  q['maybeSingle'] = () => Promise.resolve({ data: (rows()[0] ?? null), error: null });
  q['upsert'] = (data: unknown, opts?: unknown) => {
    upsertCalls.push({ data, opts });
    // upsert returns a builder; make it awaitable with no-error result
    const u: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in']) u[m] = () => u;
    (u as { then: unknown }).then = (resolve: (v: { error: null }) => void) => resolve({ error: null });
    return u;
  };
  q['update'] = (data: unknown) => {
    updateCalls.push({ data });
    const u: Record<string, unknown> = {};
    for (const m of ['eq', 'in']) u[m] = () => u;
    (u as { then: unknown }).then = (resolve: (v: { error: null }) => void) => resolve({ error: null });
    return u;
  };
  (q as { then: unknown }).then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: rows(), error: null });
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
  ENROLLMENTS = [{ student_id: 's1' }];
  USERS = [{ id: 's1', full_name: 'Ann' }];
  ASSIGNMENTS = [{ id: 'a1' }];
  QUIZZES = [{ id: 'qz1' }];
  HW = [{ id: 'h1', student_id: 's1', assignment_id: 'a1', status: 'graded', score_pct: 30, teacher_score: null, allow_redo: false, is_redo: false, submitted_at: '2026-06-22T10:00:00Z' }];
  QUIZ_ATTEMPTS = [{ id: 'qa1', student_id: 's1', is_complete: true, score_pct: 30, submitted_at: '2026-06-22T10:00:00Z' }];
  // A stale open alert whose occurrence key (strong_result / old_qa) is NOT in the new condition set
  OPEN_ALERTS = [
    { id: 'stale1', student_id: 's1', source_kind: 'strong_result', source_ref: 'old_qa', severity: 'info', created_at: '2026-06-20T00:00:00Z' },
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

  it('returns AlertView[] sorted urgent → watch → info', async () => {
    // Seed OPEN_ALERTS with mixed severities both in the condition set
    OPEN_ALERTS = [
      // Both of these correspond to conditions that will be computed (low_quiz + low_assignment)
      { id: 'a_info', student_id: 's1', source_kind: 'strong_result', source_ref: 'qa1', severity: 'info', created_at: '2026-06-22T00:00:00Z' },
      { id: 'a_urg', student_id: 's1', source_kind: 'low_quiz', source_ref: 'qa1', severity: 'urgent', created_at: '2026-06-22T00:00:00Z' },
    ];
    const result = await reconcileAlerts(mockAdmin(), { classId: 'c1', now: NOW });
    // Sort invariant: severity order must be non-decreasing
    const severityOrder: Record<string, number> = { urgent: 0, watch: 1, info: 2 };
    for (let i = 1; i < result.length; i++) {
      expect(severityOrder[result[i].severity]).toBeGreaterThanOrEqual(severityOrder[result[i - 1].severity]);
    }
  });
});
