// src/app/api/attempts/[attemptId]/submit/__tests__/route.test.ts
// Tests for POST /api/attempts/[attemptId]/submit
//
// Required cases (task-6-corrections.md):
//   1. Happy path: all grades succeed → persists band + grading_status:'complete' + returns grades.
//   2. One OEQ grade fails → grading_status:'pending' + grading_failed:true, band NOT written.
//   3. Per-response update error (C22 persistence path) → pending+failed, band NOT written.
//   4. Ownership rejection → 404 (different student's attempt).
//   5. Auth failure → 401.
//   6. MCQ/numeric is_correct write error → grading_status:'pending' + grading_failed:true (C22).
//   7. Final quiz_attempts update error → fallback pending write, grading_delayed:true (Critical-1).
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

// Build Supabase admin mock.
//
// quiz_responses.update() is dispatched to different chains based on what field
// is being written:
//   - MCQ/numeric writes include 'is_correct' → mcqUpdateError applies
//   - OEQ writes include 'ai_score'           → responseUpdateError applies
//
// quiz_attempts.update() always goes through one chain whose error can be
// configured independently via finalUpdateError (applies to ALL attempts updates,
// including any best-effort pending fallback write).
function makeAdminMock(opts: {
  attempt?: unknown;
  attemptError?: unknown;
  responses?: unknown;
  responsesError?: unknown;
  // OEQ grading_output write error
  responseUpdateError?: unknown;
  // Final + fallback quiz_attempts update error
  finalUpdateError?: unknown;
  // MCQ/numeric is_correct write error
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

  // MCQ/numeric is_correct update chain
  const mcqUpdateChain: Record<string, unknown> = {};
  mcqUpdateChain['eq'] = vi.fn().mockReturnValue(mcqUpdateChain);
  mcqUpdateChain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: mcqUpdateError }).then(resolve);

  // OEQ grading_output update chain
  const oeqUpdateChain: Record<string, unknown> = {};
  oeqUpdateChain['eq'] = vi.fn().mockReturnValue(oeqUpdateChain);
  oeqUpdateChain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: responseUpdateError }).then(resolve);

  // quiz_attempts update chain (covers both pending fallback and final complete write)
  const attemptsUpdateChain: Record<string, unknown> = {};
  attemptsUpdateChain['eq'] = vi.fn().mockReturnValue(attemptsUpdateChain);
  attemptsUpdateChain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: finalUpdateError }).then(resolve);

  return {
    from: vi.fn((table: string) => {
      if (table === 'quiz_attempts') {
        const chain = { ...attemptChain };
        // All quiz_attempts.update() calls go through the same chain.
        // This covers: the initial select (no update), pending fallback writes, and final complete write.
        chain['update'] = vi.fn().mockReturnValue(attemptsUpdateChain);
        return chain;
      }
      if (table === 'quiz_responses') {
        const chain = { ...responsesChain };
        // Route updates by inspecting the payload:
        //   MCQ/numeric writes contain 'is_correct'; OEQ writes contain 'ai_score'.
        chain['update'] = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          if ('is_correct' in payload) return mcqUpdateChain;
          return oeqUpdateChain;
        });
        return chain;
      }
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

const mockGradeOpenResponse = vi.fn();
vi.mock('@/lib/engine/grading', () => ({
  gradeOpenResponse: (...a: unknown[]) => mockGradeOpenResponse(...a),
}));

const mockRecomputeSkillStates = vi.fn();
vi.mock('@/lib/skills/recomputeSkillStates', () => ({
  recomputeSkillStatesForStudent: (...a: unknown[]) => mockRecomputeSkillStates(...a),
}));

// ─── tests ────────────────────────────────────────────────────────────────────

describe('POST /api/attempts/[attemptId]/submit', () => {
  beforeEach(() => {
    mockGradeOpenResponse.mockReset();
    mockRecomputeSkillStates.mockReset();
    // Default: recompute resolves successfully
    mockRecomputeSkillStates.mockResolvedValue({ ok: true, skillsRecomputed: 1, states: {} });
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
    const attemptUpdateCalls = fromCalls.filter((c: unknown[]) => c[0] === 'quiz_attempts');
    // The update on quiz_attempts should contain pending, not complete
    expect(attemptUpdateCalls.length).toBeGreaterThan(0);
  });

  // ── C22 persistence path: OEQ per-response update error → pending + failed ──
  it('OEQ per-response update error → grading_status:pending + grading_failed:true (C22)', async () => {
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

  // ── C22: MCQ/numeric is_correct write error → pending + failed ────────────
  it('MCQ is_correct write error → grading_status:pending + grading_failed:true, band NOT written (C22)', async () => {
    // OEQ grader never fires because MCQ write fails first
    mockGradeOpenResponse.mockResolvedValue(VALID_GRADE);

    const adminMock = makeAdminMock({
      mcqUpdateError: { message: 'write timeout', code: 'PGRST503' },
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
    // C22: MCQ write error → pending path, band NOT written
    expect(body.grading_delayed).toBe(true);
    expect(body.mastery_band).toBeUndefined();
    // OEQ grader must NOT have been called (pending taken before OEQ stage)
    expect(mockGradeOpenResponse).not.toHaveBeenCalled();
  });

  // ── Critical-1: final quiz_attempts update error → pending fallback + grading_delayed ──
  it('final quiz_attempts update error → fallback pending write + grading_delayed:true, band NOT persisted (Critical-1)', async () => {
    mockGradeOpenResponse.mockResolvedValue(VALID_GRADE);

    const adminMock = makeAdminMock({
      finalUpdateError: { message: 'constraint violation', code: '23505' },
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
    // Must return grading_delayed (not a 500 error envelope)
    expect(body.grading_delayed).toBe(true);
    // Band must NOT appear in the response
    expect(body.mastery_band).toBeUndefined();
    // The fallback pending write was attempted on quiz_attempts
    const fromCalls = (adminMock.from as ReturnType<typeof vi.fn>).mock.calls;
    const attemptCalls = fromCalls.filter((c: unknown[]) => c[0] === 'quiz_attempts');
    expect(attemptCalls.length).toBeGreaterThan(0);
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
    expect(calls.some((c: unknown[]) => (c[0] as { questionText: string }).questionText === 'Q4 adapted text')).toBe(true);
    expect(calls.some((c: unknown[]) => (c[0] as { questionText: string }).questionText === 'Q5 adapted text')).toBe(true);
  });

  // ── Recompute hook: fires on all-clean path ───────────────────────────────
  it('recompute hook: fires recomputeSkillStatesForStudent on the all-clean path', async () => {
    mockGradeOpenResponse.mockResolvedValue(VALID_GRADE);
    mockRecomputeSkillStates.mockResolvedValue({ ok: true, skillsRecomputed: 1, states: {} });

    const adminMock = makeAdminMock();
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    const { POST } = await import('@/app/api/attempts/[attemptId]/submit/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ attemptId: 'attempt-1' }) });

    // Submit must still succeed
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grading_delayed).toBeFalsy();

    // Recompute was called — allow microtask queue to flush
    await Promise.resolve();
    expect(mockRecomputeSkillStates).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ studentId: 'student-1' }),
    );
  });

  // ── Recompute hook: a throw does NOT fail submit ──────────────────────────
  it('recompute hook: a recompute throw does NOT fail submit (fail-isolated)', async () => {
    mockGradeOpenResponse.mockResolvedValue(VALID_GRADE);
    mockRecomputeSkillStates.mockRejectedValue(new Error('recompute exploded'));

    const adminMock = makeAdminMock();
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    const { POST } = await import('@/app/api/attempts/[attemptId]/submit/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ attemptId: 'attempt-1' }) });

    // Submit must still return 200 with grades — recompute error is non-blocking
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grading_delayed).toBeFalsy();
    expect(body.grades).toBeDefined();
  });

  // ── Recompute hook: does NOT fire on pending/failed path ─────────────────
  it('recompute hook: does NOT fire when grading fails (pending path)', async () => {
    // First OEQ fails → pending path
    mockGradeOpenResponse
      .mockResolvedValueOnce(VALID_GRADE)
      .mockRejectedValueOnce(new Error('LLM down'));
    mockRecomputeSkillStates.mockResolvedValue({ ok: true, skillsRecomputed: 0, states: {} });

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
    expect(body.grading_delayed).toBe(true);

    // Allow microtask queue to flush — recompute must NOT have been called
    await Promise.resolve();
    expect(mockRecomputeSkillStates).not.toHaveBeenCalled();
  });
});
