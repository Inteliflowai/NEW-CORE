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
  const completionsUpsertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
  const completionsChain = { ...makeChain(null), upsert: completionsUpsertSpy };
  const eventsChain = makeChain(null);
  const idemUpdateSpy = vi.fn().mockReturnValue(makeChain(null));
  const idemUpdateChain = makeChain(null);

  const mock = {
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
          update: idemUpdateSpy,
        };
      }
      return makeChain(null);
    }),
    // Exposed spies for assertions
    _completionsUpsertSpy: completionsUpsertSpy,
    _idemUpdateSpy: idemUpdateSpy,
    _idemUpdateChain: idemUpdateChain,
  };
  return mock;
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

  it('submit-then-analyzer: second POST with distinct key overwrites same row (upsert called twice, second payload has rubric + transfer_score)', async () => {
    const rubric = {
      problem_understanding: 4,
      reasoning_strategy: 4,
      use_of_evidence: 3,
      creativity_application: 4,
      communication: 3,
      reflection_metacognition: 3,
      collaboration: null,
    };

    // --- First fire: submit-time (no rubric, no score) ---
    const admin1 = makeAdminMock();
    const POST1 = await loadRoute(admin1);
    const res1 = await POST1(
      makeRequest(
        { core_homework_id: 'hw-1', student_id: 'stu-1', rubric_dimensions: null, content_quality: null, score: null },
        { key: 'hw-1_stu-1' },
      ),
    );
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1).toMatchObject({ ok: true, received: true });

    // upsert was called with rubric_dimensions:null and transfer_score:null
    expect(admin1._completionsUpsertSpy).toHaveBeenCalledOnce();
    const firstUpsertPayload = admin1._completionsUpsertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(firstUpsertPayload.rubric_dimensions).toBeNull();
    expect(firstUpsertPayload.transfer_score).toBeNull();
    // onConflict target is correct
    expect(admin1._completionsUpsertSpy.mock.calls[0][1]).toMatchObject({ onConflict: 'assignment_id,student_id' });

    // --- Second fire: analyzer pass (distinct key → not deduped; full rubric + content_quality) ---
    // resetModules happened in beforeEach; we need to reset again between the two loads
    vi.resetModules();
    recomputeSpy.mockClear();

    const admin2 = makeAdminMock();
    const POST2 = await loadRoute(admin2);
    const res2 = await POST2(
      makeRequest(
        { core_homework_id: 'hw-1', student_id: 'stu-1', rubric_dimensions: rubric, content_quality: 'engaged', score: null },
        { key: 'hw-1_stu-1_scored' },
      ),
    );
    expect(res2.status).toBe(200);

    // upsert was called again; second payload carries rubric + a numeric transfer_score
    expect(admin2._completionsUpsertSpy).toHaveBeenCalledOnce();
    const secondUpsertPayload = admin2._completionsUpsertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(secondUpsertPayload.rubric_dimensions).toEqual(rubric);
    expect(typeof secondUpsertPayload.transfer_score).toBe('number');
    expect(secondUpsertPayload.transfer_score as number).toBeGreaterThan(0);
    expect(secondUpsertPayload.transfer_score as number).toBeCloseTo(88, -1); // ≈88 (within ±10)
    expect(admin2._completionsUpsertSpy.mock.calls[0][1]).toMatchObject({ onConflict: 'assignment_id,student_id' });

    // recompute ran for the analyzer fire
    expect(recomputeSpy).toHaveBeenCalledOnce();
  });

  it('finalize("failed") is called when assignment is unknown/mismatched', async () => {
    const admin = makeAdminMock({ assignment: { id: 'hw-1', student_id: 'OTHER', class_id: 'c', skill_ids: [] } });
    const POST = await loadRoute(admin);
    const res = await POST(makeRequest({ core_homework_id: 'hw-1', student_id: 'stu-1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(recomputeSpy).not.toHaveBeenCalled();

    // finalize('failed') must have updated the idempotency row with status:'failed'
    expect(admin._idemUpdateSpy).toHaveBeenCalledOnce();
    const updateArg = admin._idemUpdateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.status).toBe('failed');
  });

  it('non-23505 claim error proceeds best-effort: recompute still runs, returns 200', async () => {
    const admin = makeAdminMock({ idemClaimError: { code: 'XXYYZ', message: 'transient error' } });
    const POST = await loadRoute(admin);
    const res = await POST(
      makeRequest({ core_homework_id: 'hw-1', student_id: 'stu-1', completed_at: '2026-06-20T00:00:00Z' }),
    );
    expect(res.status).toBe(200);
    // recompute ran once (best-effort processing proceeded)
    expect(recomputeSpy).toHaveBeenCalledOnce();
  });
});
