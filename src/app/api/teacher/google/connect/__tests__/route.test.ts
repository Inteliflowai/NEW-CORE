import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const single = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
  }),
}));
beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = 'cid';
  process.env.GOOGLE_REDIRECT_URI = 'https://x/api/auth/google/callback';
  getUser.mockReset(); single.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  single.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' }, error: null });
});
const req = () => new NextRequest('http://x/api/teacher/google/connect');

describe('GET /api/teacher/google/connect', () => {
  it('401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import('@/app/api/teacher/google/connect/route');
    expect((await GET(req())).status).toBe(401);
  });
  it('403 for a non-staff role', async () => {
    single.mockResolvedValue({ data: { role: 'student', school_id: 's1' }, error: null });
    const { GET } = await import('@/app/api/teacher/google/connect/route');
    expect((await GET(req())).status).toBe(403);
  });
  it('302 to Google consent with a state cookie that matches the state param', async () => {
    const { GET } = await import('@/app/api/teacher/google/connect/route');
    const res = await GET(req());
    expect(res.status).toBe(307); // NextResponse.redirect default
    const loc = res.headers.get('location')!;
    expect(loc).toContain('accounts.google.com/o/oauth2/v2/auth');
    const stateParam = new URL(loc).searchParams.get('state')!;
    const cookie = res.cookies.get('g_oauth_state')!;
    expect(cookie.value).toBe(stateParam);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite).toBe('lax');
    expect(cookie.maxAge).toBe(600);
  });
  it('generates a fresh random state on each call (CSRF nonce)', async () => {
    const { GET } = await import('@/app/api/teacher/google/connect/route');
    const s1 = new URL((await GET(req())).headers.get('location')!).searchParams.get('state');
    const s2 = new URL((await GET(req())).headers.get('location')!).searchParams.get('state');
    expect(s1).not.toBe(s2);
  });
});
