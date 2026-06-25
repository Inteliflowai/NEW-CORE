// src/app/api/admin/audit/__tests__/route.test.ts
// Tests for GET /api/admin/audit
// Node env — no jsdom needed.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Supabase chain builder ───────────────────────────────────────────────────

function makeChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain['select'] = vi.fn().mockReturnValue(chain);
  chain['order'] = vi.fn().mockReturnValue(chain);
  chain['limit'] = vi.fn().mockReturnValue(chain);
  chain['eq'] = vi.fn().mockReturnValue(chain);
  chain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(resolve);
  return chain;
}

function makeAdminMock(entries: unknown[] | null = [], error: unknown = null) {
  const auditChain = makeChain(entries, error);
  return {
    from: vi.fn((table: string) => {
      if (table === 'audit_logs') return auditChain;
      return makeChain(null);
    }),
    _auditChain: auditChain,
  };
}

// ─── module mocks (hoisted, top-level vi.mock — the RELIABLE pattern) ────────

const mockGuardPlatformAdmin = vi.fn();
vi.mock('@/lib/auth/guards', () => ({
  guardPlatformAdmin: () => mockGuardPlatformAdmin(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: vi.fn(),
  createServerSupabaseClient: vi.fn(),
}));

// ─── tests ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/audit', () => {
  beforeEach(() => {
    mockGuardPlatformAdmin.mockReset();
    vi.resetModules();
  });

  // ── 401 — no authenticated user ───────────────────────────────────────────
  it('returns 401 when not authenticated', async () => {
    const { NextResponse } = await import('next/server');
    mockGuardPlatformAdmin.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    const { GET } = await import('@/app/api/admin/audit/route');
    const req = new Request('http://localhost/api/admin/audit');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  // ── 403 — non-platform user ───────────────────────────────────────────────
  it('returns 403 when role is not platform_admin', async () => {
    const { NextResponse } = await import('next/server');
    mockGuardPlatformAdmin.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );

    const { GET } = await import('@/app/api/admin/audit/route');
    const req = new Request('http://localhost/api/admin/audit');
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  // ── 200 — platform_admin gets entries ─────────────────────────────────────
  it('returns 200 + entries array for platform_admin', async () => {
    mockGuardPlatformAdmin.mockResolvedValue(null);

    const ENTRIES = [
      {
        id: 'entry-1',
        actor_id: 'admin-uuid',
        school_id: 'school-1',
        action: 'school.provision',
        resource_type: 'school',
        resource_id: 'school-1',
        metadata: { school_name: 'Demo School' },
        created_at: '2026-06-25T10:00:00.000Z',
      },
    ];

    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    const adminMock = makeAdminMock(ENTRIES);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    const { GET } = await import('@/app/api/admin/audit/route');
    const req = new Request('http://localhost/api/admin/audit');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].action).toBe('school.provision');
  });

  // ── 200 — empty array when no entries ─────────────────────────────────────
  it('returns entries: [] when audit_logs is empty', async () => {
    mockGuardPlatformAdmin.mockResolvedValue(null);

    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    const adminMock = makeAdminMock(null); // null data → coalesces to []
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    const { GET } = await import('@/app/api/admin/audit/route');
    const req = new Request('http://localhost/api/admin/audit');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.entries).toEqual([]);
  });

  // ── filters applied when query params present ─────────────────────────────
  it('applies school_id, action, and resource_type eq filters when params are present', async () => {
    mockGuardPlatformAdmin.mockResolvedValue(null);

    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    const adminMock = makeAdminMock([]);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    const { GET } = await import('@/app/api/admin/audit/route');
    const req = new Request(
      'http://localhost/api/admin/audit?school_id=school-42&action=spark.enable&resource_type=school',
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const chain = adminMock._auditChain as ReturnType<typeof makeChain>;
    const eqMock = chain['eq'] as ReturnType<typeof vi.fn>;
    expect(eqMock).toHaveBeenCalledWith('school_id', 'school-42');
    expect(eqMock).toHaveBeenCalledWith('action', 'spark.enable');
    expect(eqMock).toHaveBeenCalledWith('resource_type', 'school');
  });

  // ── no filters applied when no params ─────────────────────────────────────
  it('does NOT call eq when no filter params are present', async () => {
    mockGuardPlatformAdmin.mockResolvedValue(null);

    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    const adminMock = makeAdminMock([]);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    const { GET } = await import('@/app/api/admin/audit/route');
    const req = new Request('http://localhost/api/admin/audit');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const chain = adminMock._auditChain as ReturnType<typeof makeChain>;
    const eqMock = chain['eq'] as ReturnType<typeof vi.fn>;
    expect(eqMock).not.toHaveBeenCalled();
  });

  // ── order + limit applied ─────────────────────────────────────────────────
  it('orders by created_at descending and caps at MAX results', async () => {
    mockGuardPlatformAdmin.mockResolvedValue(null);

    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    const adminMock = makeAdminMock([]);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    const { GET } = await import('@/app/api/admin/audit/route');
    const req = new Request('http://localhost/api/admin/audit');
    await GET(req);

    const chain = adminMock._auditChain as ReturnType<typeof makeChain>;
    const orderMock = chain['order'] as ReturnType<typeof vi.fn>;
    const limitMock = chain['limit'] as ReturnType<typeof vi.fn>;
    expect(orderMock).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(limitMock).toHaveBeenCalledWith(200);
  });

  // ── 500 on DB error ───────────────────────────────────────────────────────
  it('returns 500 when the DB query errors', async () => {
    mockGuardPlatformAdmin.mockResolvedValue(null);

    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    const adminMock = makeAdminMock(null, { message: 'relation "audit_logs" does not exist' });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    const { GET } = await import('@/app/api/admin/audit/route');
    const req = new Request('http://localhost/api/admin/audit');
    const res = await GET(req);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
