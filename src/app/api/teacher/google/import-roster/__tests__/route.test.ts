import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const logAudit = vi.fn();
vi.mock('@/lib/audit/logAudit', () => ({ logAudit: (...a: unknown[]) => logAudit(...a) }));

const getUser = vi.fn();
const single = vi.fn();
const reconcile = vi.fn();
const existingClass = vi.fn();   // classes select → maybeSingle(); used for BOTH the initial lookup
                                  // and the re-read after a 23505 INSERT race (via mockResolvedValueOnce)
const classUpdateResult = vi.fn(); // resolves { error } — the result of the final .eq() in the update chain
const classUpdateSpy = vi.fn();    // records the value passed to .update(v)
const classInsertResult = vi.fn(); // resolves { data, error } — the result of .single() in the insert chain
const classInsertSpy = vi.fn();    // records the value passed to .insert(v)
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'classes') return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: existingClass }) }) }),
        update: (v: unknown) => { classUpdateSpy(v); return { eq: () => classUpdateResult() }; },
        insert: (v: unknown) => { classInsertSpy(v); return { select: () => ({ single: () => classInsertResult() }) }; },
      };
      return {};
    },
  }),
}));
vi.mock('@/lib/google/reconcileCourseRoster', () => ({ reconcileCourseRoster: (...a: unknown[]) => reconcile(...a) }));
vi.mock('@/lib/google/tokens', async () => { class GoogleNotConnectedError extends Error {} return { GoogleNotConnectedError }; });
vi.mock('@/lib/google/classroom', async () => { class GoogleScopeError extends Error {} return { GoogleScopeError }; });

