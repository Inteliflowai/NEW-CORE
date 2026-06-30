import { describe, it, expect, vi } from 'vitest';
import { loadChallenges } from '../loadChallenges';

function admin(assignments: unknown[], completions: unknown[]) {
  const assignChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: assignments, error: null }),
  };
  const compChain = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: completions, error: null }),
  };
  return {
    from: vi.fn((t: string) => (t === 'assignments' ? assignChain : compChain)),
  } as never;
}

describe('loadChallenges', () => {
  it('returns empty challenges when no spark-enabled assignments', async () => {
    const data = await loadChallenges(admin([], []), 'cls-1');
    expect(data).toEqual({ classId: 'cls-1', challenges: [] });
  });

  it('derives per-student status: completed when a scored completion exists, assigned otherwise', async () => {
    const assignments = [
      { id: 'a1', student_id: 's1', spark_status: 'completed', content: { title: 'Ecosystems' }, users: { full_name: 'Alex' } },
      { id: 'a2', student_id: 's2', spark_status: 'created', content: { title: 'Forces' }, users: { full_name: 'Sofia' } },
    ];
    const completions = [
      { assignment_id: 'a1', transfer_score: 88, content_quality: 'engaged', rubric_dimensions: { problem_understanding: 4 }, completed_at: '2026-06-22T10:00:00Z', effort_label: 'persistent', revision_count: 2, teli_hint_count: 1 },
    ];
    const data = await loadChallenges(admin(assignments, completions), 'cls-1');
    const byId = Object.fromEntries(data.challenges.map((c) => [c.assignmentId, c]));
    expect(byId['a1']).toMatchObject({ status: 'completed', transferScore: 88, contentQuality: 'engaged', studentName: 'Alex', title: 'Ecosystems', completedAt: '2026-06-22T10:00:00Z', effortLabel: 'persistent', revisionCount: 2, teliHintCount: 1 });
    expect(byId['a2']).toMatchObject({ status: 'assigned', transferScore: null, studentName: 'Sofia' });
  });

  it('falls back to lessons.title when content.title is absent', async () => {
    const assignments = [
      {
        id: 'a1', student_id: 's1', lesson_id: 'l1', spark_status: 'created',
        content: null, users: { full_name: 'Alex' }, lessons: { title: 'Ocean Ecosystems' },
      },
    ];
    const data = await loadChallenges(admin(assignments, []), 'cls-1');
    expect(data.challenges[0]?.title).toBe('Ocean Ecosystems');
  });

  it('falls back to "Spark Challenge" when both content and lessons title are absent', async () => {
    const assignments = [
      {
        id: 'a1', student_id: 's1', lesson_id: null, spark_status: 'created',
        content: null, users: { full_name: 'Alex' }, lessons: null,
      },
    ];
    const data = await loadChallenges(admin(assignments, []), 'cls-1');
    expect(data.challenges[0]?.title).toBe('Spark Challenge');
  });
});
