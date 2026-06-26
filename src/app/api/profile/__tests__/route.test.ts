// src/app/api/profile/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const userUpdates: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: () => ({
      update: (vals: Record<string, unknown>) => ({
        eq: async () => { userUpdates.push(vals); return { error: null }; },
      }),
    }),
  }),
}));

function postReq(body: Record<string, unknown>) {
  return new NextRequest('http://x/api/profile', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  getUser.mockReset();
  userUpdates.length = 0;
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
});

describe('POST /api/profile', () => {
  it('401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import('@/app/api/profile/route');
    expect((await POST(postReq({ full_name: 'John' }))).status).toBe(401);
  });

  it('400 on empty name', async () => {
    const { POST } = await import('@/app/api/profile/route');
    expect((await POST(postReq({ full_name: '' }))).status).toBe(400);
  });

  it('400 on whitespace-only name', async () => {
    const { POST } = await import('@/app/api/profile/route');
    expect((await POST(postReq({ full_name: '   ' }))).status).toBe(400);
  });

  it('400 on name over 120 chars', async () => {
    const { POST } = await import('@/app/api/profile/route');
    expect((await POST(postReq({ full_name: 'a'.repeat(121) }))).status).toBe(400);
  });

  it('400 on invalid JSON', async () => {
    const { POST } = await import('@/app/api/profile/route');
    const req = new NextRequest('http://x/api/profile', {
      method: 'POST',
      body: 'not json',
    });
    expect((await POST(req)).status).toBe(400);
  });

  it('updates users.full_name and returns {ok:true, full_name}', async () => {
    const { POST } = await import('@/app/api/profile/route');
    const res = await POST(postReq({ full_name: 'Jane Doe' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, full_name: 'Jane Doe' });
    expect(userUpdates[0]).toMatchObject({ full_name: 'Jane Doe' });
  });

  it('trims whitespace from name', async () => {
    const { POST } = await import('@/app/api/profile/route');
    const res = await POST(postReq({ full_name: '  John Smith  ' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.full_name).toBe('John Smith');
    expect(userUpdates[0]).toMatchObject({ full_name: 'John Smith' });
  });
});
