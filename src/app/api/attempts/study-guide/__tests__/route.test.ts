// src/app/api/attempts/study-guide/__tests__/route.test.ts
// Tests for POST /api/attempts/study-guide
//
// Node environment (no jsdom needed — pure HTTP handler test).
// Mocking pattern: mirrors start/route.test.ts exactly.
//
// Covers:
//   401  unauthenticated
//   400  missing quiz_attempt_id
//   404  attempt not found
//   403  attempt owned by a different student
//   200  cached path — study_guide already present → no LLM call
//   200  generate path — LLM called, cache written, {study_guide, cached:false}
//   200  all-correct path — "got everything right" shortcut, no LLM call
//   200  LLM error (LlmExhaustedError) → graceful {unavailable:true} NOT 500
//   200  no OpenAI key (also throws LlmExhaustedError) → graceful {unavailable:true}

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

// Mock resilientChatCompletion — the route must never make real OpenAI calls.
const mockResilientChatCompletion = vi.fn();
vi.mock('@/lib/ai/openai', () => ({
  resilientChatCompletion: (...args: unknown[]) => mockResilientChatCompletion(...args),
}));

// ── Lazy route import (after mocks are registered) ───────────────────────────

import { POST } from '../route';
import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from '@/lib/supabase/server';
import { LlmExhaustedError } from '@/lib/ai/errors';

// ── Fake data ────────────────────────────────────────────────────────────────

const STUDENT_ID = 'student-uuid-1';
const OTHER_STUDENT_ID = 'student-uuid-other';
const QUIZ_ID = 'quiz-uuid-abc';
const ATTEMPT_ID = 'attempt-uuid-111';
const STUDY_GUIDE_TEXT = 'Here is your revision guide for today.';

const FAKE_ATTEMPT = {
  id: ATTEMPT_ID,
  student_id: STUDENT_ID,
  quiz_id: QUIZ_ID,
  score_pct: 60,
  study_guide: null,
};

const FAKE_ATTEMPT_CACHED = {
  ...FAKE_ATTEMPT,
  study_guide: STUDY_GUIDE_TEXT,
};

// Two wrong responses: one MCQ (is_correct=false), one open (ai_score=0.5 < 0.7)
const FAKE_RESPONSES_WITH_WRONGS = [
  {
    position: 1,
    response_text: 'Paris',
    is_correct: false,
    ai_score: null,
    ai_score_explanation: 'The correct answer is Berlin.',
    question_type_scored: 'mcq',
  },
  {
    position: 2,
    response_text: 'Some partial answer',
    is_correct: null,
    ai_score: 0.5,
    ai_score_explanation: 'Needs more detail.',
    question_type_scored: 'open',
  },
  {
    position: 3,
    response_text: 'Correct text',
    is_correct: true,
    ai_score: 1.0,
    ai_score_explanation: null,
    question_type_scored: 'mcq',
  },
];

// All correct — no wrong answers
const FAKE_RESPONSES_ALL_CORRECT = [
  {
    position: 1,
    response_text: 'Right answer',
    is_correct: true,
    ai_score: 1.0,
    ai_score_explanation: null,
    question_type_scored: 'mcq',
  },
  {
    position: 2,
    response_text: 'Also right',
    is_correct: null,
    ai_score: 0.9,
    ai_score_explanation: null,
    question_type_scored: 'open',
  },
];

const FAKE_QUESTIONS = [
  {
    position: 1,
    question_text: 'What is the capital of Germany?',
    correct_answer: 'Berlin',
    question_type: 'mcq',
  },
  {
    position: 2,
    question_text: 'Explain photosynthesis.',
    correct_answer: 'Photosynthesis is the process by which plants...',
    question_type: 'open',
  },
  {
    position: 3,
    question_text: 'What is 2+2?',
    correct_answer: '4',
    question_type: 'mcq',
  },
];

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

// ── Chain helper (mirrors start/route.test.ts pattern) ───────────────────────

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
  attempt?: unknown;
  attemptError?: unknown;
  responses?: unknown;
  responsesError?: unknown;
  questions?: unknown;
  questionsError?: unknown;
  // Whether the cache-write update should succeed (default true)
  updateSucceeds?: boolean;
}

function makeAdminMock(opts: AdminMockOpts = {}) {
  const {
    attempt = FAKE_ATTEMPT,
    attemptError = null,
    responses = FAKE_RESPONSES_WITH_WRONGS,
    responsesError = null,
    questions = FAKE_QUESTIONS,
    questionsError = null,
    updateSucceeds = true,
  } = opts;

  // Track update calls so tests can assert on them
  const updateEq = vi.fn().mockResolvedValue({ data: null, error: updateSucceeds ? null : { message: 'update failed' } });
  const updateFn = vi.fn().mockReturnValue({ eq: updateEq });

  const callIndex: Record<string, number> = {};

  const admin = {
    _updateFn: updateFn,
    _updateEq: updateEq,
    from: vi.fn((table: string) => {
      callIndex[table] = (callIndex[table] ?? 0) + 1;
      const n = callIndex[table];

      if (table === 'quiz_attempts') {
        if (n === 1) {
          // First call: load attempt
          return makeChain({ data: attempt, error: attemptError });
        }
        // Subsequent calls: cache-write update
        return { update: updateFn, eq: vi.fn().mockReturnThis() };
      }

      if (table === 'quiz_responses') {
        return makeChain({ data: responses, error: responsesError });
      }

      if (table === 'quiz_questions') {
        return makeChain({ data: questions, error: questionsError });
      }

      return makeChain({ data: null });
    }),
  };

  return admin;
}

