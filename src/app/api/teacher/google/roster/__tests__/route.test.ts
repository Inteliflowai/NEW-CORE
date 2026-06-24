import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const single = vi.fn();
const getValid = vi.fn();
const listCourseStudents = vi.fn();
const existing = vi.fn();   // admin users select for existsInCore
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }),
  createAdminSupabaseClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ in: existing }) }) }) }),
  }),
}));
vi.mock('@/lib/google/tokens', async () => {
  class GoogleNotConnectedError extends Error {}
  return { getValidAccessTokenForTeacher: (...a: unknown[]) => getValid(...a), GoogleNotConnectedError };
});
vi.mock('@/lib/google/classroom', async () => {
  class GoogleScopeError extends Error {}
  return { listCourseStudents: (...a: unknown[]) => listCourseStudents(...a), GoogleScopeError };
});
beforeEach(() => {
  for (const m of [getUser, single, getValid, listCourseStudents, existing]) m.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  single.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' }, error: null });
  existing.mockResolvedValue({ data: [{ email: 'a@b.edu' }], error: null });
});
const req = (qs = '?courseId=c1') => new NextRequest(`http://x/api/teacher/google/roster${qs}`);

describe('GET /api/teacher/google/roster', () => {
  it('400 without courseId', async () => {
    const { GET } = await import('@/app/api/teacher/google/roster/route');
    expect((await GET(req(''))).status).toBe(400);
  });
  it('403 for a non-teacher', async () => {
    single.mockResolvedValue({ data: { role: 'student', school_id: 's1' }, error: null });
    const { GET } = await import('@/app/api/teacher/google/roster/route');
    expect((await GET(req())).status).toBe(403);
  });
  it('annotates existsInCore by lowercased email', async () => {
    getValid.mockResolvedValue('AT');
    listCourseStudents.mockResolvedValue({ complete: true, students: [
      { googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null },
      { googleId: 'g2', name: 'B', email: 'b@b.edu', photoUrl: null },
    ] });
    const { GET } = await import('@/app/api/teacher/google/roster/route');
    const body = await (await GET(req())).json();
    expect(body.students[0]).toMatchObject({ googleId: 'g1', existsInCore: true });
    expect(body.students[1]).toMatchObject({ googleId: 'g2', existsInCore: false });
  });
  it('connected:false on GoogleNotConnectedError', async () => {
    const { GoogleNotConnectedError } = await import('@/lib/google/tokens');
    getValid.mockRejectedValue(new GoogleNotConnectedError());
    const { GET } = await import('@/app/api/teacher/google/roster/route');
    expect(await (await GET(req())).json()).toEqual({ connected: false });
  });
  it('needsReconnect on GoogleScopeError', async () => {
    getValid.mockResolvedValue('AT');
    const { GoogleScopeError } = await import('@/lib/google/classroom');
    listCourseStudents.mockRejectedValue(new GoogleScopeError());
    const { GET } = await import('@/app/api/teacher/google/roster/route');
    expect(await (await GET(req())).json()).toEqual({ connected: true, needsReconnect: true });
  });
});
