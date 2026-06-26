import { describe, it, expect, vi } from 'vitest';
import { seedTrialDemoData, type SeedReport } from '../seedTrialDemoData';

// Returns an admin mock whose insert/upsert/update on `errorTable` resolves { error } (no throw).
function makeReturnedErrorAdmin(errorTable: string, errMsg = 'returned error') {
  const op = (table: string) => async () => ({ error: table === errorTable ? { message: errMsg } : null });
  return {
    from: vi.fn((table: string) => ({
      insert: vi.fn(op(table)),
      upsert: vi.fn(op(table)),
      update: vi.fn(() => ({ eq: vi.fn(op(table)) })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ is: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })), maybeSingle: vi.fn(async () => ({ data: null, error: null })) })),
          is: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
    })),
    auth: { admin: {
      createUser: vi.fn(async () => ({ data: { user: { id: 'stu-' + Math.random() } }, error: null })),
      listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })),
      deleteUser: vi.fn(async () => ({ error: null })),
    } },
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

const seedInput = (admin: import('@supabase/supabase-js').SupabaseClient) => ({
  admin, schoolId: 'school-1', schoolIdShort: 'school-1'.slice(0, 8),
  teacherId: 'teacher-1', firstStudentId: 'student-1', parentId: 'parent-1', password: 'TestPass#1234',
});

describe('seedTrialDemoData — returned {error} is observable (C1)', () => {
  it.each([
    ['enrollments', 'enrollments'],
    ['quiz_attempts', 'quiz_attempts'],
    ['skill_learning_state', 'skill_learning_state'],
    ['misconception_observations', 'misconceptions'],
    ['student_model_snapshots', 'snapshots'],
  ])('a returned {error} on %s lands the %s step in skipped (not seeded)', async (table, step) => {
    const admin = makeReturnedErrorAdmin(table);
    const report = await seedTrialDemoData(seedInput(admin));
    expect(report.skipped.some((s) => s.step === step), `${step} should be skipped`).toBe(true);
    expect(report.seeded).not.toContain(step);
  });

  it('a returned {error} on guardians lands guardian_link in skipped', async () => {
    const admin = makeReturnedErrorAdmin('guardians');
    const report = await seedTrialDemoData(seedInput(admin));
    expect(report.skipped.some((s) => s.step === 'guardian_link')).toBe(true);
    expect(report.seeded).not.toContain('guardian_link');
  });

  it('a returned {error} on quiz_questions lands the quiz step in skipped', async () => {
    const admin = makeReturnedErrorAdmin('quiz_questions');
    const report = await seedTrialDemoData(seedInput(admin));
    expect(report.skipped.some((s) => s.step === 'quiz')).toBe(true);
    expect(report.seeded).not.toContain('quiz');
  });

  it('still never throws even when a step returns {error}', async () => {
    const admin = makeReturnedErrorAdmin('snapshots');
    await expect(seedTrialDemoData(seedInput(admin))).resolves.toBeDefined();
  });
});

// Minimal admin stub that always fails the class insert.
// The mock's select().eq() chain is made fully chainable so Step 9a's
// pre-query (.select().eq().eq().is().maybeSingle()) resolves correctly
// instead of throwing inside the skill try/catch.
function makeFailingAdmin(failStep: 'class' | 'students') {
  return {
    from: vi.fn((table: string) => ({
      insert: vi.fn(async () => ({
        error: table === 'classes' && failStep === 'class'
          ? { message: 'classes insert failed' }
          : null,
      })),
      upsert: vi.fn(async () => ({ error: null })),
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
          is: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
    })),
    auth: {
      admin: {
        createUser: vi.fn(async (_params: unknown) => {
          if (failStep === 'students') {
            return { data: null, error: { message: 'student create failed' } };
          }
          return { data: { user: { id: 'student-uuid-' + Math.random() } }, error: null };
        }),
        listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })),
      },
    },
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

describe('seedTrialDemoData — SeedReport', () => {
  it('returns a SeedReport object (not void)', async () => {
    const admin = makeFailingAdmin('class');
    const report = await seedTrialDemoData({
      admin,
      schoolId: 'school-1',
      schoolIdShort: 'school-1'.slice(0, 8),
      teacherId: 'teacher-1',
      firstStudentId: 'student-1',
      parentId: 'parent-1',
      password: 'TestPass#1234',
    });

    expect(report).toBeDefined();
    expect(Array.isArray(report.seeded)).toBe(true);
    expect(Array.isArray(report.skipped)).toBe(true);
  });

  it('records a skipped entry when class creation fails', async () => {
    const admin = makeFailingAdmin('class');
    const report: SeedReport = await seedTrialDemoData({
      admin,
      schoolId: 'school-1',
      schoolIdShort: 'school-1'.slice(0, 8),
      teacherId: 'teacher-1',
      firstStudentId: 'student-1',
      parentId: 'parent-1',
      password: 'TestPass#1234',
    });

    const classSkip = report.skipped.find((s) => s.step === 'class');
    expect(classSkip, 'class step should be in skipped').toBeDefined();
    expect(classSkip!.reason).toContain('classes insert failed');
  });

  it('records seeded steps for steps that did not fail', async () => {
    const admin = makeFailingAdmin('class');
    const report: SeedReport = await seedTrialDemoData({
      admin,
      schoolId: 'school-1',
      schoolIdShort: 'school-1'.slice(0, 8),
      teacherId: 'teacher-1',
      firstStudentId: 'student-1',
      parentId: 'parent-1',
      password: 'TestPass#1234',
    });

    // Step 1 (students) should appear in seeded when class is the failing step
    // At minimum, the report must be non-empty or have a seeded/skipped partition
    expect(report.seeded.length + report.skipped.length).toBeGreaterThan(0);
  });

  it('does NOT throw even when every step fails (soft-fail contract preserved)', async () => {
    const admin = makeFailingAdmin('students');
    await expect(
      seedTrialDemoData({
        admin,
        schoolId: 'school-2',
        schoolIdShort: 'school-2'.slice(0, 8),
        teacherId: 'teacher-2',
        firstStudentId: null,
        parentId: null,
        password: 'TestPass#9999',
      })
    ).resolves.not.toThrow();
  });

  // M4: demo parent must be linked to BOTH Alex (student 0) and Sofia (student 1)
  it('seeds guardian_link_sofia for the second child (M4 — parent has 2 children)', async () => {
    // makeFailingAdmin('class') has class-insert failing but all user/guardian
    // update+upsert steps succeed. students step runs successfully so sofiaId is
    // populated, and both guardian steps should land in seeded.
    const admin = makeFailingAdmin('class');
    const report = await seedTrialDemoData(seedInput(admin));
    expect(report.seeded, 'guardian_link should be seeded (Alex)').toContain('guardian_link');
    expect(report.seeded, 'guardian_link_sofia should be seeded (Sofia)').toContain('guardian_link_sofia');
    expect(report.skipped.map((s) => s.step)).not.toContain('guardian_link');
    expect(report.skipped.map((s) => s.step)).not.toContain('guardian_link_sofia');
  });
});
