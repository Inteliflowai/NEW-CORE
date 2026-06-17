/**
 * Object-level guard tests — TDD for src/lib/auth/guards.ts
 *
 * These tests verify REAL authorization logic:
 * - Authorized callers PASS (guard returns null or success shape)
 * - Unauthorized/cross-school/cross-user callers are REJECTED (403/401)
 * - A teacher reading another school's student MUST be rejected
 *
 * Strategy: mock createServerSupabaseClient + createAdminSupabaseClient so no
 * network is required, but the guard logic itself is exercised end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal Supabase-shaped mock for the server (session) client. */
function makeServerMock(user: { id: string } | null, profile: { role: string; school_id: string | null } | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: profile }),
    }),
  };
}

/** Build a minimal admin client mock with configurable table responses. */
function makeAdminMock(tableData: Record<string, unknown>) {
  const createChain = (data: unknown) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data }),
  });
  return {
    from: vi.fn((table: string) => createChain(tableData[table] ?? null)),
  };
}

// ─── module mocking ───────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

// ─── guardPlatformAdmin ───────────────────────────────────────────────────────

describe('guardPlatformAdmin', () => {
  beforeEach(() => vi.resetModules());

  it('returns null (passes) for a platform_admin caller', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'u1' }, { role: 'platform_admin', school_id: null }) as never,
    );
    const { guardPlatformAdmin } = await import('@/lib/auth/guards');
    const result = await guardPlatformAdmin();
    expect(result).toBeNull();
  });

  it('returns 403 for a teacher (not platform_admin)', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'u2' }, { role: 'teacher', school_id: 'school-A' }) as never,
    );
    const { guardPlatformAdmin } = await import('@/lib/auth/guards');
    const result = await guardPlatformAdmin();
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('returns 401 when not authenticated', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock(null, null) as never,
    );
    const { guardPlatformAdmin } = await import('@/lib/auth/guards');
    const result = await guardPlatformAdmin();
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it('REJECTS a school_admin from the platform_admin guard (cross-tier IDOR)', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'u3' }, { role: 'school_admin', school_id: 'school-A' }) as never,
    );
    const { guardPlatformAdmin } = await import('@/lib/auth/guards');
    const result = await guardPlatformAdmin();
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });
});

// ─── guardSchoolAdmin ─────────────────────────────────────────────────────────

describe('guardSchoolAdmin', () => {
  beforeEach(() => vi.resetModules());

  it('returns schoolId + role + userId for a school_admin', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'sa1' }, { role: 'school_admin', school_id: 'school-X' }) as never,
    );
    const { guardSchoolAdmin } = await import('@/lib/auth/guards');
    const result = await guardSchoolAdmin();
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.schoolId).toBe('school-X');
      expect(result.role).toBe('school_admin');
      expect(result.userId).toBe('sa1');
    }
  });

  it('returns schoolId + role for a school_sysadmin', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'ss1' }, { role: 'school_sysadmin', school_id: 'school-Y' }) as never,
    );
    const { guardSchoolAdmin } = await import('@/lib/auth/guards');
    const result = await guardSchoolAdmin();
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.role).toBe('school_sysadmin');
    }
  });

  it('returns { error } with 403 for a teacher (not school-admin-tier)', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'tr1' }, { role: 'teacher', school_id: 'school-A' }) as never,
    );
    const { guardSchoolAdmin } = await import('@/lib/auth/guards');
    const result = await guardSchoolAdmin();
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(403);
    }
  });

  it('returns { error } with 401 when unauthenticated', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock(null, null) as never,
    );
    const { guardSchoolAdmin } = await import('@/lib/auth/guards');
    const result = await guardSchoolAdmin();
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(401);
    }
  });

  it('REJECTS a student from the school_admin guard (IDOR)', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'stu1' }, { role: 'student', school_id: 'school-A' }) as never,
    );
    const { guardSchoolAdmin } = await import('@/lib/auth/guards');
    const result = await guardSchoolAdmin();
    expect('error' in result).toBe(true);
  });
});

// ─── guardClassAccess ─────────────────────────────────────────────────────────

