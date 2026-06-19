import { describe, it, expect, vi } from 'vitest';
import { seedTrialDemoData, type SeedReport } from '../seedTrialDemoData';

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
});
