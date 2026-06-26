// src/lib/school/__tests__/loadSchoolTeachers.test.ts
// TDD for loadSchoolTeachers — mock the admin client; assert the SchoolTeacher shape.
// Covers: normal school (teachers + classes + distinct studentCount) and empty school → [].
import { describe, it, expect } from 'vitest';
import { loadSchoolTeachers } from '@/lib/school/loadSchoolTeachers';
import type { SchoolTeacher } from '@/lib/school/loadSchoolTeachers';

// ---------------------------------------------------------------------------
// Chainable admin-client stub
// Each table returns fixed data; filters are accepted but not inspected by the
// mock (the loader passes the right filters; cross-tenant correctness is tested
// at the integration level). This keeps the mock simple.
// ---------------------------------------------------------------------------
type Scenario = 'normal' | 'empty';

function buildAdmin(scenario: Scenario) {
  function makeChain(table: string) {
    const q: Record<string, unknown> = {};

    // All filter/modifier methods return `this`
    q.select = () => q;
    q.eq = () => q;
    q.in = () => q;
    q.order = () => q;

    // Await the chain directly → { data, error }
    (q as { then: unknown }).then = (
      resolve: (v: { data: unknown; error: null }) => void,
    ) => {
      let data: unknown = [];

      if (scenario === 'normal') {
        if (table === 'users') {
          // Two teachers; Alice has a lastActive, Bob does not.
          data = [
            { id: 't1', full_name: 'Alice Smith', email: 'alice@school.edu', last_active_at: '2026-06-20T10:00:00Z' },
            { id: 't2', full_name: 'Bob Jones', email: 'bob@school.edu', last_active_at: null },
          ];
        } else if (table === 'classes') {
          // Alice teaches two sections (c1, c3); Bob teaches one (c2).
          data = [
            { id: 'c1', name: 'English 7A', subject: 'English Literature', grade_level: '7', teacher_id: 't1' },
            { id: 'c3', name: 'English 7B', subject: 'English Literature', grade_level: '7', teacher_id: 't1' },
            { id: 'c2', name: 'Math 9B', subject: 'Mathematics', grade_level: '9', teacher_id: 't2' },
          ];
        } else if (table === 'enrollments') {
          // c1: s1, s2, s3 | c3: s1, s4 | c2: s5
          // Alice's distinct students = {s1,s2,s3,s4} = 4 (s1 is in both c1 and c3)
          data = [
            { class_id: 'c1', student_id: 's1' },
            { class_id: 'c1', student_id: 's2' },
            { class_id: 'c1', student_id: 's3' },
            { class_id: 'c3', student_id: 's1' },
            { class_id: 'c3', student_id: 's4' },
            { class_id: 'c2', student_id: 's5' },
          ];
        }
      }
      // empty scenario: all tables return [] (default above)

      resolve({ data, error: null });
    };

    return q;
  }

  return {
    from: (table: string) => makeChain(table),
  } as unknown as Parameters<typeof loadSchoolTeachers>[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('loadSchoolTeachers', () => {
  it('returns the correct shape for a school with teachers, classes and enrollments', async () => {
    const teachers: SchoolTeacher[] = await loadSchoolTeachers(
      buildAdmin('normal'),
      'school-123',
    );

    expect(teachers).toHaveLength(2);

    // ── Alice: two classes, 4 distinct students ────────────────────────────
    const alice = teachers.find(t => t.id === 't1');
    expect(alice).toBeDefined();
    expect(alice!.name).toBe('Alice Smith');
    expect(alice!.email).toBe('alice@school.edu');
    expect(alice!.lastActive).toBe('2026-06-20T10:00:00Z');
    expect(alice!.classes).toHaveLength(2);

    // distinct student count: s1 is in both c1 and c3 → 4 unique, not 5
    expect(alice!.studentCount).toBe(4);

    const c1 = alice!.classes.find(c => c.id === 'c1');
    expect(c1).toBeDefined();
    expect(c1!.name).toBe('English 7A');
    expect(c1!.subject).toBe('English Literature');
    expect(c1!.grade).toBe('7');
    expect(c1!.enrollment).toBe(3);

    const c3 = alice!.classes.find(c => c.id === 'c3');
    expect(c3).toBeDefined();
    expect(c3!.enrollment).toBe(2);

    // ── Bob: one class, 1 student, no lastActive ───────────────────────────
    const bob = teachers.find(t => t.id === 't2');
    expect(bob).toBeDefined();
    expect(bob!.name).toBe('Bob Jones');
    expect(bob!.lastActive).toBeNull();
    expect(bob!.classes).toHaveLength(1);
    expect(bob!.studentCount).toBe(1);

    const c2 = bob!.classes.find(c => c.id === 'c2');
    expect(c2).toBeDefined();
    expect(c2!.name).toBe('Math 9B');
    expect(c2!.subject).toBe('Mathematics');
    expect(c2!.grade).toBe('9');
    expect(c2!.enrollment).toBe(1);
  });

  it('returns [] for an empty school with no active teachers', async () => {
    const teachers = await loadSchoolTeachers(buildAdmin('empty'), 'school-empty');
    expect(teachers).toEqual([]);
  });
});
