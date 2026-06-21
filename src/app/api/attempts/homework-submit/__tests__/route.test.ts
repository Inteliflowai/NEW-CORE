// src/app/api/attempts/homework-submit/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// after() runs the callback synchronously in tests (mirror submit-signals.test.ts).
// We collect each callback's promise so a test can await deferred work before asserting,
// preventing a prior test's fire-and-forget hook from leaking into the next.
const afterTasks: Array<Promise<void>> = [];
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (cb: () => void | Promise<void>) => { afterTasks.push(Promise.resolve().then(cb)); } }));

const getUser = vi.fn();
const gradeAssignment = vi.fn();
const computeSignals = vi.fn().mockReturnValue({ ok: true });
const upsertBehavioralSignals = vi.fn().mockResolvedValue(undefined);
const recompute = vi.fn().mockResolvedValue(undefined);
const updates: Array<Record<string, unknown>> = [];

vi.mock('@/lib/engine/gradeAssignment', () => ({ gradeAssignment }));
vi.mock('@/lib/signals/computeSignals', () => ({ computeSignals }));
vi.mock('@/lib/signals/behavioralModel', () => ({ upsertBehavioralSignals }));
vi.mock('@/lib/skills/recomputeSkillStates', () => ({ recomputeSkillStatesForStudent: recompute }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'assignments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'a1', content: { title: 'X', tasks: [{ step: 1, description: 'Explain X' }, { step: 2, description: 'Explain Y' }] }, due_at: null } }) }) }) };
      if (t === 'users') return { select: () => ({ eq: () => ({ single: async () => ({ data: { school_id: 'sch1', grade_level: '7', full_name: 'Jordan Lee' } }) }) }) };
      return { // homework_attempts
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ATTEMPT }) }) }) }),
        update: (payload: Record<string, unknown>) => { updates.push(payload); return { eq: () => ({ eq: async () => ({ error: null }) }) }; },
      };
    },
  }),
}));

let ATTEMPT: unknown;
const req = (b: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(b) });
const fullBody = {
  attempt_id: 'att1',
  responses: { tasks: { '1': { text: 'because photosynthesis', image_url: null }, '2': { text: 'energy flows', image_url: null } } },
  sessionAggregates: { focusLossCount: 0, pasteCount: 0, pauseCount: 1, totalPauseMs: 1000, totalFocusLossMs: 0, backspaceCount: 2, keypressCount: 40, ttsPlayCount: 0, canvasUsed: false, stuckEraseCount: 0 },
  perTaskMetrics: [{ step: 1, timeTakenMs: 30000, changeCount: 1 }, { step: 2, timeTakenMs: 25000, changeCount: 0 }],
};

async function load() { vi.resetModules(); return (await import('@/app/api/attempts/homework-submit/route')).POST; }
/** Await every after() callback registered so far, so deferred work settles within the test. */
async function drainAfter() { await Promise.allSettled(afterTasks); }

beforeEach(() => {
  getUser.mockReset(); gradeAssignment.mockReset(); updates.length = 0; afterTasks.length = 0;
  computeSignals.mockClear(); upsertBehavioralSignals.mockClear(); recompute.mockClear();
  ATTEMPT = { id: 'att1', student_id: 'u1', assignment_id: 'a1', status: 'in_progress', teli_hint_count: 0, created_at: new Date(Date.now() - 3600_000).toISOString(), allow_redo: false };
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  gradeAssignment.mockResolvedValue({ overall_grade: 84, overall_feedback: 'Strong work.', task_grades: [{ step: 1, grade: 90, feedback: 'Clear.' }, { step: 2, grade: 78, feedback: 'Add detail.' }] });
});
// Settle every deferred after() hook before the next test clears the mocks — no cross-test leak.
afterEach(async () => { await drainAfter(); });

describe('POST /api/attempts/homework-submit', () => {
  it('401 without a user', async () => { getUser.mockResolvedValue({ data: { user: null }, error: null }); expect((await (await load())(req(fullBody))).status).toBe(401); });
  it('404 when not owned', async () => { ATTEMPT = null; expect((await (await load())(req(fullBody))).status).toBe(404); });
  it('400 incomplete when a task has no text or image', async () => {
    const res = await (await load())(req({ ...fullBody, responses: { tasks: { '1': { text: '', image_url: null }, '2': { text: '', image_url: null } } } }));
    expect(res.status).toBe(400); expect((await res.json()).error).toBe('incomplete_assignment');
  });
  it('409 when a graded attempt without allow_redo is resubmitted', async () => { ATTEMPT = { ...(ATTEMPT as object), status: 'graded', allow_redo: false }; expect((await (await load())(req(fullBody))).status).toBe(409); });
  it('grades, returns the VISIBLE grade, and writes the full contract', async () => {
    const res = await (await load())(req(fullBody));
    expect(res.status).toBe(200);
    expect((await res.json()).result.gradePct).toBe(84);
    const graded = updates.find(u => u.status === 'graded');
    expect(graded).toBeDefined();
    expect(graded!.score_pct).toBe(84);
    expect(graded!.task_grades).toBeDefined();
    expect(graded!.effort_label).toBeTruthy();
    expect(graded!.submitted_at).toBeTruthy();
    expect(graded!.graded_at).toBeTruthy();
    expect(typeof graded!.hours_to_submit).toBe('number');
  });
  it('fires the moat hook with context:homework on the clean path', async () => {
    await (await load())(req(fullBody));
    await drainAfter();
    expect(upsertBehavioralSignals).toHaveBeenCalledTimes(1);
    expect(computeSignals.mock.calls[0][0].context).toBe('homework');
  });
  it('routes to pending_grade and does NOT fire the moat when grading throws', async () => {
    gradeAssignment.mockRejectedValueOnce(new Error('llm down'));
    const res = await (await load())(req(fullBody));
    await drainAfter(); // pending path registers no hooks; drain is a no-op safeguard
    expect((await res.json()).grading_delayed).toBe(true);
    expect(upsertBehavioralSignals).not.toHaveBeenCalled();
    expect(updates.some(u => u.status === 'pending_grade')).toBe(true);
  });
});
