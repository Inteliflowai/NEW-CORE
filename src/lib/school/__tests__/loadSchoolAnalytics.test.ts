// src/lib/school/__tests__/loadSchoolAnalytics.test.ts
// TDD for loadSchoolAnalytics — mock the admin client; assert the aggregated
// SchoolAnalytics shape. Covers: normal school (weeks + classes + adoption),
// empty school (all zeros/empty), and classes-with-no-assignments guard path.
import { describe, it, expect } from 'vitest';
import { isoWeekMonday } from '@/lib/dates/isoWeekMonday';
import { loadSchoolAnalytics } from '@/lib/school/loadSchoolAnalytics';
import type { SchoolAnalytics } from '@/lib/school/loadSchoolAnalytics';

// ---------------------------------------------------------------------------
// Stable dates — computed once so every assertion is deterministic regardless
// of when this test file runs.
// ---------------------------------------------------------------------------
const NOW_ISO = new Date().toISOString();
const THIS_WEEK_MONDAY = isoWeekMonday(new Date());

// ---------------------------------------------------------------------------
// Chainable admin-client stub
// ---------------------------------------------------------------------------
type Scenario = 'normal' | 'empty' | 'no_assignments';

function buildAdmin(scenario: Scenario) {
  function makeChain(table: string) {
    // Track accumulated eq filters so role-discriminated user queries work.
    const filters: Record<string, unknown> = {};

    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (col: string, val: unknown) => { filters[col] = val; return q; };
    q.in = () => q;
    q.gte = () => q;
    q.lt = () => q;
    q.not = () => q;
    q.order = () => q;
    q.limit = () => q;

    (q as { then: unknown }).then = (
      resolve: (v: { data: unknown; count: number; error: null }) => void,
    ) => {
      let data: unknown = [];
      let count = 0;

      if (scenario === 'normal') {
        if (table === 'classes') {
          data = [
            { id: 'c1', name: 'English 7A' },
            { id: 'c2', name: 'Math 9B' },
          ];
        } else if (table === 'assignments') {
          data = [
            { id: 'a1', class_id: 'c1' },
            { id: 'a2', class_id: 'c1' },
            { id: 'a3', class_id: 'c2' },
          ];
        } else if (table === 'homework_attempts') {
          // ha1: c1 — submitted + graded today
          // ha2: c1 — submitted today, not yet graded
          // ha3: c2 — submitted + graded today
          // ha4: c2 — in_progress (no submitted_at)
          data = [
            { assignment_id: 'a1', status: 'graded',      submitted_at: NOW_ISO, graded_at: NOW_ISO },
            { assignment_id: 'a2', status: 'submitted',   submitted_at: NOW_ISO, graded_at: null    },
            { assignment_id: 'a3', status: 'graded',      submitted_at: NOW_ISO, graded_at: NOW_ISO },
            { assignment_id: 'a3', status: 'in_progress', submitted_at: null,    graded_at: null    },
          ];
        } else if (table === 'quizzes') {
          data = [
            { published_at: NOW_ISO },
            { published_at: NOW_ISO },
          ];
        } else if (table === 'users') {
          if (filters['role'] === 'teacher') count = 2;
          else if (filters['role'] === 'student') count = 5;
        }

      } else if (scenario === 'no_assignments') {
        if (table === 'classes') {
          data = [{ id: 'c1', name: 'Quiet Class' }];
        }
        // assignments, homework_attempts, quizzes all return [] (default)
        if (table === 'users') {
          if (filters['role'] === 'teacher') count = 1;
          else if (filters['role'] === 'student') count = 3;
        }
      }
      // empty scenario: all tables return [] / count 0 (defaults above)

      resolve({ data, count, error: null });
    };

    return q;
  }

  return {
    from: (table: string) => makeChain(table),
  } as unknown as Parameters<typeof loadSchoolAnalytics>[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('loadSchoolAnalytics', () => {
  it('returns the full SchoolAnalytics shape for a normal school', async () => {
    const analytics: SchoolAnalytics = await loadSchoolAnalytics(
      buildAdmin('normal'),
      'school-123',
    );

    // ── weeks: always 8 entries ───────────────────────────────────────────
    expect(analytics.weeks).toHaveLength(8);

    // The most recent week (index 7) should contain all 3 submitted attempts
    // and both quizzes, because the mock returns NOW_ISO for all dates.
    const thisWeek = analytics.weeks.find(w => w.weekStart === THIS_WEEK_MONDAY);
    expect(thisWeek).toBeDefined();
    expect(thisWeek!.assignmentsSubmitted).toBe(3); // ha1, ha2, ha3
    expect(thisWeek!.quizzesPublished).toBe(2);

    // Earlier weeks should all be zero (no mock data for them)
    for (const w of analytics.weeks) {
      if (w.weekStart !== THIS_WEEK_MONDAY) {
        expect(w.assignmentsSubmitted).toBe(0);
        expect(w.quizzesPublished).toBe(0);
      }
    }

    // ── classes ───────────────────────────────────────────────────────────
    expect(analytics.classes).toHaveLength(2);

    const c1 = analytics.classes.find(c => c.name === 'English 7A');
    expect(c1).toBeDefined();
    // c1: 2 attempts total (ha1+ha2), 2 submitted, 1 graded → 50%
    expect(c1!.activity).toBe(2);
    expect(c1!.completionPct).toBe(50);

    const c2 = analytics.classes.find(c => c.name === 'Math 9B');
    expect(c2).toBeDefined();
    // c2: 2 attempts total (ha3+ha4), 1 submitted, 1 graded → 100%
    expect(c2!.activity).toBe(2);
    expect(c2!.completionPct).toBe(100);

    // ── adoption ─────────────────────────────────────────────────────────
    expect(analytics.adoption.teachersActive).toBe(2);
    expect(analytics.adoption.studentsActive).toBe(5);
  });

  it('returns all zeros and empty arrays for an empty school (no active classes)', async () => {
    const analytics: SchoolAnalytics = await loadSchoolAnalytics(
      buildAdmin('empty'),
      'school-empty',
    );

    // weeks: 8 zero rows — the shape is preserved so the UI can show the
    // last 8 labels even for an empty school.
    expect(analytics.weeks).toHaveLength(8);
    for (const w of analytics.weeks) {
      expect(w.assignmentsSubmitted).toBe(0);
      expect(w.quizzesPublished).toBe(0);
    }

    // classes & adoption: all empty/zero
    expect(analytics.classes).toHaveLength(0);
    expect(analytics.adoption.teachersActive).toBe(0);
    expect(analytics.adoption.studentsActive).toBe(0);
  });

  it('handles classes with no assignments gracefully (zero activity, no crash)', async () => {
    const analytics: SchoolAnalytics = await loadSchoolAnalytics(
      buildAdmin('no_assignments'),
      'school-quiet',
    );

    expect(analytics.weeks).toHaveLength(8);
    expect(analytics.classes).toHaveLength(1);
    expect(analytics.classes[0].name).toBe('Quiet Class');
    expect(analytics.classes[0].activity).toBe(0);
    expect(analytics.classes[0].completionPct).toBe(0);

    // Adoption is still queried even when no assignment activity exists.
    expect(analytics.adoption.teachersActive).toBe(1);
    expect(analytics.adoption.studentsActive).toBe(3);
  });
});
