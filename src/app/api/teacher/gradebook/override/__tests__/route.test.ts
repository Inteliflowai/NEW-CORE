import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const guardClassAccess = vi.fn();
const recompute = vi.fn().mockResolvedValue(undefined);
const updates: Array<Record<string, unknown>> = [];
let ATTEMPT: unknown; let ROLE: string; let ASG: unknown;
let WRITE_ERROR: unknown; // when set, the homework_attempts UPDATE resolves with this .error

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (cb: () => void) => { void Promise.resolve().then(cb); } }));
// Mirror the canonical STAFF_ROLES (src/lib/auth/roles.ts) EXACTLY — it is an array of
// the real role strings ('school_sysadmin', not 'sysadmin'); the route wraps it in a Set.
vi.mock('@/lib/auth/roles', () => ({ STAFF_ROLES: ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'] as const }));
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess }));
vi.mock('@/lib/skills/recomputeSkillStates', () => ({ recomputeSkillStatesForStudent: recompute }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'users') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: ROLE } }) }) }) };
      if (t === 'assignments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ASG }) }) }) };
      return { // homework_attempts
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ATTEMPT }) }) }),
        update: (p: Record<string, unknown>) => { updates.push(p); return { eq: async () => ({ error: WRITE_ERROR }) }; },
      };
    },
  }),
}));

const req = (b: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(b) });
async function load() { vi.resetModules(); return (await import('@/app/api/teacher/gradebook/override/route')).POST; }

beforeEach(() => {
  getUser.mockReset(); guardClassAccess.mockReset(); recompute.mockClear(); updates.length = 0;
  ROLE = 'teacher'; ASG = { class_id: 'c1' }; WRITE_ERROR = null;
  ATTEMPT = { id: 'h1', assignment_id: 'a1', student_id: 's1', status: 'graded', score_pct: 70, teacher_score: null };
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  guardClassAccess.mockResolvedValue(null); // access granted
});

describe('POST /api/teacher/gradebook/override', () => {
  it('401 without a user', async () => { getUser.mockResolvedValue({ data: { user: null } }); expect((await (await load())(req({ attempt_id: 'h1', teacher_score: 90 }))).status).toBe(401); });
  it('403 for a non-staff role', async () => { ROLE = 'student'; expect((await (await load())(req({ attempt_id: 'h1', teacher_score: 90 }))).status).toBe(403); });
  it('403 when guardClassAccess denies (cross-teacher IDOR)', async () => { guardClassAccess.mockResolvedValue(new Response(null, { status: 403 })); expect((await (await load())(req({ attempt_id: 'h1', teacher_score: 90 }))).status).toBe(403); });
  it('404 when the attempt is not found', async () => { ATTEMPT = null; expect((await (await load())(req({ attempt_id: 'h1', teacher_score: 90 }))).status).toBe(404); });
  it('400 on a score out of [0,100]', async () => { expect((await (await load())(req({ attempt_id: 'h1', teacher_score: 150 }))).status).toBe(400); });
  it('400 on an empty body (no fields)', async () => { expect((await (await load())(req({ attempt_id: 'h1' }))).status).toBe(400); });
  it('409 when a GRADE override targets a non-graded attempt', async () => { ATTEMPT = { id: 'h1', assignment_id: 'a1', student_id: 's1', status: 'in_progress', score_pct: null, teacher_score: null }; expect((await (await load())(req({ attempt_id: 'h1', teacher_score: 90 }))).status).toBe(409); });
  it('allows allow_redo on a non-graded attempt (no 409)', async () => { ATTEMPT = { id: 'h1', assignment_id: 'a1', student_id: 's1', status: 'in_progress', score_pct: null, teacher_score: null }; expect((await (await load())(req({ attempt_id: 'h1', allow_redo: true }))).status).toBe(200); });
  it('writes teacher_score, never touches score_pct or status, returns displayed_grade', async () => {
    const res = await (await load())(req({ attempt_id: 'h1', teacher_score: 90, teacher_notes: 'nice work' }));
    expect(res.status).toBe(200);
    expect((await res.json()).displayed_grade).toBe(90);
    const p = updates[0];
    expect(p.teacher_score).toBe(90); expect(p.teacher_notes).toBe('nice work');
    expect('score_pct' in p).toBe(false); expect('status' in p).toBe(false);
  });
  it('clearing sets teacher_score=null → displayed_grade falls back to score_pct', async () => {
    const res = await (await load())(req({ attempt_id: 'h1', teacher_score: null }));
    expect((await res.json()).displayed_grade).toBe(70);
    expect(updates[0].teacher_score).toBeNull();
  });
  it('400 on teacher_notes over the length bound', async () => { expect((await (await load())(req({ attempt_id: 'h1', teacher_notes: 'x'.repeat(2001) }))).status).toBe(400); });

  // I1 — the write error must NOT be swallowed (silent grade-write failure → false success).
  it('500 when the homework_attempts UPDATE returns an error (fail loud, never silent)', async () => {
    WRITE_ERROR = { message: 'db down' };
    expect((await (await load())(req({ attempt_id: 'h1', teacher_score: 90 }))).status).toBe(500);
  });

  // I1 — allow_redo must be a boolean (type guard alongside score/notes validation).
  it('400 when allow_redo is not a boolean', async () => {
    expect((await (await load())(req({ attempt_id: 'h1', allow_redo: 'yes' }))).status).toBe(400);
  });
});
