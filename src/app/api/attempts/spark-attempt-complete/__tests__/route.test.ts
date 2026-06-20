import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const SECRET = 'spark-core-secret-2026';

function makeRequest(
  body: Record<string, unknown>,
  { auth = `Bearer ${SECRET}`, key = 'hw-1_stu-1' }: { auth?: string | null; key?: string } = {},
): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) headers['Authorization'] = auth;
  headers['X-Idempotency-Key'] = key;
  return new NextRequest('http://localhost/api/attempts/spark-attempt-complete', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
}

function makeChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'insert', 'update', 'upsert', 'in', 'neq', 'lt', 'not']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain['maybeSingle'] = vi.fn().mockResolvedValue({ data, error });
  chain['single'] = vi.fn().mockResolvedValue({ data, error });
  chain['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve);
  return chain;
}

const recomputeSpy = vi.fn().mockResolvedValue({ ok: true, skillsRecomputed: 1, states: {} });
vi.mock('@/lib/skills/recomputeSkillStates', () => ({
  recomputeSkillStatesForStudent: (...a: unknown[]) => recomputeSpy(...a),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
}));

beforeEach(() => {
  process.env.CORE_SPARK_API_SECRET = SECRET;
  recomputeSpy.mockClear();
  vi.resetModules();
});

/** Admin mock with per-table chains + a mutable idempotency "store" for the claim path. */
function makeAdminMock(opts: {
  assignment?: unknown;
  idemClaimError?: unknown;       // error returned by the initial INSERT (e.g. 23505)
  existingIdem?: unknown;          // row returned when reading an existing key
} = {}) {
  const assignmentChain = makeChain(opts.assignment ?? { id: 'hw-1', student_id: 'stu-1', class_id: 'cls-1', skill_ids: ['sk-1'] });
  const userChain = makeChain({ school_id: 'sch-1' });
  const idemInsertChain = makeChain(null, opts.idemClaimError ?? null);
  const idemReadChain = makeChain(opts.existingIdem ?? null);
  const completionsChain = makeChain(null);
  const eventsChain = makeChain(null);
  const idemUpdateChain = makeChain(null);

  return {
    from: vi.fn((table: string) => {
      if (table === 'assignments') return assignmentChain;
      if (table === 'users') return userChain;
      if (table === 'spark_completions') return completionsChain;
      if (table === 'platform_events') return eventsChain;
      if (table === 'webhook_idempotency_keys') {
        // First call in the route is .insert (claim); later .select (read) / .update (finalize).
        return {
          insert: vi.fn().mockReturnValue(idemInsertChain),
          select: idemReadChain.select,
          eq: idemReadChain.eq,
          maybeSingle: idemReadChain.maybeSingle,
          update: vi.fn().mockReturnValue(idemUpdateChain),
        };
      }
      return makeChain(null);
    }),
  };
}

async function loadRoute(admin: unknown) {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
  vi.mocked(createAdminSupabaseClient).mockReturnValue(admin as never);
  return (await import('@/app/api/attempts/spark-attempt-complete/route')).POST;
}

describe('POST /api/attempts/spark-attempt-complete', () => {
  it('401 on bad/missing Bearer', async () => {
    const POST = await loadRoute(makeAdminMock());
    const res = await POST(makeRequest({ core_homework_id: 'hw-1', student_id: 'stu-1' }, { auth: 'Bearer wrong' }));
    expect(res.status).toBe(401);
    expect(recomputeSpy).not.toHaveBeenCalled();
  });

  it('400 when core_homework_id or student_id is missing', async () => {
    const POST = await loadRoute(makeAdminMock());
    const res = await POST(makeRequest({ student_id: 'stu-1' }));
    expect(res.status).toBe(400);
  });

  it('first valid call writes + 200 {ok,received}; recompute runs with the assignment skills', async () => {
    const POST = await loadRoute(makeAdminMock());
    const res = await POST(makeRequest({
      core_homework_id: 'hw-1', student_id: 'stu-1', completed_at: '2026-06-20T00:00:00Z',
      rubric_dimensions: { problem_understanding: 4, reasoning_strategy: 4, use_of_evidence: 3, creativity_application: 4, communication: 3, reflection_metacognition: 3, collaboration: null },
      content_quality: 'engaged', score: null,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, received: true });
    expect(recomputeSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ studentId: 'stu-1', skillIds: ['sk-1'] }),
    );
  });

  it('replay (key already completed) returns the stored response, deduped — no reprocess', async () => {
    const admin = makeAdminMock({
      idemClaimError: { code: '23505', message: 'duplicate key' },
      existingIdem: { status: 'completed', response_body: { ok: true, received: true } },
    });
    const POST = await loadRoute(admin);
    const res = await POST(makeRequest({ core_homework_id: 'hw-1', student_id: 'stu-1' }));
    expect(res.status).toBe(200);
    expect(recomputeSpy).not.toHaveBeenCalled();
  });

  it('unknown/mismatched assignment → 200 ignored (never 5xx), no recompute', async () => {
    const admin = makeAdminMock({ assignment: { id: 'hw-1', student_id: 'OTHER', class_id: 'c', skill_ids: [] } });
    const POST = await loadRoute(admin);
    const res = await POST(makeRequest({ core_homework_id: 'hw-1', student_id: 'stu-1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(recomputeSpy).not.toHaveBeenCalled();
  });
});
