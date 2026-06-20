# SPARK Phase 1 (Teacher-Bookended Live Loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the teacher-bookended SPARK loop in CORE V2, wired to the live SPARK platform — teacher generates a SPARK-enabled assignment → CORE notifies SPARK → student completes in SPARK → SPARK posts completion back → CORE ingests it, feeds the skill engine, and shows it on a new teacher "Spark Challenges" screen — then fold the shell's SPARK recognition (S2 sticker + S3 nav) and merge the held shell.

**Architecture:** Additive migration `0012_spark.sql` (a `spark_completions` store + assignment↔SPARK binding columns) on the existing `0008_platform.sql` substrate (`platform_links`, `webhook_idempotency_keys`, `platform_events` already exist). A small `src/lib/spark/` module (config + pure contract mappers + constant-time bearer auth + platform-link gate + create-notify). Outbound create-notify hooks the existing `assignments/generate` route (non-blocking). Inbound completion ingestion implements the existing `/api/attempts/spark-attempt-complete` 501 stub (the exact path SPARK already calls) and feeds the already-wired `recomputeSkillStatesForStudent` engine seam. A teacher-only `/challenges` screen reads completions via the admin client behind `guardClassAccess`. Shell S2/S3 fold into `TeacherSidebar`/`navConfig`. **No SPARK code change** — routing the demo school to V2 is a DB row on SPARK's side (ops SQL handoff).

**Tech Stack:** Next.js 16 App Router (React 19), TypeScript, Supabase (`@supabase/supabase-js`, `@supabase/ssr`), Tailwind v4, Vitest 4 (+ `@testing-library/react`, jsdom), Node `crypto`.

## Global Constraints

Copied verbatim from the spec (`docs/superpowers/specs/2026-06-20-spark-integration-phase1-design.md` §4) and CLAUDE.md. Every task implicitly includes these.

- **Four-audience discipline.** The `/challenges` screen is **teacher-only** (route-group `requireRole(['teacher'])` + `guardClassAccess`); it may show rubric dimensions, transfer scores, and `content_quality` framing. **No student/parent SPARK surface ships this phase.** SPARK completions feed `computeSkillState` only — existing teacher screens already render bands/CL-verbs (never raw spark numbers).
- **"Assignments", never "Homework"** in any new UI string. DB identifiers (`homework_attempts`, `hw_avg`, `core_homework_id`) keep the legacy term.
- **Tokens only / WCAG-AA.** No hardcoded hex / arbitrary `[var(--..)]` color in components; Tier-2 token classes only; content text is `text-fg` (deep ink), not `text-fg-muted`. `npm run a11y` stays green at **49 pairs** (no new token pair added this phase — see Plan Decision 5).
- **Auth + IDOR chain (every protected teacher route/page).** Pages: role gate is in `(teacher)/layout.tsx` (`requireRole(['teacher'])`), page adds `guardClassAccess(classId)`. API: `auth.getUser()` or guard. Admin client `createAdminSupabaseClient()` (sync; reads `SUPABASE_SECRET_KEY`; **bypasses RLS — guards are the IDOR backstop**).
- **Webhook discipline.** Ingestion is **idempotent** (`webhook_idempotency_keys` state machine) and **never returns 5xx** to SPARK for business outcomes — log + 200 with a status body. Reserve non-200 for auth (401) / malformed (400).
- **SPARK webhook auth = constant-time Bearer** vs `CORE_SPARK_API_SECRET` (NOT user auth). No such utility exists today — SP-3 adds one (`crypto.timingSafeEqual`, length-guarded).
- **Migrations:** next number is `0012_`, convention `NNNN_snake_case_topic.sql`, additive + idempotent (`ADD COLUMN IF NOT EXISTS`, DO-block CHECK swap). Migration DDL is regex-tested in `supabase/migrations/__tests__/migrations.test.ts`.
- **Contract values (verbatim):** create → `POST {SPARK_API_URL}/api/integration/webhooks/core`, `Authorization: Bearer {CORE_SPARK_API_SECRET}`, `X-Idempotency-Key: {core_homework_id}_{student_id}`, 35s timeout. complete (V2 implements) ← `POST /api/attempts/spark-attempt-complete`, same Bearer, key `{hw}_{student}` (submit) / `..._scored` (analyzer). `grade_band ∈ '3-5'|'6-8'|'9-12'` (K-2 rejected). `student_band`: advanced→mastery, grade_level→developing, reteach→struggling. `transfer_score = avg(non-null rubric dims) × 25`, else `score`. `locale: 'en-US'`.

---

## Plan Decisions (spec ↔ grounding reconciliations — deliberate, not omissions)

These resolve tensions the verbatim grounding surfaced. The final whole-branch review should treat them as decided, not as defects.

1. **License gate = `platform_links` spark-row presence.** No `spark_experiences` table exists; V2 licensing is `school_licenses` with `feature_overrides`/`feature_blocks` JSONB. The spec's fallback ("else gate on the `platform_links` row") is the path: `isSparkEnabled(admin, schoolId)` returns true iff an enabled `product='spark'` row exists.
2. **No central config module.** Env is read inline. We add `src/lib/spark/config.ts` (the `src/lib/ai/models.ts` `process.env.X || 'default'` idiom) + `.env.example` line + `config.test.ts` `requiredKeys` entry.
3. **`external_identities` resolver dropped from Phase 1.** Completions are CORE-native (SPARK echoes `users.id` + `assignments.id`); a resolver would have zero callers. Deferred (YAGNI). The substrate table stays for future providers.
4. **`core_spark_links` is SPARK-side only.** Not a V2 migration. SP-1 produces an ops SQL handoff doc; the user/ops run it on SPARK's Supabase.
5. **No new SPARK-orange token.** S2 renders `spark.svg` (full-color illustration = decorative/non-text color, allowed) on the white plate; the "Inside CORE" tag uses `text-fg`. This keeps the a11y gate at **49 pairs** — no `PAIRS`/`SIDEBAR_PAIRS` change, no count-assertion bump.
6. **Engagement filter stays in `computeSkillState`.** The engine already filters `non_engaged`/`minimal` (computeSkillState.ts:225-230) and counts raw contact for the `not_attempted` guard. The seam passes **all** completions through; no pre-filter at gather.
7. **Ingestion at `/api/attempts/spark-attempt-complete`.** That 501 stub is the exact path SPARK calls. The orphan `/api/integrations/core` 501 stub is left untouched (out of scope; harmless).
8. **Admin provisioning route deferred.** SP-1 ships `provisionSparkLink()` (lib helper) + a demo-seed call; a dedicated super-admin UI/route is not needed to demo (deferred).

---

## File Structure

**New files**
- `supabase/migrations/0012_spark.sql` — `spark_completions` table + `assignments` spark binding columns.
- `src/lib/spark/config.ts` — `SPARK_API_URL`, `CORE_SPARK_API_SECRET` (env-with-default).
- `src/lib/spark/contract.ts` — pure mappers: `bandToSparkBand`, `gradeToBand`, `computeTransferScore`, `transferWord`.
- `src/lib/spark/auth.ts` — `safeEqual`, `bearerMatches` (constant-time).
- `src/lib/spark/sparkLink.ts` — `getSparkLink`, `isSparkEnabled`, `provisionSparkLink`.
- `src/lib/spark/notifyAssignmentCreated.ts` — CORE→SPARK create-notify.
- `src/lib/spark/loadChallenges.ts` — teacher screen data loader.
- `src/app/(teacher)/challenges/page.tsx` + `_components/ChallengeCard.tsx` — the Spark Challenges screen.
- Test files alongside each (see per-task `Test:` lines).
- `docs/superpowers/specs/spark-phase1-ops-handoff.md` — ops SQL + env handoff.

**Modified files**
- `src/app/api/teacher/assignments/generate/route.ts` — widen select; non-blocking create-notify hook.
- `src/app/api/attempts/spark-attempt-complete/route.ts` — implement ingestion (replace 501 stub).
- `src/app/api/cron/idempotency-sweep/route.ts` — implement sweep (replace 501 stub).
- `src/lib/skills/recomputeSkillStates.ts` — gather `spark_completions` → replace `spark: []` seam.
- `src/app/(teacher)/_components/navConfig.ts` + `SidebarNav.tsx` — S3 CHALLENGES nav entry + bolt icon wiring.
- `src/components/core/icons.tsx` — `IconBolt`.
- `src/app/(teacher)/_components/TeacherSidebar.tsx` — S2 SPARK sticker.
- `scripts/seedDemo.ts` — SPARK link + seeded completions (demoable without live round-trip).
- `.env.example` + `src/lib/__tests__/config.test.ts` — `SPARK_API_URL` key.
- `supabase/migrations/__tests__/migrations.test.ts` — `0012` DDL assertions.

---

## Task ordering & dependencies

T1 (migration) first — everything DB-touching depends on it. T2/T3/T4 pure foundation (independent). T5 gate (after T1). T6 notify (after T2, T3). T7 route hook (after T5, T6). T8 ingestion (after T1, T3, T4). T9 engine seam (after T1). T10 cron (independent of T1 — `webhook_idempotency_keys` exists in 0008). T11/T12 shell (backend-independent). T13 screen (after T1). T14 seed (after T1, T5). T15 ops doc (independent). Linear build order: **T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12 → T13 → T14 → T15.**

---

## Task 1: Migration `0012_spark.sql` — completion store + assignment binding

**Files:**
- Create: `supabase/migrations/0012_spark.sql`
- Modify: `supabase/migrations/__tests__/migrations.test.ts` (add `0012` DDL assertions, following the existing `platform_links` assertions ~lines 506-560)

**Interfaces:**
- Produces (DB): table `public.spark_completions` with `UNIQUE (assignment_id, student_id)` (upsert conflict target for T8/T14); columns `assignments.spark_assignment_id|spark_attempt_id|spark_experiment_id|spark_status` (T7 writes; T13 reads `spark_status`).

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/0012_spark.sql`:

```sql
-- 0012_spark.sql — SPARK Phase 1: completion ingestion store + assignment↔SPARK binding.
-- Additive + idempotent. Builds on 0008_platform.sql (platform_links/webhook_idempotency_keys/
-- platform_events already exist). RLS mirrors 0011_signals.sql misconception_observations
-- (service_role full; staff school-scoped SELECT; no student/parent read).
-- NOT applied live here — apply via Supabase MCP at merge time (see ops handoff doc).

-- ── 1. Assignment ↔ SPARK binding columns (additive) ──────────────────────────
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS spark_assignment_id text,   -- CORE-generated correlation id sent to SPARK
  ADD COLUMN IF NOT EXISTS spark_attempt_id    text,   -- SPARK's returned spark_attempt_id
  ADD COLUMN IF NOT EXISTS spark_experiment_id text,   -- SPARK's returned synthetic_experiment_id
  ADD COLUMN IF NOT EXISTS spark_status        text DEFAULT 'none';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignments_spark_status_check') THEN
    ALTER TABLE public.assignments
      ADD CONSTRAINT assignments_spark_status_check
      CHECK (spark_status IN ('none','notified','created','in_progress','completed','notify_failed'));
  END IF;
END $$;

