import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── mocks ─────────────────────────────────────────────────────────────────────

const getUser = vi.fn();
const single = vi.fn();
const guard = vi.fn();
const gradePassbackFn = vi.fn();
const logAuditFn = vi.fn();
const getToken = vi.fn();

// Admin client: needs to handle:
//   classes.select().eq().maybeSingle()          → classRow
//   google_publications.select().eq().eq().eq().maybeSingle() → pubRow
//   google_publications.update().eq()            → updatePub
const classRow = vi.fn();
const pubRow = vi.fn();
const updatePub = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
  }),
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'classes') {
        return { select: () => ({ eq: () => ({ maybeSingle: classRow }) }) };
      }
      if (table === 'google_publications') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: pubRow }),
              }),
            }),
          }),
          update: () => ({ eq: updatePub }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }) };
    },
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
vi.mock('@/lib/google/gradePassback', () => ({ gradePassback: (...a: unknown[]) => gradePassbackFn(...a) }));
vi.mock('@/lib/audit/logAudit', () => ({ logAudit: (...a: unknown[]) => logAuditFn(...a) }));

// ── helpers ──────────────────────────────────────────────────────────────────

const PUB = {
  id: 'pub1',
  resource_type: 'assignment',
  resource_id: 'ls1',
  google_course_id: 'gc1',
  google_coursework_id: 'cw1',
  grade_passback_enabled: true,
  max_points: 100,
};

const PASSBACK_RESULT = {
  pushed: 3,
  skipped_not_linked: 1,
  not_posted_in_classroom: false,
  errors: 0,
};

beforeEach(() => {
  for (const m of [getUser, single, guard, gradePassbackFn, logAuditFn, getToken, classRow, pubRow, updatePub]) m.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  single.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' }, error: null });
  classRow.mockResolvedValue({ data: { id: 'cl1', teacher_id: 't1', school_id: 's1', google_course_id: 'gc1' }, error: null });
  pubRow.mockResolvedValue({ data: PUB, error: null });
  guard.mockResolvedValue(null); // allow by default
  getToken.mockResolvedValue('tok-abc');
  gradePassbackFn.mockResolvedValue(PASSBACK_RESULT);
  logAuditFn.mockResolvedValue(undefined);
  updatePub.mockResolvedValue({ error: null });
});

