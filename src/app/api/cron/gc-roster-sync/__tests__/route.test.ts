import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const reconcile = vi.fn();
const connectionsList = vi.fn();   // google_connections select (ordered)
const classesFor = vi.fn();        // classes select by teacher

vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'google_connections') {
        // select('user_id, school_id').order('connected_at') -> rows
        return { select: () => ({ order: () => ({ then: (r: (v: { data: unknown; error: null }) => unknown) => r({ data: connectionsList(), error: null }) }) }) };
      }
      // classes: select('id, google_course_id, school_id').eq(teacher).not(google_course_id) -> rows
      return { select: () => ({ eq: () => ({ not: () => ({ then: (r: (v: { data: unknown; error: null }) => unknown) => r({ data: classesFor(), error: null }) }) }) }) };
    },
  }),
}));
vi.mock('@/lib/google/reconcileCourseRoster', () => ({ reconcileCourseRoster: (...a: unknown[]) => reconcile(...a) }));
vi.mock('@/lib/google/tokens', async () => { class GoogleNotConnectedError extends Error {} return { GoogleNotConnectedError }; });
vi.mock('@/lib/google/classroom', async () => { class GoogleScopeError extends Error {} return { GoogleScopeError }; });

const RESULT = { created: 0, linked: 1, skippedNoEmail: 0, skippedOther: 0, enrolled: 0, reactivated: 0, softRemoved: 0, errors: 0, removeSkippedSuspectEmpty: false };

