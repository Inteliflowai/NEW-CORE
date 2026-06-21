// src/app/api/attempts/quiz-history/__tests__/route.test.ts
// Tests for GET + POST /api/attempts/quiz-history
//
// Node environment (no jsdom needed — pure HTTP handler test).
// Mocking pattern mirrors src/app/api/attempts/start/__tests__/route.test.ts.
//
// Option-D discipline: every GET test explicitly asserts that score_pct and
// mastery_band are ABSENT from quizzes[] items; every POST test asserts that no
// overall score key is present in the response.

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

import { GET, POST } from '../route';
import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from '@/lib/supabase/server';

// ── Fake data ─────────────────────────────────────────────────────────────────

const STUDENT_ID = 'student-uuid-hist-1';
const CLASS_ID_A = 'class-uuid-aaa';
const CLASS_ID_B = 'class-uuid-bbb';
const QUIZ_ID_1 = 'quiz-uuid-111';
const QUIZ_ID_2 = 'quiz-uuid-222';
const ATTEMPT_ID_1 = 'attempt-uuid-aaa';
const ATTEMPT_ID_2 = 'attempt-uuid-bbb';
const QUESTION_ID_1 = 'question-uuid-q1';
const QUESTION_ID_2 = 'question-uuid-q2';

const FAKE_ENROLLMENTS = [
  { class_id: CLASS_ID_A },
  { class_id: CLASS_ID_B },
];

const FAKE_CLASSES = [
  { id: CLASS_ID_A, name: 'Math 101' },
  { id: CLASS_ID_B, name: 'Science 202' },
];

const FAKE_ATTEMPTS = [
  {
    id: ATTEMPT_ID_1,
    quiz_id: QUIZ_ID_1,
    submitted_at: '2026-06-18T10:00:00Z',
    is_complete: true,
    // These must NEVER reach the client payload:
    score_pct: 85,
    mastery_band: 'grade_level',
  },
  {
    id: ATTEMPT_ID_2,
    quiz_id: QUIZ_ID_2,
    submitted_at: '2026-06-19T14:00:00Z',
    is_complete: true,
    score_pct: 92,
    mastery_band: 'advanced',
  },
];

const FAKE_QUIZZES_DB = [
  { id: QUIZ_ID_1, title: 'Chapter 1 Quiz', class_id: CLASS_ID_A },
  { id: QUIZ_ID_2, title: 'Chapter 2 Quiz', class_id: CLASS_ID_B },
];

const FAKE_ATTEMPT_ROW = {
  id: ATTEMPT_ID_1,
  quiz_id: QUIZ_ID_1,
  student_id: STUDENT_ID,
  // These must NOT appear in POST response:
  score_pct: 85,
  mastery_band: 'grade_level',
};

const FAKE_QUESTIONS = [
  {
    id: QUESTION_ID_1,
    position: 1,
    question_type: 'mcq',
    question_text: 'What is 2+2?',
    correct_answer: '4',
    choices: ['2', '3', '4', '5'],
    rubric: null,
  },
  {
    id: QUESTION_ID_2,
    position: 2,
    question_type: 'open',
    question_text: 'Explain photosynthesis.',
    correct_answer: null,
    choices: null,
    rubric: 'Must mention chlorophyll.',
  },
];

const FAKE_RESPONSES = [
  {
    question_id: QUESTION_ID_1,
    position: 1,
    response_text: '4',
    is_correct: true,
    ai_score: null,
    ai_score_explanation: null,
  },
  {
    question_id: QUESTION_ID_2,
    position: 2,
    response_text: 'Plants use sunlight to make food.',
    is_correct: null,
    ai_score: 3,
    ai_score_explanation: 'Good but missing chlorophyll mention.',
  },
];

// ── Chain helper (mirrors start/__tests__/route.test.ts) ─────────────────────

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

// ── Server (auth) mock helper ─────────────────────────────────────────────────

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

// ── Admin mock for GET ────────────────────────────────────────────────────────

interface GetAdminOpts {
  enrollments?: unknown;
  classes?: unknown;
  attempts?: unknown;
  quizzes?: unknown;
}

function makeGetAdminMock(opts: GetAdminOpts = {}) {
  const {
    enrollments = FAKE_ENROLLMENTS,
    classes = FAKE_CLASSES,
    attempts = FAKE_ATTEMPTS,
    quizzes = FAKE_QUIZZES_DB,
  } = opts;

  return {
    from: vi.fn((table: string) => {
      if (table === 'enrollments') return makeChain({ data: enrollments });
      if (table === 'classes') return makeChain({ data: classes });
      if (table === 'quiz_attempts') return makeChain({ data: attempts });
      if (table === 'quizzes') return makeChain({ data: quizzes });
      return makeChain({ data: null });
    }),
  };
}

// ── Admin mock for POST ───────────────────────────────────────────────────────

interface PostAdminOpts {
  attempt?: unknown;
  questions?: unknown;
  responses?: unknown;
}

function makePostAdminMock(opts: PostAdminOpts = {}) {
  const {
    attempt = FAKE_ATTEMPT_ROW,
    questions = FAKE_QUESTIONS,
    responses = FAKE_RESPONSES,
  } = opts;

  return {
    from: vi.fn((table: string) => {
      if (table === 'quiz_attempts') return makeChain({ data: attempt });
      if (table === 'quiz_questions') return makeChain({ data: questions });
      if (table === 'quiz_responses') return makeChain({ data: responses });
      return makeChain({ data: null });
    }),
  };
}

