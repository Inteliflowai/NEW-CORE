// src/lib/assignments/__tests__/loadAssignmentForPlay.test.ts
import { describe, it, expect, vi } from 'vitest';
import { loadAssignmentForPlay, normalizeContent } from '@/lib/assignments/loadAssignmentForPlay';

function makeAdmin(opts: { assignmentRow: unknown; latestAttempt: unknown; insertedId?: string }) {
  const insert = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: { id: opts.insertedId ?? 'att-new', attempt_no: 2, status: 'in_progress', responses: { tasks: {} } }, error: null }) }) });
  return {
    _insert: insert,
    from: (table: string) => table === 'assignments'
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.assignmentRow, error: null }) }) }) }
      : { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: opts.latestAttempt, error: null }) }) }) }) }) }), insert },
  } as never;
}
const OWNED = { id: 'a1', student_id: 's1', content: { title: 'X', tasks: [{ step: 1, description: 'Explain' }] }, spark_status: 'none' };

describe('loadAssignmentForPlay', () => {
  it('ownership false when missing', async () => { expect((await loadAssignmentForPlay(makeAdmin({ assignmentRow: null, latestAttempt: null }), 's1', 'a1')).ownershipOk).toBe(false); });
  it('ownership false on student mismatch', async () => { expect((await loadAssignmentForPlay(makeAdmin({ assignmentRow: { ...OWNED, student_id: 'x' }, latestAttempt: null }), 's1', 'a1')).ownershipOk).toBe(false); });
  it('sparkBlocked for a spark assignment', async () => { expect((await loadAssignmentForPlay(makeAdmin({ assignmentRow: { ...OWNED, spark_status: 'created' }, latestAttempt: null }), 's1', 'a1')).sparkBlocked).toBe(true); });
  it('resumes an in_progress attempt', async () => { const r = await loadAssignmentForPlay(makeAdmin({ assignmentRow: OWNED, latestAttempt: { id: 'att-r', status: 'in_progress', responses: { tasks: {} }, attempt_no: 1, allow_redo: false } }), 's1', 'a1'); expect(r.attempt.id).toBe('att-r'); expect(r.gradedLocked).toBe(false); });
  it('resumes a stranded grading attempt (crash recovery)', async () => { const r = await loadAssignmentForPlay(makeAdmin({ assignmentRow: OWNED, latestAttempt: { id: 'att-g', status: 'grading', responses: { tasks: {} }, attempt_no: 1, allow_redo: false } }), 's1', 'a1'); expect(r.attempt.id).toBe('att-g'); });
  it('graded + allow_redo=true → creates a new is_redo attempt', async () => { const admin = makeAdmin({ assignmentRow: OWNED, latestAttempt: { id: 'att-old', status: 'graded', responses: { tasks: {} }, attempt_no: 1, allow_redo: true } }); const r = await loadAssignmentForPlay(admin, 's1', 'a1'); expect(r.attempt.id).toBe('att-new'); expect((admin as { _insert: ReturnType<typeof vi.fn> })._insert).toHaveBeenCalled(); });
  it('graded + allow_redo=false → gradedLocked, NO new attempt', async () => { const admin = makeAdmin({ assignmentRow: OWNED, latestAttempt: { id: 'att-old', status: 'graded', responses: { tasks: {} }, attempt_no: 1, allow_redo: false } }); const r = await loadAssignmentForPlay(admin, 's1', 'a1'); expect(r.gradedLocked).toBe(true); expect((admin as { _insert: ReturnType<typeof vi.fn> })._insert).not.toHaveBeenCalled(); });
  it('normalizes lean-seed tasks lacking step/description', async () => { const lean = { id: 'a1', student_id: 's1', spark_status: 'none', content: { instructions: 'Do it', tasks: [{ description: 'Only desc' }] } }; const r = await loadAssignmentForPlay(makeAdmin({ assignmentRow: lean, latestAttempt: null }), 's1', 'a1'); expect(r.assignment.content.tasks?.[0].step).toBe(1); expect(r.assignment.content.tasks?.[0].description).toBe('Only desc'); });
  it('normalizes the real demo-seed task shape ({ type, prompt }) preserving the per-task prompt', async () => {
    // The live demo writer (scripts/seedDemo.ts) persists content.tasks as { type, prompt } objects
    // — NOT { step, description }. Normalization must map prompt -> description so the grader gets real text.
    const seeded = { id: 'a1', student_id: 's1', spark_status: 'none', content: { bandLabel: 'grade_level', instructions: 'Explain your thinking.', tasks: [{ type: 'write', prompt: 'Explain the concept in your own words.' }, { type: 'write', prompt: 'Compare two examples from class.' }] } };
    const r = await loadAssignmentForPlay(makeAdmin({ assignmentRow: seeded, latestAttempt: null }), 's1', 'a1');
    expect(r.assignment.content.tasks?.[0].step).toBe(1);
    expect(r.assignment.content.tasks?.[0].description).toBe('Explain the concept in your own words.');
    expect(r.assignment.content.tasks?.[1].step).toBe(2);
    expect(r.assignment.content.tasks?.[1].description).toBe('Compare two examples from class.');
  });
});

it('normalizeContent forwards ONLY skill_name (drops skill_id/power_skill) and no level/verb', () => {
  const out = normalizeContent({ tasks: [
    { step: 1, description: 'd', skill_name: 'Fractions', skill_id: 'frac', power_skill: 'Monitor' } as never,
  ] });
  expect(out.tasks![0]).toEqual({ step: 1, description: 'd', type: undefined, skill_name: 'Fractions' });
  expect(Object.keys(out.tasks![0]).sort()).toEqual(['description', 'skill_name', 'step', 'type']);
  expect(JSON.stringify(out)).not.toMatch(/frac|Monitor|scaffolded|extension|Reinforce|Enrich/);
});

// FIX 1 tests
it('normalizeContent drops skill_name that contains a diagnostic level word (safe degrade → no heading)', () => {
  const out = normalizeContent({ tasks: [
    { step: 1, description: 'd', skill_name: 'Scaffolded Fractions' } as never,
  ] });
  // "Scaffolded" is in DIAGNOSTIC_VOCAB_RE — must be dropped, not forwarded
  expect(out.tasks![0].skill_name).toBeUndefined();
});

it('normalizeContent does NOT forward top-level mode (allow-list — never spreads c)', () => {
  const out = normalizeContent({ mode: 'scaffolded', title: 'T', tasks: [{ step: 1, description: 'd' }] } as never);
  // mode must not appear in the output at all (allow-list returns only title/instructions/reading_passage/audio_script/tasks)
  expect('mode' in out).toBe(false);
  expect(JSON.stringify(out)).not.toMatch(/scaffolded/);
});

it('normalizeContent still forwards a clean skill_name with no diagnostic vocab', () => {
  const out = normalizeContent({ tasks: [{ step: 1, description: 'd', skill_name: 'Fractions' } as never] });
  expect(out.tasks![0].skill_name).toBe('Fractions');
});
