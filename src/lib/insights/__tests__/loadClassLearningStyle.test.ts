// src/lib/insights/__tests__/loadClassLearningStyle.test.ts
import { describe, it, expect } from 'vitest';
import { loadClassLearningStyle, learningStyleLine } from '@/lib/insights/loadClassLearningStyle';

function makeAdmin(fixtures: Record<string, unknown[]>) {
  const builder = (rows: unknown[]) => {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    b.select = chain; b.eq = chain; b.in = chain; b.order = chain;
    (b as { then: unknown }).then = (resolve: (v: { data: unknown[] }) => void) => resolve({ data: rows });
    return b;
  };
  return { from: (t: string) => builder(fixtures[t] ?? []) } as never;
}

describe('learningStyleLine', () => {
  it('uses "differentiate", never "adapt", and lists ≥2 styles', () => {
    const line = learningStyleLine(['visual', 'hands-on', 'discussion-based']);
    expect(line).toBe('Your class spans visual, hands-on, and discussion-based learners — assignments differentiate to each.');
    expect(line).not.toMatch(/adapt/i);
  });
  it('null below 2 distinct styles', () => {
    expect(learningStyleLine(['visual'])).toBeNull();
  });
});

describe('loadClassLearningStyle', () => {
  it("takes each student's most-recent NON-emerging style and skips null-dated rows", async () => {
    const admin = makeAdmin({
      enrollments: [{ student_id: 's1' }, { student_id: 's2' }, { student_id: 's3' }],
      // Rows arrive newest-first (DESC). A null-dated row (NULLS FIRST in real PG) must NOT win.
      quiz_attempts: [
        { student_id: 's1', learning_style: 'auditory', submitted_at: null },     // null date → skip
        { student_id: 's1', learning_style: 'emerging', submitted_at: '2026-06-10' }, // low-conf → skip
        { student_id: 's1', learning_style: 'visual', submitted_at: '2026-06-01' },   // confident → wins
        { student_id: 's2', learning_style: 'kinesthetic', submitted_at: '2026-06-09' },
        { student_id: 's3', learning_style: 'social', submitted_at: '2026-06-08' },
      ],
    });
    const out = await loadClassLearningStyle(admin, 'c1');
    expect(out.styles).toEqual(['visual', 'hands-on', 'discussion-based']);
    expect(out.line).toContain('differentiate to each');
  });

  it('quiet when fewer than 3 confident students', async () => {
    const admin = makeAdmin({
      enrollments: [{ student_id: 's1' }, { student_id: 's2' }],
      quiz_attempts: [{ student_id: 's1', learning_style: 'visual', submitted_at: '2026-06-01' }],
    });
    const out = await loadClassLearningStyle(admin, 'c1');
    expect(out).toEqual({ styles: [], line: null });
  });
});
