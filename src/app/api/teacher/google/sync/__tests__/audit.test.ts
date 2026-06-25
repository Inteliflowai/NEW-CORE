// @vitest-environment node
// Tests: roster.sync audit log is emitted by the /sync route (task 4).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// --- mocks ---

const getUser = vi.fn();
const single = vi.fn();
const classRow = vi.fn();
const guard = vi.fn();
const reconcile = vi.fn();
const logAuditMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }),
  createAdminSupabaseClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: classRow }) }) }) }),
}));
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess: (...a: unknown[]) => guard(...a) }));
vi.mock('@/lib/google/reconcileCourseRoster', () => ({ reconcileCourseRoster: (...a: unknown[]) => reconcile(...a) }));
vi.mock('@/lib/google/tokens', async () => { class GoogleNotConnectedError extends Error {} return { GoogleNotConnectedError }; });
vi.mock('@/lib/google/classroom', async () => { class GoogleScopeError extends Error {} return { GoogleScopeError }; });
vi.mock('@/lib/auth/roles', () => ({ STAFF_ROLES: ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'] }));
vi.mock('@/lib/audit/logAudit', () => ({ logAudit: (...a: unknown[]) => logAuditMock(...a) }));

// --- helpers ---

beforeEach(() => {
  for (const m of [getUser, single, classRow, guard, reconcile, logAuditMock]) m.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'actor-user' } }, error: null });
  single.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' }, error: null });
  classRow.mockResolvedValue({ data: { id: 'cl1', teacher_id: 't1', school_id: 's1', google_course_id: 'gc1' }, error: null });
  guard.mockResolvedValue(null);
  logAuditMock.mockResolvedValue(undefined);
});

const req = (body: object) =>
  new NextRequest('http://x/api/teacher/google/sync', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });

// --- tests ---

describe('POST /api/teacher/google/sync — roster.sync audit', () => {
  it('logs roster.sync with actor=user.id and counts when changes occurred', async () => {
    reconcile.mockResolvedValue({
      created: 0, linked: 3, skippedNoEmail: 0, skippedOther: 0,
      enrolled: 0, reactivated: 1, softRemoved: 2, errors: 0, removeSkippedSuspectEmpty: false,
    });
    const { POST } = await import('@/app/api/teacher/google/sync/route');
    await POST(req({ classId: 'cl1' }));

    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'roster.sync',
        resourceType: 'class',
        resourceId: 'cl1',
        actorId: 'actor-user',
        schoolId: 's1',
        metadata: expect.objectContaining({
          enrolled: 0,
          reactivated: 1,
          softRemoved: 2,
          skippedOther: 0,
          errors: 0,
          source: 'google',
        }),
      }),
    );
  });

  it('logs when skippedOther > 0 (seat-cap throttled adds), even if no enroll/remove counts', async () => {
    reconcile.mockResolvedValue({
      created: 0, linked: 1, skippedNoEmail: 0, skippedOther: 3,
      enrolled: 0, reactivated: 0, softRemoved: 0, errors: 0, removeSkippedSuspectEmpty: false,
    });
    const { POST } = await import('@/app/api/teacher/google/sync/route');
    await POST(req({ classId: 'cl1' }));

    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'roster.sync', metadata: expect.objectContaining({ skippedOther: 3 }) }),
    );
  });

  it('does NOT log when reconcile is a true no-op (all counts zero)', async () => {
    reconcile.mockResolvedValue({
      created: 0, linked: 5, skippedNoEmail: 0, skippedOther: 0,
      enrolled: 0, reactivated: 0, softRemoved: 0, errors: 0, removeSkippedSuspectEmpty: false,
    });
    const { POST } = await import('@/app/api/teacher/google/sync/route');
    await POST(req({ classId: 'cl1' }));

    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it('uses user.id as actorId (not cls.teacher_id) — STAFF_ROLES-wide route', async () => {
    // admin is the authenticated caller (user.id = 'admin-caller'), not the class teacher (t1)
    getUser.mockResolvedValue({ data: { user: { id: 'admin-caller' } }, error: null });
    single.mockResolvedValue({ data: { role: 'school_admin', school_id: 's1' }, error: null });
    guard.mockResolvedValue(null);
    reconcile.mockResolvedValue({
      created: 0, linked: 2, skippedNoEmail: 0, skippedOther: 0,
      enrolled: 1, reactivated: 0, softRemoved: 0, errors: 0, removeSkippedSuspectEmpty: false,
    });

    const { POST } = await import('@/app/api/teacher/google/sync/route');
    await POST(req({ classId: 'cl1' }));

    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorId: 'admin-caller' }),
    );
    // Must NOT use cls.teacher_id ('t1')
    expect(logAuditMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorId: 't1' }),
    );
  });

  it('does not log when reconcile throws (error path skips audit)', async () => {
    reconcile.mockRejectedValue(new Error('network blip'));
    const { POST } = await import('@/app/api/teacher/google/sync/route');
    await POST(req({ classId: 'cl1' }));
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
