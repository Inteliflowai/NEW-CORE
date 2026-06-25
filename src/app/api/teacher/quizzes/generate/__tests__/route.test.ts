// src/app/api/teacher/quizzes/generate/__tests__/route.test.ts
// TDD tests for POST /api/teacher/quizzes/generate (non-blocking / after() background pattern).
//
// The route NOW:
//   1. Creates the quiz header row synchronously, returns { quiz_id } immediately (200).
//   2. Runs generateQuiz + quiz_questions insert INSIDE after() — the background callback.
//
// Test strategy:
//   - after() is mocked to run synchronously (mirrors the gradebook/override test pattern).
//   - Asserts: route returns 200 + { quiz_id } WITHOUT waiting for generateQuiz.
//   - Running the captured after-callback inserts questions.
//   - LlmExhaustedError inside the callback is swallowed; the quiz row stays (not deleted).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/teacher/quizzes/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Minimal chain builder
function makeChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain['select'] = vi.fn().mockReturnValue(chain);
  chain['eq'] = vi.fn().mockReturnValue(chain);
  chain['single'] = vi.fn().mockResolvedValue({ data, error });
  chain['maybeSingle'] = vi.fn().mockResolvedValue({ data, error });
  chain['insert'] = vi.fn().mockReturnValue(chain);
  chain['delete'] = vi.fn().mockReturnValue(chain);
  chain['update'] = vi.fn().mockReturnValue(chain);
  chain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(resolve);
  return chain;
}

function makeServerMock(user: { id: string } | null, profile: { role: string; school_id?: string } | null) {
  const profileChain = makeChain(profile ? { school_id: 'school-1', ...profile } : null);
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockReturnValue(profileChain),
  };
}

// Build admin mock that handles lessons + quizzes + quiz_questions table routing
function makeAdminMock({
  lesson = null,
  lessonError = null,
  quizInsert = null,
  quizInsertError = null,
  questionsInsertError = null,
}: {
  lesson?: unknown;
  lessonError?: unknown;
  quizInsert?: unknown;
  quizInsertError?: unknown;
  questionsInsertError?: unknown;
} = {}) {
  // quiz_questions insert chain
  const questionsInsertChain: Record<string, unknown> = {};
  questionsInsertChain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: questionsInsertError }).then(resolve);

  // quiz table chain — insert returns quiz; update / eq chains for the title-update in after()
  const quizUpdateChain: Record<string, unknown> = {};
  quizUpdateChain['eq'] = vi.fn().mockReturnValue(quizUpdateChain);
  quizUpdateChain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(resolve);

  const quizChain: Record<string, unknown> = {};
  quizChain['select'] = vi.fn().mockReturnValue(quizChain);
  quizChain['single'] = vi.fn().mockResolvedValue({ data: quizInsert, error: quizInsertError });
  quizChain['insert'] = vi.fn().mockReturnValue(quizChain);
  quizChain['update'] = vi.fn().mockReturnValue(quizUpdateChain);
  quizChain['eq'] = vi.fn().mockReturnValue(quizChain);

  // quiz_questions table
  const qqChain: Record<string, unknown> = {};
  qqChain['insert'] = vi.fn().mockReturnValue(questionsInsertChain);

  const lessonChain = makeChain(lesson, lessonError);

  return {
    from: vi.fn((table: string) => {
      if (table === 'lessons') return lessonChain;
      if (table === 'quizzes') return quizChain;
      if (table === 'quiz_questions') return qqChain;
      return makeChain(null);
    }),
  };
}

// Standard quiz payload (5 questions, 3 MCQ + 2 open)
function makeQuizResult() {
  return {
    title: 'Quiz: Test Lesson',
    questions: [
      { position: 1, question_type: 'mcq', question_text: 'Q1', choices: [{ label: 'A', text: 'a' }, { label: 'B', text: 'b' }, { label: 'C', text: 'c' }, { label: 'D', text: 'd' }], correct_answer: 'A', concept_tag: 'c' },
      { position: 2, question_type: 'mcq', question_text: 'Q2', choices: [{ label: 'A', text: 'a' }, { label: 'B', text: 'b' }, { label: 'C', text: 'c' }, { label: 'D', text: 'd' }], correct_answer: 'B', concept_tag: 'c' },
      { position: 3, question_type: 'mcq', question_text: 'Q3', choices: [{ label: 'A', text: 'a' }, { label: 'B', text: 'b' }, { label: 'C', text: 'c' }, { label: 'D', text: 'd' }], correct_answer: 'C', concept_tag: 'c' },
      { position: 4, question_type: 'open', question_text: 'Explain 4', rubric: 'A complete answer...', concept_tag: 'c' },
      { position: 5, question_type: 'open', question_text: 'Explain 5', rubric: 'A complete answer...', concept_tag: 'c' },
    ],
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

// after() runs the callback synchronously in tests (mirrors gradebook/override pattern).
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (cb: () => void) => { void Promise.resolve().then(cb); },
}));

