// src/app/api/attempts/start/__tests__/route.test.ts
// Tests for POST /api/attempts/start
//
// Node environment (no jsdom needed — pure HTTP handler test).
// Mocking pattern: mirrors student-quiz tests.
// Both supabase clients are mocked; classifyAttemptState and forfeitAttempt
// are mocked so we can control state decisions and forfeit calls independently.

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

// classifyAttemptState is mocked so tests control the state outcome.
const mockClassifyAttemptState = vi.fn();
vi.mock('@/lib/student/quizAttemptState', () => ({
  classifyAttemptState: (...args: unknown[]) => mockClassifyAttemptState(...args),
  CLOSURE_FORFEIT_MINUTES: 5,
  RESUME_BANNER_THRESHOLD_SECONDS: 30,
}));

// forfeitAttempt is mocked — we verify it is called with the right args
// and we control what it returns.
const mockForfeitAttempt = vi.fn();
vi.mock('@/lib/quiz/forfeitAttempt', () => ({
  forfeitAttempt: (...args: unknown[]) => mockForfeitAttempt(...args),
}));

// ── Lazy route import (after mocks are registered) ───────────────────────────

import { POST } from '../route';
import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from '@/lib/supabase/server';

// ── Fake data ────────────────────────────────────────────────────────────────

const STUDENT_ID = 'student-uuid-1';
const QUIZ_ID = 'quiz-uuid-abc';
const CLASS_ID = 'class-uuid-xyz';
const ATTEMPT_ID = 'attempt-uuid-111';

const FAKE_QUIZ = { id: QUIZ_ID, class_id: CLASS_ID, status: 'published' };
const FAKE_ENROLLMENT = { id: 'enroll-uuid-1' };

const FAKE_EXISTING_ATTEMPT = {
  id: ATTEMPT_ID,
  is_complete: false,
  started_at: '2026-06-20T09:00:00Z',
  last_active_at: '2026-06-20T09:05:00Z',
  forfeit_reason: null,
  score_pct: null,
  mastery_band: null,
};

const FAKE_NEW_ATTEMPT = {
  id: 'new-attempt-uuid-999',
  quiz_id: QUIZ_ID,
  student_id: STUDENT_ID,
  started_at: '2026-06-20T10:00:00Z',
  last_active_at: '2026-06-20T10:00:00Z',
  is_complete: false,
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

// ── Chain helper (mirrors student-quiz test pattern) ─────────────────────────

interface ChainOpts {
  data: unknown;
  error?: unknown;
}

function makeChain(opts: ChainOpts) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'not', 'update', 'insert']) {
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
  quiz?: unknown;
  quizError?: unknown;
  enrollment?: unknown;
  enrollmentError?: unknown;
  existingAttempt?: unknown;
  existingAttemptError?: unknown;
  newAttempt?: unknown;
  newAttemptError?: unknown;
}

function makeAdminMock(opts: AdminMockOpts = {}) {
  const {
    quiz = FAKE_QUIZ,
    quizError = null,
    enrollment = FAKE_ENROLLMENT,
    enrollmentError = null,
    existingAttempt = null,
    existingAttemptError = null,
    newAttempt = FAKE_NEW_ATTEMPT,
    newAttemptError = null,
  } = opts;

  const callIndex: Record<string, number> = {};

  return {
    from: vi.fn((table: string) => {
      callIndex[table] = (callIndex[table] ?? 0) + 1;
      const n = callIndex[table];

      if (table === 'quizzes') {
        return makeChain({ data: quiz, error: quizError });
      }

      if (table === 'enrollments') {
        return makeChain({ data: enrollment, error: enrollmentError });
      }

      if (table === 'quiz_attempts') {
        if (n === 1) {
          // First call: maybeSingle for existing attempt
          return makeChain({ data: existingAttempt, error: existingAttemptError });
        }
        // Second call: insert new attempt (returns chain with select().single())
        const insertChain: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'not', 'update', 'insert']) {
          insertChain[m] = vi.fn().mockReturnValue(insertChain);
        }
        const resolved = Promise.resolve({ data: newAttempt, error: newAttemptError });
        insertChain['single'] = vi.fn().mockResolvedValue({ data: newAttempt, error: newAttemptError });
        insertChain['maybeSingle'] = vi.fn().mockResolvedValue({ data: newAttempt, error: newAttemptError });
        insertChain['then'] = (resolve: (v: unknown) => unknown) => resolved.then(resolve);
        return insertChain;
      }

      // quiz_attempts update (for fresh state: stamp started_at)
      // handled inside the existing attempt branch chain returned from n===1

      // audit_logs insert — best-effort, not tested in detail
      if (table === 'audit_logs') {
        return makeChain({ data: null });
      }

      return makeChain({ data: null });
    }),
  };
}

