import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const guardClassAccess = vi.fn();
let ROLE: string;
let ENROLLED: unknown;
let CLASS_ROW: unknown;
let INSERT_RESULT: unknown;
const inserts: Array<Record<string, unknown>> = [];

vi.mock('@/lib/auth/roles', () => ({
  STAFF_ROLES: ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'] as const,
}));
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser },
    from: (t: string) => {
      if (t === 'users') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { role: ROLE } }) }) }) };
      }
      return {};
    },
  }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'enrollments') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: ENROLLED }),
              }),
            }),
          }),
        };
      }
      if (t === 'classes') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: CLASS_ROW }),
            }),
          }),
        };
      }
      if (t === 'high_fives') {
        return {
          insert: (payload: Record<string, unknown>) => {
            inserts.push(payload);
            return {
              select: () => ({
                single: async () => INSERT_RESULT,
              }),
            };
          },
        };
      }
      return {};
    },
  }),
}));

const req = (b: unknown) =>
  new Request('http://x', { method: 'POST', body: JSON.stringify(b) });

async function load() {
  vi.resetModules();
  return (await import('@/app/api/teacher/high-fives/send/route')).POST;
}

const VALID_BODY = {
  student_id: 's1',
  class_id: 'c1',
  text: 'Ann, you stuck with the fraction problems even when they were tricky.',
};

beforeEach(() => {
  getUser.mockReset();
  guardClassAccess.mockReset();
  inserts.length = 0;
  ROLE = 'teacher';
  ENROLLED = { student_id: 's1' };
  CLASS_ROW = { school_id: 'school1' };
  INSERT_RESULT = { data: { id: 'hf1' }, error: null };
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  guardClassAccess.mockResolvedValue(null); // access granted
});

describe('POST /api/teacher/high-fives/send', () => {
  it('401 when no user', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await (await load())(req(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it('403 for a non-staff role', async () => {
    ROLE = 'student';
    const res = await (await load())(req(VALID_BODY));
    expect(res.status).toBe(403);
  });

  it('400 when student_id is missing', async () => {
    const res = await (await load())(req({ class_id: 'c1', text: 'Ann, good effort.' }));
    expect(res.status).toBe(400);
  });

  it('400 when class_id is missing', async () => {
    const res = await (await load())(req({ student_id: 's1', text: 'Ann, good effort.' }));
    expect(res.status).toBe(400);
  });

  it('400 when text is empty', async () => {
    const res = await (await load())(req({ student_id: 's1', class_id: 'c1', text: '' }));
    expect(res.status).toBe(400);
  });

  it('400 when text exceeds 600 chars', async () => {
    const longText = 'A'.repeat(601);
    const res = await (await load())(req({ student_id: 's1', class_id: 'c1', text: longText }));
    expect(res.status).toBe(400);
  });

  it('422 with { violations } when validateHighFive fails, no insert', async () => {
    const res = await (await load())(req({ ...VALID_BODY, text: 'Great job!! Amazing work!' }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.violations).toBeDefined();
    expect(body.violations.length).toBeGreaterThan(0);
    expect(inserts.length).toBe(0); // must NOT insert
  });

  it('403 when guardClassAccess denies (cross-teacher IDOR)', async () => {
    guardClassAccess.mockResolvedValue(new Response(null, { status: 403 }));
    const res = await (await load())(req(VALID_BODY));
    expect(res.status).toBe(403);
  });

  it('403 when student is not enrolled in the class', async () => {
    ENROLLED = null;
    const res = await (await load())(req(VALID_BODY));
    expect(res.status).toBe(403);
  });

  it('happy path inserts a high_fives row and returns { ok: true, id }', async () => {
    const res = await (await load())(req(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBe('hf1');
    expect(inserts.length).toBe(1);
    expect(inserts[0]).toMatchObject({
      school_id: 'school1',
      class_id: 'c1',
      student_id: 's1',
      author_id: 'u1',
    });
  });

  it('happy path inserts ai_drafted=true when specified', async () => {
    const res = await (await load())(req({ ...VALID_BODY, ai_drafted: true }));
    expect(res.status).toBe(200);
    expect(inserts[0].ai_drafted).toBe(true);
  });

  it('500 when the insert returns an error', async () => {
    INSERT_RESULT = { data: null, error: { message: 'db down' } };
    const res = await (await load())(req(VALID_BODY));
    expect(res.status).toBe(500);
  });
});
