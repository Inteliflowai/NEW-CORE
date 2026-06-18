// src/app/api/teacher/quizzes/generate/__tests__/route.test.ts
// TDD tests for POST /api/teacher/quizzes/generate
// Covers: auth+role guard, guardClassAccess, atomic create (C21),
//         malformed quiz → no persist, partial question insert → quiz deleted + error.
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
  deleteError = null,
}: {
  lesson?: unknown;
  lessonError?: unknown;
  quizInsert?: unknown;
  quizInsertError?: unknown;
  questionsInsertError?: unknown;
  deleteError?: unknown;
} = {}) {
  // quiz_questions insert chain
  const questionsInsertChain: Record<string, unknown> = {};
  questionsInsertChain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: questionsInsertError }).then(resolve);

  // quiz delete chain
  const deleteChain: Record<string, unknown> = {};
  deleteChain['eq'] = vi.fn().mockReturnValue(deleteChain);
  deleteChain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: deleteError }).then(resolve);

  // quiz insert chain — returns the quiz with .select().single()
  const quizChain: Record<string, unknown> = {};
  quizChain['select'] = vi.fn().mockReturnValue(quizChain);
  quizChain['single'] = vi.fn().mockResolvedValue({ data: quizInsert, error: quizInsertError });
  quizChain['insert'] = vi.fn().mockReturnValue(quizChain);
  quizChain['delete'] = vi.fn().mockReturnValue(deleteChain);
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

  // ── 4. Malformed quiz → no persist (C1 terminal failure) ──────────────────
  it('returns 503 when generateQuiz throws LlmExhaustedError and nothing is persisted', async () => {
    const { LlmExhaustedError } = await import('@/lib/ai/errors');
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(makeServerMock({ id: 'teacher-1' }, { role: 'teacher' }) as never);

    const adminMock = makeAdminMock({
      lesson: { id: 'lesson-1', class_id: 'class-1', teacher_id: 'teacher-1', title: 'Test', subject: 'History', school_id: 'school-1', parsed_content: { subject: 'History' } },
    });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    mockGenerateQuiz.mockRejectedValueOnce(new LlmExhaustedError('openai'));

    const { POST } = await import('@/app/api/teacher/quizzes/generate/route');
    const res = await POST(makeRequest({ lesson_id: 'lesson-1' }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.retryable).toBe(true);
    expect(body.error.code).toBe('llm_exhausted');
    // The quizzes insert must NOT have been called
    expect(adminMock.from('quizzes').insert).not.toHaveBeenCalled();
  });

  // ── 5. Atomic create (C21): partial question insert → quiz deleted + error ─
  it('deletes quiz draft and returns error when quiz_questions insert fails (C21 atomic create)', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(makeServerMock({ id: 'teacher-1' }, { role: 'teacher' }) as never);

    const adminMock = makeAdminMock({
      lesson: { id: 'lesson-1', class_id: 'class-1', teacher_id: 'teacher-1', title: 'Test', subject: 'History', school_id: 'school-1', parsed_content: { subject: 'History' } },
      quizInsert: { id: 'quiz-1', lesson_id: 'lesson-1' },
      questionsInsertError: { message: 'constraint violation', code: '23000' },
    });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    mockGenerateQuiz.mockResolvedValueOnce(makeQuizResult());

    const { POST } = await import('@/app/api/teacher/quizzes/generate/route');
    const res = await POST(makeRequest({ lesson_id: 'lesson-1' }));

    // Must not return 200 success
    expect(res.status).not.toBe(200);
    // Must have attempted to delete the draft quiz (C21 rollback)
    const quizChain = adminMock.from('quizzes');
    expect(quizChain.delete).toHaveBeenCalled();
  });

  // ── 6. Happy path: teacher → 200, quiz + questions persisted ──────────────
  it('returns 200 with quiz_id and 5 questions on success', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(makeServerMock({ id: 'teacher-1' }, { role: 'teacher' }) as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock({
      lesson: { id: 'lesson-1', class_id: 'class-1', teacher_id: 'teacher-1', title: 'Test', subject: 'History', school_id: 'school-1', parsed_content: { subject: 'History' } },
      quizInsert: { id: 'quiz-1', lesson_id: 'lesson-1' },
    }) as never);

    mockGenerateQuiz.mockResolvedValueOnce(makeQuizResult());

    const { POST } = await import('@/app/api/teacher/quizzes/generate/route');
    const res = await POST(makeRequest({ lesson_id: 'lesson-1' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quiz_id).toBe('quiz-1');
    expect(body.questions).toHaveLength(5);
  });

  // ── 7. skill_id populated: resolveSkillIds succeeds → skill_id on rows ────
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

    expect(res.status).toBe(200);
    expect(qqInsertSpy).toHaveBeenCalledOnce();
    const insertedRows = qqInsertSpy.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(insertedRows[0].skill_id).toBe('skill-id-fractions');
    expect(insertedRows[1].skill_id).toBe('skill-id-adding');
  });

  // ── 8. Fail-soft: resolveSkillIds throws → quiz still 200, questions inserted without skill_id ──
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