const req = (body: object) =>
  new NextRequest('http://x/api/teacher/google/grade-passback', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

// ── tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/teacher/google/grade-passback', () => {
  // 401
  it('401 when no authenticated user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
    const { POST } = await import('@/app/api/teacher/google/grade-passback/route');
    expect((await POST(req({ classId: 'cl1', lessonId: 'ls1' }))).status).toBe(401);
  });

  // 403 non-staff
  it('403 for non-staff role (student)', async () => {
    single.mockResolvedValue({ data: { role: 'student', school_id: 's1' }, error: null });
    const { POST } = await import('@/app/api/teacher/google/grade-passback/route');
    expect((await POST(req({ classId: 'cl1', lessonId: 'ls1' }))).status).toBe(403);
    expect(guard).not.toHaveBeenCalled();
    expect(gradePassbackFn).not.toHaveBeenCalled();
  });

  // 400 missing fields
  it('400 when classId is missing', async () => {
    const { POST } = await import('@/app/api/teacher/google/grade-passback/route');
    expect((await POST(req({ lessonId: 'ls1' }))).status).toBe(400);
  });

  it('400 when lessonId is missing', async () => {
    const { POST } = await import('@/app/api/teacher/google/grade-passback/route');
    expect((await POST(req({ classId: 'cl1' }))).status).toBe(400);
  });

  // 403 guardClassAccess denies
  it('403 when guardClassAccess denies, gradePassback NOT called', async () => {
    guard.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const { POST } = await import('@/app/api/teacher/google/grade-passback/route');
    expect((await POST(req({ classId: 'cl1', lessonId: 'ls1' }))).status).toBe(403);
    expect(gradePassbackFn).not.toHaveBeenCalled();
  });

  // 400 no google_course_id
  it('400 when the class has no google_course_id', async () => {
    classRow.mockResolvedValue({ data: { id: 'cl1', teacher_id: 't1', school_id: 's1', google_course_id: null }, error: null });
    const { POST } = await import('@/app/api/teacher/google/grade-passback/route');
    expect((await POST(req({ classId: 'cl1', lessonId: 'ls1' }))).status).toBe(400);
    expect(gradePassbackFn).not.toHaveBeenCalled();
  });

  // 400 not_published — no publication row
  it('400 {error:not_published} when no google_publications row found', async () => {
    pubRow.mockResolvedValue({ data: null, error: null });
    const { POST } = await import('@/app/api/teacher/google/grade-passback/route');
    const res = await POST(req({ classId: 'cl1', lessonId: 'ls1' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'not_published' });
    expect(gradePassbackFn).not.toHaveBeenCalled();
  });

  // 400 not_published — grade_passback_enabled false
  it('400 {error:not_published} when grade_passback_enabled is false', async () => {
    pubRow.mockResolvedValue({ data: { ...PUB, grade_passback_enabled: false }, error: null });
    const { POST } = await import('@/app/api/teacher/google/grade-passback/route');
    const res = await POST(req({ classId: 'cl1', lessonId: 'ls1' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'not_published' });
    expect(gradePassbackFn).not.toHaveBeenCalled();
  });

  // 200 success
  it('200 success: gradePassback + logAudit called; returns {ok:true, ...result}', async () => {
    const { POST } = await import('@/app/api/teacher/google/grade-passback/route');
    const res = await POST(req({ classId: 'cl1', lessonId: 'ls1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      pushed: 3,
      skipped_not_linked: 1,
      not_posted_in_classroom: false,
      errors: 0,
    });

    expect(gradePassbackFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        token: 'tok-abc',
        schoolId: 's1',
        classId: 'cl1',
        lessonId: 'ls1',
        googleCourseId: 'gc1',
        courseWorkId: 'cw1',
        maxPoints: 100,
      }),
    );

    expect(logAuditFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: 'u1',
        schoolId: 's1',
        action: 'gc.grade_passback',
        resourceType: 'google_publication',
        resourceId: 'cw1',
        metadata: expect.objectContaining({ pushed: 3, errors: 0 }),
      }),
    );

    // Clean run (errors=0) → update IS called to clear any stale last_sync_error (minor-fix).
    expect(updatePub).toHaveBeenCalledWith('id', 'pub1');
  });

  // last_sync_error written when errors > 0
  it('writes last_sync_error when gradePassback returns errors > 0', async () => {
    gradePassbackFn.mockResolvedValue({ ...PASSBACK_RESULT, pushed: 2, errors: 1 });
    const { POST } = await import('@/app/api/teacher/google/grade-passback/route');
    const res = await POST(req({ classId: 'cl1', lessonId: 'ls1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, errors: 1 });

    expect(updatePub).toHaveBeenCalledWith('id', 'pub1');
  });

  // scope error → needsReconnect (NOT a 500)
  it('gcErrorResponse {connected:true, needsReconnect:true} on GoogleScopeError', async () => {
    const { GoogleScopeError } = await import('@/lib/google/classroom');
    gradePassbackFn.mockRejectedValue(new GoogleScopeError());
    const { POST } = await import('@/app/api/teacher/google/grade-passback/route');
    const body = await (await POST(req({ classId: 'cl1', lessonId: 'ls1' }))).json();
    expect(body).toEqual({ connected: true, needsReconnect: true });
  });

  // M5: token fetch inside try — GoogleNotConnectedError → {connected:false}, NOT a 500
  it('{connected:false} on GoogleNotConnectedError from token fetch (M5: inside try)', async () => {
    const { GoogleNotConnectedError } = await import('@/lib/google/tokens');
    getToken.mockRejectedValue(new GoogleNotConnectedError());
    const { POST } = await import('@/app/api/teacher/google/grade-passback/route');
    const res = await POST(req({ classId: 'cl1', lessonId: 'ls1' }));
    expect(res.status).toBe(200); // gcErrorResponse returns HTTP 200 for typed GC errors
    const body = await res.json();
    expect(body).toEqual({ connected: false });
    expect(gradePassbackFn).not.toHaveBeenCalled();
  });
});
