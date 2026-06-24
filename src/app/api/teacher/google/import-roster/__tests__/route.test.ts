import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const single = vi.fn();
const reconcile = vi.fn();
const existingClass = vi.fn();   // classes.maybeSingle()
const classUpdate = vi.fn();
const classInsert = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'classes') return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: existingClass }) }) }),
        update: (v: unknown) => { classUpdate(v); return { eq: () => ({ eq: async () => ({ error: null }) }) }; },
        insert: (v: unknown) => { classInsert(v); return { select: () => ({ single: async () => ({ data: { id: 'newCls' }, error: null }) }) }; },
      };
      return {};
    },
  }),
}));
vi.mock('@/lib/google/reconcileCourseRoster', () => ({ reconcileCourseRoster: (...a: unknown[]) => reconcile(...a) }));
vi.mock('@/lib/google/tokens', async () => { class GoogleNotConnectedError extends Error {} return { GoogleNotConnectedError }; });
vi.mock('@/lib/google/classroom', async () => { class GoogleScopeError extends Error {} return { GoogleScopeError }; });

beforeEach(() => {
  for (const m of [getUser, single, reconcile, existingClass, classUpdate, classInsert]) m.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  single.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' }, error: null });
  existingClass.mockResolvedValue({ data: null, error: null });
  reconcile.mockResolvedValue({ created: 2, linked: 1, skippedNoEmail: 1, skippedOther: 0, enrolled: 3, reactivated: 0, softRemoved: 0, errors: 0, removeSkippedSuspectEmpty: false });
});
function req(body: object) {
  return new NextRequest('http://x/api/teacher/google/import-roster', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}

describe('POST /api/teacher/google/import-roster', () => {
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
    expect(classInsert).toHaveBeenCalledWith(expect.objectContaining({ google_course_id: 'c1', teacher_id: 'u1', school_id: 's1', subject: 'Math', grade_level: '8', name: 'Math' }));
    expect(reconcile).toHaveBeenCalledWith(expect.anything(), { teacherId: 'u1', schoolId: 's1', googleCourseId: 'c1', classId: 'newCls' });
    expect(body).toMatchObject({ classId: 'newCls', created: 2, linked: 1, skippedNoEmail: 1 });
  });
  it('on re-import (by the OWNING teacher) updates name only — NEVER overwrites teacher-edited subject/grade', async () => {
    existingClass.mockResolvedValue({ data: { id: 'oldCls', teacher_id: 'u1' }, error: null });   // u1 owns it
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    await POST(req({ courseId: 'c1', name: 'Math 2', subject: 'Science', gradeLevel: '9' }));
    const updateArg = classUpdate.mock.calls[0][0] as Record<string, unknown>;
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
    expect(classUpdate).not.toHaveBeenCalled();
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
});
