// src/lib/school/__tests__/loadSchoolReport.test.ts
// TDD for loadSchoolReport — mock the admin client; assert the SchoolReport shape.
// Covers: normal school (two classes, teachers, counts), empty school (all zeros),
// school with users but no active classes, and a class with no teacher_id.
import { describe, it, expect } from 'vitest';
import { loadSchoolReport } from '@/lib/school/loadSchoolReport';
import type { SchoolReport } from '@/lib/school/loadSchoolReport';

// ── Chainable admin-client stub ───────────────────────────────────────────────
// Each `from(table)` call returns a fresh chain.  Filter accumulation lets the
// `then` handler distinguish count queries (role filter) from name queries (in
// filter on 'id').

type Scenario = 'normal' | 'empty' | 'no_classes';

function buildAdmin(scenario: Scenario) {
  function makeChain(table: string) {
    const filters: Record<string, unknown> = {};
    let inCalledOnId = false;

    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (col: string, val: unknown) => {
      filters[col] = val;
      return q;
    };
    q.in = (col: string) => {
      if (col === 'id') inCalledOnId = true;
      return q;
    };
    q.not = () => q;
    q.is = () => q;
    q.order = () => q;
    q.limit = () => q;
    q.neq = () => q;
    q.gte = () => q;
    q.lt = () => q;

    // .single() — used for the schools table
    q.single = () => {
      if (table === 'schools') {
        const name =
          scenario === 'normal' ? 'Lincoln High' : scenario === 'no_classes' ? 'Sparse School' : 'Empty School';
        return Promise.resolve({ data: { name }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };

    q.maybeSingle = () => Promise.resolve({ data: null, error: null });

    // Awaiting the chain directly (count + data queries)
    (q as { then: unknown }).then = (
      resolve: (v: { data: unknown[]; count: number; error: null }) => void,
    ) => {
      let data: unknown[] = [];
      let count = 0;

      if (scenario === 'normal') {
        if (table === 'users') {
          if (inCalledOnId) {
            // teacher-names query
            data = [
              { id: 't1', full_name: 'Alice Teacher' },
              { id: 't2', full_name: 'Bob Teacher' },
            ];
          } else if (filters['role'] === 'student') {
            count = 10;
          } else if (filters['role'] === 'teacher') {
            count = 3;
          }
        } else if (table === 'classes') {
          data = [
            { id: 'c1', name: 'English 7B', teacher_id: 't1' },
            { id: 'c2', name: 'Math 9A', teacher_id: 't2' },
          ];
        } else if (table === 'enrollments') {
          // 3 active in c1, 2 in c2
          data = [
            { class_id: 'c1' },
            { class_id: 'c1' },
            { class_id: 'c1' },
            { class_id: 'c2' },
            { class_id: 'c2' },
          ];
        } else if (table === 'assignments') {
          // Fan-out: a teacher sends one lesson to multiple students → multiple rows.
          // c1: lesson l1 sent to 2 students (a1+a2), lesson l2 sent to 1 student (a3) → 2 distinct lessons
          // c2: lesson l3 sent to 2 students (a4+a5) → 1 distinct lesson
          data = [
            { id: 'a1', class_id: 'c1', lesson_id: 'l1' },
            { id: 'a2', class_id: 'c1', lesson_id: 'l1' },
            { id: 'a3', class_id: 'c1', lesson_id: 'l2' },
            { id: 'a4', class_id: 'c2', lesson_id: 'l3' },
            { id: 'a5', class_id: 'c2', lesson_id: 'l3' },
          ];
        } else if (table === 'homework_attempts') {
          // 2 submitted for c1 (a1, a2), 1 for c2 (a4)
          data = [
            { assignment_id: 'a1' },
            { assignment_id: 'a2' },
            { assignment_id: 'a4' },
          ];
        } else if (table === 'quizzes') {
          // 2 published for c1, 1 for c2
          data = [
            { class_id: 'c1' },
            { class_id: 'c1' },
            { class_id: 'c2' },
          ];
        }
      } else if (scenario === 'no_classes') {
        if (table === 'users') {
          if (filters['role'] === 'student') count = 5;
          else if (filters['role'] === 'teacher') count = 1;
        }
        // classes returns [] → early return path
      }
      // 'empty' scenario: all tables return defaults ([] / 0)

      resolve({ data, count, error: null });
    };

    return q;
  }

  return {
    from: (table: string) => makeChain(table),
  } as unknown as Parameters<typeof loadSchoolReport>[0];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('loadSchoolReport', () => {
  it('returns the full SchoolReport shape for a normal school', async () => {
    const report: SchoolReport = await loadSchoolReport(
      buildAdmin('normal'),
      'school-1',
    );

    expect(report.schoolName).toBe('Lincoln High');
    expect(report.totalStudents).toBe(10);
    expect(report.totalTeachers).toBe(3);
    expect(report.totalClasses).toBe(2);

    // Totals are the sum of per-class values
    expect(report.totalAssignmentsSubmitted).toBe(3); // 2 (c1) + 1 (c2)
    expect(report.totalQuizzesPublished).toBe(3);     // 2 (c1) + 1 (c2)

    expect(report.classes).toHaveLength(2);
  });

  it('populates correct per-class metrics', async () => {
    const report = await loadSchoolReport(buildAdmin('normal'), 'school-1');

    const c1 = report.classes.find(c => c.classId === 'c1');
    expect(c1).toBeDefined();
    expect(c1!.className).toBe('English 7B');
    expect(c1!.teacherName).toBe('Alice Teacher');
    expect(c1!.enrolledStudents).toBe(3);
    // 3 fan-out rows but only 2 distinct lesson_ids (l1 × 2 students, l2 × 1 student)
    expect(c1!.assignmentsCreated).toBe(2);
    expect(c1!.assignmentsSubmitted).toBe(2);
    expect(c1!.quizzesPublished).toBe(2);

    const c2 = report.classes.find(c => c.classId === 'c2');
    expect(c2).toBeDefined();
    expect(c2!.className).toBe('Math 9A');
    expect(c2!.teacherName).toBe('Bob Teacher');
    expect(c2!.enrolledStudents).toBe(2);
    // 2 fan-out rows but only 1 distinct lesson_id (l3 × 2 students)
    expect(c2!.assignmentsCreated).toBe(1);
    expect(c2!.assignmentsSubmitted).toBe(1);
    expect(c2!.quizzesPublished).toBe(1);
  });

  it('returns all zeros for an empty school', async () => {
    const report: SchoolReport = await loadSchoolReport(
      buildAdmin('empty'),
      'school-empty',
    );

    expect(report.schoolName).toBe('Empty School');
    expect(report.totalStudents).toBe(0);
    expect(report.totalTeachers).toBe(0);
    expect(report.totalClasses).toBe(0);
    expect(report.totalAssignmentsSubmitted).toBe(0);
    expect(report.totalQuizzesPublished).toBe(0);
    expect(report.classes).toHaveLength(0);
  });

  it('returns student+teacher counts but empty classes when no active classes', async () => {
    const report: SchoolReport = await loadSchoolReport(
      buildAdmin('no_classes'),
      'school-no-classes',
    );

    expect(report.schoolName).toBe('Sparse School');
    expect(report.totalStudents).toBe(5);
    expect(report.totalTeachers).toBe(1);
    expect(report.totalClasses).toBe(0);
    expect(report.totalAssignmentsSubmitted).toBe(0);
    expect(report.totalQuizzesPublished).toBe(0);
    expect(report.classes).toHaveLength(0);
  });

  it('returns null teacherName for a class with no teacher_id', async () => {
    // Minimal admin stub that returns one class with no teacher
    const admin = {
      from: (table: string) => {
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.eq = () => q;
        q.in = () => q;
        q.not = () => q;
        q.is = () => q;
        q.order = () => q;
        q.limit = () => q;
        q.single = () =>
          Promise.resolve({ data: { name: 'No Teacher School' }, error: null });
        q.maybeSingle = () => Promise.resolve({ data: null, error: null });
        (q as { then: unknown }).then = (
          resolve: (v: { data: unknown[]; count: number; error: null }) => void,
        ) => {
          let data: unknown[] = [];
          if (table === 'classes') {
            data = [{ id: 'cx', name: 'Unassigned Class', teacher_id: null }];
          }
          resolve({ data, count: 0, error: null });
        };
        return q;
      },
    } as unknown as Parameters<typeof loadSchoolReport>[0];

    const report = await loadSchoolReport(admin, 'school-x');
    expect(report.classes).toHaveLength(1);
    expect(report.classes[0].teacherName).toBeNull();
    expect(report.classes[0].classId).toBe('cx');
  });
});
