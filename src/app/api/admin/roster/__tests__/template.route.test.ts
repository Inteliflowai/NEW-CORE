// src/app/api/admin/roster/__tests__/template.route.test.ts
// Tests for GET /api/admin/roster/template
// Route is now open to all STAFF_ROLES (Marvin 2026-06-24: widened from school-admin tier).
// Node env. Hoisted-mock pattern.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Shared mock state ────────────────────────────────────────────────────────

const getUser = vi.fn();
const profileSingle = vi.fn();
const mockBuildRosterTemplate = vi.fn();

// ─── Module mocks (hoisted, top-level — the reliable pattern) ─────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ single: profileSingle }) }) }),
  }),
}));

vi.mock('@/lib/roster/template', () => ({
  buildRosterTemplate: () => mockBuildRosterTemplate(),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/roster/template', () => {
  beforeEach(() => {
    mockBuildRosterTemplate.mockReset();
    getUser.mockReset();
    profileSingle.mockReset();

    // Default: authenticated teacher
    getUser.mockResolvedValue({ data: { user: { id: 'teacher-1' } }, error: null });
    profileSingle.mockResolvedValue({ data: { role: 'teacher', school_id: 'school-1' }, error: null });

    // Default: non-empty template bytes
    mockBuildRosterTemplate.mockReturnValue(new Uint8Array([1, 2, 3, 4, 5]));
  });

  // ── Auth rejection ───────────────────────────────────────────────────────────

  it('returns 401 when caller is unauthenticated (no user)', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import('../template/route');
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockBuildRosterTemplate).not.toHaveBeenCalled();
  });

  it('returns 401 when getUser returns an auth error', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'jwt expired' } });
    const { GET } = await import('../template/route');
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockBuildRosterTemplate).not.toHaveBeenCalled();
  });

  // ── Role rejection ───────────────────────────────────────────────────────────

  it('returns 403 for a student role', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'student', school_id: 'school-1' }, error: null });
    const { GET } = await import('../template/route');
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mockBuildRosterTemplate).not.toHaveBeenCalled();
  });

  it('returns 403 for a parent role', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'parent', school_id: 'school-1' }, error: null });
    const { GET } = await import('../template/route');
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mockBuildRosterTemplate).not.toHaveBeenCalled();
  });

  // ── Teacher happy-path (new — widened from school-admin tier) ─────────────────

  it('returns 200 with correct Content-Type for a teacher', async () => {
    const { GET } = await import('../template/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('returns attachment Content-Disposition for a teacher', async () => {
    const { GET } = await import('../template/route');
    const res = await GET();
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="CORE_Roster_Template.xlsx"',
    );
  });

  // ── school_admin happy-path ───────────────────────────────────────────────────

  it('returns 200 with correct Content-Type for a school_admin', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'school_admin', school_id: 'school-1' }, error: null });
    const { GET } = await import('../template/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  // ── platform_admin happy-path ────────────────────────────────────────────────

  it('returns 200 for a platform_admin', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'platform_admin', school_id: null }, error: null });
    const { GET } = await import('../template/route');
    const res = await GET();
    expect(res.status).toBe(200);
  });

  // ── Response body ────────────────────────────────────────────────────────────

  it('returns a non-empty body for an authorized caller', async () => {
    const fakeBytes = new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD]);
    mockBuildRosterTemplate.mockReturnValue(fakeBytes);

    const { GET } = await import('../template/route');
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(0);
  });

  it('calls buildRosterTemplate exactly once on a successful request', async () => {
    const { GET } = await import('../template/route');
    await GET();
    expect(mockBuildRosterTemplate).toHaveBeenCalledOnce();
  });
});