describe('guardClassAccess', () => {
  beforeEach(() => vi.resetModules());

  it('passes for a teacher who owns the class', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'teacher-1' }, { role: 'teacher', school_id: 'school-A' }) as never,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ classes: { teacher_id: 'teacher-1', school_id: 'school-A' } }) as never,
    );
    const { guardClassAccess } = await import('@/lib/auth/guards');
    expect(await guardClassAccess('class-1')).toBeNull();
  });

  it('passes for a school_admin in the same school', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'admin-1' }, { role: 'school_admin', school_id: 'school-A' }) as never,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ classes: { teacher_id: 'other-teacher', school_id: 'school-A' } }) as never,
    );
    const { guardClassAccess } = await import('@/lib/auth/guards');
    expect(await guardClassAccess('class-1')).toBeNull();
  });

  it('passes for a platform_admin on any class', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'pa-1' }, { role: 'platform_admin', school_id: null }) as never,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock({}) as never);
    const { guardClassAccess } = await import('@/lib/auth/guards');
    expect(await guardClassAccess('any-class')).toBeNull();
  });

  it('REJECTS a teacher trying to access another teacher\'s class (IDOR)', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'teacher-2' }, { role: 'teacher', school_id: 'school-A' }) as never,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ classes: { teacher_id: 'teacher-1', school_id: 'school-A' } }) as never,
    );
    const { guardClassAccess } = await import('@/lib/auth/guards');
    const result = await guardClassAccess('class-1');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('REJECTS a school_admin trying to access a class in a DIFFERENT school (cross-school IDOR)', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'admin-B' }, { role: 'school_admin', school_id: 'school-B' }) as never,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ classes: { teacher_id: 'teacher-A', school_id: 'school-A' } }) as never,
    );
    const { guardClassAccess } = await import('@/lib/auth/guards');
    const result = await guardClassAccess('class-A');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('returns 403 (not 404) for a non-existent class (do not leak existence)', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'teacher-1' }, { role: 'teacher', school_id: 'school-A' }) as never,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ classes: null }) as never,
    );
    const { guardClassAccess } = await import('@/lib/auth/guards');
    const result = await guardClassAccess('nonexistent-class');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });
});

// ─── guardStudentAccess ───────────────────────────────────────────────────────

describe('guardStudentAccess', () => {
  beforeEach(() => vi.resetModules());

  it('passes for the student accessing their own record', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'stu-1' }, { role: 'student', school_id: 'school-A' }) as never,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock({}) as never);
    const { guardStudentAccess } = await import('@/lib/auth/guards');
    expect(await guardStudentAccess('stu-1')).toBeNull();
  });

  it('passes for a platform_admin', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'pa-1' }, { role: 'platform_admin', school_id: null }) as never,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock({}) as never);
    const { guardStudentAccess } = await import('@/lib/auth/guards');
    expect(await guardStudentAccess('any-stu')).toBeNull();
  });

  it('passes for a same-school school_admin', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'admin-A' }, { role: 'school_admin', school_id: 'school-A' }) as never,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ users: { school_id: 'school-A', parent_id: null } }) as never,
    );
    const { guardStudentAccess } = await import('@/lib/auth/guards');
    expect(await guardStudentAccess('stu-2')).toBeNull();
  });

  it('passes for the linked parent', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'parent-1' }, { role: 'parent', school_id: null }) as never,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ users: { school_id: 'school-A', parent_id: 'parent-1' } }) as never,
    );
    const { guardStudentAccess } = await import('@/lib/auth/guards');
    expect(await guardStudentAccess('stu-3')).toBeNull();
  });

  it('REJECTS a teacher reading a student in a different school (cross-school IDOR)', async () => {
    /**
     * The teacher has no classes enrolling this student.
     * This is the CRITICAL cross-school IDOR test: a teacher from school-B
     * MUST NOT read a student from school-A even if no enrollment check fires.
     */
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'teacher-B' }, { role: 'teacher', school_id: 'school-B' }) as never,
    );
    // student is in school-A; teacher has no classes with this student
    const adminMock = {
      from: vi.fn((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { school_id: 'school-A', parent_id: null } }),
          };
        }
        if (table === 'classes') {
          // teacher has a class in school-B
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: [{ id: 'class-B' }] }),
          };
        }
        if (table === 'enrollments') {
          // student is NOT enrolled in teacher's class
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          };
        }
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null }) };
      }),
    };
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);
    const { guardStudentAccess } = await import('@/lib/auth/guards');
    const result = await guardStudentAccess('stu-A');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('REJECTS a parent accessing a student they are NOT linked to (cross-user IDOR)', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'parent-2' }, { role: 'parent', school_id: null }) as never,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ users: { school_id: 'school-A', parent_id: 'parent-OTHER' } }) as never,
    );
    const { guardStudentAccess } = await import('@/lib/auth/guards');
    const result = await guardStudentAccess('stu-X');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('REJECTS a school_admin from a different school (cross-school IDOR)', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'admin-B' }, { role: 'school_admin', school_id: 'school-B' }) as never,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ users: { school_id: 'school-A', parent_id: null } }) as never,
    );
    const { guardStudentAccess } = await import('@/lib/auth/guards');
    const result = await guardStudentAccess('stu-A');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('returns 403 for a non-existent student', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'admin-A' }, { role: 'school_admin', school_id: 'school-A' }) as never,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ users: null }) as never,
    );
    const { guardStudentAccess } = await import('@/lib/auth/guards');
    const result = await guardStudentAccess('ghost-stu');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });
});
