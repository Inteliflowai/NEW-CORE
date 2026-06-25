// src/app/api/teacher/gradebook/override/__tests__/audit.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const logAudit = vi.fn();
vi.mock('@/lib/audit/logAudit', () => ({ logAudit: (...a: unknown[]) => logAudit(...a) }));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (cb: () => void) => { void Promise.resolve().then(cb); } }));
vi.mock('@/lib/auth/roles', () => ({ STAFF_ROLES: ['teacher','school_admin','school_sysadmin','platform_admin'] }));
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess: async () => null }));
vi.mock('@/lib/skills/recomputeSkillStates', () => ({ recomputeSkillStatesForStudent: async () => {} }));
const getUser = vi.fn();
const attemptsUpdate = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'users') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'teacher' } }) }) }) };
      if (t === 'homework_attempts') return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'a1', assignment_id: 'asg1', student_id: 'stu1', status: 'graded', score_pct: 70, teacher_score: null } }) }) }),
        update: (patch: unknown) => { attemptsUpdate(patch); return { eq: async () => ({ error: null }) }; },
      };
      // assignments has class_id ONLY (no school_id column — verified 0004); school_id is on classes.
      if (t === 'assignments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { class_id: 'c1' } }) }) }) };
      if (t === 'classes') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { school_id: 'sch1' } }) }) }) };
      return {};
    },
  }),
}));

const req = (b: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(b) });
beforeEach(() => { logAudit.mockReset(); attemptsUpdate.mockReset(); getUser.mockResolvedValue({ data: { user: { id: 'u1' } } }); });

describe('grade override audit', () => {
  it('logs grade.override with before/after on a successful override', async () => {
    const { POST } = await import('@/app/api/teacher/gradebook/override/route');
    const res = await POST(req({ attempt_id: 'a1', teacher_score: 88 }));
    expect(res.status).toBe(200);
    expect(logAudit).toHaveBeenCalledTimes(1);
    const [, entry] = logAudit.mock.calls[0];
    expect(entry).toMatchObject({ actorId: 'u1', schoolId: 'sch1', action: 'grade.override', resourceType: 'homework_attempt', resourceId: 'a1' });
    expect(entry.metadata.before.teacher_score).toBeNull();
    expect(entry.metadata.after.teacher_score).toBe(88);
  });

  it('still returns 200 + writes the grade even if logAudit rejects (never-fatal)', async () => {
    logAudit.mockRejectedValueOnce(new Error('audit down'));
    const { POST } = await import('@/app/api/teacher/gradebook/override/route');
    const res = await POST(req({ attempt_id: 'a1', teacher_score: 88 }));
    expect(res.status).toBe(200); // a logging failure must never break the override
    // Grade write must have happened even though audit failed
    expect(attemptsUpdate).toHaveBeenCalledWith(expect.objectContaining({ teacher_score: 88 }));
    const body = await res.json() as { ok: boolean; attempt_id: string; displayed_grade: number };
    expect(body.displayed_grade).toBe(88);
  });
});
