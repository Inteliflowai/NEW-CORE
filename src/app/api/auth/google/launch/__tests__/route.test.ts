// src/app/api/auth/google/launch/__tests__/route.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

beforeEach(() => { process.env.GOOGLE_LAUNCH_STATE_SECRET = 'test-secret-abcdefghijklmnop'; });
afterEach(() => { delete process.env.GOOGLE_LAUNCH_STATE_SECRET; });

function req(qs: string) { return new NextRequest(`https://app.test/api/auth/google/launch${qs}`); }

describe('GET /api/auth/google/launch', () => {
  it('redirects an invalid gc to /login', async () => {
    const { GET } = await import('@/app/api/auth/google/launch/route');
    const res = await GET(req('?gc=bogus&id=X'));
    expect(res.headers.get('location')).toBe('https://app.test/login');
  });
  it('redirects to Google with prompt=none and sets an httpOnly nonce cookie (silent)', async () => {
    const { GET } = await import('@/app/api/auth/google/launch/route');
    const res = await GET(req('?gc=assignment&id=L1'));
    const loc = res.headers.get('location')!;
    expect(loc).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(loc).toContain('prompt=none');
    expect(decodeURIComponent(loc)).toContain('state=launch:');
    const c = res.cookies.get('g_launch_nonce');
    expect(c?.value).toBeTruthy();
    expect(c?.httpOnly).toBe(true);
    expect(c?.sameSite).toBe('lax');
  });
  it('uses prompt=select_account when interactive=1', async () => {
    const { GET } = await import('@/app/api/auth/google/launch/route');
    const res = await GET(req('?gc=quiz&id=Q1&interactive=1'));
    expect(res.headers.get('location')).toContain('prompt=select_account');
  });
  it('falls back to /login?error=launch when the secret is missing', async () => {
    delete process.env.GOOGLE_LAUNCH_STATE_SECRET;
    const { GET } = await import('@/app/api/auth/google/launch/route');
    const res = await GET(req('?gc=quiz&id=Q1'));
    expect(res.headers.get('location')).toBe('https://app.test/login?error=launch');
  });
});
