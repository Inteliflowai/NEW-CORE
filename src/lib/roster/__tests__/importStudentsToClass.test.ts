// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ensureAuthUser = vi.fn();
vi.mock('@/lib/trial/ensureAuthUser', () => ({
  ensureAuthUser: (...a: unknown[]) => ensureAuthUser(...a),
}));

// ---------------------------------------------------------------------------
// Fake admin: models the DB interactions importStudentsToClass makes.
//
// Tables touched:
//   users       — select by (email, school_id) to dedup
//   enrollments — select by (class_id, student_id) to skip existing; insert
// ---------------------------------------------------------------------------

interface FakeUser { id: string; role: string }
interface FakeSeat { id: string }

function fakeAdmin(opts: {
  preExistingUsers?:  Record<string, FakeUser>;
  enrollmentSeat?:    Record<string, FakeSeat>;
  usersSelectError?:  string;
  enrollInsertError?: string;
  /** If set, the enrollment insert resolves with { error: { code, message } } */
  enrollInsertCode?:  string;
}) {
  const preExistingUsers  = opts.preExistingUsers  ?? {};
  const enrollmentSeat    = opts.enrollmentSeat    ?? {};
  const usersSelectError  = opts.usersSelectError  ?? null;
  const enrollInsertError = opts.enrollInsertError ?? null;
  const enrollInsertCode  = opts.enrollInsertCode  ?? null;

  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];

  return {
    inserts,

    from(table: string) {
      // ---------------------------------------------------------------
      // users table — lookup pre-existing users by (email, school_id)
      // ---------------------------------------------------------------
      if (table === 'users') {
        return {
          select(_cols: string) {
            let emailFilter:  string | null = null;
            let schoolFilter: string | null = null;

            const chain: Record<string, unknown> = {};
            chain['eq'] = function(col: string, val: string) {
              if (col === 'email')     emailFilter  = val.toLowerCase();
              if (col === 'school_id') schoolFilter = val;
              return chain;
            };
            chain['then'] = function(resolve2: (v: { data: FakeUser[] | null; error: { message: string } | null }) => unknown) {
              if (usersSelectError) {
                return resolve2({ data: null, error: { message: usersSelectError } });
              }
              if (emailFilter && schoolFilter) {
                const key = `${emailFilter}|${schoolFilter}`;
                const found = preExistingUsers[key];
                return resolve2({ data: found ? [found] : [], error: null });
              }
              return resolve2({ data: [], error: null });
            };
            return chain;
          },
        };
      }

      // ---------------------------------------------------------------
      // enrollments table — supports find (maybeSingle) + insert
      // ---------------------------------------------------------------
      if (table === 'enrollments') {
        return {
          select(_cols: string) {
            let classFilter:   string | null = null;
            let studentFilter: string | null = null;
            const chain: Record<string, unknown> = {};
            chain['eq'] = function(col: string, val: string) {
              if (col === 'class_id')   classFilter   = val;
              if (col === 'student_id') studentFilter = val;
              return chain;
            };
            chain['maybeSingle'] = async function() {
              const key = `${classFilter}|${studentFilter}`;
              const found = enrollmentSeat[key] ?? null;
              return { data: found, error: null };
            };
            return chain;
          },
          insert(row: Record<string, unknown>) {
            inserts.push({ table: 'enrollments', row });
            if (enrollInsertCode) {
              return Promise.resolve({ error: { code: enrollInsertCode, message: enrollInsertError ?? 'Enrollment limit reached' } });
            }
            return Promise.resolve({ error: enrollInsertError ? { message: enrollInsertError } : null });
          },
        };
      }

      // Fallback
      return {
        select() {
          return {
            eq()          { return this; },
            maybeSingle:  async () => ({ data: null, error: null }),
            then(r: (v: { data: []; error: null }) => unknown) { return r({ data: [], error: null }); },
          };
        },
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Test data builder
// ---------------------------------------------------------------------------
function studentRow(overrides?: Partial<{ fullName: string; email: string; password: string; gradeLevel: string }>) {
  return {
    fullName:   'Alice Student',
    email:      'alice@school.edu',
    password:   '',
    gradeLevel: '8',
    ...overrides,
  };
}

const SCHOOL_ID = 'school-1';
const CLASS_ID  = 'class-1';

beforeEach(() => { ensureAuthUser.mockReset(); });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('importStudentsToClass — new student → created + enrolled', () => {
  it('creates and enrolls a new student (source=file)', async () => {
    ensureAuthUser.mockResolvedValueOnce('new-student-id');

    const admin = fakeAdmin({ preExistingUsers: {} });

    const { importStudentsToClass } = await import('@/lib/roster/importStudentsToClass');
    const summary = await importStudentsToClass(admin as never, {
      schoolId: SCHOOL_ID,
      classId:  CLASS_ID,
      students: [studentRow()],
    });

    expect(summary.studentsCreated).toBe(1);
    expect(summary.studentsExisting).toBe(0);
    expect(summary.enrolled).toBe(1);
    expect(summary.alreadyEnrolled).toBe(0);
    expect(summary.errors).toBe(0);
    expect(summary.issues).toHaveLength(0);

    // enrollment insert stamped source=file
    const enrollInsert = admin.inserts.find(i => i.table === 'enrollments');
    expect(enrollInsert).toBeDefined();
    expect(enrollInsert!.row.source).toBe('file');
    expect(enrollInsert!.row.class_id).toBe(CLASS_ID);
    expect(enrollInsert!.row.student_id).toBe('new-student-id');

    // ensureAuthUser called with correct args
    expect(ensureAuthUser).toHaveBeenCalledWith(expect.objectContaining({
      email:    'alice@school.edu',
      role:     'student',
      password: 'Student2026!',
    }));
  });
});

describe('importStudentsToClass — existing student → reused + enrolled', () => {
  it('reuses an existing student account and enrolls them (studentsExisting++)', async () => {
    // No ensureAuthUser call — student already exists
    const admin = fakeAdmin({
      preExistingUsers: {
        'alice@school.edu|school-1': { id: 'existing-student', role: 'student' },
      },
    });

    const { importStudentsToClass } = await import('@/lib/roster/importStudentsToClass');
    const summary = await importStudentsToClass(admin as never, {
      schoolId: SCHOOL_ID,
      classId:  CLASS_ID,
      students: [studentRow()],
    });

    expect(summary.studentsCreated).toBe(0);
    expect(summary.studentsExisting).toBe(1);
    expect(summary.enrolled).toBe(1);
    expect(summary.errors).toBe(0);
    expect(summary.issues).toHaveLength(0);

    expect(ensureAuthUser).not.toHaveBeenCalled();

    const enrollInsert = admin.inserts.find(i => i.table === 'enrollments');
    expect(enrollInsert).toBeDefined();
    expect(enrollInsert!.row.student_id).toBe('existing-student');
    expect(enrollInsert!.row.source).toBe('file');
  });
});

describe('importStudentsToClass — already-enrolled seat → alreadyEnrolled', () => {
  it('increments alreadyEnrolled when the seat already exists, does NOT insert a duplicate', async () => {
    const admin = fakeAdmin({
      preExistingUsers: {
        'alice@school.edu|school-1': { id: 'existing-student', role: 'student' },
      },
      enrollmentSeat: {
        'class-1|existing-student': { id: 'seat-already-there' },
      },
    });

    const { importStudentsToClass } = await import('@/lib/roster/importStudentsToClass');
    const summary = await importStudentsToClass(admin as never, {
      schoolId: SCHOOL_ID,
      classId:  CLASS_ID,
      students: [studentRow()],
    });

    expect(summary.alreadyEnrolled).toBe(1);
    expect(summary.enrolled).toBe(0);
    expect(summary.errors).toBe(0);

    expect(admin.inserts.filter(i => i.table === 'enrollments')).toHaveLength(0);
  });
});

describe('importStudentsToClass — non-student email → skipped + issue (rebind-refusal)', () => {
  it('skips a teacher email and records a rebind-refusal issue', async () => {
    const admin = fakeAdmin({
      preExistingUsers: {
        'teacher@school.edu|school-1': { id: 'teacher-user', role: 'teacher' },
      },
    });

    const { importStudentsToClass } = await import('@/lib/roster/importStudentsToClass');
    const summary = await importStudentsToClass(admin as never, {
      schoolId: SCHOOL_ID,
      classId:  CLASS_ID,
      students: [studentRow({ email: 'teacher@school.edu' })],
    });

    expect(summary.studentsCreated).toBe(0);
    expect(summary.studentsExisting).toBe(0);
    expect(summary.enrolled).toBe(0);
    expect(summary.errors).toBe(0);
    expect(summary.issues).toHaveLength(1);
    expect(summary.issues[0]).toMatch(/teacher@school\.edu/i);
    expect(summary.issues[0]).toMatch(/rebind/i);

    expect(ensureAuthUser).not.toHaveBeenCalled();
  });

  it('skips a school_admin email and records a rebind-refusal issue', async () => {
    const admin = fakeAdmin({
      preExistingUsers: {
        'admin@school.edu|school-1': { id: 'admin-user', role: 'school_admin' },
      },
    });

    const { importStudentsToClass } = await import('@/lib/roster/importStudentsToClass');
    const summary = await importStudentsToClass(admin as never, {
      schoolId: SCHOOL_ID,
      classId:  CLASS_ID,
      students: [studentRow({ email: 'admin@school.edu' })],
    });

    expect(summary.issues).toHaveLength(1);
    expect(summary.issues[0]).toMatch(/rebind/i);
    expect(summary.errors).toBe(0);
  });
});

describe('importStudentsToClass — no-email row → skipped silently', () => {
  it('skips rows with no email without incrementing any counter', async () => {
    const admin = fakeAdmin({});

    const { importStudentsToClass } = await import('@/lib/roster/importStudentsToClass');
    const summary = await importStudentsToClass(admin as never, {
      schoolId: SCHOOL_ID,
      classId:  CLASS_ID,
      students: [studentRow({ email: '' })],
    });

    expect(summary.studentsCreated).toBe(0);
    expect(summary.studentsExisting).toBe(0);
    expect(summary.enrolled).toBe(0);
    expect(summary.alreadyEnrolled).toBe(0);
    expect(summary.errors).toBe(0);
    expect(summary.issues).toHaveLength(0);

    expect(ensureAuthUser).not.toHaveBeenCalled();
  });
});

describe('importStudentsToClass — email is lowercased for lookup + creation', () => {
  it('lowercases the email before DB dedup and ensureAuthUser call', async () => {
    ensureAuthUser.mockResolvedValueOnce('new-student-id');
    const admin = fakeAdmin({ preExistingUsers: {} });

    const { importStudentsToClass } = await import('@/lib/roster/importStudentsToClass');
    await importStudentsToClass(admin as never, {
      schoolId: SCHOOL_ID,
      classId:  CLASS_ID,
      students: [studentRow({ email: 'Alice@School.Edu' })],
    });

    expect(ensureAuthUser).toHaveBeenCalledWith(expect.objectContaining({
      email: 'alice@school.edu',
    }));
  });
});

describe('importStudentsToClass — DEFAULT_STUDENT_PW used when password is blank', () => {
  it('passes DEFAULT_STUDENT_PW when password field is empty', async () => {
    ensureAuthUser.mockResolvedValueOnce('s1');
    const admin = fakeAdmin({ preExistingUsers: {} });

    const { importStudentsToClass } = await import('@/lib/roster/importStudentsToClass');
    await importStudentsToClass(admin as never, {
      schoolId: SCHOOL_ID,
      classId:  CLASS_ID,
      students: [studentRow({ password: '' })],
    });

    expect(ensureAuthUser).toHaveBeenCalledWith(expect.objectContaining({
      password: 'Student2026!',
    }));
  });
});

describe('importStudentsToClass — multiple students mixed', () => {
  it('handles a batch with new + existing + already-enrolled correctly', async () => {
    ensureAuthUser.mockResolvedValueOnce('new-id'); // only called for bob (net-new)

    const admin = fakeAdmin({
      preExistingUsers: {
        // alice exists + already enrolled
        'alice@school.edu|school-1': { id: 'alice-id', role: 'student' },
        // carol exists but NOT yet enrolled
        'carol@school.edu|school-1': { id: 'carol-id', role: 'student' },
      },
      enrollmentSeat: {
        'class-1|alice-id': { id: 'seat-alice' },
      },
    });

    const { importStudentsToClass } = await import('@/lib/roster/importStudentsToClass');
    const summary = await importStudentsToClass(admin as never, {
      schoolId: SCHOOL_ID,
      classId:  CLASS_ID,
      students: [
        studentRow({ email: 'alice@school.edu' }), // existing + already enrolled
        studentRow({ email: 'bob@school.edu'   }), // net-new → created + enrolled
        studentRow({ email: 'carol@school.edu' }), // existing + not yet enrolled
      ],
    });

    expect(summary.studentsCreated).toBe(1);   // bob
    expect(summary.studentsExisting).toBe(2);  // alice + carol
    expect(summary.enrolled).toBe(2);          // bob + carol
    expect(summary.alreadyEnrolled).toBe(1);   // alice
    expect(summary.errors).toBe(0);
    expect(summary.issues).toHaveLength(0);
  });
});

// FIX 3 — lean takeover bucket: ensureAuthUser throw with a role/mismatch message
// must be classified as a skip+issue (NOT errors++), mirroring importRoster.ts.
describe('importStudentsToClass — ensureAuthUser role/mismatch throw → skip, not error (FIX 3)', () => {
  it('does NOT increment errors when ensureAuthUser throws a role-mismatch error', async () => {
    ensureAuthUser.mockRejectedValueOnce(
      new Error('Refusing to rebind existing user alice@school.edu (role mismatch)'),
    );
    const admin = fakeAdmin({ preExistingUsers: {} }); // alice not in DB → goes to ensureAuthUser

    const { importStudentsToClass } = await import('@/lib/roster/importStudentsToClass');
    const summary = await importStudentsToClass(admin as never, {
      schoolId: SCHOOL_ID,
      classId:  CLASS_ID,
      students: [studentRow({ email: 'alice@school.edu' })],
    });

    // Must NOT count as a regular error — it's a refused rebind (skip-class)
    expect(summary.errors).toBe(0);
    expect(summary.issues).toHaveLength(1);
    expect(summary.issues[0]).toMatch(/rebind/i);
    expect(summary.issues[0]).toMatch(/alice@school\.edu/i);
  });

  it('still increments errors when ensureAuthUser throws a non-mismatch error', async () => {
    ensureAuthUser.mockRejectedValueOnce(new Error('Network timeout'));
    const admin = fakeAdmin({ preExistingUsers: {} });

    const { importStudentsToClass } = await import('@/lib/roster/importStudentsToClass');
    const summary = await importStudentsToClass(admin as never, {
      schoolId: SCHOOL_ID,
      classId:  CLASS_ID,
      students: [studentRow({ email: 'alice@school.edu' })],
    });

    expect(summary.errors).toBe(1);
    expect(summary.issues).toHaveLength(1);
    // Issue must NOT expose raw DB/internal error text
    expect(summary.issues[0]).not.toMatch(/Network timeout/);
    expect(summary.issues[0]).toMatch(/alice@school\.edu/i);
  });
});

// Task 8 — 23514 seat-cap: count as a skip (not an error) and surface a friendly message.
describe('importStudentsToClass — enrollment insert 23514 (check_violation) → skip, not error', () => {
  it('records a friendly "seat limit reached" issue and does NOT increment errors', async () => {
    ensureAuthUser.mockResolvedValueOnce('new-student-id');
    const admin = fakeAdmin({
      preExistingUsers: {},
      enrollInsertCode: '23514',
      enrollInsertError: 'Enrollment limit reached for school',
    });

    const { importStudentsToClass } = await import('@/lib/roster/importStudentsToClass');
    const summary = await importStudentsToClass(admin as never, {
      schoolId: SCHOOL_ID,
      classId:  CLASS_ID,
      students: [studentRow()],
    });

    // 23514 is a skip, not an error
    expect(summary.errors).toBe(0);
    // A friendly message must appear in issues
    expect(summary.issues).toHaveLength(1);
    expect(summary.issues[0]).toMatch(/seat limit reached/i);
    // The raw DB message must NOT appear
    expect(summary.issues[0]).not.toMatch(/Enrollment limit reached for school/);
    // enrolled counter must NOT have incremented
    expect(summary.enrolled).toBe(0);
  });
});

// FIX 1 — issues must not contain raw DB error text (Postgres constraint/column names).
describe('importStudentsToClass — issues never contain raw DB error messages (FIX 1)', () => {
  it('returns a generic message (not the raw DB error) when the enrollment insert fails', async () => {
    ensureAuthUser.mockResolvedValueOnce('new-student-id');
    const admin = fakeAdmin({
      preExistingUsers:  {},
      enrollInsertError: 'duplicate key value violates unique constraint "enrollments_pkey"',
    });

    const { importStudentsToClass } = await import('@/lib/roster/importStudentsToClass');
    const summary = await importStudentsToClass(admin as never, {
      schoolId: SCHOOL_ID,
      classId:  CLASS_ID,
      students: [studentRow()],
    });

    expect(summary.errors).toBe(1);
    expect(summary.issues).toHaveLength(1);
    // Must NOT contain the raw Postgres constraint message
    expect(summary.issues[0]).not.toMatch(/duplicate key|enrollments_pkey/);
    // Must still identify the student
    expect(summary.issues[0]).toMatch(/alice@school\.edu/i);
    // Must contain a generic hint
    expect(summary.issues[0]).toMatch(/database error/i);
  });
});
