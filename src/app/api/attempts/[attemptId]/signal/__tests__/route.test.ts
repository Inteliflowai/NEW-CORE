// src/app/api/attempts/[attemptId]/signal/__tests__/route.test.ts
// Tests for POST /api/attempts/[attemptId]/signal
//
// Node environment (pure HTTP handler — no jsdom needed).
// Mocking pattern mirrors src/app/api/attempts/start/__tests__/route.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Module mocks (hoisted before any import of the route) ────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

// ── Lazy route import (after mocks are registered) ───────────────────────────

import { POST } from '../route';
import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from '@/lib/supabase/server';

// ── Fake data ────────────────────────────────────────────────────────────────

const STUDENT_ID = 'student-uuid-1';
const ATTEMPT_ID = 'attempt-uuid-111';
const QUESTION_ID = 'question-uuid-aaa';

const FAKE_ATTEMPT = {
  id: ATTEMPT_ID,
  student_id: STUDENT_ID,
  quiz_id: 'quiz-uuid-abc',
  is_complete: false,
};

const FAKE_RESPONSE_ROW = {
  attempt_id: ATTEMPT_ID,
  question_id: QUESTION_ID,
  position: 1,
  response_text: 'The answer is 42',
  response_time_ms: 5000,
  hesitation_ms: 200,
  answer_changes: 1,
  navigation_backs: 0,
  pause_count: 2,
  total_pause_ms: 800,
  word_count: 4,
  focus_loss_count: 0,
  paste_count: 0,
  hints_used: 1,
  question_type_scored: 'open',
};

// ── Helper: build server client mock ─────────────────────────────────────────

function makeServerMock(userId: string | null = STUDENT_ID) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  };
}

// ── Chain builder ─────────────────────────────────────────────────────────────

interface ChainOpts {
  data: unknown;
  error?: unknown;
}

function makeChain(opts: ChainOpts) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'not', 'update', 'insert', 'upsert']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  const resolved = Promise.resolve({ data: opts.data, error: opts.error ?? null });
  chain['single'] = vi.fn().mockResolvedValue({ data: opts.data, error: opts.error ?? null });
  chain['maybeSingle'] = vi.fn().mockResolvedValue({ data: opts.data, error: opts.error ?? null });
  chain['then'] = (resolve: (v: unknown) => unknown) => resolved.then(resolve);
  return chain;
}

// ── Admin mock builder ────────────────────────────────────────────────────────

interface AdminMockOpts {
  attempt?: unknown;
  attemptError?: unknown;
  /** upsert mock — defaults to a spy that resolves ok */
  upsertFn?: ReturnType<typeof vi.fn>;
  /** update mock — defaults to a spy that resolves ok */
  updateFn?: ReturnType<typeof vi.fn>;
}

function makeAdminMock(opts: AdminMockOpts = {}) {
  const {
    attempt = FAKE_ATTEMPT,
    attemptError = null,
  } = opts;

  // Shared upsert spy so tests can inspect calls
  const upsertSpy = opts.upsertFn ?? vi.fn().mockResolvedValue({ data: [FAKE_RESPONSE_ROW], error: null });
  const updateSpy = opts.updateFn ?? vi.fn().mockReturnValue(makeChain({ data: null }));

  return {
    from: vi.fn((table: string) => {
      if (table === 'quiz_attempts') {
        // Return a chain whose .single() gives the attempt.
        // Also expose .update() as the updateSpy for last_active_at assertions.
        const chain = makeChain({ data: attempt, error: attemptError });
        // Override update so callers get the spy
        chain['update'] = updateSpy;
        return chain;
      }

      if (table === 'quiz_responses') {
        // Return a chain whose .upsert() is the spy
        const chain = makeChain({ data: null });
        chain['upsert'] = upsertSpy;
        return chain;
      }

      return makeChain({ data: null });
    }),
    upsertSpy,
    updateSpy,
  };
}

// ── Request helper ────────────────────────────────────────────────────────────

