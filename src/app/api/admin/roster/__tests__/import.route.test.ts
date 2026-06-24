// src/app/api/admin/roster/__tests__/import.route.test.ts
// Tests for POST /api/admin/roster/import
// Node env (xlsx + FormData round-trip). Mirrors the hoisted-mock pattern used by
// other admin route tests (e.g. spark-enable/__tests__/route.test.ts).
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Shared mock state ────────────────────────────────────────────────────────

const mockGuardSchoolAdmin = vi.fn();
const mockParseRosterWorkbook = vi.fn();
const mockImportRoster = vi.fn();

// ─── Module mocks (hoisted, top-level — the reliable pattern) ─────────────────

vi.mock('@/lib/auth/guards', () => ({
  guardSchoolAdmin: () => mockGuardSchoolAdmin(),
}));

vi.mock('@/lib/roster/parseWorkbook', () => ({
  parseRosterWorkbook: (...a: unknown[]) => mockParseRosterWorkbook(...a),
}));

vi.mock('@/lib/roster/importRoster', () => ({
  importRoster: (...a: unknown[]) => mockImportRoster(...a),
}));

vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: vi.fn().mockReturnValue({}),
  createServerSupabaseClient: vi.fn(),
}));

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const FAKE_ROSTER = {
  teachers: [{ fullName: 'Alice', email: 'alice@school.edu', password: '' }],
  classes: [{ name: 'Math 101', subject: 'Math', gradeLevel: '9', period: '1', teacherEmail: 'alice@school.edu' }],
  students: [
    { fullName: 'Bob', email: 'bob@school.edu', password: '', gradeLevel: '9' },
    { fullName: 'Carol', email: 'carol@school.edu', password: '', gradeLevel: '9' },
  ],
  enrollments: [
    { studentEmail: 'bob@school.edu', className: 'Math 101', period: '1', teacherEmail: 'alice@school.edu' },
    { studentEmail: 'carol@school.edu', className: 'Math 101', period: '1', teacherEmail: 'alice@school.edu' },
  ],
  parents: [{ fullName: 'Dave', email: 'dave@school.edu', password: '', studentEmail: 'bob@school.edu' }],
};

const FAKE_ISSUES = [{ sheet: 'Students', row: 5, message: 'placeholder row skipped' }];

const FAKE_SUMMARY = {
  teachers:    { created: 1, skipped: 0, errors: 0 },
  classes:     { created: 1, skipped: 0, errors: 0 },
  students:    { created: 2, skipped: 0, errors: 0 },
  enrollments: { created: 2, skipped: 0, errors: 0 },
  parents:     { created: 1, linked: 0, skipped: 0, errors: 0 },
  issues: [],
};

