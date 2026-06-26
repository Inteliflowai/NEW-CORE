// src/lib/school/__tests__/loadStudentAttention.test.ts
// TDD for loadStudentAttention — mock the admin client; assert the grade→class→student shape.
// Key invariant: returned student objects contain NO numeric risk/divergence keys.
import { describe, it, expect } from 'vitest';
import { loadStudentAttention } from '@/lib/school/loadStudentAttention';
import type { AttentionRollupData } from '@/lib/school/loadStudentAttention';

// ---------------------------------------------------------------------------
// Chainable admin-client stub
// ---------------------------------------------------------------------------
type Scenario = 'normal' | 'empty' | 'no_school_match';

function buildAdmin(scenario: Scenario) {
  function makeChain(table: string) {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.in = () => q;
    q.order = () => q;
    q.limit = () => q;
    q.maybeSingle = () => Promise.resolve({ data: null, error: null });

    (q as { then: unknown }).then = (
      resolve: (v: { data: unknown; error: null }) => void,
    ) => {
      let data: unknown = [];

      if (scenario === 'normal') {
        if (table === 'student_model_snapshots') {
          // s1 appears twice (latest first per desc order), s2 once
          data = [
            { student_id: 's1', mastery_band: 'reteach', snapshot_date: '2026-06-15' },
            { student_id: 's2', mastery_band: 'reteach', snapshot_date: '2026-06-14' },
            { student_id: 's1', mastery_band: 'reteach', snapshot_date: '2026-06-10' }, // older dup
          ];
        } else if (table === 'users') {
          data = [
            { id: 's1', full_name: 'Alice Green', grade_level: '7' },
            { id: 's2', full_name: 'Bob Smith', grade_level: '9' },
          ];
        } else if (table === 'enrollments') {
          data = [
            { student_id: 's1', class_id: 'c1' },
            { student_id: 's2', class_id: 'c2' },
          ];
        } else if (table === 'classes') {
          data = [
            { id: 'c1', name: 'English 7A' },
            { id: 'c2', name: 'Math 9B' },
          ];
        }
      }
      // 'empty' and 'no_school_match': all tables return []

      resolve({ data, error: null });
    };

    return q;
  }

  return {
    from: (table: string) => makeChain(table),
  } as unknown as Parameters<typeof loadStudentAttention>[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('loadStudentAttention', () => {
  it('returns the correct grade→class→student grouping for a normal school', async () => {
    const result: AttentionRollupData = await loadStudentAttention(
      buildAdmin('normal'),
      'school-123',
    );

    expect(result.grades).toHaveLength(2);

    // ── Grade 7: Alice in English 7A ─────────────────────────────────────
    const grade7 = result.grades.find(g => g.grade === '7');
    expect(grade7).toBeDefined();
    expect(grade7!.classes).toHaveLength(1);
    expect(grade7!.classes[0].classId).toBe('c1');
    expect(grade7!.classes[0].className).toBe('English 7A');
    expect(grade7!.classes[0].students).toHaveLength(1);
    expect(grade7!.classes[0].students[0].studentId).toBe('s1');
    expect(grade7!.classes[0].students[0].name).toBe('Alice Green');

    // ── Grade 9: Bob in Math 9B ───────────────────────────────────────────
    const grade9 = result.grades.find(g => g.grade === '9');
    expect(grade9).toBeDefined();
    expect(grade9!.classes[0].classId).toBe('c2');
    expect(grade9!.classes[0].className).toBe('Math 9B');
    expect(grade9!.classes[0].students[0].studentId).toBe('s2');
    expect(grade9!.classes[0].students[0].name).toBe('Bob Smith');
  });

  it('returns { grades: [] } when no reteach snapshots exist', async () => {
    const result = await loadStudentAttention(buildAdmin('empty'), 'school-empty');
    expect(result).toEqual({ grades: [] });
  });

  it('returns { grades: [] } when no reteach students belong to this school', async () => {
    // 'no_school_match' returns [] from users (school_id guard drops them all)
    const result = await loadStudentAttention(buildAdmin('no_school_match'), 'school-other');
    expect(result).toEqual({ grades: [] });
  });

  it('student objects contain ONLY studentId + name — no numeric risk/divergence keys', async () => {
    const result = await loadStudentAttention(buildAdmin('normal'), 'school-123');

    for (const grade of result.grades) {
      for (const cls of grade.classes) {
        for (const student of cls.students) {
          const keys = Object.keys(student);
          // Forbidden keys — these must never appear on the student object
          expect(keys).not.toContain('risk');
          expect(keys).not.toContain('risk_score');
          expect(keys).not.toContain('divergence');
          expect(keys).not.toContain('divergence_score');
          expect(keys).not.toContain('mastery_band');
          // Only studentId and name are allowed
          expect(keys.sort()).toEqual(['name', 'studentId']);
        }
      }
    }
  });

  it('deduplicates: a student with multiple reteach snapshots appears once per class', async () => {
    const result = await loadStudentAttention(buildAdmin('normal'), 'school-123');
    const grade7 = result.grades.find(g => g.grade === '7')!;
    // s1 has 2 snapshot rows (older is deduplicated); should appear exactly once
    const s1Entries = grade7.classes[0].students.filter(s => s.studentId === 's1');
    expect(s1Entries).toHaveLength(1);
  });

  it('grades are sorted alphabetically', async () => {
    const result = await loadStudentAttention(buildAdmin('normal'), 'school-123');
    const gradeKeys = result.grades.map(g => g.grade);
    expect(gradeKeys).toEqual([...gradeKeys].sort());
  });
});
