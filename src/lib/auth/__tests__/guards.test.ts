/**
 * Object-level guard tests — TDD for src/lib/auth/guards.ts
 *
 * These tests verify REAL authorization logic:
 * - Authorized callers PASS (guard returns null or success shape)
 * - Unauthorized/cross-school/cross-user callers are REJECTED (403/401)
 * - A teacher reading another school's student MUST be rejected
 * - The `.in('class_id', classIds)` enrollment filter is explicitly verified
 *
 * Strategy: mock createServerSupabaseClient + createAdminSupabaseClient so no
 * network is required, but the guard logic itself is exercised end-to-end.
 *
 * Mock note: the admin query builder is made THENABLE (via `.then()`) so that
 * `await admin.from('classes').select('id').eq('teacher_id', id)` correctly
 * resolves to `{ data: [...], error: null }` rather than returning the chain
 * object itself. Without this, `classIds` was always `[]` and the teacher
 * allow-path was structurally unreachable in tests.
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

/**
 * Build a thenable query chain that resolves to `{ data, error: null }` when
 * awaited. This is critical: the guard does `await admin.from('classes').select('id').eq(...)`
 * which must resolve to `{ data: [...] }` — not the chain object itself.
 *
 * The chain exposes `.select()`, `.eq()`, `.in()`, `.limit()`, `.maybeSingle()`
 * so all method calls in guards.ts typecheck and chain correctly. The `.then()`
 * method makes the builder itself a thenable, so awaiting the chain (without a
 * terminal `.maybeSingle()`) resolves to `resolvedValue`.
 */
