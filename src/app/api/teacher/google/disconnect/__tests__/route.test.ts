import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const single = vi.fn();
const del = vi.fn();
const eq = vi.fn(() => del());
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }),
  createAdminSupabaseClient: () => ({ from: () => ({ delete: () => ({ eq }) }) }),
}));
beforeEach(() => {
  getUser.mockReset(); single.mockReset(); del.mockReset(); eq.mockClear();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  single.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' }, error: null });
  del.mockResolvedValue({ error: null });
});
const req = () => new NextRequest('http://x/api/teacher/google/disconnect', { method: 'POST' });

describe('POST /api/teacher/google/disconnect', () => {
  it('401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import('@/app/api/teacher/google/disconnect/route');
    expect((await POST(req())).status).toBe(401);
  });
  it('deletes the caller own connection', async () => {
    const { POST } = await import('@/app/api/teacher/google/disconnect/route');
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(eq).toHaveBeenCalledWith('user_id', 'u1');
  });
  it('403 for a student role and does NOT call delete', async () => {
    single.mockResolvedValue({ data: { role: 'student', school_id: 's1' }, error: null });
    const { POST } = await import('@/app/api/teacher/google/disconnect/route');
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(del).not.toHaveBeenCalled();
  });
  it('500 when the delete returns a DB error', async () => {
    del.mockResolvedValue({ error: { message: 'boom' } });
    const { POST } = await import('@/app/api/teacher/google/disconnect/route');
    const res = await POST(req());
    expect(res.status).toBe(500);
  });
});
