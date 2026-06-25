import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
// Table-aware: the impl reads ONLY from('users').select('role').eq('id', user.id).
let userRole: string | null = 'teacher';
const from = vi.fn((table: string) => {
  if (table !== 'users') throw new Error(`Unexpected table in proxy: ${table}`);
  return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: async () => ({ data: { role: userRole } }) };
});
// Capture the cookie adapter so a test can simulate Supabase's session refresh.
let capturedCookies: { setAll: (c: { name: string; value: string; options?: Record<string, unknown> }[]) => void };
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn((_url: string, _key: string, opts: { cookies: { setAll: typeof capturedCookies.setAll } }) => {
    capturedCookies = opts.cookies as never;
    return { auth: { getUser }, from };
  }),
}));

import { NextRequest } from 'next/server';
import { proxy } from '../proxy';
import { LAUNCH_STATE_PREFIX } from '@/lib/google/launchState';

function req(path: string): NextRequest {
  return new NextRequest(new URL(`https://app.test${path}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  userRole = 'teacher';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'pk';
});

describe('proxy (auth gate + session refresh)', () => {
  it('passes through a public route when unauthenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await proxy(req('/login'));
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects unauthenticated user on a protected route to /login?expired=true', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await proxy(req('/today'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.test/login?expired=true');
  });

  it('redirects unauthenticated user on / to /login', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await proxy(req('/'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.test/login');
  });

  it('redirects authenticated user away from /login to role home', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await proxy(req('/login'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.test/today');
  });

  it('passes through a protected route when authenticated', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await proxy(req('/today'));
    expect(res.headers.get('location')).toBeNull();
  });

  it('preserves a cookie written via setAll on a pass-through (session refresh)', async () => {
    getUser.mockImplementation(async () => {
      // Simulate Supabase refreshing the session cookie during getUser().
      capturedCookies.setAll([{ name: 'sb-access-token', value: 'refreshed', options: {} }]);
      return { data: { user: null } }; // /login is public → pass-through returns supabaseResponse
    });
    const res = await proxy(req('/login'));
    expect(res.cookies.get('sb-access-token')?.value).toBe('refreshed');
  });

  it('does NOT loop: an authed user with no role on /login falls through (no redirect)', async () => {
    userRole = null;
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await proxy(req('/login'));
    expect(res.headers.get('location')).toBeNull();
  });

  it('diverts an unauthenticated /?gc= link to the launch initiator', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await proxy(req('/?gc=assignment&id=L1'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.test/api/auth/google/launch?gc=assignment&id=L1');
  });
  it('an invalid gc on / still goes to /login', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await proxy(req('/?gc=bogus&id=L1'));
    expect(res.headers.get('location')).toBe('https://app.test/login');
  });
  it('lets the launch callback through when it carries a launch: state', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    // Use LAUNCH_STATE_PREFIX so a future rename fails this test (the proxy hardcodes the literal
    // and can't import node:crypto — proxy.test.ts is the coupling point). (whole-branch review)
    const res = await proxy(req(`/api/auth/google/callback?state=${LAUNCH_STATE_PREFIX}abc&code=x`));
    expect(res.headers.get('location')).toBeNull();
  });
  it('still gates the callback (no launch state) to /login?expired=true', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await proxy(req('/api/auth/google/callback?state=csrf&code=x'));
    expect(res.headers.get('location')).toBe('https://app.test/login?expired=true');
  });
  it('passes /launch/unmatched through unauthenticated (public)', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await proxy(req('/launch/unmatched'));
    expect(res.headers.get('location')).toBeNull();
  });
  it('an authenticated student\'s /?gc= falls through to page.tsx (no role redirect)', async () => {
    userRole = 'student';
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await proxy(req('/?gc=assignment&id=L1'));
    expect(res.headers.get('location')).toBeNull();
  });
});