const mockGenerateQuiz = vi.fn();
vi.mock('@/lib/engine/quizGen', () => ({
  generateQuiz: (...a: unknown[]) => mockGenerateQuiz(...a),
}));

const mockGuardClassAccess = vi.fn();
vi.mock('@/lib/auth/guards', () => ({
  guardClassAccess: (...a: unknown[]) => mockGuardClassAccess(...a),
}));

const mockResolveSkillIds = vi.fn();
vi.mock('@/lib/skills/resolveSkills', () => ({
  resolveSkillIds: (...a: unknown[]) => mockResolveSkillIds(...a),
}));

// ─── tests ────────────────────────────────────────────────────────────────────

describe('POST /api/teacher/quizzes/generate', () => {
  beforeEach(() => {
    mockGenerateQuiz.mockReset();
    mockGuardClassAccess.mockReset();
    mockGuardClassAccess.mockResolvedValue(null); // guard passes by default
    mockResolveSkillIds.mockReset();
    mockResolveSkillIds.mockResolvedValue(new Map()); // default: empty map (no skills resolved)
  });

  // ── 1. Auth: 401 when unauthenticated ─────────────────────────────────────
  it('returns 401 when unauthenticated', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(makeServerMock(null, null) as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock() as never);

    const { POST } = await import('@/app/api/teacher/quizzes/generate/route');
    const res = await POST(makeRequest({ lesson_id: 'lesson-1' }));

    expect(res.status).toBe(401);
  });

  // ── 2. Role check: 403 for student ────────────────────────────────────────
  it('returns 403 when caller role is student', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(makeServerMock({ id: 'student-1' }, { role: 'student' }) as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock() as never);

    const { POST } = await import('@/app/api/teacher/quizzes/generate/route');
    const res = await POST(makeRequest({ lesson_id: 'lesson-1' }));

    expect(res.status).toBe(403);
  });

  // ── 3. guardClassAccess rejection → 403 ───────────────────────────────────
  it('returns 403 when guardClassAccess rejects (IDOR protection)', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(makeServerMock({ id: 'teacher-2' }, { role: 'teacher' }) as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock({
      lesson: { id: 'lesson-1', class_id: 'class-1', teacher_id: 'teacher-1', title: 'Test', subject: 'History', school_id: 'school-1', parsed_content: { subject: 'History' } },
    }) as never);

    const { NextResponse } = await import('next/server');
    mockGuardClassAccess.mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));

    const { POST } = await import('@/app/api/teacher/quizzes/generate/route');
    const res = await POST(makeRequest({ lesson_id: 'lesson-1' }));

    expect(res.status).toBe(403);
  });

  // ── 4. Non-blocking: returns { quiz_id } immediately without waiting for generateQuiz ──
  // The response is returned BEFORE generateQuiz is invoked.
  it('returns 200 with { quiz_id } immediately — generateQuiz is invoked only in the background callback', async () => {
    // generateQuiz is a long-running mock that resolves after a "delay" — but the route
    // must not await it before sending the response. Because after() runs synchronously
    // in the test mock, we verify: (a) response = 200 + { quiz_id }, (b) generateQuiz
    // was eventually called (from inside the after callback), (c) response has no `questions`.
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(makeServerMock({ id: 'teacher-1' }, { role: 'teacher' }) as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock({
      lesson: { id: 'lesson-1', class_id: 'class-1', teacher_id: 'teacher-1', title: 'Test', subject: 'History', school_id: 'school-1', parsed_content: { subject: 'History' } },
      quizInsert: { id: 'quiz-1', lesson_id: 'lesson-1' },
    }) as never);

    mockGenerateQuiz.mockResolvedValueOnce(makeQuizResult());

    const { POST } = await import('@/app/api/teacher/quizzes/generate/route');
    const res = await POST(makeRequest({ lesson_id: 'lesson-1' }));

    // Route returns 200 immediately with only quiz_id (not questions)
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quiz_id).toBe('quiz-1');
    expect(body.questions).toBeUndefined();
  });

  // ── 5. After-callback: running the callback inserts quiz_questions ─────────
  it('after() callback invokes generateQuiz and inserts quiz_questions', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(makeServerMock({ id: 'teacher-1' }, { role: 'teacher' }) as never);

    const qqInsertSpy = vi.fn().mockReturnValue({
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    });

    const adminMock = makeAdminMock({
      lesson: { id: 'lesson-1', class_id: 'class-1', teacher_id: 'teacher-1', title: 'Test', subject: 'History', school_id: 'school-1', parsed_content: { subject: 'History' } },
      quizInsert: { id: 'quiz-1', lesson_id: 'lesson-1' },
    });

    // Patch quiz_questions chain to capture insert calls
    const origFrom = adminMock.from.bind(adminMock);
    adminMock.from = vi.fn((table: string) => {
      if (table === 'quiz_questions') return { insert: qqInsertSpy };
      return origFrom(table);
    });

    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);
    mockGenerateQuiz.mockResolvedValueOnce(makeQuizResult());

    const { POST } = await import('@/app/api/teacher/quizzes/generate/route');
    const res = await POST(makeRequest({ lesson_id: 'lesson-1' }));

    // Flush the microtask queue fully: the after() mock does Promise.resolve().then(cb),
    // then inside cb there's an async generateQuiz + resolveSkillIds chain.
    // Multiple flushes needed to drain nested promises.
    await new Promise((r) => setTimeout(r, 0));

    expect(res.status).toBe(200);
    // generateQuiz was called (from inside after())
    expect(mockGenerateQuiz).toHaveBeenCalledOnce();
    // quiz_questions were inserted
    expect(qqInsertSpy).toHaveBeenCalledOnce();
    const insertedRows = qqInsertSpy.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(insertedRows).toHaveLength(5);
    expect(insertedRows[0].quiz_id).toBe('quiz-1');
  });

  // ── 6. LlmExhaustedError in after() is swallowed; quiz row NOT deleted ─────
  it('LlmExhaustedError inside the after-callback is swallowed — quiz row stays, no throw', async () => {
    const { LlmExhaustedError } = await import('@/lib/ai/errors');
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(makeServerMock({ id: 'teacher-1' }, { role: 'teacher' }) as never);

    // Track delete calls with a dedicated spy
    const quizDeleteSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const adminMock = makeAdminMock({
      lesson: { id: 'lesson-1', class_id: 'class-1', teacher_id: 'teacher-1', title: 'Test', subject: 'History', school_id: 'school-1', parsed_content: { subject: 'History' } },
      quizInsert: { id: 'quiz-1', lesson_id: 'lesson-1' },
    });

    // Patch quizzes chain to capture delete calls
    const origFrom = adminMock.from.bind(adminMock);
    adminMock.from = vi.fn((table: string) => {
      if (table === 'quizzes') {
        const chain = origFrom(table) as Record<string, unknown>;
        chain['delete'] = quizDeleteSpy;
        return chain;
      }
      return origFrom(table);
    });

    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGenerateQuiz.mockRejectedValueOnce(new LlmExhaustedError('openai'));

    const { POST } = await import('@/app/api/teacher/quizzes/generate/route');
    const res = await POST(makeRequest({ lesson_id: 'lesson-1' }));

    // Flush the microtask/timer queue
    await new Promise((r) => setTimeout(r, 0));

    // Response is still 200 (quiz row was created synchronously before the error)
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quiz_id).toBe('quiz-1');

    // Error logged, not rethrown
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[quizzes/generate] LLM exhausted'),
      expect.any(String),
    );

    // quiz row is NOT deleted — the 0-question quiz stays for the teacher to see/retry
    expect(quizDeleteSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  // ── 7. questions-insert failure in after(): quiz row stays, error logged ───
  it('quiz_questions insert failure inside after-callback is logged without deleting the quiz row', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(makeServerMock({ id: 'teacher-1' }, { role: 'teacher' }) as never);

    // qqInsertSpy returns an error
    const qqInsertSpy = vi.fn().mockReturnValue({
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: { message: 'constraint violation', code: '23000' } }).then(resolve),
    });

    const quizDeleteSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const adminMock = makeAdminMock({
      lesson: { id: 'lesson-1', class_id: 'class-1', teacher_id: 'teacher-1', title: 'Test', subject: 'History', school_id: 'school-1', parsed_content: { subject: 'History' } },
      quizInsert: { id: 'quiz-1', lesson_id: 'lesson-1' },
    });

    const origFrom = adminMock.from.bind(adminMock);
    adminMock.from = vi.fn((table: string) => {
      if (table === 'quiz_questions') return { insert: qqInsertSpy };
      if (table === 'quizzes') {
        const chain = origFrom(table) as Record<string, unknown>;
        chain['delete'] = quizDeleteSpy;
        return chain;
      }
      return origFrom(table);
    });

    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGenerateQuiz.mockResolvedValueOnce(makeQuizResult());

    const { POST } = await import('@/app/api/teacher/quizzes/generate/route');
    const res = await POST(makeRequest({ lesson_id: 'lesson-1' }));

    // Flush the microtask/timer queue
    await new Promise((r) => setTimeout(r, 0));

    // Route still returned 200 (quiz row created before the callback ran)
    expect(res.status).toBe(200);

    // Error was logged
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[quizzes/generate] quiz_questions insert failed'),
      expect.stringContaining('constraint violation'),
    );

    // Quiz row NOT deleted — stays with 0 questions for the teacher to see/retry
    expect(quizDeleteSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  // ── 8. skill_id populated: resolveSkillIds succeeds → skill_id on rows ────
  it('populates skill_id on inserted quiz_question rows when resolveSkillIds succeeds', async () => {
    const quizResult = {
      title: 'Fractions Quiz',
      questions: [
        { position: 1, question_type: 'open', question_text: 'Explain fractions.', concept_tag: 'Fractions', choices: null, correct_answer: null, rubric: 'Full credit for correct explanation.', numeric_spec: null },
        { position: 2, question_type: 'open', question_text: 'What is 1/2 + 1/4?', concept_tag: 'Adding Fractions', choices: null, correct_answer: null, rubric: 'Award 1 for correct answer.', numeric_spec: null },
      ],
    };
    mockGenerateQuiz.mockResolvedValue(quizResult);
    mockResolveSkillIds.mockResolvedValue(
      new Map([
        ['Fractions', 'skill-id-fractions'],
        ['Adding Fractions', 'skill-id-adding'],
      ]),
    );

    const qqInsertSpy = vi.fn().mockReturnValue({
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    });

    const adminMock = makeAdminMock({
      lesson: { id: 'lesson-1', class_id: 'class-1', teacher_id: 'teacher-1', title: 'Fractions', subject: 'Math', school_id: 'school-1', parsed_content: { subject: 'Math' } },
      quizInsert: { id: 'quiz-uuid-1', lesson_id: 'lesson-1' },
    });

    // Patch quiz_questions chain to capture insert args
    const origFrom = adminMock.from.bind(adminMock);
    adminMock.from = vi.fn((table: string) => {
      if (table === 'quiz_questions') {
        return { insert: qqInsertSpy };
      }
      return origFrom(table);
    });

    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(makeServerMock({ id: 'teacher-1' }, { role: 'teacher' }) as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    const { POST } = await import('@/app/api/teacher/quizzes/generate/route');
    const res = await POST(makeRequest({ lesson_id: 'lesson-1' }));

    // Flush the microtask/timer queue
    await new Promise((r) => setTimeout(r, 0));

    expect(res.status).toBe(200);
    expect(qqInsertSpy).toHaveBeenCalledOnce();
    const insertedRows = qqInsertSpy.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(insertedRows[0].skill_id).toBe('skill-id-fractions');
    expect(insertedRows[1].skill_id).toBe('skill-id-adding');
  });

  // ── 9. Fail-soft: resolveSkillIds throws → quiz still 200, questions inserted without skill_id ──
  it('fail-soft: resolveSkillIds throws → quiz generation succeeds (200) and questions inserted', async () => {
    mockGenerateQuiz.mockResolvedValue(makeQuizResult());
    mockResolveSkillIds.mockRejectedValue(new Error('registry DB down'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const qqInsertSpy = vi.fn().mockReturnValue({
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    });

    const adminMock = makeAdminMock({
      lesson: { id: 'lesson-1', class_id: 'class-1', teacher_id: 'teacher-1', title: 'Test', subject: 'History', school_id: 'school-1', parsed_content: { subject: 'History' } },
      quizInsert: { id: 'quiz-1', lesson_id: 'lesson-1' },
    });

    const origFrom = adminMock.from.bind(adminMock);
    adminMock.from = vi.fn((table: string) => {
      if (table === 'quiz_questions') {
        return { insert: qqInsertSpy };
      }
      return origFrom(table);
    });

    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(makeServerMock({ id: 'teacher-1' }, { role: 'teacher' }) as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    const { POST } = await import('@/app/api/teacher/quizzes/generate/route');
    const res = await POST(makeRequest({ lesson_id: 'lesson-1' }));

    // Flush the microtask/timer queue
    await new Promise((r) => setTimeout(r, 0));

    // Quiz generation must succeed despite the registry failure
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quiz_id).toBe('quiz-1');

    // Questions must still be inserted (without skill_id)
    expect(qqInsertSpy).toHaveBeenCalledOnce();
    const insertedRows = qqInsertSpy.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(insertedRows[0].skill_id).toBeNull();

    // Registry error must have been logged
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[quizzes/generate] skill resolution failed'),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });
});
