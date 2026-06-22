import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const guardClassAccess = vi.fn();
let ROLE: string;
let ALERT: unknown;
let WRITE_ERROR: unknown;
const updates: Array<Record<string, unknown>> = [];

vi.mock('@/lib/auth/roles', () => ({
  STAFF_ROLES: ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'] as const,
}));
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser },
    from: (t: string) => {
      if (t === 'users') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { role: ROLE } }) }) }) };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ALERT }) }) }) };
    },
  }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'alerts') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ALERT }) }) }),
          update: (p: Record<string, unknown>) => {
            updates.push(p);
            return { eq: () => ({ eq: async () => ({ error: WRITE_ERROR }) }) };
          },
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
    },
  }),
}));

const req = (b: unknown) =>
  new Request('http://x', { method: 'POST', body: JSON.stringify(b) });

async function load() {
  vi.resetModules();
  return (await import('@/app/api/teacher/alerts/resolve/route')).POST;
}

beforeEach(() => {
  getUser.mockReset();
  guardClassAccess.mockReset();
  updates.length = 0;
  ROLE = 'teacher';
  ALERT = { id: 'a1', class_id: 'c1', status: 'open' };
  WRITE_ERROR = null;
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  guardClassAccess.mockResolvedValue(null); // access granted
});

describe('POST /api/teacher/alerts/resolve', () => {
  it('401 when no user', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await (await load())(req({ alert_id: 'a1' }));
    expect(res.status).toBe(401);
  });

  it('403 for a non-staff role', async () => {
    ROLE = 'student';
    const res = await (await load())(req({ alert_id: 'a1' }));
    expect(res.status).toBe(403);
  });

  it('400 when alert_id is missing', async () => {
    const res = await (await load())(req({}));
    expect(res.status).toBe(400);
  });

  it('404 when alert is not found', async () => {
    ALERT = null;
    const res = await (await load())(req({ alert_id: 'a1' }));
    expect(res.status).toBe(404);
  });

  it('403 when guardClassAccess denies (cross-teacher IDOR)', async () => {
    guardClassAccess.mockResolvedValue(new Response(null, { status: 403 }));
    const res = await (await load())(req({ alert_id: 'a1' }));
    expect(res.status).toBe(403);
  });

  it('happy path updates status=resolved and returns { ok: true }', async () => {
    const res = await (await load())(req({ alert_id: 'a1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(updates.length).toBeGreaterThan(0);
    expect(updates[0].status).toBe('resolved');
    expect(updates[0].resolved_by).toBe('u1');
    expect(typeof updates[0].resolved_at).toBe('string');
  });

  it('500 when the write returns an error', async () => {
    WRITE_ERROR = { message: 'db down' };
    const res = await (await load())(req({ alert_id: 'a1' }));
    expect(res.status).toBe(500);
  });

  it('200 idempotent when alert is already resolved', async () => {
    ALERT = { id: 'a1', class_id: 'c1', status: 'resolved' };
    const res = await (await load())(req({ alert_id: 'a1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    // Should NOT call write when already resolved
    expect(updates.length).toBe(0);
  });
});