// ── Request helper ────────────────────────────────────────────────────────────

function makeReq(body: Record<string, unknown> = { quiz_id: QUIZ_ID }): NextRequest {
  return new NextRequest('http://localhost/api/attempts/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/attempts/start', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockClassifyAttemptState.mockReset();
    mockForfeitAttempt.mockReset();

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
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  // ── 400: missing quiz_id ─────────────────────────────────────────────────────

  it('returns 400 when quiz_id is missing from request body', async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/quiz_id/i);
  });

  // ── 404: quiz not published ──────────────────────────────────────────────────

  it('returns 404 when quiz does not exist or is not published', async () => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ quiz: null }) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const res = await POST(makeReq());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  // ── 403: not enrolled ────────────────────────────────────────────────────────

  it('returns 403 when student is not enrolled in the quiz class', async () => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ enrollment: null }) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const res = await POST(makeReq());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  // ── 400: already complete ────────────────────────────────────────────────────

  it('returns 400 when a completed attempt already exists for this quiz', async () => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({
        existingAttempt: { ...FAKE_EXISTING_ATTEMPT, is_complete: true, score_pct: 85 },
      }) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const res = await POST(makeReq());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already.complet/i);
  });

  // ── 410: closure forfeit branch ──────────────────────────────────────────────

  it('returns 410 with forfeit body when attempt classifies as closure_forfeit', async () => {
    mockClassifyAttemptState.mockReturnValue('closure_forfeit');
    mockForfeitAttempt.mockResolvedValue({ ok: true, scorePct: 60, masteryBand: 'grade_level' });

    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ existingAttempt: FAKE_EXISTING_ATTEMPT }) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const res = await POST(makeReq());
    expect(res.status).toBe(410);

    const body = await res.json();
    expect(body.attempt_id).toBe(ATTEMPT_ID);
    expect(body.forfeited).toBe(true);
    expect(body.forfeit_reason).toBe('closure');
    expect(body.score_pct).toBe(60);
    expect(body.mastery_band).toBe('grade_level');

    // forfeitAttempt must be called with the correct args
    expect(mockForfeitAttempt).toHaveBeenCalledOnce();
    expect(mockForfeitAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: ATTEMPT_ID,
        reason: 'closure',
      }),
    );
  });

  // ── 410: time_up forfeit branch ──────────────────────────────────────────────

  it('returns 410 with forfeit body when attempt classifies as time_up_forfeit', async () => {
    mockClassifyAttemptState.mockReturnValue('time_up_forfeit');
    mockForfeitAttempt.mockResolvedValue({ ok: true, scorePct: 40, masteryBand: 'reteach' });

    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ existingAttempt: FAKE_EXISTING_ATTEMPT }) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const res = await POST(makeReq());
    expect(res.status).toBe(410);

    const body = await res.json();
    expect(body.attempt_id).toBe(ATTEMPT_ID);
    expect(body.forfeited).toBe(true);
    expect(body.forfeit_reason).toBe('time_up');
    expect(body.score_pct).toBe(40);
    expect(body.mastery_band).toBe('reteach');

    expect(mockForfeitAttempt).toHaveBeenCalledOnce();
    expect(mockForfeitAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: ATTEMPT_ID,
        reason: 'time_up',
      }),
    );
  });

  // ── active branch: returns state fields ─────────────────────────────────────

  it('returns 200 with state fields when attempt is active', async () => {
    mockClassifyAttemptState.mockReturnValue('active');

    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ existingAttempt: FAKE_EXISTING_ATTEMPT }) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const res = await POST(makeReq());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.attempt_id).toBe(ATTEMPT_ID);
    expect(body.started_at).toBe(FAKE_EXISTING_ATTEMPT.started_at);
    expect(body.state).toBe('active');
    expect(body).toHaveProperty('closure_forfeit_minutes', 5);
    expect(body).toHaveProperty('resume_banner_threshold_seconds', 30);
    // active: no gap → resumed_after_seconds should be null
    expect(body.resumed_after_seconds).toBeNull();

    // forfeitAttempt should NOT be called
    expect(mockForfeitAttempt).not.toHaveBeenCalled();
  });

  // ── resuming_after_gap branch: returns gap seconds ───────────────────────────

  it('returns 200 with resumed_after_seconds when attempt is resuming_after_gap', async () => {
    mockClassifyAttemptState.mockReturnValue('resuming_after_gap');

    // last_active_at is 2 minutes ago so gap ~120 sec
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const gappedAttempt = {
      ...FAKE_EXISTING_ATTEMPT,
      last_active_at: twoMinutesAgo,
    };

    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ existingAttempt: gappedAttempt }) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const res = await POST(makeReq());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.attempt_id).toBe(ATTEMPT_ID);
    expect(body.state).toBe('resuming_after_gap');
    expect(typeof body.resumed_after_seconds).toBe('number');
    // ~120 seconds; allow ±5 for timing
    expect(body.resumed_after_seconds).toBeGreaterThan(115);
    expect(body.resumed_after_seconds).toBeLessThan(125);
    expect(body.closure_forfeit_minutes).toBe(5);
    expect(body.resume_banner_threshold_seconds).toBe(30);
  });

  // ── fresh branch: stamps started_at and returns state:'active' ──────────────

  it('stamps started_at and returns state:active when existing attempt is fresh', async () => {
    mockClassifyAttemptState.mockReturnValue('fresh');

    const freshAttempt = {
      ...FAKE_EXISTING_ATTEMPT,
      started_at: null,
      last_active_at: null,
    };

    // Need a special admin mock where quiz_attempts n===1 returns fresh attempt
    // and the update path on quiz_attempts works correctly.
    const updateChain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'update', 'insert']) {
      updateChain[m] = vi.fn().mockReturnValue(updateChain);
    }
    const updateResolved = Promise.resolve({ data: null, error: null });
    updateChain['single'] = vi.fn().mockResolvedValue({ data: null, error: null });
    updateChain['maybeSingle'] = vi.fn().mockResolvedValue({ data: freshAttempt, error: null });
    updateChain['then'] = (resolve: (v: unknown) => unknown) => updateResolved.then(resolve);

    let quizAttemptsCallCount = 0;
    const freshAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'quizzes') return makeChain({ data: FAKE_QUIZ });
        if (table === 'enrollments') return makeChain({ data: FAKE_ENROLLMENT });
        if (table === 'quiz_attempts') {
          quizAttemptsCallCount++;
          // First call: existing attempt lookup (maybeSingle returns fresh)
          if (quizAttemptsCallCount === 1) return makeChain({ data: freshAttempt });
          // Second call: update to stamp started_at
          return updateChain;
        }
        if (table === 'audit_logs') return makeChain({ data: null });
        return makeChain({ data: null });
      }),
    };

    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      freshAdmin as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const res = await POST(makeReq());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.attempt_id).toBe(ATTEMPT_ID);
    expect(body.state).toBe('fresh');
    // started_at should be a stamped ISO string (non-null after update)
    // The route sets effectiveStartedAt to the nowIso it writes
    expect(typeof body.started_at).toBe('string');
    expect(body.started_at).not.toBeNull();
  });

  // ── new attempt insert path ──────────────────────────────────────────────────

  it('inserts a new attempt and returns attempt_id + started_at + state:active when no existing attempt', async () => {
    // existingAttempt: null → insert new
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ existingAttempt: null }) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const res = await POST(makeReq());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.attempt_id).toBe(FAKE_NEW_ATTEMPT.id);
    expect(body.started_at).toBe(FAKE_NEW_ATTEMPT.started_at);
    expect(body.state).toBe('active');

    // classifyAttemptState should NOT be called (no existing attempt to classify)
    expect(mockClassifyAttemptState).not.toHaveBeenCalled();
    // forfeitAttempt should NOT be called
    expect(mockForfeitAttempt).not.toHaveBeenCalled();
  });

  // ── forfeit fails gracefully (500 from forfeitAttempt) ──────────────────────

  it('returns 500 when forfeitAttempt returns ok:false', async () => {
    mockClassifyAttemptState.mockReturnValue('closure_forfeit');
    mockForfeitAttempt.mockResolvedValue({ ok: false, error: 'attempt not found: ...' });

    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ existingAttempt: FAKE_EXISTING_ATTEMPT }) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const res = await POST(makeReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});
