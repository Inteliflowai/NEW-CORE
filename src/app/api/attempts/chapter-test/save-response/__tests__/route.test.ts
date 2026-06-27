// src/app/api/attempts/chapter-test/save-response/__tests__/route.test.ts
// Tests for POST /api/attempts/chapter-test/save-response
//
// Node environment (pure HTTP handler test).
// Auth: student-only; IDOR guard on attempt ownership.
// Covers: 401, 400 (bad body), 403 (wrong student), 409 (already submitted),
//         200 (upserts response), 200 (updates last_active_at).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Scriptable per-test state ─────────────────────────────────────────────────

const getUser = vi.fn();

let USER_ROLE: string | null = 'student';
let ATTEMPT: Record<string, unknown> | null;

// Capture writes for assertions
const upsertCalls: Array<Record<string, unknown>> = [];
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
      if (table === 'chapter_test_responses') {
        return {
          upsert: (payload: Record<string, unknown>) => {
            upsertCalls.push(payload);
            return {
              then: (resolve: (v: unknown) => unknown) =>
                Promise.resolve({ data: null, error: null }).then(resolve),
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

function makeReq(body: unknown = {
  attemptId: 'att1',
  questionId: 'q1',
  response_text: 'My answer',
}) {
  return new Request('http://localhost/api/attempts/chapter-test/save-response', {
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
};

// ── beforeEach ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  getUser.mockReset();
  upsertCalls.length = 0;
  attemptUpdates.length = 0;

  USER_ROLE = 'student';
  ATTEMPT = { ...FAKE_ATTEMPT };

  getUser.mockResolvedValue({ data: { user: { id: 'stu1' } }, error: null });
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('POST /api/attempts/chapter-test/save-response', () => {

  // ── 401: unauthenticated ────────────────────────────────────────────────────

  it('401 when no user is authenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/unauthorized/i);
  });

  // ── 403: non-student role ──────────────────────────────────────────────────

  it('403 when caller is a teacher (not a student)', async () => {
    USER_ROLE = 'teacher';
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(403);
  });

  // ── 400: missing body fields ───────────────────────────────────────────────

  it('400 when attemptId is missing from body', async () => {
    const POST = await load();
    const res = await POST(makeReq({ questionId: 'q1', response_text: 'answer' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });

  it('400 when questionId is missing from body', async () => {
    const POST = await load();
    const res = await POST(makeReq({ attemptId: 'att1', response_text: 'answer' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });

  // ── 403: IDOR — wrong student ──────────────────────────────────────────────

  it('403 when the attempt belongs to a different student (IDOR guard)', async () => {
    ATTEMPT = { ...FAKE_ATTEMPT, student_id: 'other-student' };
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBeTruthy();
  });

  // ── 409: attempt already submitted / graded ────────────────────────────────

  it('409 when attempt status is submitted', async () => {
    ATTEMPT = { ...FAKE_ATTEMPT, status: 'submitted' };
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/submitted/i);
  });

  it('409 when attempt status is graded', async () => {
    ATTEMPT = { ...FAKE_ATTEMPT, status: 'graded' };
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(409);
  });

  // ── 404: attempt not found ─────────────────────────────────────────────────

  it('404 when attempt is not found', async () => {
    ATTEMPT = null;
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(404);
  });

  // ── 200: upserts the response ──────────────────────────────────────────────

  it('200 upserts chapter_test_responses with attempt_id + question_id + response_text', async () => {
    const POST = await load();
    const res = await POST(makeReq({
      attemptId: 'att1',
      questionId: 'q1',
      response_text: 'My answer',
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]).toMatchObject({
      attempt_id: 'att1',
      question_id: 'q1',
      response_text: 'My answer',
    });
  });

  it('200 upserts with response_payload when provided', async () => {
    const POST = await load();
    const res = await POST(makeReq({
      attemptId: 'att1',
      questionId: 'q2',
      response_payload: { choice: 'A' },
    }));
    expect(res.status).toBe(200);
    expect(upsertCalls[0]).toMatchObject({
      attempt_id: 'att1',
      question_id: 'q2',
      response_payload: { choice: 'A' },
    });
  });

  it('200 upsert defaults response_payload to {} when not provided', async () => {
    const POST = await load();
    await POST(makeReq({ attemptId: 'att1', questionId: 'q1', response_text: 'hello' }));
    expect(upsertCalls[0].response_payload).toEqual({});
  });

  // ── 200: updates last_active_at ───────────────────────────────────────────

  it('200 updates chapter_test_attempts.last_active_at after upsert', async () => {
    const POST = await load();
    await POST(makeReq());
    expect(attemptUpdates).toHaveLength(1);
    expect(typeof attemptUpdates[0].last_active_at).toBe('string');
    // Should be a recent ISO timestamp
    const ts = new Date(attemptUpdates[0].last_active_at as string).getTime();
    expect(ts).toBeGreaterThan(Date.now() - 5000);
  });

  // ── 200: idempotent — second call with same question_id works fine ─────────

  it('200 is idempotent — calling twice with same questionId succeeds both times', async () => {
    const POST = await load();
    const res1 = await POST(makeReq({ attemptId: 'att1', questionId: 'q1', response_text: 'First' }));
    expect(res1.status).toBe(200);
    const res2 = await POST(makeReq({ attemptId: 'att1', questionId: 'q1', response_text: 'Updated' }));
    expect(res2.status).toBe(200);
    // Both upsert calls recorded
    expect(upsertCalls).toHaveLength(2);
  });
});
