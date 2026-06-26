// src/app/api/admin/school-report/__tests__/route.test.ts
// Tests for GET /api/admin/school-report
// Covers: 401/403 auth gates, 400 for platform_admin with no ?school=,
// correct Content-Type, CSV header row, school-pinning for non-platform admins,
// and ?school= param handling for platform admins.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SchoolReport } from '@/lib/school/loadSchoolReport';

// ── Module mocks (hoisted, top-level vi.mock — the RELIABLE pattern) ──────────

const mockGuardSchoolAdmin = vi.fn();
vi.mock('@/lib/auth/guards', () => ({
  guardSchoolAdmin: () => mockGuardSchoolAdmin(),
}));

const mockLoadSchoolReport = vi.fn();
vi.mock('@/lib/school/loadSchoolReport', () => ({
  loadSchoolReport: (...args: unknown[]) => mockLoadSchoolReport(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: vi.fn(() => ({})),
  createServerSupabaseClient: vi.fn(),
}));

// ── Shared fixtures ───────────────────────────────────────────────────────────

const SAMPLE_REPORT: SchoolReport = {
  schoolName: 'Test School',
  totalStudents: 10,
  totalTeachers: 3,
  totalClasses: 2,
  totalAssignmentsSubmitted: 5,
  totalQuizzesPublished: 3,
  classes: [
    {
      classId: 'c1',
      className: 'Math 9A',
      teacherName: 'Alice Teacher',
      enrolledStudents: 5,
      assignmentsCreated: 3,
      assignmentsSubmitted: 2,
      quizzesPublished: 2,
    },
    {
      classId: 'c2',
      className: 'English 7B',
      teacherName: null,
      enrolledStudents: 5,
      assignmentsCreated: 4,
      assignmentsSubmitted: 3,
      quizzesPublished: 1,
    },
  ],
};

function schoolAdminCtx(overrides: Partial<{
  schoolId: string | null;
  role: string;
  isPlatformAdmin: boolean;
}> = {}) {
  return {
    schoolId: 'school-1',
    role: 'school_admin',
    userId: 'u1',
    isPlatformAdmin: false,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/school-report', () => {
  beforeEach(() => {
    mockGuardSchoolAdmin.mockReset();
    mockLoadSchoolReport.mockReset();
    vi.resetModules();
  });

  // ── Auth gates ─────────────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    const { NextResponse } = await import('next/server');
    mockGuardSchoolAdmin.mockResolvedValue({
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const { GET } = await import('@/app/api/admin/school-report/route');
    const res = await GET(new Request('http://localhost/api/admin/school-report'));
    expect(res.status).toBe(401);
  });

  it('returns 403 when role is not school-admin tier', async () => {
    const { NextResponse } = await import('next/server');
    mockGuardSchoolAdmin.mockResolvedValue({
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const { GET } = await import('@/app/api/admin/school-report/route');
    const res = await GET(new Request('http://localhost/api/admin/school-report'));
    expect(res.status).toBe(403);
  });

  // ── Platform admin without ?school= ───────────────────────────────────────

  it('returns 400 when platform_admin provides no ?school= param', async () => {
    mockGuardSchoolAdmin.mockResolvedValue(
      schoolAdminCtx({ schoolId: null, role: 'platform_admin', isPlatformAdmin: true }),
    );

    const { GET } = await import('@/app/api/admin/school-report/route');
    const res = await GET(new Request('http://localhost/api/admin/school-report'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  // ── Happy-path: CSV response ───────────────────────────────────────────────

  it('returns 200 with text/csv Content-Type for an authed school_admin', async () => {
    mockGuardSchoolAdmin.mockResolvedValue(schoolAdminCtx());
    mockLoadSchoolReport.mockResolvedValue(SAMPLE_REPORT);

    const { GET } = await import('@/app/api/admin/school-report/route');
    const res = await GET(new Request('http://localhost/api/admin/school-report'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
  });

  it('CSV response includes a Content-Disposition attachment header', async () => {
    mockGuardSchoolAdmin.mockResolvedValue(schoolAdminCtx());
    mockLoadSchoolReport.mockResolvedValue(SAMPLE_REPORT);

    const { GET } = await import('@/app/api/admin/school-report/route');
    const res = await GET(new Request('http://localhost/api/admin/school-report'));
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
  });

  it('CSV has the expected header row as first line', async () => {
    mockGuardSchoolAdmin.mockResolvedValue(schoolAdminCtx());
    mockLoadSchoolReport.mockResolvedValue(SAMPLE_REPORT);

    const { GET } = await import('@/app/api/admin/school-report/route');
    const res = await GET(new Request('http://localhost/api/admin/school-report'));
    const csv = await res.text();
    const firstLine = csv.split('\r\n')[0];
    expect(firstLine).toBe(
      'classId,className,teacherName,enrolledStudents,assignmentsCreated,assignmentsSubmitted,quizzesPublished',
    );
  });

  it('CSV has one data row per class', async () => {
    mockGuardSchoolAdmin.mockResolvedValue(schoolAdminCtx());
    mockLoadSchoolReport.mockResolvedValue(SAMPLE_REPORT);

    const { GET } = await import('@/app/api/admin/school-report/route');
    const res = await GET(new Request('http://localhost/api/admin/school-report'));
    const csv = await res.text();
    const lines = csv.split('\r\n').filter(Boolean);
    // 1 header + 2 class rows
    expect(lines).toHaveLength(3);
  });

  // ── Security: school-pinning ───────────────────────────────────────────────

  it('pins a non-platform-admin to their own schoolId, ignores ?school= param', async () => {
    mockGuardSchoolAdmin.mockResolvedValue(
      schoolAdminCtx({ schoolId: 'school-pinned' }),
    );
    mockLoadSchoolReport.mockResolvedValue(SAMPLE_REPORT);

    const { GET } = await import('@/app/api/admin/school-report/route');
    const res = await GET(
      new Request('http://localhost/api/admin/school-report?school=other-school'),
    );
    expect(res.status).toBe(200);
    // Must have been called with the SESSION school, not the URL param
    expect(mockLoadSchoolReport).toHaveBeenCalledWith(
      expect.anything(),
      'school-pinned',
    );
  });

  // ── Platform admin uses ?school= ──────────────────────────────────────────

  it('platform_admin report is scoped to the ?school= param', async () => {
    mockGuardSchoolAdmin.mockResolvedValue(
      schoolAdminCtx({ schoolId: null, role: 'platform_admin', isPlatformAdmin: true }),
    );
    mockLoadSchoolReport.mockResolvedValue(SAMPLE_REPORT);

    const { GET } = await import('@/app/api/admin/school-report/route');
    const res = await GET(
      new Request('http://localhost/api/admin/school-report?school=target-school'),
    );
    expect(res.status).toBe(200);
    expect(mockLoadSchoolReport).toHaveBeenCalledWith(
      expect.anything(),
      'target-school',
    );
  });
});
