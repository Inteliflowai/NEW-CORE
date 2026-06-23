import { describe, it, expect, beforeEach } from 'vitest';
import { loadLessonLibrary } from '@/lib/lessons/loadLessonLibrary';

// Scriptable tables.
let LESSONS: unknown[]; let QUIZZES: unknown[];

// Minimal chainable query stub: every filter returns `this`; awaiting yields { data }.
function table(rows: () => unknown[]) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['select', 'eq', 'in', 'order', 'neq']) q[m] = chain;
  (q as { then: unknown }).then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: rows(), error: null });
  return q;
}
const admin = {
  from: (t: string) => {
    if (t === 'lessons') return table(() => LESSONS);
    if (t === 'quizzes') return table(() => QUIZZES);
    return table(() => []);
  },
} as unknown as Parameters<typeof loadLessonLibrary>[0];

beforeEach(() => {
  LESSONS = [
    { id: 'L1', title: 'Photosynthesis', subject: 'Science', grade_level: '7', status: 'pending_review', created_at: '2026-06-10T00:00:00Z' },
    { id: 'L2', title: 'Fractions', subject: 'Math', grade_level: '6', status: 'draft', created_at: '2026-06-12T00:00:00Z' },
    { id: 'L3', title: 'The Revolution', subject: 'History', grade_level: '8', status: 'pending_review', created_at: '2026-06-08T00:00:00Z' },
  ];
  QUIZZES = [
    { id: 'q1', lesson_id: 'L1', class_id: 'c1' },
    { id: 'q2', lesson_id: 'L1', class_id: 'c1' },
    { id: 'q3', lesson_id: 'L3', class_id: 'c1' },
  ];
});

describe('loadLessonLibrary', () => {
  it('maps lessons rows with subject/grade/status and the per-lesson quiz_count', async () => {
    const lib = await loadLessonLibrary(admin, { classId: 'c1' });
    expect(lib.class_id).toBe('c1');
    const byId = Object.fromEntries(lib.lessons.map((l) => [l.id, l]));
    expect(byId['L1'].title).toBe('Photosynthesis');
    expect(byId['L1'].subject).toBe('Science');
    expect(byId['L1'].grade_level).toBe('7');
    expect(byId['L1'].status).toBe('pending_review');
    expect(byId['L1'].quiz_count).toBe(2); // q1 + q2
    expect(byId['L3'].quiz_count).toBe(1); // q3
    expect(byId['L2'].quiz_count).toBe(0); // no quiz
  });

  it('orders newest-first by created_at', async () => {
    const lib = await loadLessonLibrary(admin, { classId: 'c1' });
    expect(lib.lessons.map((l) => l.id)).toEqual(['L2', 'L1', 'L3']); // 06-12, 06-10, 06-08
  });

  it('returns an empty list with no lessons (cold start)', async () => {
    LESSONS = [];
    QUIZZES = [];
    const lib = await loadLessonLibrary(admin, { classId: 'c1' });
    expect(lib.lessons).toEqual([]);
  });

  it('exposes a validated parsed_content (the lesson plan) per row; null when absent/malformed', async () => {
    LESSONS = [
      { id: 'L1', title: 'Photosynthesis', subject: 'Science', grade_level: '7', status: 'published', created_at: '2026-06-10T00:00:00Z',
        parsed_content: { title: 'Photosynthesis', objectives: ['Explain photosynthesis'], key_concepts: ['chlorophyll'], vocabulary: [{ term: 'stomata', definition: 'leaf pores' }], misconception_risks: ['plants eat soil'], summary: 'Plants make food.' } },
      { id: 'L2', title: 'No plan', subject: null, grade_level: null, status: 'draft', created_at: '2026-06-09T00:00:00Z', parsed_content: null },
      { id: 'L3', title: 'Garbage plan', subject: null, grade_level: null, status: 'draft', created_at: '2026-06-08T00:00:00Z', parsed_content: 'not-an-object' },
      // A real OBJECT that fails the Zod schema (vocabulary entry missing `definition`) — exercises
      // the safeParse rejection path, distinct from the non-object guard above.
      { id: 'L4', title: 'Schema-fail plan', subject: null, grade_level: null, status: 'draft', created_at: '2026-06-07T00:00:00Z', parsed_content: { vocabulary: [{ term: 'x' }] } },
    ];
    QUIZZES = [];
    const lib = await loadLessonLibrary(admin, { classId: 'c1' });
    const byId = Object.fromEntries(lib.lessons.map((l) => [l.id, l]));
    expect(byId['L1'].parsed_content?.objectives).toEqual(['Explain photosynthesis']);
    expect(byId['L1'].parsed_content?.vocabulary).toEqual([{ term: 'stomata', definition: 'leaf pores' }]);
    expect(byId['L2'].parsed_content).toBeNull();
    expect(byId['L3'].parsed_content).toBeNull(); // non-object
    expect(byId['L4'].parsed_content).toBeNull(); // object that fails ParsedLessonSchema.safeParse
  });

  it('exposes confirmed standards (codes + framework) and unit/day, defaulting missing values safely', async () => {
    LESSONS = [
      { id: 'L1', title: 'Day 1', subject: 'Math', grade_level: '4', status: 'draft', created_at: '2026-06-12T00:00:00Z',
        parsed_content: null, standard_codes: ['TEKS.4.3A', 'TEKS.4.3B'], standard_framework: 'TEKS', chapter_title: 'Fractions Unit', day_index: 1 },
      // Missing/absent fields default safely: codes → [], framework/chapter → null, day_index → null.
      { id: 'L2', title: 'Standalone', subject: null, grade_level: null, status: 'draft', created_at: '2026-06-10T00:00:00Z',
        parsed_content: null, standard_codes: null, standard_framework: null, chapter_title: null, day_index: null },
    ];
    QUIZZES = [];
    const lib = await loadLessonLibrary(admin, { classId: 'c1' });
    const byId = Object.fromEntries(lib.lessons.map((l) => [l.id, l]));
    expect(byId['L1'].standard_codes).toEqual(['TEKS.4.3A', 'TEKS.4.3B']);
    expect(byId['L1'].standard_framework).toBe('TEKS');
    expect(byId['L1'].chapter_title).toBe('Fractions Unit');
    expect(byId['L1'].day_index).toBe(1);
    expect(byId['L2'].standard_codes).toEqual([]);
    expect(byId['L2'].standard_framework).toBeNull();
    expect(byId['L2'].chapter_title).toBeNull();
    expect(byId['L2'].day_index).toBeNull();
  });
});
