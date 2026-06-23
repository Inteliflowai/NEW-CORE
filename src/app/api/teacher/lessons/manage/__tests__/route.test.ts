import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const guardClassAccess = vi.fn();
const lessonUpdates: Array<Record<string, unknown>> = [];
let LESSON: unknown; let ROLE: string;
let LESSON_WRITE_ERROR: unknown; // when set, the lessons UPDATE resolves with this .error

// Mirror the canonical STAFF_ROLES (src/lib/auth/roles.ts) EXACTLY — array of the real
// role strings ('school_sysadmin', not 'sysadmin'); the route wraps it in a Set.
vi.mock('@/lib/auth/roles', () => ({ STAFF_ROLES: ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'] as const }));
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'users') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: ROLE } }) }) }) };
      // lessons — resolve (select→eq→maybeSingle) + archive write (update→eq→await).
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: LESSON }) }) }),
        update: (p: Record<string, unknown>) => { lessonUpdates.push(p); return { eq: async () => ({ error: LESSON_WRITE_ERROR }) }; },
      };
    },
  }),
}));

const req = (b: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(b) });
async function load() { vi.resetModules(); return (await import('@/app/api/teacher/lessons/manage/route')).POST; }

beforeEach(() => {
  getUser.mockReset(); guardClassAccess.mockReset();
  lessonUpdates.length = 0;
  ROLE = 'teacher'; LESSON = { id: 'L1', class_id: 'c1', status: 'draft' };
  LESSON_WRITE_ERROR = null;
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  guardClassAccess.mockResolvedValue(null); // access granted
});

describe('POST /api/teacher/lessons/manage', () => {
  it('401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await (await load())(req({ lesson_id: 'L1', action: 'archive' }))).status).toBe(401);
  });
  it('403 for a non-staff role', async () => {
    ROLE = 'student';
    expect((await (await load())(req({ lesson_id: 'L1', action: 'archive' }))).status).toBe(403);
  });
  it('403 when guardClassAccess denies (cross-teacher IDOR)', async () => {
    guardClassAccess.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await (await load())(req({ lesson_id: 'L1', action: 'archive' }))).status).toBe(403);
  });
  it('404 when the lesson is not found', async () => {
    LESSON = null;
    expect((await (await load())(req({ lesson_id: 'L1', action: 'archive' }))).status).toBe(404);
  });
  it('400 on a missing lesson_id', async () => {
    expect((await (await load())(req({ action: 'archive' }))).status).toBe(400);
  });
  it('400 on an unknown action', async () => {
    expect((await (await load())(req({ lesson_id: 'L1', action: 'nope' }))).status).toBe(400);
  });

  it('archive sets status=archived (soft delete)', async () => {
    const res = await (await load())(req({ lesson_id: 'L1', action: 'archive' }));
    expect(res.status).toBe(200);
    const p = lessonUpdates[0];
    expect(p.status).toBe('archived');
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, lesson_id: 'L1', status: 'archived' });
  });

  it('500 when the lessons UPDATE returns an error (fail loud, never silent)', async () => {
    LESSON_WRITE_ERROR = { message: 'db down' };
    expect((await (await load())(req({ lesson_id: 'L1', action: 'archive' }))).status).toBe(500);
  });

  it('edit updates only provided fields (title, parsed_content, standards)', async () => {
    const res = await (await load())(req({
      lesson_id: 'L1', action: 'edit',
      title: 'New title', standard_codes: ['CCSS.4.NF.1', 7 as unknown as string],
      standard_framework: 'TEKS', parsed_content: { summary: 's' },
    }));
    expect(res.status).toBe(200);
    const p = lessonUpdates[0];
    expect(p.title).toBe('New title');
    expect(p.standard_codes).toEqual(['CCSS.4.NF.1']); // non-strings filtered
    expect(p.standard_framework).toBe('TEKS');
    // parsed_content is validated through GeneratedLessonSchema — the valid {summary} survives
    // (with the schema's array defaults filled in).
    expect(p.parsed_content).toMatchObject({ summary: 's', proposed_standards: [] });
    expect('status' in p).toBe(false); // edit never touches status
  });

  it('400 + no write when parsed_content fails the lesson-content schema', async () => {
    const res = await (await load())(req({
      lesson_id: 'L1', action: 'edit', title: 'New title',
      parsed_content: { vocabulary: 'nope' }, // wrong shape — vocabulary must be an array
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid lesson content');
    expect(lessonUpdates).toHaveLength(0); // never wrote
  });

  it('edit with nothing to update → 400', async () => {
    expect((await (await load())(req({ lesson_id: 'L1', action: 'edit' }))).status).toBe(400);
  });

  it('edit still enforces guardClassAccess', async () => {
    guardClassAccess.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await (await load())(req({ lesson_id: 'L1', action: 'edit', title: 'x' }))).status).toBe(403);
  });
});
