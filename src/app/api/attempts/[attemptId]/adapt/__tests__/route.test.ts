// src/app/api/attempts/[attemptId]/adapt/__tests__/route.test.ts
// Tests for POST /api/attempts/[attemptId]/adapt
// Key contract: adapt NEVER blocks — on persist failure, still returns { adapted }.
// Finding 1 fix: captures { error: updateError } and logs it; does NOT return non-200.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/attempts/test-attempt-id/adapt', {
    method: 'POST',
  });
}

const FAKE_ADAPTED = {
  level: 'grade_level',
  mcq_pct: 67,
  questions: [
    { position: 4, question_text: 'Q4 adapted', rubric: 'r', scaffold_hint: 'h', difficulty_label: 'Standard' },
    { position: 5, question_text: 'Q5 adapted', rubric: 'r', scaffold_hint: 'h', difficulty_label: 'Standard' },
  ],
};

function makeChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain['select'] = vi.fn().mockReturnValue(chain);
  chain['eq'] = vi.fn().mockReturnValue(chain);
  chain['lte'] = vi.fn().mockReturnValue(chain);
  chain['update'] = vi.fn().mockReturnValue(chain);
  chain['single'] = vi.fn().mockResolvedValue({ data, error });
  chain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(resolve);
  return chain;
}

const FAKE_ATTEMPT = {
  id: 'test-attempt-id',
  student_id: 'student-1',
  is_complete: false,
  adapted_questions: null,
  quizzes: {
    id: 'quiz-1',
    lessons: { parsed_content: { title: 'Test Lesson' } },
    quiz_questions: [
      { position: 1, question_text: 'MCQ1' },
      { position: 2, question_text: 'MCQ2' },
      { position: 3, question_text: 'MCQ3' },
      { position: 4, question_text: 'ORIG4' },
      { position: 5, question_text: 'ORIG5' },
    ],
  },
};

const FAKE_RESPONSES = [
  { position: 1, is_correct: true },
  { position: 2, is_correct: true },
  { position: 3, is_correct: false },
];

function makeAdminMock(updateError: unknown = null) {
  const updateChain: Record<string, unknown> = {};
  updateChain['eq'] = vi.fn().mockReturnValue(updateChain);
  updateChain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: updateError }).then(resolve);

  const attemptChain = makeChain(FAKE_ATTEMPT);
  attemptChain['update'] = vi.fn().mockReturnValue(updateChain);

  const responsesChain = makeChain(FAKE_RESPONSES);

  return {
    from: vi.fn((table: string) => {
      if (table === 'quiz_attempts') return attemptChain;
      if (table === 'quiz_responses') return responsesChain;
      return makeChain(null);
    }),
  };
}

// ─── module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

const mockAdaptQuestions = vi.fn();
vi.mock('@/lib/engine/adapt', () => ({
  adaptQuestions: (...a: unknown[]) => mockAdaptQuestions(...a),
}));

// ─── tests ────────────────────────────────────────────────────────────────────

describe('POST /api/attempts/[attemptId]/adapt', () => {
  beforeEach(() => {
    mockAdaptQuestions.mockReset();
    mockAdaptQuestions.mockResolvedValue(FAKE_ADAPTED);
  });

  // ── CRITICAL (Finding 1): persist failure → still returns adapted (adapt never blocks) ──
  it('returns 200 with adapted questions even when Supabase update() fails', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ message: 'connection refused', code: 'PGRST301' }) as never,
    );

    const { POST } = await import('@/app/api/attempts/[attemptId]/adapt/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ attemptId: 'test-attempt-id' }) });

    // adapt NEVER blocks — returns 200 with the adapted result even on persist failure
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.adapted).toEqual(FAKE_ADAPTED);
  });

  // ── CRITICAL (Finding 1): persist failure is logged (not silently dropped) ───
  it('logs console.error when Supabase update() fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ message: 'RLS policy violation', code: '42501' }) as never,
    );

    const { POST } = await import('@/app/api/attempts/[attemptId]/adapt/route');
    await POST(makeRequest(), { params: Promise.resolve({ attemptId: 'test-attempt-id' }) });

    expect(consoleSpy).toHaveBeenCalledWith(
      '[adapt] persist failed:',
      expect.objectContaining({ message: 'RLS policy violation' }),
    );
    consoleSpy.mockRestore();
  });

  // ── Happy path: successful adapt + persist → 200 ─────────────────────────────
  it('returns 200 with adapted questions on success', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock(null) as never);

    const { POST } = await import('@/app/api/attempts/[attemptId]/adapt/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ attemptId: 'test-attempt-id' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.adapted.level).toBe('grade_level');
    expect(body.adapted.questions).toHaveLength(2);
  });

  // ── Auth guard: unauthenticated → 401 ────────────────────────────────────────
  it('returns 401 when user is not authenticated', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock(null) as never);

    const { POST } = await import('@/app/api/attempts/[attemptId]/adapt/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ attemptId: 'test-attempt-id' }) });

    expect(res.status).toBe(401);
  });

  // ── Ownership guard: wrong student → 404 ─────────────────────────────────────
  it('returns 404 when attempt not found or belongs to another student', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'different-student' } }, error: null }) },
    } as never);

    // Supabase .eq('student_id', user.id) returns null data when student_id doesn't match
    const noAttemptChain = makeChain(null);
    noAttemptChain['update'] = vi.fn().mockReturnValue(makeChain(null));
    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      from: vi.fn().mockReturnValue(noAttemptChain),
    } as never);

    const { POST } = await import('@/app/api/attempts/[attemptId]/adapt/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ attemptId: 'test-attempt-id' }) });

    expect(res.status).toBe(404);
  });
});
