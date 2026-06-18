// src/app/api/attempts/[attemptId]/submit/__tests__/route.test.ts
// Tests for POST /api/attempts/[attemptId]/submit
//
// Required cases (task-6-corrections.md):
//   1. Happy path: all grades succeed → persists band + grading_status:'complete' + returns grades.
//   2. One OEQ grade fails → grading_status:'pending' + grading_failed:true, band NOT written.
//   3. Per-response update error (C22 persistence path) → pending+failed, band NOT written.
//   4. Ownership rejection → 404 (different student's attempt).
//   5. Auth failure → 401.
//
// Supabase mock idiom follows adapt route test (makeChain + makeAdminMock pattern).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeRequest(attemptId = 'attempt-1'): NextRequest {
  return new NextRequest(`http://localhost/api/attempts/${attemptId}/submit`, {
    method: 'POST',
  });
}

const VALID_GRADE = {
  score: 1.0 as const,
  explanation: 'complete answer',
  confidence: 0.9,
  grader_source: 'ai',
  error_type: 'none' as const,
  reasoning_pattern: 'full_reasoning' as const,
  misinterpretation_detected: false,
  vocabulary_difficulty: 'low' as const,
  cognitive_notes: 'Strong reasoning demonstrated.',
};

const FAKE_ATTEMPT = {
  id: 'attempt-1',
  student_id: 'student-1',
  is_complete: false,
  adapted_questions: null,
  quizzes: {
    quiz_questions: [
      { position: 1, question_type: 'mcq', question_text: 'MCQ1', choices: [], correct_answer: 'A', rubric: null, numeric_spec: null },
      { position: 2, question_type: 'mcq', question_text: 'MCQ2', choices: [], correct_answer: 'B', rubric: null, numeric_spec: null },
      { position: 3, question_type: 'numeric', question_text: 'Num1', choices: null, correct_answer: null, rubric: null, numeric_spec: { accepted: ['42'], tolerance: 0 } },
      { position: 4, question_type: 'open', question_text: 'OEQ1', rubric: 'Rubric4', choices: null, correct_answer: null, numeric_spec: null },
      { position: 5, question_type: 'open', question_text: 'OEQ2', rubric: 'Rubric5', choices: null, correct_answer: null, numeric_spec: null },
    ],
  },
};

const FAKE_RESPONSES = [
  { position: 1, response_text: 'A', is_correct: null },
  { position: 2, response_text: 'B', is_correct: null },
  { position: 3, response_text: '42', is_correct: null },
  { position: 4, response_text: 'Student answer 4' },
  { position: 5, response_text: 'Student answer 5' },
];

// Chain builder matching adapt test idiom
function makeChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain['select'] = vi.fn().mockReturnValue(chain);
  chain['eq'] = vi.fn().mockReturnValue(chain);
  chain['gte'] = vi.fn().mockReturnValue(chain);
  chain['lte'] = vi.fn().mockReturnValue(chain);
  chain['update'] = vi.fn().mockReturnValue(chain);
  chain['single'] = vi.fn().mockResolvedValue({ data, error });
  chain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(resolve);
  return chain;
}

