import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({ createAdminSupabaseClient: vi.fn() }));

function makeReq(secret: string | null) {
  const headers: Record<string, string> = {};
  if (secret) headers['x-cron-secret'] = secret;
  return new NextRequest('http://localhost/api/cron/idempotency-sweep', { method: 'POST', headers });
}

function adminDeleting(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain['delete'] = vi.fn().mockReturnValue(chain);
  chain['lt'] = vi.fn().mockReturnValue(chain);
  chain['not'] = vi.fn().mockReturnValue(chain);
  chain['select'] = vi.fn().mockResolvedValue({ data: rows, error: null });
  return { from: vi.fn(() => chain) } as never;
}

beforeEach(() => { process.env.CRON_SECRET = 'cron-x'; vi.resetModules(); });

describe('POST /api/cron/idempotency-sweep', () => {
  it('401 without the cron secret', async () => {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminDeleting([]));
    const { POST } = await import('@/app/api/cron/idempotency-sweep/route');
    expect((await POST(makeReq(null))).status).toBe(401);
    expect((await POST(makeReq('wrong'))).status).toBe(401);
  });

  it('deletes expired keys and returns a count', async () => {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminDeleting([{ id: '1' }, { id: '2' }]));
    const { POST } = await import('@/app/api/cron/idempotency-sweep/route');
    const res = await POST(makeReq('cron-x'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, deleted: 2 });
  });
});
