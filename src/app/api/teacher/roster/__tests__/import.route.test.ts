// src/app/api/teacher/roster/__tests__/import.route.test.ts
// Tests for POST /api/teacher/roster/import (lean student-file import for a class).
// Auth: STAFF_ROLES + guardClassAccess. schoolId is derived from the CLASS record
// (not the caller profile) so the engine always operates under the class's school.
// Node env. Hoisted-mock pattern.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Audit mock (must be hoisted before any import of the route) ──────────────
const mockLogAudit = vi.fn();
vi.mock('@/lib/audit/logAudit', () => ({ logAudit: (...a: unknown[]) => mockLogAudit(...a) }));

// ─── Shared mock state ────────────────────────────────────────────────────────

const getUser = vi.fn();
const profileSingle = vi.fn();
// Admin client: used for both the class-school_id lookup AND importStudentsToClass.
// We wire the admin 'from' chain to a single mock so tests can control it.
const classMaybeSingle = vi.fn();
const mockGuardClassAccess = vi.fn();
const mockParseStudentSheet = vi.fn();
const mockImportStudentsToClass = vi.fn();

// ─── Module mocks (hoisted top-level) ────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => {
  // The admin client needs to support:
  //   admin.from('classes').select('school_id').eq('id', classId).maybeSingle()
  const mockAdminFrom = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: classMaybeSingle,
      }),
    }),
  });
  const fakeAdmin = { from: mockAdminFrom };

  return {
    createServerSupabaseClient: async () => ({
      auth: { getUser },
      from: () => ({ select: () => ({ eq: () => ({ single: profileSingle }) }) }),
    }),
    createAdminSupabaseClient: vi.fn().mockReturnValue(fakeAdmin),
  };
});

vi.mock('@/lib/auth/guards', () => ({
  guardClassAccess: (...a: unknown[]) => mockGuardClassAccess(...a),
}));

vi.mock('@/lib/roster/parseWorkbook', () => ({
  parseStudentSheet: (...a: unknown[]) => mockParseStudentSheet(...a),
}));

vi.mock('@/lib/roster/importStudentsToClass', () => ({
  importStudentsToClass: (...a: unknown[]) => mockImportStudentsToClass(...a),
}));

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const FAKE_STUDENTS = [
  { fullName: 'Alice', email: 'alice@school.edu', password: 'Student2026!', gradeLevel: '9' },
  { fullName: 'Bob',   email: 'bob@school.edu',   password: 'Student2026!', gradeLevel: '9' },
];

const FAKE_SUMMARY = {
  studentsCreated:  2,
  studentsExisting: 0,
  enrolled:         2,
  alreadyEnrolled:  0,
  errors:           0,
  issues:           [],
};

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_MIME  = 'text/csv';

/**
 * Build a multipart FormData request.
 */