// ── Request helpers ───────────────────────────────────────────────────────────

function makeGetReq(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost/api/attempts/quiz-history');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url.toString(), { method: 'GET' });
}

function makePostReq(body: Record<string, unknown> = { attempt_id: ATTEMPT_ID_1 }): NextRequest {
  return new NextRequest('http://localhost/api/attempts/quiz-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/attempts/quiz-history', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock() as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeGetAdminMock() as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
  });

  it('returns 401 when user is not authenticated', async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock(null) as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>,
    );
    const res = await GET(makeGetReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('returns empty lists when student has no enrollments', async () => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeGetAdminMock({ enrollments: [] }) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const res = await GET(makeGetReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.classes).toEqual([]);
    expect(body.quizzes).toEqual([]);
  });

  it('returns completed quizzes with correct shape — and NEVER score_pct or mastery_band', async () => {
    const res = await GET(makeGetReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    // Shape assertions
    expect(Array.isArray(body.classes)).toBe(true);
    expect(Array.isArray(body.quizzes)).toBe(true);
    expect(body.quizzes.length).toBeGreaterThan(0);

    // Option-D: explicitly assert the banned keys are absent from EVERY item
    for (const item of body.quizzes) {
      expect(item).not.toHaveProperty('score_pct');
      expect(item).not.toHaveProperty('mastery_band');
      // Verify the expected keys are present
      expect(item).toHaveProperty('attempt_id');
      expect(item).toHaveProperty('quiz_id');
      expect(item).toHaveProperty('quiz_title');
      expect(item).toHaveProperty('class_id');
      expect(item).toHaveProperty('class_name');
      expect(item).toHaveProperty('submitted_at');
    }
  });

  it('filters quizzes by class_id when ?class_id= is provided', async () => {
    // Simulate what Supabase returns after applying .in('class_id', [CLASS_ID_A]):
    // only the quiz that belongs to CLASS_ID_A is returned by the DB.
    const filteredQuizzes = [FAKE_QUIZZES_DB[0]]; // quiz 1 → CLASS_ID_A only
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeGetAdminMock({ quizzes: filteredQuizzes }) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const res = await GET(makeGetReq({ class_id: CLASS_ID_A }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // All returned quizzes must belong to the filtered class
    expect(body.quizzes.length).toBeGreaterThan(0);
    for (const item of body.quizzes) {
      expect(item.class_id).toBe(CLASS_ID_A);
    }
    // Confirm Option-D discipline holds in filtered results too
    for (const item of body.quizzes) {
      expect(item).not.toHaveProperty('score_pct');
      expect(item).not.toHaveProperty('mastery_band');
    }
  });

  it('returns empty quizzes when student has no completed attempts', async () => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeGetAdminMock({ attempts: [] }) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const res = await GET(makeGetReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quizzes).toEqual([]);
  });
});

describe('POST /api/attempts/quiz-history', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock() as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makePostAdminMock() as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
  });

  it('returns 401 when user is not authenticated', async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock(null) as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>,
    );
    const res = await POST(makePostReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('returns 400 when attempt_id is missing from request body', async () => {
    const res = await POST(makePostReq({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it('returns 404 when attempt does not belong to the authenticated student', async () => {
    // Attempt lookup returns null → ownership gate fires
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makePostAdminMock({ attempt: null }) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const res = await POST(makePostReq());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it('returns per-question review with correct shape for an owned attempt', async () => {
    const res = await POST(makePostReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.review)).toBe(true);
    expect(body.review.length).toBe(2);

    const [q1, q2] = body.review;

    // Question 1 (MCQ)
    expect(q1.position).toBe(1);
    expect(q1.question_type).toBe('mcq');
    expect(q1.question_text).toBe('What is 2+2?');
    expect(q1.correct_answer).toBe('4');
    expect(q1.choices).toEqual(['2', '3', '4', '5']);
    expect(q1.rubric).toBeNull();
    expect(q1.student_answer).toBe('4');
    expect(q1.is_correct).toBe(true);
    expect(q1.ai_score).toBeNull();
    expect(q1.explanation).toBe('');

    // Question 2 (OEQ with ai_score)
    expect(q2.position).toBe(2);
    expect(q2.question_type).toBe('open');
    expect(q2.correct_answer).toBeNull();
    expect(q2.student_answer).toBe('Plants use sunlight to make food.');
    expect(q2.is_correct).toBeNull();
    expect(q2.ai_score).toBe(3);
    expect(q2.explanation).toBe('Good but missing chlorophyll mention.');
  });

  it('NEVER includes overall score_pct or mastery_band in the POST response', async () => {
    const res = await POST(makePostReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    // Option-D: no overall score at the top level
    expect(body).not.toHaveProperty('score_pct');
    expect(body).not.toHaveProperty('mastery_band');

    // Option-D: no overall score nested inside review items either
    for (const item of body.review) {
      expect(item).not.toHaveProperty('score_pct');
      expect(item).not.toHaveProperty('mastery_band');
    }
  });

  it('handles a question with no recorded response gracefully', async () => {
    // Only one response for a two-question quiz
    const partialResponses = [FAKE_RESPONSES[0]];
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makePostAdminMock({ responses: partialResponses }) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const res = await POST(makePostReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.review.length).toBe(2);

    // Question 2 has no response → defaults
    const q2 = body.review[1];
    expect(q2.student_answer).toBe('');
    expect(q2.is_correct).toBeNull();
    expect(q2.ai_score).toBeNull();
    expect(q2.explanation).toBe('');
  });
});
