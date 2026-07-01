// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const guardClassAccess = vi.fn();
const getSparkLink = vi.fn();
const fetchAttemptReview = vi.fn();

let ROLE: string;
let ASSIGNMENT: unknown;
let CLASS: unknown;

vi.mock('@/lib/auth/roles', () => ({ STAFF_ROLES: ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'] as const }));
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess: (...a: unknown[]) => guardClassAccess(...a) }));
vi.mock('@/lib/spark/sparkLink', () => ({ getSparkLink: (...a: unknown[]) => getSparkLink(...a) }));
vi.mock('@/lib/spark/fetchAttemptReview', () => ({ fetchAttemptReview: (...a: unknown[]) => fetchAttemptReview(...a) }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'users') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: ROLE } }) }) }) };
      if (t === 'assignments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ASSIGNMENT }) }) }) };
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: CLASS }) }) }) }; // classes
    },
  }),
}));

const req = (qs: string) => new NextRequest(`http://x/api/teacher/challenges/attempt${qs}`);

beforeEach(() => {
  vi.clearAllMocks();
  ROLE = 'teacher';
  ASSIGNMENT = { id: 'a1', class_id: 'c1', student_id: 's1', spark_status: 'created' };
  CLASS = { school_id: 'sch1' };
  getUser.mockResolvedValue({ data: { user: { id: 't1' } }, error: null });
  guardClassAccess.mockResolvedValue(null);
});

describe('GET /api/teacher/challenges/attempt', () => {
  it('401 when unauthenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import('../route');
    expect((await GET(req('?assignmentId=a1'))).status).toBe(401);
  });

  it('403 when caller is not staff', async () => {
    ROLE = 'student';
    const { GET } = await import('../route');
    expect((await GET(req('?assignmentId=a1'))).status).toBe(403);
  });

  it('400 when assignmentId is missing', async () => {
    const { GET } = await import('../route');
    expect((await GET(req(''))).status).toBe(400);
  });

  it('404 when the assignment is not found', async () => {
    ASSIGNMENT = null;
    const { GET } = await import('../route');
    expect((await GET(req('?assignmentId=a1'))).status).toBe(404);
  });

  it('404 when the assignment has spark_status "none"', async () => {
    ASSIGNMENT = { id: 'a1', class_id: 'c1', student_id: 's1', spark_status: 'none' };
    const { GET } = await import('../route');
    expect((await GET(req('?assignmentId=a1'))).status).toBe(404);
  });

  it('never calls SPARK when the class guard denies (IDOR)', async () => {
    guardClassAccess.mockResolvedValue(new Response('denied', { status: 403 }));
    const { GET } = await import('../route');
    const res = await GET(req('?assignmentId=a1'));
    expect(res.status).toBe(403);
    expect(fetchAttemptReview).not.toHaveBeenCalled();
  });

  it('404 spark_not_enabled when the school has no enabled link', async () => {
    getSparkLink.mockResolvedValue(null);
    const { GET } = await import('../route');
    const res = await GET(req('?assignmentId=a1'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'spark_not_enabled' });
  });

  it('404 not_started when SPARK has no attempt', async () => {
    getSparkLink.mockResolvedValue({ api_key: 'k', enabled: true });
    fetchAttemptReview.mockResolvedValue({ ok: false, reason: 'not_found' });
    const { GET } = await import('../route');
    const res = await GET(req('?assignmentId=a1'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_started' });
  });

  it('502 spark_unreachable on SPARK failure', async () => {
    getSparkLink.mockResolvedValue({ api_key: 'k', enabled: true });
    fetchAttemptReview.mockResolvedValue({ ok: false, reason: 'unreachable' });
    const { GET } = await import('../route');
    const res = await GET(req('?assignmentId=a1'));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'spark_unreachable' });
  });

  it('200 happy path: review + segmentsByStep', async () => {
    getSparkLink.mockResolvedValue({ api_key: 'k', enabled: true });
    fetchAttemptReview.mockResolvedValue({ ok: true, review: {
      attempt: { state: 'completed', startedAt: null, completedAt: null, score: 80,
                 effortLabel: null, revisionCount: 0, teliHintCount: 0 },
      generationStatus: 'ready', steps: null,
      stepResponses: [{ step_index: 1, type: 'prediction', value: { text: 'hi', confidence: 50 }, completed: true }],
      analysis: null,
    }});
    const { GET } = await import('../route');
    const res = await GET(req('?assignmentId=a1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.responseIndexes).toEqual([1]);
    expect(body.segmentsByStep['1'][0]).toEqual({ kind: 'text', label: 'Prediction', text: 'hi' });
    expect(body.review.stepResponses).toBeUndefined();
    expect(fetchAttemptReview).toHaveBeenCalledWith({ apiKey: 'k', coreHomeworkId: 'a1', coreStudentId: 's1' });
  });

  it('a step_index 9999 response lands in segmentsByStep["9999"]', async () => {
    getSparkLink.mockResolvedValue({ api_key: 'k', enabled: true });
    fetchAttemptReview.mockResolvedValue({ ok: true, review: {
      attempt: { state: 'completed', startedAt: null, completedAt: null, score: 80,
                 effortLabel: null, revisionCount: 0, teliHintCount: 0 },
      generationStatus: 'ready', steps: null,
      stepResponses: [{ step_index: 9999, type: 'reflection', value: { prompts: ['Q'], responses: { 0: 'A' } }, completed: true }],
      analysis: null,
    }});
    const { GET } = await import('../route');
    const res = await GET(req('?assignmentId=a1'));
    const body = await res.json();
    expect(body.segmentsByStep['9999']).toEqual([{ kind: 'text', label: 'Q', text: 'A' }]);
  });
});
