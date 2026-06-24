import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const single = vi.fn();
const getValid = vi.fn();
const grantedScopes = vi.fn();           // the admin granted_scopes maybeSingle (fallback path)
const origFetch = globalThis.fetch;
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }),
  createAdminSupabaseClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: grantedScopes }) }) }) }),
}));
vi.mock('@/lib/google/tokens', async () => {
  class GoogleNotConnectedError extends Error {}
  return { getValidAccessTokenForTeacher: (...a: unknown[]) => getValid(...a), GoogleNotConnectedError };
});
beforeEach(() => {
  getUser.mockReset(); single.mockReset(); getValid.mockReset(); grantedScopes.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  single.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' }, error: null });
  grantedScopes.mockResolvedValue({ data: { granted_scopes: [] }, error: null });
});
afterEach(() => { globalThis.fetch = origFetch; vi.restoreAllMocks(); });
const req = () => new NextRequest('http://x/api/teacher/google/scope-check');

describe('GET /api/teacher/google/scope-check', () => {
  it('connected:false when not connected', async () => {
    const { GoogleNotConnectedError } = await import('@/lib/google/tokens');
    getValid.mockRejectedValue(new GoogleNotConnectedError());
    const { GET } = await import('@/app/api/teacher/google/scope-check/route');
    expect(await (await GET(req())).json()).toEqual({ connected: false, needsReconnect: false, missing: [] });
  });
  it('connected with no missing scopes', async () => {
    getValid.mockResolvedValue('AT');
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ scope:
      'https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.rosters.readonly https://www.googleapis.com/auth/classroom.profile.emails https://www.googleapis.com/auth/classroom.coursework.students https://www.googleapis.com/auth/classroom.courseworkmaterials' }), { status: 200 })) as unknown as typeof fetch;
    const { GET } = await import('@/app/api/teacher/google/scope-check/route');
    const body = await (await GET(req())).json();
    expect(body.connected).toBe(true); expect(body.needsReconnect).toBe(false); expect(body.missing).toEqual([]);
  });
  it('needsReconnect when a required scope is missing', async () => {
    getValid.mockResolvedValue('AT');
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ scope: 'https://www.googleapis.com/auth/classroom.courses.readonly' }), { status: 200 })) as unknown as typeof fetch;
    const { GET } = await import('@/app/api/teacher/google/scope-check/route');
    const body = await (await GET(req())).json();
    expect(body.connected).toBe(true); expect(body.needsReconnect).toBe(true);
    expect(body.missing).toContain('https://www.googleapis.com/auth/classroom.coursework.students');
  });
  it('connected:false needsReconnect:true when token refresh fails (non not-connected error)', async () => {
    getValid.mockRejectedValue(new Error('refresh failed'));   // plain Error, NOT GoogleNotConnectedError
    const { GET } = await import('@/app/api/teacher/google/scope-check/route');
    expect(await (await GET(req())).json()).toEqual({ connected: false, needsReconnect: true, missing: [] });
  });
  it('falls back to stored granted_scopes when tokeninfo returns 200 with no scope field', async () => {
    getValid.mockResolvedValue('AT');
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch;
    grantedScopes.mockResolvedValue({ data: { granted_scopes: [
      'https://www.googleapis.com/auth/classroom.courses.readonly',
      'https://www.googleapis.com/auth/classroom.rosters.readonly',
      'https://www.googleapis.com/auth/classroom.profile.emails',
      'https://www.googleapis.com/auth/classroom.coursework.students',
      'https://www.googleapis.com/auth/classroom.courseworkmaterials',
    ] }, error: null });
    const { GET } = await import('@/app/api/teacher/google/scope-check/route');
    const body = await (await GET(req())).json();
    expect(body.needsReconnect).toBe(false);
    expect(body.missing).toEqual([]);
  });
  it('falls back to stored granted_scopes when tokeninfo is unavailable (no false reconnect)', async () => {
    getValid.mockResolvedValue('AT');
    globalThis.fetch = vi.fn(async () => new Response('no', { status: 400 })) as unknown as typeof fetch;
    grantedScopes.mockResolvedValue({ data: { granted_scopes: [
      'https://www.googleapis.com/auth/classroom.courses.readonly',
      'https://www.googleapis.com/auth/classroom.rosters.readonly',
      'https://www.googleapis.com/auth/classroom.profile.emails',
      'https://www.googleapis.com/auth/classroom.coursework.students',
      'https://www.googleapis.com/auth/classroom.courseworkmaterials',
    ] }, error: null });
    const { GET } = await import('@/app/api/teacher/google/scope-check/route');
    const body = await (await GET(req())).json();
    expect(body.connected).toBe(true); expect(body.needsReconnect).toBe(false); expect(body.missing).toEqual([]);
  });
});
