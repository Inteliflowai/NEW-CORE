# CORE v2 — Plan 4b FOUNDATION Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the shared substrate that all 8 locked Teacher screens slot into — a deterministic idempotent demo seed, real-school pilot/trial provisioning, the `GET /api/teacher/classes` endpoint, four additive component tweaks + a one-line signals-route fix, six copy helpers, and the locked 4b nav shell — with nothing here rendering a screen.

**Architecture:** Next.js App Router with a `(teacher)` route group under `src/app/`; `RoleLayout role="teacher"` sets `data-role`/`data-intensity` and the Tier-2→Tier-3 token rebinding in `globals.css` drives all color. Data flows through role-gated API route handlers (`auth.getUser` → STAFF_ROLES gate → object-level IDOR guard → service-role admin client, which **bypasses RLS**). Copy helpers in `src/lib/copy/` are pure and enforce the four-audience discipline at the string boundary. The demo cast is a pure typed module (`src/lib/demo/demoCast.ts`) whose correctness is proven by unit tests that run the **real** signal functions — so "every screen case renders" is guaranteed without a live database; the `.ts` seed scripts (run via `tsx`) consume that cast to write Supabase rows.

**Tech Stack:** Next.js 16.2.9 (App Router, Turbopack) · React 19 · Tailwind CSS v4 (`@tailwindcss/postcss`, no `tailwind.config.js`) · TypeScript · Supabase (Postgres + Auth, service-role admin client server-side only) · Vitest 4.1.9 + @testing-library/react + jsdom. Import alias `@/*` → `src/*`.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec (`docs/superpowers/specs/2026-06-18-core-v2-p4b-foundation.md` §2) and the grounding files.

**Four-audience discipline.**
- **Never-Band soft words:** student/parent surfaces never render the mastery `band` enum; banding only ever appears as soft, non-ranking copy.
- **Banded-risk-never-a-number:** a risk score never enters the DOM or a `data-*` attribute. Teacher/admin surfaces render the *band label only* (`low | medium | high | critical`).
- **CL / diagnostic = teacher-only:** comprehension-level verbs, diagnoses, divergence, and recurring-misconception strings appear on teacher/admin surfaces only — never student/parent.
- **Growth never peer-relative + never fabricated:** growth is "you vs your own past" only; never invented when data is insufficient (cold-start states instead).
- **Aggregate-first admin with deliberate, named drill-down (FERPA/LGPD).**
- **Observational, not diagnostic:** copy describes what was observed, never labels the child.

**Naming.** User-facing term is **"Assignments"**, never "Homework". Legacy term survives only in internal DB identifiers (`homework_attempts`, `hw_*`); no UI surface, label, or copy-helper output says "Homework".

**WCAG-AA contrast gate (prebuild, un-bypassable).** `npm run prebuild` runs `npm run a11y` (`npx tsx scripts/a11y/contrast-check.ts`) and exits 1 on any failure. No hardcoded hex or color-name literals in components — Tier-2 token references only. **Deep-ink readability:** body copy that carries meaning uses `--fg`/`text-fg`, never `--fg-muted` (which is reserved for eyebrows, icons, decorative labels).

**Next.js 16 conventions.** `params` and `searchParams` are `Promise`s — `await` them in the handler. `cookies()`/`headers()` are async. Confirm any framework API against `node_modules/next/dist/docs/01-app/`.

**Auth chain (every protected route).** `await createServerSupabaseClient()` → `supabase.auth.getUser()` → 401 → STAFF_ROLES gate (read `users.role`, reject if not in `{teacher, school_admin, school_sysadmin, platform_admin}`) → 403 → object-level IDOR guard (`guardClassAccess` / `guardStudentAccess` / `guardPlatformAdmin`) → 403 → only then `createAdminSupabaseClient()` (synchronous).

**RLS is NOT the IDOR backstop.** The service-role admin client bypasses RLS entirely. The role gate + per-object guards (`src/lib/auth/guards.ts`) are the *only* access control on admin-client cross-user reads.

**Test conventions (verified against green 4a tests).**
- Pure-function / Node tests (`*.test.ts`): default `environment: 'node'` — no pragma.
- React component tests (`*.test.tsx`): **first line** `// @vitest-environment jsdom`, then the file's existing 4a setup line — most files use `import '@/test/setup-dom';`, but `EmptyState.test.tsx` uses `import '@testing-library/jest-dom';` + a manual `afterEach(cleanup)`. **When appending tests to an existing file, follow that file's existing header — do not add a second pragma or setup import.**
- Run a single test file: `npx vitest run <path>`. Run all: `npm test`. Type-check: `npx tsc --noEmit`.
- Commit on every green task. (Repo is not yet a git repo — `git init` once before Task 1 if needed.)

**Service-role env var.** `createAdminSupabaseClient` reads `process.env.SUPABASE_SECRET_KEY`. SSR client reads `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

---

## Post-review revisions (2026-06-19)

This plan was hardened by an in-house adversarial review (5 verification lenses; Codex was attempted in parallel but ran too slow and was dropped per the operator). The review **executed** the real signal functions over the cast and found the original risk math unsatisfiable. All confirmed findings are folded in below; the highlights:

- **R1 (was a coverage-breaking bug):** the original cast produced NO `critical`-risk student (`computeRosterRiskIndex`'s completion penalty saturates at +20 for any submission rate ≥0.7, capping Darius at 70=`high`). **Fixed:** `DemoQuiz` gains `daysAgo`; Darius is now genuinely stale (>21d → recency penalty fires) with redo-rate >0.4, re-derived to **79 = critical**. Jordan is re-labeled `high` (it computes to 51; `medium` is covered by Sofia≈45 and Nadia≈27.5). Re-verify by running Task 1's test — never relax the assertions.
- **R2 (account-takeover):** `users.email` has no UNIQUE constraint; the original email-keyed upsert could overwrite a real user's `role`/`school_id`, and the cast embedded the real operator email. **Fixed:** reconcile by auth id (paginated `listUsers`), never overwrite `role`/`school_id` on a row the seed didn't create, hard-fail on mismatch; the demo seed no longer creates/modifies the platform_admin (the operator already has global access).
- **R3:** `GET /api/teacher/classes` could leak across tenants for a staff user with `school_id = null`. **Fixed:** explicit per-role branches; admins require non-null `school_id` (else 403).
- **R4:** the `skills` `ON CONFLICT ON CONSTRAINT` approach fails (the target is an *expression* unique index, no `pg_constraint`). **Fixed:** pre-query insert-if-absent keyed on `(school_id, COALESCE(subject,''), slug)`.
- **R5–R8 + minors:** `auth.admin.getUserByEmail` does not exist (use `listUsers`); the reteach-cycle test now builds rows from `daysAgo` and sign-checks improvement; `assignments.content` is NOT NULL (seed must emit it); Task 14 reuses the existing `(super-admin)` group; nav test alias + "9 destinations"; narrativeRank tiebreak test. See `PLAN-REVIEW-LOG-P4B.md` for the full accept/reject log.

---

## Grounding Corrections — this plan SUPERSEDES the spec where they conflict

The grounding pass (6 fact-sheets in `docs/superpowers/plans/grounding/p4b-0{1..6}-*.md`, read verbatim from the live codebase) caught spec errors. Each task lists the grounding file(s) it must read first.

| # | Spec said | Reality (grounded) | Plan does |
|---|---|---|---|
| C1 | seed yields `diagnose()` `{reteach, verbal_check, practice, monitor}` | `roster-signals` passes `error_types: []` (route line 148), so **`practice` (pattern 4) is unreachable**. Reachable: `verbal_check`, `reteach`, `profile`, `monitor`. | Seed targets `{verbal_check, reteach, profile, monitor}`. `practice` documented as unreachable until a screen API populates `error_types` (out of foundation scope). |
| C2 | use `masteryLabel(...)` | exported name is `masteryDisplayLabel` (`src/lib/utils/masteryLabel.ts`). | Use `masteryDisplayLabel`. |
| C3 | "export ConfidenceWord — already declared" | `ConfidenceWord` is module-private in CLBadge (line 31); `RiskBand` is **imported** into RiskBadge from `@/lib/copy/riskBandLabel`. | Add `export` to `ConfidenceWord`; import `RiskBand` from `@/lib/copy/riskBandLabel` for the `band?` prop. |
| C4 | signals route fix adds `divergence_flagged` + `growth_history` | `divergence_flagged` **already present** (route lines 268-272). | Add only `growth_history: snapshotScores`. |
| C5 | `await createAdminSupabaseClient()` patterns | it is **synchronous**. | Call without `await`. |
| C6 | `school_licenses` trial row | `status` CHECK uses `'trialing'`; `tier` ∈ `{essentials,professional,enterprise}`. | `status:'trialing'`, `tier:'professional'`. |
| C7 | skills upsert `(school_id, subject, slug)` | the unique target is an **expression index** `uq_skills_school_subject_slug ON (school_id, COALESCE(subject,''), slug)` — it has a `pg_index` entry but **no `pg_constraint`**, so `ON CONFLICT ON CONSTRAINT` raises "constraint does not exist", and supabase-js `.upsert({onConflict})` cannot express the `COALESCE`. | **Pre-query insert-if-absent**: SELECT by `school_id` + `slug` + `COALESCE(subject,'')` (treat null subject as `''`); insert only if absent. No `ON CONFLICT` against this index from supabase-js. |
| C8 | seed writes `student_model` / `student_gamification` / `signal_aggregates` / `alerts`; reads `reteach_cycles` | **none of these tables exist** in migrations 0001-0011. | Snapshots → `student_model_snapshots` (multi-row). Gamification/signal_aggregates/alerts → **omit**. Reteach cycles → computed **in memory** from `homework_attempts` redo pairs (no table). |
| C9 | `assignments.allow_redo` / `assignments.flagged_by` | both live on **`homework_attempts`**, not `assignments`. `assignments` has `reteach_needed`, `teacher_reviewed`, `teacher_override_reason`, and `content jsonb **NOT NULL**`. | Write redo/flag fields on `homework_attempts`; `reteach_needed` on `assignments`; always emit a non-null `assignments.content`. |
| C10 | `homework_attempts` has `score`/`grade`/`response_text`/`class_id` | V2 has `score_pct`, `responses` (jsonb), and **no** `class_id`. | Map to `score_pct`; prose → `responses: { response_text }`; never write `class_id` on `homework_attempts`. |
| C11 | seed is `scripts/seedDemo.mjs` | repo uses `tsx` for scripts; a typed cast enables unit testing. | Seed is `scripts/seedDemo.ts` run via `tsx`; cast lives in `src/lib/demo/demoCast.ts`. |
| C12 | test harness needs setup wiring | 4a component tests are green via per-file `// @vitest-environment jsdom` + the file's own setup line. | No setup task; follow each file's existing 4a header. |
| **C13** | grounding §2 says reconcile via `auth.admin.getUserByEmail` | that method **does not exist** in the installed auth-js (`GoTrueAdminApi` exposes `listUsers`/`createUser` only); `users.email` has **no UNIQUE constraint** so `.maybeSingle()` on email is unsafe. | Reconcile by **auth id** via paginated `admin.auth.admin.listUsers()`; never overwrite `role`/`school_id` on a pre-existing row the seed didn't create; **hard-fail** on role/school mismatch instead of silently rebinding. |
| **C14** | seed creates a `platform_admin` = the operator email | rebinding the real operator account to the demo school is an account-takeover. | The demo seed does **not** create/modify the platform_admin; the operator's real global `platform_admin` already has access. Provisioning (caller-supplied `teacher_email`) hard-fails if an existing auth user with that email has a different role/school. |

