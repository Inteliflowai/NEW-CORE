// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ensureAuthUser = vi.fn();
vi.mock('@/lib/trial/ensureAuthUser', () => ({
  ensureAuthUser: (...a: unknown[]) => ensureAuthUser(...a),
}));

// ---------------------------------------------------------------------------
// Fake admin: models the DB interactions the importRoster engine makes.
//
// The engine's session cache handles newly-created user resolution, so the
// fake only needs to model PRE-EXISTING users (those in the DB before the import).
// Tables touched:
//   users       — select by (email, school_id) to dedup; update { parent_id }
//   classes     — select by filters to find existing; insert new
//   enrollments — select by (class_id, student_id) to skip existing; insert
//
// opts:
//   preExistingUsers  — keyed by "lower(email)|school_id" → { id, role }
//                       (users that already exist BEFORE the import starts)
//   preExistingClasses — array of class rows already in the DB
//   enrollmentSeat    — keyed by "class_id|student_id" → existing seat
//   classInsertId     — id to assign to a newly inserted class (default: 'new-class-1')
// ---------------------------------------------------------------------------

interface FakeUser  { id: string; role: string }
interface FakeClass { id: string; school_id: string; name: string; teacher_id: string | null; period: string | null; subject?: string; grade_level?: string }
interface FakeSeat  { id: string }

