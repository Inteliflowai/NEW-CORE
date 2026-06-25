// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the classroom helpers and resolveExternalIdentity BEFORE importing the engine
const listStudentSubmissions = vi.fn();
const patchStudentSubmissionDraftGrade = vi.fn();
const resolveExternalIdentity = vi.fn();

vi.mock('@/lib/google/classroom', () => ({
  listStudentSubmissions: (...a: unknown[]) => listStudentSubmissions(...a),
  patchStudentSubmissionDraftGrade: (...a: unknown[]) => patchStudentSubmissionDraftGrade(...a),
  GoogleScopeError: class GoogleScopeError extends Error {
    constructor() { super('google_scope_insufficient'); this.name = 'GoogleScopeError'; }
  },
}));
vi.mock('@/lib/google/resolveExternalIdentity', () => ({
  resolveExternalIdentity: (...a: unknown[]) => resolveExternalIdentity(...a),
}));

import { gradePassback, type PassbackArgs, type PassbackResult } from '@/lib/google/gradePassback';
import { GoogleScopeError } from '@/lib/google/classroom';

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Table-dispatching admin mock.
 *
 * `assignments` table:
 *   .select('id').eq('class_id', X).eq('lesson_id', Y) → assignmentRows
 *
 * `homework_attempts` table:
 *   .select(...).in('assignment_id', ids).eq('status','graded') → attemptRows
 */