---

## File Structure

### Created
| Path | Responsibility |
|---|---|
| `src/lib/demo/demoCast.ts` | Pure typed 8-student engineered cast + expected-signal helpers. |
| `src/lib/demo/__tests__/demoCast.test.ts` | Proves the cast produces every screen case via the **real** signal libs. |
| `src/lib/demo/buildSeedRows.ts` | Pure: cast + `now` → the exact DB row objects (incl. all 4 Gradebook cell states; non-null `content`). |
| `src/lib/demo/__tests__/buildSeedRows.test.ts` | Asserts row shapes, enum values, cell states, non-null content, `due_at` relative to `now`. |
| `scripts/seedDemo.ts` | Idempotent (reconcile-by-auth-id) writer that consumes `buildSeedRows` + creates auth users. |
| `scripts/resetDemo.ts` | Tears down the demo tenant + its auth users by email. |
| `src/lib/copy/leakGuard.ts` | Denylist + `assertNoLeak(text)` (throws in dev/test on a forbidden token). |
| `src/lib/copy/pctIncorrectToWords.ts` | Incorrect-% → soft words, no digits out. |
| `src/lib/copy/effortPhrase.ts` | `effort_label` enum → teacher copy. |
| `src/lib/copy/reteachWorkingPhrase.ts` | `last_reteach_outcome` → soft "this is working" copy. |
| `src/lib/copy/diagnosisToFeedSentence.ts` | **Alerts leak-fix:** structured diagnosis → teacher feed sentence, no raw %. |
| `src/lib/copy/narrativeRank.ts` | Deterministic salience scorer for ordering feed signals. |
| `src/lib/copy/__tests__/*.test.ts` | One per helper. |
| `src/app/api/teacher/classes/route.ts` | `GET` the caller's own classes for the class-switcher pill. |
| `src/app/(teacher)/_components/TeacherNav.tsx` | Client nav with per-route active state. |
| `src/app/(teacher)/_components/ClassSwitcherPill.tsx` | Header class selector, writes `?class=`. |
| `src/app/(teacher)/{today,roster,gradebook,alerts,high-fives,insights,upload}/page.tsx` | Placeholder route slots. |
| `src/app/(teacher)/students/[studentId]/page.tsx` | One-Student placeholder (dynamic). |
| `src/app/(teacher)/library/{lessons,quizzes}/page.tsx` | Library placeholders. |
| `src/app/(teacher)/studio/page.tsx` | Studio placeholder. |
| `src/lib/trial/seedTrialDemoData.ts` | Trial-tenant seeder (port of V1, v2 schema). |
| `src/lib/trial/provisionTrial.ts` | Real-school provisioning (school + license + auth users + seed). |
| `src/lib/trial/logTrialEvent.ts` | Direct port of V1 (insert `trial_events`). |
| `src/app/api/admin/provision-trial/route.ts` | `POST` provisioning, `platform_admin`-gated. |
| `src/app/(super-admin)/provision/page.tsx` | Minimal admin UI to drive provisioning (reuses the existing `(super-admin)` group). |

### Modified
| Path | Change |
|---|---|
| `src/lib/auth/roles.ts` | Add and export `STAFF_ROLES`. |
| `src/components/core/RiskBadge.tsx` | Add `band?: RiskBand` (pre-banded path). |
| `src/components/core/CLBadge.tsx` | `export` `ConfidenceWord`; add `confidenceWord?` prop. |
| `src/components/core/EmptyState.tsx` | Add `titleOverride?`/`bodyOverride?`; body `text-fg-muted` → `text-fg`. |
| `src/components/core/GrowthMotif.tsx` | Add `growth_history?` alias + `accent?: 'brand' | 'ok'`. |
| `src/app/globals.css` | Add `.growth-motif--wins { --brand: var(--ok); --brand-accent: var(--ok); }`. |
| `src/app/api/teacher/student/[studentId]/signals/route.ts` | Add `growth_history: snapshotScores` to the response. |
| `src/app/(teacher)/layout.tsx` | Replace stub nav with `TeacherNav` + `ClassSwitcherPill`. |
| `package.json` | Add `seed:demo`, `seed:demo:reset` scripts. |
| `docs/superpowers/plans/grounding/p4b-05-v1-port.md` | Correct §2/§12: `getUserByEmail` → paginated `listUsers` (done as part of Task 2). |

---

## Sequencing

