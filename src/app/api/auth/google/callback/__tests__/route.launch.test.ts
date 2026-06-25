// src/app/api/auth/google/callback/__tests__/route.launch.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { signLaunchState } from '@/lib/google/launchState';

const exchangeCodeForTokens = vi.fn();
const getGoogleProfile = vi.fn();
const deriveResourceSchool = vi.fn();
const resolveGcDeepLink = vi.fn();
const resolveExternalIdentity = vi.fn();
const verifyOtp = vi.fn();
const generateLink = vi.fn();
const usersMaybeSingle = vi.fn();
const enrollMaybeSingle = vi.fn();

vi.mock('@/lib/google/tokens', () => ({
  exchangeCodeForTokens: (...a: unknown[]) => exchangeCodeForTokens(...a),
  storeConnection: vi.fn(),
}));
vi.mock('@/lib/google/profile', () => ({ getGoogleProfile: (...a: unknown[]) => getGoogleProfile(...a) }));
vi.mock('@/lib/google/launchResolve', () => ({
  deriveResourceSchool: (...a: unknown[]) => deriveResourceSchool(...a),
  resolveGcDeepLink: (...a: unknown[]) => resolveGcDeepLink(...a),
}));
vi.mock('@/lib/google/resolveExternalIdentity', () => ({
  resolveExternalIdentity: (...a: unknown[]) => resolveExternalIdentity(...a),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: vi.fn(), verifyOtp } }),
  createAdminSupabaseClient: () => ({
    auth: { admin: { generateLink } },
    from: (table: string) => {
      const terminal = table === 'enrollments' ? enrollMaybeSingle : usersMaybeSingle;
      const q: Record<string, unknown> = {};
      q.select = () => q; q.eq = () => q; q.maybeSingle = terminal; // chainable (multiple .eq())
      return q;
    },
  }),
}));

const SECRET = 'launch-test-secret-0123456789';
beforeEach(() => {
  process.env.GOOGLE_LAUNCH_STATE_SECRET = SECRET;
  for (const m of [exchangeCodeForTokens, getGoogleProfile, deriveResourceSchool, resolveGcDeepLink, resolveExternalIdentity, verifyOtp, generateLink, usersMaybeSingle, enrollMaybeSingle]) m.mockReset();
  exchangeCodeForTokens.mockResolvedValue({ access_token: 'AT', expires_in: 3600 });
  getGoogleProfile.mockResolvedValue({ id: 'G1', email: 's@x.edu', verified_email: true });
  deriveResourceSchool.mockResolvedValue({ schoolId: 'school1', classId: 'class1' });
  resolveExternalIdentity.mockResolvedValue('stu1');
  usersMaybeSingle.mockResolvedValue({ data: { email: 's@x.edu', role: 'student' } });
  enrollMaybeSingle.mockResolvedValue({ data: { id: 'e1' } }); // active enrollment exists by default
  generateLink.mockResolvedValue({ data: { properties: { hashed_token: 'TH' } }, error: null });
  verifyOtp.mockResolvedValue({ error: null });
  resolveGcDeepLink.mockResolvedValue('/student/assignments/A1');
});
afterEach(() => { delete process.env.GOOGLE_LAUNCH_STATE_SECRET; });

function launchReq(state: string, nonce: string | null, extra = '&code=abc') {
  const r = new NextRequest(`https://app.test/api/auth/google/callback?state=${encodeURIComponent(state)}${extra}`);
  if (nonce) r.cookies.set('g_launch_nonce', nonce);
  return r;
}
const validState = (mode: 'silent' | 'interactive' = 'silent', gc: 'quiz' | 'assignment' = 'assignment') =>
  signLaunchState({ gc, id: 'L1', nonce: 'N1', mode });

describe('GET /api/auth/google/callback — student launch branch', () => {
  it('happy path → mints a session and deep-links to the student\'s assignment', async () => {
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(launchReq(validState(), 'N1'));
    expect(generateLink).toHaveBeenCalledWith({ type: 'magiclink', email: 's@x.edu' });
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'magiclink', token_hash: 'TH' });
    expect(res.headers.get('location')).toBe('https://app.test/student/assignments/A1');
  });
  it('tampered state → /login?error=launch, no exchange', async () => {
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const s = validState();
    const res = await GET(launchReq(s.slice(0, -2) + 'zz', 'N1'));
    expect(res.headers.get('location')).toContain('/login?error=launch');
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });
  it('nonce mismatch → /login?error=launch', async () => {
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(launchReq(validState(), 'WRONG'));
    expect(res.headers.get('location')).toContain('/login?error=launch');
  });
  it('silent Google error → retries interactively at the initiator', async () => {
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(launchReq(validState('silent'), 'N1', '&error=interaction_required'));
    const loc = res.headers.get('location')!;
    expect(loc).toContain('/api/auth/google/launch?gc=assignment&id=L1&interactive=1');
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });
  it('interactive Google error → /login?error=google', async () => {
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(launchReq(validState('interactive'), 'N1', '&error=access_denied'));
    expect(res.headers.get('location')).toContain('/login?error=google');
  });
  it('unverified Google email → /launch/unmatched', async () => {
    getGoogleProfile.mockResolvedValue({ id: 'G1', email: 's@x.edu', verified_email: false });
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(launchReq(validState(), 'N1'));
    expect(res.headers.get('location')).toContain('/launch/unmatched');
    expect(generateLink).not.toHaveBeenCalled();
  });
  it('no external-identity match → /launch/unmatched, never auto-creates', async () => {
    resolveExternalIdentity.mockResolvedValue(null);
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(launchReq(validState(), 'N1'));
    expect(res.headers.get('location')).toContain('/launch/unmatched');
    expect(generateLink).not.toHaveBeenCalled();
  });
  it('resolved user is not a student → /launch/unmatched', async () => {
    usersMaybeSingle.mockResolvedValue({ data: { email: 't@x.edu', role: 'teacher' } });
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(launchReq(validState(), 'N1'));
    expect(res.headers.get('location')).toContain('/launch/unmatched');
    expect(generateLink).not.toHaveBeenCalled();
  });
  it('resolved student not actively enrolled in the resource class → /launch/unmatched (M2)', async () => {
    enrollMaybeSingle.mockResolvedValue({ data: null });
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(launchReq(validState(), 'N1'));
    expect(res.headers.get('location')).toContain('/launch/unmatched');
    expect(generateLink).not.toHaveBeenCalled();
  });
  it('session mint fails (no token_hash) → /login?error=session', async () => {
    generateLink.mockResolvedValue({ data: { properties: {} }, error: null });
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(launchReq(validState(), 'N1'));
    expect(res.headers.get('location')).toContain('/login?error=session');
    expect(verifyOtp).not.toHaveBeenCalled();
  });
  it('verifyOtp error → /login?error=session', async () => {
    verifyOtp.mockResolvedValue({ error: { message: 'otp invalid' } });
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(launchReq(validState(), 'N1'));
    expect(res.headers.get('location')).toContain('/login?error=session');
  });
  it('clears the nonce cookie on exit', async () => {
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(launchReq(validState(), 'N1'));
    // a delete writes an expired Set-Cookie for the nonce
    expect(res.cookies.get('g_launch_nonce')?.value ?? '').toBe('');
  });
});
