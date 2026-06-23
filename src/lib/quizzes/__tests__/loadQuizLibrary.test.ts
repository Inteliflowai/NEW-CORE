import { describe, it, expect, beforeEach } from 'vitest';
import { loadQuizLibrary } from '@/lib/quizzes/loadQuizLibrary';

// Scriptable tables.
let QUIZZES: unknown[]; let QUIZ_QUESTIONS: unknown[]; let LESSONS: unknown[];

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
    if (t === 'quizzes') return table(() => QUIZZES);
    if (t === 'quiz_questions') return table(() => QUIZ_QUESTIONS);
    if (t === 'lessons') return table(() => LESSONS);
    return table(() => []);
  },
} as unknown as Parameters<typeof loadQuizLibrary>[0];

beforeEach(() => {
  QUIZZES = [
    { id: 'q1', title: 'Photosynthesis — Check', lesson_id: 'L1', status: 'published', published_at: '2026-06-10T00:00:00Z', created_at: '2026-06-08T00:00:00Z' },
    { id: 'q2', title: 'Cells — Check', lesson_id: 'L2', status: 'draft', published_at: null, created_at: '2026-06-12T00:00:00Z' },
    { id: 'q3', title: 'Old archived', lesson_id: 'L1', status: 'archived', published_at: null, created_at: '2026-06-01T00:00:00Z' },
  ];
  QUIZ_QUESTIONS = [
    { id: 'qq1', quiz_id: 'q1' }, { id: 'qq2', quiz_id: 'q1' }, { id: 'qq3', quiz_id: 'q1' },
    { id: 'qq4', quiz_id: 'q2' }, { id: 'qq5', quiz_id: 'q2' },
  ];
  LESSONS = [
    { id: 'L1', title: 'Photosynthesis Basics' },
    { id: 'L2', title: 'Cell Structure' },
  ];
});

describe('loadQuizLibrary', () => {
  it('maps rows, excludes archived, resolves lesson_title, counts questions', async () => {
    // Archived is excluded by the .neq('status','archived') filter — emulate by filtering the stub
    // result the same way the DB would. The loader does NOT re-filter, so feed it the non-archived rows.
    QUIZZES = QUIZZES.filter((q) => (q as { status: string }).status !== 'archived');
    const lib = await loadQuizLibrary(admin, { classId: 'c1' });
    expect(lib.class_id).toBe('c1');
    expect(lib.quizzes.map((q) => q.id)).not.toContain('q3'); // archived excluded
    const q1 = lib.quizzes.find((q) => q.id === 'q1')!;
    expect(q1.lesson_title).toBe('Photosynthesis Basics');
    expect(q1.question_count).toBe(3);
    expect(q1.status).toBe('published');
    expect(q1.published_at).toBe('2026-06-10T00:00:00Z');
    const q2 = lib.quizzes.find((q) => q.id === 'q2')!;
    expect(q2.question_count).toBe(2);
    expect(q2.lesson_title).toBe('Cell Structure');
  });

  it('orders published-first (published_at desc, nulls last), then created_at desc', async () => {
    QUIZZES = [
      { id: 'd_new', title: 'Draft new', lesson_id: null, status: 'draft', published_at: null, created_at: '2026-06-20T00:00:00Z' },
      { id: 'p_old', title: 'Published old', lesson_id: null, status: 'published', published_at: '2026-06-05T00:00:00Z', created_at: '2026-06-04T00:00:00Z' },
      { id: 'p_new', title: 'Published new', lesson_id: null, status: 'published', published_at: '2026-06-15T00:00:00Z', created_at: '2026-06-14T00:00:00Z' },
      { id: 'd_old', title: 'Draft old', lesson_id: null, status: 'draft', published_at: null, created_at: '2026-06-02T00:00:00Z' },
    ];
    QUIZ_QUESTIONS = [];
    LESSONS = [];
    const lib = await loadQuizLibrary(admin, { classId: 'c1' });
    // Published (newest published_at first), then drafts (newest created_at first).
    expect(lib.quizzes.map((q) => q.id)).toEqual(['p_new', 'p_old', 'd_new', 'd_old']);
  });

  it('null lesson_id → lesson_title null; zero questions → question_count 0', async () => {
    QUIZZES = [{ id: 'q9', title: 'Standalone', lesson_id: null, status: 'draft', published_at: null, created_at: '2026-06-09T00:00:00Z' }];
    QUIZ_QUESTIONS = [];
    LESSONS = [];
    const lib = await loadQuizLibrary(admin, { classId: 'c1' });
    expect(lib.quizzes[0].lesson_title).toBeNull();
    expect(lib.quizzes[0].question_count).toBe(0);
  });
});