1. **Task 1-2** — Demo cast + seed (Task 1 of the whole 4b build; precondition for verifying everything).
2. **Task 3-5** — Copy helpers (pure, unblock Alerts/Today; `leakGuard` first).
3. **Task 6-7** — Component tweaks + signals one-liner (additive; unblock screen primitives).
4. **Task 8** — `GET /api/teacher/classes` (before the pill).
5. **Task 9-10** — Nav shell.
6. **Task 11-14** — Pilot/trial provisioning (**HIGH PRIORITY, parallel** to 3-10 once Task 1-2's auth-user pattern lands; pilot contracts going out).

---

## Task 1: Demo cast + signal-correctness proof

**Files:**
- Create: `src/lib/demo/demoCast.ts`
- Test: `src/lib/demo/__tests__/demoCast.test.ts`

**Grounding (read first):** `p4b-01-schema.md` (enum values, mastery-band CHECK), `p4b-04-copy-signals.md` (`diagnose` table, `computeHwQuizDivergence`, `computeReteachEffectiveness`, `masteryDisplayLabel`). And these verbatim facts:
- `diagnose()` first-match table: `verbal_check` ⟸ `div≥25 ∧ hw_avg<50 ∧ quiz_avg≥60` (sev2); `reteach` ⟸ `div≥25 ∧ quiz_avg<50` (sev3); `profile` ⟸ `div≥25` else (sev1); `monitor` ⟸ `20≤div<25` (sev1); else `null`.
- `computeHwQuizDivergence`: needs ≥2 graded HW & ≥1 graded quiz; if `|hw_avg−quiz_avg|≤10` → `divergence_score = round(|gap|)`, else `round(min(100, |gap|/50*100))`.
- `computeRosterRiskIndex` bands: `<25 low`, `<50 medium`, `<75 high`, `≥75 critical`. Penalties: hw≤60→+25, quiz≤60→+25, completion saturates at **+20 for any rate≥0.7** (the quirk that defeated the first cast), recency `daysSince>7`→ up to +5 (max at ≥21d), redo rate >0.4 → up to +10, declining trend → up to +15. **To reach critical you need a real submission gap (>21d) AND redo-rate >0.4 on top of low hw+quiz.**
- `currentMasteryBand`: latest **complete** quiz's `mastery_band` by `submitted_at` desc; `null` if none. `bandIsVolatile`: last-3 quizzes span >1 band.
- `detectCompletedReteachCycles`: per `assignment_id`, an attempt with `allow_redo===true && score!==null` paired with a later (`created_at >`) attempt with `score!==null && submitted_at!==null`; `improvement = post − pre`.

**Interfaces:**
- Produces: `DEMO_STUDENTS: DemoStudent[]`, `DEMO_TEACHER`, `DEMO_PARENT`, `DEMO_ADMIN`, `DEMO_SCHOOL_NAME`, and types below. Consumed by Task 2 (`buildSeedRows`) and Task 11 (trial seeder shares the profile shape). **There is no `DEMO_PLATFORM_ADMIN`** — the operator's real global `platform_admin` account is never created/modified by the seed (C14).

```ts
// src/lib/demo/demoCast.ts
// Pure, typed demo cast for CORE v2. NO Next/Supabase imports.
// Each profile is engineered so the REAL signal functions (diagnose,
// computeHwQuizDivergence, computeRosterRiskIndex, currentMasteryBand) emit a
// distinct case — proven in demoCast.test.ts. See grounding p4b-04.
import type { MasteryBand } from '@/types/core';

export type EffortLabel =
  | 'effortful_success' | 'struggling_trying'
  | 'independent_success' | 'independent_struggle';

/** One quiz attempt (newest-first in the array). daysAgo sets submitted_at/created_at = now − daysAgo. */
export interface DemoQuiz { score_pct: number; mastery_band: MasteryBand; daysAgo: number }

/** One homework attempt. status 'graded' → score_pct + graded; 'submitted' → submitted, ungraded.
 *  'missing'/'not-due' cells are produced by ABSENCE of a row (see buildSeedRows), not here. */
export interface DemoHw {
  score_pct: number | null;
  status: 'graded' | 'submitted';
  daysAgo: number;
  is_redo?: boolean;
  allow_redo?: boolean;
  flagged_by?: 'auto' | 'teacher';
}

export interface DemoStudent {
  key: string;            // stable slug for email + idempotency
  full_name: string;
  effort_label: EffortLabel;
  quizzes: DemoQuiz[];    // [] = never assessed (Nadia)
  homework: DemoHw[];
  reteachNeeded?: boolean;
  /** human-readable expected outcomes — asserted in the test, not written to DB. */
  expect: {
    band: MasteryBand | null;
    volatile: boolean;
    diagnose: 'verbal_check' | 'reteach' | 'profile' | 'monitor' | null;
    risk: 'low' | 'medium' | 'high' | 'critical';
  };
}

export const DEMO_SCHOOL_NAME = 'CORE Demo School';

export const DEMO_TEACHER = { key: 'teacher', full_name: 'Dana Whitfield', role: 'teacher' as const };
export const DEMO_PARENT  = { key: 'parent',  full_name: 'Rosa Rivera',    role: 'parent'  as const };
export const DEMO_ADMIN   = { key: 'admin',   full_name: 'Priya Anand',    role: 'school_admin' as const };

// Engineered cast. Targets chosen so the REAL signal fns emit each case (see test).
export const DEMO_STUDENTS: DemoStudent[] = [
  { key: 'alex',   full_name: 'Alex Rivera',   effort_label: 'independent_success',
    quizzes: [{score_pct:90,mastery_band:'advanced',daysAgo:2},{score_pct:92,mastery_band:'advanced',daysAgo:9},{score_pct:88,mastery_band:'advanced',daysAgo:16}],
    homework: [{score_pct:92,status:'graded',daysAgo:2},{score_pct:90,status:'graded',daysAgo:9},{score_pct:94,status:'graded',daysAgo:16}],
    expect: { band:'advanced', volatile:false, diagnose:null, risk:'low' } },          // hw+quiz>=85 -> 0; +20 completion = 20 low

  { key: 'sofia',  full_name: 'Sofia Chen',    effort_label: 'effortful_success',
    quizzes: [{score_pct:59,mastery_band:'grade_level',daysAgo:2},{score_pct:60,mastery_band:'grade_level',daysAgo:9},{score_pct:58,mastery_band:'grade_level',daysAgo:16}],
    homework: [{score_pct:86,status:'graded',daysAgo:2},{score_pct:88,status:'graded',daysAgo:9},{score_pct:84,status:'graded',daysAgo:16}],
    expect: { band:'grade_level', volatile:false, diagnose:'profile', risk:'medium' } }, // gap +27 div 54, hw>=50 & quiz>=50 -> profile; risk ~45 medium

  { key: 'marcus', full_name: 'Marcus Johnson', effort_label: 'struggling_trying', reteachNeeded: true,
    quizzes: [{score_pct:40,mastery_band:'reteach',daysAgo:3},{score_pct:70,mastery_band:'grade_level',daysAgo:10},{score_pct:45,mastery_band:'reteach',daysAgo:17}],
    homework: [{score_pct:50,status:'graded',daysAgo:3},{score_pct:52,status:'graded',daysAgo:10},{score_pct:48,status:'graded',daysAgo:17}],
    expect: { band:'reteach', volatile:true, diagnose:null, risk:'high' } },            // gap ~-2 aligned -> null; last-3 bands {reteach,grade_level,reteach}; risk ~70

  { key: 'emma',   full_name: 'Emma Patel',    effort_label: 'independent_struggle',
    quizzes: [{score_pct:66,mastery_band:'grade_level',daysAgo:2},{score_pct:45,mastery_band:'reteach',daysAgo:9},{score_pct:82,mastery_band:'advanced',daysAgo:16}],
    homework: [{score_pct:40,status:'graded',daysAgo:2},{score_pct:42,status:'graded',daysAgo:9},{score_pct:38,status:'graded',daysAgo:16}],
    expect: { band:'grade_level', volatile:true, diagnose:'verbal_check', risk:'high' } }, // hw 40 / quiz ~64 -> div 49, hw<50 & quiz>=60

  { key: 'jordan', full_name: 'Jordan Kim',    effort_label: 'effortful_success',
    quizzes: [{score_pct:72,mastery_band:'grade_level',daysAgo:4},{score_pct:70,mastery_band:'grade_level',daysAgo:11},{score_pct:74,mastery_band:'grade_level',daysAgo:18}],
    // reteach cycle: original (allow_redo, flagged teacher, 55, OLDER) -> later redo (80, NEWER). improvement +25.
    homework: [{score_pct:80,status:'graded',daysAgo:4,is_redo:true},
               {score_pct:55,status:'graded',daysAgo:12,allow_redo:true,flagged_by:'teacher'},
               {score_pct:71,status:'graded',daysAgo:19},{score_pct:70,status:'graded',daysAgo:26}],
    expect: { band:'grade_level', volatile:false, diagnose:null, risk:'high' } },        // RE-LABELED high (computes ~51): hw_avg 69 + redoRate .5. medium covered by Sofia/Nadia.

  { key: 'lily',   full_name: 'Lily Torres',   effort_label: 'effortful_success',
    quizzes: [{score_pct:76,mastery_band:'grade_level',daysAgo:3},{score_pct:74,mastery_band:'grade_level',daysAgo:10},{score_pct:78,mastery_band:'grade_level',daysAgo:17}],
    homework: [{score_pct:64,status:'graded',daysAgo:3},{score_pct:62,status:'graded',daysAgo:10},{score_pct:66,status:'graded',daysAgo:17}],
    expect: { band:'grade_level', volatile:false, diagnose:'monitor', risk:'high' } },    // gap -12 div 24 -> monitor

  { key: 'darius', full_name: 'Darius Moore',  effort_label: 'independent_struggle',
    // R1 FIX: all submissions >21d stale (recency +5) + 2 is_redo (redoRate .67 -> +~4.5) on top of hw 58/quiz ~37 (25+25) + completion 20 = ~79 CRITICAL.
    // No allow_redo here, so Darius forms NO reteach cycle (only Jordan does).
    quizzes: [{score_pct:36,mastery_band:'reteach',daysAgo:22},{score_pct:40,mastery_band:'reteach',daysAgo:26},{score_pct:34,mastery_band:'reteach',daysAgo:30}],
    homework: [{score_pct:58,status:'graded',daysAgo:22,is_redo:true},{score_pct:60,status:'graded',daysAgo:26},{score_pct:56,status:'graded',daysAgo:30,is_redo:true}],
    expect: { band:'reteach', volatile:false, diagnose:'reteach', risk:'critical' } },    // hw 58 / quiz ~37 -> div 43, quiz<50 -> reteach

  { key: 'nadia',  full_name: 'Nadia Okafor',  effort_label: 'independent_success',
    quizzes: [],                                                                          // never assessed -> null band (cold-start)
    homework: [{score_pct:88,status:'graded',daysAgo:5},{score_pct:86,status:'graded',daysAgo:12}],
    expect: { band:null, volatile:false, diagnose:null, risk:'medium' } },                // no quiz -> quizPenalty 7.5 + completion 20 ~= 27.5 medium
];
```

- [ ] **Step 1: Write the failing test** — `src/lib/demo/__tests__/demoCast.test.ts`. It imports the **real** signal functions and asserts each profile's `expect`, plus the aggregate coverage. It derives quiz/hw submitted_at from `daysAgo` (so recency and band-ordering match the route and the seed).

```ts
import { describe, it, expect } from 'vitest';
import { DEMO_STUDENTS } from '../demoCast';
import { diagnose } from '@/lib/signals/diagnosis';
import { computeHwQuizDivergence } from '@/lib/signals/computeHwQuizDivergence';
import { computeRosterRiskIndex } from '@/lib/signals/computeRosterRiskIndex';
import { currentMasteryBand, bandIsVolatile } from '@/lib/utils/scoring';
import { detectCompletedReteachCycles, aggregateReteachStats } from '@/lib/signals/computeReteachEffectiveness';

const REF = new Date('2026-06-19T12:00:00Z');
const iso = (d: number) => new Date(REF.getTime() - d * 864e5).toISOString();

// Mirror roster-signals/route.ts exactly: hw_avg/quiz_avg from graded score_pct,
// divergence via computeHwQuizDivergence, error_types: [], real dated submitted_at.
function deriveSignals(s: typeof DEMO_STUDENTS[number]) {
  const quizScores = s.quizzes.map(q => q.score_pct);
  const hwScores = s.homework.filter(h => h.score_pct != null).map(h => h.score_pct as number);
  const hw_avg = hwScores.length ? hwScores.reduce((a,b)=>a+b,0)/hwScores.length : null;
  const quiz_avg = quizScores.length ? quizScores.reduce((a,b)=>a+b,0)/quizScores.length : null;
  const div = computeHwQuizDivergence({ homeworkScores: hwScores, quizScores });
  const diagResult = diagnose({ divergence_score: div.divergence_score, hw_avg, quiz_avg, error_types: [] });
  const quizForBand = s.quizzes.map(q => ({ mastery_band: q.mastery_band, submitted_at: iso(q.daysAgo), is_complete: true }));
  const band = currentMasteryBand(quizForBand);
  const volatile = bandIsVolatile(quizForBand);
  const risk = computeRosterRiskIndex({
    homeworkAttempts: s.homework.map(h => ({
      score: h.score_pct, allow_redo: !!h.allow_redo, is_redo: !!h.is_redo, submitted_at: iso(h.daysAgo),
    })),
    quizAttempts: s.quizzes.map(q => ({ score: q.score_pct, submitted_at: iso(q.daysAgo) })),
    totalAssigned: s.homework.length,
  }, REF);
  return { band, volatile, diagnose: diagResult?.suggestedAction ?? null, risk: risk.risk_level };
}

describe('demoCast — each profile produces its engineered signal case', () => {
  for (const s of DEMO_STUDENTS) {
    it(`${s.full_name}: band/volatile/diagnose/risk match expect`, () => {
      const got = deriveSignals(s);
      expect(got.band).toBe(s.expect.band);
      expect(got.volatile).toBe(s.expect.volatile);
      expect(got.diagnose).toBe(s.expect.diagnose);
      expect(got.risk).toBe(s.expect.risk);
    });
  }
});

describe('demoCast — class-wide coverage (every screen case renders)', () => {
  it('covers all three mastery bands + a null (not-yet-assessed)', () => {
    expect(new Set(DEMO_STUDENTS.map(s => deriveSignals(s).band)))
      .toEqual(new Set(['reteach', 'grade_level', 'advanced', null]));
  });
  it('focus_group covers verbal_check, reteach, profile, monitor', () => {
    expect(new Set(DEMO_STUDENTS.map(s => deriveSignals(s).diagnose).filter(Boolean)))
      .toEqual(new Set(['verbal_check', 'reteach', 'profile', 'monitor']));
  });
  it('risk spread covers low, medium, high, critical', () => {
    expect(new Set(DEMO_STUDENTS.map(s => deriveSignals(s).risk)))
      .toEqual(new Set(['low', 'medium', 'high', 'critical']));
  });
  it('has all four effort labels', () => {
    expect(new Set(DEMO_STUDENTS.map(s => s.effort_label)).size).toBe(4);
  });
  it('has at least two volatile students', () => {
    expect(DEMO_STUDENTS.filter(s => deriveSignals(s).volatile).length).toBeGreaterThanOrEqual(2);
  });
  it("yields Jordan's improving reteach cycle (sign-checked) and no inverted cycle", () => {
    const rowsFor = (s: typeof DEMO_STUDENTS[number]) => s.homework.map((h, hi) => ({
      id: `${s.key}-${hi}`, student_id: s.key, assignment_id: `${s.key}-a`,
      score: h.score_pct, allow_redo: !!h.allow_redo, is_redo: !!h.is_redo,
      flagged_by: (h.flagged_by ?? null) as 'auto' | 'teacher' | null,
      submitted_at: iso(h.daysAgo), created_at: iso(h.daysAgo),
    }));
    const jordan = DEMO_STUDENTS.find(s => s.key === 'jordan')!;
    const jCycles = detectCompletedReteachCycles(rowsFor(jordan), new Set());
    expect(jCycles.length).toBeGreaterThanOrEqual(1);
    expect(jCycles.every(c => c.improvement > 0)).toBe(true);          // +25, never a regression
    const all = DEMO_STUDENTS.flatMap(s => detectCompletedReteachCycles(rowsFor(s), new Set()));
    const stats = aggregateReteachStats(all);
    expect(stats.success_rate).toBe(100);                               // only Jordan's cycle; no inverted cycles
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run src/lib/demo/__tests__/demoCast.test.ts` → fails (module missing).
- [ ] **Step 3: Implement `demoCast.ts`** exactly as in the code block above.
- [ ] **Step 4: Run, expect PASS.** If any `expect` mismatches, the data is wrong — tune the failing student's scores until the **real** functions agree. Do NOT change the assertions to match the data. (The completion-penalty quirk means `critical`/full recency require a real >21d gap + redo-rate >0.4 — keep Darius stale.)
- [ ] **Step 5: Commit** — `git add src/lib/demo && git commit -m "feat(demo): engineered demo cast proven against real signal fns"`.

---

## Task 2: Seed writer + reset + npm scripts

**Files:**
- Create: `src/lib/demo/buildSeedRows.ts`, `src/lib/demo/__tests__/buildSeedRows.test.ts`, `scripts/seedDemo.ts`, `scripts/resetDemo.ts`
- Modify: `package.json` (scripts); `docs/superpowers/plans/grounding/p4b-05-v1-port.md` (§2/§12: strike `getUserByEmail`, point to `listUsers`)

**Grounding (read first):** `p4b-01-schema.md` (every column + CHECK + upsert key), `p4b-05-v1-port.md` §2/§6/§7/§11-15 (note the C13 correction below overrides §2's `getUserByEmail`), `p4b-02-auth.md` (admin client is sync, reads `SUPABASE_SECRET_KEY`).

**Interfaces:**
- Consumes: `DEMO_STUDENTS`, `DEMO_*` (Task 1).
- Produces: `buildSeedRows(cast, now: Date)` → `{ assignments[], homework_attempts[], quiz_attempts[], snapshots[], skill_learning_state[], misconceptions[] }` keyed by student `key` + assignment key (the writer resolves keys→uuids).

**Cell-state engineering (the four Gradebook states).** `buildSeedRows` emits **4 assignments** with `due_at` relative to `now`: A1 `now − 10d`, A2 `now − 3d`, A3 `now − 1d`, A4 `now + 5d` (future). Every assignment gets a **non-null `content` jsonb** (C9 — the band-differentiated `TASKS_BY_BAND` shape from `p4b-05` §11). Per student × assignment:
- **graded:** a `homework_attempts` row with `status:'graded'`, `score_pct`, `graded_at`.
- **submitted:** row with `submitted_at`, `status:'submitted'`, `score_pct: null`, no `graded_at`.
- **missing:** **no** row, assignment `due_at` in the past.
- **not-due:** **no** row, assignment `due_at` in the future (A4).
Mapping: every student graded on A1; Alex/Sofia/Lily graded on A2; Marcus submitted-not-graded on A2; Darius/Emma missing on A3; everyone no row on A4 → guarantees ≥1 of each state.

- [ ] **Step 1: Failing test** — `buildSeedRows.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSeedRows } from '../buildSeedRows';
import { DEMO_STUDENTS } from '../demoCast';

const NOW = new Date('2026-06-19T12:00:00Z');

describe('buildSeedRows', () => {
  const rows = buildSeedRows(DEMO_STUDENTS, NOW);

  it('emits 4 assignments with due_at relative to now (one in the future)', () => {
    expect(rows.assignments).toHaveLength(4);
    expect(rows.assignments.filter(a => new Date(a.due_at) > NOW).length).toBeGreaterThanOrEqual(1);
  });
  it('every assignment has non-null content jsonb (C9 NOT NULL)', () => {
    expect(rows.assignments.every(a => a.content != null)).toBe(true);
  });
  it('produces all four Gradebook cell states across the matrix', () => {
    const graded   = rows.homework_attempts.some(h => h.status === 'graded' && h.score_pct != null && h.graded_at);
    const submitted= rows.homework_attempts.some(h => h.status === 'submitted' && h.score_pct == null && h.submitted_at && !h.graded_at);
    const pastDue  = rows.assignments.filter(a => new Date(a.due_at) < NOW).map(a => a.key);
    const missing  = pastDue.some(ak => DEMO_STUDENTS.some(s =>
      !rows.homework_attempts.some(h => h.student_key === s.key && h.assignment_key === ak)));
    const notDue   = rows.assignments.some(a => new Date(a.due_at) > NOW);
    expect(graded && submitted && missing && notDue).toBe(true);
  });
  it('only uses valid effort_label + mastery_band enum values', () => {
    const EFFORT = new Set(['effortful_success','struggling_trying','independent_success','independent_struggle']);
    rows.homework_attempts.forEach(h => h.effort_label && expect(EFFORT.has(h.effort_label)).toBe(true));
    const BAND = new Set(['reteach','grade_level','advanced']);
    rows.quiz_attempts.forEach(q => expect(BAND.has(q.mastery_band)).toBe(true));
  });
  it('gives every student >=4 dated snapshots for GrowthMotif', () => {
    DEMO_STUDENTS.forEach(s =>
      expect(rows.snapshots.filter(r => r.student_key === s.key).length).toBeGreaterThanOrEqual(4));
  });
  it('never writes class_id on homework_attempts (C10)', () => {
    rows.homework_attempts.forEach(h => expect('class_id' in h).toBe(false));
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `buildSeedRows.ts`** — pure function returning keyed row objects per the cell-state map; every assignment carries a non-null `content` jsonb; ≥4 ascending-`avg_score` snapshots per student (dates `now − 28/21/14/7 d`, `mastery_band` from latest quiz or null, populate `risk_score`/`divergence_score`/`consistency_label`/`dominant_effort_pattern`/`improvement_4w`/`consistency_score`); skill-learning-state rows spanning the 6-value enum across students (set `last_reteach_outcome` for Jordan + Marcus); misconceptions for Darius + Emma using valid `error_type` codes (`reasoning_gap`, `factual_error`).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Implement `scripts/seedDemo.ts`** — the writer. **Reconcile by AUTH ID (C13), never by email:**

```ts
// Paginate listUsers to resolve an auth id by email (getUserByEmail does NOT exist).
async function findAuthIdByEmail(admin, email: string): Promise<string | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function ensureAuthUser(admin, { email, password, full_name, role, school_id }): Promise<string> {
  // 1. Resolve auth identity (the only source of truth — email is NOT unique).
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name },
  });
  let id = created?.user?.id ?? null;
  if (!id) {
    if (error && /already|exist|registered/i.test(error.message)) id = await findAuthIdByEmail(admin, email);
    if (!id) throw error ?? new Error(`Could not ensure auth user ${email}`);
  }
  // 2. Reconcile the public.users row by ID. NEVER overwrite role/school_id on a row the seed didn't create.
  const { data: existing, error: selErr } = await admin.from('users').select('id, role, school_id').eq('id', id).maybeSingle();
  if (selErr) throw selErr;
  if (existing) {
    if (existing.role !== role || (existing.school_id && existing.school_id !== school_id)) {
      throw new Error(`Refusing to rebind existing user ${email} (role/school mismatch) — not seed-owned`);
    }
    await admin.from('users').update({ full_name }).eq('id', id);   // only non-identity fields
  } else {
    await admin.from('users').insert({ id, email, full_name, role, school_id });
  }
  return id;
}
```

Order: ensure demo `schools` row (`demo_mode:true`, find by `name`+`demo_mode`); create teacher/parent/admin + 8 students via `ensureAuthUser` (**no platform_admin — C14**); link parent→Alex (`users.parent_id` + `guardians` upsert `onConflict:'parent_id,student_id'`); class (find by `name`+`teacher_id`); enrollments (upsert `onConflict:'class_id,student_id'`); **skills via pre-query insert-if-absent on `(school_id, slug)` filtered by `subject` (treat null as `''`) — C7, no `ON CONFLICT`**; lesson → quiz (+ 5 `quiz_questions`, `question_type ∈ {mcq,open,numeric}`, each with `position`+`question_text`); then resolve `buildSeedRows` keys→uuids and insert quiz_attempts / assignments (`content` non-null, `reteach_needed` for Marcus) / homework_attempts (`responses:{response_text}`, never `class_id`) / `student_model_snapshots` (upsert `onConflict:'student_id,snapshot_date'`) / `skill_learning_state` (upsert `onConflict:'student_id,skill_id'`) / `misconception_observations`. Read `SUPABASE_SECRET_KEY` + `NEXT_PUBLIC_SUPABASE_URL`; **never log secrets**. Per-step try/catch (soft-fail) except school+teacher (hard-fail). (Note: the 0010-0011 columns — `effort_label`, `allow_redo`, `is_redo`, `flagged_by`, `consistency_score` — are present in the live DB; the stale "Task 17" comment in `0011_signals.sql` is wrong. Keep per-column writes soft-failed anyway.)
- [ ] **Step 6: Implement `scripts/resetDemo.ts`** — delete the demo `schools` row (cascades), then delete the demo auth users by email (`findAuthIdByEmail` + `admin.auth.admin.deleteUser(id)`). **Never** deletes the operator/platform_admin.
- [ ] **Step 7: Add npm scripts** to `package.json`:
```json
"seed:demo": "node --env-file=.env.local --import tsx scripts/seedDemo.ts",
"seed:demo:reset": "node --env-file=.env.local --import tsx scripts/resetDemo.ts"
```
(If the local Node lacks `--env-file`, fall back to `tsx --env-file=.env.local scripts/seedDemo.ts`.)
- [ ] **Step 8: Correct grounding** `p4b-05-v1-port.md` §2/§12: strike `auth.admin.getUserByEmail`, replace with the paginated `listUsers` reconcile-by-id pattern above (so future implementers don't copy the non-existent call).
- [ ] **Step 9: Documented live-DB verification** (needs `.env.local` with a real Supabase). Run `npm run seed:demo` twice; confirm identical row counts and no duplicate auth users. Then `npm run seed:demo:reset && npm run seed:demo`. (Data correctness is proven by Task 1.)
- [ ] **Step 10: Commit** — `git add src/lib/demo scripts package.json docs/superpowers/plans/grounding && git commit -m "feat(demo): reconcile-by-auth-id seed writer + reset"`.

---

## Task 3: leakGuard

**Files:** Create `src/lib/copy/leakGuard.ts`, `src/lib/copy/__tests__/leakGuard.test.ts`. **Grounding:** `p4b-04-copy-signals.md` §1 (pure-fn pattern).

**Interfaces:** Produces `LEAK_PATTERNS: RegExp[]`, `hasLeak(text): boolean`, `assertNoLeak(text, ctx?): void` (throws). Consumed by Tasks 4-5 tests.

- [ ] **Step 1: Failing test:**
```ts
import { describe, it, expect } from 'vitest';
import { hasLeak, assertNoLeak } from '../leakGuard';
describe('leakGuard', () => {
  it('flags bare digits, %, "avg", "score N", percentiles, rank words', () => {
    ['missed 25%','HW avg 80','score 42','73rd percentile','ranked 2nd','divergence score 30']
      .forEach(t => expect(hasLeak(t)).toBe(true));
  });
  it('passes clean soft copy', () => {
    ['missed about a quarter','worked hard and got there','this is working — keep going']
      .forEach(t => expect(hasLeak(t)).toBe(false));
  });
  it('assertNoLeak throws on a leak, is silent on clean text', () => {
    expect(() => assertNoLeak('avg 80%')).toThrow();
    expect(() => assertNoLeak('missed about half')).not.toThrow();
  });
});
```
- [ ] **Step 2: Run, expect FAIL.** **Step 3:** Implement (regexes for `\d`, `%`, `\bavg\b`, `score\s+\d`, `\d+(st|nd|rd|th)\b`, `\brank(ed)?\b`, `\bpercentile\b`, case-insensitive). **Step 4: Run, expect PASS.** **Step 5: Commit.**

---

## Task 4: pctIncorrectToWords + effortPhrase + reteachWorkingPhrase

**Files:** Create the three helpers under `src/lib/copy/` + their tests. **Grounding:** `p4b-04-copy-signals.md`; `effort_label` enum (4 values), `last_reteach_outcome` is free text.

- [ ] **Step 1: Failing tests** — table-driven; every output passes `assertNoLeak`. e.g.
```ts
import { pctIncorrectToWords } from '../pctIncorrectToWords';
import { assertNoLeak } from '../leakGuard';
it('maps proportion to soft words with no digits', () => {
  expect(pctIncorrectToWords(0.25)).toMatch(/quarter/);
  expect(pctIncorrectToWords(50)).toMatch(/half/);          // accepts 0–1 or 0–100
  [0.1,0.25,0.5,0.75,90].forEach(p => assertNoLeak(pctIncorrectToWords(p)));
});
```
`effortPhrase`: each of the 4 enum values → distinct copy; `null`/unknown → neutral fallback. `reteachWorkingPhrase`: non-null outcome → "this is working / keep going"-style; never "%"/"failed"; `null` → safe fallback.
- [ ] **Step 2-5:** Run-fail → implement (the pct one normalizes a value ≥1 as /100) → run-pass → commit.

---

## Task 5: diagnosisToFeedSentence + narrativeRank

**Files:** Create both + tests. **Grounding:** `p4b-04-copy-signals.md` §2 — `DiagnoseResult.suggestedAction ∈ {reteach, practice, verbal_check, profile, monitor}`, `severity 1|2|3`.

**Interfaces:** `diagnosisToFeedSentence(d: { suggestedAction; severity }): string` — takes the **structured** fields, NOT the `diagnosis` string. `narrativeRank(s: { severity: number; recencyDays?: number; action?: string }): number` — deterministic, severity-first, stable tiebreak.

- [ ] **Step 1: Failing test:**
```ts
import { diagnosisToFeedSentence } from '../diagnosisToFeedSentence';
import { narrativeRank } from '../narrativeRank';
import { assertNoLeak } from '../leakGuard';
it('produces a leak-free sentence per suggestedAction', () => {
  (['reteach','practice','verbal_check','profile','monitor'] as const).forEach(a => {
    const s = diagnosisToFeedSentence({ suggestedAction: a, severity: 2 });
    expect(s.length).toBeGreaterThan(0);
    assertNoLeak(s);                  // no %, no avg numbers — the leak diagnose() introduces
  });
});
it('narrativeRank orders severity-first', () => {
  const items = [{severity:1},{severity:3},{severity:2}];
  expect([...items].sort((a,b)=>narrativeRank(b)-narrativeRank(a)).map(i=>i.severity)).toEqual([3,2,1]);
});
it('narrativeRank breaks ties deterministically by recency then action', () => {
  // equal severity -> more recent (smaller recencyDays) ranks higher; then a stable action order
  const a = { severity: 2, recencyDays: 1, action: 'reteach' };
  const b = { severity: 2, recencyDays: 9, action: 'reteach' };
  expect(narrativeRank(a)).toBeGreaterThan(narrativeRank(b));
  const c = { severity: 2, recencyDays: 1, action: 'monitor' };
  expect(narrativeRank(a)).not.toBe(narrativeRank(c));   // action is a deterministic tiebreak, never equal-rank ambiguity
});
```
- [ ] **Step 2-5:** Run-fail → implement (a verbatim map per `suggestedAction`, e.g. `verbal_check → "Strong on practice but the quiz didn't match — worth a quick verbal check."`, `reteach → "This concept looks like it needs another pass with the group."`, `monitor → "A small gap worth keeping an eye on."`, `profile → "Worth a quick look at what's going on for this student."`, `practice → "Targeted practice on this skill should help."`; narrativeRank = severity*1000 − recencyDays*10 + a fixed per-action offset) → run-pass → commit.

---

## Task 6: Component tweaks (RiskBadge, CLBadge, EmptyState, GrowthMotif + CSS)

**Files:** Modify `RiskBadge.tsx`, `CLBadge.tsx`, `EmptyState.tsx`, `GrowthMotif.tsx`, `globals.css`. Append tests to each component's `__tests__`. **Grounding:** `p4b-03-components.md` (exact props/lines), `p4b-06-shell-testinfra.md` §4 (`.growth-motif--wins` insertion point).

All four are **additive**; existing call sites + 4a tests stay green. `npm run a11y` must stay green. **When appending tests, follow each file's existing 4a header** (most use `import '@/test/setup-dom'`; `EmptyState.test.tsx` uses `import '@testing-library/jest-dom'` + `afterEach(cleanup)`) — do NOT add a duplicate pragma or setup import.

- [ ] **Step 1: Failing tests** (append, matching each file's existing header):
```tsx
// RiskBadge.test.tsx: pre-banded path, still no number in DOM
it('renders band directly when band prop given, no score needed', () => {
  render(<RiskBadge band="high" />);
  expect(screen.getByText('high')).toBeInTheDocument();
});
// CLBadge.test.tsx: ConfidenceWord exported + confidenceWord bypasses numeric
import { CLBadge, type ConfidenceWord } from '../CLBadge';
it('renders the soft word when confidenceWord given, no number', () => {
  render(<CLBadge state="on_track" confidenceWord="consistent" />);
  expect(screen.getByText(/consistent/)).toBeInTheDocument();
});
// EmptyState.test.tsx: overrides + deep-ink body
it('uses overrides and deep-ink body (text-fg, not text-fg-muted)', () => {
  const { container } = render(<EmptyState variant="on-track" titleOverride="Nothing flagged" bodyOverride="All clear here." />);
  expect(screen.getByText('Nothing flagged')).toBeInTheDocument();
  expect(container.querySelector('p')?.className).toContain('text-fg');
  expect(container.querySelector('p')?.className).not.toContain('text-fg-muted');
});
// GrowthMotif.test.tsx: growth_history alias + accent='ok' adds the wins class
it('charts growth_history and applies wins class for accent=ok', () => {
  const { container } = render(<GrowthMotif growth_history={[60,65,70,80]} accent="ok" />);
  expect(container.querySelector('.growth-motif--wins')).not.toBeNull();
});
it('cold-starts on <4 points regardless of accent', () => {
  const { getByTestId } = render(<GrowthMotif growth_history={[60,70]} accent="ok" />);
  expect(getByTestId('growth-motif-cold-start')).toBeInTheDocument();
});
```
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - **RiskBadge:** props → `{ score?: number; scale?: '0to1'|'0to100'; band?: RiskBand }` (RiskBand already imported from `@/lib/copy/riskBandLabel`); body `const band = props.band ?? riskBandLabel(props.score ?? 0, props.scale);`.
  - **CLBadge:** `type ConfidenceWord` → `export type ConfidenceWord`; add `confidenceWord?: ConfidenceWord | null`; `const word = confidenceWord !== undefined ? confidenceWord : (verb !== null && typeof confidence === 'number' ? toConfidenceWord(confidence) : null);`.
  - **EmptyState:** add `titleOverride?`/`bodyOverride?`; `heading = titleOverride ?? COPY[variant].heading`, `body = bodyOverride ?? COPY[variant].body`; line 63 `text-fg-muted` → `text-fg`.
  - **GrowthMotif:** props → `{ history?: number[]; growth_history?: number[]; deltaLabel?: string; accent?: 'brand'|'ok' }`; `const series = growth_history ?? history ?? [];` (use `series` everywhere); the **root** `<div>` className gets `growth-motif--wins` when `accent === 'ok'` (it is the ancestor of the bars whose `backgroundColor` reads `var(--brand)`/`var(--brand-accent)` at line 87 — the rebind cascades down).
  - **globals.css:** after the final block add `/* GROWTH MOTIFS */ .growth-motif--wins { --brand: var(--ok); --brand-accent: var(--ok); }`.
- [ ] **Step 4: Run** the four files + `npm run a11y` (must pass). Expect PASS.
- [ ] **Step 5: Commit.**

---

## Task 7: Signals route — return growth_history (one-liner)

**Files:** Modify `src/app/api/teacher/student/[studentId]/signals/route.ts`. **Grounding:** `p4b-03-components.md` §5 (`divergence_flagged` already present — add only `growth_history`).

- [ ] **Step 1:** Add one line to the existing `NextResponse.json({...})` (after `trajectory: {...}`): `growth_history: snapshotScores,`.
- [ ] **Step 2: Verify** — `npx tsc --noEmit` passes.
- [ ] **Step 3: Documented integration check** (against the seed): GET the route for a seeded student with ≥4 snapshots → `growth_history` is a `number[]` of ≥4 numbers, oldest→newest; <4 returns the shorter array (component cold-starts).
- [ ] **Step 4: Commit.**

---

## Task 8: GET /api/teacher/classes

**Files:** Create `src/app/api/teacher/classes/route.ts`; Modify `src/lib/auth/roles.ts` (add `STAFF_ROLES`). Test: `src/app/api/teacher/__tests__/classes-label.test.ts`. **Grounding:** `p4b-02-auth.md` (auth template, sync admin client), `p4b-01-schema.md` (`classes` columns; `users.school_id` is nullable).

**Interfaces:** Produces `formatClassLabel(c: { name: string; period?: string|null }): string` (exported) + `GET` returning `{ classes: { class_id: string; label: string }[] }`.

- [ ] **Step 1:** Add to `roles.ts`: `export const STAFF_ROLES = ['teacher','school_admin','school_sysadmin','platform_admin'] as const;`
- [ ] **Step 2: Failing test** (pure label helper — Node env, no pragma):
```ts
import { describe, it, expect } from 'vitest';
import { formatClassLabel } from '@/app/api/teacher/classes/route';
describe('formatClassLabel', () => {
  it('joins name + period', () => expect(formatClassLabel({ name:'Algebra I', period:'3' })).toBe('Algebra I — Period 3'));
  it('omits period when absent', () => expect(formatClassLabel({ name:'Algebra I', period:null })).toBe('Algebra I'));
});
```
- [ ] **Step 3: Run, expect FAIL.**
- [ ] **Step 4: Implement** the route using the verbatim auth template from `p4b-02-auth.md` §4, with **R3-hardened scoping**. Read role AND school_id in ONE gate query before building, then branch explicitly:
```ts
const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
const role = profile?.role ?? null;
if (!role || !new Set(STAFF_ROLES).has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

const admin = createAdminSupabaseClient();   // synchronous
let query = admin.from('classes').select('id, name, period');
if (role === 'teacher') {
  query = query.eq('teacher_id', user.id);
} else if (role === 'school_admin' || role === 'school_sysadmin') {
  if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); // no null-school leak
  query = query.eq('school_id', profile.school_id);
} // platform_admin: no filter
```
Export `formatClassLabel`; map results to `{ class_id, label }`.
- [ ] **Step 5: Run, expect PASS** + `npx tsc --noEmit`.
- [ ] **Step 6: Documented integration check:** unauth → 401; `student`/`parent` → 403; staff with `school_id=null` → 403 (no leak); teacher sees only own classes; second teacher's class absent; school_admin sees same-school only.
- [ ] **Step 7: Commit.**

---

## Task 9: Nav shell — TeacherNav + layout + placeholder routes

**Files:** Create `src/app/(teacher)/_components/TeacherNav.tsx` + the 12 placeholder `page.tsx` (see File Structure); Modify `src/app/(teacher)/layout.tsx`. Test: `src/app/(teacher)/_components/__tests__/TeacherNav.test.tsx`. **Grounding:** `p4b-06-shell-testinfra.md` §1-2 (current layout + RoleLayout `nav` slot API + token utility classes).

**Locked nav model (9 destinations):** Today `/today` · STUDENTS (label): Roster `/roster`, Gradebook `/gradebook`, Alerts `/alerts`, High Fives `/high-fives` · TEACHER (label): Lesson Library `/library/lessons`, Quiz Library `/library/quizzes` · Insights `/insights` · Upload `/upload`.

**Active rule (R2 alias):** an item is active when `pathname === href || pathname.startsWith(href + '/')`, **PLUS Roster is also active when `pathname.startsWith('/students')`** (the One-Student drill-in lives at `/students/[id]` and is reached from Roster, so it highlights Roster — matches the IA decision). Active link `text-brand` + `aria-current="page"`; inactive `text-fg hover:text-brand`; group labels are non-interactive `text-fg-muted` eyebrows. Next `<Link>`. "Homework" appears nowhere.

- [ ] **Step 1: Failing test** (`// @vitest-environment jsdom` + `@/test/setup-dom`; mock `next/navigation`):
```tsx
import { vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/students/abc' }));
// render <TeacherNav />:
it('shows all 9 destinations + 2 group labels and never says Homework', () => {
  render(<TeacherNav />);
  ['Today','Roster','Gradebook','Alerts','High Fives','Lesson Library','Quiz Library','Insights','Upload','STUDENTS','TEACHER']
    .forEach(t => expect(screen.getByText(t)).toBeInTheDocument());
  expect(screen.queryByText(/Homework/i)).toBeNull();
});
it('on /students/abc, exactly one link is aria-current and it is Roster (alias)', () => {
  render(<TeacherNav />);
  const active = screen.getAllByRole('link').filter(l => l.getAttribute('aria-current') === 'page');
  expect(active).toHaveLength(1);
  expect(active[0]).toHaveTextContent('Roster');
});
```
(Add a second file/`vi.mock` for `/library/lessons/123` → Lesson Library active, and an exact-match case like `/today`.)
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `TeacherNav.tsx` (`'use client'`, `usePathname`, the active rule incl. the `/students`→Roster alias, token utilities only). Create the 12 placeholder pages (Server Components rendering a heading + `<EmptyState variant="just-getting-started" />`; `students/[studentId]/page.tsx` uses `async ({ params }: { params: Promise<{ studentId: string }> })` and awaits it). Update `layout.tsx` `nav` to `<TeacherNav />` (add `<ClassSwitcherPill />` in Task 10).
- [ ] **Step 4: Run, expect PASS** + `npx tsc --noEmit` + `npm run a11y`.
- [ ] **Step 5: Commit.**

