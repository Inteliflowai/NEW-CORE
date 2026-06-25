// src/lib/insights/__tests__/loadClassComprehension.test.ts
import { describe, it, expect } from 'vitest';
import { loadClassComprehension } from '@/lib/insights/loadClassComprehension';

// Table-dispatching mock that HONORS .in('skill_id', ids) (so class-scoping is actually tested)
// and resolves canned rows on await. .in('student_id', …) is ignored (fixtures already scope
// to the class's students). Mirrors the thenable-builder style used across the route tests.
function makeAdmin(fixtures: Record<string, unknown[]>) {
  const builder = (rows: unknown[]) => {
    const b: Record<string, unknown> = {};
    let skillFilter: string[] | null = null;
    b.select = () => b;
    b.eq = () => b;
    b.order = () => b;
    b.in = (col: string, vals: string[]) => { if (col === 'skill_id') skillFilter = vals; return b; };
    (b as { then: unknown }).then = (resolve: (v: { data: unknown[] }) => void) => {
      const out = skillFilter
        ? rows.filter((r) => {
            const sid =
              (r as { skill?: { id?: string } }).skill?.id ?? (r as { skill_id?: string }).skill_id;
            return sid == null || skillFilter!.includes(sid);
          })
        : rows;
      return resolve({ data: out });
    };
    return b;
  };
  return { from: (t: string) => builder(fixtures[t] ?? []) } as never;
}

// Extended mock that also records .in(col, vals) calls per table so DB-level scoping can be
// independently verified (FIX 2).
type InCall = { col: string; vals: string[] };
function makeAdminRecording(fixtures: Record<string, unknown[]>): {
  admin: ReturnType<typeof makeAdmin>;
  inCalls: Record<string, InCall[]>;
} {
  const inCalls: Record<string, InCall[]> = {};
  const builder = (table: string, rows: unknown[]) => {
    const b: Record<string, unknown> = {};
    let skillFilter: string[] | null = null;
    b.select = () => b;
    b.eq = () => b;
    b.order = () => b;
    b.in = (col: string, vals: string[]) => {
      (inCalls[table] ??= []).push({ col, vals });
      if (col === 'skill_id') skillFilter = vals;
      return b;
    };
    (b as { then: unknown }).then = (resolve: (v: { data: unknown[] }) => void) => {
      const out = skillFilter
        ? rows.filter((r) => {
            const sid =
              (r as { skill?: { id?: string } }).skill?.id ?? (r as { skill_id?: string }).skill_id;
            return sid == null || skillFilter!.includes(sid);
          })
        : rows;
      return resolve({ data: out });
    };
    return b;
  };
  const admin = { from: (t: string) => builder(t, fixtures[t] ?? []) } as never;
  return { admin, inCalls };
}

const ENR = [
  { student_id: 's1', users: { id: 's1', full_name: 'Ava Ng' } },
  { student_id: 's2', users: { id: 's2', full_name: 'Ben Ortiz' } },
  { student_id: 's3', users: { id: 's3', full_name: 'Cy Park' } },
];

it('tallies a class skill into Reinforce/On Track/Enrich with names, scoped to class skills', async () => {
  const admin = makeAdmin({
    enrollments: ENR,
    quizzes: [{ id: 'qz1' }],
    quiz_questions: [{ skill_id: 'sk1' }, { skill_id: 'sk1' }, { skill_id: null }],
    skill_learning_state: [
      { student_id: 's1', state: 'needs_more_time', skill: { id: 'sk1', name: 'Equivalent fractions' } },
      { student_id: 's2', state: 'on_track', skill: { id: 'sk1', name: 'Equivalent fractions' } },
      { student_id: 's3', state: 'ready_to_extend', skill: { id: 'sk1', name: 'Equivalent fractions' } },
      // sk9 belongs to another class → must be excluded (DB .in honored by the mock + JS guard)
      { student_id: 's1', state: 'needs_more_time', skill: { id: 'sk9', name: 'Photosynthesis' } },
    ],
    skill_state_snapshots: [],
  });
  const out = await loadClassComprehension(admin, 'c1');
  expect(out.skills).toHaveLength(1);
  const sk = out.skills[0];
  expect(sk.skill_name).toBe('Equivalent fractions');
  expect(sk).toMatchObject({ reinforce: 1, on_track: 1, enrich: 1 });
  expect(sk.reinforce_students).toEqual([{ student_id: 's1', full_name: 'Ava Ng' }]);
  expect(out.skills.find((s) => s.skill_name === 'Photosynthesis')).toBeUndefined();
});

it('hides skills with zero Reinforce, and excludes an all-not-yet-assessed skill', async () => {
  const admin = makeAdmin({
    enrollments: ENR,
    quizzes: [{ id: 'qz1' }],
    quiz_questions: [{ skill_id: 'sk1' }, { skill_id: 'sk2' }],
    skill_learning_state: [
      { student_id: 's1', state: 'on_track', skill: { id: 'sk1', name: 'Fractions' } },
      { student_id: 's2', state: 'ready_to_extend', skill: { id: 'sk1', name: 'Fractions' } },
      // sk2: everyone not-yet-assessed → no bucket → excluded
      { student_id: 's1', state: 'insufficient_data', skill: { id: 'sk2', name: 'Decimals' } },
      { student_id: 's2', state: 'not_attempted', skill: { id: 'sk2', name: 'Decimals' } },
    ],
    skill_state_snapshots: [],
  });
  const out = await loadClassComprehension(admin, 'c1');
  expect(out.skills).toHaveLength(0);
});

