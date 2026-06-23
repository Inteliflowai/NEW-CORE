import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const guard = vi.fn();
const load = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({}),
}));
vi.mock('@/lib/auth/guards', () => ({ guardStudentAccess: (...a: unknown[]) => guard(...a) }));
vi.mock('@/lib/gradebook/loadStudentGradeTrend', () => ({ loadStudentGradeTrend: (...a: unknown[]) => load(...a) }));

import { GET } from '../route';

function req(url: string) { return new Request(url) as unknown as import('next/server').NextRequest; }

beforeEach(() => {
  getUser.mockReset(); guard.mockReset(); load.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 't1' } }, error: null });
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
