import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const guardClassAccess = vi.fn();
const generateHighFiveDraftMock = vi.fn();
let ROLE: string;
let ENROLLED: unknown;
let STUDENT: unknown;

vi.mock('@/lib/auth/roles', () => ({
  STAFF_ROLES: ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'] as const,
}));
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess }));
vi.mock('@/lib/highfives/generateDraft', () => ({ generateHighFiveDraft: generateHighFiveDraftMock }));
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
      if (t === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: STUDENT }),
            }),
          }),
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
  return (await import('@/app/api/teacher/high-fives/draft/route')).POST;
}

beforeEach(() => {
  getUser.mockReset();
  guardClassAccess.mockReset();
  generateHighFiveDraftMock.mockReset();
  ROLE = 'teacher';
  ENROLLED = { student_id: 's1' };
  STUDENT = { full_name: 'Ann Lee' };
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  guardClassAccess.mockResolvedValue(null); // access granted
  generateHighFiveDraftMock.mockResolvedValue({ draft_text: 'Ann, you worked through the fraction problems step by step.', source: 'ai' });
});

describe('POST /api/teacher/high-fives/draft', () => {
  it('401 when no user', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await (await load())(req({ student_id: 's1', class_id: 'c1' }));
    expect(res.status).toBe(401);
  });

  it('403 for a non-staff role', async () => {
    ROLE = 'student';
    const res = await (await load())(req({ student_id: 's1', class_id: 'c1' }));
    expect(res.status).toBe(403);
  });

  it('400 when student_id is missing', async () => {
    const res = await (await load())(req({ class_id: 'c1' }));
    expect(res.status).toBe(400);
  });

  it('400 when class_id is missing', async () => {
    const res = await (await load())(req({ student_id: 's1' }));
    expect(res.status).toBe(400);
  });

  it('403 when guardClassAccess denies (cross-teacher IDOR)', async () => {
    guardClassAccess.mockResolvedValue(new Response(null, { status: 403 }));
    const res = await (await load())(req({ student_id: 's1', class_id: 'c1' }));
    expect(res.status).toBe(403);
  });

  it('403 when student is not enrolled in the class', async () => {
    ENROLLED = null;
    const res = await (await load())(req({ student_id: 's1', class_id: 'c1' }));
    expect(res.status).toBe(403);
  });

  it('happy path returns { draft_text, source }', async () => {
    const res = await (await load())(req({ student_id: 's1', class_id: 'c1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft_text).toContain('Ann');
    expect(body.source).toBe('ai');
  });

  it('passes reason_hint and context_hint to generateHighFiveDraft', async () => {
    await (await load())(req({ student_id: 's1', class_id: 'c1', reason_hint: 'stretch', context_hint: 'Ready for more.' }));
    expect(generateHighFiveDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({ reasonHint: 'stretch', contextHint: 'Ready for more.' }),
    );
  });
});