function fakeAdmin(opts: {
  preExistingUsers?:   Record<string, FakeUser>;
  preExistingClasses?: FakeClass[];
  enrollmentSeat?:     Record<string, FakeSeat>;
  classInsertId?:      string;
}) {
  const preExistingUsers   = opts.preExistingUsers   ?? {};
  const preExistingClasses = opts.preExistingClasses ?? [];
  const enrollmentSeat     = opts.enrollmentSeat     ?? {};
  const classInsertId      = opts.classInsertId      ?? 'new-class-1';

  // Tracks writes for assertions
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; id: string; data: Record<string, unknown> }> = [];

  // In-memory class store: grows as the engine inserts new classes
  const classStore: FakeClass[] = [...preExistingClasses];

  return {
    inserts,
    updates,

    from(table: string) {
      // ---------------------------------------------------------------
      // users table — only pre-existing users visible (newly created ones
      // live in the engine's session cache, not in the fake DB)
      // ---------------------------------------------------------------
      if (table === 'users') {
        return {
          select(_cols: string) {
            let emailFilter: string | null  = null;
            let schoolFilter: string | null = null;

            const chain: Record<string, unknown> = {};
            chain['eq'] = function(col: string, val: string) {
              if (col === 'email')     emailFilter  = val.toLowerCase();
              if (col === 'school_id') schoolFilter = val;
              return chain;
            };
            chain['then'] = function(resolve2: (v: { data: FakeUser[]; error: null }) => unknown) {
              if (emailFilter && schoolFilter) {
                const key = `${emailFilter}|${schoolFilter}`;
                const found = preExistingUsers[key];
                return resolve2({ data: found ? [found] : [], error: null });
              }
              return resolve2({ data: [], error: null });
            };
            return chain;
          },
          update(data: Record<string, unknown>) {
            let targetId: string | null = null;
            return {
              eq(col: string, val: string) {
                if (col === 'id') targetId = val;
                return {
                  async then(resolve2: (v: { data: null; error: null }) => unknown) {
                    if (targetId) updates.push({ table: 'users', id: targetId, data });
                    return resolve2({ data: null, error: null });
                  },
                };
              },
            };
          },
        };
      }

      // ---------------------------------------------------------------
      // classes table — supports find (maybeSingle) + insert
      // ---------------------------------------------------------------
      if (table === 'classes') {
        return {
          select(_cols: string) {
            const filters: Array<{ col: string; val: unknown }> = [];
            const chain: Record<string, unknown> = {};
            chain['eq'] = function(col: string, val: unknown) {
              filters.push({ col, val });
              return chain;
            };
            chain['maybeSingle'] = async function() {
              const match = classStore.find(r =>
                filters.every(f => (r as unknown as Record<string, unknown>)[f.col] === f.val)
              ) ?? null;
              return { data: match, error: null };
            };
            return chain;
          },
          insert(row: Record<string, unknown>) {
            inserts.push({ table: 'classes', row });
            const newRow: FakeClass = {
              id: classInsertId,
              school_id: row['school_id'] as string,
              name: row['name'] as string,
              teacher_id: (row['teacher_id'] as string) ?? null,
              period: (row['period'] as string) ?? null,
            };
            classStore.push(newRow);
            return Promise.resolve({ data: [newRow], error: null });
          },
        };
      }

      // ---------------------------------------------------------------
      // enrollments table — supports find (maybeSingle) + insert
      // ---------------------------------------------------------------
      if (table === 'enrollments') {
        return {
          select(_cols: string) {
            let classFilter: string | null   = null;
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
            return Promise.resolve({ error: null });
          },
        };
      }

      // Fallback — no other table is touched
      return {
        select() {
          return {
            eq() { return this; },
            maybeSingle: async () => ({ data: null, error: null }),
            then(r: (v: { data: []; error: null }) => unknown) { return r({ data: [], error: null }); },
          };
        },
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
        update(_data: Record<string, unknown>) {
          return { eq() { return Promise.resolve({ error: null }); } };
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------
function minimalRoster() {
  return {
    teachers:    [{ fullName: 'Ms Smith', email: 'smith@school.edu', password: '' }],
    classes:     [{ name: 'Math 8A', subject: 'Math', gradeLevel: '8', period: '1', teacherEmail: 'smith@school.edu' }],
    students:    [{ fullName: 'Alice', email: 'alice@school.edu', password: '', gradeLevel: '8' }],
    enrollments: [{ studentEmail: 'alice@school.edu', className: 'Math 8A', period: '1', teacherEmail: 'smith@school.edu' }],
    parents:     [],
  };
}

beforeEach(() => { ensureAuthUser.mockReset(); });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('importRoster — new teacher + student + class → created counts + enrollment', () => {
  it('creates teacher, class, student and enrolls (source=file)', async () => {
    // Engine session cache: ensureAuthUser mock returns the IDs;
    // the engine caches them so downstream lookups (Classes, Enrollments) succeed.
    ensureAuthUser
      .mockResolvedValueOnce('teacher-1')   // for teacher
      .mockResolvedValueOnce('student-1');  // for student

    // No pre-existing users or classes — everything is net-new
    const admin = fakeAdmin({ preExistingUsers: {}, preExistingClasses: [] });

    const { importRoster } = await import('@/lib/roster/importRoster');
    const summary = await importRoster(admin as never, {
      schoolId: 'school-1',
      roster: minimalRoster(),
    });

    expect(summary.teachers.created).toBe(1);
    expect(summary.teachers.skipped).toBe(0);
    expect(summary.teachers.errors).toBe(0);

    expect(summary.classes.created).toBe(1);
    expect(summary.classes.skipped).toBe(0);
    expect(summary.classes.errors).toBe(0);

    expect(summary.students.created).toBe(1);
    expect(summary.students.skipped).toBe(0);
    expect(summary.students.errors).toBe(0);

    expect(summary.enrollments.created).toBe(1);
    expect(summary.enrollments.skipped).toBe(0);
    expect(summary.enrollments.errors).toBe(0);

    expect(summary.issues).toHaveLength(0);
  });
});

describe('importRoster — enrollment seat stamped source=file', () => {
  it('inserts enrollment with source=file', async () => {
    ensureAuthUser
      .mockResolvedValueOnce('teacher-1')
      .mockResolvedValueOnce('student-1');

    const admin = fakeAdmin({ preExistingUsers: {}, preExistingClasses: [] });

    const { importRoster } = await import('@/lib/roster/importRoster');
    await importRoster(admin as never, {
      schoolId: 'school-1',
      roster: minimalRoster(),
    });

    const enrollInsert = admin.inserts.find(i => i.table === 'enrollments');
    expect(enrollInsert).toBeDefined();
    expect(enrollInsert!.row.source).toBe('file');
  });
});

describe('importRoster — existing email → skipped', () => {
  it('skips a student whose email already exists in the school (DB lookup)', async () => {
    // Teacher is net-new; Alice already exists in the DB
    ensureAuthUser.mockResolvedValueOnce('teacher-1'); // only called for teacher
    const admin = fakeAdmin({
      preExistingUsers: {
        'alice@school.edu|school-1': { id: 'existing-stu', role: 'student' },
      },
      preExistingClasses: [],
    });

    const { importRoster } = await import('@/lib/roster/importRoster');
    const summary = await importRoster(admin as never, {
      schoolId: 'school-1',
      roster: minimalRoster(),
    });

    expect(summary.students.skipped).toBe(1);
    expect(summary.students.created).toBe(0);
    // ensureAuthUser called only once — for the teacher, not the student
    expect(ensureAuthUser).toHaveBeenCalledTimes(1);
    expect(ensureAuthUser).toHaveBeenCalledWith(expect.objectContaining({ role: 'teacher' }));
  });

  it('skips a teacher whose email already exists in the school', async () => {
    // Both teacher and student are net-new (no pre-existing users)
    // but the teacher is pre-existing → only student gets created
    ensureAuthUser.mockResolvedValueOnce('student-1');
    const admin = fakeAdmin({
      preExistingUsers: {
        'smith@school.edu|school-1': { id: 'existing-teacher', role: 'teacher' },
      },
      preExistingClasses: [],
    });

    const { importRoster } = await import('@/lib/roster/importRoster');
    const summary = await importRoster(admin as never, {
      schoolId: 'school-1',
      roster: minimalRoster(),
    });

    expect(summary.teachers.skipped).toBe(1);
    expect(summary.teachers.created).toBe(0);
    // ensureAuthUser called only once — for the student
    expect(ensureAuthUser).toHaveBeenCalledTimes(1);
    expect(ensureAuthUser).toHaveBeenCalledWith(expect.objectContaining({ role: 'student' }));
  });
});

describe('importRoster — missing class → enrollment errors + issue, no crash', () => {
  it('records an error + issue when the enrollment class cannot be resolved, continues processing', async () => {
    ensureAuthUser
      .mockResolvedValueOnce('teacher-2')
      .mockResolvedValueOnce('student-2');

    const admin = fakeAdmin({ preExistingUsers: {}, preExistingClasses: [] });

    // The enrollment references a class NOT in the Classes sheet
    const roster = {
      ...minimalRoster(),
      enrollments: [{ studentEmail: 'alice@school.edu', className: 'Nonexistent Class', period: '1', teacherEmail: 'smith@school.edu' }],
    };

    const { importRoster } = await import('@/lib/roster/importRoster');
    const summary = await importRoster(admin as never, {
      schoolId: 'school-1',
      roster,
    });

    expect(summary.enrollments.errors).toBe(1);
    expect(summary.enrollments.created).toBe(0);
    expect(summary.issues.some(i => /nonexistent class/i.test(i))).toBe(true);

    // Engine didn't crash — teacher and student still created
    expect(summary.teachers.created).toBe(1);
    expect(summary.students.created).toBe(1);
  });
});

describe('importRoster — parent reused + linked to student', () => {
  it('links an existing parent by email (update full_name only) and sets student.parent_id', async () => {
    // Teacher and student created; parent already exists in DB
    ensureAuthUser
      .mockResolvedValueOnce('teacher-1')   // teacher
      .mockResolvedValueOnce('student-1');  // student; no call for parent (reused)

    const admin = fakeAdmin({
      preExistingUsers: {
        'parent@home.edu|school-1': { id: 'existing-parent', role: 'parent' },
      },
      preExistingClasses: [],
    });

    const roster = {
      ...minimalRoster(),
      parents: [{ fullName: 'Bob Parent', email: 'parent@home.edu', password: '', studentEmail: 'alice@school.edu' }],
    };

    const { importRoster } = await import('@/lib/roster/importRoster');
    const summary = await importRoster(admin as never, {
      schoolId: 'school-1',
      roster,
    });

    // Parent already existed → linked (not created)
    expect(summary.parents.linked).toBe(1);
    expect(summary.parents.created).toBe(0);
    expect(summary.parents.errors).toBe(0);

    // ensureAuthUser not called for the existing parent
    expect(ensureAuthUser).not.toHaveBeenCalledWith(expect.objectContaining({ role: 'parent' }));

    // The student's parent_id should have been updated
    const parentIdUpdate = admin.updates.find(u => u.table === 'users' && u.id === 'student-1');
    expect(parentIdUpdate).toBeDefined();
    expect(parentIdUpdate!.data.parent_id).toBe('existing-parent');
  });

  it('creates a new parent and links them to the student', async () => {
    ensureAuthUser
      .mockResolvedValueOnce('teacher-1')    // teacher
      .mockResolvedValueOnce('student-1')    // student
      .mockResolvedValueOnce('new-parent-id'); // parent (new)

    const admin = fakeAdmin({ preExistingUsers: {}, preExistingClasses: [] });

    const roster = {
      ...minimalRoster(),
      parents: [{ fullName: 'New Parent', email: 'newparent@home.edu', password: '', studentEmail: 'alice@school.edu' }],
    };

    const { importRoster } = await import('@/lib/roster/importRoster');
    const summary = await importRoster(admin as never, {
      schoolId: 'school-1',
      roster,
    });

    expect(summary.parents.created).toBe(1);
    expect(summary.parents.linked).toBe(0);

    // ensureAuthUser called with role=parent
    expect(ensureAuthUser).toHaveBeenCalledWith(expect.objectContaining({ role: 'parent', email: 'newparent@home.edu' }));

    // Parent_id linked on student
    const parentIdUpdate = admin.updates.find(u => u.table === 'users' && u.id === 'student-1');
    expect(parentIdUpdate).toBeDefined();
    expect(parentIdUpdate!.data.parent_id).toBe('new-parent-id');
  });
});

describe('importRoster — takeover mismatch from ensureAuthUser → skipped + issue, loop continues', () => {
  it('counts mismatch throws as skipped + records issue, processes other rows without crashing', async () => {
    // Teacher throws mismatch; student still gets created
    ensureAuthUser
      .mockRejectedValueOnce(new Error('Refusing to rebind existing user smith@school.edu (role/school mismatch)'))
      .mockResolvedValueOnce('student-1');

    const admin = fakeAdmin({ preExistingUsers: {}, preExistingClasses: [] });

    const { importRoster } = await import('@/lib/roster/importRoster');
    const summary = await importRoster(admin as never, {
      schoolId: 'school-1',
      roster: minimalRoster(),
    });

    // Teacher skipped (mismatch) — NOT counted as error
    expect(summary.teachers.skipped).toBe(1);
    expect(summary.teachers.created).toBe(0);
    expect(summary.teachers.errors).toBe(0);
    expect(summary.issues.some(i => /smith@school\.edu/i.test(i))).toBe(true);

    // Student still created (loop continued)
    expect(summary.students.created).toBe(1);
  });
});

describe('importRoster — default passwords', () => {
  it('uses DEFAULT_STAFF_PW for teacher when password is blank', async () => {
    ensureAuthUser.mockResolvedValue('t1');
    const admin = fakeAdmin({ preExistingUsers: {}, preExistingClasses: [] });

    const { importRoster } = await import('@/lib/roster/importRoster');
    const roster = { ...minimalRoster(), students: [], enrollments: [], parents: [] };
    await importRoster(admin as never, { schoolId: 'school-1', roster });

    expect(ensureAuthUser).toHaveBeenCalledWith(expect.objectContaining({
      role: 'teacher',
      password: 'Core2026!',
    }));
  });

  it('uses DEFAULT_STUDENT_PW for student when password is blank', async () => {
    ensureAuthUser
      .mockResolvedValueOnce('t1')
      .mockResolvedValueOnce('s1');

    const admin = fakeAdmin({ preExistingUsers: {}, preExistingClasses: [] });

    const { importRoster } = await import('@/lib/roster/importRoster');
    const roster = { ...minimalRoster(), enrollments: [], parents: [] };
    await importRoster(admin as never, { schoolId: 'school-1', roster });

    expect(ensureAuthUser).toHaveBeenCalledWith(expect.objectContaining({
      role: 'student',
      password: 'Student2026!',
    }));
  });

  it('uses DEFAULT_STAFF_PW for parent when password is blank', async () => {
    ensureAuthUser
      .mockResolvedValueOnce('t1')
      .mockResolvedValueOnce('s1')
      .mockResolvedValueOnce('p1');

    const admin = fakeAdmin({ preExistingUsers: {}, preExistingClasses: [] });

    const { importRoster } = await import('@/lib/roster/importRoster');
    const roster = {
      ...minimalRoster(),
      enrollments: [],
      parents: [{ fullName: 'P', email: 'p@home.edu', password: '', studentEmail: 'alice@school.edu' }],
    };
    await importRoster(admin as never, { schoolId: 'school-1', roster });

    expect(ensureAuthUser).toHaveBeenCalledWith(expect.objectContaining({
      role: 'parent',
      password: 'Core2026!',
    }));
  });
});

describe('importRoster — existing enrollment seat → skipped', () => {
  it('skips enrollment when a seat already exists (class_id + student_id)', async () => {
    ensureAuthUser
      .mockResolvedValueOnce('teacher-1')
      .mockResolvedValueOnce('student-1');

    const admin = fakeAdmin({
      preExistingUsers: {},
      // The class already exists in the DB
      preExistingClasses: [{ id: 'class-1', school_id: 'school-1', name: 'Math 8A', teacher_id: 'teacher-1', period: '1' }],
      // A seat already exists for class-1 / student-1
      enrollmentSeat: { 'class-1|student-1': { id: 'seat-1' } },
    });

    const { importRoster } = await import('@/lib/roster/importRoster');
    const summary = await importRoster(admin as never, {
      schoolId: 'school-1',
      roster: minimalRoster(),
    });

    expect(summary.enrollments.skipped).toBe(1);
    expect(summary.enrollments.created).toBe(0);
    // No enrollment insert
    expect(admin.inserts.filter(i => i.table === 'enrollments')).toHaveLength(0);
  });
});

describe('importRoster — exported constants', () => {
  it('exports DEFAULT_STAFF_PW and DEFAULT_STUDENT_PW with the correct values', async () => {
    const mod = await import('@/lib/roster/importRoster');
    expect(mod.DEFAULT_STAFF_PW).toBe('Core2026!');
    expect(mod.DEFAULT_STUDENT_PW).toBe('Student2026!');
  });
});
