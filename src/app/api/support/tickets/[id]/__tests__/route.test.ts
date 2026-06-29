// Tests for PATCH /api/support/tickets/[id]
// Node env — no jsdom needed (server route test).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ─── Mutable state ────────────────────────────────────────────────────────────
const guardFn = vi.fn();
let updatePayload: Record<string, unknown> = {};
let SINGLE_RESULT: { data: { id: string } | null; error: unknown } = {
  data: { id: 'ticket-1' },
  error: null,
};

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/guards', () => ({
  guardPlatformAdmin: () => guardFn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  // createServerSupabaseClient is not used directly in this route (guard handles auth)
  createServerSupabaseClient: async () => ({ auth: { getUser: vi.fn() } }),
  createAdminSupabaseClient: () => ({
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        updatePayload = { ...payload };
        return {
          eq: () => ({
            select: () => ({
              single: () => Promise.resolve(SINGLE_RESULT),
            }),
          }),
        };
      },
    }),
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PARAMS = Promise.resolve({ id: 'ticket-1' });

function patchReq(body: object) {
  return new NextRequest('http://x/api/support/tickets/ticket-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  guardFn.mockReset();
  updatePayload = {};
  SINGLE_RESULT = { data: { id: 'ticket-1' }, error: null };
  // Default: platform_admin allowed (guard returns null = pass)
  guardFn.mockResolvedValue(null);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PATCH /api/support/tickets/[id]', () => {
  it('403 for non-platform-admin (guard short-circuits)', async () => {
    guardFn.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const { PATCH } = await import('@/app/api/support/tickets/[id]/route');
    const res = await PATCH(patchReq({ status: 'open' }), { params: PARAMS });
    expect(res.status).toBe(403);
  });

  it('400 for invalid status value', async () => {
    const { PATCH } = await import('@/app/api/support/tickets/[id]/route');
    const res = await PATCH(patchReq({ status: 'invalid_status' }), { params: PARAMS });
    expect(res.status).toBe(400);
  });

  it('status "resolved" includes resolved_at (ISO string) in the update payload', async () => {
    const { PATCH } = await import('@/app/api/support/tickets/[id]/route');
    const res = await PATCH(patchReq({ status: 'resolved' }), { params: PARAMS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(updatePayload.status).toBe('resolved');
    expect(typeof updatePayload.resolved_at).toBe('string');
    // Verify it's a real ISO timestamp
    expect(new Date(updatePayload.resolved_at as string).toISOString()).toBe(
      updatePayload.resolved_at,
    );
  });

  it('status "open" includes resolved_at: null in the update payload', async () => {
    const { PATCH } = await import('@/app/api/support/tickets/[id]/route');
    const res = await PATCH(patchReq({ status: 'open' }), { params: PARAMS });
    expect(res.status).toBe(200);
    expect(updatePayload.status).toBe('open');
    expect(updatePayload.resolved_at).toBeNull();
  });

  it('status "in_progress" also clears resolved_at', async () => {
    const { PATCH } = await import('@/app/api/support/tickets/[id]/route');
    const res = await PATCH(patchReq({ status: 'in_progress' }), { params: PARAMS });
    expect(res.status).toBe(200);
    expect(updatePayload.resolved_at).toBeNull();
  });

  it('404 for unknown ticket id (PGRST116 from .single())', async () => {
    SINGLE_RESULT = { data: null, error: { code: 'PGRST116', message: 'Result contains 0 rows' } };
    const { PATCH } = await import('@/app/api/support/tickets/[id]/route');
    const res = await PATCH(patchReq({ status: 'open' }), { params: PARAMS });
    expect(res.status).toBe(404);
  });
});
