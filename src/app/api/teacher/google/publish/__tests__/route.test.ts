import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── mocks ─────────────────────────────────────────────────────────────────────

const getUser = vi.fn();
const single = vi.fn();
const guard = vi.fn();
const publishFn = vi.fn();
const logAuditFn = vi.fn();
const getToken = vi.fn();

// Admin client: chain varies by query path.
// We need: classes.select().eq().maybeSingle()  → classRow
//           quizzes.select().eq().maybeSingle()  → quizRow
//           lessons.select().eq().maybeSingle()  → lessonRow
// plus the internal calls made by publishToClassroom (mocked entirely).
const classRow = vi.fn();
const quizRow = vi.fn();
const lessonRow = vi.fn();

// Simple admin mock: tracks the table name and routes accordingly.
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
  }),
  createAdminSupabaseClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: table === 'classes' ? classRow : table === 'quizzes' ? quizRow : lessonRow,
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/auth/guards', () => ({ guardClassAccess: (...a: unknown[]) => guard(...a) }));
vi.mock('@/lib/auth/roles', () => ({ STAFF_ROLES: ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'] }));
vi.mock('@/lib/google/tokens', async () => {
  class GoogleNotConnectedError extends Error { constructor() { super('google_not_connected'); } }
  return { GoogleNotConnectedError, getValidAccessTokenForTeacher: (...a: unknown[]) => getToken(...a) };
});
vi.mock('@/lib/google/classroom', async () => {
  class GoogleScopeError extends Error { constructor() { super('google_scope_insufficient'); } }
  return { GoogleScopeError };
});
vi.mock('@/lib/google/publishToClassroom', () => ({ publishToClassroom: (...a: unknown[]) => publishFn(...a) }));
vi.mock('@/lib/audit/logAudit', () => ({ logAudit: (...a: unknown[]) => logAuditFn(...a) }));
vi.mock('@/lib/google/config', () => ({
  APP_BASE_URL: 'https://newcore.inteliflowai.com',
}));

// ── helpers ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  for (const m of [getUser, single, guard, publishFn, logAuditFn, getToken, classRow, quizRow, lessonRow]) m.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  single.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' }, error: null });
  classRow.mockResolvedValue({ data: { id: 'cl1', teacher_id: 't1', school_id: 's1', google_course_id: 'gc1' }, error: null });
  quizRow.mockResolvedValue({ data: { id: 'qz1', title: 'Chapter 3 Quiz' }, error: null });
  lessonRow.mockResolvedValue({ data: { id: 'ls1', title: 'Intro to Fractions' }, error: null });
  guard.mockResolvedValue(null); // allow by default
  getToken.mockResolvedValue('tok-abc');
  publishFn.mockResolvedValue({ google_coursework_id: 'cw1', alreadyPublished: false, courseLinkPinned: true });
  logAuditFn.mockResolvedValue(undefined);
});

const req = (body: object) =>
  new NextRequest('http://x/api/teacher/google/publish', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

// ── tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/teacher/google/publish', () => {
  // 401
  it('401 when no authenticated user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
    const { POST } = await import('@/app/api/teacher/google/publish/route');
    expect((await POST(req({ classId: 'cl1', resourceType: 'quiz', resourceId: 'qz1' }))).status).toBe(401);
  });

  // 403 non-staff
  it('403 for non-staff role (student)', async () => {
    single.mockResolvedValue({ data: { role: 'student', school_id: 's1' }, error: null });
    const { POST } = await import('@/app/api/teacher/google/publish/route');
    expect((await POST(req({ classId: 'cl1', resourceType: 'quiz', resourceId: 'qz1' }))).status).toBe(403);
    expect(guard).not.toHaveBeenCalled();
    expect(publishFn).not.toHaveBeenCalled();
  });

  // 400 missing fields
  it('400 when classId is missing', async () => {
    const { POST } = await import('@/app/api/teacher/google/publish/route');
    expect((await POST(req({ resourceType: 'quiz', resourceId: 'qz1' }))).status).toBe(400);
  });

  it('400 when resourceType is missing', async () => {
    const { POST } = await import('@/app/api/teacher/google/publish/route');
    expect((await POST(req({ classId: 'cl1', resourceId: 'qz1' }))).status).toBe(400);
  });

  it('400 when resourceId is missing', async () => {
    const { POST } = await import('@/app/api/teacher/google/publish/route');
    expect((await POST(req({ classId: 'cl1', resourceType: 'quiz' }))).status).toBe(400);
  });

  it('400 when resourceType is invalid', async () => {
    const { POST } = await import('@/app/api/teacher/google/publish/route');
    expect((await POST(req({ classId: 'cl1', resourceType: 'homework', resourceId: 'r1' }))).status).toBe(400);
  });

  // 403 guardClassAccess denies
  it('403 when guardClassAccess denies, publishFn NOT called', async () => {
    guard.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const { POST } = await import('@/app/api/teacher/google/publish/route');
    expect((await POST(req({ classId: 'cl1', resourceType: 'quiz', resourceId: 'qz1' }))).status).toBe(403);
    expect(publishFn).not.toHaveBeenCalled();
  });

  // 400 no google_course_id
  it('400 when the class has no google_course_id', async () => {
    classRow.mockResolvedValue({ data: { id: 'cl1', teacher_id: 't1', school_id: 's1', google_course_id: null }, error: null });
    const { POST } = await import('@/app/api/teacher/google/publish/route');
    expect((await POST(req({ classId: 'cl1', resourceType: 'quiz', resourceId: 'qz1' }))).status).toBe(400);
    expect(publishFn).not.toHaveBeenCalled();
  });

  // 200 success — quiz
  it('200 success (quiz): publishToClassroom called with quizId + maxPoints null, logAudit called', async () => {
    const { POST } = await import('@/app/api/teacher/google/publish/route');
    const res = await POST(req({ classId: 'cl1', resourceType: 'quiz', resourceId: 'qz1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, google_coursework_id: 'cw1', alreadyPublished: false, courseLinkPinned: true });

    expect(publishFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        token: 'tok-abc',
        schoolId: 's1',
        classId: 'cl1',
        googleCourseId: 'gc1',
        resourceType: 'quiz',
        resourceId: 'qz1',
        title: 'Chapter 3 Quiz',
        linkUrl: 'https://newcore.inteliflowai.com/?gc=quiz&id=qz1',
        courseLinkUrl: 'https://newcore.inteliflowai.com/',
        maxPoints: null,
        createdBy: 'u1',
      }),
    );

    expect(logAuditFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: 'u1',
        schoolId: 's1',
        action: 'gc.publish',
        resourceType: 'google_publication',
        resourceId: 'cw1',
        metadata: expect.objectContaining({ resource_type: 'quiz', resource_id: 'qz1' }),
      }),
    );
  });

  // 200 success — assignment
  it('200 success (assignment): resourceId=lessonId, maxPoints=100', async () => {
    const { POST } = await import('@/app/api/teacher/google/publish/route');
    const res = await POST(req({ classId: 'cl1', resourceType: 'assignment', resourceId: 'ls1' }));
    expect(res.status).toBe(200);

    expect(publishFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        resourceType: 'assignment',
        resourceId: 'ls1',
        title: 'Intro to Fractions',
        maxPoints: 100,
      }),
    );
  });

  // scope error → needsReconnect (NOT a 500)
  it('gcErrorResponse {connected:true, needsReconnect:true} on GoogleScopeError', async () => {
    const { GoogleScopeError } = await import('@/lib/google/classroom');
    publishFn.mockRejectedValue(new GoogleScopeError());
    const { POST } = await import('@/app/api/teacher/google/publish/route');
    const body = await (await POST(req({ classId: 'cl1', resourceType: 'quiz', resourceId: 'qz1' }))).json();
    expect(body).toEqual({ connected: true, needsReconnect: true });
  });

  // M5: token fetch inside try — GoogleNotConnectedError → {connected:false}, NOT a 500
  it('{connected:false} on GoogleNotConnectedError from token fetch (M5: inside try)', async () => {
    const { GoogleNotConnectedError } = await import('@/lib/google/tokens');
    getToken.mockRejectedValue(new GoogleNotConnectedError());
    const { POST } = await import('@/app/api/teacher/google/publish/route');
    const res = await POST(req({ classId: 'cl1', resourceType: 'quiz', resourceId: 'qz1' }));
    expect(res.status).toBe(200); // gcErrorResponse returns HTTP 200 for typed GC errors
    const body = await res.json();
    expect(body).toEqual({ connected: false });
    expect(publishFn).not.toHaveBeenCalled();
  });
});
