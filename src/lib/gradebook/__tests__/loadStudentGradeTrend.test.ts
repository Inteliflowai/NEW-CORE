import { describe, it, expect, beforeEach } from 'vitest';
import { loadStudentGradeTrend } from '@/lib/gradebook/loadStudentGradeTrend';

let ASSIGNMENTS: unknown[]; let HW: unknown[]; let LESSONS: unknown[];
function table(rows: () => unknown[]) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['select', 'eq', 'in', 'order']) q[m] = chain;
  (q as { then: unknown }).then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: rows(), error: null });
  return q;
}
const admin = {
  from: (t: string) => {
    if (t === 'assignments') return table(() => ASSIGNMENTS);
    if (t === 'homework_attempts') return table(() => HW);
    if (t === 'lessons') return table(() => LESSONS);
    return table(() => []);
  },
} as unknown as Parameters<typeof loadStudentGradeTrend>[0];

beforeEach(() => {
  ASSIGNMENTS = [
    { id: 'a1', lesson_id: 'L1' }, { id: 'a2', lesson_id: 'L1' }, { id: 'a3', lesson_id: 'L1' },
  ];
  LESSONS = [{ id: 'L1', title: 'Fractions' }];
  HW = [
    { assignment_id: 'a1', score_pct: 60, teacher_score: null, graded_at: '2026-06-05T00:00:00Z', submitted_on_time: true, status: 'graded' },
    { assignment_id: 'a2', score_pct: 70, teacher_score: null, graded_at: '2026-06-10T00:00:00Z', submitted_on_time: false, status: 'graded' },
    { assignment_id: 'a3', score_pct: 80, teacher_score: 90, graded_at: '2026-06-15T00:00:00Z', submitted_on_time: true, status: 'graded' },
  ];
});

describe('loadStudentGradeTrend', () => {
  it('returns graded points oldest→newest, override-wins, with assignment titles', async () => {
    const t = await loadStudentGradeTrend(admin, { studentId: 's1', classId: 'c1' });
    expect(t.points.map(p => p.grade)).toEqual([60, 70, 90]); // a3 uses teacher_score 90
    expect(t.points.map(p => p.date)).toEqual(['2026-06-05T00:00:00Z', '2026-06-10T00:00:00Z', '2026-06-15T00:00:00Z']);
    expect(t.points[0].assignment_title).toBe('Fractions');
    expect(t.points[1].on_time).toBe(false);
    expect(t.latest).toBe(90);
    expect(t.average).toBe(73); // round((60+70+90)/3)
  });

  it('classifies direction climbing/steady/sliding (null under 3 points)', async () => {
    const climbing = await loadStudentGradeTrend(admin, { studentId: 's1', classId: 'c1' });
    expect(climbing.direction).toBe('climbing');
    HW = HW.slice(0, 2); // only 2 points
    const tooFew = await loadStudentGradeTrend(admin, { studentId: 's1', classId: 'c1' });
    expect(tooFew.direction).toBeNull();
  });

  it('returns an empty trend when the student has no graded work', async () => {
    HW = [];
    const t = await loadStudentGradeTrend(admin, { studentId: 's1', classId: 'c1' });
    expect(t.points).toEqual([]);
    expect(t.direction).toBeNull();
    expect(t.latest).toBeNull();
    expect(t.average).toBeNull();
  });
});