beforeEach(() => {
  for (const m of [logAudit, getUser, single, reconcile, existingClass, classUpdateResult, classUpdateSpy, classInsertResult, classInsertSpy]) m.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  single.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' }, error: null });
  existingClass.mockResolvedValue({ data: null, error: null });
  classUpdateResult.mockResolvedValue({ error: null });
  classInsertResult.mockResolvedValue({ data: { id: 'newCls' }, error: null });
  reconcile.mockResolvedValue({ created: 2, linked: 1, skippedNoEmail: 1, skippedOther: 0, enrolled: 3, reactivated: 0, softRemoved: 0, errors: 0, removeSkippedSuspectEmpty: false });
});
function req(body: object) {
  return new NextRequest('http://x/api/teacher/google/import-roster', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}

describe('POST /api/teacher/google/import-roster', () => {
  it('401 when auth.getUser returns no user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    expect((await POST(req({ courseId: 'c1', name: 'Math' }))).status).toBe(401);
  });
  it('403 when the teacher profile has no school_id (null)', async () => {
    single.mockResolvedValue({ data: { role: 'teacher', school_id: null }, error: null });
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    expect((await POST(req({ courseId: 'c1', name: 'Math' }))).status).toBe(403);
  });
  it('403 for a non-teacher', async () => {
    single.mockResolvedValue({ data: { role: 'student', school_id: 's1' }, error: null });
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    expect((await POST(req({ courseId: 'c1', name: 'Math' }))).status).toBe(403);
  });
  it('400 without courseId/name', async () => {
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    expect((await POST(req({ courseId: 'c1' }))).status).toBe(400);
  });
  it('inserts a new class with teacher-confirmed subject/grade then reconciles', async () => {
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    const body = await (await POST(req({ courseId: 'c1', name: 'Math', subject: 'Math', gradeLevel: '8' }))).json();
    expect(classInsertSpy).toHaveBeenCalledWith(expect.objectContaining({ google_course_id: 'c1', teacher_id: 'u1', school_id: 's1', subject: 'Math', grade_level: '8', name: 'Math' }));
    expect(reconcile).toHaveBeenCalledWith(expect.anything(), { teacherId: 'u1', schoolId: 's1', googleCourseId: 'c1', classId: 'newCls' });
    expect(body).toMatchObject({ classId: 'newCls', created: 2, linked: 1, skippedNoEmail: 1 });
  });
  it('on re-import (by the OWNING teacher) updates name only — NEVER overwrites teacher-edited subject/grade', async () => {
    existingClass.mockResolvedValue({ data: { id: 'oldCls', teacher_id: 'u1' }, error: null });   // u1 owns it
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    await POST(req({ courseId: 'c1', name: 'Math 2', subject: 'Science', gradeLevel: '9' }));
    const updateArg = classUpdateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect('subject' in updateArg).toBe(false);
    expect('grade_level' in updateArg).toBe(false);
    expect(updateArg.name).toBe('Math 2');
    expect(reconcile).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ classId: 'oldCls' }));
  });
  it('IMP-6: a different same-school teacher re-importing an already-imported course → 403, engine NOT called', async () => {
    existingClass.mockResolvedValue({ data: { id: 'oldCls', teacher_id: 'otherTeacher' }, error: null });   // owned by someone else
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    const res = await POST(req({ courseId: 'c1', name: 'Math', subject: 'Math', gradeLevel: '8' }));
    expect(res.status).toBe(403);
    expect(reconcile).not.toHaveBeenCalled();
    expect(classUpdateSpy).not.toHaveBeenCalled();
  });
  it('connected:false on GoogleNotConnectedError from the engine', async () => {
    const { GoogleNotConnectedError } = await import('@/lib/google/tokens');
    reconcile.mockRejectedValue(new GoogleNotConnectedError());
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    expect(await (await POST(req({ courseId: 'c1', name: 'Math' }))).json()).toEqual({ connected: false });
  });
  it('500 enveloped (no raw leak) on an unexpected engine error', async () => {
    reconcile.mockRejectedValue(new Error('secret db detail'));
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    const res = await POST(req({ courseId: 'c1', name: 'Math' }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret db detail');
  });

  // Fix (1): concurrent first-import race — INSERT returns 23505
  it('23505 INSERT race, re-lookup finds the row owned by the same user → reconcile proceeds', async () => {
    // First maybeSingle (initial lookup): no row yet
    existingClass.mockResolvedValueOnce({ data: null, error: null });
    // INSERT fails with unique-violation
    classInsertResult.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate key' } });
    // Second maybeSingle (re-read after 23505): finds the row owned by the same user
    existingClass.mockResolvedValueOnce({ data: { id: 'racedCls', teacher_id: 'u1' }, error: null });
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    const res = await POST(req({ courseId: 'c1', name: 'Math' }));
    expect(res.status).toBe(200);
    expect(reconcile).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ classId: 'racedCls' }));
  });

  it('23505 INSERT race, re-lookup finds a row owned by a DIFFERENT teacher → 403, engine NOT called', async () => {
    // First maybeSingle (initial lookup): no row yet
    existingClass.mockResolvedValueOnce({ data: null, error: null });
    // INSERT fails with unique-violation
    classInsertResult.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate key' } });
    // Second maybeSingle (re-read after 23505): finds the row owned by a different teacher
    existingClass.mockResolvedValueOnce({ data: { id: 'racedCls', teacher_id: 'otherTeacher' }, error: null });
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    const res = await POST(req({ courseId: 'c1', name: 'Math' }));
    expect(res.status).toBe(403);
    expect(reconcile).not.toHaveBeenCalled();
  });

  // Fix (2): class read error returns 500 (not a fall-through to INSERT)
  it('500 when the initial class read (maybeSingle) returns a DB error', async () => {
    existingClass.mockResolvedValueOnce({ data: null, error: { message: 'db connection failed' } });
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    const res = await POST(req({ courseId: 'c1', name: 'Math' }));
    expect(res.status).toBe(500);
    expect(reconcile).not.toHaveBeenCalled();
    expect(classInsertSpy).not.toHaveBeenCalled();
  });

  // Fix (3): class name-UPDATE error is non-fatal — reconcile still runs
  it('class name-UPDATE error is non-fatal — reconcile still runs', async () => {
    existingClass.mockResolvedValue({ data: { id: 'oldCls', teacher_id: 'u1' }, error: null });
    classUpdateResult.mockResolvedValue({ error: { message: 'update failed' } });
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    const res = await POST(req({ courseId: 'c1', name: 'Math Renamed' }));
    expect(res.status).toBe(200);
    expect(reconcile).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ classId: 'oldCls' }));
  });

  // Audit: logAudit wired on import (via:'import' distinguishes first import from recurring sync)
  it('logs roster.sync with via:import when reconcile reports changes', async () => {
    // Default reconcile returns enrolled:3 — satisfies the change-guard
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    await POST(req({ courseId: 'c1', name: 'Math' }));
    expect(logAudit).toHaveBeenCalledTimes(1);
    const [, entry] = logAudit.mock.calls[0];
    expect(entry).toMatchObject({ action: 'roster.sync', resourceType: 'class', resourceId: 'newCls' });
    expect(entry.metadata).toMatchObject({ enrolled: 3, source: 'google', via: 'import' });
  });

  it('does NOT log when reconcile reports no changes (no-op import)', async () => {
    reconcile.mockResolvedValueOnce({ created: 0, linked: 0, skippedNoEmail: 0, skippedOther: 0, enrolled: 0, reactivated: 0, softRemoved: 0, errors: 0, removeSkippedSuspectEmpty: false });
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    await POST(req({ courseId: 'c1', name: 'Math' }));
    expect(logAudit).not.toHaveBeenCalled();
  });
});
