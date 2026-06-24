import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const single = vi.fn();
const getValid = vi.fn();
const listCourses = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }),
  createAdminSupabaseClient: () => ({}),
}));
vi.mock('@/lib/google/tokens', async () => {
  class GoogleNotConnectedError extends Error {}
  return { getValidAccessTokenForTeacher: (...a: unknown[]) => getValid(...a), GoogleNotConnectedError };
});
vi.mock('@/lib/google/classroom', async () => {
  class GoogleScopeError extends Error {}
  return { listCourses: (...a: unknown[]) => listCourses(...a), GoogleScopeError };
});
beforeEach(() => {
  for (const m of [getUser, single, getValid, listCourses]) m.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  single.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' }, error: null });
});
const req = () => new NextRequest('http://x/api/teacher/google/courses');

describe('GET /api/teacher/google/courses', () => {
  it('401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import('@/app/api/teacher/google/courses/route');
    expect((await GET(req())).status).toBe(401);
  });
  it('403 for a non-teacher', async () => {
    single.mockResolvedValue({ data: { role: 'student', school_id: 's1' }, error: null });
    const { GET } = await import('@/app/api/teacher/google/courses/route');
    expect((await GET(req())).status).toBe(403);
  });
  it('returns the paginated course list', async () => {
    getValid.mockResolvedValue('AT');
    listCourses.mockResolvedValue([{ id: 'c1', name: 'Math', section: 'A', enrollmentCode: 'z' }]);
    const { GET } = await import('@/app/api/teacher/google/courses/route');
    const body = await (await GET(req())).json();
    expect(body.courses).toHaveLength(1);
    expect(body.courses[0].id).toBe('c1');
  });
  it('connected:false on GoogleNotConnectedError', async () => {
    const { GoogleNotConnectedError } = await import('@/lib/google/tokens');
    getValid.mockRejectedValue(new GoogleNotConnectedError());
    const { GET } = await import('@/app/api/teacher/google/courses/route');
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: false });
  });
  it('needsReconnect:true on GoogleScopeError', async () => {
    getValid.mockResolvedValue('AT');
    const { GoogleScopeError } = await import('@/lib/google/classroom');
    listCourses.mockRejectedValue(new GoogleScopeError());
    const { GET } = await import('@/app/api/teacher/google/courses/route');
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: true, needsReconnect: true });
  });
  it('500 enveloped (no raw leak) on an unexpected error', async () => {
    getValid.mockResolvedValue('AT');
    listCourses.mockRejectedValue(new Error('internal google detail'));
    const { GET } = await import('@/app/api/teacher/google/courses/route');
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('internal google detail');
  });
});
