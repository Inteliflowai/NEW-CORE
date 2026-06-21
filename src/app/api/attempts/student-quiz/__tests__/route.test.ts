// src/app/api/attempts/student-quiz/__tests__/route.test.ts
// Tests for GET /api/attempts/student-quiz
//
// Node environment (no jsdom needed — pure HTTP handler test).
// Mocking pattern: mirrors spark-launch + student/growth tests.
// Both supabase clients are mocked; isQuizAvailableForStudent is mocked
// so we can control eligibility decisions independently of the helper's
// own logic (which has its own unit tests).

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

// isQuizAvailableForStudent is mocked so test cases drive eligibility via
// the mock return value — we don't need to replicate its 6-rule logic here.
const mockIsQuizAvailable = vi.fn();
vi.mock('@/lib/quiz/isQuizAvailableForStudent', () => ({
  isQuizAvailableForStudent: (...args: unknown[]) => mockIsQuizAvailable(...args),
}));

// ── Lazy route import (after mocks are registered) ───────────────────────────

import { GET } from '../route';
import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from '@/lib/supabase/server';

// ── Fake data ────────────────────────────────────────────────────────────────

const STUDENT_ID = 'student-uuid-1';
const QUIZ_ID = 'quiz-uuid-abc';
const CLASS_ID = 'class-uuid-xyz';
const TEACHER_ID = 'teacher-uuid-ttt';
const ATTEMPT_ID = 'attempt-uuid-111';

const FAKE_ENROLLMENT = { class_id: CLASS_ID, enrolled_at: '2026-01-01T00:00:00Z' };

const FAKE_QUIZ_ROW = {
  id: QUIZ_ID,
  class_id: CLASS_ID,
  published_at: '2026-06-01T10:00:00Z',
  status: 'published',
};

const FAKE_QUIZ_FULL = {
  id: QUIZ_ID,
  title: 'Unit 3 Quiz',
  class_id: CLASS_ID,
  quiz_questions: [
    { id: 'q1', position: 1, question_type: 'mcq', question_text: 'What is 2+2?' },
  ],
};

const FAKE_CLASS = { name: 'Math 7A', teacher_id: TEACHER_ID };
const FAKE_TEACHER = { full_name: 'Ms. Rivera' };

const FAKE_ATTEMPT = {
  id: ATTEMPT_ID,
  is_complete: false,
  score_pct: null,
  mastery_band: null,
  adapted_questions: null,
  started_at: '2026-06-20T09:00:00Z',
  last_active_at: '2026-06-20T09:05:00Z',
  forfeit_reason: null,
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

// ── Helper: build admin client mock (table-dispatched) ───────────────────────
//
// The admin client's query chains differ per table call. This builder accepts
// per-table overrides so each test can inject specific return values.
//
// Chain shape: from(table) → select(...) → eq/in/order/limit → resolvedValue
//
// We build a minimal fluent chain for each call path the route uses:
//
//  enrollments: select → eq(student_id) → eq(is_active) → { data, error }
//  quizzes (list): select → in(class_id) → eq(status) → order → { data, error }
//  quiz_attempts (all): select → eq(quiz_id) → eq(student_id) → { data, error }
//  quiz_attempts (latest): select → eq/eq → order → limit(1) → { data, error }
//  quizzes (single): select → eq(id) → single() → { data, error }
//  classes: select → eq(id) → single() → { data, error }
//  users: select → eq(id) → single() → { data, error }
//
// We use a generic chainable-object pattern so extra .eq/.order/.limit calls
// don't explode — each method returns `this`.

interface ChainOpts {
  data: unknown;
  error?: unknown;
}

function makeChain(opts: ChainOpts) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'not']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Terminal resolvers
  const resolved = Promise.resolve({ data: opts.data, error: opts.error ?? null });
  chain['single'] = vi.fn().mockResolvedValue({ data: opts.data, error: opts.error ?? null });
  chain['maybeSingle'] = vi.fn().mockResolvedValue({ data: opts.data, error: opts.error ?? null });
  // Awaiting the chain itself resolves (for patterns like `await admin.from(...).select(...)`)
  chain['then'] = (resolve: (v: unknown) => unknown) => resolved.then(resolve);
  void self; // suppress unused
  return chain;
}

