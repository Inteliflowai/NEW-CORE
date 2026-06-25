import { describe, it, expect, vi } from 'vitest';
import { deriveResourceSchool, resolveGcDeepLink } from '@/lib/google/launchResolve';

// Chainable query stub: every builder method returns `this`; maybeSingle resolves to `result`.
function chain(result: unknown) {
  const o: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit']) o[m] = vi.fn(() => o);
  o.maybeSingle = vi.fn(async () => ({ data: result }));
  return o;
}
// Admin whose from() returns each queued chain result in order.
function adminWith(results: unknown[]) {
  const queue = [...results];
  return { from: vi.fn(() => chain(queue.shift())) } as never;
}

describe('deriveResourceSchool', () => {
  it('quiz → quizzes.class_id → classes.school_id', async () => {
    const admin = adminWith([{ class_id: 'c1' }, { school_id: 's1' }]);
    expect(await deriveResourceSchool(admin, 'quiz', 'Q1')).toEqual({ schoolId: 's1', classId: 'c1' });
  });
  it('assignment → lessons.class_id → classes.school_id', async () => {
    const admin = adminWith([{ class_id: 'c2' }, { school_id: 's9' }]);
    expect(await deriveResourceSchool(admin, 'assignment', 'L1')).toEqual({ schoolId: 's9', classId: 'c2' });
  });
  it('returns null when the resource is missing', async () => {
    expect(await deriveResourceSchool(adminWith([null]), 'quiz', 'Q1')).toBeNull();
  });
  it('returns null when the class is missing', async () => {
    expect(await deriveResourceSchool(adminWith([{ class_id: 'c1' }, null]), 'quiz', 'Q1')).toBeNull();
  });
});

describe('resolveGcDeepLink', () => {
  it('assignment with the student\'s own row → /student/assignments/<id>', async () => {
    const admin = adminWith([{ id: 'A1' }]);
    expect(await resolveGcDeepLink(admin, { studentId: 'stu1', gc: 'assignment', id: 'L1' })).toBe('/student/assignments/A1');
  });
  it('assignment with no row → the list', async () => {
    const admin = adminWith([null]);
    expect(await resolveGcDeepLink(admin, { studentId: 'stu1', gc: 'assignment', id: 'L1' })).toBe('/student/assignments');
  });
  it('quiz → /student/quiz', async () => {
    const admin = adminWith([]); // no DB read for quiz
    expect(await resolveGcDeepLink(admin, { studentId: 'stu1', gc: 'quiz', id: 'Q1' })).toBe('/student/quiz');
  });
});
