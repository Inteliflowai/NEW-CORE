import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const guardClassAccess = vi.fn();
const quizUpdates: Array<Record<string, unknown>> = [];
const questionUpdates: Array<{ id: string; patch: Record<string, unknown> }> = [];
let QUIZ: unknown; let ROLE: string;
let QUIZ_WRITE_ERROR: unknown; // when set, the quizzes UPDATE resolves with this .error
let QUESTION_WRITE_ERROR: unknown; // when set, a quiz_questions UPDATE resolves with this .error
let QUESTION_COUNT: number; // count of quiz_questions (publish guard: 0 => still-building => 409)
let QUESTION_COUNT_ERROR: unknown; // when set, the quiz_questions count resolves with this .error
const FIXED_NOW = '2026-06-23T12:00:00.000Z';

// Mirror the canonical STAFF_ROLES (src/lib/auth/roles.ts) EXACTLY — array of the real
// role strings ('school_sysadmin', not 'sysadmin'); the route wraps it in a Set.
vi.mock('@/lib/auth/roles', () => ({ STAFF_ROLES: ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'] as const }));
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'users') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: ROLE } }) }) }) };
      if (t === 'quizzes') return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: QUIZ }) }) }),
        update: (p: Record<string, unknown>) => { quizUpdates.push(p); return { eq: async () => ({ error: QUIZ_WRITE_ERROR }) }; },
      };
      // quiz_questions — the route scopes the write with .eq('quiz_id', quizId).eq('id', questionId),
      // so .eq() must be chainable; we capture the LAST eq value as the question id and resolve as
      // a thenable on await.
      return {
        // publish guard counts questions: .select('id',{count,head}).eq('quiz_id', quizId)
        select: () => ({ eq: async () => ({ count: QUESTION_COUNT, error: QUESTION_COUNT_ERROR }) }),
        update: (p: Record<string, unknown>) => {
          const builder: Record<string, unknown> = {};
          let lastId = '';
          builder.eq = (_col: string, val: string) => { lastId = val; return builder; };
          (builder as { then: unknown }).then = (resolve: (v: { error: unknown }) => void) => {
            questionUpdates.push({ id: lastId, patch: p });
            return resolve({ error: QUESTION_WRITE_ERROR });
          };
          return builder;
        },
      };
    },
  }),
}));

const req = (b: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(b) });
async function load() { vi.resetModules(); return (await import('@/app/api/teacher/quizzes/manage/route')).POST; }

beforeEach(() => {
  getUser.mockReset(); guardClassAccess.mockReset();
  quizUpdates.length = 0; questionUpdates.length = 0;
  ROLE = 'teacher'; QUIZ = { id: 'qz1', class_id: 'c1', status: 'draft', published_at: null };
  QUIZ_WRITE_ERROR = null; QUESTION_WRITE_ERROR = null;
  QUESTION_COUNT = 5; QUESTION_COUNT_ERROR = null; // default: quiz has questions
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  guardClassAccess.mockResolvedValue(null); // access granted
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW));
});

describe('POST /api/teacher/quizzes/manage', () => {
  it('401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await (await load())(req({ quiz_id: 'qz1', action: 'publish' }))).status).toBe(401);
  });
  it('403 for a non-staff role', async () => {
    ROLE = 'student';
    expect((await (await load())(req({ quiz_id: 'qz1', action: 'publish' }))).status).toBe(403);
  });
  it('403 when guardClassAccess denies (cross-teacher IDOR)', async () => {
    guardClassAccess.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await (await load())(req({ quiz_id: 'qz1', action: 'publish' }))).status).toBe(403);
  });
  it('404 when the quiz is not found', async () => {
    QUIZ = null;
    expect((await (await load())(req({ quiz_id: 'qz1', action: 'publish' }))).status).toBe(404);
  });
  it('400 on a missing quiz_id', async () => {
    expect((await (await load())(req({ action: 'publish' }))).status).toBe(400);
  });
  it('400 on an unknown action', async () => {
    expect((await (await load())(req({ quiz_id: 'qz1', action: 'nope' }))).status).toBe(400);
  });

  it('publish sets status=published AND published_at (the student-visibility gate)', async () => {
    const res = await (await load())(req({ quiz_id: 'qz1', action: 'publish' }));
    expect(res.status).toBe(200);
    const p = quizUpdates[0];
    expect(p.status).toBe('published');
    expect(p.published_at).toBe(FIXED_NOW);
  });

  it('publish is BLOCKED (409) when the quiz has 0 questions (still building / empty)', async () => {
    QUESTION_COUNT = 0;
    const res = await (await load())(req({ quiz_id: 'qz1', action: 'publish' }));
    expect(res.status).toBe(409);
    expect(quizUpdates).toHaveLength(0); // never written to published
  });

  it('unpublish clears status back to draft and clears published_at', async () => {
    QUIZ = { id: 'qz1', class_id: 'c1', status: 'published', published_at: FIXED_NOW };
    const res = await (await load())(req({ quiz_id: 'qz1', action: 'unpublish' }));
    expect(res.status).toBe(200);
    const p = quizUpdates[0];
    expect(p.status).toBe('draft');
    expect(p.published_at).toBeNull();
  });

  it('archive sets status=archived (soft delete) and never sets published_at', async () => {
    const res = await (await load())(req({ quiz_id: 'qz1', action: 'archive' }));
    expect(res.status).toBe(200);
    const p = quizUpdates[0];
    expect(p.status).toBe('archived');
    expect('published_at' in p).toBe(false);
  });

  it('edit updates the quiz title and each provided question (text/choices/rubric), never touches status/published_at', async () => {
    const res = await (await load())(req({
      quiz_id: 'qz1', action: 'edit', title: 'Cells — Check',
      questions: [
        { id: 'qq1', question_text: 'What is a cell?', rubric: 'Name the basic unit.' },
        { id: 'qq2', question_text: 'Pick one', choices: ['a', 'b', 'c'] },
      ],
    }));
    expect(res.status).toBe(200);
    const p = quizUpdates[0];
    expect(p.title).toBe('Cells — Check');
    expect('status' in p).toBe(false);
    expect('published_at' in p).toBe(false);
    expect(questionUpdates).toHaveLength(2);
    expect(questionUpdates.find(q => q.id === 'qq1')?.patch.question_text).toBe('What is a cell?');
    expect(questionUpdates.find(q => q.id === 'qq1')?.patch.rubric).toBe('Name the basic unit.');
    expect(questionUpdates.find(q => q.id === 'qq2')?.patch.choices).toEqual(['a', 'b', 'c']);
  });

  it('500 when the quizzes UPDATE returns an error (fail loud, never silent)', async () => {
    QUIZ_WRITE_ERROR = { message: 'db down' };
    expect((await (await load())(req({ quiz_id: 'qz1', action: 'publish' }))).status).toBe(500);
  });

  it('500 when a quiz_questions UPDATE returns an error during edit', async () => {
    QUESTION_WRITE_ERROR = { message: 'db down' };
    expect((await (await load())(req({ quiz_id: 'qz1', action: 'edit', questions: [{ id: 'qq1', question_text: 'x' }] }))).status).toBe(500);
  });
});