interface AdminMockOpts {
  enrollments?: unknown[];
  publishedQuizzes?: unknown[];
  allAttempts?: unknown[];
  latestAttempt?: unknown;
  quizFull?: unknown;
  classRow?: unknown;
  teacherRow?: unknown;
}

function makeAdminMock(opts: AdminMockOpts = {}) {
  const {
    enrollments = [FAKE_ENROLLMENT],
    publishedQuizzes = [FAKE_QUIZ_ROW],
    allAttempts = [],
    latestAttempt = FAKE_ATTEMPT,
    quizFull = FAKE_QUIZ_FULL,
    classRow = FAKE_CLASS,
    teacherRow = FAKE_TEACHER,
  } = opts;

  // Track call index per table to dispatch multiple sequential calls to the
  // same table (e.g. quiz_attempts is queried twice: once for all attempts,
  // once for the most recent attempt of the resolved quiz).
  const callIndex: Record<string, number> = {};

  return {
    from: vi.fn((table: string) => {
      callIndex[table] = (callIndex[table] ?? 0) + 1;
      const n = callIndex[table];

      if (table === 'enrollments') {
        return makeChain({ data: enrollments });
      }

      if (table === 'quizzes') {
        if (n === 1) {
          // First call: list of published quizzes by class_id
          return makeChain({ data: publishedQuizzes });
        }
        // Second call: single quiz with questions
        return makeChain({ data: quizFull });
      }

      if (table === 'quiz_attempts') {
        if (n === 1) {
          // First call: all attempts (for completedQuizIds / startedQuizIds sets)
          return makeChain({ data: allAttempts });
        }
        // Second call: most recent attempt for the resolved quiz
        return makeChain({ data: latestAttempt ? [latestAttempt] : [] });
      }

      if (table === 'classes') {
        return makeChain({ data: classRow });
      }

      if (table === 'users') {
        return makeChain({ data: teacherRow });
      }

      return makeChain({ data: null });
    }),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(url = 'http://localhost/api/attempts/student-quiz'): NextRequest {
  return new NextRequest(url);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/attempts/student-quiz', () => {
  beforeEach(() => {
    vi.resetModules();
    mockIsQuizAvailable.mockReset();
    // Default: quiz is available
    mockIsQuizAvailable.mockReturnValue(true);

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
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  // ── Happy path: active quiz returned ─────────────────────────────────────────

  it('200: returns eligible quiz, existing attempt, teacher_name, class_name', async () => {
    mockIsQuizAvailable.mockReturnValue(true);

    const res = await GET(makeReq());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.quiz).not.toBeNull();
    expect(body.quiz.id).toBe(QUIZ_ID);
    expect(body.quiz.title).toBe('Unit 3 Quiz');
    expect(Array.isArray(body.quiz.quiz_questions)).toBe(true);

    // Existing attempt fields
    expect(body.existing_attempt).not.toBeNull();
    expect(body.existing_attempt.id).toBe(ATTEMPT_ID);
    expect(body.existing_attempt).toHaveProperty('is_complete');
    expect(body.existing_attempt).toHaveProperty('score_pct');
    expect(body.existing_attempt).toHaveProperty('mastery_band');
    expect(body.existing_attempt).toHaveProperty('adapted_questions');
    expect(body.existing_attempt).toHaveProperty('started_at');
    expect(body.existing_attempt).toHaveProperty('last_active_at');
    expect(body.existing_attempt).toHaveProperty('forfeit_reason');

    expect(body.teacher_name).toBe('Ms. Rivera');
    expect(body.class_name).toBe('Math 7A');
  });

  // ── ?quizId=undefined literal is ignored ─────────────────────────────────────

  it('treats ?quizId=undefined literal as no quizId (falls through to selection)', async () => {
    mockIsQuizAvailable.mockReturnValue(true);

    // If the literal "undefined" were used as a quiz ID, the route would look
    // up a quiz with that bogus ID and return null. Instead it should ignore
    // it and run the normal selection, returning the eligible quiz.
    const res = await GET(makeReq('http://localhost/api/attempts/student-quiz?quizId=undefined'));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Selection path ran → quiz found
    expect(body.quiz).not.toBeNull();
    expect(body.quiz.id).toBe(QUIZ_ID);
  });

  // ── Fallback to most-recent completed when no active quiz ───────────────────

  it('falls back to the most-recent completed eligible quiz when none is active', async () => {
    // isQuizAvailableForStudent returns false → no active quiz
    mockIsQuizAvailable.mockReturnValue(false);

    // But there is a completed attempt for the quiz
    const completedAttempt = { ...FAKE_ATTEMPT, is_complete: true, submitted_at: '2026-06-19T11:00:00Z', score_pct: 82 };

    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({
        allAttempts: [
          // submitted_at set → completedQuizIds includes QUIZ_ID
          { quiz_id: QUIZ_ID, submitted_at: '2026-06-19T11:00:00Z', is_complete: true },
        ],
        latestAttempt: completedAttempt,
      }) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const res = await GET(makeReq());
    expect(res.status).toBe(200);

    const body = await res.json();
    // Fallback: the completed quiz is resolved (not null)
    expect(body.quiz).not.toBeNull();
    expect(body.quiz.id).toBe(QUIZ_ID);
    // The attempt surfaced is the completed one
    expect(body.existing_attempt.is_complete).toBe(true);
    expect(body.existing_attempt.score_pct).toBe(82);
  });

  // ── No enrollments → quiz: null ──────────────────────────────────────────────

  it('returns { quiz: null } when student has no active enrollments', async () => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ enrollments: [] }) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quiz).toBeNull();
  });

  // ── No published quizzes → quiz: null ────────────────────────────────────────

  it('returns { quiz: null } when no published quizzes exist for enrolled classes', async () => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ publishedQuizzes: [] }) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quiz).toBeNull();
  });

  // ── ?quizId= valid UUID bypasses selection ────────────────────────────────────

  it('uses ?quizId= when a valid UUID is provided, skipping enrollment-based selection', async () => {
    const DIRECT_QUIZ_ID = '12345678-1234-1234-1234-123456789abc';
    const directQuiz = { ...FAKE_QUIZ_FULL, id: DIRECT_QUIZ_ID };

    // When quizId is provided the route skips enrollments and goes straight to:
    //   quiz_attempts (call 1) → quizzes.single() (call 1) → classes (call 1) → users (call 1)
    // Build a dedicated mock that serves quizFull on the FIRST quizzes call (not
    // the list path) since the selection block is skipped entirely.
    const directMock = {
      from: vi.fn((table: string) => {
        if (table === 'enrollments') return makeChain({ data: [FAKE_ENROLLMENT] });
        if (table === 'quiz_attempts') return makeChain({ data: [FAKE_ATTEMPT] });
        if (table === 'quizzes') return makeChain({ data: directQuiz });
        if (table === 'classes') return makeChain({ data: FAKE_CLASS });
        if (table === 'users') return makeChain({ data: FAKE_TEACHER });
        return makeChain({ data: null });
      }),
    };
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      directMock as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const res = await GET(makeReq(`http://localhost/api/attempts/student-quiz?quizId=${DIRECT_QUIZ_ID}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quiz.id).toBe(DIRECT_QUIZ_ID);
  });

  // ── ?quizId= IDOR: student NOT enrolled in quiz's class → quiz: null ─────────

  it('returns { quiz: null } when ?quizId= is for a quiz in a class the student is NOT enrolled in', async () => {
    const OTHER_CLASS_QUIZ_ID = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff';
    const otherClassQuiz = {
      ...FAKE_QUIZ_FULL,
      id: OTHER_CLASS_QUIZ_ID,
      class_id: 'other-class-id-999',
    };

    // The route must check enrollments for the quiz's class_id.
    // Enrollment query returns empty (student is not in other-class-id-999).
    const idorMock = {
      from: vi.fn((table: string) => {
        if (table === 'quizzes') return makeChain({ data: otherClassQuiz });
        // Enrollment check: no active enrollment in other-class-id-999
        if (table === 'enrollments') return makeChain({ data: [] });
        if (table === 'quiz_attempts') return makeChain({ data: [FAKE_ATTEMPT] });
        if (table === 'classes') return makeChain({ data: FAKE_CLASS });
        if (table === 'users') return makeChain({ data: FAKE_TEACHER });
        return makeChain({ data: null });
      }),
    };
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      idorMock as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const res = await GET(makeReq(`http://localhost/api/attempts/student-quiz?quizId=${OTHER_CLASS_QUIZ_ID}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Must NOT leak the quiz or its questions
    expect(body.quiz).toBeNull();
    expect(body.existing_attempt).toBeNull();
    // Must not include quiz_questions from the other class
    expect(body).not.toHaveProperty('quiz.quiz_questions');
  });
});
