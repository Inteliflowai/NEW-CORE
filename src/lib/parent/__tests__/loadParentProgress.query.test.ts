import { describe, it, expect, vi } from 'vitest';
import { makeFakeAdmin } from '@/test/fakeSupabase';

// Isolate the assignment query: stub loadStudentGrowth so only .from('assignments') runs.
vi.mock('@/lib/student/loadStudentGrowth', () => ({
  loadStudentGrowth: vi.fn().mockResolvedValue({
    gradeDirection: null, trendPoints: [], skills: [], latestHighFiveText: null, totalHighFiveCount: 0,
  }),
}));

import { loadParentProgress } from '@/lib/parent/loadParentProgress';

const NOW = new Date('2026-06-10T00:00:00Z');

describe('loadParentProgress — IDOR scoping + title fallback', () => {
  it('scopes the upcoming query by student_id and future due_at', async () => {
    const admin = makeFakeAdmin({ assignments: { data: [] } });
    await loadParentProgress(admin as never, 'stu-1', NOW);
    const calls = admin.__used.assignments.__calls;
    expect(calls).toContainEqual({ method: 'eq', args: ['student_id', 'stu-1'] });
    expect(calls.some((c) => c.method === 'gt' && c.args[0] === 'due_at')).toBe(true);
  });

  it('prefers the lesson title, then content.title, then a literal', async () => {
    const admin = makeFakeAdmin({
      assignments: {
        data: [
          { id: 'a1', due_at: '2026-06-12T00:00:00Z', content: { title: 'C-title' }, lesson_id: 'l1', lessons: { title: 'Lesson Title' } },
          { id: 'a2', due_at: '2026-06-13T00:00:00Z', content: { title: 'C-title-2' }, lesson_id: null, lessons: null },
          { id: 'a3', due_at: '2026-06-14T00:00:00Z', content: null, lesson_id: null, lessons: null },
        ],
      },
    });
    const out = await loadParentProgress(admin as never, 'stu-1', NOW);
    expect(out.upcoming.map((u) => u.title)).toEqual(['Lesson Title', 'C-title-2', 'Upcoming assignment']);
  });
});
