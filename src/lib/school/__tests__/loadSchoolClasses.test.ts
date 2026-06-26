// src/lib/school/__tests__/loadSchoolClasses.test.ts
// TDD for loadSchoolClasses — mock the admin client; assert the SchoolClass shape.
// Covers: normal school (classes + teacher names + enrollment counts + googleSynced),
// empty school → [], and a class with no teacher assigned.
import { describe, it, expect } from 'vitest';
import { loadSchoolClasses } from '@/lib/school/loadSchoolClasses';
import type { SchoolClass } from '@/lib/school/loadSchoolClasses';

// ---------------------------------------------------------------------------
// Chainable admin-client stub
// ---------------------------------------------------------------------------
type Scenario = 'normal' | 'empty' | 'no_teacher';

function buildAdmin(scenario: Scenario) {
  function makeChain(table: string) {
    const q: Record<string, unknown> = {};

    q.select = () => q;
    q.eq = () => q;
    q.in = () => q;
    q.order = () => q;

    (q as { then: unknown }).then = (
      resolve: (v: { data: unknown; error: null }) => void,
    ) => {
      let data: unknown = [];

      if (scenario === 'normal') {
        if (table === 'classes') {
          data = [
            {
              id: 'c1',
              name: 'English 7A',
              subject: 'English Literature',
              grade_level: '7',
              teacher_id: 't1',
              google_course_id: 'gc-abc123',
            },
            {
              id: 'c2',
              name: 'Math 9B',
              subject: 'Mathematics',
              grade_level: '9',
              teacher_id: 't2',
              google_course_id: null,
            },
            {
              id: 'c3',
              name: 'Art 8',
              subject: 'Art',
              grade_level: '8',
              teacher_id: 't1',
              google_course_id: '',
            },
          ];
        } else if (table === 'users') {
          data = [
            { id: 't1', full_name: 'Alice Smith' },
            { id: 't2', full_name: 'Bob Jones' },
          ];
        } else if (table === 'enrollments') {
          // c1: 3 active | c2: 1 active | c3: 2 active
          data = [
            { class_id: 'c1' },
            { class_id: 'c1' },
            { class_id: 'c1' },
            { class_id: 'c2' },
            { class_id: 'c3' },
            { class_id: 'c3' },
          ];
        }
      } else if (scenario === 'no_teacher') {
        if (table === 'classes') {
          data = [
            {
              id: 'c1',
              name: 'Unassigned Class',
              subject: null,
              grade_level: null,
              teacher_id: null,
              google_course_id: null,
            },
          ];
        } else if (table === 'enrollments') {
          data = [{ class_id: 'c1' }];
        }
        // users query not called (no teacher IDs)
      }
      // empty scenario: all tables return [] (default)

      resolve({ data, error: null });
    };

    return q;
  }

  return {
    from: (table: string) => makeChain(table),
  } as unknown as Parameters<typeof loadSchoolClasses>[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('loadSchoolClasses', () => {
  it('returns the correct shape for a school with classes, teachers, and enrollments', async () => {
    const classes: SchoolClass[] = await loadSchoolClasses(
      buildAdmin('normal'),
      'school-123',
    );

    expect(classes).toHaveLength(3);

    // ── English 7A: has a google course id → googleSynced=true ────────────
    const c1 = classes.find(c => c.id === 'c1');
    expect(c1).toBeDefined();
    expect(c1!.name).toBe('English 7A');
    expect(c1!.subject).toBe('English Literature');
    expect(c1!.grade).toBe('7');
    expect(c1!.teacherName).toBe('Alice Smith');
    expect(c1!.enrollment).toBe(3);
    expect(c1!.googleSynced).toBe(true);

    // ── Math 9B: no google_course_id → googleSynced=false ─────────────────
    const c2 = classes.find(c => c.id === 'c2');
    expect(c2).toBeDefined();
    expect(c2!.teacherName).toBe('Bob Jones');
    expect(c2!.enrollment).toBe(1);
    expect(c2!.googleSynced).toBe(false);

    // ── Art 8: empty string google_course_id → googleSynced=false ──────────
    const c3 = classes.find(c => c.id === 'c3');
    expect(c3).toBeDefined();
    expect(c3!.teacherName).toBe('Alice Smith');
    expect(c3!.enrollment).toBe(2);
    expect(c3!.googleSynced).toBe(false);
  });

  it('returns [] for an empty school with no active classes', async () => {
    const classes = await loadSchoolClasses(buildAdmin('empty'), 'school-empty');
    expect(classes).toEqual([]);
  });

  it('handles a class with no teacher assigned (teacherName=null)', async () => {
    const classes = await loadSchoolClasses(buildAdmin('no_teacher'), 'school-456');
    expect(classes).toHaveLength(1);
    const cls = classes[0];
    expect(cls.teacherName).toBeNull();
    expect(cls.subject).toBeNull();
    expect(cls.grade).toBeNull();
    expect(cls.googleSynced).toBe(false);
    expect(cls.enrollment).toBe(1);
  });
});
