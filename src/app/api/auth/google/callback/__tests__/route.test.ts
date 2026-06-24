import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const single = vi.fn();
const exchangeCodeForTokens = vi.fn();
const getGoogleProfile = vi.fn();
const storeConnection = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }),
  createAdminSupabaseClient: () => ({}),
}));
vi.mock('@/lib/google/tokens', () => ({ exchangeCodeForTokens: (...a: unknown[]) => exchangeCodeForTokens(...a), storeConnection: (...a: unknown[]) => storeConnection(...a) }));
vi.mock('@/lib/google/profile', () => ({ getGoogleProfile: (...a: unknown[]) => getGoogleProfile(...a) }));

beforeEach(() => {
  for (const m of [getUser, single, exchangeCodeForTokens, getGoogleProfile, storeConnection]) m.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  single.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' }, error: null });
  exchangeCodeForTokens.mockResolvedValue({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'openid x' });
  getGoogleProfile.mockResolvedValue({ id: 'g1', email: 'a@b.edu', verified_email: true });
  storeConnection.mockResolvedValue(undefined);
});
function req(stateParam: string, cookieState: string | null, code = 'the-code') {
  const r = new NextRequest(`http://x/api/auth/google/callback?code=${code}&state=${stateParam}`);
  if (cookieState) r.cookies.set('g_oauth_state', cookieState);
  return r;
}

describe('GET /api/auth/google/callback', () => {
  it('redirects to an error when state does not match (CSRF)', async () => {
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(req('aaa', 'bbb'));
    expect(res.headers.get('location')).toContain('/settings/google?error=state');
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });
  it('exchanges + stores + redirects connected=1 on the happy path', async () => {
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(req('s', 's'));
    expect(exchangeCodeForTokens).toHaveBeenCalledWith('the-code');
    expect(storeConnection).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'u1', googleId: 'g1', email: 'a@b.edu' }));
    expect(res.headers.get('location')).toContain('/settings/google?connected=1');
  });
  it('401 when no logged-in user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import('@/app/api/auth/google/callback/route');
    expect((await GET(req('s', 's'))).status).toBe(401);
  });
  it('403 for a non-teacher (student) role', async () => {
    single.mockResolvedValue({ data: { role: 'student', school_id: 's1' }, error: null });
    const { GET } = await import('@/app/api/auth/google/callback/route');
    expect((await GET(req('s', 's'))).status).toBe(403);
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });
  it('redirects error=denied when the user cancels consent (Google ?error=, no code)', async () => {
    const r = new NextRequest('http://x/api/auth/google/callback?error=access_denied&state=s');
    r.cookies.set('g_oauth_state', 's');
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(r);
    expect(res.headers.get('location')).toContain('/settings/google?error=denied');
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });
  it('redirects error=exchange and never connected=1 when the exchange throws', async () => {
    exchangeCodeForTokens.mockRejectedValue(new Error('google token exchange failed: 400'));
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(req('s', 's'));
    expect(res.headers.get('location')).toContain('/settings/google?error=exchange');
    expect(res.headers.get('location')).not.toContain('connected=1');
    expect(storeConnection).not.toHaveBeenCalled();
  });
});
