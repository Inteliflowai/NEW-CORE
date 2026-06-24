import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const getUser = vi.fn();
const single = vi.fn();
const classRow = vi.fn();    // classes.maybeSingle()
const guard = vi.fn();
const reconcile = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }),
  createAdminSupabaseClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: classRow }) }) }) }),
}));
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess: (...a: unknown[]) => guard(...a) }));
vi.mock('@/lib/google/reconcileCourseRoster', () => ({ reconcileCourseRoster: (...a: unknown[]) => reconcile(...a) }));
vi.mock('@/lib/google/tokens', async () => { class GoogleNotConnectedError extends Error {} return { GoogleNotConnectedError }; });
vi.mock('@/lib/google/classroom', async () => { class GoogleScopeError extends Error {} return { GoogleScopeError }; });
vi.mock('@/lib/auth/roles', () => ({ STAFF_ROLES: ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'] }));

beforeEach(() => {
  for (const m of [getUser, single, classRow, guard, reconcile]) m.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  single.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' }, error: null });
  classRow.mockResolvedValue({ data: { id: 'cl1', teacher_id: 't1', school_id: 's1', google_course_id: 'c1' }, error: null });
  // REAL guardClassAccess contract: null = proceed; a NextResponse = deny. Default: allow.
  guard.mockResolvedValue(null);
  reconcile.mockResolvedValue({ created: 0, linked: 3, skippedNoEmail: 0, skippedOther: 0, enrolled: 0, reactivated: 1, softRemoved: 1, errors: 0, removeSkippedSuspectEmpty: false });
});
const req = (body: object) => new NextRequest('http://x/api/teacher/google/sync', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe('POST /api/teacher/google/sync', () => {
  it('400 without classId', async () => {
    const { POST } = await import('@/app/api/teacher/google/sync/route');
    expect((await POST(req({}))).status).toBe(400);
  });
  it('returns the guard NextResponse as-is when guardClassAccess denies (403), engine NOT called', async () => {
    guard.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const { POST } = await import('@/app/api/teacher/google/sync/route');
    expect((await POST(req({ classId: 'cl1' }))).status).toBe(403);
    expect(reconcile).not.toHaveBeenCalled();
  });
  it('400 when the class is not GC-mirrored (no google_course_id)', async () => {
    classRow.mockResolvedValue({ data: { id: 'cl1', teacher_id: 't1', school_id: 's1', google_course_id: null }, error: null });
    const { POST } = await import('@/app/api/teacher/google/sync/route');
    expect((await POST(req({ classId: 'cl1' }))).status).toBe(400);
  });
  it('reconciles as the teacher-of-record and returns the result', async () => {
    const { POST } = await import('@/app/api/teacher/google/sync/route');
    const body = await (await POST(req({ classId: 'cl1' }))).json();
    expect(reconcile).toHaveBeenCalledWith(expect.anything(), { teacherId: 't1', schoolId: 's1', googleCourseId: 'c1', classId: 'cl1' });
    expect(body).toMatchObject({ classId: 'cl1', linked: 3, softRemoved: 1, reactivated: 1 });
  });
  it('connected:false on GoogleNotConnectedError', async () => {
    const { GoogleNotConnectedError } = await import('@/lib/google/tokens');
    reconcile.mockRejectedValue(new GoogleNotConnectedError());
    const { POST } = await import('@/app/api/teacher/google/sync/route');
    expect(await (await POST(req({ classId: 'cl1' }))).json()).toEqual({ connected: false });
  });

  // --- STAFF_ROLES widening ---

  it('school_admin whose guardClassAccess allows: reconcile runs as class teacher-of-record', async () => {
    single.mockResolvedValue({ data: { role: 'school_admin', school_id: 's1' }, error: null });
    guard.mockResolvedValue(null); // same-school admin permitted
    const { POST } = await import('@/app/api/teacher/google/sync/route');
    const body = await (await POST(req({ classId: 'cl1' }))).json();
    expect(reconcile).toHaveBeenCalledWith(expect.anything(), { teacherId: 't1', schoolId: 's1', googleCourseId: 'c1', classId: 'cl1' });
    expect(body).toMatchObject({ classId: 'cl1', linked: 3 });
  });

  it('school_admin whose guardClassAccess denies: returns 403 as-is, engine NOT called', async () => {
    single.mockResolvedValue({ data: { role: 'school_admin', school_id: 's1' }, error: null });
    guard.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const { POST } = await import('@/app/api/teacher/google/sync/route');
    expect((await POST(req({ classId: 'cl1' }))).status).toBe(403);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('non-staff role (student) → 403 before any class lookup', async () => {
    single.mockResolvedValue({ data: { role: 'student', school_id: 's1' }, error: null });
    const { POST } = await import('@/app/api/teacher/google/sync/route');
    expect((await POST(req({ classId: 'cl1' }))).status).toBe(403);
    expect(guard).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });
});
