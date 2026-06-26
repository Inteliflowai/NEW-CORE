// src/app/api/profile/avatar/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const uploads: Array<{ path: string }> = [];
const downloads: string[] = [];
const userUpdates: Array<Record<string, unknown>> = [];
let DOWNLOAD: { data: Blob | null; error: unknown };

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: () => ({
      update: (vals: Record<string, unknown>) => ({
        eq: async () => { userUpdates.push(vals); return { error: null }; },
      }),
    }),
    storage: { from: () => ({
      upload: async (path: string) => { uploads.push({ path }); return { data: { path }, error: null }; },
      download: async (path: string) => { downloads.push(path); return DOWNLOAD; },
    }) },
  }),
}));

function postReq(form: FormData) { return new NextRequest('http://x/api/profile/avatar', { method: 'POST', body: form }); }
function getReq(path: string) { return new NextRequest(`http://x/api/profile/avatar?path=${encodeURIComponent(path)}`); }

beforeEach(() => {
  getUser.mockReset(); uploads.length = 0; downloads.length = 0; userUpdates.length = 0;
  DOWNLOAD = { data: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), error: null };
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
});

function fd(over: Record<string, string | Blob> = {}) {
  const f = new FormData();
  f.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'avatar.png');
  for (const [k, v] of Object.entries(over)) f.set(k, v);
  return f;
}

describe('POST /api/profile/avatar', () => {
  it('401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import('@/app/api/profile/avatar/route');
    expect((await POST(postReq(fd()))).status).toBe(401);
  });
  it('415 on a non-image file', async () => {
    const { POST } = await import('@/app/api/profile/avatar/route');
    expect((await POST(postReq(fd({ file: new Blob(['x'], { type: 'application/pdf' }) })))).status).toBe(415);
  });
  it('uploads under {user_id}/avatar-<ts>.<ext>, returns proxy avatar_url, and updates users.avatar_url', async () => {
    const { POST } = await import('@/app/api/profile/avatar/route');
    const res = await POST(postReq(fd()));
    expect(res.status).toBe(200);
    expect(uploads[0].path).toMatch(/^u1\/avatar-\d+\.png$/);
    const body = await res.json();
    expect(body.avatar_url).toBe(`/api/profile/avatar?path=${encodeURIComponent(uploads[0].path)}`);
    expect(userUpdates[0]).toMatchObject({ avatar_url: body.avatar_url });
  });
});

describe('GET /api/profile/avatar', () => {
  it('401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import('@/app/api/profile/avatar/route');
    expect((await GET(getReq('u1/avatar-1.png'))).status).toBe(401);
  });
  it('400 on a traversal path and never reaches the download', async () => {
    const { GET } = await import('@/app/api/profile/avatar/route');
    expect((await GET(getReq('u1/../avatar-1.png'))).status).toBe(400);
    expect(downloads).toHaveLength(0);
  });
  it('403 when path owner does not match caller', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'other' } }, error: null });
    const { GET } = await import('@/app/api/profile/avatar/route');
    expect((await GET(getReq('u1/avatar-1.png'))).status).toBe(403);
  });
  it('serves bytes with nosniff to the avatar owner', async () => {
    DOWNLOAD = { data: new Blob([new Uint8Array([7, 8, 9])], { type: 'image/png' }), error: null };
    const { GET } = await import('@/app/api/profile/avatar/route');
    const res = await GET(getReq('u1/avatar-1.png'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([7, 8, 9]);
  });
});
