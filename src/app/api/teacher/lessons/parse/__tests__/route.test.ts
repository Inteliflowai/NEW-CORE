// src/app/api/teacher/lessons/parse/__tests__/route.test.ts
// Security + correctness tests for POST /api/teacher/lessons/parse
// Covers: write-error → non-200, signed-URL regex, role check, IDOR, ZodError→503.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/teacher/lessons/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Build a minimal Supabase query chain.
function makeChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain['select'] = vi.fn().mockReturnValue(chain);
  chain['eq'] = vi.fn().mockReturnValue(chain);
  chain['update'] = vi.fn().mockReturnValue(chain);
  chain['single'] = vi.fn().mockResolvedValue({ data, error });
  chain['maybeSingle'] = vi.fn().mockResolvedValue({ data, error });
  chain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(resolve);
  return chain;
}

function makeServerMock(
  user: { id: string } | null,
  profile: { role: string } | null,
) {
  const profileChain = makeChain(profile);
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockReturnValue(profileChain),
  };
}

function makeAdminMock(
  lessonData: unknown,
  lessonError: unknown = null,
  updateError: unknown = null,
) {
  const updateChain: Record<string, unknown> = {};
  updateChain['eq'] = vi.fn().mockReturnValue(updateChain);
  updateChain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: updateError }).then(resolve);

  const lessonChain = makeChain(lessonData, lessonError);
  lessonChain['update'] = vi.fn().mockReturnValue(updateChain);

  return {
    from: vi.fn((table: string) => {
      if (table === 'lessons') return lessonChain;
      // classes: pass-through (guardClassAccess is mocked separately)
      return makeChain(null);
    }),
    storage: {
      from: vi.fn().mockReturnValue({
        download: vi.fn().mockResolvedValue({
          data: new Blob(['fake content']),
          error: null,
        }),
      }),
    },
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

vi.mock('@/lib/engine/parseUpload', () => ({
  extractUploadText: vi.fn().mockResolvedValue('Lesson text about photosynthesis'),
}));

// mockParseLesson is module-level so it persists across all tests.
const mockParseLesson = vi.fn();
vi.mock('@/lib/engine/lessonParse', () => ({
  parseLesson: (...a: unknown[]) => mockParseLesson(...a),
}));

// mockGuardClassAccess is module-level so it persists across all tests.
const mockGuardClassAccess = vi.fn();
vi.mock('@/lib/auth/guards', () => ({
  guardClassAccess: (...a: unknown[]) => mockGuardClassAccess(...a),
}));

// ─── tests ────────────────────────────────────────────────────────────────────

describe('POST /api/teacher/lessons/parse', () => {
  beforeEach(() => {
    // Only reset mock call counts/implementations, do NOT resetModules.
    // resetModules would cause instanceof checks against LlmExhaustedError to
    // fail because the re-imported class would be a different identity.
    mockParseLesson.mockReset();
    mockGuardClassAccess.mockReset();
    mockGuardClassAccess.mockResolvedValue(null); // default: guard passes
  });

  // ── CRITICAL #1: write error → non-200 ──────────────────────────────────────
  it('returns non-200 when Supabase update() fails (write error = silent data loss)', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'teacher-1' }, { role: 'teacher' }) as never,
    );

    const parsedOutput = { title: 'Test', key_concepts: [], objectives: [], vocabulary: [], misconception_risks: [], grade_level: '5th', subject: 'Science', summary: 'x' };
    mockParseLesson.mockResolvedValue(parsedOutput);

    // Lesson found, but update() returns an error
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock(
        { id: 'lesson-1', file_url: 'https://example.com/storage/v1/object/public/lesson-uploads/file.pdf', file_type: 'application/pdf', file_name: 'file.pdf', teacher_id: 'teacher-1', parsed_content: null, class_id: 'class-1' },
        null,
        { message: 'connection refused', code: 'PGRST301' },
      ) as never,
    );

    const { POST } = await import('@/app/api/teacher/lessons/parse/route');
    const res = await POST(makeRequest({ lesson_id: 'lesson-1' }));

    // Must NOT be 200 — write failed, nothing was persisted
    expect(res.status).not.toBe(200);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  // ── CRITICAL #2: signed URL regex strips query string ───────────────────────
  it('correctly extracts storage path from a signed URL (strips ?token=...)', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'teacher-1' }, { role: 'teacher' }) as never,
    );

    const parsedOutput = { title: 'Test', key_concepts: [], objectives: [], vocabulary: [], misconception_risks: [], grade_level: '5th', subject: 'Science', summary: 'x' };
    mockParseLesson.mockResolvedValue(parsedOutput);

    const downloadMock = vi.fn().mockResolvedValue({ data: new Blob(['content']), error: null });

    const updateChain: Record<string, unknown> = {};
    updateChain['eq'] = vi.fn().mockReturnValue(updateChain);
    updateChain['then'] = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve);

    const lessonChain = makeChain({
      id: 'lesson-1',
      file_url: 'https://project.supabase.co/storage/v1/object/sign/lesson-uploads/my-folder/file.pdf?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      file_type: 'application/pdf',
      file_name: 'file.pdf',
      teacher_id: 'teacher-1',
      parsed_content: null,
      class_id: 'class-1',
    });
    lessonChain['update'] = vi.fn().mockReturnValue(updateChain);

    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lessons') return lessonChain;
        return makeChain(null);
      }),
      storage: { from: vi.fn().mockReturnValue({ download: downloadMock }) },
    } as never);

    const { POST } = await import('@/app/api/teacher/lessons/parse/route');
    await POST(makeRequest({ lesson_id: 'lesson-1' }));

    // storage.download() must have been called WITHOUT the query string
    expect(downloadMock).toHaveBeenCalledWith('my-folder/file.pdf');
    const calledPath = downloadMock.mock.calls[0][0] as string;
    expect(calledPath).not.toContain('?');
    expect(calledPath).not.toContain('token=');
  });

  // ── IMPORTANT #3: role check — student caller is rejected (403) ─────────────
  it('returns 403 when caller role is student', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'student-1' }, { role: 'student' }) as never,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock(null) as never);

    const { POST } = await import('@/app/api/teacher/lessons/parse/route');
    const res = await POST(makeRequest({ lesson_id: 'lesson-1' }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/forbidden/i);
  });

  it('returns 403 when caller role is parent', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'parent-1' }, { role: 'parent' }) as never,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock(null) as never);

    const { POST } = await import('@/app/api/teacher/lessons/parse/route');
    const res = await POST(makeRequest({ lesson_id: 'lesson-1' }));

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock(null, null) as never,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock(null) as never);

    const { POST } = await import('@/app/api/teacher/lessons/parse/route');
    const res = await POST(makeRequest({ lesson_id: 'lesson-1' }));

    expect(res.status).toBe(401);
  });

  // ── IMPORTANT #4: IDOR — teacher writing to a class they don't own → 403 ────
  it('returns 403 when guardClassAccess rejects (teacher does not own the class)', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'teacher-2' }, { role: 'teacher' }) as never,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({
        id: 'lesson-1', file_url: 'https://example.com/lesson-uploads/file.pdf',
        file_type: 'pdf', file_name: 'file.pdf', teacher_id: 'teacher-2',
        parsed_content: null, class_id: 'class-owned-by-teacher-1',
      }) as never,
    );

    // guardClassAccess returns a 403 response (teacher-2 doesn't own the class)
    const { NextResponse } = await import('next/server');
    mockGuardClassAccess.mockResolvedValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );

    const { POST } = await import('@/app/api/teacher/lessons/parse/route');
    const res = await POST(makeRequest({ lesson_id: 'lesson-1' }));

    expect(res.status).toBe(403);
  });

  // ── C1 throw-path: route maps LlmExhaustedError → 503 ───────────────────────
  it('returns 503 when parseLesson throws LlmExhaustedError (route catch → respondEngineError)', async () => {
    const { LlmExhaustedError } = await import('@/lib/ai/errors');
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'teacher-1' }, { role: 'teacher' }) as never,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({
        id: 'lesson-1', file_url: 'https://example.com/storage/v1/object/public/lesson-uploads/file.pdf',
        file_type: 'application/pdf', file_name: 'file.pdf', teacher_id: 'teacher-1',
        parsed_content: null, class_id: 'class-1',
      }) as never,
    );
    mockParseLesson.mockRejectedValueOnce(new LlmExhaustedError('openai'));

    const { POST } = await import('@/app/api/teacher/lessons/parse/route');
    const res = await POST(makeRequest({ lesson_id: 'lesson-1' }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.retryable).toBe(true);
    expect(body.error.code).toBe('llm_exhausted');
  });

  // ── ZodError → 503 (parseLesson re-throws as LlmExhaustedError) ──────────────
  it('returns 503 when parseLesson re-throws ZodError as LlmExhaustedError', async () => {
    const { LlmExhaustedError } = await import('@/lib/ai/errors');
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'teacher-1' }, { role: 'teacher' }) as never,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({
        id: 'lesson-1', file_url: 'https://example.com/storage/v1/object/public/lesson-uploads/file.pdf',
        file_type: 'application/pdf', file_name: 'file.pdf', teacher_id: 'teacher-1',
        parsed_content: null, class_id: 'class-1',
      }) as never,
    );
    // parseLesson wraps ZodError into LlmExhaustedError — simulate the same outcome
    mockParseLesson.mockRejectedValueOnce(
      new LlmExhaustedError('openai', new Error('ZodError: invalid shape')),
    );

    const { POST } = await import('@/app/api/teacher/lessons/parse/route');
    const res = await POST(makeRequest({ lesson_id: 'lesson-1' }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.retryable).toBe(true);
  });

  // ── Happy path: teacher passes, returns 200 ──────────────────────────────────
  it('returns 200 with parsed_content on success', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'teacher-1' }, { role: 'teacher' }) as never,
    );

    const parsedOutput = { title: 'Photosynthesis', key_concepts: ['light'], objectives: [], vocabulary: [], misconception_risks: [], grade_level: '7th', subject: 'Science', summary: 'How plants work' };
    mockParseLesson.mockResolvedValueOnce(parsedOutput);

    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({
        id: 'lesson-1', file_url: 'https://example.com/storage/v1/object/public/lesson-uploads/file.pdf',
        file_type: 'application/pdf', file_name: 'file.pdf', teacher_id: 'teacher-1',
        parsed_content: null, class_id: 'class-1',
      }) as never,
    );

    const { POST } = await import('@/app/api/teacher/lessons/parse/route');
    const res = await POST(makeRequest({ lesson_id: 'lesson-1' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lesson_id).toBe('lesson-1');
    expect(body.parsed_content.title).toBe('Photosynthesis');
  });
});
