import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const upserts: Record<string, unknown[][]> = {};
// Per-table upsert error override: if set, that table's next upsert returns this error.
const upsertErrors: Record<string, { message: string }> = {};

vi.mock('@/lib/skills/recomputeSkillStates', () => ({ recomputeSkillStatesForStudent: async () => {} }));
vi.mock('@/lib/signals/consistency', () => ({ computeConsistency: () => ({ consistency_label: 'steady', consistency_score: 0 }) }));
vi.mock('@/lib/signals/computeHwQuizDivergence', () => ({ computeHwQuizDivergence: () => ({ divergence_score: 0, divergence_direction: 'aligned' }) }));
vi.mock('@/lib/signals/computeRosterRiskIndex', () => ({ computeRosterRiskIndex: () => ({ risk_score: 0 }) }));
vi.mock('@/lib/utils/scoring', () => ({ currentMasteryBand: () => 'grade_level' }));

vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      const rowsFor: Record<string, unknown[]> = {
        enrollments: [{ student_id: 's1', users: { id: 's1', school_id: 'sch1' }, class_id: 'c1' }],
        skill_learning_state: [
          { skill_id: 'sk1', skill: { name: 'Fractions' }, state: 'on_track', confidence: 80 },
          { skill_id: 'sk2', skill: { name: 'Decimals' }, state: 'needs_more_time', confidence: 40 },
        ],
        quiz_attempts: [], homework_attempts: [], student_model_snapshots: [],
      };
      const b: Record<string, unknown> = {};
      const chain = () => b;
      b.select = chain; b.eq = chain; b.in = chain; b.order = chain; b.limit = chain;
      b.maybeSingle = async () => ({ data: null });
      b.upsert = (rows: unknown[]) => {
        (upserts[t] ??= []).push(rows);
        const err = upsertErrors[t] ?? null;
        return { error: err };
      };
      (b as { then: unknown }).then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: rowsFor[t] ?? [], error: null });
      return b;
    },
  }),
}));

beforeEach(() => {
  for (const k of Object.keys(upserts)) delete upserts[k];
  for (const k of Object.keys(upsertErrors)) delete upsertErrors[k];
  process.env.CRON_SECRET = 'sek';
});

it('upserts one skill_state_snapshots row per skill for the ISO-week, with the conflict key', async () => {
  const { POST } = await import('@/app/api/cron/weekly-snapshot/route');
  const url = new URL('http://localhost/api/cron/weekly-snapshot');
  url.searchParams.set('ref_date', '2026-05-13');
  const req = new NextRequest(url, { method: 'POST', headers: { 'x-cron-secret': 'sek' } });
  const res = await POST(req);
  expect(res.status).toBe(200);
  const rows = (upserts['skill_state_snapshots'] ?? [])[0] as Array<Record<string, unknown>>;
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ student_id: 's1', skill_id: 'sk1', snapshot_date: '2026-05-11', state: 'on_track', confidence: 80 });
  // primary snapshot still written (ordering: skill snapshot comes AFTER)
  expect(upserts['student_model_snapshots']).toBeDefined();
});

// FIX 3: lock the cron upsert ORDERING invariant.
// A skill_state_snapshots failure must NOT suppress the primary student_model_snapshots write
// or cause the student to be counted as failed.
it('skill_state_snapshots failure does not suppress student_model_snapshots or mark student failed', async () => {
  // Force skill_state_snapshots upsert to return an error.
  upsertErrors['skill_state_snapshots'] = { message: 'simulated skill snapshot error' };

  const { POST } = await import('@/app/api/cron/weekly-snapshot/route');
  const url = new URL('http://localhost/api/cron/weekly-snapshot');
  url.searchParams.set('ref_date', '2026-05-13');
  const req = new NextRequest(url, { method: 'POST', headers: { 'x-cron-secret': 'sek' } });
  const res = await POST(req);

  // (a) Response is still 200 and student is processed (not failed)
  expect(res.status).toBe(200);
  const body = await res.json() as { processed: number; failed: number };
  expect(body.processed).toBe(1);
  expect(body.failed).toBe(0);

  // (b) student_model_snapshots upsert still ran (the primary write was not skipped)
  expect(upserts['student_model_snapshots']).toBeDefined();
  expect((upserts['student_model_snapshots'] ?? []).length).toBeGreaterThanOrEqual(1);
});
