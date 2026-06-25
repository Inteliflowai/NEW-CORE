// @vitest-environment node
// Tests: roster.sync audit log is emitted by the nightly gc-roster-sync cron (task 4).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// --- mocks ---

const reconcile = vi.fn();
const connectionsList = vi.fn();
const classesFor = vi.fn();
const logAuditMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'google_connections') {
        return { select: () => ({ order: () => ({ then: (r: (v: { data: unknown; error: null }) => unknown) => r({ data: connectionsList(), error: null }) }) }) };
      }
      return { select: () => ({ eq: () => ({ not: () => ({ then: (r: (v: { data: unknown; error: null }) => unknown) => r({ data: classesFor(), error: null }) }) }) }) };
    },
  }),
}));
vi.mock('@/lib/google/reconcileCourseRoster', () => ({ reconcileCourseRoster: (...a: unknown[]) => reconcile(...a) }));
vi.mock('@/lib/google/tokens', async () => { class GoogleNotConnectedError extends Error {} return { GoogleNotConnectedError }; });
vi.mock('@/lib/google/classroom', async () => { class GoogleScopeError extends Error {} return { GoogleScopeError }; });
vi.mock('@/lib/audit/logAudit', () => ({ logAudit: (...a: unknown[]) => logAuditMock(...a) }));

// --- helpers ---

const RESULT_NOOP = {
  created: 0, linked: 1, skippedNoEmail: 0, skippedOther: 0,
  enrolled: 0, reactivated: 0, softRemoved: 0, errors: 0, removeSkippedSuspectEmpty: false,
};

beforeEach(() => {
  process.env.CRON_SECRET = 'sek';
  for (const m of [reconcile, connectionsList, classesFor, logAuditMock]) m.mockReset();
  logAuditMock.mockResolvedValue(undefined);
});

function req(opts: { bearer?: string; xheader?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  if (opts.xheader) headers['x-cron-secret'] = opts.xheader;
  return new NextRequest('http://x/api/cron/gc-roster-sync', { method: 'POST', headers });
}

// --- tests ---

describe('POST /api/cron/gc-roster-sync — roster.sync audit', () => {
  it('logs roster.sync with actorId:null (system) and counts for a changed class', async () => {
    connectionsList.mockReturnValue([{ user_id: 't1', school_id: 's1' }]);
    classesFor.mockReturnValueOnce([{ id: 'cl1', google_course_id: 'gc1', school_id: 's1' }]);
    reconcile.mockResolvedValue({
      created: 0, linked: 1, skippedNoEmail: 0, skippedOther: 0,
      enrolled: 0, reactivated: 1, softRemoved: 2, errors: 0, removeSkippedSuspectEmpty: false,
    });

    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    await POST(req({ xheader: 'sek' }));

    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'roster.sync',
        resourceType: 'class',
        resourceId: 'cl1',
        actorId: null,
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

  it('logs once per changed class (two classes → two audit entries)', async () => {
    connectionsList.mockReturnValue([{ user_id: 't1', school_id: 's1' }, { user_id: 't2', school_id: 's2' }]);
    classesFor
      .mockReturnValueOnce([{ id: 'cl1', google_course_id: 'gc1', school_id: 'classS1' }])
      .mockReturnValueOnce([{ id: 'cl2', google_course_id: 'gc2', school_id: 's2' }]);
    const CHANGED = { ...RESULT_NOOP, softRemoved: 1 };
    reconcile.mockResolvedValue(CHANGED);

    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    await POST(req({ xheader: 'sek' }));

    expect(logAuditMock).toHaveBeenCalledTimes(2);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resourceId: 'cl1', actorId: null, schoolId: 'classS1' }),
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resourceId: 'cl2', actorId: null, schoolId: 's2' }),
    );
  });

  it('does NOT log for a true no-op class (all counts zero)', async () => {
    connectionsList.mockReturnValue([{ user_id: 't1', school_id: 's1' }]);
    classesFor.mockReturnValueOnce([{ id: 'cl1', google_course_id: 'gc1', school_id: 's1' }]);
    reconcile.mockResolvedValue(RESULT_NOOP);

    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    await POST(req({ xheader: 'sek' }));

    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it('does not log for a class whose reconcile throws (error path skips audit)', async () => {
    connectionsList.mockReturnValue([{ user_id: 't1', school_id: 's1' }]);
    classesFor.mockReturnValueOnce([{ id: 'cl1', google_course_id: 'gc1', school_id: 's1' }]);
    reconcile.mockRejectedValue(new Error('transient blip'));

    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    await POST(req({ xheader: 'sek' }));

    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it('uses the class school_id (c.school_id), not the connection school_id', async () => {
    connectionsList.mockReturnValue([{ user_id: 't1', school_id: 'connSchool' }]);
    classesFor.mockReturnValueOnce([{ id: 'cl1', google_course_id: 'gc1', school_id: 'classSchool' }]);
    reconcile.mockResolvedValue({ ...RESULT_NOOP, enrolled: 1 });

    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    await POST(req({ xheader: 'sek' }));

    expect(logAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ schoolId: 'classSchool' }),
    );
    expect(logAuditMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ schoolId: 'connSchool' }),
    );
  });
});