function makeReq(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest(
    `http://localhost/api/attempts/${ATTEMPT_ID}/signal`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

function makeParams(attemptId: string = ATTEMPT_ID): { params: Promise<{ attemptId: string }> } {
  return { params: Promise.resolve({ attemptId }) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/attempts/[attemptId]/signal', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock() as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock() as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
  });

  // ── 401: unauthenticated ─────────────────────────────────────────────────────

  it('returns 401 when user is not authenticated', async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock(null) as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>,
    );
    const res = await POST(makeReq(), makeParams());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  // ── 404: attempt not owned by student ────────────────────────────────────────

  it('returns 404 when attempt is not found for this student', async () => {
    const adminMock = makeAdminMock({ attempt: null });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      adminMock as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const res = await POST(makeReq(), makeParams());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  // ── 400: attempt already complete ────────────────────────────────────────────

  it('returns 400 when attempt is already complete', async () => {
    const adminMock = makeAdminMock({ attempt: { ...FAKE_ATTEMPT, is_complete: true } });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      adminMock as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const res = await POST(makeReq(), makeParams());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  // ── Heartbeat-only: no responses in body ─────────────────────────────────────

  it('bumps last_active_at and returns heartbeat_only:true when responses array is empty', async () => {
    const updateSpy = vi.fn().mockReturnValue(makeChain({ data: null }));
    const upsertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    const adminMock = makeAdminMock({ updateFn: updateSpy, upsertFn: upsertSpy });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      adminMock as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const res = await POST(makeReq({ responses: [] }), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.heartbeat_only).toBe(true);

    // last_active_at bump MUST happen
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ last_active_at: expect.any(String) }),
    );

    // quiz_responses upsert must NOT happen
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('bumps last_active_at and returns heartbeat_only:true when body has no responses key', async () => {
    const updateSpy = vi.fn().mockReturnValue(makeChain({ data: null }));
    const upsertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    const adminMock = makeAdminMock({ updateFn: updateSpy, upsertFn: upsertSpy });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      adminMock as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    // Pure heartbeat — no responses key at all
    const res = await POST(makeReq({}), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.heartbeat_only).toBe(true);

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ last_active_at: expect.any(String) }),
    );
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  // ── Full path: upserts quiz_responses with behavioral columns ─────────────────

  it('upserts quiz_responses with behavioral columns on onConflict attempt_id,question_id', async () => {
    const updateSpy = vi.fn().mockReturnValue(makeChain({ data: null }));
    const upsertSpy = vi.fn().mockResolvedValue({ data: [FAKE_RESPONSE_ROW], error: null });
    const adminMock = makeAdminMock({ updateFn: updateSpy, upsertFn: upsertSpy });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      adminMock as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const responses = [
      {
        question_id: QUESTION_ID,
        position: 1,
        response_text: 'The answer is 42',
        response_time_ms: 5000,
        hesitation_ms: 200,
        answer_changes: 1,
        navigation_backs: 0,
        pause_count: 2,
        total_pause_ms: 800,
        word_count: 4,
        focus_loss_count: 0,
        paste_count: 0,
        hints_used: 1,
        question_type_scored: 'open',
      },
    ];

    const res = await POST(makeReq({ responses }), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // upsert must have been called
    expect(upsertSpy).toHaveBeenCalledOnce();

    // Inspect the upsert payload
    const upsertArg = upsertSpy.mock.calls[0][0];
    // Array upsert
    const rows = Array.isArray(upsertArg) ? upsertArg : [upsertArg];
    expect(rows).toHaveLength(1);
    const row = rows[0];

    expect(row.attempt_id).toBe(ATTEMPT_ID);
    expect(row.question_id).toBe(QUESTION_ID);
    expect(row.response_text).toBe('The answer is 42');
    // Behavioral columns
    expect(row.response_time_ms).toBe(5000);
    expect(row.hesitation_ms).toBe(200);
    expect(row.answer_changes).toBe(1);
    expect(row.navigation_backs).toBe(0);
    expect(row.pause_count).toBe(2);
    expect(row.total_pause_ms).toBe(800);
    expect(row.word_count).toBe(4);
    expect(row.focus_loss_count).toBe(0);
    expect(row.paste_count).toBe(0);
    expect(row.hints_used).toBe(1);
    expect(row.question_type_scored).toBe('open');

    // onConflict must be 'attempt_id,question_id'
    const upsertOptions = upsertSpy.mock.calls[0][1];
    expect(upsertOptions).toMatchObject({ onConflict: 'attempt_id,question_id' });

    // last_active_at bump also happens
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ last_active_at: expect.any(String) }),
    );
  });

  // ── sessionAggregates: written to quiz_attempts.session_aggregates ────────────

  it('writes sessionAggregates to quiz_attempts.session_aggregates when present', async () => {
    const updateSpy = vi.fn().mockReturnValue(makeChain({ data: null }));
    const adminMock = makeAdminMock({ updateFn: updateSpy });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      adminMock as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const sessionAggregates = {
      total_time_ms: 120000,
      total_pauses: 5,
      avg_hesitation_ms: 300,
    };

    const res = await POST(makeReq({ sessionAggregates }), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.heartbeat_only).toBe(true); // no responses → heartbeat only

    // update must have been called with session_aggregates
    // (may be combined in one call or two separate calls)
    const allUpdateCalls = updateSpy.mock.calls.flat();
    const sessionAggWritten = allUpdateCalls.some(
      (arg: unknown) =>
        typeof arg === 'object' &&
        arg !== null &&
        'session_aggregates' in (arg as Record<string, unknown>),
    );
    expect(sessionAggWritten).toBe(true);
  });

  // ── quiz_responses upsert failure → 500 ──────────────────────────────────────

  it('returns 500 when quiz_responses upsert returns a DB error', async () => {
    const upsertSpy = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'duplicate key value violates unique constraint', code: '23505' },
    });
    const adminMock = makeAdminMock({ upsertFn: upsertSpy });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      adminMock as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const responses = [
      {
        question_id: QUESTION_ID,
        position: 1,
        response_text: 'answer',
        response_time_ms: 1000,
        hesitation_ms: 0,
        answer_changes: 0,
        navigation_backs: 0,
        pause_count: 0,
        total_pause_ms: 0,
        word_count: 1,
        focus_loss_count: 0,
        paste_count: 0,
        hints_used: 0,
        question_type_scored: 'mcq',
      },
    ];

    const res = await POST(makeReq({ responses }), makeParams());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBeUndefined();
    expect(body.error).toBeTruthy();
  });

  it('writes sessionAggregates alongside a response upsert', async () => {
    const updateSpy = vi.fn().mockReturnValue(makeChain({ data: null }));
    const upsertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    const adminMock = makeAdminMock({ updateFn: updateSpy, upsertFn: upsertSpy });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      adminMock as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const sessionAggregates = { total_time_ms: 60000 };
    const responses = [
      {
        question_id: QUESTION_ID,
        position: 1,
        response_text: 'answer',
        response_time_ms: 3000,
        hesitation_ms: 100,
        answer_changes: 0,
        navigation_backs: 0,
        pause_count: 1,
        total_pause_ms: 500,
        word_count: 1,
        focus_loss_count: 0,
        paste_count: 0,
        hints_used: 0,
        question_type_scored: 'mcq',
      },
    ];

    const res = await POST(makeReq({ responses, sessionAggregates }), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Has responses so NOT heartbeat_only
    expect(body.heartbeat_only).toBeUndefined();

    // Both upsert and session_aggregates write must happen
    expect(upsertSpy).toHaveBeenCalledOnce();
    const allUpdateCalls = updateSpy.mock.calls.flat();
    const sessionAggWritten = allUpdateCalls.some(
      (arg: unknown) =>
        typeof arg === 'object' &&
        arg !== null &&
        'session_aggregates' in (arg as Record<string, unknown>),
    );
    expect(sessionAggWritten).toBe(true);
  });
});