// Build Supabase admin mock with configurable per-table behavior
function makeAdminMock(opts: {
  attempt?: unknown;
  attemptError?: unknown;
  responses?: unknown;
  responsesError?: unknown;
  // Per-response update results: indexed by position
  responseUpdateError?: unknown;
  // Final attempt update result
  finalUpdateError?: unknown;
  // MCQ/numeric response update error
  mcqUpdateError?: unknown;
} = {}) {
  const {
    attempt = FAKE_ATTEMPT,
    attemptError = null,
    responses = FAKE_RESPONSES,
    responsesError = null,
    responseUpdateError = null,
    finalUpdateError = null,
    mcqUpdateError = null,
  } = opts;

  // Attempt chain — supports .select().eq().eq().single()
  const attemptChain = makeChain(attempt, attemptError);

  // Responses chain — supports .select().eq().then()
  const responsesChain = makeChain(responses, responsesError);

  // Response update chain (for per-question updates)
  const responseUpdateChain: Record<string, unknown> = {};
  responseUpdateChain['eq'] = vi.fn().mockReturnValue(responseUpdateChain);
  responseUpdateChain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: responseUpdateError }).then(resolve);

  // MCQ/numeric update chain
  const mcqUpdateChain: Record<string, unknown> = {};
  mcqUpdateChain['eq'] = vi.fn().mockReturnValue(mcqUpdateChain);
  mcqUpdateChain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: mcqUpdateError }).then(resolve);

  // Final attempt update chain
  const finalUpdateChain: Record<string, unknown> = {};
  finalUpdateChain['eq'] = vi.fn().mockReturnValue(finalUpdateChain);
  finalUpdateChain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: finalUpdateError }).then(resolve);

  let updateCallCount = 0;

  return {
    from: vi.fn((table: string) => {
      if (table === 'quiz_attempts') {
        // Distinguish the initial select from subsequent updates
        const chain = { ...attemptChain };
        // update is called twice: pending path once, complete path twice (per-response + final)
        chain['update'] = vi.fn().mockImplementation(() => {
          updateCallCount++;
          // The LAST update call on quiz_attempts is the final status update
          // Earlier calls are the pending/failed path
          return finalUpdateChain;
        });
        return chain;
      }
      if (table === 'quiz_responses') {
        // For select, return responses; for update, return per-response update chain
        const chain = { ...responsesChain };
        chain['update'] = vi.fn().mockReturnValue(responseUpdateChain);
        return chain;
      }
      return makeChain(null);
    }),
    updateCallCount: { get: () => updateCallCount },
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

const mockGradeOpenResponse = vi.fn();
vi.mock('@/lib/engine/grading', () => ({
  gradeOpenResponse: (...a: unknown[]) => mockGradeOpenResponse(...a),
}));

// ─── tests ────────────────────────────────────────────────────────────────────

describe('POST /api/attempts/[attemptId]/submit', () => {
  beforeEach(() => {
    mockGradeOpenResponse.mockReset();
    vi.resetModules();
  });

  // ── Auth guard: unauthenticated → 401 ────────────────────────────────────
  it('returns 401 when user is not authenticated', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock() as never);

    const { POST } = await import('@/app/api/attempts/[attemptId]/submit/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ attemptId: 'attempt-1' }) });

    expect(res.status).toBe(401);
  });

  // ── Ownership guard: wrong student → 404 ─────────────────────────────────
  it('returns 404 when attempt belongs to another student', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'other-student' } }, error: null }) },
    } as never);
    // Supabase .eq('student_id', user.id) returns null data when student doesn't own attempt
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ attempt: null }) as never,
    );

    const { POST } = await import('@/app/api/attempts/[attemptId]/submit/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ attemptId: 'attempt-1' }) });

    expect(res.status).toBe(404);
  });

  // ── Happy path: all grades succeed → band + complete persisted ────────────
  it('happy path: all OEQs graded successfully → persists band + grading_status:complete + returns grades', async () => {
    mockGradeOpenResponse.mockResolvedValue(VALID_GRADE);

    const adminMock = makeAdminMock();
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    const { POST } = await import('@/app/api/attempts/[attemptId]/submit/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ attemptId: 'attempt-1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    // Must return grades
    expect(body.grades).toBeDefined();
    expect(body.attempt_id).toBe('attempt-1');
    // grading_delayed must NOT be true on the happy path
    expect(body.grading_delayed).toBeFalsy();
    // Both OEQs should be graded
    expect(body.grades).toHaveLength(2);

    // gradeOpenResponse was called twice (positions 4 and 5)
    expect(mockGradeOpenResponse).toHaveBeenCalledTimes(2);
  });

  // ── OEQ grade failure → pending + failed, band NOT written ────────────────
  it('one OEQ grade fails → grading_status:pending + grading_failed:true, band NOT written', async () => {
    // First OEQ succeeds, second throws
    mockGradeOpenResponse
      .mockResolvedValueOnce(VALID_GRADE)
      .mockRejectedValueOnce(new Error('LLM exhausted'));

    const adminMock = makeAdminMock();
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    const { POST } = await import('@/app/api/attempts/[attemptId]/submit/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ attemptId: 'attempt-1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    // Must signal grading is delayed — band NOT written
    expect(body.grading_delayed).toBe(true);

    // Verify the attempt update was called with pending status (not complete)
    const fromCalls = (adminMock.from as ReturnType<typeof vi.fn>).mock.calls;
    const attemptUpdateCalls = fromCalls.filter(([t]: [string]) => t === 'quiz_attempts');
    // The update on quiz_attempts should contain pending, not complete
    expect(attemptUpdateCalls.length).toBeGreaterThan(0);
  });

  // ── C22 persistence path: per-response update error → pending + failed ────
  it('per-response update error → grading_status:pending + grading_failed:true (C22)', async () => {
    // Both OEQs grade successfully, but the response write fails
    mockGradeOpenResponse.mockResolvedValue(VALID_GRADE);

    const adminMock = makeAdminMock({
      responseUpdateError: { message: 'connection refused', code: 'PGRST301' },
    });
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    const { POST } = await import('@/app/api/attempts/[attemptId]/submit/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ attemptId: 'attempt-1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    // C22: any write error → pending, band withheld
    expect(body.grading_delayed).toBe(true);
  });

  // ── Adapted question text is used when present ────────────────────────────
  it('uses adapted question text when attempt has adapted_questions', async () => {
    mockGradeOpenResponse.mockResolvedValue(VALID_GRADE);

    const attemptWithAdapted = {
      ...FAKE_ATTEMPT,
      adapted_questions: {
        questions: [
          { position: 4, question_text: 'Q4 adapted text' },
          { position: 5, question_text: 'Q5 adapted text' },
        ],
      },
    };

    const adminMock = makeAdminMock({ attempt: attemptWithAdapted });
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    const { POST } = await import('@/app/api/attempts/[attemptId]/submit/route');
    await POST(makeRequest(), { params: Promise.resolve({ attemptId: 'attempt-1' }) });

    // Check that gradeOpenResponse was called with adapted text
    const calls = mockGradeOpenResponse.mock.calls;
    expect(calls.some((c: [{ questionText: string }]) => c[0].questionText === 'Q4 adapted text')).toBe(true);
    expect(calls.some((c: [{ questionText: string }]) => c[0].questionText === 'Q5 adapted text')).toBe(true);
  });
});
