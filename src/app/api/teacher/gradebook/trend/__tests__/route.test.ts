import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const guard = vi.fn();
const load = vi.fn();
const roleLookup = vi.fn(); // admin.from('users').select('role').eq('id',...).maybeSingle()

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: roleLookup }) }) }),
  }),
}));
vi.mock('@/lib/auth/guards', () => ({ guardStudentAccess: (...a: unknown[]) => guard(...a) }));
vi.mock('@/lib/gradebook/loadStudentGradeTrend', () => ({ loadStudentGradeTrend: (...a: unknown[]) => load(...a) }));

import { GET } from '../route';

function req(url: string) { return new Request(url) as unknown as import('next/server').NextRequest; }

beforeEach(() => {
  getUser.mockReset(); guard.mockReset(); load.mockReset(); roleLookup.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 't1' } }, error: null });
  roleLookup.mockResolvedValue({ data: { role: 'teacher' } });
  guard.mockResolvedValue(null);
  load.mockResolvedValue({ points: [{ date: 'd', grade: 80, assignment_title: 'L', on_time: true }], direction: null, latest: 80, average: 80 });
});

describe('GET /api/teacher/gradebook/trend', () => {
  it('401 when unauthenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(req('http://x/api?studentId=s1&classId=c1'));
    expect(res.status).toBe(401);
  });
  it('400 when studentId or classId missing', async () => {
    const res = await GET(req('http://x/api?studentId=s1'));
    expect(res.status).toBe(400);
  });
  it('403 when the caller is not staff (teacher-namespace gate)', async () => {
    roleLookup.mockResolvedValue({ data: { role: 'student' } });
    const res = await GET(req('http://x/api?studentId=s1&classId=c1'));
    expect(res.status).toBe(403);
    expect(guard).not.toHaveBeenCalled(); // role gate short-circuits before the IDOR guard
    expect(load).not.toHaveBeenCalled();
  });
  it('returns the guard response on IDOR failure', async () => {
    guard.mockResolvedValue(new Response('no', { status: 403 }));
    const res = await GET(req('http://x/api?studentId=s1&classId=c1'));
    expect(res.status).toBe(403);
    expect(load).not.toHaveBeenCalled();
  });
  it('200 with the trend payload on success', async () => {
    const res = await GET(req('http://x/api?studentId=s1&classId=c1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.points).toHaveLength(1);
    expect(guard).toHaveBeenCalledWith('s1');
  });
});