/** Build a multipart FormData request — mirrors the drawing and upload test helpers. */
function makeFormReq(opts: {
  hasFile?: boolean;
  fileSizeBytes?: number;
  mode?: string;
  schoolId?: string;
}): import('next/server').NextRequest {
  const {
    hasFile = true,
    fileSizeBytes = 100,
    mode,
    schoolId,
  } = opts;

  const form = new FormData();
  if (hasFile) {
    form.set('file', new Blob([new Uint8Array(fileSizeBytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  }
  if (mode !== undefined) form.set('mode', mode);
  if (schoolId !== undefined) form.set('schoolId', schoolId);

  // Use standard Request so FormData Content-Type (multipart/form-data with boundary) is set
  // automatically by the browser-compatible FormData impl in Node.
  return new Request('http://localhost/api/admin/roster/import', {
    method: 'POST',
    body: form,
  }) as unknown as import('next/server').NextRequest;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/roster/import', () => {
  beforeEach(() => {
    mockGuardSchoolAdmin.mockReset();
    mockParseRosterWorkbook.mockReset();
    mockImportRoster.mockReset();

    // Defaults: school_admin (not platform admin), schoolId present
    mockGuardSchoolAdmin.mockResolvedValue({
      userId: 'admin-user-1',
      schoolId: 'school-1',
      role: 'school_admin',
      isPlatformAdmin: false,
    });

    mockParseRosterWorkbook.mockReturnValue({ roster: FAKE_ROSTER, issues: FAKE_ISSUES });
    mockImportRoster.mockResolvedValue(FAKE_SUMMARY);
  });

  // ── Guard rejection ──────────────────────────────────────────────────────────

  it('returns the guard error (403) when caller is not a school admin tier', async () => {
    const { NextResponse } = await import('next/server');
    mockGuardSchoolAdmin.mockResolvedValue({
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(403);
    expect(mockParseRosterWorkbook).not.toHaveBeenCalled();
    expect(mockImportRoster).not.toHaveBeenCalled();
  });

  it('returns the guard error (401) when caller is unauthenticated', async () => {
    const { NextResponse } = await import('next/server');
    mockGuardSchoolAdmin.mockResolvedValue({
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(401);
    expect(mockImportRoster).not.toHaveBeenCalled();
  });

  // ── Missing / invalid file ───────────────────────────────────────────────────

  it('returns 400 when no file field is present', async () => {
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ hasFile: false }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/file/i);
    expect(mockParseRosterWorkbook).not.toHaveBeenCalled();
    expect(mockImportRoster).not.toHaveBeenCalled();
  });

  it('returns 413 when the file exceeds 5 MB', async () => {
    const { POST } = await import('../import/route');
    // 5MB + 1 byte
    const res = await POST(makeFormReq({ fileSizeBytes: 5 * 1024 * 1024 + 1 }));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toMatch(/too large/i);
    expect(mockParseRosterWorkbook).not.toHaveBeenCalled();
    expect(mockImportRoster).not.toHaveBeenCalled();
  });

  // ── platform_admin missing schoolId field ────────────────────────────────────

  it('returns 400 when caller is platform_admin and no schoolId field is provided', async () => {
    mockGuardSchoolAdmin.mockResolvedValue({
      userId: 'plat-admin-1',
      schoolId: null,        // platform_admin always has null schoolId
      role: 'platform_admin',
      isPlatformAdmin: true,
    });

    const { POST } = await import('../import/route');
    // No schoolId in form
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/schoolId/i);
    expect(mockImportRoster).not.toHaveBeenCalled();
  });

  it('accepts a schoolId field when caller is platform_admin', async () => {
    mockGuardSchoolAdmin.mockResolvedValue({
      userId: 'plat-admin-1',
      schoolId: null,
      role: 'platform_admin',
      isPlatformAdmin: true,
    });

    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ mode: 'preview', schoolId: 'target-school' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('preview');
    // importRoster should NOT be called in preview
    expect(mockImportRoster).not.toHaveBeenCalled();
  });

  // ── Preview mode ─────────────────────────────────────────────────────────────

  it('returns counts + issues in preview mode WITHOUT calling importRoster', async () => {
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ mode: 'preview' }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.mode).toBe('preview');
    expect(body.counts).toEqual({
      teachers: FAKE_ROSTER.teachers.length,
      classes: FAKE_ROSTER.classes.length,
      students: FAKE_ROSTER.students.length,
      enrollments: FAKE_ROSTER.enrollments.length,
      parents: FAKE_ROSTER.parents.length,
    });
    expect(body.issues).toEqual(FAKE_ISSUES);

    // The engine must NOT be called during preview
    expect(mockImportRoster).not.toHaveBeenCalled();
  });

  it('defaults to preview mode when mode field is absent', async () => {
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));   // no mode field
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('preview');
    expect(mockImportRoster).not.toHaveBeenCalled();
  });

  // ── Commit mode ──────────────────────────────────────────────────────────────

  it('calls importRoster with the correct schoolId + roster in commit mode and returns summary', async () => {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    const fakeAdmin = {};
    vi.mocked(createAdminSupabaseClient).mockReturnValue(fakeAdmin as never);

    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ mode: 'commit' }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.mode).toBe('commit');
    expect(body.summary).toEqual(FAKE_SUMMARY);

    expect(mockImportRoster).toHaveBeenCalledOnce();
    expect(mockImportRoster).toHaveBeenCalledWith(
      fakeAdmin,
      expect.objectContaining({ schoolId: 'school-1', roster: FAKE_ROSTER }),
    );
  });

  it('passes the platform_admin-supplied schoolId to importRoster in commit mode', async () => {
    mockGuardSchoolAdmin.mockResolvedValue({
      userId: 'plat-admin-1',
      schoolId: null,
      role: 'platform_admin',
      isPlatformAdmin: true,
    });

    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ mode: 'commit', schoolId: 'target-school' }));
    expect(res.status).toBe(200);

    expect(mockImportRoster).toHaveBeenCalledOnce();
    expect(mockImportRoster).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ schoolId: 'target-school' }),
    );
  });

  // ── Unexpected errors ────────────────────────────────────────────────────────

  it('returns 500 (generic message, no raw detail) when importRoster throws', async () => {
    mockImportRoster.mockRejectedValue(new Error('DB connection refused'));

    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ mode: 'commit' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal Server Error');
    // Raw error must NOT be surfaced
    expect(JSON.stringify(body)).not.toContain('DB connection');
  });

  it('returns 500 (generic) when parseRosterWorkbook throws', async () => {
    mockParseRosterWorkbook.mockImplementation(() => { throw new Error('corrupt file'); });

    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ mode: 'preview' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal Server Error');
    expect(JSON.stringify(body)).not.toContain('corrupt file');
  });
});