function fakeAdmin(opts: {
  assignmentRows?: Array<{ id: string }>;
  attemptRows?: Array<{
    student_id: string;
    score_pct: number | null;
    teacher_score: number | null;
    graded_at: string | null;
    attempt_no: number | null;
  }>;
}) {
  const asgRows = opts.assignmentRows ?? [];
  const attRows = opts.attemptRows ?? [];

  return {
    from(table: string) {
      if (table === 'assignments') {
        // .select('id').eq('class_id',...).eq('lesson_id',...)
        const chain = {
          select(_cols: string) { return chain; },
          eq(_col: string, _val: string) { return chain; },
          async then(resolve: (v: { data: typeof asgRows; error: null }) => void) {
            resolve({ data: asgRows, error: null });
          },
        };
        // make it awaitable directly (await admin.from(...).select(...).eq(...).eq(...))
        return {
          select(_cols: string) {
            return {
              eq(_col1: string, _val1: string) {
                return {
                  eq(_col2: string, _val2: string) {
                    return Promise.resolve({ data: asgRows, error: null });
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'homework_attempts') {
        // .select(...).in('assignment_id', ids).eq('status','graded')
        return {
          select(_cols: string) {
            return {
              in(_col: string, _ids: string[]) {
                return {
                  eq(_col2: string, _val2: string) {
                    return Promise.resolve({ data: attRows, error: null });
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`unexpected table: ${table}`);
    },
  };
}

const baseArgs: PassbackArgs = {
  token: 'tok',
  schoolId: 'school-1',
  classId: 'class-1',
  lessonId: 'lesson-abc',
  googleCourseId: 'course-1',
  courseWorkId: 'cw-1',
  maxPoints: 100,
};

beforeEach(() => {
  listStudentSubmissions.mockReset();
  patchStudentSubmissionDraftGrade.mockReset();
  resolveExternalIdentity.mockReset();
  vi.useRealTimers();
});

// ── (a) multi-student happy path ──────────────────────────────────────────────

describe('gradePassback — (a) multi-student happy path', () => {
  it('pushes 2 grades from 1 call; pushed===2, skipped_not_linked===0, not_posted_in_classroom===false', async () => {
    const admin = fakeAdmin({
      assignmentRows: [{ id: 'asg-1' }, { id: 'asg-2' }], // C1: multiple assignment ids
      attemptRows: [
        { student_id: 'stu-A', score_pct: 80, teacher_score: null, graded_at: '2026-01-01T10:00:00Z', attempt_no: 1 },
        { student_id: 'stu-B', score_pct: 60, teacher_score: null, graded_at: '2026-01-01T10:00:00Z', attempt_no: 1 },
      ],
    });

    listStudentSubmissions.mockResolvedValueOnce([
      { id: 'sub-A', userId: 'gcid-A' },
      { id: 'sub-B', userId: 'gcid-B' },
    ]);
    // resolveExternalIdentity: gcid-A → stu-A, gcid-B → stu-B
    resolveExternalIdentity
      .mockResolvedValueOnce('stu-A')
      .mockResolvedValueOnce('stu-B');
    patchStudentSubmissionDraftGrade.mockResolvedValue(undefined);

    const result = await gradePassback(admin as never, baseArgs);

    expect(result.pushed).toBe(2); // C1: >1 grade pushed from ONE call
    expect(result.skipped_not_linked).toBe(0);
    expect(result.not_posted_in_classroom).toBe(false);
    expect(result.errors).toBe(0);

    // M1: draftGrade = round(clamp(80)/100 * 100 * 10)/10 = 80
    expect(patchStudentSubmissionDraftGrade).toHaveBeenCalledTimes(2);
    const calls = patchStudentSubmissionDraftGrade.mock.calls;
    const grades = calls.map((c: unknown[]) => c[4] as number).sort((a, b) => a - b);
    expect(grades).toEqual([60, 80]); // 60 and 80 scaled at maxPoints=100
  });
});

// ── (b1) graded-but-no-submission (I4) ─────────────────────────────────────────

describe('gradePassback — (b1) graded-but-no-submission', () => {
  it('skipped_not_linked===1 when a graded student has no GC submission', async () => {
    // 2 graded students; only 1 has a GC submission (linked)
    const admin = fakeAdmin({
      assignmentRows: [{ id: 'asg-1' }],
      attemptRows: [
        { student_id: 'stu-A', score_pct: 70, teacher_score: null, graded_at: '2026-01-01T10:00:00Z', attempt_no: 1 },
        { student_id: 'stu-B', score_pct: 90, teacher_score: null, graded_at: '2026-01-01T10:00:00Z', attempt_no: 1 }, // graded but unlinked
      ],
    });

    // Only 1 GC submission, resolves to stu-A
    listStudentSubmissions.mockResolvedValueOnce([
      { id: 'sub-A', userId: 'gcid-A' },
    ]);
    resolveExternalIdentity.mockResolvedValueOnce('stu-A'); // gcid-A → stu-A; stu-B has no submission
    patchStudentSubmissionDraftGrade.mockResolvedValue(undefined);

    const result = await gradePassback(admin as never, baseArgs);

    expect(result.pushed).toBe(1);
    expect(result.skipped_not_linked).toBe(1); // stu-B: graded but no GC submission
    expect(result.not_posted_in_classroom).toBe(false);
    expect(result.errors).toBe(0);
  });
});

// ── (b2) submission-but-no-grade (I4) ─────────────────────────────────────────

describe('gradePassback — (b2) submission-but-no-grade', () => {
  it('a GC submission with no graded attempt is neither pushed nor skipped', async () => {
    // 1 graded student (stu-A), 2 GC submissions (stu-A + stu-C who has no grade)
    const admin = fakeAdmin({
      assignmentRows: [{ id: 'asg-1' }],
      attemptRows: [
        { student_id: 'stu-A', score_pct: 75, teacher_score: null, graded_at: '2026-01-01T10:00:00Z', attempt_no: 1 },
        // stu-C has no graded attempt at all
      ],
    });

    listStudentSubmissions.mockResolvedValueOnce([
      { id: 'sub-A', userId: 'gcid-A' },
      { id: 'sub-C', userId: 'gcid-C' },
    ]);
    // gcid-A → stu-A; gcid-C → stu-C (no grade in bestByStudent)
    resolveExternalIdentity
      .mockResolvedValueOnce('stu-A')
      .mockResolvedValueOnce('stu-C');
    patchStudentSubmissionDraftGrade.mockResolvedValue(undefined);

    const result = await gradePassback(admin as never, baseArgs);

    expect(result.pushed).toBe(1); // only stu-A
    expect(result.skipped_not_linked).toBe(0); // stu-C is not "not linked" — they just have no grade
    expect(result.errors).toBe(0);
  });
});

// ── (c) PATCH throws transient → retry ──────────────────────────────────────

describe('gradePassback — (c) transient PATCH failure with retry', () => {
  it('retries after transient error and succeeds; pushed, no errors', async () => {
    vi.useFakeTimers();

    const admin = fakeAdmin({
      assignmentRows: [{ id: 'asg-1' }],
      attemptRows: [
        { student_id: 'stu-A', score_pct: 50, teacher_score: null, graded_at: '2026-01-01T10:00:00Z', attempt_no: 1 },
      ],
    });

    listStudentSubmissions.mockResolvedValueOnce([{ id: 'sub-A', userId: 'gcid-A' }]);
    resolveExternalIdentity.mockResolvedValueOnce('stu-A');

    // First call throws transient error; second call succeeds
    patchStudentSubmissionDraftGrade
      .mockRejectedValueOnce(new Error('transient 503'))
      .mockResolvedValueOnce(undefined);

    const resultPromise = gradePassback(admin as never, baseArgs);
    // Advance past the 1s retry delay
    await vi.runAllTimersAsync();

    const result = await resultPromise;

    expect(patchStudentSubmissionDraftGrade).toHaveBeenCalledTimes(2); // retried
    expect(result.pushed).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('counts as error when all 3 attempts fail; batch continues', async () => {
    vi.useFakeTimers();

    const admin = fakeAdmin({
      assignmentRows: [{ id: 'asg-1' }],
      attemptRows: [
        { student_id: 'stu-A', score_pct: 50, teacher_score: null, graded_at: '2026-01-01T10:00:00Z', attempt_no: 1 },
        { student_id: 'stu-B', score_pct: 70, teacher_score: null, graded_at: '2026-01-01T10:00:00Z', attempt_no: 1 },
      ],
    });

    listStudentSubmissions.mockResolvedValueOnce([
      { id: 'sub-A', userId: 'gcid-A' },
      { id: 'sub-B', userId: 'gcid-B' },
    ]);
    resolveExternalIdentity
      .mockResolvedValueOnce('stu-A')
      .mockResolvedValueOnce('stu-B');

    // stu-A: all 3 attempts fail; stu-B: succeeds
    patchStudentSubmissionDraftGrade
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockRejectedValueOnce(new Error('fail 3'))
      .mockResolvedValueOnce(undefined);

    const resultPromise = gradePassback(admin as never, baseArgs);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.errors).toBe(1); // stu-A failed all retries
    expect(result.pushed).toBe(1); // stu-B still pushed
  });
});

// ── (c2) GoogleScopeError → NOT retried, propagates ──────────────────────────

describe('gradePassback — (c2) GoogleScopeError propagates immediately', () => {
  it('throws GoogleScopeError without retrying (exactly 1 PATCH call)', async () => {
    const admin = fakeAdmin({
      assignmentRows: [{ id: 'asg-1' }],
      attemptRows: [
        { student_id: 'stu-A', score_pct: 80, teacher_score: null, graded_at: '2026-01-01T10:00:00Z', attempt_no: 1 },
      ],
    });

    listStudentSubmissions.mockResolvedValueOnce([{ id: 'sub-A', userId: 'gcid-A' }]);
    resolveExternalIdentity.mockResolvedValueOnce('stu-A');
    patchStudentSubmissionDraftGrade.mockRejectedValueOnce(new GoogleScopeError());

    await expect(gradePassback(admin as never, baseArgs)).rejects.toThrow(GoogleScopeError);

    // NOT retried — exactly ONE call
    expect(patchStudentSubmissionDraftGrade).toHaveBeenCalledTimes(1);
  });
});

// ── (d) override-wins ─────────────────────────────────────────────────────────

describe('gradePassback — (d) teacher_score override-wins', () => {
  it('uses teacher_score when present instead of score_pct', async () => {
    const admin = fakeAdmin({
      assignmentRows: [{ id: 'asg-1' }],
      attemptRows: [
        { student_id: 'stu-A', score_pct: 60, teacher_score: 85, graded_at: '2026-01-01T10:00:00Z', attempt_no: 1 },
      ],
    });

    listStudentSubmissions.mockResolvedValueOnce([{ id: 'sub-A', userId: 'gcid-A' }]);
    resolveExternalIdentity.mockResolvedValueOnce('stu-A');
    patchStudentSubmissionDraftGrade.mockResolvedValue(undefined);

    const result = await gradePassback(admin as never, baseArgs);

    expect(result.pushed).toBe(1);
    // draftGrade = round(85/100 * 100 * 10) / 10 = 85
    const [, , , , draftGrade] = patchStudentSubmissionDraftGrade.mock.calls[0] as unknown[];
    expect(draftGrade).toBe(85);
  });

  it('selects the latest attempt when multiple graded rows exist (highest attempt_no wins)', async () => {
    const admin = fakeAdmin({
      assignmentRows: [{ id: 'asg-1' }],
      attemptRows: [
        { student_id: 'stu-A', score_pct: 40, teacher_score: null, graded_at: '2026-01-01T09:00:00Z', attempt_no: 1 },
        { student_id: 'stu-A', score_pct: 95, teacher_score: null, graded_at: '2026-01-01T10:00:00Z', attempt_no: 2 }, // LATER
      ],
    });

    listStudentSubmissions.mockResolvedValueOnce([{ id: 'sub-A', userId: 'gcid-A' }]);
    resolveExternalIdentity.mockResolvedValueOnce('stu-A');
    patchStudentSubmissionDraftGrade.mockResolvedValue(undefined);

    await gradePassback(admin as never, baseArgs);

    const [, , , , draftGrade] = patchStudentSubmissionDraftGrade.mock.calls[0] as unknown[];
    expect(draftGrade).toBe(95); // latest attempt_no=2 wins
  });
});

// ── (e) empty submissions (C4) ────────────────────────────────────────────────

describe('gradePassback — (e) empty GC submissions (C4: not_posted_in_classroom)', () => {
  it('returns not_posted_in_classroom===true, pushed===0, skipped_not_linked===0; no PATCH calls', async () => {
    const admin = fakeAdmin({
      assignmentRows: [{ id: 'asg-1' }],
      attemptRows: [
        { student_id: 'stu-A', score_pct: 80, teacher_score: null, graded_at: '2026-01-01T10:00:00Z', attempt_no: 1 },
        { student_id: 'stu-B', score_pct: 70, teacher_score: null, graded_at: '2026-01-01T10:00:00Z', attempt_no: 1 },
      ],
    });

    // C4: empty submissions while graded students exist → distinct reason, NOT "skipped_not_linked"
    listStudentSubmissions.mockResolvedValueOnce([]);

    const result = await gradePassback(admin as never, baseArgs);

    expect(result.not_posted_in_classroom).toBe(true);
    expect(result.pushed).toBe(0);
    expect(result.skipped_not_linked).toBe(0); // NOT mis-bucketed as not-linked
    expect(result.errors).toBe(0);
    expect(patchStudentSubmissionDraftGrade).not.toHaveBeenCalled();
  });
});

// ── (f) M1 clamp: teacher_score > 100 ────────────────────────────────────────

describe('gradePassback — (f) M1 clamp: score > 100', () => {
  it('clamps a teacher_score of 120 to maxPoints (100%)', async () => {
    const admin = fakeAdmin({
      assignmentRows: [{ id: 'asg-1' }],
      attemptRows: [
        { student_id: 'stu-A', score_pct: null, teacher_score: 120, graded_at: '2026-01-01T10:00:00Z', attempt_no: 1 },
      ],
    });

    listStudentSubmissions.mockResolvedValueOnce([{ id: 'sub-A', userId: 'gcid-A' }]);
    resolveExternalIdentity.mockResolvedValueOnce('stu-A');
    patchStudentSubmissionDraftGrade.mockResolvedValue(undefined);

    const result = await gradePassback(admin as never, { ...baseArgs, maxPoints: 50 });

    expect(result.pushed).toBe(1);
    // M1: clamp(120,0,100)/100 * 50 = 1.0 * 50 = 50
    const [, , , , draftGrade] = patchStudentSubmissionDraftGrade.mock.calls[0] as unknown[];
    expect(draftGrade).toBe(50);
  });

  it('clamps a score of 0 to 0', async () => {
    const admin = fakeAdmin({
      assignmentRows: [{ id: 'asg-1' }],
      attemptRows: [
        { student_id: 'stu-A', score_pct: null, teacher_score: -10, graded_at: '2026-01-01T10:00:00Z', attempt_no: 1 },
      ],
    });

    listStudentSubmissions.mockResolvedValueOnce([{ id: 'sub-A', userId: 'gcid-A' }]);
    resolveExternalIdentity.mockResolvedValueOnce('stu-A');
    patchStudentSubmissionDraftGrade.mockResolvedValue(undefined);

    const result = await gradePassback(admin as never, { ...baseArgs, maxPoints: 100 });

    expect(result.pushed).toBe(1);
    const [, , , , draftGrade] = patchStudentSubmissionDraftGrade.mock.calls[0] as unknown[];
    expect(draftGrade).toBe(0);
  });

  it('rounds to one decimal: 33.3% of 30pts → 10 (round(9.99) = 10)', async () => {
    const admin = fakeAdmin({
      assignmentRows: [{ id: 'asg-1' }],
      attemptRows: [
        { student_id: 'stu-A', score_pct: 33.3, teacher_score: null, graded_at: '2026-01-01T10:00:00Z', attempt_no: 1 },
      ],
    });

    listStudentSubmissions.mockResolvedValueOnce([{ id: 'sub-A', userId: 'gcid-A' }]);
    resolveExternalIdentity.mockResolvedValueOnce('stu-A');
    patchStudentSubmissionDraftGrade.mockResolvedValue(undefined);

    await gradePassback(admin as never, { ...baseArgs, maxPoints: 30 });

    const [, , , , draftGrade] = patchStudentSubmissionDraftGrade.mock.calls[0] as unknown[];
    // Math.round(33.3/100 * 30 * 10) / 10 = Math.round(99.9) / 10 = 100/10 = 10
    expect(draftGrade).toBe(10);
  });
});

// ── edge: no assignments for this lesson/class ────────────────────────────────

describe('gradePassback — no assignments for this lesson/class', () => {
  it('returns empty result without calling GC APIs', async () => {
    const admin = fakeAdmin({ assignmentRows: [], attemptRows: [] });

    const result = await gradePassback(admin as never, baseArgs);

    expect(result).toEqual<PassbackResult>({
      pushed: 0,
      skipped_not_linked: 0,
      not_posted_in_classroom: false,
      errors: 0,
    });
    expect(listStudentSubmissions).not.toHaveBeenCalled();
    expect(patchStudentSubmissionDraftGrade).not.toHaveBeenCalled();
  });
});