---

## Task 10: ClassSwitcherPill

**Files:** Create `src/app/(teacher)/_components/ClassSwitcherPill.tsx`; wire into `layout.tsx`. Test: `__tests__/ClassSwitcherPill.test.tsx`. **Grounding:** `p4b-06` (RoleLayout nav slot), Task 8 shape `{ classes: { class_id, label }[] }`.

A **selector, not a nav item** — no `aria-current`. `'use client'`; fetches `GET /api/teacher/classes`; renders a `<select>`-style pill; on change writes `?class=<id>` (`useRouter().replace` merging `useSearchParams`). Empty/loading → skeleton / `<EmptyState>`.

- [ ] **Step 1: Failing test** (jsdom; mock `fetch` → two classes; mock `next/navigation` `useRouter`/`useSearchParams`/`usePathname`):
```tsx
it('renders fetched classes and writes ?class= on selection', async () => {
  const replace = vi.fn();
  // mocks: fetch -> { classes:[{class_id:'c1',label:'Algebra I — Period 3'},{class_id:'c2',label:'Geometry'}] }; useRouter -> { replace }
  render(<ClassSwitcherPill />);
  expect(await screen.findByText('Algebra I — Period 3')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c2' } });
  expect(replace).toHaveBeenCalledWith(expect.stringContaining('class=c2'));
});
it('renders no aria-current (it is not nav)', () => {
  render(<ClassSwitcherPill />);
  expect(screen.queryByRole('combobox')?.getAttribute('aria-current')).toBeNull();
});
```
- [ ] **Step 2-5:** Run-fail → implement → run-pass (+ `tsc` + `a11y`) → commit.

