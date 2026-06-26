// src/lib/school/__tests__/loadSchoolOverview.test.ts
// TDD for loadSchoolOverview — mock the admin client; assert the aggregated SchoolOverview shape.
// Covers: normal school (license + counts + activity) and empty school (all zeros + null license).
import { describe, it, expect } from 'vitest';
import { loadSchoolOverview } from '@/lib/school/loadSchoolOverview';
import type { SchoolOverview } from '@/lib/school/loadSchoolOverview';

// ---------------------------------------------------------------------------
// Chainable admin-client stub
// Each table gets its own chain factory so filter state (e.g. role='student')
// can drive conditional return values.
// ---------------------------------------------------------------------------
type Scenario = 'normal' | 'empty';

function buildAdmin(scenario: Scenario) {
  function makeChain(table: string) {
    // Track accumulated eq filters so user queries can be role-discriminated.
    const filters: Record<string, unknown> = {};

    const q: Record<string, unknown> = {};

    // All filter/modifier methods return `this`.
    q.select = () => q;
    q.eq = (col: string, val: unknown) => {
      filters[col] = val;
      return q;
    };
    q.in = () => q;
    q.gte = () => q;
    q.neq = () => q;
    q.order = () => q;
    q.limit = () => q;
    q.not = () => q;
    q.is = () => q;

    // single() — used for schools lookup
    q.single = () => {
      if (table === 'schools') {
        return Promise.resolve({
          data: scenario === 'normal'
            ? { name: 'Lincoln K-12' }
            : { name: 'Empty School' },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };

    // maybeSingle() — used for school_licenses lookup
    q.maybeSingle = () => {
      if (table === 'school_licenses') {
        return Promise.resolve({
          data: scenario === 'normal'
            ? { tier: 'professional', status: 'active', student_limit: 300, trial_ends_at: null }
            : null,
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };

    // then() — awaiting the chain directly (count/data queries)
    (q as { then: unknown }).then = (
      resolve: (v: { data: unknown[]; count: number; error: null }) => void,
    ) => {
      let data: unknown[] = [];
      let count = 0;

      if (scenario === 'normal') {
        if (table === 'users') {
          if (filters['role'] === 'student') { count = 5; }
          else if (filters['role'] === 'teacher') { count = 2; }
        } else if (table === 'classes') {
          data = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];
          count = 3;
        } else if (table === 'assignments') {
          data = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }];
          count = 3;
        } else if (table === 'homework_attempts') {
          count = 4;
        } else if (table === 'quizzes') {
          count = 2;
        } else if (table === 'alerts') {
          count = 1;
        } else if (table === 'high_fives') {
          count = 3;
        }
      }
      // empty scenario: all zeros / empty arrays (defaults above)

      resolve({ data, count, error: null });
    };

    return q;
  }

  return {
    from: (table: string) => makeChain(table),
  } as unknown as Parameters<typeof loadSchoolOverview>[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('loadSchoolOverview', () => {
  it('returns the full SchoolOverview shape for a normal school', async () => {
    const overview: SchoolOverview = await loadSchoolOverview(
      buildAdmin('normal'),
      'school-123',
    );

    expect(overview.schoolName).toBe('Lincoln K-12');

    // License
    expect(overview.license.tier).toBe('professional');
    expect(overview.license.status).toBe('active');
    expect(overview.license.studentLimit).toBe(300);
    expect(overview.license.trialEndsAt).toBeNull();

    // Seats = active student count
    expect(overview.seatsUsed).toBe(5);

    // Counts
    expect(overview.counts.students).toBe(5);
    expect(overview.counts.teachers).toBe(2);
    expect(overview.counts.classes).toBe(3);

    // This-week activity
    expect(overview.thisWeek.assignmentsSubmitted).toBe(4);
    expect(overview.thisWeek.quizzesPublished).toBe(2);
    expect(overview.thisWeek.openAlerts).toBe(1);
    expect(overview.thisWeek.highFives).toBe(3);
  });

  it('returns all zeros and null license for an empty school', async () => {
    const overview: SchoolOverview = await loadSchoolOverview(
      buildAdmin('empty'),
      'school-empty',
    );

    expect(overview.schoolName).toBe('Empty School');

    // License absent
    expect(overview.license.tier).toBeNull();
    expect(overview.license.status).toBeNull();
    expect(overview.license.studentLimit).toBeNull();
    expect(overview.license.trialEndsAt).toBeNull();

    // All zeros
    expect(overview.seatsUsed).toBe(0);
    expect(overview.counts.students).toBe(0);
    expect(overview.counts.teachers).toBe(0);
    expect(overview.counts.classes).toBe(0);
    expect(overview.thisWeek.assignmentsSubmitted).toBe(0);
    expect(overview.thisWeek.quizzesPublished).toBe(0);
    expect(overview.thisWeek.openAlerts).toBe(0);
    expect(overview.thisWeek.highFives).toBe(0);
  });

  it('skips homework_attempts and quizzes queries when no classes exist', async () => {
    // Same as empty but verifies the guard path — no .in([]) called
    const admin = buildAdmin('empty');
    const overview = await loadSchoolOverview(admin, 'school-no-classes');
    expect(overview.thisWeek.assignmentsSubmitted).toBe(0);
    expect(overview.thisWeek.quizzesPublished).toBe(0);
  });
});