-- ── 2. spark_completions — one row per (assignment, student); analyzer pass updates it ───
CREATE TABLE IF NOT EXISTS public.spark_completions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid        REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id        uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  assignment_id     uuid        NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  spark_attempt_id  text,
  score             int2,
  effort_label      text,
  rubric_dimensions jsonb,
  content_quality   text        CHECK (content_quality IN ('engaged','minimal','non_engaged')),
  transfer_score    int2,
  revision_count    int,
  teli_hint_count   int,
  signal_summary    jsonb,
  completed_at      timestamptz,
  received_at       timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE (assignment_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_spark_completions_student    ON public.spark_completions (student_id);
CREATE INDEX IF NOT EXISTS idx_spark_completions_assignment ON public.spark_completions (assignment_id);
CREATE INDEX IF NOT EXISTS idx_spark_completions_school     ON public.spark_completions (school_id);

-- ── 3. RLS: service_role full; staff (teacher/admin) school-scoped SELECT; no student/parent ──
ALTER TABLE public.spark_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "spark_completions_service_role_all" ON public.spark_completions;
CREATE POLICY "spark_completions_service_role_all" ON public.spark_completions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "spark_completions_staff_read" ON public.spark_completions;
CREATE POLICY "spark_completions_staff_read" ON public.spark_completions
  FOR SELECT TO authenticated
  USING (
    (public.get_my_role() IN ('teacher','school_admin','school_sysadmin','platform_admin')
       AND school_id = public.get_my_school_id())
    OR public.is_platform_admin()
  );

GRANT SELECT ON public.spark_completions TO authenticated, anon;
GRANT ALL    ON public.spark_completions TO service_role;
```

- [ ] **Step 2: Add the failing migration test assertions**

In `supabase/migrations/__tests__/migrations.test.ts`, find the block that reads/asserts `0008_platform.sql` shapes (the `platform_links`/`external_identities` assertions ~lines 506-560) and add an analogous `describe`/`it` block for `0012_spark.sql`. Use the file's established idiom (read the SQL file, regex-assert). Add:

```ts
describe('0012_spark.sql', () => {
  const sql = readFileSync(
    join(__dirname, '..', '0012_spark.sql'),
    'utf8',
  );

  it('adds spark binding columns to assignments (idempotent)', () => {
    expect(sql).toMatch(/ALTER TABLE public\.assignments/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS spark_assignment_id/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS spark_attempt_id/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS spark_experiment_id/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS spark_status\s+text DEFAULT 'none'/);
    expect(sql).toMatch(/assignments_spark_status_check/);
  });

  it('creates spark_completions with the (assignment_id, student_id) upsert key + cascade FKs', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.spark_completions/);
    expect(sql).toMatch(/assignment_id\s+uuid\s+NOT NULL REFERENCES public\.assignments\(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/student_id\s+uuid\s+NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/UNIQUE \(assignment_id, student_id\)/);
    expect(sql).toMatch(/content_quality\s+text\s+CHECK \(content_quality IN \('engaged','minimal','non_engaged'\)\)/);
  });

  it('enables RLS with service_role-all + staff-only school-scoped read (no student/parent)', () => {
    expect(sql).toMatch(/ALTER TABLE public\.spark_completions ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/spark_completions_service_role_all/);
    expect(sql).toMatch(/spark_completions_staff_read/);
    expect(sql).toMatch(/public\.get_my_role\(\) IN \('teacher','school_admin','school_sysadmin','platform_admin'\)/);
  });
});
```

> If `readFileSync`/`join` aren't already imported at the top of the test file, match the existing imports there (the file already reads other migration `.sql` files, so the helpers exist — reuse them rather than re-importing).

- [ ] **Step 3: Run the migration test (it should pass once the SQL exists)**

Run: `npx vitest run supabase/migrations/__tests__/migrations.test.ts`
Expected: the three new `0012_spark.sql` assertions PASS (the SQL file written in Step 1 satisfies them).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0012_spark.sql supabase/migrations/__tests__/migrations.test.ts
git commit -m "feat(spark): 0012 migration — spark_completions + assignment binding cols"
```

> **Live apply is deferred to the merge sequence** (Supabase MCP), not this task. Code/tests use mocks and do not depend on live application.

---

## Task 2: SPARK config module + `.env.example` contract

**Files:**
- Create: `src/lib/spark/config.ts`
- Modify: `.env.example` (add `SPARK_API_URL=` under the Spark block)
- Modify: `src/lib/__tests__/config.test.ts` (add `'SPARK_API_URL'` to `requiredKeys`)
- Test: `src/lib/spark/__tests__/config.test.ts`

**Interfaces:**
- Produces: `SPARK_API_URL: string`, `CORE_SPARK_API_SECRET: string` from `@/lib/spark/config`.

- [ ] **Step 1: Write the failing config test**

Create `src/lib/spark/__tests__/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('spark/config', () => {
  it('defaults SPARK_API_URL to the prod SPARK host when env is unset', async () => {
    delete process.env.SPARK_API_URL;
    const { SPARK_API_URL } = await import('../config');
    expect(SPARK_API_URL).toBe('https://spark.inteliflowai.com');
  });

  it('CORE_SPARK_API_SECRET falls back to empty string when unset', async () => {
    const { CORE_SPARK_API_SECRET } = await import('../config');
    expect(typeof CORE_SPARK_API_SECRET).toBe('string');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/spark/__tests__/config.test.ts`
Expected: FAIL — `Cannot find module '../config'`.

- [ ] **Step 3: Write `src/lib/spark/config.ts`**

```ts
// src/lib/spark/config.ts
// SPARK integration config. Mirrors the repo's env idiom (src/lib/ai/models.ts):
// read process.env at module top-level with a sensible default. There is no
// central config module — these two exports are the SPARK config surface.
export const SPARK_API_URL = process.env.SPARK_API_URL || 'https://spark.inteliflowai.com';
export const CORE_SPARK_API_SECRET = process.env.CORE_SPARK_API_SECRET || '';
```

- [ ] **Step 4: Add `SPARK_API_URL=` to `.env.example`**

Under the existing Spark block (after `CORE_SPARK_API_SECRET=`):

```
# Spark contract (HS256 JWT signing + Spark->CORE return Bearer)
CORE_SPARK_API_SECRET=
SPARK_API_URL=
```

> `.env.example` is names-only (no values) — `config.test.ts` asserts every non-comment line has an empty value.

- [ ] **Step 5: Add `'SPARK_API_URL'` to `requiredKeys` in `src/lib/__tests__/config.test.ts`**

In the hardcoded `requiredKeys` array (~line 34, near `'CORE_SPARK_API_SECRET'`), add `'SPARK_API_URL'`.

- [ ] **Step 6: Run both config tests**

Run: `npx vitest run src/lib/spark/__tests__/config.test.ts src/lib/__tests__/config.test.ts`
Expected: PASS (the default-fallback unit tests + the `.env.example` presence/no-placeholder checks).

- [ ] **Step 7: Commit**

```bash
git add src/lib/spark/config.ts .env.example src/lib/__tests__/config.test.ts src/lib/spark/__tests__/config.test.ts
git commit -m "feat(spark): config module (SPARK_API_URL, CORE_SPARK_API_SECRET) + .env contract"
```

---

## Task 3: Pure contract mappers

**Files:**
- Create: `src/lib/spark/contract.ts`
- Test: `src/lib/spark/__tests__/contract.test.ts`

**Interfaces:**
- Produces: `type CoreBand`, `type SparkBand`, `type GradeBand`, `type RubricDimensions`; `bandToSparkBand(band)`, `gradeToBand(grade)`, `computeTransferScore(rubric, score)`, `transferWord(score)`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/spark/__tests__/contract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bandToSparkBand, gradeToBand, computeTransferScore, transferWord } from '../contract';

describe('bandToSparkBand', () => {
  it('maps CORE bands to SPARK bands', () => {
    expect(bandToSparkBand('advanced')).toBe('mastery');
    expect(bandToSparkBand('grade_level')).toBe('developing');
    expect(bandToSparkBand('reteach')).toBe('struggling');
  });
});

describe('gradeToBand', () => {
  it('maps grades 3-12 into bands; null for K-2 / unparseable', () => {
    expect(gradeToBand('4')).toBe('3-5');
    expect(gradeToBand('Grade 7')).toBe('6-8');
    expect(gradeToBand(11)).toBe('9-12');
    expect(gradeToBand('2')).toBeNull();      // K-2 rejected by SPARK
    expect(gradeToBand('K')).toBeNull();
    expect(gradeToBand(null)).toBeNull();
  });
});

describe('computeTransferScore', () => {
  it('averages non-null rubric dims × 25', () => {
    // avg(4,4,3,4,3,3) = 3.5 → ×25 = 87.5 → round 88
    expect(
      computeTransferScore(
        { problem_understanding: 4, reasoning_strategy: 4, use_of_evidence: 3, creativity_application: 4, communication: 3, reflection_metacognition: 3, collaboration: null },
        null,
      ),
    ).toBe(88);
  });
  it('falls back to score when rubric absent/empty', () => {
    expect(computeTransferScore(null, 72)).toBe(72);
    expect(computeTransferScore({ collaboration: null }, 64)).toBe(64);
  });
  it('returns null when neither rubric nor score is usable', () => {
    expect(computeTransferScore(null, null)).toBeNull();
  });
});

