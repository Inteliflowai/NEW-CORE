// src/app/api/admin/provision-trial/__tests__/route-audit.test.ts
// TDD: audit logging for POST /api/admin/provision-trial
// Asserts logAudit is called with action:'school.provision', actorId from getUser, and correct metadata.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── helpers ──────────────────────────────────────────────────────────────────

const VALID_BODY = {
  school_name: 'Westfield Academy',
  teacher_email: 'teacher@school.edu',
  teacher_name: 'Jane Smith',
  trial_plan: 'pro',
  student_limit: 30,
};

function makeRequest(body: Record<string, unknown> = VALID_BODY): NextRequest {
  return new NextRequest('http://localhost/api/admin/provision-trial', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── module mocks (hoisted, top-level vi.mock) ────────────────────────────────

const mockGuardPlatformAdmin = vi.fn();
vi.mock('@/lib/auth/guards', () => ({
  guardPlatformAdmin: () => mockGuardPlatformAdmin(),
}));

const mockLogAudit = vi.fn();
vi.mock('@/lib/audit/logAudit', () => ({
  logAudit: (...a: unknown[]) => mockLogAudit(...a),
}));

// Mock provisionTrial
const mockProvisionTrial = vi.fn();
vi.mock('@/lib/trial/provisionTrial', () => ({
  provisionTrial: (...a: unknown[]) => mockProvisionTrial(...a),
}));

// Mock supabase (admin + server)
vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: vi.fn(),
  createServerSupabaseClient: vi.fn(),
}));

// ─── tests ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/provision-trial — audit logging', () => {
  const ADMIN_USER_ID = 'admin-user-uuid-001';
  const NEW_SCHOOL_ID = 'new-school-uuid-001';

  beforeEach(() => {
    mockGuardPlatformAdmin.mockReset();
    mockLogAudit.mockReset();
    mockProvisionTrial.mockReset();
    vi.resetModules();
  });

  it('calls logAudit with action school.provision, actorId from getUser, and correct metadata on 201', async () => {
    mockGuardPlatformAdmin.mockResolvedValue(null);

    const { createAdminSupabaseClient, createServerSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createAdminSupabaseClient).mockReturnValue({} as never);
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: ADMIN_USER_ID } } }),
      },
    } as never);

    mockProvisionTrial.mockResolvedValue({
      schoolId: NEW_SCHOOL_ID,
      teacherId: 'teacher-uuid-001',
      parentId: null,
      firstStudentId: null,
      password: 'SharedPass#999',
      trialExpiresAt: '2026-09-01T00:00:00.000Z',
      credentials: {
        teacher: { email: 'teacher@school.edu' },
      },
    });

    const { POST } = await import('@/app/api/admin/provision-trial/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(201);

    expect(mockLogAudit).toHaveBeenCalledOnce();
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.anything(), // admin client
      expect.objectContaining({
        actorId: ADMIN_USER_ID,
        schoolId: NEW_SCHOOL_ID,
        action: 'school.provision',
        resourceType: 'school',
        resourceId: NEW_SCHOOL_ID,
        metadata: expect.objectContaining({
          school_name: VALID_BODY.school_name,
          teacher_email: VALID_BODY.teacher_email,
        }),
      }),
    );
  });

  it('uses actorId null when getUser returns no user', async () => {
    mockGuardPlatformAdmin.mockResolvedValue(null);

    const { createAdminSupabaseClient, createServerSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createAdminSupabaseClient).mockReturnValue({} as never);
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    } as never);

    mockProvisionTrial.mockResolvedValue({
      schoolId: NEW_SCHOOL_ID,
      teacherId: 'teacher-uuid-001',
      parentId: null,
      firstStudentId: null,
      password: 'SharedPass#999',
      trialExpiresAt: '2026-09-01T00:00:00.000Z',
      credentials: { teacher: { email: 'teacher@school.edu' } },
    });

    const { POST } = await import('@/app/api/admin/provision-trial/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(201);

    expect(mockLogAudit).toHaveBeenCalledOnce();
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorId: null }),
    );
  });

  it('does NOT call logAudit when provisionTrial throws (500 path)', async () => {
    mockGuardPlatformAdmin.mockResolvedValue(null);

    const { createAdminSupabaseClient, createServerSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createAdminSupabaseClient).mockReturnValue({} as never);
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: ADMIN_USER_ID } } }),
      },
    } as never);

    mockProvisionTrial.mockRejectedValue(new Error('DB connection failed'));

    const { POST } = await import('@/app/api/admin/provision-trial/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(mockLogAudit).not.toHaveBeenCalled();
  });
});
