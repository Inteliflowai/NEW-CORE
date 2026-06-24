// src/app/api/admin/roster/__tests__/template.route.test.ts
// Tests for GET /api/admin/roster/template
// Node env. Mirrors the import.route.test.ts mock pattern.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Shared mock state ────────────────────────────────────────────────────────

const mockGuardSchoolAdmin = vi.fn();
const mockBuildRosterTemplate = vi.fn();

// ─── Module mocks (hoisted, top-level — the reliable pattern) ─────────────────

vi.mock('@/lib/auth/guards', () => ({
  guardSchoolAdmin: () => mockGuardSchoolAdmin(),
}));

vi.mock('@/lib/roster/template', () => ({
  buildRosterTemplate: () => mockBuildRosterTemplate(),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/roster/template', () => {
  beforeEach(() => {
    mockGuardSchoolAdmin.mockReset();
    mockBuildRosterTemplate.mockReset();

    // Default: authenticated school admin
    mockGuardSchoolAdmin.mockResolvedValue({
      userId: 'admin-user-1',
      schoolId: 'school-1',
      role: 'school_admin',
      isPlatformAdmin: false,
    });

    // Default: non-empty template bytes
    mockBuildRosterTemplate.mockReturnValue(new Uint8Array([1, 2, 3, 4, 5]));
  });

  // ── Guard rejection ──────────────────────────────────────────────────────────

  it('returns 403 (no body bytes read) when caller is not a school admin tier', async () => {
    const { NextResponse } = await import('next/server');
    mockGuardSchoolAdmin.mockResolvedValue({
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const { GET } = await import('../template/route');
    const res = await GET();
    expect(res.status).toBe(403);
    // Template builder must NOT be called
    expect(mockBuildRosterTemplate).not.toHaveBeenCalled();
  });

  it('returns 401 when caller is unauthenticated', async () => {
    const { NextResponse } = await import('next/server');
    mockGuardSchoolAdmin.mockResolvedValue({
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const { GET } = await import('../template/route');
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockBuildRosterTemplate).not.toHaveBeenCalled();
  });

  // ── Successful download ──────────────────────────────────────────────────────

  it('returns 200 with the correct Content-Type header for a school admin', async () => {
    const { GET } = await import('../template/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('returns the attachment Content-Disposition header for a school admin', async () => {
    const { GET } = await import('../template/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="CORE_Roster_Template.xlsx"',
    );
  });

  it('returns a non-empty body for a school admin', async () => {
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

  it('returns 200 for a platform_admin', async () => {
    mockGuardSchoolAdmin.mockResolvedValue({
      userId: 'plat-admin-1',
      schoolId: null,
      role: 'platform_admin',
      isPlatformAdmin: true,
    });

    const { GET } = await import('../template/route');
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
