// src/app/api/teacher/roster/__tests__/import.route.test.ts
// Tests for POST /api/teacher/roster/import (lean student-file import for a teacher's class).
// Node env. Hoisted-mock pattern from admin/roster import and google/import-roster tests.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Shared mock state ────────────────────────────────────────────────────────

const getUser = vi.fn();
const profileSingle = vi.fn();
const mockGuardClassAccess = vi.fn();
const mockParseStudentSheet = vi.fn();
const mockImportStudentsToClass = vi.fn();

// ─── Module mocks (hoisted top-level) ────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ single: profileSingle }) }) }),
  }),
  createAdminSupabaseClient: vi.fn().mockReturnValue({}),
}));

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

/**
 * Build a multipart FormData request — mirrors the admin roster import helper.
 */
function makeFormReq(opts: {
  hasFile?:      boolean;
  fileSizeBytes?: number;
  classId?:      string | null;
}): import('next/server').NextRequest {
  const { hasFile = true, fileSizeBytes = 100, classId = 'class-1' } = opts;

  const form = new FormData();
  if (hasFile) {
    form.set(
      'file',
      new Blob([new Uint8Array(fileSizeBytes)], { type: 'text/csv' }),
    );
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
    getUser.mockReset();
    profileSingle.mockReset();

    // Defaults: authenticated teacher with a school_id
    getUser.mockResolvedValue({ data: { user: { id: 'teacher-1' } }, error: null });
    profileSingle.mockResolvedValue({ data: { role: 'teacher', school_id: 'school-1' }, error: null });
    mockGuardClassAccess.mockResolvedValue(null); // access granted
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

  it('403 for a non-teacher role (student)', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'student', school_id: 'school-1' }, error: null });
    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(403);
    expect(mockImportStudentsToClass).not.toHaveBeenCalled();
  });

  it('403 when the teacher profile has no school_id (null)', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'teacher', school_id: null }, error: null });
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

  // ── Happy path ───────────────────────────────────────────────────────────────

  it('happy path: calls importStudentsToClass with {schoolId,classId,students} and returns summary', async () => {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    const fakeAdmin = { _tag: 'admin' };
    vi.mocked(createAdminSupabaseClient).mockReturnValue(fakeAdmin as never);

    const { POST } = await import('../import/route');
    const res = await POST(makeFormReq({}));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.summary).toEqual(FAKE_SUMMARY);

    expect(mockGuardClassAccess).toHaveBeenCalledWith('class-1');
    expect(mockParseStudentSheet).toHaveBeenCalledOnce();
    expect(mockImportStudentsToClass).toHaveBeenCalledOnce();
    expect(mockImportStudentsToClass).toHaveBeenCalledWith(
      fakeAdmin,
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
});
