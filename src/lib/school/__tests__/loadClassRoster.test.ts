// src/lib/school/__tests__/loadClassRoster.test.ts
// TDD for loadClassRoster — mock the admin client; assert the ClassRosterStudent shape.
// Covers: normal class with roster, IDOR guard (class not in this school → null),
// and empty class (zero enrollments → { students: [] }).
import { describe, it, expect } from 'vitest';
import { loadClassRoster } from '@/lib/school/loadClassRoster';
import type { ClassRosterStudent } from '@/lib/school/loadClassRoster';

// ---------------------------------------------------------------------------
// Chainable admin-client stub
// ---------------------------------------------------------------------------
type Scenario = 'normal' | 'idor' | 'empty_class';

function buildAdmin(scenario: Scenario) {
  function makeChain(table: string) {
    const filters: Record<string, unknown> = {};
    const q: Record<string, unknown> = {};

    q.select = () => q;
    q.eq = (col: string, val: unknown) => {
      filters[col] = val;
      return q;
    };
    q.in = () => q;
    q.order = () => q;

    // maybeSingle — used for the IDOR class check
    q.maybeSingle = () => {
      if (table === 'classes') {
        if (scenario === 'idor') {
          // Class not found in this school
          return Promise.resolve({ data: null, error: null });
        }
        // normal + empty_class: class exists
        return Promise.resolve({ data: { id: filters['id'] ?? 'c1' }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };

    (q as { then: unknown }).then = (
      resolve: (v: { data: unknown; error: null }) => void,
    ) => {
      let data: unknown = [];

      if (scenario === 'normal') {
        if (table === 'enrollments') {
          data = [
            { student_id: 's1', is_active: true, source: 'google' },
            { student_id: 's2', is_active: true, source: null },
            { student_id: 's3', is_active: false, source: 'file' },
          ];
        } else if (table === 'users') {
          data = [
            { id: 's1', full_name: 'Alice A.', email: 'alice@school.edu' },
            { id: 's2', full_name: 'Bob B.', email: 'bob@school.edu' },
            { id: 's3', full_name: 'Carla C.', email: 'carla@school.edu' },
          ];
        }
      }
      // idor scenario: falls through to null from maybeSingle before here
      // empty_class: enrollments returns [] → no users query

      resolve({ data, error: null });
    };

    return q;
  }

  return {
    from: (table: string) => makeChain(table),
  } as unknown as Parameters<typeof loadClassRoster>[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('loadClassRoster', () => {
  it('returns the roster for a valid class in the school', async () => {
    const result = await loadClassRoster(buildAdmin('normal'), 'c1', 'school-123');

    expect(result).not.toBeNull();
    const students: ClassRosterStudent[] = result!.students;
    expect(students).toHaveLength(3);

    // Active students come first, then inactive
    const active = students.filter(s => s.active);
    const inactive = students.filter(s => !s.active);
    expect(active).toHaveLength(2);
    expect(inactive).toHaveLength(1);

    // Check that the first inactive is Carla (is_active=false)
    expect(inactive[0].id).toBe('s3');
    expect(inactive[0].name).toBe('Carla C.');
    expect(inactive[0].active).toBe(false);
    expect(inactive[0].source).toBe('file');

    // Check Alice (google source)
    const alice = students.find(s => s.id === 's1');
    expect(alice).toBeDefined();
    expect(alice!.name).toBe('Alice A.');
    expect(alice!.email).toBe('alice@school.edu');
    expect(alice!.active).toBe(true);
    expect(alice!.source).toBe('google');

    // Check Bob (null source)
    const bob = students.find(s => s.id === 's2');
    expect(bob).toBeDefined();
    expect(bob!.name).toBe('Bob B.');
    expect(bob!.source).toBeNull();
  });

  it('returns null when the class does not belong to this school (IDOR guard)', async () => {
    const result = await loadClassRoster(buildAdmin('idor'), 'c-other', 'school-123');
    expect(result).toBeNull();
  });

  it('returns { students: [] } for a class with no enrollments', async () => {
    const result = await loadClassRoster(buildAdmin('empty_class'), 'c-empty', 'school-123');
    expect(result).not.toBeNull();
    expect(result!.students).toEqual([]);
  });
});