it('builds a per-week class trend, dropping a week with no assessed states, and a direction', async () => {
  const admin = makeAdmin({
    enrollments: ENR,
    quizzes: [{ id: 'qz1' }],
    quiz_questions: [{ skill_id: 'sk1' }],
    skill_learning_state: [],
    skill_state_snapshots: [
      { snapshot_date: '2026-05-04', skill_id: 'sk1', state: 'needs_more_time' },  // wk1 → 0
      { snapshot_date: '2026-05-11', skill_id: 'sk1', state: 'not_attempted' },    // wk2 → null (dropped)
      { snapshot_date: '2026-05-18', skill_id: 'sk1', state: 'on_track' },         // wk3 → 100
      { snapshot_date: '2026-05-25', skill_id: 'sk1', state: 'ready_to_extend' },  // wk4 → 100
    ],
  });
  const out = await loadClassComprehension(admin, 'c1');
  expect(out.trend.points.map((p) => p.date)).toEqual(['2026-05-04', '2026-05-18', '2026-05-25']);
  expect(out.trend.points.map((p) => p.index)).toEqual([0, 100, 100]);
  expect(out.trend.direction).toBe('climbing');
});

it('excludes an out-of-class skill from the trend too (snapshot scoping)', async () => {
  const admin = makeAdmin({
    enrollments: ENR,
    quizzes: [{ id: 'qz1' }],
    quiz_questions: [{ skill_id: 'sk1' }],
    skill_learning_state: [],
    skill_state_snapshots: [
      { snapshot_date: '2026-05-04', skill_id: 'sk1', state: 'on_track' },
      { snapshot_date: '2026-05-04', skill_id: 'sk9', state: 'needs_more_time' }, // other class → excluded
    ],
  });
  const out = await loadClassComprehension(admin, 'c1');
  // only sk1 counted that week → 1/1 solid → index 100 (would be 50 if sk9 leaked in)
  expect(out.trend.points).toEqual([{ date: '2026-05-04', index: 100 }]);
});

it('returns empty (no throw) when the class has no students', async () => {
  const admin = makeAdmin({ enrollments: [] });
  const out = await loadClassComprehension(admin, 'c1');
  expect(out).toEqual({ skills: [], trend: { points: [], direction: null } });
});

// FIX 1: banned-word skill names must be excluded from the live tally.
// "divergence" is on the BANNED_WORDS list in leakGuard.ts.
// "Fractions" is NOT banned (existing tests stay green).
it('excludes a skill whose name contains a banned word from the live tally', async () => {
  const admin = makeAdmin({
    enrollments: ENR,
    quizzes: [{ id: 'qz1' }],
    quiz_questions: [{ skill_id: 'sk1' }, { skill_id: 'sk2' }],
    skill_learning_state: [
      // sk1 has a banned word in its name — must be excluded from out.skills
      { student_id: 's1', state: 'needs_more_time', skill: { id: 'sk1', name: 'Divergence drill' } },
      { student_id: 's2', state: 'needs_more_time', skill: { id: 'sk1', name: 'Divergence drill' } },
      // sk2 is fine — "Fractions" is not a banned word
      { student_id: 's1', state: 'needs_more_time', skill: { id: 'sk2', name: 'Fractions' } },
    ],
    skill_state_snapshots: [],
  });
  const out = await loadClassComprehension(admin, 'c1');
  // "Divergence drill" must not appear despite having reinforce > 0
  expect(out.skills.find((s) => s.skill_name === 'Divergence drill')).toBeUndefined();
  // "Fractions" passes through normally
  expect(out.skills.find((s) => s.skill_name === 'Fractions')).toBeDefined();
});

// FIX 2: verify that .in('skill_id', classSkillIds) is called at the DB level on BOTH
// skill_learning_state AND skill_state_snapshots (independently of the JS guard).
it('calls .in("skill_id", classSkillIds) at the DB level on skill_learning_state and skill_state_snapshots', async () => {
  const { admin, inCalls } = makeAdminRecording({
    enrollments: ENR,
    quizzes: [{ id: 'qz1' }],
    quiz_questions: [{ skill_id: 'sk1' }],
    skill_learning_state: [
      { student_id: 's1', state: 'on_track', skill: { id: 'sk1', name: 'Fractions' } },
    ],
    skill_state_snapshots: [
      { snapshot_date: '2026-05-04', skill_id: 'sk1', state: 'on_track' },
    ],
  });
  await loadClassComprehension(admin, 'c1');

  const slsCalls = (inCalls['skill_learning_state'] ?? []).filter((c) => c.col === 'skill_id');
  expect(slsCalls.length).toBeGreaterThanOrEqual(1);
  expect(slsCalls[0].vals).toEqual(['sk1']);

  const snapCalls = (inCalls['skill_state_snapshots'] ?? []).filter((c) => c.col === 'skill_id');
  expect(snapCalls.length).toBeGreaterThanOrEqual(1);
  expect(snapCalls[0].vals).toEqual(['sk1']);
});
