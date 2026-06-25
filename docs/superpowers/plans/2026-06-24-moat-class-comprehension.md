# The Moat — Class Comprehension + Learning-Style + Over-Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give teachers a class-level Comprehension Level view (whole-class tally per skill, expandable to student names), an over-time trend, and a learning-style reassurance line — all folded into the existing Insights page, quiet-when-empty.

**Architecture:** This is mostly **aggregation + history capture + surfacing** over compute that already runs. CL already exists per `(student, skill)` in `skill_learning_state` (6 states → 3 teacher verbs via `clVerbs.ts`). We add: (1) a new pure aggregator that rolls those states up to the class, scoped to the class's own skills; (2) a new weekly per-skill snapshot table fed by the existing cron, for the trend; (3) a confidence-gated learning-style rollup; (4) three quiet UI sections on the Insights page. No new model, no new generation behavior.

**Tech Stack:** Next.js 16 App Router (Server Components; `(teacher)` route group already gates `requireRole(['teacher'])`), React 19, TypeScript strict, Tailwind v4 token classes, Vitest 4 (`node` for libs; `// @vitest-environment jsdom` + `import '@/test/setup-dom';` for component/page tests), Supabase admin client (RLS-bypassed; the caller's auth+IDOR guard is the backstop).

> **This plan was hardened by a pre-code adversarial review (2026-06-24).** Fixes folded in: class-scoping is enforced in JS *and* the query (and the unit mock honors `.in('skill_id')` so it's actually tested); Tasks 5 and 8 explicitly update the *existing* `loadInsights`/cron test mocks so suites stay green; the demo-seed wiring uses the seed's real variable names; the lead coach sentence is now implemented; `isoWeekMonday` is extracted to an import-safe util; the trend section only renders once there's a real direction. See each task's notes.

## Global Constraints

- **Teacher-only CL.** New surfaces live ONLY under `src/app/(teacher)/`. NEVER render the 6-state enum or the raw 0–100 `confidence` — only the 3 verbs (`Reinforce` / `On Track` / `Enrich`) and soft words. Do not loosen `skill_learning_state`'s teacher-only RLS or the student growth route.
- **Learning style is an inference.** Exclude the `emerging` sentinel (and null) — that is the low-confidence marker. NEVER label an individual student's style on any surface. Copy says **"differentiate," never "adapt."**
- **Quiet on good days is mechanical.** Every new section returns `null` / renders nothing when there is nothing worth saying.
- **Counts + soft words only — no %, no raw numbers** surfaced to the teacher in the new sections. The comprehension trend renders as a sparkline SHAPE + a soft direction sentence; its point tooltips show the WEEK, never a percentage. (The internal index is computed but never printed.)
- **Growth is you-vs-your-own-past** with explicit cold-start — never peer-relative, never fabricated.
- **Class-scoping is mandatory.** A class's skills = distinct `quiz_questions.skill_id` over `quizzes WHERE class_id = <class>`. A student enrolled in two classes must NOT see one class's skills bleed into the other's tally. Enforced in BOTH the DB query (`.in('skill_id', classSkillIds)`) AND a JS guard (`classSkillIdSet`), so a future query change can't silently drop the invariant and so the unit test can verify it.
- **Auth chain unchanged.** Page loads through `guardClassAccess(classId)` + `createAdminSupabaseClient()`. The new snapshot table gets deny-by-default RLS (service_role write only; NO authenticated read) — mirror `0017_teacher_completion.sql` (alerts).
- **All new copy is a Barb draft** → append to `STRINGS-FOR-BARB.md §Insights / Class Comprehension`. Honor "Reinforce, never Reteach."
- **No visual gold-plating.** Whole-UI redesign is ON HOLD (functionality-first). Build clean token-only UI; no new motion choreography. Token classes only — no hardcoded hex/spacing/type; never invent a token.
- **Gates (every task):** `npx tsc --noEmit` → 0 errors; `npx vitest run <file>` → green; the full suite + `npm run build` (a11y + tokens) at the end.

**Spec:** `docs/superpowers/specs/2026-06-24-moat-class-comprehension-design.md` (decisions LOCKED). **Grounding:** `docs/superpowers/specs/grounding/2026-06-24-moat/grounding-synthesis.md`.

---

## File Structure

- **Create** `supabase/migrations/0025_skill_state_snapshots.sql` — weekly per-`(student, skill)` CL history table + deny-by-default RLS.
- **Create** `src/lib/dates/isoWeekMonday.ts` — import-safe ISO-week-Monday helper (no `next/server`), shared by the cron and the seed backfill.
- **Create** `src/lib/insights/classComprehension.ts` — pure helpers: `clBucketOf`, `classComprehensionIndex`, `classTrendDirection`.
- **Create** `src/lib/insights/loadClassComprehension.ts` — the class aggregator (live tally + names per bucket + trend), reads the new table.
- **Create** `src/lib/insights/loadClassLearningStyle.ts` — confidence-gated LS rollup + `learningStyleLine`.
- **Create** `src/lib/copy/comprehensionObservation.ts` — the lead coach sentence (names the top reinforce skill).
- **Modify** `src/lib/insights/loadInsights.ts` — compose the two new loaders + the comprehension lead into `ClassInsights`.
- **Modify** `src/lib/insights/__tests__/loadInsights.test.ts` — mock the two new loaders so the existing test stays green.
- **Create** `src/app/(teacher)/insights/_components/ComprehensionBySkill.tsx` — tally + `<details>` expand → names → Skill Map links.
- **Create** `src/app/(teacher)/insights/_components/ClassComprehensionTrend.tsx` — soft direction line + sparkline.
- **Create** `src/app/(teacher)/insights/_components/HowClassLearns.tsx` — the LS reassurance line.
- **Modify** `src/app/(teacher)/insights/page.tsx` — render the three new sections; replace `SkillsToFocus` with `ComprehensionBySkill`.
- **Delete** `src/app/(teacher)/insights/_components/SkillsToFocus.tsx` — superseded by `ComprehensionBySkill` (only `page.tsx` imports it; no test references it).
- **Modify** `src/app/api/cron/weekly-snapshot/route.ts` — import `isoWeekMonday` from the new util (re-export for back-compat); also upsert `skill_state_snapshots` per student AFTER the `student_model_snapshots` upsert.
- **Modify** `src/app/api/cron/weekly-snapshot/__tests__/route.test.ts` — add a `skill_state_snapshots` branch to the mock admin so existing assertions still capture the primary upsert.
- **Create** `scripts/backfillSkillStateSnapshots.ts` + **Modify** `scripts/seedDemo.ts` — seed a few weeks of climbing history for the demo class.
- **Modify** `STRINGS-FOR-BARB.md` — copy drafts.
- Tests alongside each module (`__tests__/` dirs mirroring the established layout).

**Dependency waves (implement in order):** T1, T2 (independent) → T3, T4 (need T2) → T5 (needs T3,T4) → T6 (needs T3,T4 types) → T7 (needs T5,T6) → T8 (needs T1; creates the util) → T9 (needs T1,T8 util).

---

### Task 1: Migration 0025 — `skill_state_snapshots`

DDL only (no unit test — config/DDL is the TDD exception). Mirrors `0006_snapshots.sql` (table/UNIQUE/index) and `0017_teacher_completion.sql` (deny-by-default RLS). Pre-code migration lens: **clean, zero findings.**

**Files:**
- Create: `supabase/migrations/0025_skill_state_snapshots.sql`

**Interfaces:**
- Produces: table `public.skill_state_snapshots(student_id, school_id, skill_id, snapshot_date, state, confidence, created_at)` with `UNIQUE (student_id, skill_id, snapshot_date)`. Consumed by Task 3 (read) and Task 8 (write).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0025_skill_state_snapshots.sql
-- The moat (Item 2): weekly per-(student, skill) Comprehension-Level history.
-- skill_learning_state holds only the LIVE state (one row per student+skill, no history);
-- this table is its weekly archive so the Insights page can show a class trend over time.
-- Written ONLY by the weekly-snapshot cron (service_role) and the demo seed; read ONLY via
-- the admin client (RLS-bypassed). Deny-by-default for authenticated (mirrors alerts in 0017).
-- Additive only — no edits to existing tables.

CREATE TABLE IF NOT EXISTS public.skill_state_snapshots (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    uuid        NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  school_id     uuid        REFERENCES public.schools(id)          ON DELETE CASCADE,
  skill_id      uuid        NOT NULL REFERENCES public.skills(id)  ON DELETE CASCADE,
  snapshot_date date        NOT NULL DEFAULT CURRENT_DATE,
  state         text        NOT NULL CHECK (state IN (
                  'needs_different_instruction',
                  'needs_more_time',
                  'on_track',
                  'ready_to_extend',
                  'insufficient_data',
                  'not_attempted'
                )),
  confidence    numeric     NOT NULL DEFAULT 0,   -- 0-100, soft words only on the surface
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, skill_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_sss_student_date
  ON public.skill_state_snapshots (student_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_sss_skill
  ON public.skill_state_snapshots (skill_id);

-- ── RLS: service_role full; NO authenticated read (read path is admin-client only) ──
ALTER TABLE public.skill_state_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sss_service_role_all" ON public.skill_state_snapshots;
CREATE POLICY "sss_service_role_all" ON public.skill_state_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- PostgREST grants (0005 note: service role 42501 without these). NO authenticated SELECT
-- policy ⇒ with RLS enabled, authenticated reads are denied by default even though the GRANT
-- exists (a GRANT without a permitting policy still returns zero rows). Read path = admin client.
GRANT SELECT ON public.skill_state_snapshots TO authenticated, anon;
GRANT ALL    ON public.skill_state_snapshots TO service_role;
```

- [ ] **Step 2: Verify it is idempotent and convention-matching**

Re-read the file. Confirm: every object uses `IF NOT EXISTS` / `DROP POLICY IF EXISTS`; FKs reference only tables that exist by 0006 (`users`, `schools`, `skills`); the `state` CHECK is the exact 6-value vocabulary from `0005_skills.sql:57-64`; `UNIQUE (student_id, skill_id, snapshot_date)` matches the cron's `onConflict` in Task 8. (Do NOT apply to any live DB — application is a later, separately-authorized step, like 0017/0022/0024.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0025_skill_state_snapshots.sql
git commit -m "feat(moat): migration 0025 skill_state_snapshots (weekly per-skill CL history)"
```

---

### Task 2: Pure CL aggregation helpers

**Files:**
- Create: `src/lib/insights/classComprehension.ts`
- Test: `src/lib/insights/__tests__/classComprehension.test.ts`

**Interfaces:**
- Consumes: `CL_VERB_BY_STATE`, `SkillLearningState` from `@/lib/skills/clVerbs`.
- Produces: `clBucketOf(state): 'reinforce' | 'on_track' | 'enrich' | null`; `classComprehensionIndex(states): number | null`; `classTrendDirection(indices): 'climbing' | 'steady' | 'sliding' | null`. Consumed by Task 3.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/insights/__tests__/classComprehension.test.ts
import { describe, it, expect } from 'vitest';
import { clBucketOf, classComprehensionIndex, classTrendDirection } from '@/lib/insights/classComprehension';

describe('clBucketOf', () => {
  it('maps the 6 states to 3 buckets (+null for not-assessed)', () => {
    expect(clBucketOf('needs_different_instruction')).toBe('reinforce');
    expect(clBucketOf('needs_more_time')).toBe('reinforce');
    expect(clBucketOf('on_track')).toBe('on_track');
    expect(clBucketOf('ready_to_extend')).toBe('enrich');
    expect(clBucketOf('insufficient_data')).toBeNull();
    expect(clBucketOf('not_attempted')).toBeNull();
  });
});

describe('classComprehensionIndex', () => {
  it('is the share (0-100) of ASSESSED states that are solid (on_track|enrich)', () => {
    expect(classComprehensionIndex([
      'on_track', 'ready_to_extend', 'needs_more_time', 'needs_different_instruction',
      'insufficient_data', 'not_attempted',
    ])).toBe(50);
  });
  it('returns null when nothing is assessed', () => {
    expect(classComprehensionIndex(['insufficient_data', 'not_attempted'])).toBeNull();
    expect(classComprehensionIndex([])).toBeNull();
  });
});

describe('classTrendDirection', () => {
  it('climbing when the last third beats the first third by > 3', () => {
    expect(classTrendDirection([40, 45, 50, 70, 80])).toBe('climbing');
  });
  it('sliding when it drops by > 3', () => {
    expect(classTrendDirection([80, 70, 60, 50, 40])).toBe('sliding');
  });
  it('steady within the threshold', () => {
    expect(classTrendDirection([60, 61, 60, 62, 61])).toBe('steady');
  });
  it('null below 3 points (cold-start)', () => {
    expect(classTrendDirection([60, 80])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/insights/__tests__/classComprehension.test.ts`
Expected: FAIL — `classComprehension` module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/insights/classComprehension.ts
// Pure roll-up helpers for the class-level Comprehension Level view (the moat).
// No I/O. CL verbs come from the single source of truth in clVerbs.ts.
import { CL_VERB_BY_STATE, type SkillLearningState } from '@/lib/skills/clVerbs';

export type CLBucket = 'reinforce' | 'on_track' | 'enrich' | null;

/** Map a skill_learning_state to a class-tally bucket. null = not-yet-assessed/insufficient. */
export function clBucketOf(state: SkillLearningState): CLBucket {
  const verb = CL_VERB_BY_STATE[state] ?? null;
  if (verb === 'Reinforce') return 'reinforce';
  if (verb === 'On Track') return 'on_track';
  if (verb === 'Enrich') return 'enrich';
  return null;
}

/** Share (0-100) of ASSESSED states that are solid (on_track|enrich). null when none assessed. */
export function classComprehensionIndex(states: SkillLearningState[]): number | null {
  let assessed = 0;
  let solid = 0;
  for (const s of states) {
    const b = clBucketOf(s);
    if (b === null) continue; // not assessed → excluded from the denominator
    assessed++;
    if (b === 'on_track' || b === 'enrich') solid++;
  }
  if (assessed === 0) return null;
  return Math.round((100 * solid) / assessed);
}

const DIRECTION_THRESHOLD = 3; // mirrors loadStudentGradeTrend's head→tail mean shift

/** climbing/steady/sliding from weekly indices (oldest→newest). null when < 3 points. */
export function classTrendDirection(indices: number[]): 'climbing' | 'steady' | 'sliding' | null {
  if (indices.length < 3) return null;
  const third = Math.max(1, Math.floor(indices.length / 3));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const delta = mean(indices.slice(-third)) - mean(indices.slice(0, third));
  if (delta > DIRECTION_THRESHOLD) return 'climbing';
  if (delta < -DIRECTION_THRESHOLD) return 'sliding';
  return 'steady';
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/insights/__tests__/classComprehension.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/insights/classComprehension.ts src/lib/insights/__tests__/classComprehension.test.ts
git commit -m "feat(moat): pure CL roll-up helpers (bucket/index/direction)"
```

---

### Task 3: `loadClassComprehension` aggregator

Rolls live `skill_learning_state` up to the class, **scoped to the class's own skills in JS AND the query**, with student names per bucket for the expand, plus the over-time trend from `skill_state_snapshots`.

> **Pre-code fix (C1):** class-scoping is enforced with a JS `classSkillIdSet` guard (not only the DB `.in`), and the unit-test mock HONORS `.in('skill_id', …)` so the scoping invariant is genuinely exercised. The snapshot query selects `skill_id` and is guarded the same way. Edge-case tests added (all-insufficient skill; mid-series null week).

**Files:**
- Create: `src/lib/insights/loadClassComprehension.ts`
- Test: `src/lib/insights/__tests__/loadClassComprehension.test.ts`

**Interfaces:**
- Consumes: `clBucketOf`, `classComprehensionIndex`, `classTrendDirection` (Task 2); `SkillLearningState` from `@/lib/skills/clVerbs`; `SupabaseClient`.
- Produces: `loadClassComprehension(admin, classId): Promise<ClassComprehension>` and exported types `StudentRef`, `SkillComprehension`, `ClassComprehensionTrendPoint`, `ClassComprehension`. Consumed by Tasks 5, 6.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/insights/__tests__/loadClassComprehension.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/insights/loadClassComprehension.ts
// Class-level Comprehension Level aggregator (the moat). Teacher-only; rolls up the LIVE
// skill_learning_state across a class's students, SCOPED to the class's own skills (so a
// student in two classes never cross-contaminates) IN JS AND THE QUERY, with student names per
// bucket for the expand, plus the over-time trend from skill_state_snapshots (migration 0025).
//
// NO auth — the caller (Insights page) runs guardClassAccess + admin client first.
// NEVER returns the raw state enum or the 0-100 confidence to the surface — only bucket counts
// and names. Soft-word/verb display happens at the render layer.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SkillLearningState } from '@/lib/skills/clVerbs';
import { clBucketOf, classComprehensionIndex, classTrendDirection } from '@/lib/insights/classComprehension';

export interface StudentRef { student_id: string; full_name: string; }

export interface SkillComprehension {
  skill_id: string;
  skill_name: string;
  reinforce: number;
  on_track: number;
  enrich: number;
  reinforce_students: StudentRef[];
  on_track_students: StudentRef[];
  enrich_students: StudentRef[];
}

export interface ClassComprehensionTrendPoint { date: string; index: number; }

export interface ClassComprehension {
  skills: SkillComprehension[]; // top skills needing attention (reinforce>0), most-reinforce-first
  trend: { points: ClassComprehensionTrendPoint[]; direction: 'climbing' | 'steady' | 'sliding' | null };
}

const NONE = ['__none__'];
const MAX_SKILLS = 3;  // name the few skills that need action — not a wall
const TREND_WEEKS = 8; // recent weeks to chart

const EMPTY: ClassComprehension = { skills: [], trend: { points: [], direction: null } };

export async function loadClassComprehension(
  admin: SupabaseClient,
  classId: string,
): Promise<ClassComprehension> {
  // 1. Active students (id + name).
  const { data: enr } = await admin
    .from('enrollments')
    .select('student_id, users:student_id(id, full_name)')
    .eq('class_id', classId)
    .eq('is_active', true);
  type EnrRow = {
    student_id: string;
    users: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
  };
  const nameById = new Map<string, string>();
  const studentIds: string[] = [];
  for (const raw of (enr ?? []) as EnrRow[]) {
    const u = Array.isArray(raw.users) ? raw.users[0] : raw.users;
    studentIds.push(raw.student_id);
    nameById.set(raw.student_id, u?.full_name ?? 'Student');
  }
  if (studentIds.length === 0) return EMPTY;

  // 2. Skills taught in THIS class = distinct quiz_questions.skill_id over the class's quizzes.
  const { data: quizRows } = await admin.from('quizzes').select('id').eq('class_id', classId);
  const quizIds = ((quizRows ?? []) as { id: string }[]).map((q) => q.id);
  const { data: qqRows } = await admin
    .from('quiz_questions').select('skill_id')
    .in('quiz_id', quizIds.length ? quizIds : NONE);
  const classSkillIds = [
    ...new Set(
      ((qqRows ?? []) as { skill_id: string | null }[])
        .map((r) => r.skill_id)
        .filter((x): x is string => x != null),
    ),
  ];
  if (classSkillIds.length === 0) return EMPTY;
  const classSkillIdSet = new Set(classSkillIds); // JS-level scoping guard (belt + suspenders)

  // 3. Live per-(student, skill) CL for these students × class skills (+ skill name).
  const { data: slsRows } = await admin
    .from('skill_learning_state')
    .select('student_id, state, skill:skill_id(id, name)')
    .in('student_id', studentIds)
    .in('skill_id', classSkillIds);
  type SlsRow = {
    student_id: string;
    state: string;
    skill: { id: string; name: string } | { id: string; name: string }[] | null;
  };
  const bySkill = new Map<string, { name: string; rows: { student_id: string; state: SkillLearningState }[] }>();
  for (const raw of (slsRows ?? []) as SlsRow[]) {
    const sk = Array.isArray(raw.skill) ? raw.skill[0] : raw.skill;
    if (!sk?.id || !classSkillIdSet.has(sk.id)) continue; // scope: never let another class's skill in
    let entry = bySkill.get(sk.id);
    if (!entry) { entry = { name: sk.name, rows: [] }; bySkill.set(sk.id, entry); }
    entry.rows.push({ student_id: raw.student_id, state: raw.state as SkillLearningState });
  }

  const allSkills: SkillComprehension[] = [];
  for (const [skill_id, { name, rows }] of bySkill) {
    const sc: SkillComprehension = {
      skill_id, skill_name: name,
      reinforce: 0, on_track: 0, enrich: 0,
      reinforce_students: [], on_track_students: [], enrich_students: [],
    };
    for (const r of rows) {
      const ref: StudentRef = { student_id: r.student_id, full_name: nameById.get(r.student_id) ?? 'Student' };
      const b = clBucketOf(r.state);
      if (b === 'reinforce') { sc.reinforce++; sc.reinforce_students.push(ref); }
      else if (b === 'on_track') { sc.on_track++; sc.on_track_students.push(ref); }
      else if (b === 'enrich') { sc.enrich++; sc.enrich_students.push(ref); }
      // null bucket: not-yet-assessed on this skill → not counted
    }
    allSkills.push(sc);
  }
  const skills = allSkills
    .filter((s) => s.reinforce > 0) // quiet: only surface skills that need action
    .sort((a, b) => b.reinforce - a.reinforce || (b.on_track + b.enrich) - (a.on_track + a.enrich))
    .slice(0, MAX_SKILLS);

  // 4. Over-time trend from skill_state_snapshots (per-week class comprehension index).
  //    Select skill_id so the same JS scoping guard applies to history too.
  const { data: snapRows } = await admin
    .from('skill_state_snapshots')
    .select('snapshot_date, state, skill_id')
    .in('student_id', studentIds)
    .in('skill_id', classSkillIds)
    .order('snapshot_date', { ascending: true });
  type SnapRow = { snapshot_date: string; state: string; skill_id: string };
  const statesByWeek = new Map<string, SkillLearningState[]>();
  for (const raw of (snapRows ?? []) as SnapRow[]) {
    if (!classSkillIdSet.has(raw.skill_id)) continue; // scope guard for history
    const list = statesByWeek.get(raw.snapshot_date) ?? [];
    list.push(raw.state as SkillLearningState);
    statesByWeek.set(raw.snapshot_date, list);
  }
  const recentWeeks = [...statesByWeek.keys()].sort().slice(-TREND_WEEKS);
  const points: ClassComprehensionTrendPoint[] = [];
  for (const wd of recentWeeks) {
    const idx = classComprehensionIndex(statesByWeek.get(wd) ?? []);
    if (idx != null) points.push({ date: wd, index: idx }); // weeks with no assessed states are dropped
  }
  return { skills, trend: { points, direction: classTrendDirection(points.map((p) => p.index)) } };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/insights/__tests__/loadClassComprehension.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/lib/insights/loadClassComprehension.ts src/lib/insights/__tests__/loadClassComprehension.test.ts
git commit -m "feat(moat): loadClassComprehension — class-scoped CL tally (JS+query) + trend"
```

---

### Task 4: `loadClassLearningStyle` rollup + reassurance line

> **Pre-code fix (M1/M9):** rows with a null `submitted_at` are skipped (Postgres `ORDER BY … DESC` puts NULLs first, so a null-dated row must not win "most recent"); a test fixture locks this.

**Files:**
- Create: `src/lib/insights/loadClassLearningStyle.ts`
- Test: `src/lib/insights/__tests__/loadClassLearningStyle.test.ts`

**Interfaces:**
- Consumes: `normalizeLearningStyle` from `@/lib/utils/learningStyle`; `SupabaseClient`.
- Produces: `learningStyleLine(friendly: string[]): string | null` (pure) and `loadClassLearningStyle(admin, classId): Promise<ClassLearningStyle>` where `ClassLearningStyle = { styles: string[]; line: string | null }`. Consumed by Tasks 5, 6.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/insights/__tests__/loadClassLearningStyle.test.ts
import { describe, it, expect } from 'vitest';
import { loadClassLearningStyle, learningStyleLine } from '@/lib/insights/loadClassLearningStyle';

function makeAdmin(fixtures: Record<string, unknown[]>) {
  const builder = (rows: unknown[]) => {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    b.select = chain; b.eq = chain; b.in = chain; b.order = chain;
    (b as { then: unknown }).then = (resolve: (v: { data: unknown[] }) => void) => resolve({ data: rows });
    return b;
  };
  return { from: (t: string) => builder(fixtures[t] ?? []) } as never;
}

describe('learningStyleLine', () => {
  it('uses "differentiate", never "adapt", and lists ≥2 styles', () => {
    const line = learningStyleLine(['visual', 'hands-on', 'discussion-based']);
    expect(line).toBe('Your class spans visual, hands-on, and discussion-based learners — assignments differentiate to each.');
    expect(line).not.toMatch(/adapt/i);
  });
  it('null below 2 distinct styles', () => {
    expect(learningStyleLine(['visual'])).toBeNull();
  });
});

describe('loadClassLearningStyle', () => {
  it("takes each student's most-recent NON-emerging style and skips null-dated rows", async () => {
    const admin = makeAdmin({
      enrollments: [{ student_id: 's1' }, { student_id: 's2' }, { student_id: 's3' }],
      // Rows arrive newest-first (DESC). A null-dated row (NULLS FIRST in real PG) must NOT win.
      quiz_attempts: [
        { student_id: 's1', learning_style: 'auditory', submitted_at: null },     // null date → skip
        { student_id: 's1', learning_style: 'emerging', submitted_at: '2026-06-10' }, // low-conf → skip
        { student_id: 's1', learning_style: 'visual', submitted_at: '2026-06-01' },   // confident → wins
        { student_id: 's2', learning_style: 'kinesthetic', submitted_at: '2026-06-09' },
        { student_id: 's3', learning_style: 'social', submitted_at: '2026-06-08' },
      ],
    });
    const out = await loadClassLearningStyle(admin, 'c1');
    expect(out.styles).toEqual(['visual', 'hands-on', 'discussion-based']);
    expect(out.line).toContain('differentiate to each');
  });

  it('quiet when fewer than 3 confident students', async () => {
    const admin = makeAdmin({
      enrollments: [{ student_id: 's1' }, { student_id: 's2' }],
      quiz_attempts: [{ student_id: 's1', learning_style: 'visual', submitted_at: '2026-06-01' }],
    });
    const out = await loadClassLearningStyle(admin, 'c1');
    expect(out).toEqual({ styles: [], line: null });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/insights/__tests__/loadClassLearningStyle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/insights/loadClassLearningStyle.ts
// Class learning-style reassurance rollup (the moat). Teacher-only, NEVER per-student.
// Learning style is INFERRED from behavior and falls back to 'emerging' (the low-confidence
// sentinel) — so we exclude 'emerging'/null, and only speak when there's a real, confident mix.
// Copy says "differentiate", never "adapt" (Marvin, 2026-06-24). DRAFT → Barb.
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeLearningStyle } from '@/lib/utils/learningStyle';

export interface ClassLearningStyle { styles: string[]; line: string | null }

// Canonical (post-normalize) → friendly teacher-facing label.
const FRIENDLY: Record<string, string> = {
  visual: 'visual',
  auditory: 'auditory',
  text: 'reading-and-writing',
  kinesthetic: 'hands-on',
  social: 'discussion-based',
};
const DISPLAY_ORDER = ['visual', 'auditory', 'text', 'kinesthetic', 'social'];
const MIN_DISTINCT = 2; // need ≥2 confident styles to claim a "mix"
const MIN_STUDENTS = 3; // and ≥3 students with a confident style

/** Reassurance sentence from friendly labels (deterministic order). null below MIN_DISTINCT. */
export function learningStyleLine(friendly: string[]): string | null {
  if (friendly.length < MIN_DISTINCT) return null;
  const list =
    friendly.length === 2
      ? `${friendly[0]} and ${friendly[1]}`
      : `${friendly.slice(0, -1).join(', ')}, and ${friendly[friendly.length - 1]}`;
  return `Your class spans ${list} learners — assignments differentiate to each.`;
}

export async function loadClassLearningStyle(
  admin: SupabaseClient,
  classId: string,
): Promise<ClassLearningStyle> {
  const { data: enr } = await admin
    .from('enrollments').select('student_id').eq('class_id', classId).eq('is_active', true);
  const studentIds = ((enr ?? []) as { student_id: string }[]).map((r) => r.student_id);
  if (studentIds.length === 0) return { styles: [], line: null };

  const { data: qa } = await admin
    .from('quiz_attempts')
    .select('student_id, learning_style, submitted_at')
    .in('student_id', studentIds)
    .order('submitted_at', { ascending: false });
  type QaRow = { student_id: string; learning_style: string | null; submitted_at: string | null };

  // Most-recent NON-emerging style per student. Rows are newest-first, but Postgres returns
  // NULL submitted_at FIRST under DESC — so skip null-dated rows (they aren't reliably "recent").
  // A null/emerging row is skipped WITHOUT marking the student seen, so an older confident style
  // still wins.
  const styleByStudent = new Map<string, string>();
  for (const raw of (qa ?? []) as QaRow[]) {
    if (styleByStudent.has(raw.student_id)) continue;
    if (raw.submitted_at == null) continue; // null-dated → not a reliable "most recent"
    if (raw.learning_style == null) continue;
    const canon = normalizeLearningStyle(raw.learning_style);
    if (canon === 'emerging') continue; // low-confidence sentinel → excluded
    styleByStudent.set(raw.student_id, canon);
  }
  if (styleByStudent.size < MIN_STUDENTS) return { styles: [], line: null };

  const present = new Set([...styleByStudent.values()]);
  const friendly = DISPLAY_ORDER.filter((c) => present.has(c)).map((c) => FRIENDLY[c]);
  return { styles: friendly, line: learningStyleLine(friendly) };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/insights/__tests__/loadClassLearningStyle.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/insights/loadClassLearningStyle.ts src/lib/insights/__tests__/loadClassLearningStyle.test.ts
git commit -m "feat(moat): loadClassLearningStyle — confidence-gated class LS reassurance line"
```

---

### Task 5: Comprehension lead sentence + compose into `loadInsights`

> **Pre-code fixes (I2, C2):** adds the comprehension-aware LEAD coach sentence (spec §5.4 — was uncovered) via a small leak-guarded helper that names the top reinforce skill, falling back to the band observation; and explicitly UPDATES the existing `loadInsights.test.ts` so it stays green (the new loaders call `admin.from(...)`, which the old `{} as never` admin can't satisfy).

**Files:**
- Create: `src/lib/copy/comprehensionObservation.ts`
- Test: `src/lib/copy/__tests__/comprehensionObservation.test.ts`
- Modify: `src/lib/insights/loadInsights.ts`
- Modify: `src/lib/insights/__tests__/loadInsights.test.ts` (existing — add mocks)
- Test: `src/lib/insights/__tests__/loadInsights.compose.test.ts` (new)

**Interfaces:**
- Consumes: `SkillComprehension`/`ClassComprehension` (Task 3); `ClassLearningStyle` (Task 4); `hasBannedWord` from `@/lib/copy/leakGuard`.
- Produces: `comprehensionObservation(skills): string | null`; `ClassInsights` extended with `comprehension` + `learning_style`.

- [ ] **Step 1: Write the failing test for the lead sentence**

```ts
// src/lib/copy/__tests__/comprehensionObservation.test.ts
import { describe, it, expect } from 'vitest';
import { comprehensionObservation } from '@/lib/copy/comprehensionObservation';
import type { SkillComprehension } from '@/lib/insights/loadClassComprehension';

const mk = (name: string, reinforce: number): SkillComprehension => ({
  skill_id: name, skill_name: name, reinforce, on_track: 0, enrich: 0,
  reinforce_students: [], on_track_students: [], enrich_students: [],
});

describe('comprehensionObservation', () => {
  it('names the top reinforce skill (skills are pre-sorted most-reinforce-first)', () => {
    expect(comprehensionObservation([mk('Equivalent fractions', 3), mk('Long division', 1)]))
      .toBe('3 students need another pass on Equivalent fractions.');
  });
  it('singularizes one student', () => {
    expect(comprehensionObservation([mk('Fractions', 1)])).toBe('One student needs another pass on Fractions.');
  });
  it('null when nothing needs reinforcement', () => {
    expect(comprehensionObservation([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/copy/__tests__/comprehensionObservation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `comprehensionObservation.ts`**

```ts
// src/lib/copy/comprehensionObservation.ts
// The lead coach sentence on Insights — names the one skill most worth a reinforcement pass.
// Counts are teacher-only (OK, like the band-mix pills). Skips any skill whose teacher/AI name
// carries a banned coach-posture word (mirrors loadInsights' concept_gaps filter). DRAFT → Barb.
import type { SkillComprehension } from '@/lib/insights/loadClassComprehension';
import { hasBannedWord } from '@/lib/copy/leakGuard';

/** Names the top reinforce skill (skills are pre-sorted most-reinforce-first). null when none. */
export function comprehensionObservation(skills: SkillComprehension[]): string | null {
  const top = skills.find((s) => s.skill_name && !hasBannedWord(s.skill_name));
  if (!top) return null;
  const who = top.reinforce === 1 ? 'One student needs' : `${top.reinforce} students need`;
  return `${who} another pass on ${top.skill_name}.`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/copy/__tests__/comprehensionObservation.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing composition test**

```ts
// src/lib/insights/__tests__/loadInsights.compose.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/signals/loadRosterSignals', () => ({
  loadRosterSignals: async () => ({
    class_id: 'c1',
    roster: [{ student_id: 's1', full_name: 'Ava', band: 'reteach', volatile: false, risk: {} }],
    focus_group: [],
    concept_gaps: [],
  }),
}));
vi.mock('@/lib/insights/loadClassComprehension', () => ({
  loadClassComprehension: async () => ({
    skills: [{ skill_id: 'sk1', skill_name: 'Fractions', reinforce: 2, on_track: 1, enrich: 0,
      reinforce_students: [], on_track_students: [], enrich_students: [] }],
    trend: { points: [], direction: null },
  }),
}));
vi.mock('@/lib/insights/loadClassLearningStyle', () => ({
  loadClassLearningStyle: async () => ({ styles: ['visual', 'hands-on'], line: 'Your class spans visual and hands-on learners — assignments differentiate to each.' }),
}));

describe('loadInsights composition', () => {
  it('includes comprehension + learning_style, and leads with a comprehension sentence', async () => {
    const { loadInsights } = await import('@/lib/insights/loadInsights');
    const out = await loadInsights({} as never, { classId: 'c1' });
    expect(out.band_mix.total).toBe(1);
    expect(out.comprehension.skills[0].skill_name).toBe('Fractions');
    expect(out.learning_style.line).toContain('differentiate');
    expect(out.observation).toBe('2 students need another pass on Fractions.');
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/lib/insights/__tests__/loadInsights.compose.test.ts`
Expected: FAIL — `out.comprehension` undefined / `observation` is the band line.

- [ ] **Step 7: Edit `loadInsights.ts`**

Add imports under the existing ones:

```ts
import { loadClassComprehension, type ClassComprehension } from '@/lib/insights/loadClassComprehension';
import { loadClassLearningStyle, type ClassLearningStyle } from '@/lib/insights/loadClassLearningStyle';
import { comprehensionObservation } from '@/lib/copy/comprehensionObservation';
```

Extend the interface:

```ts
export interface ClassInsights {
  band_mix: BandMix;
  observation: string | null;
  concept_gaps: { skill_name: string; phrase: string }[];
  comprehension: ClassComprehension;
  learning_style: ClassLearningStyle;
}
```

Replace the final `return { band_mix, observation: insightsObservation(band_mix), concept_gaps };` with:

```ts
  const [comprehension, learning_style] = await Promise.all([
    loadClassComprehension(admin, opts.classId),
    loadClassLearningStyle(admin, opts.classId),
  ]);
  // Lead with comprehension (names the top reinforce skill); fall back to the band observation;
  // null when the class is balanced/cold-start (quiet on good days).
  const observation = comprehensionObservation(comprehension.skills) ?? insightsObservation(band_mix);
  return { band_mix, observation, concept_gaps, comprehension, learning_style };
```

- [ ] **Step 8: Update the EXISTING `loadInsights.test.ts` so it stays green**

The existing test calls `loadInsights({} as never, …)` and only mocks `loadRosterSignals`; the two new loaders would call `admin.from(...)` on `{}` and throw. Add these two mocks at the TOP of `src/lib/insights/__tests__/loadInsights.test.ts` (alongside its existing setup; if it uses `vi.spyOn` for the roster, `vi.mock` for these two is the cleanest, hoisted form):

```ts
vi.mock('@/lib/insights/loadClassComprehension', () => ({
  loadClassComprehension: async () => ({ skills: [], trend: { points: [], direction: null } }),
}));
vi.mock('@/lib/insights/loadClassLearningStyle', () => ({
  loadClassLearningStyle: async () => ({ styles: [], line: null }),
}));
```

(With empty comprehension skills, `comprehensionObservation` returns null and the lead falls back to the existing band observation, so the existing assertions about `observation` still hold.)

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/lib/insights`
Expected: PASS — the new compose test AND the existing `loadInsights.test.ts` both green.

- [ ] **Step 10: Commit**

```bash
git add src/lib/copy/comprehensionObservation.ts src/lib/copy/__tests__/comprehensionObservation.test.ts src/lib/insights/loadInsights.ts src/lib/insights/__tests__/loadInsights.test.ts src/lib/insights/__tests__/loadInsights.compose.test.ts
git commit -m "feat(moat): comprehension lead sentence + compose CL/LS into ClassInsights"
```

---

### Task 6: The three Insights moat UI sections

Three small, token-only sections, each quiet-when-empty. `<details>`/`<summary>` for the expand (native, accessible, reduced-motion-safe — no client JS state). All teacher-only.

> **Pre-code fix (M5):** `ClassComprehensionTrend` renders only once there's a real direction (`trend.direction != null`, i.e. ≥3 weeks) — no silent 2-dot graph.

**Files:**
- Create: `src/app/(teacher)/insights/_components/ComprehensionBySkill.tsx`
- Create: `src/app/(teacher)/insights/_components/ClassComprehensionTrend.tsx`
- Create: `src/app/(teacher)/insights/_components/HowClassLearns.tsx`
- Test: `src/app/(teacher)/insights/_components/__tests__/moatSections.test.tsx`

**Interfaces:**
- Consumes: `SkillComprehension`, `StudentRef`, `ClassComprehension` (Task 3); `ClassLearningStyle` (Task 4); `Card` (`@/components/core/Card`), `SectionLabel` (`../../_components/SectionLabel`), `GradeTrendSparkline` (`@/components/core/GradeTrendSparkline`), `next/link`.
- Produces: `ComprehensionBySkill({ skills, classId })`, `ClassComprehensionTrend({ trend })`, `HowClassLearns({ learningStyle })`. Consumed by Task 7.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComprehensionBySkill } from '@/app/(teacher)/insights/_components/ComprehensionBySkill';
import { ClassComprehensionTrend } from '@/app/(teacher)/insights/_components/ClassComprehensionTrend';
import { HowClassLearns } from '@/app/(teacher)/insights/_components/HowClassLearns';

const skill = {
  skill_id: 'sk1', skill_name: 'Equivalent fractions',
  reinforce: 2, on_track: 1, enrich: 0,
  reinforce_students: [{ student_id: 's1', full_name: 'Ava Ng' }],
  on_track_students: [{ student_id: 's2', full_name: 'Ben Ortiz' }],
  enrich_students: [],
};

describe('ComprehensionBySkill', () => {
  it('renders the tally in the 3 verbs and links names to the Skill Map', () => {
    render(<ComprehensionBySkill skills={[skill]} classId="c1" />);
    expect(screen.getByText('Equivalent fractions')).toBeInTheDocument();
    expect(screen.getByText(/2 Reinforce · 1 On Track · 0 Enrich/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Ava Ng' });
    expect(link).toHaveAttribute('href', '/students/s1?class=c1');
  });
  it('is quiet (renders nothing) when there are no skills', () => {
    const { container } = render(<ComprehensionBySkill skills={[]} classId="c1" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ClassComprehensionTrend', () => {
  it('shows a soft direction line + sparkline, and surfaces NO raw percentage', () => {
    render(<ClassComprehensionTrend trend={{ points: [
      { date: '2026-05-04', index: 40 }, { date: '2026-05-11', index: 70 }, { date: '2026-05-18', index: 85 },
    ], direction: 'climbing' }} />);
    expect(screen.getByText(/has been climbing/i)).toBeInTheDocument();
    expect(screen.getByTestId('grade-trend-sparkline')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull(); // no raw % printed
  });
  it('is quiet until there is a real direction (no silent 2-dot graph)', () => {
    const { container } = render(<ClassComprehensionTrend trend={{ points: [
      { date: '2026-05-04', index: 40 }, { date: '2026-05-11', index: 80 },
    ], direction: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('HowClassLearns', () => {
  it('renders the reassurance line', () => {
    render(<HowClassLearns learningStyle={{ styles: ['visual', 'hands-on'], line: 'Your class spans visual and hands-on learners — assignments differentiate to each.' }} />);
    expect(screen.getByText(/differentiate to each/)).toBeInTheDocument();
  });
  it('is quiet when there is no line', () => {
    const { container } = render(<HowClassLearns learningStyle={{ styles: [], line: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run "src/app/(teacher)/insights/_components/__tests__/moatSections.test.tsx"`
Expected: FAIL — components not found.

- [ ] **Step 3: Write `ComprehensionBySkill.tsx`**

```tsx
// src/app/(teacher)/insights/_components/ComprehensionBySkill.tsx
// Whole-class comprehension, one row per skill that needs attention. The tally uses the 3
// teacher verbs only. Native <details> reveals who sits in each bucket; each name links to that
// student's existing Skill Map. Teacher-only; quiet when nothing needs attention.
import React from 'react';
import Link from 'next/link';
import { Card } from '@/components/core/Card';
import { SectionLabel } from '../../_components/SectionLabel';
import type { SkillComprehension, StudentRef } from '@/lib/insights/loadClassComprehension';

function NameList({ label, students, classId }: { label: string; students: StudentRef[]; classId: string }): React.JSX.Element | null {
  if (students.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-fg text-xs font-semibold uppercase tracking-wide">{label}</span>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {students.map((s) => (
          <li key={s.student_id}>
            <Link
              href={`/students/${s.student_id}?class=${classId}`}
              className="text-brand text-sm underline-offset-2 hover:underline"
            >
              {s.full_name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ComprehensionBySkill({
  skills,
  classId,
}: { skills: SkillComprehension[]; classId: string }): React.JSX.Element | null {
  if (skills.length === 0) return null; // quiet when nothing needs attention
  return (
    <Card tone="surface">
      <div className="flex flex-col gap-3">
        <SectionLabel tone="warn">Comprehension by skill</SectionLabel>
        <ul className="flex flex-col gap-3">
          {skills.map((s) => (
            <li key={s.skill_id}>
              <details className="group">
                <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-0.5 text-fg">
                  <span className="font-semibold">{s.skill_name}</span>
                  <span className="text-fg text-sm whitespace-nowrap">
                    {s.reinforce} Reinforce · {s.on_track} On Track · {s.enrich} Enrich
                  </span>
                  <span className="text-fg-muted ml-auto text-xs group-open:hidden">See who</span>
                  <span className="text-fg-muted ml-auto hidden text-xs group-open:inline">Hide</span>
                </summary>
                <div className="mt-2 flex flex-col gap-2 pl-1">
                  <NameList label="Reinforce" students={s.reinforce_students} classId={classId} />
                  <NameList label="On Track" students={s.on_track_students} classId={classId} />
                  <NameList label="Enrich" students={s.enrich_students} classId={classId} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
export default ComprehensionBySkill;
```

- [ ] **Step 4: Write `ClassComprehensionTrend.tsx`**

```tsx
// src/app/(teacher)/insights/_components/ClassComprehensionTrend.tsx
// Over-time class comprehension. Soft direction sentence + the shared sparkline SHAPE.
// Point tooltips show the WEEK, never a raw %. Quiet until there's a real direction (≥3 weeks),
// so we never show a silent 2-dot graph. DRAFT → Barb.
import React from 'react';
import { Card } from '@/components/core/Card';
import { SectionLabel } from '../../_components/SectionLabel';
import { GradeTrendSparkline } from '@/components/core/GradeTrendSparkline';
import type { ClassComprehension } from '@/lib/insights/loadClassComprehension';

const DIRECTION_LINE: Record<'climbing' | 'steady' | 'sliding', string> = {
  climbing: 'Comprehension here has been climbing the last few weeks.',
  steady: 'Comprehension here has been holding steady.',
  sliding: 'Comprehension here has slipped a little lately — worth a look.',
};

export function ClassComprehensionTrend({
  trend,
}: { trend: ClassComprehension['trend'] }): React.JSX.Element | null {
  // Quiet until there's a real story (direction is null below 3 weeks).
  if (!trend.direction || trend.points.length < 2) return null;
  const line = DIRECTION_LINE[trend.direction];
  // grade carries the index for the line SHAPE; label is the week, so no % is ever printed.
  const points = trend.points.map((p) => ({ date: p.date, grade: p.index, label: `Week of ${p.date}` }));
  return (
    <Card tone="surface">
      <div className="flex flex-col gap-3">
        <SectionLabel tone="brand">Over time</SectionLabel>
        <p className="text-fg text-sm">{line}</p>
        <GradeTrendSparkline points={points} ariaLabel={line} size="md" />
      </div>
    </Card>
  );
}
export default ClassComprehensionTrend;
```

- [ ] **Step 5: Write `HowClassLearns.tsx`**

```tsx
// src/app/(teacher)/insights/_components/HowClassLearns.tsx
// The class learning-style reassurance line. Teacher-only; never per-student. Quiet unless
// there's a confident mix. Copy: "differentiate", never "adapt". DRAFT → Barb.
import React from 'react';
import { Card } from '@/components/core/Card';
import { SectionLabel } from '../../_components/SectionLabel';
import type { ClassLearningStyle } from '@/lib/insights/loadClassLearningStyle';

export function HowClassLearns({
  learningStyle,
}: { learningStyle: ClassLearningStyle }): React.JSX.Element | null {
  if (!learningStyle.line) return null; // quiet when not a confident mix
  return (
    <Card tone="surface">
      <div className="flex flex-col gap-2">
        <SectionLabel tone="ok">How your class learns</SectionLabel>
        <p className="text-fg text-sm">{learningStyle.line}</p>
      </div>
    </Card>
  );
}
export default HowClassLearns;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run "src/app/(teacher)/insights/_components/__tests__/moatSections.test.tsx"`
Expected: PASS (all). If `SectionLabel`'s `tone` prop does not accept `'warn' | 'brand' | 'ok'`, open `src/app/(teacher)/_components/SectionLabel.tsx` and use the tone names it actually exports (it is the same component `BandMix` uses).

- [ ] **Step 7: Commit**

```bash
git add "src/app/(teacher)/insights/_components/ComprehensionBySkill.tsx" "src/app/(teacher)/insights/_components/ClassComprehensionTrend.tsx" "src/app/(teacher)/insights/_components/HowClassLearns.tsx" "src/app/(teacher)/insights/_components/__tests__/moatSections.test.tsx"
git commit -m "feat(moat): Insights sections — comprehension-by-skill, trend, how-class-learns"
```

---

### Task 7: Wire the Insights page + delete the superseded `SkillsToFocus`

Replace `SkillsToFocus` with `ComprehensionBySkill` (same intent, richer + actionable — resolves Barb's "Insights is redundant") and add the trend + learning-style sections.

> **Pre-code fixes (M6, M7):** the page short-circuits on a provided `class` param, so `requireRole`/`firstClassIdForTeacher` are NOT called — don't mock them. Delete the now-unused `SkillsToFocus.tsx` (only `page.tsx` imported it; no test references it).

**Files:**
- Modify: `src/app/(teacher)/insights/page.tsx`
- Delete: `src/app/(teacher)/insights/_components/SkillsToFocus.tsx`
- Test: `src/app/(teacher)/insights/__tests__/page.render.test.tsx` (new)

**Interfaces:**
- Consumes: `ClassInsights` (Task 5) + the three components (Task 6).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// class='c1' is provided, so the page never hits the no-class redirect branch — only these
// three mocks are exercised (no requireRole/firstClassIdForTeacher needed).
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess: async () => null }));
vi.mock('@/lib/supabase/server', () => ({ createAdminSupabaseClient: () => ({}) }));
vi.mock('@/lib/insights/loadInsights', () => ({
  loadInsights: async () => ({
    band_mix: { needs_reinforcement: 1, on_track: 1, ready_to_enrich: 0, not_assessed: 0, total: 2 },
    observation: '2 students need another pass on Equivalent fractions.',
    concept_gaps: [],
    comprehension: {
      skills: [{ skill_id: 'sk1', skill_name: 'Equivalent fractions', reinforce: 2, on_track: 1, enrich: 0,
        reinforce_students: [{ student_id: 's1', full_name: 'Ava Ng' }], on_track_students: [], enrich_students: [] }],
      trend: { points: [{ date: '2026-05-04', index: 40 }, { date: '2026-05-11', index: 70 }, { date: '2026-05-18', index: 85 }], direction: 'climbing' },
    },
    learning_style: { styles: ['visual', 'hands-on'], line: 'Your class spans visual and hands-on learners — assignments differentiate to each.' },
  }),
}));

describe('Insights page renders the moat sections', () => {
  it('shows comprehension-by-skill, the trend, and the learning-style line', async () => {
    const { default: InsightsPage } = await import('@/app/(teacher)/insights/page');
    const ui = await InsightsPage({ searchParams: Promise.resolve({ class: 'c1' }) });
    render(ui);
    expect(screen.getByText('Comprehension by skill')).toBeInTheDocument();
    expect(screen.getByText(/has been climbing/i)).toBeInTheDocument();
    expect(screen.getByText(/differentiate to each/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run "src/app/(teacher)/insights/__tests__/page.render.test.tsx"`
Expected: FAIL — "Comprehension by skill" not found (page still renders `SkillsToFocus`).

- [ ] **Step 3: Edit `page.tsx`**

Replace `import { SkillsToFocus } from './_components/SkillsToFocus';` with:

```tsx
import { ComprehensionBySkill } from './_components/ComprehensionBySkill';
import { ClassComprehensionTrend } from './_components/ClassComprehensionTrend';
import { HowClassLearns } from './_components/HowClassLearns';
```

Replace the final returned JSX block (the one with `<BandMix .../>` and `<SkillsToFocus .../>`) with:

```tsx
  return (
    <div className="p-5 flex flex-col gap-5">
      <PageHeader title="Insights" kicker="Trends on your class right now" accent="brand" />
      {data.observation && <SummaryCallout>{data.observation}</SummaryCallout>}
      <BandMix mix={data.band_mix} />
      <ComprehensionBySkill skills={data.comprehension.skills} classId={classId} />
      <ClassComprehensionTrend trend={data.comprehension.trend} />
      <HowClassLearns learningStyle={data.learning_style} />
    </div>
  );
```

(`classId` is the resolved non-empty searchParam already in scope here.)

- [ ] **Step 4: Delete the superseded component**

```bash
git rm "src/app/(teacher)/insights/_components/SkillsToFocus.tsx"
```

(First confirm nothing else imports it: `grep -rn "SkillsToFocus" src` should now show only the deletion. If another file imports it, stop and report.)

- [ ] **Step 5: Run it to verify it passes + no broken imports**

Run: `npx vitest run "src/app/(teacher)/insights/__tests__/page.render.test.tsx"` then `npx tsc --noEmit`
Expected: PASS; tsc 0 (no dangling `SkillsToFocus` import).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(teacher)/insights/page.tsx" "src/app/(teacher)/insights/__tests__/page.render.test.tsx"
git commit -m "feat(moat): wire Insights page; comprehension-by-skill replaces skills-to-focus"
```

---

### Task 8: Extract `isoWeekMonday` + extend the weekly-snapshot cron

Extract `isoWeekMonday` into an import-safe util (so the seed script can use it without pulling `next/server`), and have the cron also write `skill_state_snapshots` per student — AFTER the primary `student_model_snapshots` upsert so a snapshot-table hiccup can never suppress the primary write.

> **Pre-code fixes (C3, M2, M3):** the new upsert goes AFTER the primary one; the existing cron test mock gets a `skill_state_snapshots` branch (otherwise the unknown-table fallthrough has no `.upsert` and throws, blanking every captured-upsert assertion); the new test uses the real `NextRequest`; `isoWeekMonday` moves to `src/lib/dates/isoWeekMonday.ts` and the route re-exports it (back-compat for any importer).

**Files:**
- Create: `src/lib/dates/isoWeekMonday.ts`
- Test: `src/lib/dates/__tests__/isoWeekMonday.test.ts`
- Modify: `src/app/api/cron/weekly-snapshot/route.ts`
- Modify: `src/app/api/cron/weekly-snapshot/__tests__/route.test.ts` (existing mock)
- Test: `src/app/api/cron/weekly-snapshot/__tests__/skillStateSnapshots.test.ts` (new)

**Interfaces:**
- Produces: `isoWeekMonday(ref: Date): string` from `@/lib/dates/isoWeekMonday` (re-exported by the route). Consumes the `skill_state_snapshots` table (Task 1) with `onConflict: 'student_id,skill_id,snapshot_date'`.

- [ ] **Step 1: Write the failing test for the util**

```ts
// src/lib/dates/__tests__/isoWeekMonday.test.ts
import { describe, it, expect } from 'vitest';
import { isoWeekMonday } from '@/lib/dates/isoWeekMonday';

describe('isoWeekMonday', () => {
  it('returns the ISO-week Monday (UTC) for a midweek date', () => {
    expect(isoWeekMonday(new Date('2026-05-13T00:00:00Z'))).toBe('2026-05-11'); // Wed → Mon
  });
  it('maps Sunday back to the prior Monday', () => {
    expect(isoWeekMonday(new Date('2026-05-17T00:00:00Z'))).toBe('2026-05-11'); // Sun → Mon
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/dates/__tests__/isoWeekMonday.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the util**

```ts
// src/lib/dates/isoWeekMonday.ts
// Import-safe (no next/server) ISO-week-Monday helper, shared by the weekly-snapshot cron and
// the demo backfill script. Deterministic: the caller passes the reference date.
// ISO week: Monday = 1 … Sunday = 0. Offset: dow === 0 (Sun) → -6 days; else 1 − dow.
export function isoWeekMonday(ref: Date): string {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  const dow = d.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Point the route at the util (keep its export for back-compat)**

In `src/app/api/cron/weekly-snapshot/route.ts`, DELETE the local `export function isoWeekMonday(...) { … }` definition and its doc comment, and instead import + re-export from the util. Add near the top imports:

```ts
import { isoWeekMonday } from '@/lib/dates/isoWeekMonday';
export { isoWeekMonday } from '@/lib/dates/isoWeekMonday';
```

Run `npx vitest run src/lib/dates/__tests__/isoWeekMonday.test.ts` and `npx vitest run src/app/api/cron/weekly-snapshot` — both should still pass (the existing cron test imports `isoWeekMonday` from the route; the re-export keeps that working).

- [ ] **Step 5: Write the failing test for the new per-skill snapshot write**

```ts
// src/app/api/cron/weekly-snapshot/__tests__/skillStateSnapshots.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const upserts: Record<string, unknown[][]> = {};
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
      b.upsert = (rows: unknown[]) => { (upserts[t] ??= []).push(rows); return { error: null }; };
      (b as { then: unknown }).then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: rowsFor[t] ?? [], error: null });
      return b;
    },
  }),
}));

beforeEach(() => { for (const k of Object.keys(upserts)) delete upserts[k]; process.env.CRON_SECRET = 'sek'; });

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
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/app/api/cron/weekly-snapshot/__tests__/skillStateSnapshots.test.ts`
Expected: FAIL — `upserts['skill_state_snapshots']` undefined (route doesn't write it yet).

- [ ] **Step 7: Edit `route.ts` — extend the step-2 select + add the upsert AFTER the primary one**

In the step-2 block, change the `skillStates` select to include `skill_id` and `confidence`:

```ts
      const { data: skillStates } = await admin
        .from('skill_learning_state')
        .select('skill_id, skill:skill_id(name), state, confidence')
        .eq('student_id', student_id);
```

(The existing strength/struggle loop still reads `row.skill?.name` and `row.state` — unchanged.)

Then, immediately AFTER the existing `student_model_snapshots` upsert + its `if (upsertErr) { … continue; }` block (still inside the per-student `try`, before `processed++`), add:

```ts
      // ── Per-skill CL snapshot (moat trend history; idempotent per week) ──
      // AFTER the primary upsert so a failure here can never suppress student_model_snapshots.
      const clSnapshotRows = ((skillStates ?? []) as unknown as {
        skill_id: string; state: string; confidence: number | null;
      }[]).map((r) => ({
        student_id,
        school_id: school_id || null,
        skill_id: r.skill_id,
        snapshot_date: snapshotDate,
        state: r.state,
        confidence: r.confidence ?? 0,
      }));
      if (clSnapshotRows.length > 0) {
        const { error: clErr } = await admin
          .from('skill_state_snapshots')
          .upsert(clSnapshotRows, { onConflict: 'student_id,skill_id,snapshot_date' });
        if (clErr) {
          console.error(`[weekly-snapshot] skill_state_snapshots upsert failed for ${student_id}:`, clErr);
        }
      }
```

- [ ] **Step 8: Update the EXISTING cron test mock so it doesn't throw on the new table**

The existing `src/app/api/cron/weekly-snapshot/__tests__/route.test.ts` `makeMockAdmin` returns a bare `{ data: [], error: null }` for unrecognized tables — which has no `.upsert`, so `admin.from('skill_state_snapshots').upsert(...)` would throw, get caught, and skip the (already-completed) primary upsert capture in some tests. Add an explicit branch BEFORE the fallthrough so the new table is awaitable AND upsertable:

```ts
      if (table === 'skill_state_snapshots') {
        return { upsert: async () => ({ data: null, error: null }) };
      }
```

(Place it alongside the other `if (table === …)` branches in that file's `makeMockAdmin`. Use the file's existing variable name for the table parameter.)

- [ ] **Step 9: Run both cron test files to verify green**

Run: `npx vitest run src/app/api/cron/weekly-snapshot`
Expected: PASS — the new `skillStateSnapshots.test.ts` AND the existing `route.test.ts` (all captured-upsert assertions still pass; the primary upsert still runs).

- [ ] **Step 10: Commit**

```bash
git add src/lib/dates/isoWeekMonday.ts src/lib/dates/__tests__/isoWeekMonday.test.ts "src/app/api/cron/weekly-snapshot/route.ts" "src/app/api/cron/weekly-snapshot/__tests__/route.test.ts" "src/app/api/cron/weekly-snapshot/__tests__/skillStateSnapshots.test.ts"
git commit -m "feat(moat): extract isoWeekMonday util; weekly cron writes per-skill CL snapshots"
```

---

### Task 9: Demo seed history + Barb copy drafts

So the demo class shows a real climbing trend in Playwright preview / Marvin's feel-test (otherwise the trend cold-starts for weeks).

> **Pre-code fixes (I1, M3, M4):** the seed wiring uses the seed's REAL variables (`studentIds` is a `Record`, `skillId` is a single nullable id, `schoolId`, `classId`); the backfill imports `isoWeekMonday` from the import-safe util via a relative path; the test imports the module relatively.

**Files:**
- Create: `scripts/backfillSkillStateSnapshots.ts`
- Modify: `scripts/seedDemo.ts`
- Modify: `STRINGS-FOR-BARB.md`
- Test: `scripts/__tests__/backfillSkillStateSnapshots.test.ts`

**Interfaces:**
- Consumes: `skill_state_snapshots` (Task 1); `isoWeekMonday` from `../src/lib/dates/isoWeekMonday` (Task 8).
- Produces: `buildSkillStateHistoryRows(args)` (pure) and `backfillSkillStateSnapshots(admin, args)`.

- [ ] **Step 1: Write the failing test (pure row builder)**

```ts
// scripts/__tests__/backfillSkillStateSnapshots.test.ts
import { describe, it, expect } from 'vitest';
import { buildSkillStateHistoryRows } from '../backfillSkillStateSnapshots';

it('emits one row per (student, skill, week) trending toward solid states', () => {
  const rows = buildSkillStateHistoryRows({
    studentIds: ['s1', 's2'], skillIds: ['sk1'], weeks: 4,
    refDate: new Date('2026-06-08T00:00:00Z'), schoolId: 'sch1',
  });
  expect(rows).toHaveLength(2 * 1 * 4); // 8
  const dates = [...new Set(rows.map((r) => r.snapshot_date))].sort();
  expect(dates).toHaveLength(4);
  const solid = (s: string) => s === 'on_track' || s === 'ready_to_extend';
  const earliest = rows.filter((r) => r.snapshot_date === dates[0]);
  const latest = rows.filter((r) => r.snapshot_date === dates[dates.length - 1]);
  expect(latest.filter((r) => solid(r.state)).length).toBeGreaterThan(earliest.filter((r) => solid(r.state)).length);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run scripts/__tests__/backfillSkillStateSnapshots.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `backfillSkillStateSnapshots.ts`**

```ts
// scripts/backfillSkillStateSnapshots.ts
// Demo/dev helper: write a few weeks of per-skill CL history so the Insights trend is visible
// before the weekly cron has accumulated real data. NOT used in production cron paths.
import type { SupabaseClient } from '@supabase/supabase-js';
import { isoWeekMonday } from '../src/lib/dates/isoWeekMonday';

export interface SkillStateHistoryRow {
  student_id: string;
  school_id: string | null;
  skill_id: string;
  snapshot_date: string;
  state: string;
  confidence: number;
}

// Older weeks skew to "needs more time"; later weeks skew to solid, so the class comprehension
// index climbs over time (honest synthetic demo data).
const EARLY = ['needs_more_time', 'needs_different_instruction', 'on_track'];
const LATE = ['on_track', 'ready_to_extend', 'needs_more_time'];

export function buildSkillStateHistoryRows(args: {
  studentIds: string[];
  skillIds: string[];
  weeks: number;
  refDate: Date;
  schoolId: string | null;
}): SkillStateHistoryRow[] {
  const { studentIds, skillIds, weeks, refDate, schoolId } = args;
  const rows: SkillStateHistoryRow[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const d = new Date(refDate.getTime() - w * 7 * 24 * 60 * 60 * 1000); // w weeks before ref
    const snapshot_date = isoWeekMonday(d);
    const pool = w >= Math.floor(weeks / 2) ? EARLY : LATE; // older half EARLY, newer half LATE
    studentIds.forEach((student_id, si) => {
      skillIds.forEach((skill_id, ki) => {
        const state = pool[(si + ki + w) % pool.length];
        rows.push({ student_id, school_id: schoolId, skill_id, snapshot_date, state, confidence: 70 });
      });
    });
  }
  return rows;
}

export async function backfillSkillStateSnapshots(
  admin: SupabaseClient,
  args: { studentIds: string[]; skillIds: string[]; weeks: number; refDate: Date; schoolId: string | null },
): Promise<void> {
  const rows = buildSkillStateHistoryRows(args);
  if (rows.length === 0) return;
  const { error } = await admin
    .from('skill_state_snapshots')
    .upsert(rows, { onConflict: 'student_id,skill_id,snapshot_date' });
  if (error) console.error('[backfillSkillStateSnapshots] upsert failed:', error);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run scripts/__tests__/backfillSkillStateSnapshots.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into `seedDemo.ts`**

Read `scripts/seedDemo.ts`. It exposes (verified in the pre-code review): `studentIds` — a `Record<string,string>` of the 8 demo students; `skillId` — a single nullable skill id; `schoolId`; `classId`. It upserts `skill_learning_state` directly (it does NOT call `recomputeSkillStatesForStudent`). Add the import at the top:

```ts
import { backfillSkillStateSnapshots } from './backfillSkillStateSnapshots';
```

and, immediately AFTER the `skill_learning_state` upsert block (where `studentIds`, `skillId`, `schoolId` are in scope), add:

```ts
  if (skillId && classId) {
    await backfillSkillStateSnapshots(admin, {
      studentIds: Object.values(studentIds),
      skillIds: [skillId],
      weeks: 6,
      refDate: new Date(),
      schoolId,
    });
  }
```

Use the seed's actual variable names if they differ (e.g. its admin client handle). Re-running the seed is idempotent (the upsert conflict key). Then run `npx tsc --noEmit` to confirm the wiring type-checks.

- [ ] **Step 6: Append the copy drafts to `STRINGS-FOR-BARB.md`**

Add a new section:

```markdown
## Insights — Class Comprehension (the moat) — DRAFT

- Lead sentence: "{N} students need another pass on {skill}." / "One student needs another pass on {skill}."
- Section label: **Comprehension by skill**
- Per-skill tally: `{n} Reinforce · {n} On Track · {n} Enrich`
- Expand affordance: **See who** / **Hide**; bucket labels **Reinforce / On Track / Enrich**
- Section label: **Over time**
  - climbing: "Comprehension here has been climbing the last few weeks."
  - steady: "Comprehension here has been holding steady."
  - sliding: "Comprehension here has slipped a little lately — worth a look."
- Section label: **How your class learns**
  - "Your class spans {styles} learners — assignments differentiate to each."  ("differentiate", never "adapt")
  - friendly style labels: visual · auditory · reading-and-writing · hands-on · discussion-based
```

- [ ] **Step 7: Commit**

```bash
git add scripts/backfillSkillStateSnapshots.ts scripts/__tests__/backfillSkillStateSnapshots.test.ts scripts/seedDemo.ts STRINGS-FOR-BARB.md
git commit -m "feat(moat): demo seed CL history (visible trend) + Barb copy drafts"
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` → 0 errors.
- [ ] `npm test` (full Vitest suite) → green (incl. the previously-existing `loadInsights.test.ts` and cron `route.test.ts`, now mock-updated).
- [ ] `npm run build` → 0 (includes the WCAG-AA contrast gate + token drift check).
- [ ] Whole-branch adversarial review (subagent-driven-development's final review) — focus: class-scoping (no cross-class bleed, JS+query); teacher-only / no-raw-number constraints; quiet-when-empty on every section; learning style never surfaces an individual or an `emerging` guess; the cron ordering (primary upsert never suppressed).
- [ ] Playwright preview of `/insights?class=<demo>` (propose-only visuals; whole-UI redesign on hold) → Marvin's merge call.

---

## Self-Review

**1. Spec coverage:**
- (a) Whole-class tally per skill, expand → names → Skill Map → Tasks 3, 6, 7. ✅
- (b) LS reassurance line, "differentiate", confidence-gated, no per-student → Tasks 4, 6. ✅
- (c) New weekly per-skill snapshot (0025) + cron + sparkline → Tasks 1, 8, 3, 6. ✅
- (d) Divergence left per-student, not in class summary → no task touches it. ✅
- (e) Fold into Insights → Tasks 5, 7. ✅
- Lead coach sentence "speaks to comprehension" (spec §3.1/§5.4) → Task 5 (`comprehensionObservation`). ✅ (pre-code I2 fix)
- Quiet-when-empty, teacher-only, no-raw-numbers, class-scoping (JS+query), RLS → Global Constraints + Task tests. ✅
- Demo visibility + Barb copy → Task 9. ✅

**2. Placeholder scan:** No TBD/"handle errors"/"similar to". Every code step shows complete code. The two read-the-existing-file touchpoints (Task 8 cron mock variable name; Task 9 seed variable names) are explicit, bounded edits against verified real structure, not placeholders.

**3. Type consistency:** `ClassComprehension`/`SkillComprehension`/`StudentRef`/`ClassComprehensionTrendPoint` defined in Task 3, consumed unchanged in Tasks 5–7 and by `comprehensionObservation` (Task 5). `ClassLearningStyle` defined in Task 4, consumed in Tasks 5–7. `clBucketOf`/`classComprehensionIndex`/`classTrendDirection` defined in Task 2, consumed in Task 3. `isoWeekMonday` defined in Task 8 util, consumed by the route (re-export) and the backfill (Task 9). Cron `onConflict: 'student_id,skill_id,snapshot_date'` (Task 8) and the seed (Task 9) match the `UNIQUE` in Task 1. `GradeTrendSparkline` prop shape (`{date, grade, label?}`, `ariaLabel`, `size`) matches the real component.

**Pre-code review fixes folded in:** C1 (JS+query scoping + mock honors `.in`), C2 (update existing `loadInsights.test.ts`), C3 (cron ordering + existing-mock update), I1 (real seed vars), I2 (lead sentence implemented), M1/M9 (null-dated skip + fixture), M2 (NextRequest), M3/M4 (`isoWeekMonday` util + relative import), M5 (trend gated on direction), M6 (drop dead mocks), M7 (delete `SkillsToFocus`), M8 (edge-case tests).