beforeEach(() => {
  process.env.CRON_SECRET = 'sek';
  reconcile.mockReset(); connectionsList.mockReset(); classesFor.mockReset();
  reconcile.mockResolvedValue(RESULT);
});
function req(opts: { bearer?: string; xheader?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  if (opts.xheader) headers['x-cron-secret'] = opts.xheader;
  return new NextRequest('http://x/api/cron/gc-roster-sync', { method: 'POST', headers });
}

describe('POST /api/cron/gc-roster-sync', () => {
  it('401 without the cron secret', async () => {
    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    expect((await POST(req())).status).toBe(401);
  });
  it('401 with a wrong secret', async () => {
    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    expect((await POST(req({ xheader: 'nope' }))).status).toBe(401);
  });
  it('accepts the x-cron-secret header', async () => {
    connectionsList.mockReturnValue([]);
    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    expect((await POST(req({ xheader: 'sek' }))).status).toBe(200);
  });
  it('accepts the Authorization: Bearer header (Vercel Cron mechanism — IMP-8)', async () => {
    connectionsList.mockReturnValue([]);
    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    expect((await POST(req({ bearer: 'sek' }))).status).toBe(200);
  });
  it('reconciles every GC-mirrored class, passing the CLASS school_id (IMP-7)', async () => {
    connectionsList.mockReturnValue([{ user_id: 't1', school_id: 'connSchool' }, { user_id: 't2', school_id: 's2' }]);
    classesFor
      .mockReturnValueOnce([{ id: 'cl1', google_course_id: 'c1', school_id: 'classSchool' }])   // t1 — class school DIFFERS from conn
      .mockReturnValueOnce([{ id: 'cl2', google_course_id: 'c2', school_id: 's2' }]);            // t2
    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    const body = await (await POST(req({ xheader: 'sek' }))).json();
    expect(reconcile).toHaveBeenCalledTimes(2);
    // the CLASS's school_id is passed, NOT the connection's:
    expect(reconcile).toHaveBeenCalledWith(expect.anything(), { teacherId: 't1', schoolId: 'classSchool', googleCourseId: 'c1', classId: 'cl1' });
    expect(body).toMatchObject({ ok: true, teachers: 2, classes: 2, reconciled: 2, errors: 0, truncated: false });
  });
  it('isolates a bad/revoked connection: flags reconnect (with reason), does NOT abort the run', async () => {
    connectionsList.mockReturnValue([{ user_id: 't1', school_id: 's1' }, { user_id: 't2', school_id: 's2' }]);
    classesFor
      .mockReturnValueOnce([{ id: 'cl1', google_course_id: 'c1', school_id: 's1' }])
      .mockReturnValueOnce([{ id: 'cl2', google_course_id: 'c2', school_id: 's2' }]);
    const { GoogleNotConnectedError } = await import('@/lib/google/tokens');
    reconcile
      .mockRejectedValueOnce(new GoogleNotConnectedError())   // t1 revoked
      .mockResolvedValueOnce(RESULT);                         // t2 ok
    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    const body = await (await POST(req({ xheader: 'sek' }))).json();
    expect(reconcile).toHaveBeenCalledTimes(2);    // did NOT abort after t1 threw
    expect(body.ok).toBe(true);
    expect(body.reconciled).toBe(1);
    expect(body.flaggedReconnect).toContainEqual({ teacherId: 't1', reason: 'not_connected' });
    expect(body.errors).toBe(0);   // a not-connected is a flag, not a hard error
  });
  it('treats a token-refresh failure as grant-level: flags reconnect + breaks (IMP-10), one entry not N', async () => {
    connectionsList.mockReturnValue([{ user_id: 't1', school_id: 's1' }]);
    classesFor.mockReturnValueOnce([
      { id: 'cl1', google_course_id: 'c1', school_id: 's1' },
      { id: 'cl2', google_course_id: 'c2', school_id: 's1' },   // a second class for the same teacher
    ]);
    reconcile.mockRejectedValue(new Error('google token refresh failed: 400'));  // plain Error, not typed
    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    const body = await (await POST(req({ xheader: 'sek' }))).json();
    expect(reconcile).toHaveBeenCalledTimes(1);   // broke after the first class — did NOT re-hammer the refresh
    expect(body.flaggedReconnect).toContainEqual({ teacherId: 't1', reason: 'refresh_failed' });
    expect(body.errors).toBe(0);
  });
  it('a non-grant error increments errors and CONTINUES to the next class', async () => {
    connectionsList.mockReturnValue([{ user_id: 't1', school_id: 's1' }]);
    classesFor.mockReturnValueOnce([
      { id: 'cl1', google_course_id: 'c1', school_id: 's1' },
      { id: 'cl2', google_course_id: 'c2', school_id: 's1' },
    ]);
    reconcile.mockRejectedValueOnce(new Error('transient db blip')).mockResolvedValueOnce(RESULT);
    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    const body = await (await POST(req({ xheader: 'sek' }))).json();
    expect(reconcile).toHaveBeenCalledTimes(2);   // did NOT break — continued to cl2
    expect(body.errors).toBe(1);
    expect(body.reconciled).toBe(1);
  });

  // MIN-6: aggregated observability
  it('MIN-6: summary includes guardTripped and engineErrors aggregates', async () => {
    connectionsList.mockReturnValue([{ user_id: 't1', school_id: 's1' }]);
    classesFor.mockReturnValueOnce([
      { id: 'cl1', google_course_id: 'c1', school_id: 's1' },
      { id: 'cl2', google_course_id: 'c2', school_id: 's1' },
    ]);
    // cl1: guard tripped + 2 engine errors; cl2: clean
    reconcile
      .mockResolvedValueOnce({ ...RESULT, removeSkippedSuspectEmpty: true, errors: 2 })
      .mockResolvedValueOnce(RESULT);
    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    const body = await (await POST(req({ xheader: 'sek' }))).json();
    expect(body.guardTripped).toBe(1);
    expect(body.engineErrors).toBe(2);
    expect(body.reconciled).toBe(2);
    expect(body.errors).toBe(0);   // throw-level errors vs engine-level are separate
  });

  // MIN-7: null school_id skips
  it('MIN-7: conn.school_id===null → skipped (not passed to engine)', async () => {
    connectionsList.mockReturnValue([{ user_id: 't1', school_id: null }]);
    classesFor.mockReturnValue([{ id: 'cl1', google_course_id: 'c1', school_id: 's1' }]);
    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    const body = await (await POST(req({ xheader: 'sek' }))).json();
    expect(reconcile).not.toHaveBeenCalled();
    expect(body.classes).toBe(0);
  });

  it('MIN-7: class.school_id===null → skipped (not passed to engine)', async () => {
    connectionsList.mockReturnValue([{ user_id: 't1', school_id: 's1' }]);
    classesFor.mockReturnValueOnce([
      { id: 'cl1', google_course_id: 'c1', school_id: null },    // no school — skip
      { id: 'cl2', google_course_id: 'c2', school_id: 's1' },    // ok — reconcile
    ]);
    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    const body = await (await POST(req({ xheader: 'sek' }))).json();
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ classId: 'cl2' }));
    expect(body.classes).toBe(1);   // only cl2 was counted (cl1 skipped before classesSeen++)
  });
});
