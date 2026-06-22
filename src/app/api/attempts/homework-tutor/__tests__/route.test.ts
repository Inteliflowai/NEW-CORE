// src/app/api/attempts/homework-tutor/__tests__/route.test.ts
// Tests for POST /api/attempts/homework-tutor (Teli's tutor route).
//
// Node environment (pure HTTP handler test). Mocks: both supabase clients +
// generateGuardedHint (returns a fixed SAFE string so the route's persistence + ladder
// math are under test, not the LLM). The server is authoritative for the rung/count.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── generateGuardedHint mock — returns a fixed safe string ───────────────────
const generateGuardedHint = vi.fn();
vi.mock('@/lib/teli/generateHint', () => ({ generateGuardedHint }));

const getUser = vi.fn();
// Captured supabase side-effects, asserted per test.
const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
const rpcCalls: Array<{ fn: string; args: unknown }> = [];
const sessionUpdates: Array<Record<string, unknown>> = [];

// Scriptable per-test state.
let ATTEMPT: unknown; // homework_attempts ownership-load result
let ASSIGNMENT_CONTENT: unknown; // assignments.content
let ACTIVE_SESSION: unknown; // tutor_sessions active-lookup result (null → create)
let CREATE_RESULT: { data: unknown; error: unknown }; // tutor_sessions insert result (create path)
let HELP_COUNT: number; // count returned by the head:true count query

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    rpc: async (fn: string, args: unknown) => { rpcCalls.push({ fn, args }); return { data: null, error: null }; },
    from: (t: string) => {
      if (t === 'homework_attempts') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ATTEMPT, error: null }) }) }) }) };
      }
      if (t === 'assignments') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { content: ASSIGNMENT_CONTENT }, error: null }) }) }) };
      }
      if (t === 'tutor_sessions') {
        return {
          // active-session lookup: .select().eq().eq().eq().maybeSingle()
          select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ACTIVE_SESSION, error: null }) }) }) }) }),
          // create: .insert().select().maybeSingle() — scriptable result for the create path.
          insert: () => ({ select: () => ({ maybeSingle: async () => CREATE_RESULT }) }),
          // free-turn touch: .update().eq()
          update: (payload: Record<string, unknown>) => { sessionUpdates.push(payload); return { eq: async () => ({ error: null }) }; },
        };
      }
      if (t === 'tutor_messages') {
        return {
          insert: (payload: Record<string, unknown>) => { inserts.push({ table: 'tutor_messages', payload }); return Promise.resolve({ data: null, error: null }); },
          // count query: .select('id',{count,head}).eq().eq().eq().eq() → { count }
          select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ count: HELP_COUNT, error: null }) }) }) }) }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    },
  }),
}));

const req = (b: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(b) });
const helpBody = { attempt_id: 'att1', task_step: 1, student_message: 'help', is_help_request: true };
const askBody = { attempt_id: 'att1', task_step: 1, student_message: 'what does this mean?', is_help_request: false };

async function load() { vi.resetModules(); return (await import('@/app/api/attempts/homework-tutor/route')).POST; }

beforeEach(() => {
  getUser.mockReset(); generateGuardedHint.mockReset();
  inserts.length = 0; rpcCalls.length = 0; sessionUpdates.length = 0;
  ATTEMPT = { id: 'att1', student_id: 'u1', assignment_id: 'a1', status: 'in_progress' };
  ASSIGNMENT_CONTENT = { title: 'X', tasks: [{ step: 1, description: 'Explain why ice floats.' }] };
  ACTIVE_SESSION = { id: 'sess1', hint_count: 0, help_request_count: 0 };
  CREATE_RESULT = { data: { id: 'sess1' }, error: null };
  HELP_COUNT = 1; // first help pull: the just-inserted student row makes count = 1
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  generateGuardedHint.mockResolvedValue("Let's look at what changes when water freezes — what do you notice?");
});