---

## Provisioning track (Tasks 11-14) — HIGH PRIORITY, parallel after Task 2

> **OPEN PRODUCT DECISION (surface to product owner before Task 13):** onboarding — emailed magic-link/invite vs. set-password-on-first-login with shared trial credentials. **Plan default = V1 pattern (set-password / shared credentials in `schools.trial_credentials`, returned in the result);** magic-link is layered later (changes only Task 13's response + an email helper).

### Task 11: seedTrialDemoData

**Files:** Create `src/lib/trial/seedTrialDemoData.ts` + `src/lib/trial/logTrialEvent.ts` + tests. **Grounding:** `p4b-05-v1-port.md` §4-8, §11-13, §15; `p4b-01-schema.md`.

Keep V1's input interface (`{ admin, schoolId, schoolIdShort, teacherId, firstStudentId, parentId, password }`). Reuse the **same engineered profiles** as `demoCast` so a trial tenant lights up identically. Extract a pure `buildTrialRows(profiles, ids, now)` (mirrors `buildSeedRows`, incl. non-null `content`) and unit-test it (same cell-state + enum + ≥4-snapshot + content-not-null assertions as Task 2). Port `logTrialEvent.ts` verbatim (`trial_events`, `event_type:'trial_signup'`). Omit `student_model`/`student_gamification`/`signal_aggregates`/`alerts` (C8). Auth users via the **same `ensureAuthUser` (reconcile-by-id, never-rebind) helper** from Task 2.

- [ ] Steps: failing `buildTrialRows` test → implement pure builder → pass → implement the Supabase writer + `logTrialEvent` → `tsc` → commit.

### Task 12: provisionTrial

**Files:** Create `src/lib/trial/provisionTrial.ts` + test. **Grounding:** `p4b-05-v1-port.md` §3, §9, §14, §15.

Fuse V1's two functions into ONE `provisionTrial(input)`: insert `schools` trial row (`is_trial:true`, `trial_status:'active'`, `trial_plan`, `demo_mode:false`), **then** `school_licenses` (`tier:'professional'`, `status:'trialing'`, `student_limit`, `trial_starts_at/ends_at`, upsert `onConflict:'school_id'` — C6), then teacher + parent + first student via `ensureAuthUser`. **R2/C14:** `teacher_email` is caller-supplied — `ensureAuthUser` already hard-fails if an existing auth user with that email has a different `role`/`school_id` (no cross-tenant rebind). Then `trial_credentials` UPDATE, `seedTrialDemoData(...)`, `logTrialEvent('trial_signup')`. Hard-fail-with-cleanup on school/teacher (delete the school row); soft-fail per demo account. Extract + unit-test the pure password generator (`{Adjective}{Noun}#{4digits}`, injected counter — no `Math.random()` in the test).

- [ ] Steps: failing password-gen test → implement → pass → implement orchestration → `tsc` → commit. (DB path verified in Task 13's live check.)

### Task 13: POST /api/admin/provision-trial

**Files:** Create `src/app/api/admin/provision-trial/route.ts` + a pure input-validation test. **Grounding:** `p4b-02-auth.md` (`guardPlatformAdmin` returns `NextResponse|null`).

Auth: `await createServerSupabaseClient()` → `getUser` → `const guard = await guardPlatformAdmin(); if (guard) return guard;` (platform_admin only). Body: `{ school_name, teacher_email, teacher_name, student_roster[], parent?, trial_plan, student_limit }`. Extract + unit-test a pure `validateProvisionInput(body)` (rejects missing school_name/teacher_email, bad email, empty roster; caps lengths). On valid → `provisionTrial(...)` → 201 `{ school_id, trial_expires_at, credentials_summary }` (default onboarding: shared password once). Never log secrets.

- [ ] Steps: failing `validateProvisionInput` test → implement validation → pass → implement handler → `tsc` → **documented live check:** provision two trial schools; **assert `school_licenses.status='trialing'` BEFORE enrollments run** (status `'active'` would trip `enforce_enrollment_limit` if `student_limit<8`); assert a teacher in school A gets 403 from `guardClassAccess` for B's class and `guardStudentAccess` for B's student (isolation via guards, not RLS); assert `schools.trial_status='active'` + 8 enrolled + lesson→quiz→attempt chain → commit.

### Task 14: Provisioning admin UI

**Files:** Create `src/app/(super-admin)/provision/page.tsx`. **Grounding:** `p4b-06` confirms the on-disk route groups are `(parent),(school-admin),(student),(super-admin),(teacher)` — the **`(super-admin)` group already exists** and `role='super-admin'` is a valid `RoleLayout` Role. **Reuse it — do NOT create a `(platform-admin)` group.**

A minimal client form (school name, teacher name/email, roster textarea, plan select, student limit) that POSTs to `/api/admin/provision-trial` and renders the result summary. Token classes only; deep-ink labels.

- [ ] Steps: failing test (form renders required fields; submit calls fetch with the right body) → implement → pass (+`tsc`+`a11y`) → commit.

---

## Self-Review (run before handing off)

- **Spec coverage:** §4.1 Nav → Tasks 9-10; §4.2 Seed → Tasks 1-2; §4.3 Provisioning → Tasks 11-14; §4.4 Classes endpoint → Task 8; §4.5 Component tweaks + signals one-liner → Tasks 6-7; §4.6 Copy helpers → Tasks 3-5. All six sections mapped. ✅
- **Placeholder scan:** no "TBD"/"implement later"; ports reference the on-disk grounding files (verbatim current code). Deferred-but-flagged: the onboarding product decision (Task 13 banner) and the live-DB integration checks (Tasks 2/7/8/13). ✅
- **Type consistency:** `STAFF_ROLES` (roles.ts) reused; `ConfidenceWord` exported before importers; `RiskBand` imported from `@/lib/copy/riskBandLabel`; `masteryDisplayLabel`; `DemoStudent`/`DemoHw`/`DemoQuiz` shapes consistent across Tasks 1-2 and reused by Task 11; `ensureAuthUser` shared by Tasks 2/11/12. ✅
- **Review-driven re-verification:** the in-house panel ran the real `computeRosterRiskIndex` over the revised cast — the level set is now `{low(Alex), medium(Sofia,Nadia), high(Marcus,Emma,Lily,Jordan), critical(Darius)}` and the coverage assertion passes. Re-run Task 1's test as the first build action to confirm.

## Open decisions / risks (for product owner)

1. **Onboarding** (Task 13) — set-password vs magic-link. Default = set-password; needs a product nod before a pilot.
2. **`practice` focus-group action is unreachable today** (roster-signals passes `error_types: []`). Seed covers the 4 reachable actions; surfacing `practice` requires a screen-level API to populate `error_types` — out of foundation scope.
3. **`computeRosterRiskIndex` completion quirk** — the completion penalty saturates at ~+20 for any rate ≥0.7 (latent V1-ported behavior). The cast engineers around it (Darius reaches critical via a real >21d gap + redo-rate). Not fixed here (changing the classifier is out of foundation scope), but flagged: it clusters several students into `high`.
4. **Uniformly-low students aren't surfaced** — `diagnose()` only flags divergence, so Marcus (low HW *and* low quiz, aligned) is `null` and appears under the roster's "everyone else" via his reteach band + `reteach_needed` flag, not the focus group. Intentional seed case; reflects real engine behavior.

---

**Next step:** product-owner review (esp. the onboarding decision) → execute via subagent-driven-development, starting with **Task 1 (demo cast) — run its test FIRST to confirm the revised risk math**. Reviews via the in-house adversarial Workflow (primary; it caught the R1 coverage bug) and `/code-review` once a branch exists; Codex is best-effort only (too slow this session). Full review log: `PLAN-REVIEW-LOG-P4B.md`.
