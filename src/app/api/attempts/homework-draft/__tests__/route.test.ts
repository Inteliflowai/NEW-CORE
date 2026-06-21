// src/app/api/attempts/homework-draft/__tests__/route.test.ts
// Tests for PUT/GET /api/attempts/homework-draft (assignment autosave).
//
// Node environment (pure HTTP handler test). Both supabase clients are mocked
// inline; the admin client returns a controllable homework_attempts row and
// records the update payload so the write is asserted. Covers the four PUT
// cases the plan specifies (401 auth, 404 ownership, 409 wrong status, 200
// happy) plus the GET happy/404 paths.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const updates: Array<Record<string, unknown>> = [];

// ATTEMPT is the row the admin client resolves for ownership lookups.
// `null` simulates "not owned / not found". Mutated per-test.
let ATTEMPT: unknown;
// SELECTED is what a plain select(...).maybeSingle() returns (the GET path).
let SELECTED: unknown;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: () => ({
      // ownership lookup: select(...).eq().eq().maybeSingle()  → ATTEMPT
      // GET lookup:       select(...).eq().eq().maybeSingle()  → SELECTED
      select: (cols: string) => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: cols.includes('status') ? ATTEMPT : SELECTED,
              error: null,
            }),
          }),
        }),
      }),
      // update(payload).eq().eq() resolves { error: null }
      update: (payload: Record<string, unknown>) => {
        updates.push(payload);
        return { eq: () => ({ eq: async () => ({ error: null }) }) };
      },
    }),
  }),
}));

async function load() {
  vi.resetModules();
  return await import('@/app/api/attempts/homework-draft/route');
}

const RESPONSES = { tasks: { '1': { text: 'a draft answer', image_url: null } } };
const putReq = (b: unknown) =>
  new Request('http://x/api/attempts/homework-draft', { method: 'PUT', body: JSON.stringify(b) });
const getReq = (attemptId?: string) =>
  new Request(`http://x/api/attempts/homework-draft${attemptId ? `?attempt_id=${attemptId}` : ''}`);

beforeEach(() => {
  getUser.mockReset();
  updates.length = 0;
  ATTEMPT = { id: 'att1', student_id: 'u1', status: 'in_progress' };
  SELECTED = { responses: RESPONSES };
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
});

describe('PUT /api/attempts/homework-draft', () => {
  it('401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { PUT } = await load();
    expect((await PUT(putReq({ attempt_id: 'att1', responses: RESPONSES }))).status).toBe(401);
  });

  it('400 when attempt_id or responses are missing', async () => {
    const { PUT } = await load();
    expect((await PUT(putReq({ responses: RESPONSES }))).status).toBe(400);
    expect((await PUT(putReq({ attempt_id: 'att1' }))).status).toBe(400);
  });

  it('404 when the attempt is not owned by the user', async () => {
    ATTEMPT = null;
    const { PUT } = await load();
    expect((await PUT(putReq({ attempt_id: 'att1', responses: RESPONSES }))).status).toBe(404);
  });

  it('409 when the attempt is not in_progress', async () => {
    ATTEMPT = { id: 'att1', student_id: 'u1', status: 'graded' };
    const { PUT } = await load();
    expect((await PUT(putReq({ attempt_id: 'att1', responses: RESPONSES }))).status).toBe(409);
  });

  it('200 and persists responses on the happy path', async () => {
    const { PUT } = await load();
    const res = await PUT(putReq({ attempt_id: 'att1', responses: RESPONSES }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].responses).toEqual(RESPONSES);
  });
});

describe('GET /api/attempts/homework-draft', () => {
  it('401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await load();
    expect((await GET(getReq('att1'))).status).toBe(401);
  });

  it('400 without attempt_id', async () => {
    const { GET } = await load();
    expect((await GET(getReq())).status).toBe(400);
  });

  it('404 when the attempt is not found / not owned', async () => {
    SELECTED = null;
    const { GET } = await load();
    expect((await GET(getReq('att1'))).status).toBe(404);
  });

  it('200 returns the stored responses', async () => {
    const { GET } = await load();
    const res = await GET(getReq('att1'));
    expect(res.status).toBe(200);
    expect((await res.json()).responses).toEqual(RESPONSES);
  });
});