function makeTheanableChain(resolvedValue: unknown, maybeSingleValue: unknown) {
  const chain: Record<string, unknown> = {};
  chain['select'] = vi.fn().mockReturnValue(chain);
  chain['eq'] = vi.fn().mockReturnValue(chain);
  chain['in'] = vi.fn().mockReturnValue(chain);
  chain['limit'] = vi.fn().mockReturnValue(chain);
  chain['maybeSingle'] = vi.fn().mockResolvedValue(maybeSingleValue);
  // Make the chain itself thenable so `await chain` resolves to resolvedValue
  chain['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve(resolvedValue).then(resolve);
  return chain;
}

/**
 * Build a minimal admin client mock with configurable per-table responses.
 *
 * `listData`: used when the chain itself is awaited (list queries, e.g. classes lookup)
 * `singleData`: used when `.maybeSingle()` is called (single-row lookups)
 *
 * Both default to the same `tableData[table]` value; override per-table as needed.
 */
function makeAdminMock(tableData: Record<string, unknown>) {
  return {
    from: vi.fn((table: string) => {
      const val = tableData[table] ?? null;
      // For list results (array), resolve to { data: val, error: null } when awaited
      // For single results (object/null), use as maybeSingle value
      const isArray = Array.isArray(val);
      const resolvedValue = isArray ? { data: val, error: null } : { data: null, error: null };
      const maybeSingleValue = isArray ? { data: null, error: null } : { data: val, error: null };
      return makeTheanableChain(resolvedValue, maybeSingleValue);
    }),
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

  it('platform_admin returns isPlatformAdmin:true and schoolId:null (scope-hazard guard)', async () => {
    /**
     * IMPORTANT: platform_admin passes guardSchoolAdmin (it is in SCHOOL_ADMIN_ROLES).
     * The return shape MUST include `isPlatformAdmin: true` and `schoolId: null` so
     * callers cannot accidentally pass null into a `.eq('school_id', schoolId)` filter
     * without explicitly acknowledging the all-schools case.
     */
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'pa-1' }, { role: 'platform_admin', school_id: null }) as never,
    );
    const { guardSchoolAdmin } = await import('@/lib/auth/guards');
    const result = await guardSchoolAdmin();
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.isPlatformAdmin).toBe(true);
      expect(result.schoolId).toBeNull();
      expect(result.role).toBe('platform_admin');
    }
  });

  it('school_admin returns isPlatformAdmin:false (has school scope)', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'sa2' }, { role: 'school_admin', school_id: 'school-Z' }) as never,
    );
    const { guardSchoolAdmin } = await import('@/lib/auth/guards');
    const result = await guardSchoolAdmin();
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.isPlatformAdmin).toBe(false);
      expect(result.schoolId).toBe('school-Z');
    }
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

  it('passes for a teacher whose class includes the student (allow-path)', async () => {
    /**
     * This is the POSITIVE teacher test: the teacher teaches the student's class.
     * The mock resolves the classes list query to [{ id: 'class-A' }] and the
     * enrollment query confirms the student is in class-A → guard returns null.
     * This test verifies `if (enr) return null` in guards.ts is reachable.
     */
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'teacher-A' }, { role: 'teacher', school_id: 'school-A' }) as never,
    );
    const adminMock = {
      from: vi.fn((table: string) => {
        if (table === 'users') {
          // Student is in school-A
          return makeTheanableChain(
            { data: null, error: null },
            { data: { school_id: 'school-A', parent_id: null }, error: null },
          );
        }
        if (table === 'classes') {
          // Teacher owns class-A — list query resolves to array
          return makeTheanableChain(
            { data: [{ id: 'class-A' }], error: null },
            { data: null, error: null },
          );
        }
        if (table === 'enrollments') {
          // Student IS enrolled in class-A
          return makeTheanableChain(
            { data: null, error: null },
            { data: { id: 'enr-1' }, error: null },
          );
        }
        return makeTheanableChain({ data: null, error: null }, { data: null, error: null });
      }),
    };
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);
    const { guardStudentAccess } = await import('@/lib/auth/guards');
    expect(await guardStudentAccess('stu-A')).toBeNull();
  });

  it('REJECTS a teacher whose classes do NOT include the student (IDOR-filter test)', async () => {
    /**
     * IDOR filter verification: the teacher has class-B, but the student is only
     * enrolled in class-A. The `.in('class_id', ['class-B'])` filter must restrict
     * the enrollment lookup to the teacher's own classes only.
     *
     * To verify the filter is load-bearing: the `in` spy on the enrollments chain
     * is asserted to have been called with ('class_id', ['class-B']). If the guard
     * removed `.in('class_id', classIds)`, the `in` spy would not be called with
     * the teacher's classIds and this assertion would fail.
     */
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeServerMock({ id: 'teacher-B' }, { role: 'teacher', school_id: 'school-B' }) as never,
    );

    const enrollmentsChain = makeTheanableChain(
      { data: null, error: null },
      { data: null, error: null }, // no enrollment found
    );
    const inSpy = enrollmentsChain['in'] as ReturnType<typeof vi.fn>;

    const adminMock = {
      from: vi.fn((table: string) => {
        if (table === 'users') {
          return makeTheanableChain(
            { data: null, error: null },
            { data: { school_id: 'school-A', parent_id: null }, error: null },
          );
        }
        if (table === 'classes') {
          // Teacher has class-B
          return makeTheanableChain(
            { data: [{ id: 'class-B' }], error: null },
            { data: null, error: null },
          );
        }
        if (table === 'enrollments') {
          return enrollmentsChain;
        }
        return makeTheanableChain({ data: null, error: null }, { data: null, error: null });
      }),
    };
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);
    const { guardStudentAccess } = await import('@/lib/auth/guards');
    const result = await guardStudentAccess('stu-A');

    // Guard must REJECT (teacher's class-B does not enroll stu-A)
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);

    // The .in() filter MUST have been called with the teacher's class IDs.
    // Removing `.in('class_id', classIds)` from the guard would break this assertion.
    expect(inSpy).toHaveBeenCalledWith('class_id', ['class-B']);
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
          return makeTheanableChain(
            { data: null, error: null },
            { data: { school_id: 'school-A', parent_id: null }, error: null },
          );
        }
        if (table === 'classes') {
          // teacher has a class in school-B
          return makeTheanableChain(
            { data: [{ id: 'class-B' }], error: null },
            { data: null, error: null },
          );
        }
        if (table === 'enrollments') {
          // student is NOT enrolled in teacher's class
          return makeTheanableChain(
            { data: null, error: null },
            { data: null, error: null },
          );
        }
        return makeTheanableChain({ data: null, error: null }, { data: null, error: null });
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