describe('transferWord', () => {
  it('words the transfer score on SPARK thresholds (70 strong, 50 developing)', () => {
    expect(transferWord(88)).toBe('strong');
    expect(transferWord(60)).toBe('developing');
    expect(transferWord(30)).toBe('emerging');
    expect(transferWord(null)).toBe('not yet scored');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/spark/__tests__/contract.test.ts`
Expected: FAIL — `Cannot find module '../contract'`.

- [ ] **Step 3: Write `src/lib/spark/contract.ts`**

```ts
// src/lib/spark/contract.ts — pure CORE↔SPARK contract mappers (no I/O).
export type CoreBand = 'reteach' | 'grade_level' | 'advanced';
export type SparkBand = 'mastery' | 'developing' | 'struggling';
export type GradeBand = '3-5' | '6-8' | '9-12';

export interface RubricDimensions {
  problem_understanding: number | null;
  reasoning_strategy: number | null;
  use_of_evidence: number | null;
  creativity_application: number | null;
  communication: number | null;
  reflection_metacognition: number | null;
  collaboration: number | null;
}

const BAND_MAP: Record<CoreBand, SparkBand> = {
  advanced: 'mastery',
  grade_level: 'developing',
  reteach: 'struggling',
};

export function bandToSparkBand(band: CoreBand): SparkBand {
  return BAND_MAP[band];
}

/** Map a CORE grade to a SPARK grade_band. null = K-2 / unparseable (SPARK rejects K-2). */
export function gradeToBand(grade: string | number | null | undefined): GradeBand | null {
  if (grade == null) return null;
  const m = String(grade).match(/\d{1,2}/);
  if (!m) return null;
  const n = Number(m[0]);
  if (n >= 3 && n <= 5) return '3-5';
  if (n >= 6 && n <= 8) return '6-8';
  if (n >= 9 && n <= 12) return '9-12';
  return null;
}

/** transfer_score = avg(non-null rubric dims) × 25, else fall back to score. Rounded int, or null. */
export function computeTransferScore(
  rubric: Partial<RubricDimensions> | null | undefined,
  score: number | null | undefined,
): number | null {
  if (rubric) {
    const vals = Object.values(rubric).filter((v): v is number => typeof v === 'number');
    if (vals.length > 0) {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      return Math.round(avg * 25);
    }
  }
  return typeof score === 'number' ? Math.round(score) : null;
}

/** Teacher-facing word for a transfer score. SPARK thresholds: 70 strong, 50 developing. */
export function transferWord(score: number | null | undefined): string {
  if (typeof score !== 'number') return 'not yet scored';
  if (score >= 70) return 'strong';
  if (score >= 50) return 'developing';
  return 'emerging';
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/spark/__tests__/contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spark/contract.ts src/lib/spark/__tests__/contract.test.ts
git commit -m "feat(spark): pure contract mappers (band, grade_band, transfer_score, word)"
```

---

## Task 4: Constant-time bearer auth utility

**Files:**
- Create: `src/lib/spark/auth.ts`
- Test: `src/lib/spark/__tests__/auth.test.ts`

**Interfaces:**
- Produces: `safeEqual(a, b): boolean`, `bearerMatches(authHeader, secret): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/spark/__tests__/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { safeEqual, bearerMatches } from '../auth';

describe('safeEqual', () => {
  it('true for equal strings, false otherwise (incl. length mismatch)', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('bearerMatches', () => {
  const secret = 'test-spark-secret';
  it('true only for an exact "Bearer <secret>" header', () => {
    expect(bearerMatches(`Bearer ${secret}`, secret)).toBe(true);
    expect(bearerMatches(`Bearer wrong`, secret)).toBe(false);
    expect(bearerMatches(secret, secret)).toBe(false);     // missing prefix
    expect(bearerMatches(null, secret)).toBe(false);
    expect(bearerMatches(`Bearer ${secret}`, '')).toBe(false); // empty secret never matches
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/spark/__tests__/auth.test.ts`
Expected: FAIL — `Cannot find module '../auth'`.

- [ ] **Step 3: Write `src/lib/spark/auth.ts`**

```ts
// src/lib/spark/auth.ts — constant-time bearer check for the SPARK ingestion webhook.
// No such utility existed in the repo; the only prior secret gate was a plain `!==`.
import { timingSafeEqual } from 'crypto';

/** Constant-time string compare. Length-guarded (timingSafeEqual throws on length mismatch). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** True iff `authHeader` is exactly `Bearer <secret>` (and secret is non-empty). */
export function bearerMatches(authHeader: string | null | undefined, secret: string): boolean {
  if (!authHeader || !secret) return false;
  const prefix = 'Bearer ';
  if (!authHeader.startsWith(prefix)) return false;
  return safeEqual(authHeader.slice(prefix.length), secret);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/spark/__tests__/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spark/auth.ts src/lib/spark/__tests__/auth.test.ts
git commit -m "feat(spark): constant-time bearer auth utility"
```

---

## Task 5: SPARK platform-link gate + provisioning helper

**Files:**
- Create: `src/lib/spark/sparkLink.ts`
- Test: `src/lib/spark/__tests__/sparkLink.test.ts`

**Interfaces:**
- Consumes: `platform_links` (0008 — `UNIQUE(school_id, product)`, `product='spark'`, `api_key NOT NULL`, `enabled`, `core_base_url`).
- Produces: `interface SparkLink { api_key; core_base_url; enabled }`; `getSparkLink(admin, schoolId): Promise<SparkLink | null>`; `isSparkEnabled(admin, schoolId): Promise<boolean>`; `provisionSparkLink(admin, { schoolId, apiKey, coreBaseUrl?, label? }): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/spark/__tests__/sparkLink.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { getSparkLink, isSparkEnabled, provisionSparkLink } from '../sparkLink';

function adminWithLink(row: unknown) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
  return { from: vi.fn(() => chain) } as never;
}

describe('getSparkLink / isSparkEnabled', () => {
  it('returns the row when an enabled spark link exists', async () => {
    const admin = adminWithLink({ api_key: 'k', core_base_url: 'https://x', enabled: true });
    expect(await getSparkLink(admin, 's1')).toEqual({ api_key: 'k', core_base_url: 'https://x', enabled: true });
    expect(await isSparkEnabled(admin, 's1')).toBe(true);
  });
  it('returns null when the link is disabled or absent', async () => {
    expect(await getSparkLink(adminWithLink({ api_key: 'k', core_base_url: null, enabled: false }), 's1')).toBeNull();
    expect(await getSparkLink(adminWithLink(null), 's1')).toBeNull();
    expect(await isSparkEnabled(adminWithLink(null), 's1')).toBe(false);
  });
});

describe('provisionSparkLink', () => {
  it('upserts product=spark on (school_id, product) and throws on error', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const admin = { from: vi.fn(() => ({ upsert })) } as never;
    await provisionSparkLink(admin, { schoolId: 's1', apiKey: 'k', coreBaseUrl: 'https://x', label: 'L' });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ school_id: 's1', product: 'spark', api_key: 'k', enabled: true }),
      { onConflict: 'school_id,product' },
    );

    const failAdmin = { from: vi.fn(() => ({ upsert: vi.fn().mockResolvedValue({ error: { message: 'boom' } }) })) } as never;
    await expect(provisionSparkLink(failAdmin, { schoolId: 's1', apiKey: 'k' })).rejects.toThrow(/boom/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/spark/__tests__/sparkLink.test.ts`
Expected: FAIL — `Cannot find module '../sparkLink'`.

- [ ] **Step 3: Write `src/lib/spark/sparkLink.ts`**

```ts
// src/lib/spark/sparkLink.ts — read/provision a school's SPARK platform_links row.
// Phase-1 SPARK gate = presence of an ENABLED product='spark' row (no license table exists).
// platform_links is RLS-deny-to-clients; callers must pass the admin (service-role) client.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface SparkLink {
  api_key: string;
  core_base_url: string | null;
  enabled: boolean;
}

export async function getSparkLink(admin: SupabaseClient, schoolId: string): Promise<SparkLink | null> {
  const { data } = await admin
    .from('platform_links')
    .select('api_key, core_base_url, enabled')
    .eq('school_id', schoolId)
    .eq('product', 'spark')
    .maybeSingle();
  if (!data || (data as SparkLink).enabled !== true) return null;
  return data as SparkLink;
}

export async function isSparkEnabled(admin: SupabaseClient, schoolId: string): Promise<boolean> {
  return (await getSparkLink(admin, schoolId)) !== null;
}

export interface ProvisionSparkLinkArgs {
  schoolId: string;
  apiKey: string;
  coreBaseUrl?: string | null;
  label?: string;
}

export async function provisionSparkLink(admin: SupabaseClient, args: ProvisionSparkLinkArgs): Promise<void> {
  const { error } = await admin.from('platform_links').upsert(
    {
      school_id: args.schoolId,
      product: 'spark',
      api_key: args.apiKey,
      core_base_url: args.coreBaseUrl ?? null,
      label: args.label ?? 'SPARK',
      enabled: true,
    },
    { onConflict: 'school_id,product' },
  );
  if (error) throw new Error(`provisionSparkLink failed: ${error.message}`);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/spark/__tests__/sparkLink.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spark/sparkLink.ts src/lib/spark/__tests__/sparkLink.test.ts
git commit -m "feat(spark): platform-link gate (isSparkEnabled) + provisionSparkLink helper"
```

---

## Task 6: CORE→SPARK create-notify lib

**Files:**
- Create: `src/lib/spark/notifyAssignmentCreated.ts`
- Test: `src/lib/spark/__tests__/notifyAssignmentCreated.test.ts`

**Interfaces:**
- Consumes: `SPARK_API_URL`/`CORE_SPARK_API_SECRET` (T2), `bandToSparkBand`/`gradeToBand` (T3).
- Produces: `interface NotifyInput { coreHomeworkId; studentId; schoolId; coreClassId?; teacherId?; band: CoreBand; learningStyle; grade; subject; conceptTags; title; content }`; `interface NotifyResult { success; sparkAssignmentId; sparkAttemptId?; syntheticExperimentId?; error?; skipped? }`; `notifyAssignmentCreated(input): Promise<NotifyResult>`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/spark/__tests__/notifyAssignmentCreated.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const BASE_INPUT = {
  coreHomeworkId: 'hw-1',
  studentId: 'stu-1',
  schoolId: 'sch-1',
  coreClassId: 'cls-1',
  band: 'grade_level' as const,
  learningStyle: 'visual',
  grade: '7',
  subject: 'Science',
  conceptTags: ['photosynthesis'],
  title: 'Energy in Ecosystems',
  content: 'Energy in Ecosystems\n\nExplore how energy flows...',
};

describe('notifyAssignmentCreated', () => {
  beforeEach(() => {
    process.env.SPARK_API_URL = 'https://spark.test';
    process.env.CORE_SPARK_API_SECRET = 'secret-x';
    vi.resetModules();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('POSTs the contract payload with Bearer + idempotency header; maps the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, spark_attempt_id: 'att-9', synthetic_experiment_id: 'exp-9' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { notifyAssignmentCreated } = await import('../notifyAssignmentCreated');

    const result = await notifyAssignmentCreated(BASE_INPUT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://spark.test/api/integration/webhooks/core');
    expect(init.headers.Authorization).toBe('Bearer secret-x');
    expect(init.headers['X-Idempotency-Key']).toBe('hw-1_stu-1');
    const body = JSON.parse(init.body);
    expect(body.event).toBe('spark_assignment_created');
    expect(body.data.core_homework_id).toBe('hw-1');
    expect(body.data.lesson_plan.grade_band).toBe('6-8');
    expect(body.data.lesson_plan.concept_tags).toEqual(['photosynthesis']);
    expect(body.data.student_profile.student_band).toBe('developing');
    expect(body.data.student_profile.locale).toBe('en-US');
    expect(body.data.student_profile.rubric_rolling_averages).toBeUndefined();
    expect(result).toMatchObject({ success: true, sparkAttemptId: 'att-9', syntheticExperimentId: 'exp-9' });
    expect(result.sparkAssignmentId).toBeTruthy();
  });

  it('skips (no fetch) when grade maps to K-2 / unparseable', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { notifyAssignmentCreated } = await import('../notifyAssignmentCreated');
    const result = await notifyAssignmentCreated({ ...BASE_INPUT, grade: '1' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, skipped: 'grade_band' });
  });

  it('returns success:false on a non-OK SPARK response (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    const { notifyAssignmentCreated } = await import('../notifyAssignmentCreated');
    const result = await notifyAssignmentCreated(BASE_INPUT);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/500/);
  });

  it('returns success:false on a thrown fetch (network/timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('aborted')));
    const { notifyAssignmentCreated } = await import('../notifyAssignmentCreated');
    const result = await notifyAssignmentCreated(BASE_INPUT);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/aborted/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/spark/__tests__/notifyAssignmentCreated.test.ts`
Expected: FAIL — `Cannot find module '../notifyAssignmentCreated'`.

- [ ] **Step 3: Write `src/lib/spark/notifyAssignmentCreated.ts`**

```ts
// src/lib/spark/notifyAssignmentCreated.ts — CORE→SPARK create-notify (V2 port of V1 contract).
// POST {SPARK_API_URL}/api/integration/webhooks/core, Bearer {CORE_SPARK_API_SECRET},
// X-Idempotency-Key {core_homework_id}_{student_id}, 35s timeout. Never throws.
// rubric_rolling_averages omitted — V2 has no SPARK history (cold-start parity).
import { randomUUID } from 'crypto';
import { SPARK_API_URL, CORE_SPARK_API_SECRET } from './config';
import { bandToSparkBand, gradeToBand, type CoreBand } from './contract';

export interface NotifyInput {
  coreHomeworkId: string;          // assignments.id
  studentId: string;               // users.id (CORE-native)
  schoolId: string;
  coreClassId?: string | null;
  teacherId?: string | null;
  band: CoreBand;
  learningStyle: string | null;
  grade: string | number | null;
  subject: string | null;
  conceptTags: string[];
  title: string;
  content: string;                 // lesson_plan.content (free-text)
}

export interface NotifyResult {
  success: boolean;
  sparkAssignmentId: string;
  sparkAttemptId?: string;
  syntheticExperimentId?: string;
  error?: string;
  skipped?: 'grade_band';
}

export async function notifyAssignmentCreated(input: NotifyInput): Promise<NotifyResult> {
  const sparkAssignmentId = randomUUID();
  const gradeBand = gradeToBand(input.grade);
  if (!gradeBand) {
    return { success: false, sparkAssignmentId, skipped: 'grade_band', error: 'grade outside 3-12 (SPARK rejects K-2)' };
  }

  const idempotencyKey = `${input.coreHomeworkId}_${input.studentId}`;
  const body = {
    event: 'spark_assignment_created',
    data: {
      spark_assignment_id: sparkAssignmentId,
      core_homework_id: input.coreHomeworkId,
      student_id: input.studentId,
      school_id: input.schoolId,
      core_class_id: input.coreClassId ?? null,
      teacher_id: input.teacherId ?? undefined,
      lesson_plan: {
        content: input.content,
        concept_tags: input.conceptTags,
        subject_domain: input.subject ?? 'general',
        title: input.title,
        grade_band: gradeBand,
      },
      student_profile: {
        grade: input.grade != null ? String(input.grade) : undefined,
        learning_style: input.learningStyle ?? undefined,
        student_band: bandToSparkBand(input.band),
        locale: 'en-US',
      },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35_000);
  try {
    const res = await fetch(`${SPARK_API_URL}/api/integration/webhooks/core`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CORE_SPARK_API_SECRET}`,
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { success: false, sparkAssignmentId, error: `SPARK HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      success?: boolean;
      spark_attempt_id?: string;
      synthetic_experiment_id?: string;
      error?: string;
    };
    return {
      success: json.success !== false,
      sparkAssignmentId,
      sparkAttemptId: json.spark_attempt_id,
      syntheticExperimentId: json.synthetic_experiment_id,
      error: json.error,
    };
  } catch (err) {
    return { success: false, sparkAssignmentId, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/spark/__tests__/notifyAssignmentCreated.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spark/notifyAssignmentCreated.ts src/lib/spark/__tests__/notifyAssignmentCreated.test.ts
git commit -m "feat(spark): CORE->SPARK create-notify lib (contract payload + 35s timeout)"
```

---

## Task 7: Hook create-notify into the assignment-generate route (non-blocking)

**Files:**
- Modify: `src/app/api/teacher/assignments/generate/route.ts`
- Test: `src/app/api/teacher/assignments/generate/__tests__/route.test.ts` (extend existing — add the SPARK cases)

**Interfaces:**
- Consumes: `getSparkLink` (T5), `notifyAssignmentCreated` (T6).
- Behavior: after the assignment row persists (between the success bail at line ~143 and the `return` at line ~145), if the student's school has an enabled SPARK link, build inputs from in-scope vars + the widened select and call `notifyAssignmentCreated`; persist `spark_assignment_id`/`spark_attempt_id`/`spark_experiment_id`/`spark_status` on the row. **Non-blocking** — any failure logs and sets `spark_status='notify_failed'`, never fails generation.

- [ ] **Step 1: Add the failing route tests**

In `src/app/api/teacher/assignments/generate/__tests__/route.test.ts`, the existing `makeAdminMock` routes `quiz_attempts`/`quiz_responses`/`assignments`. Add two cases. Because the hook reads `platform_links` and updates `assignments`, extend `makeAdminMock` so `from('platform_links')` returns a configurable chain and `from('assignments')` supports `.update().eq()`. Add to the mock's `from` router:

```ts
// inside makeAdminMock's opts, default sparkLink to null (gate off):
if (table === 'platform_links') return makeChain(opts.sparkLink ?? null);
if (table === 'users') return makeChain(opts.userRow ?? { school_id: 'sch-1', grade_level: '7' });
```

(For `assignments`, the existing branch returns `insertChain`; ensure that chain also exposes `update: vi.fn().mockReturnValue(chain)` and `eq` — `makeChain` already defines `update` + `eq`.)

Add the tests:

```ts
it('does NOT notify SPARK when the school has no enabled spark link (gate off)', async () => {
  const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
  vi.mocked(createServerSupabaseClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) },
  } as never);
  vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock({ sparkLink: null }) as never);
  mockGuardStudentAccess.mockResolvedValue(null);
  mockGenerateAssignment.mockResolvedValue({ title: 'T', instructions: 'I' });

  const notifySpy = vi.fn();
  vi.doMock('@/lib/spark/notifyAssignmentCreated', () => ({ notifyAssignmentCreated: notifySpy }));

  const { POST } = await import('@/app/api/teacher/assignments/generate/route');
  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
  expect(notifySpy).not.toHaveBeenCalled();
});

it('notifies SPARK + persists spark_status when an enabled link exists (non-blocking)', async () => {
  const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
  vi.mocked(createServerSupabaseClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) },
  } as never);
  vi.mocked(createAdminSupabaseClient).mockReturnValue(
    makeAdminMock({ sparkLink: { api_key: 'k', core_base_url: null, enabled: true } }) as never,
  );
  mockGuardStudentAccess.mockResolvedValue(null);
  mockGenerateAssignment.mockResolvedValue({ title: 'T', instructions: 'I' });

  const notifySpy = vi.fn().mockResolvedValue({
    success: true, sparkAssignmentId: 'sa-1', sparkAttemptId: 'att-1', syntheticExperimentId: 'exp-1',
  });
  vi.doMock('@/lib/spark/notifyAssignmentCreated', () => ({ notifyAssignmentCreated: notifySpy }));

  const { POST } = await import('@/app/api/teacher/assignments/generate/route');
  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
  expect(notifySpy).toHaveBeenCalledTimes(1);
});
```

> The `makeAdminMock` must default `sparkLink: null` so all PRE-EXISTING tests (which don't set it) keep the gate OFF and never call SPARK — preserving their behavior. Verify the existing suite still passes in Step 4.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run src/app/api/teacher/assignments/generate/__tests__/route.test.ts`
Expected: the two new tests FAIL (notify not wired; the gate/hook don't exist yet).

- [ ] **Step 3: Widen the select + add the hook**

In `src/app/api/teacher/assignments/generate/route.ts`:

(a) Add imports near the existing imports (lines 10-17):

```ts
import { getSparkLink } from '@/lib/spark/sparkLink';
import { notifyAssignmentCreated } from '@/lib/spark/notifyAssignmentCreated';
```

(b) Widen the `quiz_attempts` select (line ~42-44) to pull lesson grade/subject/parsed_content and the student's school + grade:

```ts
      .select(
        'id, student_id, mastery_band, learning_style, ' +
        'quizzes(class_id, lesson_id, lessons(parsed_content, title, grade_level, subject)), ' +
        'users:student_id(full_name, grade_level, school_id)',
      )
```

(c) Insert the hook between the success bail (`if (insErr || !row) { ... }`) and the `return NextResponse.json({ assignment_id: row.id, content: assignment });`:

```ts
    // ── SPARK create-notify (non-blocking; never fails assignment generation) ──
    try {
      const userRow = attempt.users as { school_id?: string; grade_level?: string | null } | null;
      const schoolId = userRow?.school_id ?? null;
      if (schoolId) {
        const link = await getSparkLink(admin, schoolId);
        if (link) {
          const lessonRow =
            ((attempt.quizzes as { lessons?: Record<string, unknown> } | null)?.lessons ?? {}) as {
              parsed_content?: { key_concepts?: string[] };
              grade_level?: string | null;
              subject?: string | null;
            };
          const grade = userRow?.grade_level ?? lessonRow.grade_level ?? null;
          const result = await notifyAssignmentCreated({
            coreHomeworkId: row.id as string,
            studentId: attempt.student_id as string,
            schoolId,
            coreClassId: classId,
            band,
            learningStyle: normalizeLearningStyle(style),
            grade,
            subject: lessonRow.subject ?? null,
            conceptTags: lessonRow.parsed_content?.key_concepts ?? [],
            title: assignment.title,
            content: `${assignment.title}\n\n${assignment.instructions}`,
          });
          await admin
            .from('assignments')
            .update({
              spark_assignment_id: result.sparkAssignmentId,
              spark_attempt_id: result.sparkAttemptId ?? null,
              spark_experiment_id: result.syntheticExperimentId ?? null,
              spark_status: result.success ? 'created' : 'notify_failed',
            })
            .eq('id', row.id);
        }
      }
    } catch (sparkErr) {
      console.error('[teacher/assignments/generate] spark notify failed (non-blocking):', sparkErr);
      try {
        await admin.from('assignments').update({ spark_status: 'notify_failed' }).eq('id', row.id);
      } catch {
        /* best-effort; never block assignment generation */
      }
    }
```

> `assignment` (the generated `Assignment` object, has `title` + `instructions`), `row`, `band`, `style`, `classId` are all in scope at this point (verified in grounding G2). `normalizeLearningStyle` is already imported.

- [ ] **Step 4: Run the full route test (new + existing must pass)**

Run: `npx vitest run src/app/api/teacher/assignments/generate/__tests__/route.test.ts`
Expected: PASS — both new SPARK cases pass AND every pre-existing case stays green (gate defaults off).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/teacher/assignments/generate/route.ts src/app/api/teacher/assignments/generate/__tests__/route.test.ts
git commit -m "feat(spark): non-blocking CORE->SPARK notify hook in assignment generation"
```

---

## Task 8: Completion ingestion route `POST /api/attempts/spark-attempt-complete`

**Files:**
- Modify: `src/app/api/attempts/spark-attempt-complete/route.ts` (replace the 501 stub)
- Test: `src/app/api/attempts/spark-attempt-complete/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `bearerMatches` (T4), `CORE_SPARK_API_SECRET` (T2), `computeTransferScore` (T3), `recomputeSkillStatesForStudent` (existing, `@/lib/skills/recomputeSkillStates`, 2-arg object form), tables `webhook_idempotency_keys`/`assignments`/`users`/`spark_completions`/`platform_events`.
- Behavior: constant-time Bearer → 401; malformed/missing ids → 400; idempotent claim (`webhook_idempotency_keys`, key = `X-Idempotency-Key` header); resolve assignment by `core_homework_id` and verify `student_id` matches; upsert `spark_completions` on `(assignment_id, student_id)`; audit `platform_events`; `await recomputeSkillStatesForStudent(admin, { studentId, schoolId, skillIds })`; **respond 200** for all business outcomes. Submit-time + `_scored` are distinct keys → both land; the upsert makes the analyzer pass overwrite rubric/score (last-writer-wins on the same row).

- [ ] **Step 1: Write the failing route tests**

Create `src/app/api/attempts/spark-attempt-complete/__tests__/route.test.ts`. Uses the repo's node idiom (`makeChain`/dynamic `await import` of the route after mocks), with the new constant-time Bearer auth pattern (set `Authorization` header):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const SECRET = 'test-spark-secret';

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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/api/attempts/spark-attempt-complete/__tests__/route.test.ts`
Expected: FAIL — the stub returns 501 for every case.

- [ ] **Step 3: Implement the route (replace the 501 stub)**

Replace the entire contents of `src/app/api/attempts/spark-attempt-complete/route.ts`:

```ts
// src/app/api/attempts/spark-attempt-complete/route.ts
// SPARK→CORE completion ingestion (the exact path SPARK's core-client.ts posts to).
// Auth: constant-time Bearer vs CORE_SPARK_API_SECRET. Identity: CORE-native (users.id +
// assignments.id) — no external_identities. Idempotent via webhook_idempotency_keys. Feeds
// the skill engine. NEVER 5xx for business outcomes (200 + status body); only 401/400 are non-200.
import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { recomputeSkillStatesForStudent } from '@/lib/skills/recomputeSkillStates';
import { bearerMatches } from '@/lib/spark/auth';
import { CORE_SPARK_API_SECRET } from '@/lib/spark/config';
import { computeTransferScore, type RubricDimensions } from '@/lib/spark/contract';

const ENDPOINT = '/api/attempts/spark-attempt-complete';
const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface AttemptCompletePayload {
  core_homework_id?: string;
  student_id?: string;
  completed_at?: string;
  score?: number | null;
  effort_label?: string | null;
  revision_count?: number;
  teli_hint_count?: number;
  signal_summary?: Record<string, unknown>;
  rubric_dimensions?: Partial<RubricDimensions> | null;
  content_quality?: 'engaged' | 'minimal' | 'non_engaged' | null;
}

type Admin = ReturnType<typeof createAdminSupabaseClient>;

async function finalize(admin: Admin, key: string, status: 'completed' | 'failed', body: unknown): Promise<void> {
  await admin
    .from('webhook_idempotency_keys')
    .update({ status, response_body: body })
    .eq('endpoint', ENDPOINT)
    .eq('idempotency_key', key);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Auth — constant-time Bearer (never user auth).
  if (!bearerMatches(req.headers.get('authorization'), CORE_SPARK_API_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse + required ids.
  let payload: AttemptCompletePayload;
  try {
    payload = (await req.json()) as AttemptCompletePayload;
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }
  const coreHomeworkId = payload.core_homework_id;
  const studentId = payload.student_id;
  if (!coreHomeworkId || !studentId) {
    return NextResponse.json({ error: 'Missing core_homework_id or student_id' }, { status: 400 });
  }

  const idempotencyKey = req.headers.get('x-idempotency-key') ?? `${coreHomeworkId}_${studentId}`;
  const admin = createAdminSupabaseClient();

  // 3. Idempotency: claim the key (in_progress). Replay → stored response.
  const claim = await admin.from('webhook_idempotency_keys').insert({
    endpoint: ENDPOINT,
    idempotency_key: idempotencyKey,
    status: 'in_progress',
    expires_at: new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString(),
  });
  if (claim.error) {
    const code = (claim.error as { code?: string }).code;
    if (code === '23505') {
      // Key already seen → return stored response if terminal, else acknowledge the concurrent run.
      const { data: existing } = await admin
        .from('webhook_idempotency_keys')
        .select('status, response_body')
        .eq('endpoint', ENDPOINT)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      const row = existing as { status?: string; response_body?: unknown } | null;
      if (row && row.status !== 'in_progress' && row.response_body) {
        return NextResponse.json(row.response_body, { status: 200 });
      }
      return NextResponse.json({ ok: true, received: true, deduped: true }, { status: 200 });
    }
    // Non-unique claim error (e.g. transient): proceed best-effort (upsert is idempotent), no finalize row to update.
    console.error('[spark-attempt-complete] idempotency claim error (proceeding best-effort):', claim.error);
  }

  try {
    // 4. Resolve the assignment (CORE-native) + verify ownership.
    const { data: assignmentRow } = await admin
      .from('assignments')
      .select('id, student_id, class_id, skill_ids')
      .eq('id', coreHomeworkId)
      .maybeSingle();
    const assignment = assignmentRow as
      | { id: string; student_id: string; class_id: string; skill_ids: string[] | null }
      | null;
    if (!assignment || assignment.student_id !== studentId) {
      const bodyOut = { ok: true, received: true, ignored: 'unknown_assignment' };
      await finalize(admin, idempotencyKey, 'failed', bodyOut);
      return NextResponse.json(bodyOut, { status: 200 });
    }

    const { data: userRow } = await admin.from('users').select('school_id').eq('id', studentId).maybeSingle();
    const schoolId = (userRow as { school_id?: string } | null)?.school_id ?? null;

    const transferScore = computeTransferScore(payload.rubric_dimensions, payload.score);

    // 5. Upsert the completion (submit-time creates; analyzer pass overwrites on the same row).
    await admin.from('spark_completions').upsert(
      {
        assignment_id: assignment.id,
        student_id: studentId,
        school_id: schoolId,
        score: typeof payload.score === 'number' ? Math.round(payload.score) : null,
        effort_label: payload.effort_label ?? null,
        rubric_dimensions: payload.rubric_dimensions ?? null,
        content_quality: payload.content_quality ?? null,
        transfer_score: transferScore,
        revision_count: payload.revision_count ?? null,
        teli_hint_count: payload.teli_hint_count ?? null,
        signal_summary: payload.signal_summary ?? null,
        completed_at: payload.completed_at ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'assignment_id,student_id' },
    );

    // 6. Audit.
    await admin.from('platform_events').insert({
      source: 'spark',
      event_type: 'spark_attempt_complete',
      school_id: schoolId,
      student_id: studentId,
      payload: {
        core_homework_id: coreHomeworkId,
        idempotency_key: idempotencyKey,
        content_quality: payload.content_quality ?? null,
        transfer_score: transferScore,
      },
      processed: true,
    });

    // 7. Feed the engine (never throws; scoped to the assignment's skills, else full per-student sweep).
    const skillIds = (assignment.skill_ids ?? []).length > 0 ? (assignment.skill_ids as string[]) : undefined;
    await recomputeSkillStatesForStudent(admin, { studentId, schoolId, skillIds });

    const bodyOut = { ok: true, received: true };
    await finalize(admin, idempotencyKey, 'completed', bodyOut);
    return NextResponse.json(bodyOut, { status: 200 });
  } catch (err) {
    console.error('[spark-attempt-complete] processing error (returning 200 per webhook discipline):', err);
    const bodyOut = { ok: true, received: true, error: 'processing_error' };
    await finalize(admin, idempotencyKey, 'failed', bodyOut);
    return NextResponse.json(bodyOut, { status: 200 });
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/app/api/attempts/spark-attempt-complete/__tests__/route.test.ts`
Expected: PASS (5 cases: 401, 400, first-write 200, replay deduped, unknown-assignment ignored).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/attempts/spark-attempt-complete/route.ts src/app/api/attempts/spark-attempt-complete/__tests__/route.test.ts
git commit -m "feat(spark): completion ingestion route (auth + idempotency + upsert + engine feed)"
```

---

## Task 9: Skill-engine seam — gather `spark_completions` into `recomputeSkillStatesForStudent`

**Files:**
- Modify: `src/lib/skills/recomputeSkillStates.ts`
- Test: `src/lib/skills/__tests__/recomputeSkillStates.test.ts` (extend existing — add the SPARK-enrichment case)

**Interfaces:**
- Consumes: table `spark_completions` (T1), `SkillSparkObservation` (existing in `computeSkillState.ts`, currently unimported here).
- Behavior: build `sparkBySkill: Map<string, SkillSparkObservation[]>` by fetching the student's `spark_completions` joined to `assignments.skill_ids` (assignment-level attribution, mirroring the homework gather); add `sparkBySkill.keys()` to the `touched` set; replace `spark: []` at line ~325 with `spark: sparkBySkill.get(skillId) ?? []`. Pass ALL completions (engagement filter stays in `computeSkillState`).

- [ ] **Step 1: Add the failing enrichment test**

In `src/lib/skills/__tests__/recomputeSkillStates.test.ts`, add a case that seeds the admin mock so `from('spark_completions')` returns one engaged, high-transfer completion attributed to `sk-1`, and assert the resulting `skill_learning_state` upsert for `sk-1` reflects spark evidence (state advances / observation_count > quiz+hw count). Follow the file's existing admin-mock idiom (it already mocks `quiz_responses`, `assignments`, etc.). Minimum assertion:

```ts
it('SPARK completions reach computeSkillState and count as evidence', async () => {
  // ...arrange the existing admin mock so:
  //   from('spark_completions').select(...).eq('student_id', ...) resolves to:
  //   [{ transfer_score: 88, content_quality: 'engaged', completed_at: '2026-06-20T00:00:00Z',
  //      received_at: '2026-06-20T00:00:00Z', assignments: { skill_ids: ['sk-1'], student_id: 'stu-1' } }]
  // and the quiz/homework chains resolve to empty.
  const summary = await recomputeSkillStatesForStudent(admin, { studentId: 'stu-1', schoolId: 'sch-1', skillIds: ['sk-1'] });
  expect(summary.ok).toBe(true);
  // The upsert for sk-1 must have been called with observation_count >= 1 (spark contact counted).
  // Assert via the captured upsert payload for skill_learning_state (mirror the file's existing assertions).
});
```

> Match the existing test file's mock construction exactly (it captures upsert payloads). If the file uses a `makeAdminMock(opts)` with per-table chains, add a `sparkCompletions` option defaulting to `[]` (so all pre-existing cases keep `spark: []` behavior and stay green).

- [ ] **Step 2: Run to verify the new test fails**

Run: `npx vitest run src/lib/skills/__tests__/recomputeSkillStates.test.ts`
Expected: the new case FAILS (sparkBySkill not built; `spark: []` still hardcoded).

- [ ] **Step 3: Add the import**

Extend the existing `computeSkillState` import block (lines ~24-30) to include `SkillSparkObservation`:

```ts
import {
  computeSkillState,
  type SkillStateInput,
  type SkillQuizObservation,
  type SkillHomeworkObservation,
  type SkillReteachEvent,
  type SkillSparkObservation,
} from './computeSkillState';
```

- [ ] **Step 4: Add the SPARK gather block**

After the homework gather (which produces `hwBySkill`/`reteachBySkill`, ~line 300) and BEFORE the `touched` set is built (~line 302), add:

```ts
    // ── SPARK completions → per-skill observations (assignment-level attribution) ──
    // Mirrors the homework gather: a completion is attributed to every skill in its
    // parent assignment's skill_ids. Pass ALL completions through — computeSkillState
    // owns the engagement guard (non_engaged/minimal filtered there, counted as contact).
    const sparkBySkill = new Map<string, SkillSparkObservation[]>();
    {
      const { data: sparkData } = await admin
        .from('spark_completions')
        .select(
          'transfer_score, content_quality, completed_at, received_at, ' +
          'assignments!inner(skill_ids, student_id)',
        )
        .eq('student_id', studentId)
        .limit(2000);
      type SparkRow = {
        transfer_score: number | null;
        content_quality: 'engaged' | 'minimal' | 'non_engaged' | null;
        completed_at: string | null;
        received_at: string | null;
        assignments: { skill_ids: string[] | null } | null;
      };
      for (const row of (sparkData ?? []) as unknown as SparkRow[]) {
        const skillIdsForRow = row.assignments?.skill_ids ?? [];
        const obs: SkillSparkObservation = {
          transferScore: row.transfer_score ?? null,
          contentQuality: row.content_quality ?? null,
          completed: true,
          occurredAt: row.completed_at ?? row.received_at ?? '',
        };
        for (const sid of skillIdsForRow) {
          if (!sparkBySkill.has(sid)) sparkBySkill.set(sid, []);
          sparkBySkill.get(sid)!.push(obs);
        }
      }
    }
```

- [ ] **Step 5: Add spark skills to the `touched` set**

Update the `touched` Set construction (~line 302-305) to include spark-touched skills:

```ts
    const touched = new Set<string>([
      ...quizBySkill.keys(),
      ...hwBySkill.keys(),
      ...sparkBySkill.keys(),
    ]);
```

- [ ] **Step 6: Replace the `spark: []` seam (line ~325)**

```ts
        spark: sparkBySkill.get(skillId) ?? [],
```

(removing the `// SPARK webhook is Plan 6; always empty here` comment).

- [ ] **Step 7: Run to verify pass (new + all existing)**

Run: `npx vitest run src/lib/skills/__tests__/recomputeSkillStates.test.ts`
Expected: PASS — new enrichment case + every existing case green (default `spark_completions` mock empty ⇒ unchanged behavior).

- [ ] **Step 8: Commit**

```bash
git add src/lib/skills/recomputeSkillStates.ts src/lib/skills/__tests__/recomputeSkillStates.test.ts
git commit -m "feat(spark): feed spark_completions into the skill engine (replace spark:[] seam)"
```

---

## Task 10: `idempotency-sweep` cron — delete expired keys

**Files:**
- Modify: `src/app/api/cron/idempotency-sweep/route.ts` (replace the 501 stub)
- Test: `src/app/api/cron/idempotency-sweep/__tests__/route.test.ts`

**Interfaces:**
- Behavior: `CRON_SECRET` gate (header `x-cron-secret`, plain compare — matches the existing cron pattern); delete `webhook_idempotency_keys` rows past `expires_at`; return `{ ok, deleted, swept_at }`. `GET` delegates to `POST` (Vercel probe). Already registered in `vercel.json` (daily 03:00).

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/cron/idempotency-sweep/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({ createAdminSupabaseClient: vi.fn() }));

function makeReq(secret: string | null) {
  const headers: Record<string, string> = {};
  if (secret) headers['x-cron-secret'] = secret;
  return new NextRequest('http://localhost/api/cron/idempotency-sweep', { method: 'POST', headers });
}

function adminDeleting(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain['delete'] = vi.fn().mockReturnValue(chain);
  chain['lt'] = vi.fn().mockReturnValue(chain);
  chain['not'] = vi.fn().mockReturnValue(chain);
  chain['select'] = vi.fn().mockResolvedValue({ data: rows, error: null });
  return { from: vi.fn(() => chain) } as never;
}

beforeEach(() => { process.env.CRON_SECRET = 'cron-x'; vi.resetModules(); });

describe('POST /api/cron/idempotency-sweep', () => {
  it('401 without the cron secret', async () => {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminDeleting([]));
    const { POST } = await import('@/app/api/cron/idempotency-sweep/route');
    expect((await POST(makeReq(null))).status).toBe(401);
    expect((await POST(makeReq('wrong'))).status).toBe(401);
  });

  it('deletes expired keys and returns a count', async () => {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminDeleting([{ id: '1' }, { id: '2' }]));
    const { POST } = await import('@/app/api/cron/idempotency-sweep/route');
    const res = await POST(makeReq('cron-x'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, deleted: 2 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/api/cron/idempotency-sweep/__tests__/route.test.ts`
Expected: FAIL — stub returns 501.

- [ ] **Step 3: Implement the cron (replace the stub)**

```ts
// src/app/api/cron/idempotency-sweep/route.ts
// Daily sweep (vercel.json: 0 3 * * *) — delete expired webhook_idempotency_keys.
// CRON_SECRET gate matches the existing weekly-snapshot cron pattern.
import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get('x-cron-secret');
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminSupabaseClient();
  const sweptAt = new Date().toISOString();
  const { data, error } = await admin
    .from('webhook_idempotency_keys')
    .delete()
    .lt('expires_at', sweptAt)
    .not('expires_at', 'is', null)
    .select('id');

  if (error) {
    return NextResponse.json({ ok: false, error: error.message, swept_at: sweptAt }, { status: 200 });
  }
  return NextResponse.json({ ok: true, deleted: data?.length ?? 0, swept_at: sweptAt });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return POST(req);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/app/api/cron/idempotency-sweep/__tests__/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/idempotency-sweep/route.ts src/app/api/cron/idempotency-sweep/__tests__/route.test.ts
git commit -m "feat(spark): idempotency-sweep cron (delete expired webhook keys)"
```

---

## Task 11: S3 — `IconBolt` + CHALLENGES nav entry

**Files:**
- Modify: `src/components/core/icons.tsx` (add `IconBolt`)
- Modify: `src/app/(teacher)/_components/navConfig.ts` (add `'challenges'` to `NavIconKey`; add the CHALLENGES entry)
- Modify: `src/app/(teacher)/_components/SidebarNav.tsx` (import `IconBolt`; add `challenges:` to the `ICON` record)
- Test: `src/app/(teacher)/_components/__tests__/navConfig.test.ts` (extend existing if present; else create) + the existing SidebarNav test stays green

**Interfaces:**
- Produces: `NavIconKey` gains `'challenges'`; `NAV_ENTRIES` includes `{ label: 'Spark Challenges', href: '/challenges', icon: 'challenges' }`. `ICON['challenges'] = IconBolt`. `matchActive` already covers `/challenges` (no change).

> **Type-exhaustiveness gate (grounding G5):** `ICON` is `Record<NavIconKey, …>`. Adding `'challenges'` to the union WITHOUT adding `challenges:` to `ICON` is a `tsc` error. Both edits land in this task.

- [ ] **Step 1: Write/extend the failing test**

In `src/app/(teacher)/_components/__tests__/navConfig.test.ts` (create if absent), add:

```ts
import { describe, it, expect } from 'vitest';
import { NAV_ENTRIES, isGroup, matchActive } from '../navConfig';

describe('navConfig — Spark Challenges (S3)', () => {
  it('has a top-level Spark Challenges entry → /challenges with the bolt icon', () => {
    const flat = NAV_ENTRIES.flatMap((e) => (isGroup(e) ? e.items : [e]));
    const challenges = flat.find((i) => i.href === '/challenges');
    expect(challenges).toBeDefined();
    expect(challenges!.label).toBe('Spark Challenges');
    expect(challenges!.icon).toBe('challenges');
  });

  it('matchActive marks /challenges and its subpaths active', () => {
    expect(matchActive('/challenges', '/challenges')).toBe(true);
    expect(matchActive('/challenges/cls-1', '/challenges')).toBe(true);
    expect(matchActive('/today', '/challenges')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/(teacher)/_components/__tests__/navConfig.test.ts`
Expected: FAIL — no `/challenges` entry yet.

- [ ] **Step 3: Add `IconBolt` to `src/components/core/icons.tsx`**

Following the exact `Svg` wrapper pattern (stroke-only, `viewBox 0 0 24 24`):

```tsx
export const IconBolt = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 2 5 13h6l-1 9 8-11h-6l1-9z" />
  </Svg>
);
```

- [ ] **Step 4: Add `'challenges'` to `NavIconKey` + the entry in `navConfig.ts`**

Add `| 'challenges'` to the `NavIconKey` union, then add the entry directly after `Today` in `NAV_ENTRIES`:

```ts
export type NavIconKey =
  | 'today'
  | 'challenges'
  | 'roster'
  // ...rest unchanged
```

```ts
export const NAV_ENTRIES: NavEntry[] = [
  { label: 'Today', href: '/today', icon: 'today' },
  { label: 'Spark Challenges', href: '/challenges', icon: 'challenges' },
  {
    groupLabel: 'CLASS',
    // ...unchanged
```

- [ ] **Step 5: Wire `IconBolt` into `SidebarNav.tsx`**

Add `IconBolt` to the icon import block, then add `challenges: IconBolt,` to the `ICON` record:

```tsx
import {
  IconToday, IconRoster, IconGradebook, IconAlerts, IconHighFive,
  IconLessons, IconQuizzes, IconInsights, IconUpload, IconBolt,
} from '@/components/core/icons';

const ICON: Record<NavIconKey, (p: { className?: string }) => React.JSX.Element> = {
  today: IconToday,
  challenges: IconBolt,
  roster: IconRoster,
  // ...rest unchanged
};
```

- [ ] **Step 6: Run nav + existing shell tests, then `tsc`**

Run: `npx vitest run src/app/(teacher)/_components/__tests__/`
Then: `npx tsc --noEmit`
Expected: navConfig tests PASS; existing `SidebarNav`/shell tests stay green; `tsc` clean (the `ICON` record is exhaustive over the new union).

- [ ] **Step 7: Commit**

```bash
git add src/components/core/icons.tsx "src/app/(teacher)/_components/navConfig.ts" "src/app/(teacher)/_components/SidebarNav.tsx" "src/app/(teacher)/_components/__tests__/navConfig.test.ts"
git commit -m "feat(shell): S3 — Spark Challenges nav entry + IconBolt"
```

---

## Task 12: S2 — SPARK recognition sticker in `TeacherSidebar`

**Files:**
- Modify: `src/app/(teacher)/_components/TeacherSidebar.tsx`
- Test: `src/app/(teacher)/_components/__tests__/TeacherSidebar.test.tsx` (extend existing if present; else create)

**Interfaces:**
- Behavior: render the SPARK sticker (white plate chip + `spark.svg` + "Inside CORE" tag in `text-fg`) directly under the CORE logo plate, before the Active-class block. Tokens only; no new orange token (Plan Decision 5) — the brand color lives in the SVG (decorative).

- [ ] **Step 1: Add the failing jsdom test**

`src/app/(teacher)/_components/__tests__/TeacherSidebar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/test/setup-dom';
import { TeacherSidebar } from '../TeacherSidebar';

describe('TeacherSidebar — S2 SPARK sticker', () => {
  it('renders a SPARK sticker image and the "Inside CORE" tag', () => {
    render(<TeacherSidebar userName="Dana Whitfield" />);
    expect(screen.getByAltText('SPARK')).toBeInTheDocument();
    expect(screen.getByText(/inside core/i)).toBeInTheDocument();
  });

  it('still renders the CORE logo plate (no regression)', () => {
    render(<TeacherSidebar userName="Dana Whitfield" />);
    expect(screen.getByAltText('CORE')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run "src/app/(teacher)/_components/__tests__/TeacherSidebar.test.tsx"`
Expected: FAIL — no SPARK alt/text yet.

- [ ] **Step 3: Add the sticker between the logo plate and the Active-class block**

In `TeacherSidebar.tsx`, after the `{/* Logo plate */}` closing `</div>` and before `{/* Active class */}`:

```tsx
        {/* S2 — SPARK recognition sticker (brand color lives in the SVG; tag is deep ink) */}
        <div className="flex justify-center px-4 pb-3">
          <div className="inline-flex items-center gap-2 rounded-lg bg-sidebar-plate px-2.5 py-1.5 shadow-sticker">
            <Image
              src="/images/brand/spark.svg"
              alt="SPARK"
              width={1071}
              height={481}
              className="h-5 w-auto"
            />
            <span className="text-[9px] font-bold uppercase tracking-wider text-fg">Inside CORE</span>
          </div>
        </div>
```

(`Image` is already imported at the top of the file.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run "src/app/(teacher)/_components/__tests__/TeacherSidebar.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(teacher)/_components/TeacherSidebar.tsx" "src/app/(teacher)/_components/__tests__/TeacherSidebar.test.tsx"
git commit -m "feat(shell): S2 — SPARK recognition sticker under the CORE plate"
```

---

## Task 13: Teacher "Spark Challenges" screen (`/challenges`)

**Files:**
- Create: `src/lib/spark/loadChallenges.ts`
- Create: `src/app/(teacher)/challenges/page.tsx`
- Create: `src/app/(teacher)/challenges/_components/ChallengeCard.tsx`
- Test: `src/lib/spark/__tests__/loadChallenges.test.ts` (node) + `src/app/(teacher)/challenges/_components/__tests__/ChallengeCard.test.tsx` (jsdom, incl. leak/terminology audit)

**Interfaces:**
- Consumes: `guardClassAccess` (`@/lib/auth/guards`), `createAdminSupabaseClient`, `transferWord` (T3), `EmptyState`.
- Produces: `interface ChallengeRow { studentId; studentName; assignmentId; title; status: 'assigned'|'in_progress'|'completed'; transferScore; contentQuality; rubric }`; `interface ChallengesData { classId; challenges: ChallengeRow[] }`; `loadChallenges(admin, classId): Promise<ChallengesData>`.

- [ ] **Step 1: Write the failing loader test**

`src/lib/spark/__tests__/loadChallenges.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { loadChallenges } from '../loadChallenges';

function admin(assignments: unknown[], completions: unknown[]) {
  const assignChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: assignments, error: null }),
  };
  const compChain = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: completions, error: null }),
  };
  return {
    from: vi.fn((t: string) => (t === 'assignments' ? assignChain : compChain)),
  } as never;
}

describe('loadChallenges', () => {
  it('returns empty challenges when no spark-enabled assignments', async () => {
    const data = await loadChallenges(admin([], []), 'cls-1');
    expect(data).toEqual({ classId: 'cls-1', challenges: [] });
  });

  it('derives per-student status: completed when a scored completion exists, assigned otherwise', async () => {
    const assignments = [
      { id: 'a1', student_id: 's1', spark_status: 'completed', content: { title: 'Ecosystems' }, users: { full_name: 'Alex' } },
      { id: 'a2', student_id: 's2', spark_status: 'created', content: { title: 'Forces' }, users: { full_name: 'Sofia' } },
    ];
    const completions = [
      { assignment_id: 'a1', transfer_score: 88, content_quality: 'engaged', rubric_dimensions: { problem_understanding: 4 } },
    ];
    const data = await loadChallenges(admin(assignments, completions), 'cls-1');
    const byId = Object.fromEntries(data.challenges.map((c) => [c.assignmentId, c]));
    expect(byId['a1']).toMatchObject({ status: 'completed', transferScore: 88, contentQuality: 'engaged', studentName: 'Alex', title: 'Ecosystems' });
    expect(byId['a2']).toMatchObject({ status: 'assigned', transferScore: null, studentName: 'Sofia' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/spark/__tests__/loadChallenges.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `src/lib/spark/loadChallenges.ts`**

```ts
// src/lib/spark/loadChallenges.ts — teacher Spark Challenges screen loader.
// Caller MUST run requireRole (layout) + guardClassAccess(classId) BEFORE calling (admin client
// bypasses RLS). Mirrors loadRosterSignals' contract.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ChallengeRow {
  studentId: string;
  studentName: string;
  assignmentId: string;
  title: string;
  status: 'assigned' | 'in_progress' | 'completed';
  transferScore: number | null;
  contentQuality: 'engaged' | 'minimal' | 'non_engaged' | null;
  rubric: Record<string, number | null> | null;
}

export interface ChallengesData {
  classId: string;
  challenges: ChallengeRow[];
}

interface AssignmentRow {
  id: string;
  student_id: string;
  spark_status: string;
  content: { title?: string } | null;
  users: { full_name?: string } | null;
}
interface CompletionRow {
  assignment_id: string;
  transfer_score: number | null;
  content_quality: 'engaged' | 'minimal' | 'non_engaged' | null;
  rubric_dimensions: Record<string, number | null> | null;
}

export async function loadChallenges(admin: SupabaseClient, classId: string): Promise<ChallengesData> {
  const { data: aData } = await admin
    .from('assignments')
    .select('id, student_id, spark_status, content, users:student_id(full_name)')
    .eq('class_id', classId)
    .neq('spark_status', 'none')
    .limit(500);
  const assignments = (aData ?? []) as unknown as AssignmentRow[];
  if (assignments.length === 0) return { classId, challenges: [] };

  const ids = assignments.map((a) => a.id);
  const { data: cData } = await admin
    .from('spark_completions')
    .select('assignment_id, transfer_score, content_quality, rubric_dimensions')
    .in('assignment_id', ids);
  const byAssignment = new Map<string, CompletionRow>();
  for (const c of (cData ?? []) as unknown as CompletionRow[]) byAssignment.set(c.assignment_id, c);

  const challenges: ChallengeRow[] = assignments.map((a) => {
    const c = byAssignment.get(a.id);
    const scored = c != null && (c.transfer_score != null || c.content_quality != null);
    const status: ChallengeRow['status'] = c ? (scored ? 'completed' : 'in_progress') : 'assigned';
    return {
      studentId: a.student_id,
      studentName: a.users?.full_name ?? 'Student',
      assignmentId: a.id,
      title: a.content?.title ?? 'Spark Challenge',
      status,
      transferScore: c?.transfer_score ?? null,
      contentQuality: c?.content_quality ?? null,
      rubric: c?.rubric_dimensions ?? null,
    };
  });
  return { classId, challenges };
}
```

- [ ] **Step 4: Run loader test to verify pass**

Run: `npx vitest run src/lib/spark/__tests__/loadChallenges.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the `ChallengeCard` component**

`src/app/(teacher)/challenges/_components/ChallengeCard.tsx` (server component; teacher-only; tokens; "Assignment" not "Homework"):

```tsx
// src/app/(teacher)/challenges/_components/ChallengeCard.tsx
// Teacher-only row for one student's Spark Challenge. Restrained: status + transfer (word + %)
// + content_quality as a soft teacher label. Tokens only; deep-ink text.
import React from 'react';
import type { ChallengeRow } from '@/lib/spark/loadChallenges';
import { transferWord } from '@/lib/spark/contract';

const STATUS_LABEL: Record<ChallengeRow['status'], string> = {
  assigned: 'Assigned',
  in_progress: 'In progress',
  completed: 'Completed',
};

const QUALITY_LABEL: Record<NonNullable<ChallengeRow['contentQuality']>, string> = {
  engaged: 'engaged deeply',
  minimal: 'engaged lightly',
  non_engaged: 'did not engage',
};

export function ChallengeCard({ row }: { row: ChallengeRow }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 rounded border border-surface bg-surface px-4 py-3">
      <div className="flex flex-col">
        <span className="text-fg text-sm font-semibold">{row.studentName}</span>
        <span className="text-fg text-xs">{row.title}</span>
      </div>
      <div className="flex items-center gap-4">
        {row.status === 'completed' && row.transferScore != null ? (
          <span className="text-fg text-sm">
            Transfer: <span className="font-semibold">{transferWord(row.transferScore)}</span> ({row.transferScore}%)
          </span>
        ) : (
          <span className="text-fg text-sm">{STATUS_LABEL[row.status]}</span>
        )}
        {row.contentQuality && (
          <span className="text-fg text-xs">{QUALITY_LABEL[row.contentQuality]}</span>
        )}
      </div>
    </div>
  );
}

export default ChallengeCard;
```

- [ ] **Step 6: Write the page**

`src/app/(teacher)/challenges/page.tsx` (mirrors `roster/page.tsx`):

```tsx
// src/app/(teacher)/challenges/page.tsx
// Teacher-only Spark Challenges screen. Role gate is in (teacher)/layout.tsx; this page adds
// the object-level IDOR guard. Reads completions via the admin client (RLS-bypassed; guard is
// the backstop). Dignified cold-start when no challenges. Teacher surface — transfer % is allowed.
import React from 'react';

import { guardClassAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadChallenges } from '@/lib/spark/loadChallenges';
import { EmptyState } from '@/components/core/EmptyState';
import { ChallengeCard } from './_components/ChallengeCard';

const PICK_A_CLASS = (
  <EmptyState
    variant="just-getting-started"
    titleOverride="Pick a class to begin"
    bodyOverride="Use the class selector above to see Spark Challenges."
  />
);

export default async function ChallengesPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string }>;
}): Promise<React.JSX.Element> {
  const { class: classId } = await searchParams;
  if (!classId) return <div className="p-6">{PICK_A_CLASS}</div>;

  const guard = await guardClassAccess(classId);
  if (guard) return <div className="p-6">{PICK_A_CLASS}</div>;

  const admin = createAdminSupabaseClient();
  const { challenges } = await loadChallenges(admin, classId);

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <h1 className="font-display text-2xl text-fg font-semibold">Spark Challenges</h1>
      </div>

      {challenges.length === 0 ? (
        <EmptyState
          variant="just-getting-started"
          titleOverride="No Spark Challenges yet"
          bodyOverride="Generate a SPARK-enabled assignment to start a challenge for this class."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {challenges.map((row) => (
            <ChallengeCard key={row.assignmentId} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Write the component test (incl. terminology audit)**

`src/app/(teacher)/challenges/_components/__tests__/ChallengeCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/test/setup-dom';
import { ChallengeCard } from '../ChallengeCard';
import type { ChallengeRow } from '@/lib/spark/loadChallenges';

const base: ChallengeRow = {
  studentId: 's1', studentName: 'Alex', assignmentId: 'a1', title: 'Ecosystems',
  status: 'completed', transferScore: 88, contentQuality: 'engaged', rubric: null,
};

describe('ChallengeCard', () => {
  it('shows transfer word + % when completed', () => {
    render(<ChallengeCard row={base} />);
    expect(screen.getByText(/strong/i)).toBeInTheDocument();
    expect(screen.getByText(/88%/)).toBeInTheDocument();
  });

  it('shows the status label when not yet completed', () => {
    render(<ChallengeCard row={{ ...base, status: 'assigned', transferScore: null, contentQuality: null }} />);
    expect(screen.getByText('Assigned')).toBeInTheDocument();
  });

  it('uses "Challenge"/"Assignment" terminology, never "Homework"', () => {
    const { container } = render(<ChallengeCard row={base} />);
    expect(container.textContent?.toLowerCase()).not.toContain('homework');
  });
});
```

- [ ] **Step 8: Run all T13 tests + tsc**

Run: `npx vitest run src/lib/spark/__tests__/loadChallenges.test.ts "src/app/(teacher)/challenges/_components/__tests__/ChallengeCard.test.tsx"`
Then: `npx tsc --noEmit`
Expected: PASS; `tsc` clean.

- [ ] **Step 9: Commit**

```bash
git add src/lib/spark/loadChallenges.ts "src/app/(teacher)/challenges/page.tsx" "src/app/(teacher)/challenges/_components/ChallengeCard.tsx" src/lib/spark/__tests__/loadChallenges.test.ts "src/app/(teacher)/challenges/_components/__tests__/ChallengeCard.test.tsx"
git commit -m "feat(spark): teacher Spark Challenges screen (/challenges) + loader"
```

---

## Task 14: Demo seed — SPARK link + seeded completions

**Files:**
- Modify: `scripts/seedDemo.ts` (provision the demo SPARK link + seed a couple completions so the screen + skill enrichment demo without a live round-trip)

**Interfaces:**
- Consumes: `provisionSparkLink` (T5), tables `assignments`/`spark_completions`. Self-contained: resolves a student's assignment id by query (no `buildSeedRows` surgery), soft-fail (mirrors the misconceptions seed block).

> No pure-function change to `buildSeedRows` — the transfer/rubric mapping is already covered by T3's `computeTransferScore` tests; this task's verification is `npx tsc --noEmit` (the script compiles) + a successful local seed run (deferred to ops; no live DB in CI).

- [ ] **Step 1: Add the SPARK demo block**

In `scripts/seedDemo.ts`, after the assignments-insertion step (Step 13, where `assignmentIds`/`studentIds`/`schoolId`/`classId` are populated) and before/near the misconceptions step, add the import at the top:

```ts
import { provisionSparkLink } from '../src/lib/spark/sparkLink';
```

(Match the file's existing relative-import style for `src/lib/*` — the script imports demo libs by relative path; verify and mirror it.)

Then add the block (uses the in-scope `admin`, `schoolId`, `classId`, `studentIds`, `now`):

```ts
  // ── SPARK demo: enabled link + seeded completions (demoable without a live round-trip) ──
  try {
    await provisionSparkLink(admin, {
      schoolId,
      apiKey: 'demo-spark-key-2026',
      coreBaseUrl: 'https://newcore.inteliflowai.com',
      label: 'SPARK (demo)',
    });
    const sparkDemo = [
      {
        key: 'alex',
        transfer: 88,
        quality: 'engaged' as const,
        rubric: { problem_understanding: 4, reasoning_strategy: 4, use_of_evidence: 3, creativity_application: 4, communication: 3, reflection_metacognition: 3, collaboration: null },
      },
      {
        key: 'sofia',
        transfer: 60,
        quality: 'engaged' as const,
        rubric: { problem_understanding: 3, reasoning_strategy: 2, use_of_evidence: 2, creativity_application: 3, communication: 3, reflection_metacognition: 2, collaboration: null },
      },
    ];
    for (const s of sparkDemo) {
      const sid = studentIds[s.key];
      if (!sid || !classId) continue;
      const { data: a } = await admin
        .from('assignments')
        .select('id')
        .eq('student_id', sid)
        .eq('class_id', classId)
        .limit(1)
        .maybeSingle();
      if (!a) continue;
      await admin
        .from('assignments')
        .update({ spark_status: 'completed', spark_attempt_id: `demo-${s.key}-attempt` })
        .eq('id', a.id);
      await admin.from('spark_completions').upsert(
        {
          assignment_id: a.id,
          student_id: sid,
          school_id: schoolId,
          spark_attempt_id: `demo-${s.key}-attempt`,
          score: s.transfer,
          content_quality: s.quality,
          rubric_dimensions: s.rubric,
          transfer_score: s.transfer,
          completed_at: now.toISOString(),
        },
        { onConflict: 'assignment_id,student_id' },
      );
    }
    console.log('[seed] SPARK demo link + completions done');
  } catch (e) {
    console.warn('[seed] SPARK demo seed failed (soft):', (e as Error).message);
  }
```

> If `now` is not in scope at that point, use the same timestamp source the surrounding seed steps use (the file builds rows with a `now: Date` — reuse it; else `new Date()`).

- [ ] **Step 2: Verify the script compiles**

Run: `npx tsc --noEmit`
Expected: clean (no type errors from the new block or import).

- [ ] **Step 3: Confirm pre-existing seed/build tests stay green**

Run: `npx vitest run src/lib/demo/ scripts/`
Expected: PASS (no regression — the block is additive and soft-fail).

- [ ] **Step 4: Commit**

```bash
git add scripts/seedDemo.ts
git commit -m "feat(spark): demo seed — SPARK link + seeded completions for the demo school"
```

> **Live seed run is an ops step** (`npm run seed:demo` against a real Supabase) — deferred to the merge/deploy sequence; not run in CI.

---

## Task 15: Ops handoff doc (env + `core_spark_links` SQL for SPARK's DB)

**Files:**
- Create: `docs/superpowers/specs/spark-phase1-ops-handoff.md`

**Interfaces:** none (doc deliverable). This is the artifact the user/ops runs to flip the loop live.

- [ ] **Step 1: Write the handoff doc**

Create `docs/superpowers/specs/spark-phase1-ops-handoff.md`:

```markdown
# SPARK Phase 1 — Ops handoff (go-live switch)

The shared secret already matches both repos (`CORE_SPARK_API_SECRET=<redacted>`).
No SPARK code deploy is needed — only env + two DB rows.

## 1. V2 Vercel env (project `new-core`)
- `SPARK_API_URL=https://spark.inteliflowai.com`
- `CORE_SPARK_API_SECRET=<redacted>` (must equal SPARK's value)
Promote the deploy after setting (preview→production).

## 2. V2 DB — demo school SPARK link
Seeded automatically by `npm run seed:demo` (Task 14). To verify / set manually, first get the demo school id:
\`\`\`sql
-- on V2's Supabase
select id from schools where name = 'CORE Demo School' and demo_mode = true;
\`\`\`
The seed writes a `platform_links` row (`product='spark'`, `enabled=true`, `core_base_url='https://newcore.inteliflowai.com'`).

## 3. SPARK DB — route the demo school's completions to V2 (ops runs this on SPARK's Supabase)
\`\`\`sql
-- on SPARK's Supabase. Replace <V2_DEMO_SCHOOL_ID> with the id from step 2,
-- and <A_SPARK_SCHOOL_ID> with an existing SPARK school to link.
insert into core_spark_links (core_school_id, spark_school_id, core_base_url)
values ('<V2_DEMO_SCHOOL_ID>', '<A_SPARK_SCHOOL_ID>', 'https://newcore.inteliflowai.com')
on conflict (core_school_id) do update set core_base_url = excluded.core_base_url;
\`\`\`
This row (a) lets SPARK accept the inbound create webhook (school must be linked) and
(b) routes the school's completion callbacks to V2 (`core_base_url`).

## 4. License
No `spark_experiences` table exists in V2; the SPARK gate is the enabled `platform_links` spark row (step 2). Nothing else to set.

## Phase-2 note (NOT this phase)
SPARK's `isValidReturnUrl` allow-list must add `newcore.inteliflowai.com` for the student launch back-button (a SPARK code change). Out of scope for Phase 1.
```

- [ ] **Step 2: Confirm the config gate test still passes**

Run: `npx vitest run src/lib/__tests__/config.test.ts`
Expected: PASS (vercel.json crons + `.env.example` keys unchanged by this doc).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/spark-phase1-ops-handoff.md
git commit -m "docs(spark): Phase 1 ops handoff (env + core_spark_links SQL)"
```

---

## Gates (run after T15, before review/merge)

- [ ] **Full suite:** `npm test` — all green (1222+ existing + the new SPARK tests).
- [ ] **Type-check:** `npx tsc --noEmit` — clean.
- [ ] **a11y contrast gate:** `npm run a11y` — green at **49 pairs** (no token added; if the count changed, a token slipped in — investigate, do not bump blindly).
- [ ] **Build:** `npm run build` — succeeds (runs `prebuild`→`a11y` then the Turbopack production build + full type pass).

## Live migration apply (controller step, near merge — Supabase MCP)

`0012_spark.sql` is a FILE deliverable; code/tests use mocks. Before the live demo works, apply it to the live NEW CORE DB via the Supabase MCP (the project's connected `mcp__plugin_supabase__apply_migration`), mirroring how 0010/0011 were applied. This is a controller/ops action, not a subagent task — run it only after the suite is green and you're ready to seed/demo. Then run `npm run seed:demo` against the live DB (Task 14's SPARK block lights up `/challenges`).

## Adversarial whole-branch review (primary gate — per CLAUDE.md)

After gates are green, run the in-house adversarial Workflow review over the whole `feat/teacher-app-shell` branch diff (merge-base→HEAD), per CLAUDE.md ("the in-house adversarial Workflow is the primary review; don't block on Codex"). Feed it the Global Constraints + Plan Decisions above as the lens. Specific things to adversarially verify:

- **Four-audience:** `/challenges` is teacher-gated (layout `requireRole(['teacher'])` + `guardClassAccess`); no student/parent route renders spark numbers; `computeSkillState` is the only consumer of spark data on student/parent surfaces (bands/CL-verbs only).
- **Webhook discipline:** ingestion never returns 5xx for business outcomes; 401 only on bad Bearer; 400 only on malformed/missing ids; replay is idempotent; submit-then-`_scored` overwrites the same `spark_completions` row.
- **Auth/IDOR:** the ingestion route uses constant-time Bearer (not user auth) + admin client; `/challenges` page converts a non-null `guardClassAccess` into a rendered fallback (can't return a `NextResponse` from a page).
- **Non-blocking notify:** a SPARK failure in `assignments/generate` never fails assignment generation (sets `spark_status='notify_failed'`).
- **Terminology/tokens:** new UI says "Assignment"/"Challenge", never "Homework"; no hardcoded hex / arbitrary `[var(--..)]`; content text is `text-fg`; a11y stays at 49.
- **No regressions:** existing route/shell/engine tests stay green; the gate defaults OFF (no `platform_links` spark row ⇒ no notify) so non-SPARK schools are unaffected.

Dispatch ONE fix subagent with the complete findings list if the review returns Critical/Important items; re-review after fixes.

## Merge & deploy

Use **superpowers:finishing-a-development-branch**: verify tests pass → present options → **merge `feat/teacher-app-shell` into `main`** (this folds the held Pop-Art shell + SP-2/S3 SPARK recognition + the full Phase-1 backend) → deploy (Vercel `new-core`, promote to production at `newcore.inteliflowai.com`). Then flip live via the ops handoff doc (Task 15): set the two Vercel env vars, apply 0012 + seed, and have ops run the `core_spark_links` SQL on SPARK's Supabase.

---

## Self-Review (fresh-eyes pass against the spec)

**1. Spec coverage (§5 SP-1..SP-4 + §6 wiring):**
- SP-1 foundation → T1 (migration: `spark_completions` + assignment binding), T2 (config + `.env`), T3 (contract mappers), T4 (bearer auth), T5 (gate + `provisionSparkLink`). `external_identities` resolver intentionally dropped (Plan Decision 3). License gate = platform_links (Plan Decision 1). ✅
- SP-2 create-notify → T6 (`notifyAssignmentCreated`) + T7 (non-blocking hook in `generate`). ✅
- SP-3 ingestion + cron → T8 (`/api/attempts/spark-attempt-complete`) + T9 (engine seam) + T10 (`idempotency-sweep`). No SPARK code change; ops row in T15. ✅
- SP-4 screen + shell → T13 (`/challenges`) + T11 (S3 nav) + T12 (S2 sticker); merge in the build sequence. ✅
- §6 live-wiring (env, V2 platform_links, SPARK `core_spark_links`, license) → T2 + T14 seed + T15 handoff doc. ✅
- §7 testing → each task ships its tests (node route idiom + jsdom header); a11y/tsc/build gates listed. The §7 "identity resolution via external_identities" bullet is superseded by the corrected CORE-native ingestion (Plan Decision 3) — covered by the unknown-assignment test in T8 instead. ✅

**2. Placeholder scan:** every code step shows complete code or an exact diff anchor; no "TBD"/"handle errors"/"similar to". The two places that say "match the file's existing idiom" (T1 migration-test imports, T9/T14 mock extension, seed import style) are bounded — they point at a verbatim-grounded existing pattern to copy, not unspecified work. ✅

**3. Type consistency:** `RubricDimensions` (T3) is consumed by T8 + the seed; `SkillSparkObservation` shape (T9) matches `computeSkillState.ts` verbatim (transferScore/contentQuality/completed/occurredAt); `recomputeSkillStatesForStudent(admin, { studentId, schoolId, skillIds? })` 2-arg object form used identically in T8; `NavIconKey` union + `ICON` record edited together (T11); `guardClassAccess` returns `NextResponse|null` and the page converts it (T13). ✅

**4. Right-sizing:** each task ends with an independently testable deliverable and its own commit; T1 (migration) is the only DB-shape gate; T7/T9 extend existing test files (the new cases must pass AND existing stay green — called out explicitly). ✅

**Known residuals (flagged, not gaps):** orphan `/api/integrations/core` 501 stub left in place (Plan Decision 7); live 0012 apply + live seed are ops steps (mocks in CI); SPARK `isValidReturnUrl` allow-list is Phase-2; admin provisioning UI deferred (Plan Decision 8).
