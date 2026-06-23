// src/app/api/teacher/gradebook/attempt/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const guardClassAccess = vi.fn();
let ROLE: string; let ATTEMPT: unknown; let ASSIGNMENT: unknown;

vi.mock('@/lib/auth/roles', () => ({ STAFF_ROLES: ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'] as const }));
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'users') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: ROLE } }) }) }) };
      if (t === 'homework_attempts') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ATTEMPT }) }) }) };
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ASSIGNMENT }) }) }) }; // assignments
    },
  }),
}));

const req = (q: string) => new NextRequest(`http://x/api/teacher/gradebook/attempt?${q}`);

beforeEach(() => {
  getUser.mockReset(); guardClassAccess.mockReset(); ROLE = 'teacher';
  ATTEMPT = { id: 'A1', assignment_id: 'AS1', responses: { tasks: { '1': { text: 'my answer', image_url: '/api/attempts/drawing?path=stu1%2FA1%2Ftask-1-1.png' } } }, ai_feedback: { overall: 'Nice reasoning.' }, status: 'graded' };
  ASSIGNMENT = { id: 'AS1', class_id: 'c1', content: { tasks: [{ step: 1, description: 'Explain Newton 1.' }] } };
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  guardClassAccess.mockResolvedValue(null);
});

describe('GET /api/teacher/gradebook/attempt', () => {
  it('401 / 403 / 400 gates', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import('@/app/api/teacher/gradebook/attempt/route');
    expect((await GET(req('attemptId=A1'))).status).toBe(401);
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }); ROLE = 'student';
    expect((await GET(req('attemptId=A1'))).status).toBe(403);
    ROLE = 'teacher';
    expect((await GET(req(''))).status).toBe(400);
  });
  it('403 when guardClassAccess denies', async () => {
    guardClassAccess.mockResolvedValue(new Response(null, { status: 403 }));
    const { GET } = await import('@/app/api/teacher/gradebook/attempt/route');
    expect((await GET(req('attemptId=A1'))).status).toBe(403);
  });
  it('returns tasks + responses + ai_feedback for an authorized teacher', async () => {
    const { GET } = await import('@/app/api/teacher/gradebook/attempt/route');
    const res = await GET(req('attemptId=A1'));
    expect(res.status).toBe(200);
    expect(guardClassAccess).toHaveBeenCalledWith('c1');
    const body = await res.json();
    expect(body.tasks[0].description).toMatch(/Newton/);
    expect(body.responses.tasks['1'].text).toBe('my answer');
    expect(body.ai_feedback.overall).toMatch(/reasoning/);
  });
  it('404 when the attempt is missing', async () => {
    ATTEMPT = null;
    const { GET } = await import('@/app/api/teacher/gradebook/attempt/route');
    expect((await GET(req('attemptId=A1'))).status).toBe(404);
  });
});
