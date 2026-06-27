// src/app/api/attempts/chapter-test/submit/__tests__/route.test.ts
// Tests for POST /api/attempts/chapter-test/submit
//
// Node environment (pure HTTP handler test).
// Auth: student-only; IDOR guard on attempt ownership.
// Covers: 401, 400 (bad body), 403 (non-student), 403 (wrong student),
//         409 (double-submit), 200 (sets status=submitted + submitted_at),
//         200 (passes forfeit_reason), 200 (after() triggers grading stub).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock after() from next/server ─────────────────────────────────────────────

const afterCallbacks: Array<() => Promise<void>> = [];
vi.mock('next/server', async (importOriginal) => {
  const mod = await importOriginal<typeof import('next/server')>();
  return {
    ...mod,
    after: (fn: () => Promise<void>) => {
      afterCallbacks.push(fn);
    },
  };
});

// ── Mock gradeChapterAttempt ──────────────────────────────────────────────────

const gradeChapterAttemptMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/chapters/gradeChapterTest', () => ({
  gradeChapterAttempt: (...args: unknown[]) => gradeChapterAttemptMock(...args),
}));

// ── Scriptable per-test state ─────────────────────────────────────────────────

const getUser = vi.fn();

let USER_ROLE: string | null = 'student';
let ATTEMPT: Record<string, unknown> | null;

const attemptUpdates: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: USER_ROLE ? { role: USER_ROLE } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'chapter_test_attempts') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: ATTEMPT, error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            attemptUpdates.push(payload);
            return {
              eq: () => ({
                eq: () => ({
                  then: (resolve: (v: unknown) => unknown) =>
                    Promise.resolve({ data: null, error: null }).then(resolve),
                }),
              }),
            };
          },
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
    },
  }),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeReq(body: unknown = { attemptId: 'att1' }) {
  return new Request('http://localhost/api/attempts/chapter-test/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function load() {
  vi.resetModules();
  return (await import('../route')).POST;
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

const FAKE_ATTEMPT = {
  id: 'att1',
  student_id: 'stu1',
  status: 'in_progress',
  chapter_test_id: 'ct1',
};

// ── beforeEach ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  getUser.mockReset();
  gradeChapterAttemptMock.mockReset().mockResolvedValue(undefined);
  attemptUpdates.length = 0;
  afterCallbacks.length = 0;

  USER_ROLE = 'student';
  ATTEMPT = { ...FAKE_ATTEMPT };

  getUser.mockResolvedValue({ data: { user: { id: 'stu1' } }, error: null });
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('POST /api/attempts/chapter-test/submit', () => {

  // ── 401: unauthenticated ────────────────────────────────────────────────────

  it('401 when no user is authenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/unauthorized/i);
  });

  // ── 403: non-student role ──────────────────────────────────────────────────

  it('403 when caller is a teacher', async () => {
    USER_ROLE = 'teacher';
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(403);
  });

  // ── 400: missing body ──────────────────────────────────────────────────────

  it('400 when attemptId is missing', async () => {
    const POST = await load();
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });

  // ── 404: attempt not found ─────────────────────────────────────────────────

  it('404 when attempt is not found', async () => {
    ATTEMPT = null;
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(404);
  });

  // ── 403: IDOR — wrong student ──────────────────────────────────────────────

  it('403 when attempt belongs to a different student (IDOR guard)', async () => {
    ATTEMPT = { ...FAKE_ATTEMPT, student_id: 'other-student' };
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBeTruthy();
  });

  // ── 409: double-submit ─────────────────────────────────────────────────────

  it('409 when attempt is already submitted', async () => {
    ATTEMPT = { ...FAKE_ATTEMPT, status: 'submitted' };
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/submitted/i);
  });

  it('409 when attempt is already graded', async () => {
    ATTEMPT = { ...FAKE_ATTEMPT, status: 'graded' };
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(409);
  });

  // ── 200: normal submit ─────────────────────────────────────────────────────

  it('200 returns { ok: true, attempt_id } on successful submit', async () => {
    const POST = await load();
    const res = await POST(makeReq({ attemptId: 'att1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.attempt_id).toBe('att1');
  });

  it('200 sets status=submitted and submitted_at on the attempt', async () => {
    const POST = await load();
    await POST(makeReq({ attemptId: 'att1' }));
    expect(attemptUpdates).toHaveLength(1);
    expect(attemptUpdates[0].status).toBe('submitted');
    expect(typeof attemptUpdates[0].submitted_at).toBe('string');
    const ts = new Date(attemptUpdates[0].submitted_at as string).getTime();
    expect(ts).toBeGreaterThan(Date.now() - 5000);
  });

  // ── 200: forfeit_reason is passed through ──────────────────────────────────

  it('200 sets forfeit_reason=time_up when provided', async () => {
    const POST = await load();
    await POST(makeReq({ attemptId: 'att1', forfeit_reason: 'time_up' }));
    expect(attemptUpdates[0].forfeit_reason).toBe('time_up');
  });

  it('200 sets forfeit_reason=closure when provided', async () => {
    const POST = await load();
    await POST(makeReq({ attemptId: 'att1', forfeit_reason: 'closure' }));
    expect(attemptUpdates[0].forfeit_reason).toBe('closure');
  });

  it('200 sets forfeit_reason=null when not provided', async () => {
    const POST = await load();
    await POST(makeReq({ attemptId: 'att1' }));
    expect(attemptUpdates[0].forfeit_reason).toBeNull();
  });

  // ── after() triggers gradeChapterAttempt ──────────────────────────────────

  it('after() callback is registered and invokes gradeChapterAttempt', async () => {
    const POST = await load();
    await POST(makeReq({ attemptId: 'att1' }));
    // after() should have been called with a callback
    expect(afterCallbacks).toHaveLength(1);
    // Run the callback manually to verify it calls grading
    await afterCallbacks[0]();
    expect(gradeChapterAttemptMock).toHaveBeenCalledWith('att1', expect.anything());
  });

  it('after() grading error does not propagate (non-fatal)', async () => {
    gradeChapterAttemptMock.mockRejectedValue(new Error('grading failed'));
    const POST = await load();
    const res = await POST(makeReq({ attemptId: 'att1' }));
    // Route should still return 200
    expect(res.status).toBe(200);
    // Running the after() callback should not throw
    if (afterCallbacks.length > 0) {
      await expect(afterCallbacks[0]()).resolves.not.toThrow();
    }
  });
});