function makeFormReq(opts: {
  hasFile?:       boolean;
  fileSizeBytes?: number;
  fileMime?:      string;
  fileName?:      string;
  classId?:       string | null;
}): import('next/server').NextRequest {
  const {
    hasFile = true,
    fileSizeBytes = 100,
    fileMime = CSV_MIME,
    fileName,
    classId = 'class-1',
  } = opts;

  const form = new FormData();
  if (hasFile) {
    const blob = new File(
      [new Uint8Array(fileSizeBytes)],
      fileName ?? 'students.csv',
      { type: fileMime },
    );
    form.set('file', blob);
  }
  if (classId !== null) form.set('classId', classId);

  return new Request('http://localhost/api/teacher/roster/import', {
    method: 'POST',
    body: form,
  }) as unknown as import('next/server').NextRequest;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/teacher/roster/import', () => {
  beforeEach(() => {
    mockGuardClassAccess.mockReset();
    mockParseStudentSheet.mockReset();
    mockImportStudentsToClass.mockReset();
    mockLogAudit.mockReset();
    getUser.mockReset();
    profileSingle.mockReset();
    classMaybeSingle.mockReset();

    // Defaults: authenticated teacher, school-1
    getUser.mockResolvedValue({ data: { user: { id: 'teacher-1' } }, error: null });
    profileSingle.mockResolvedValue({ data: { role: 'teacher', school_id: 'school-1' }, error: null });
    mockGuardClassAccess.mockResolvedValue(null); // access granted
    // Class lookup returns school-1 (this is the class's school, not derived from profile)
    classMaybeSingle.mockResolvedValue({ data: { school_id: 'school-1' }, error: null });
    mockParseStudentSheet.mockReturnValue({ students: FAKE_STUDENTS, issues: [] });
    mockImportStudentsToClass.mockResolvedValue(FAKE_SUMMARY);
  });

  // ── Auth / role guards ───────────────────────────────────────────────────────

  it('401 when auth.getUser returns no user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(401);
    expect(mockImportStudentsToClass).not.toHaveBeenCalled();
  });

  it('401 when auth.getUser returns an error', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'jwt expired' } });
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(401);
    expect(mockImportStudentsToClass).not.toHaveBeenCalled();
  });

  it('403 for a non-staff role (student)', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'student', school_id: 'school-1' }, error: null });
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(403);
    expect(mockImportStudentsToClass).not.toHaveBeenCalled();
  });

  it('403 for a non-staff role (parent)', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'parent', school_id: 'school-1' }, error: null });
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(403);
    expect(mockImportStudentsToClass).not.toHaveBeenCalled();
  });

  // ── guardClassAccess denial ──────────────────────────────────────────────────

  it('403 when guardClassAccess denies — engine NOT called', async () => {
    const { NextResponse } = await import('next/server');
    mockGuardClassAccess.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(403);
    expect(mockImportStudentsToClass).not.toHaveBeenCalled();
  });

  it('401 when guardClassAccess returns 401 — engine NOT called', async () => {
    const { NextResponse } = await import('next/server');
    mockGuardClassAccess.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(401);
    expect(mockImportStudentsToClass).not.toHaveBeenCalled();
  });

  // ── Missing / invalid form fields ───────────────────────────────────────────

  it('400 when no file field is present', async () => {
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ hasFile: false }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/file/i);
    expect(mockImportStudentsToClass).not.toHaveBeenCalled();
  });

  it('400 when file field is not a Blob', async () => {
    // Submit a plain string value for 'file' — not a Blob
    const form = new FormData();
    form.set('file', 'not-a-blob');
    form.set('classId', 'class-1');
    const req = new Request('http://localhost/api/teacher/roster/import', {
      method: 'POST',
      body: form,
    }) as unknown as import('next/server').NextRequest;
    const { POST } = await import('../import/route');
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/file/i);
    expect(mockImportStudentsToClass).not.toHaveBeenCalled();
  });

  it('400 when classId is missing', async () => {
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ classId: null }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/classId/i);
    expect(mockImportStudentsToClass).not.toHaveBeenCalled();
  });

  it('413 when the file exceeds 5 MB', async () => {
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ fileSizeBytes: 5 * 1024 * 1024 + 1 }));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toMatch(/too large/i);
    expect(mockImportStudentsToClass).not.toHaveBeenCalled();
  });

  // ── MIME / extension guard (lean route accepts .csv OR .xlsx) ────────────────

  it('returns 415 when the file is an unrecognized type (e.g. .pdf)', async () => {
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ fileMime: 'application/pdf', fileName: 'data.pdf' }));
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toMatch(/unsupported file type/i);
    expect(mockImportStudentsToClass).not.toHaveBeenCalled();
  });

  it('returns 415 for octet-stream with no recognized extension', async () => {
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ fileMime: 'application/octet-stream', fileName: 'data.bin' }));
    expect(res.status).toBe(415);
    expect(mockImportStudentsToClass).not.toHaveBeenCalled();
  });

  it('accepts a .xlsx file for the lean route', async () => {
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ fileMime: XLSX_MIME, fileName: 'roster.xlsx' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toEqual(FAKE_SUMMARY);
  });

  it('accepts a .csv file for the lean route', async () => {
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({ fileMime: CSV_MIME, fileName: 'students.csv' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toEqual(FAKE_SUMMARY);
  });

  // ── school_id from the CLASS, not the profile ────────────────────────────────

  it('uses the CLASS school_id (not profile school_id) when calling importStudentsToClass', async () => {
    // Profile is school-profile, class is school-class — these should differ to verify pinning
    profileSingle.mockResolvedValue({ data: { role: 'teacher', school_id: 'school-profile' }, error: null });
    // Class belongs to a different school
    classMaybeSingle.mockResolvedValue({ data: { school_id: 'school-class' }, error: null });

    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(200);

    expect(mockImportStudentsToClass).toHaveBeenCalledOnce();
    const [, arg] = mockImportStudentsToClass.mock.calls[0] as [unknown, { schoolId: string; classId: string }];
    // Must use the class's school, not the profile's school
    expect(arg.schoolId).toBe('school-class');
    expect(arg.schoolId).not.toBe('school-profile');
  });

  it('403 when the class lookup returns no school_id (class not found)', async () => {
    classMaybeSingle.mockResolvedValue({ data: null, error: null });
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(403);
    expect(mockImportStudentsToClass).not.toHaveBeenCalled();
  });

  // ── Happy path ───────────────────────────────────────────────────────────────

  it('happy path: calls importStudentsToClass with {classSchoolId, classId, students} and returns summary', async () => {
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.summary).toEqual(FAKE_SUMMARY);

    expect(mockGuardClassAccess).toHaveBeenCalledWith('class-1');
    expect(mockParseStudentSheet).toHaveBeenCalledOnce();
    expect(mockImportStudentsToClass).toHaveBeenCalledOnce();
    expect(mockImportStudentsToClass).toHaveBeenCalledWith(
      expect.anything(),
      { schoolId: 'school-1', classId: 'class-1', students: FAKE_STUDENTS },
    );
  });

  // ── Unexpected errors ────────────────────────────────────────────────────────

  it('500 (no raw detail) when importStudentsToClass throws', async () => {
    mockImportStudentsToClass.mockRejectedValue(new Error('DB connection failed'));
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal Server Error');
    expect(JSON.stringify(body)).not.toContain('DB connection');
  });

  it('500 (no raw detail) when parseStudentSheet throws', async () => {
    mockParseStudentSheet.mockImplementation(() => { throw new Error('corrupt CSV'); });
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal Server Error');
    expect(JSON.stringify(body)).not.toContain('corrupt CSV');
  });

  // ── Audit logging ────────────────────────────────────────────────────────────

  it('audit: logs roster.import with class resource + correct metadata on successful import', async () => {
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(200);

    expect(mockLogAudit).toHaveBeenCalledOnce();
    const [, entry] = mockLogAudit.mock.calls[0] as [unknown, import('@/lib/audit/logAudit').AuditEntry];
    expect(entry.action).toBe('roster.import');
    expect(entry.actorId).toBe('teacher-1');
    expect(entry.schoolId).toBe('school-1');
    expect(entry.resourceType).toBe('class');
    expect(entry.resourceId).toBe('class-1');
    // Metadata must map the REAL LeanImportSummary fields (not undefined)
    expect(entry.metadata).toEqual({
      studentsCreated: FAKE_SUMMARY.studentsCreated,   // 2
      enrolled:        FAKE_SUMMARY.enrolled,           // 2
      errors:          FAKE_SUMMARY.errors,             // 0
    });
  });

  it('audit: does NOT log on a failed (thrown) import', async () => {
    mockImportStudentsToClass.mockRejectedValue(new Error('DB down'));
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(500);
    expect(mockLogAudit).not.toHaveBeenCalled();
  });
});
