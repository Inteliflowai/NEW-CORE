import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/teacher/lessons/import-drive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Minimal Supabase query chain builder
function chain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c['select'] = vi.fn().mockReturnValue(c);
  c['eq'] = vi.fn().mockReturnValue(c);
  c['insert'] = vi.fn().mockReturnValue(c);
  c['single'] = vi.fn().mockResolvedValue({ data, error });
  c['maybeSingle'] = vi.fn().mockResolvedValue({ data, error });
  c['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(resolve);
  return c;
}

function serverMock(user: { id: string } | null, role: string | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: user ? null : new Error('no session'),
      }),
    },
    from: vi.fn().mockReturnValue(chain(role ? { role } : null)),
  };
}

function adminMock(lessonId: string | null, insertErr: unknown = null) {
  const c = chain(lessonId ? { id: lessonId } : null, insertErr);
  return { from: vi.fn().mockReturnValue(c) };
}

// ── Module mocks ────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

const mockGuard = vi.fn();
vi.mock('@/lib/auth/guards', () => ({
  guardClassAccess: (...a: unknown[]) => mockGuard(...a),
}));

const mockGetToken = vi.fn();
vi.mock('@/lib/google/tokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google/tokens')>();
  return { ...actual, getValidAccessTokenForTeacher: (...a: unknown[]) => mockGetToken(...a) };
});

const mockExtract = vi.fn();
vi.mock('@/lib/google/drive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google/drive')>();
  return { ...actual, extractTextFromGoogleDriveFile: (...a: unknown[]) => mockExtract(...a) };
});

const mockParseLesson = vi.fn();
vi.mock('@/lib/engine/lessonParse', () => ({
  parseLesson: (...a: unknown[]) => mockParseLesson(...a),
}));

// ── Tests ───────────────────────────────────────────────────────────────────────

const PARSED = {
  title: 'Drive Lesson', key_concepts: ['concept'], objectives: [],
  vocabulary: [], misconception_risks: [], grade_level: '7th', subject: 'English', summary: 'x',
};

describe('POST /api/teacher/lessons/import-drive', () => {
  beforeEach(() => {
    mockGuard.mockReset().mockResolvedValue(null);
    mockGetToken.mockReset().mockResolvedValue('fake-token');
    mockExtract.mockReset().mockResolvedValue('Extracted lesson text from Drive');
    mockParseLesson.mockReset().mockResolvedValue(PARSED);
  });

  it('returns 401 when unauthenticated', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(serverMock(null, null) as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock(null) as never);

    const { POST } = await import('../route');
    const res = await POST(makeReq({ file_id: 'fid', class_id: 'cid' }));
    expect(res.status).toBe(401);
  });

  it('returns 403 when caller is a student', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(serverMock({ id: 'u1' }, 'student') as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock(null) as never);

    const { POST } = await import('../route');
    const res = await POST(makeReq({ file_id: 'fid', class_id: 'cid' }));
    expect(res.status).toBe(403);
  });

  it('returns 400 when file_id is missing', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(serverMock({ id: 'u1' }, 'teacher') as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock(null) as never);

    const { POST } = await import('../route');
    const res = await POST(makeReq({ class_id: 'cid' }));
    expect(res.status).toBe(400);
  });

  it('returns 403 when guardClassAccess rejects (IDOR)', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(serverMock({ id: 'u1' }, 'teacher') as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock(null) as never);
    const { NextResponse } = await import('next/server');
    mockGuard.mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));

    const { POST } = await import('../route');
    const res = await POST(makeReq({ file_id: 'fid', class_id: 'cid' }));
    expect(res.status).toBe(403);
  });

  it('returns HTTP 200 with connected:false when teacher has no Google connection', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(serverMock({ id: 'u1' }, 'teacher') as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock(null) as never);
    const { GoogleNotConnectedError } = await import('@/lib/google/tokens');
    mockGetToken.mockRejectedValueOnce(new GoogleNotConnectedError());

    const { POST } = await import('../route');
    const res = await POST(makeReq({ file_id: 'fid', class_id: 'cid' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connected).toBe(false);
  });

  it('returns 404 with drive_not_found code when Drive returns 404', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(serverMock({ id: 'u1' }, 'teacher') as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock(null) as never);
    const { DriveFileNotFoundError } = await import('@/lib/google/errors');
    mockExtract.mockRejectedValueOnce(new DriveFileNotFoundError());

    const { POST } = await import('../route');
    const res = await POST(makeReq({ file_id: 'fid', class_id: 'cid' }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('drive_not_found');
  });

  it('returns 400 with drive_access_denied when file is not shared with teacher', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(serverMock({ id: 'u1' }, 'teacher') as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock(null) as never);
    const { DriveAccessDeniedError } = await import('@/lib/google/errors');
    mockExtract.mockRejectedValueOnce(new DriveAccessDeniedError());

    const { POST } = await import('../route');
    const res = await POST(makeReq({ file_id: 'fid', class_id: 'cid' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('drive_access_denied');
  });

  it('returns 400 with drive_unsupported_type for binary files', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(serverMock({ id: 'u1' }, 'teacher') as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock(null) as never);
    const { DriveUnsupportedTypeError } = await import('@/lib/google/errors');
    mockExtract.mockRejectedValueOnce(new DriveUnsupportedTypeError('image/png'));

    const { POST } = await import('../route');
    const res = await POST(makeReq({ file_id: 'fid', class_id: 'cid' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('drive_unsupported_type');
  });

  it('returns 200 with lesson_id and source=google_drive on success', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(serverMock({ id: 'teacher-1' }, 'teacher') as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock('new-lesson-id') as never);

    const { POST } = await import('../route');
    const res = await POST(makeReq({ file_id: 'fid', class_id: 'cid' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lesson_id).toBe('new-lesson-id');
    expect(body.parsed_content.title).toBe('Drive Lesson');
  });
});