// ── Request helper ────────────────────────────────────────────────────────────

function makeReq(body: Record<string, unknown> = { quiz_attempt_id: ATTEMPT_ID }): NextRequest {
  return new NextRequest('http://localhost/api/attempts/study-guide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/attempts/study-guide', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockResilientChatCompletion.mockReset();

    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock() as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock() as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    // Default: LLM returns a valid completion
    mockResilientChatCompletion.mockResolvedValue({
      choices: [{ message: { content: STUDY_GUIDE_TEXT } }],
    });
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

  // ── 400: missing quiz_attempt_id ──────────────────────────────────────────────

  it('returns 400 when quiz_attempt_id is missing from request body', async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/quiz_attempt_id/i);
  });

  // ── 404: attempt not found ───────────────────────────────────────────────────

  it('returns 404 when the attempt does not exist', async () => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ attempt: null }) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const res = await POST(makeReq());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  // ── 403: ownership — attempt belongs to a different student ───────────────────

  it('returns 403 when attempt is owned by a different student', async () => {
    const otherAttempt = { ...FAKE_ATTEMPT, student_id: OTHER_STUDENT_ID };
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ attempt: otherAttempt }) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const res = await POST(makeReq());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    // LLM must NOT be called for a forbidden request
    expect(mockResilientChatCompletion).not.toHaveBeenCalled();
  });

  // ── 200: cached path — study_guide already present ────────────────────────────

  it('returns cached study_guide without calling the LLM when study_guide is already stored', async () => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ attempt: FAKE_ATTEMPT_CACHED }) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.study_guide).toBe(STUDY_GUIDE_TEXT);
    expect(body.cached).toBe(true);
    // Key assertion: LLM must NOT be called when cache is warm
    expect(mockResilientChatCompletion).not.toHaveBeenCalled();
  });

  // ── 200: generate path — LLM called, result cached ───────────────────────────

  it('calls the LLM, caches the result, and returns {study_guide, cached:false} for wrong answers', async () => {
    const adminMock = makeAdminMock();
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      adminMock as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    // Response shape
    expect(body.study_guide).toBe(STUDY_GUIDE_TEXT);
    expect(body.cached).toBe(false);
    expect(body.unavailable).toBeUndefined();

    // LLM must be called exactly once
    expect(mockResilientChatCompletion).toHaveBeenCalledOnce();

    // LLM called with correct params
    const [params] = mockResilientChatCompletion.mock.calls[0];
    expect(params.temperature).toBe(0.5);
    expect(params.max_tokens).toBe(400);
    expect(Array.isArray(params.messages)).toBe(true);
    expect(params.messages.length).toBeGreaterThanOrEqual(2);

    // Cache write must occur: admin.from('quiz_attempts').update({study_guide:...})
    expect(adminMock._updateFn).toHaveBeenCalledOnce();
    const updateArg = adminMock._updateFn.mock.calls[0][0];
    expect(updateArg).toHaveProperty('study_guide', STUDY_GUIDE_TEXT);
  });

  // ── 200: all-correct shortcut — "got everything right", no LLM call ───────────

  it('returns the all-correct message without calling LLM when student got everything right', async () => {
    const adminMock = makeAdminMock({ responses: FAKE_RESPONSES_ALL_CORRECT });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      adminMock as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.cached).toBe(false);
    expect(body.study_guide).toBeTruthy();
    // Should contain a positive/encouraging message, NOT call the LLM
    expect(mockResilientChatCompletion).not.toHaveBeenCalled();
    // Cache write must still occur
    expect(adminMock._updateFn).toHaveBeenCalledOnce();
  });

  // ── 200: LLM error → graceful degrade, NOT 500 ───────────────────────────────

  it('returns {unavailable:true} with status 200 (not 500) when the LLM throws LlmExhaustedError', async () => {
    mockResilientChatCompletion.mockRejectedValue(
      new LlmExhaustedError('openai', new Error('rate limited')),
    );

    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.study_guide).toBeNull();
    expect(body.cached).toBe(false);
    expect(body.unavailable).toBe(true);
  });

  // ── 200: no-key / generic error → graceful degrade, NOT 500 ─────────────────

  it('returns {unavailable:true} with status 200 when LLM throws any error (e.g., no API key)', async () => {
    mockResilientChatCompletion.mockRejectedValue(new Error('401 No API key provided'));

    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.study_guide).toBeNull();
    expect(body.cached).toBe(false);
    expect(body.unavailable).toBe(true);
  });

  // ── Prompt content check: must not include score_pct in student-facing output ─

  it('does NOT include score_pct percentage in the LLM user message (coach-posture)', async () => {
    const adminMock = makeAdminMock();
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      adminMock as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    await POST(makeReq());

    expect(mockResilientChatCompletion).toHaveBeenCalledOnce();
    const [params] = mockResilientChatCompletion.mock.calls[0];

    // The user-role message must NOT contain a raw score percentage
    const userMsg = (params.messages as Array<{ role: string; content: string }>)
      .find((m) => m.role === 'user')?.content ?? '';
    // "60%" or "60 %" should not appear
    expect(userMsg).not.toMatch(/\d+\s*%/);
  });
});
