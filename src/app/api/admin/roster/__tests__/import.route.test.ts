// src/app/api/admin/roster/__tests__/import.route.test.ts
// Tests for POST /api/admin/roster/import
// Route is now open to STAFF_ROLES (teacher-run full import, Marvin 2026-06-24).
// Non-platform callers are pinned to their OWN school — any form schoolId is ignored.
// Node env (xlsx + FormData round-trip). Hoisted-mock pattern.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Audit mock (must be hoisted before any import of the route) ──────────────
const mockLogAudit = vi.fn();
vi.mock('@/lib/audit/logAudit', () => ({ logAudit: (...a: unknown[]) => mockLogAudit(...a) }));

// ─── Shared mock state ────────────────────────────────────────────────────────

const getUser = vi.fn();
const profileSingle = vi.fn();
const mockParseRosterWorkbook = vi.fn();
const mockImportRoster = vi.fn();

// ─── Module mocks (hoisted, top-level — the reliable pattern) ─────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ single: profileSingle }) }) }),
  }),
  createAdminSupabaseClient: vi.fn().mockReturnValue({}),
}));

vi.mock('@/lib/roster/parseWorkbook', () => ({
  parseRosterWorkbook: (...a: unknown[]) => mockParseRosterWorkbook(...a),
}));

vi.mock('@/lib/roster/importRoster', () => ({
  importRoster: (...a: unknown[]) => mockImportRoster(...a),
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

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Build a multipart FormData request. */
function makeFormReq(opts: {
  hasFile?: boolean;
  fileSizeBytes?: number;
  fileMime?: string;
  fileName?: string;
  mode?: string;
  schoolId?: string;
}): import('next/server').NextRequest {
  const {
    hasFile = true,
    fileSizeBytes = 100,
    fileMime = XLSX_MIME,
    fileName,
    mode,
    schoolId,
  } = opts;

  const form = new FormData();
  if (hasFile) {
    const blob = new File(
      [new Uint8Array(fileSizeBytes)],
      fileName ?? 'roster.xlsx',
      { type: fileMime },
    );
    form.set('file', blob);
  }
  if (mode !== undefined) form.set('mode', mode);
  if (schoolId !== undefined) form.set('schoolId', schoolId);

  return new Request('http://localhost/api/admin/roster/import', {
    method: 'POST',
    body: form,
  }) as unknown as import('next/server').NextRequest;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/roster/import', () => {
  beforeEach(() => {
    mockParseRosterWorkbook.mockReset();
    mockImportRoster.mockReset();
    mockLogAudit.mockReset();
    getUser.mockReset();
    profileSingle.mockReset();

    // Default: authenticated teacher, school-1
    getUser.mockResolvedValue({ data: { user: { id: 'teacher-1' } }, error: null });
    profileSingle.mockResolvedValue({
      data: { role: 'teacher', school_id: 'school-1' },
      error: null,
    });

    mockParseRosterWorkbook.mockReturnValue({ roster: FAKE_ROSTER, issues: FAKE_ISSUES });
    mockImportRoster.mockResolvedValue(FAKE_SUMMARY);
  });

  // ── Auth rejection ───────────────────────────────────────────────────────────

  it('returns 401 when caller is unauthenticated (no user)', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(401);
    expect(mockImportRoster).not.toHaveBeenCalled();
  });

  it('returns 401 when getUser returns an auth error', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'jwt expired' } });
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(401);
    expect(mockImportRoster).not.toHaveBeenCalled();
  });

  // ── Role rejection ───────────────────────────────────────────────────────────

  it('returns 403 for a non-staff role (student)', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'student', school_id: 'school-1' }, error: null });
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(403);
    expect(mockImportRoster).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-staff role (parent)', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'parent', school_id: 'school-1' }, error: null });
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(403);
    expect(mockImportRoster).not.toHaveBeenCalled();
  });

  it('returns 403 when non-platform caller has no school_id', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'teacher', school_id: null }, error: null });
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(403);
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
    const res = await POST(makeFormReq({ fileSizeBytes: 5 * 1024 * 1024 + 1 }));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toMatch(/too large/i);
    expect(mockParseRosterWorkbook).not.toHaveBeenCalled();
    expect(mockImportRoster).not.toHaveBeenCalled();
  });

  // ── MIME / extension guard (full route = .xlsx only) ────────────────────────

  it('returns 415 when the uploaded file has CSV mime type', async () => {
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ fileMime: 'text/csv', fileName: 'students.csv' }));
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toMatch(/unsupported file type/i);
    expect(mockParseRosterWorkbook).not.toHaveBeenCalled();
  });

  it('returns 415 when the mime is application/octet-stream and name is not .xlsx', async () => {
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ fileMime: 'application/octet-stream', fileName: 'data.bin' }));
    expect(res.status).toBe(415);
    expect(mockParseRosterWorkbook).not.toHaveBeenCalled();
  });

  it('accepts a file with a .xlsx extension even if mime is octet-stream', async () => {
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ fileMime: 'application/octet-stream', fileName: 'roster.xlsx', mode: 'preview' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('preview');
  });

  // ── platform_admin schoolId rules ────────────────────────────────────────────

  it('returns 400 when caller is platform_admin and no schoolId field is provided', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'platform_admin', school_id: null }, error: null });
    const { POST } = await import('../import/route');
    // No schoolId in form
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/schoolId/i);
    expect(mockImportRoster).not.toHaveBeenCalled();
  });

  it('accepts a schoolId field when caller is platform_admin (preview)', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'platform_admin', school_id: null }, error: null });
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ mode: 'preview', schoolId: 'target-school' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('preview');
    // importRoster should NOT be called in preview
    expect(mockImportRoster).not.toHaveBeenCalled();
  });

  it('platform_admin: passes the form schoolId to importRoster in commit mode', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'platform_admin', school_id: null }, error: null });
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ mode: 'commit', schoolId: 'target-school' }));
    expect(res.status).toBe(200);
    expect(mockImportRoster).toHaveBeenCalledOnce();
    expect(mockImportRoster).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ schoolId: 'target-school' }),
    );
  });

  // ── Own-school-pinning: non-platform callers CANNOT import into another school ──

  it('teacher: ignores any form schoolId and uses profile school_id (own-school-pinning)', async () => {
    // Teacher profile is school-1; they try to pass school-999 in the form
    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    const fakeAdmin = {};
    vi.mocked(createAdminSupabaseClient).mockReturnValue(fakeAdmin as never);

    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ mode: 'commit', schoolId: 'school-999' }));
    expect(res.status).toBe(200);

    // importRoster must have been called with the teacher's OWN school, not school-999
    expect(mockImportRoster).toHaveBeenCalledOnce();
    expect(mockImportRoster).toHaveBeenCalledWith(
      fakeAdmin,
      expect.objectContaining({ schoolId: 'school-1' }),
    );
    // Explicitly: NOT called with school-999
    const [, arg] = mockImportRoster.mock.calls[0] as [unknown, { schoolId: string }];
    expect(arg.schoolId).toBe('school-1');
    expect(arg.schoolId).not.toBe('school-999');
  });

  it('school_admin: ignores any form schoolId and uses profile school_id (own-school-pinning)', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'school_admin', school_id: 'school-2' }, error: null });
    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    const fakeAdmin = {};
    vi.mocked(createAdminSupabaseClient).mockReturnValue(fakeAdmin as never);

    const { POST } = await import('../import/route');
    // Pass a completely different schoolId in the form
    const res = await POST(makeFormReq({ mode: 'commit', schoolId: 'school-999' }));
    expect(res.status).toBe(200);
    expect(mockImportRoster).toHaveBeenCalledWith(
      fakeAdmin,
      expect.objectContaining({ schoolId: 'school-2' }),
    );
  });

  // ── Teacher happy-path (preview + commit) ────────────────────────────────────

  it('teacher: preview mode returns counts + issues without calling importRoster', async () => {
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ mode: 'preview' }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.mode).toBe('preview');
    expect(body.counts).toEqual({
      teachers:    FAKE_ROSTER.teachers.length,
      classes:     FAKE_ROSTER.classes.length,
      students:    FAKE_ROSTER.students.length,
      enrollments: FAKE_ROSTER.enrollments.length,
      parents:     FAKE_ROSTER.parents.length,
    });
    expect(body.issues).toEqual(FAKE_ISSUES);
    expect(mockImportRoster).not.toHaveBeenCalled();
  });

  it('teacher: commit mode calls importRoster with profile school_id and returns summary', async () => {
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

  // ── school_admin happy-path ───────────────────────────────────────────────────

  it('school_admin: commit mode calls importRoster with profile school_id', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'school_admin', school_id: 'school-2' }, error: null });
    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    const fakeAdmin = {};
    vi.mocked(createAdminSupabaseClient).mockReturnValue(fakeAdmin as never);

    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ mode: 'commit' }));
    expect(res.status).toBe(200);

    expect(mockImportRoster).toHaveBeenCalledOnce();
    expect(mockImportRoster).toHaveBeenCalledWith(
      fakeAdmin,
      expect.objectContaining({ schoolId: 'school-2' }),
    );
  });

  // ── Defaults ─────────────────────────────────────────────────────────────────

  it('defaults to preview mode when mode field is absent', async () => {
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));   // no mode field
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('preview');
    expect(mockImportRoster).not.toHaveBeenCalled();
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

  // ── Audit logging ────────────────────────────────────────────────────────────

  it('audit: logs roster.import with school resource + nested summary metadata on commit', async () => {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    const fakeAdmin = {};
    vi.mocked(createAdminSupabaseClient).mockReturnValue(fakeAdmin as never);

    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ mode: 'commit' }));
    expect(res.status).toBe(200);

    expect(mockLogAudit).toHaveBeenCalledOnce();
    const [, entry] = mockLogAudit.mock.calls[0] as [unknown, import('@/lib/audit/logAudit').AuditEntry];
    expect(entry.action).toBe('roster.import');
    expect(entry.actorId).toBe('teacher-1');
    expect(entry.schoolId).toBe('school-1');
    expect(entry.resourceType).toBe('school');
    expect(entry.resourceId).toBe('school-1');
    // Metadata must map the REAL ImportSummary nested fields (not undefined)
    expect(entry.metadata).toEqual({
      studentsCreated:     FAKE_SUMMARY.students.created,     // 2
      enrollmentsCreated:  FAKE_SUMMARY.enrollments.created,  // 2
    });
  });

  it('audit: does NOT log on preview mode (dry-run)', async () => {
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ mode: 'preview' }));
    expect(res.status).toBe(200);
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('audit: does NOT log on a failed commit (importRoster throws)', async () => {
    mockImportRoster.mockRejectedValue(new Error('DB down'));
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ mode: 'commit' }));
    expect(res.status).toBe(500);
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('audit: platform_admin commit logs with the supplied schoolId', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'platform_admin', school_id: null }, error: null });
    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createAdminSupabaseClient).mockReturnValue({} as never);

    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ mode: 'commit', schoolId: 'target-school' }));
    expect(res.status).toBe(200);

    expect(mockLogAudit).toHaveBeenCalledOnce();
    const [, entry] = mockLogAudit.mock.calls[0] as [unknown, import('@/lib/audit/logAudit').AuditEntry];
    expect(entry.schoolId).toBe('target-school');
    expect(entry.resourceId).toBe('target-school');
  });
});