describe('POST /api/attempts/homework-tutor', () => {
  it('401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await (await load())(req(helpBody))).status).toBe(401);
  });

  it('404 when the attempt is not owned by the user', async () => {
    ATTEMPT = null;
    expect((await (await load())(req(helpBody))).status).toBe(404);
  });

  it('409 when the attempt is already graded', async () => {
    ATTEMPT = { id: 'att1', student_id: 'u1', assignment_id: 'a1', status: 'graded' };
    expect((await (await load())(req(helpBody))).status).toBe(409);
  });

  it('first help pull → nudge / 2 remaining, persists both rows, bumps the session', async () => {
    HELP_COUNT = 1; // priorHelpCount = 0
    const res = await (await load())(req(helpBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hint_rung).toBe('nudge');
    expect(json.hints_remaining).toBe(2);
    expect(json.reply).toContain('what changes when water freezes');

    // student row: is_help_request true; teli row: is_help_request false + hint_rung nudge.
    const student = inserts.find(i => (i.payload as { role?: string }).role === 'student');
    const teli = inserts.find(i => (i.payload as { role?: string }).role === 'teli');
    expect(student).toBeDefined();
    expect((student!.payload as { is_help_request?: boolean }).is_help_request).toBe(true);
    expect(teli).toBeDefined();
    expect((teli!.payload as { is_help_request?: boolean }).is_help_request).toBe(false);
    expect((teli!.payload as { hint_rung?: string }).hint_rung).toBe('nudge');

    // counters bumped atomically on a help turn.
    expect(rpcCalls.some(c => c.fn === 'bump_tutor_session')).toBe(true);
  });

  it('second help pull (count→2) → cue / 1 remaining', async () => {
    HELP_COUNT = 2; // priorHelpCount = 1
    const res = await (await load())(req(helpBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hint_rung).toBe('cue');
    expect(json.hints_remaining).toBe(1);
  });

  it('free question (is_help_request:false) → null rung/remaining, NO rpc, rows persisted is_help_request:false', async () => {
    const res = await (await load())(req(askBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hint_rung).toBeNull();
    expect(json.hints_remaining).toBeNull();

    // rpc never called for a free turn.
    expect(rpcCalls.some(c => c.fn === 'bump_tutor_session')).toBe(false);
    // session merely touched (last_activity_at).
    expect(sessionUpdates.length).toBeGreaterThan(0);

    // both persisted rows carry is_help_request:false (free turn never counts).
    const student = inserts.find(i => (i.payload as { role?: string }).role === 'student');
    const teli = inserts.find(i => (i.payload as { role?: string }).role === 'teli');
    expect((student!.payload as { is_help_request?: boolean }).is_help_request).toBe(false);
    expect((teli!.payload as { is_help_request?: boolean }).is_help_request).toBe(false);
  });

  it("passes the student's in-progress task answer to Teli as studentResponse", async () => {
    // The student typed work into the task box; Teli must receive it so it can react to the
    // actual reasoning (prompt.ts "THE STUDENT'S WORK SO FAR" branch), not tutor blind.
    ATTEMPT = {
      id: 'att1', student_id: 'u1', assignment_id: 'a1', status: 'in_progress',
      responses: { tasks: { '1': { text: 'I think it floats because it is lighter', image_url: null } } },
    };
    await (await load())(req(helpBody)); // task_step 1
    expect(generateGuardedHint).toHaveBeenCalled();
    expect(generateGuardedHint.mock.calls[0][0].studentResponse).toBe('I think it floats because it is lighter');
  });

  it('400 on missing required body fields', async () => {
    const res = await (await load())(req({ attempt_id: 'att1' }));
    expect(res.status).toBe(400);
  });

  it('400 on a non-integer task_step (e.g. 1.5)', async () => {
    const res = await (await load())(req({ ...helpBody, task_step: 1.5 }));
    expect(res.status).toBe(400);
  });

  it('400 on an over-long student_message (length bound)', async () => {
    const res = await (await load())(req({ ...helpBody, student_message: 'x'.repeat(2001) }));
    expect(res.status).toBe(400);
  });

  it('400 (not 500) on a null JSON body', async () => {
    const res = await (await load())(req(null));
    expect(res.status).toBe(400);
  });

  it('500 (not 404) when the session insert fails for a non-race reason', async () => {
    ACTIVE_SESSION = null; // force the create path
    CREATE_RESULT = { data: null, error: { code: '23503' } }; // FK violation, NOT the 23505 race
    const res = await (await load())(req(helpBody));
    expect(res.status).toBe(500);
  });
});
