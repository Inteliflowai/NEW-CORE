# CORE v2 — Plan 4b FOUNDATION Implementation Spec

**Status:** Ready for product-owner review → implementation plan
**Date:** 2026-06-18
**Scope:** The shared base that ALL 8 locked Teacher screens depend on. Built **before** any screen. The 8 screens (Today, Roster, Gradebook, One Student, Alerts, High Fives, Lesson/Quiz Library + Studio create flow, Insights — with Upload as the Studio's front door) are out of scope here except as consumers of this base.

> Authored via a research+draft workflow (5 parallel readers over the exact current code → high-effort draft), then finalized. Every cited path / prop / column / line number was read from the live codebase.

---

## 1. Goal, Architecture & Stack

**Goal.** Stand up the shared substrate the 8 Teacher screens slot into: the locked 4b navigation shell, a deterministic idempotent demo seed that makes every screen's every case render, a real-school pilot/trial provisioning path, the one missing shared endpoint (`GET /api/teacher/classes`), four additive backward-compatible component tweaks, a one-line signals-route fix that returns `growth_history`, and the six shared copy helpers (including the Alerts %-leak fix). Nothing here renders a screen; everything here is what a screen imports.

**Architecture.** Next.js App Router with role route-groups under `src/app/`; `RoleLayout role="teacher"` sets `data-role`/`data-intensity` on the shell and the Tier-2 → Tier-3 CSS-token rebinding in `globals.css` drives all color/intensity. Server Components by default; data flows through role-gated API route handlers (`auth.getUser` → STAFF_ROLES gate → object-level IDOR guard → service-role admin client, which **bypasses RLS**). Copy helpers in `src/lib/copy/` enforce the four-audience discipline at the string boundary so raw scores/percentages never reach a student/parent surface.

**Tech stack.** Next.js 16.2.9 (App Router, Turbopack) · React 19 · Tailwind CSS v4 (`@tailwindcss/postcss`, no `tailwind.config.js`) · TypeScript · Supabase (Postgres + Auth, service-role admin client server-side only). Import alias `@/*` → `src/*`.

---

## 2. GLOBAL CONSTRAINTS (project-wide — copy verbatim into every screen spec header)

These are **non-negotiable** and apply to every file produced under Plan 4b.

**Four-audience discipline.**
- **Never-Band soft words:** student/parent surfaces never render the mastery `band` enum; banding only ever appears as soft, non-ranking copy.
- **Banded-risk-never-a-number:** a risk score never enters the DOM or a `data-*` attribute. Teacher/admin surfaces render the *band label only* (`low | medium | high | critical`).
- **CL / diagnostic = teacher-only:** comprehension-level verbs, diagnoses, divergence, and recurring-misconception strings appear on teacher/admin surfaces only — never student/parent.
- **Growth never peer-relative + never fabricated:** growth is "you vs your own past" only — never a rank, percentile, or class comparison; never invented when data is insufficient (cold-start states instead).
- **Aggregate-first admin with deliberate, named drill-down (FERPA/LGPD):** admin surfaces lead with aggregates; any per-student drill-down is an explicit, named, access-checked action.
- **Observational, not diagnostic:** copy describes what was observed, never labels the child.

**WCAG-AA contrast gate (prebuild, un-bypassable).** `npm run prebuild` runs `npm run a11y` (`npx tsx scripts/a11y/contrast-check.ts`), which asserts every Tier-2 pair across the role/intensity matrix (`fg/bg`, `fg/surface`, `fg-muted/bg`, `ok-fg/ok-surface`, `warn-fg/warn-surface`, `risk-fg/risk-surface`, `brand-fg/brand-surface` at ≥4.5:1; `fg-on-brand/brand`, `brand/surface` at ≥3.0:1) and **exits 1** on any failure. No hardcoded hex or color-name literals in components — Tier-2 token references only.

**Naming.** User-facing term is **"Assignments"**, never "Homework". The legacy term survives only in internal DB identifiers (`homework_attempts`, `hw_*` columns); no UI surface, label, or copy helper output says "Homework".

**Next.js 16 conventions.** `params` and `searchParams` are `Promise`s — `await params` inside the handler (e.g. `{ params }: { params: Promise<{ studentId: string }> }`). `cookies()` and `headers()` are async. Confirm any framework API against the bundled docs at `node_modules/next/dist/docs/01-app/` before use.

**Auth chain (every protected route).** `supabase.auth.getUser()` (not `getSession`) → 401 → **STAFF_ROLES gate** (read `users.role`, reject if not in `{teacher, school_admin, school_sysadmin, platform_admin}`) → 403 → object-level IDOR guard (`guardClassAccess(classId)` / `guardStudentAccess(studentId)`) → 403 → only then `createAdminSupabaseClient()`.

**RLS is NOT the IDOR backstop.** The service-role admin client bypasses RLS entirely. The role gate + per-object guards (`src/lib/auth/guards.ts`) are the *only* access control on admin-client cross-user reads. RLS is defense-in-depth, never the boundary.

**Deep-ink AA readability.** No dim gray-on-white for content text. Body copy on light surfaces uses deep ink (`--fg` / `text-fg`), not `--fg-muted`, wherever the text carries meaning the reader must be able to read.

---

## 3. FILE STRUCTURE — created / modified across the Foundation

### Created — route-group shell & folders
| Path | Responsibility |
|---|---|
| `src/app/(teacher)/layout.tsx` | **MODIFIED** — replace the Dashboard/Class/Assignments stub nav with the locked 4b nav model + class-switcher pill (still via `RoleLayout role="teacher"`). |
| `src/app/(teacher)/_components/TeacherNav.tsx` | **NEW** — client nav list with per-route active state (`usePathname`). |
| `src/app/(teacher)/_components/ClassSwitcherPill.tsx` | **NEW** — header class selector (a `<select>`-style pill, **not** a nav item) backed by `GET /api/teacher/classes`. |
| `src/app/(teacher)/today/page.tsx` | **NEW placeholder** — route slot for the Today screen. |
| `src/app/(teacher)/roster/page.tsx` | **NEW placeholder** — Roster slot. |
| `src/app/(teacher)/gradebook/page.tsx` | **NEW placeholder** — Gradebook slot. |
| `src/app/(teacher)/students/[studentId]/page.tsx` | **NEW placeholder** — One Student slot. |
| `src/app/(teacher)/alerts/page.tsx` | **NEW placeholder** — Alerts slot. |
| `src/app/(teacher)/high-fives/page.tsx` | **NEW placeholder** — High Fives slot. |
| `src/app/(teacher)/library/lessons/page.tsx` | **NEW placeholder** — Lesson Library slot. |
| `src/app/(teacher)/library/quizzes/page.tsx` | **NEW placeholder** — Quiz Library slot. |
| `src/app/(teacher)/studio/page.tsx` | **NEW placeholder** — Studio create flow slot (Upload = its front door). |
| `src/app/(teacher)/insights/page.tsx` | **NEW placeholder** — Insights slot. |
| `src/app/(teacher)/upload/page.tsx` | **NEW placeholder** — Upload entry (routes into Studio). |

> Placeholder `page.tsx` files render a single `EmptyState`/heading so routing + active state are testable before the screens are built. They are intentionally thin; each is replaced by its screen's own spec.

### Created — endpoint, seed, provisioning
| Path | Responsibility |
|---|---|
| `src/app/api/teacher/classes/route.ts` | **NEW** — `GET` list of the caller's own classes for the class-switcher pill. |
| `scripts/seedDemo.mjs` | **NEW** — idempotent demo seed; the full cast + engineered data so every screen case renders. |
| `scripts/resetDemo.mjs` | **NEW** — tears down the demo tenant so `seedDemo` re-seeds cleanly. |
| `src/lib/trial/seedTrialDemoData.ts` | **NEW** — trial-tenant seeder (port of V1's, adapted to v2 schema), called by provisioning. |
| `src/lib/trial/provisionTrial.ts` | **NEW** — real-school provisioning: auth accounts, `users`/`schools`/`school_licenses` rows, per-tenant isolation, then `seedTrialDemoData`. |

### Created — copy helpers (`src/lib/copy/`)
| Path | Responsibility |
|---|---|
| `src/lib/copy/pctIncorrectToWords.ts` | Map an incorrect-% to soft narrative words (no number out). |
| `src/lib/copy/effortPhrase.ts` | Map an `effort_label` enum to teacher-facing copy. |
| `src/lib/copy/reteachWorkingPhrase.ts` | Frame a reteach-cycle outcome as soft "this is working" copy. |
| `src/lib/copy/diagnosisToFeedSentence.ts` | **Alerts leak-fix** — produce a teacher feed sentence from structured diagnosis fields with **no raw %**. |
| `src/lib/copy/leakGuard.ts` | Denylist + assertion used in tests/dev to catch raw numbers/% in non-teacher copy. |
| `src/lib/copy/narrativeRank.ts` | Salience scorer to order multiple signals in a feed. |

### Modified — components & the signals-route fix
| Path | Responsibility |
|---|---|
| `src/components/core/RiskBadge.tsx` | Add additive `band?: RiskBand` (render a pre-banded value; score never enters DOM). |
| `src/components/core/CLBadge.tsx` | Add additive `confidenceWord?: ConfidenceWord \| null` (soft word bypasses `toConfidenceWord`). |
| `src/components/core/EmptyState.tsx` | Add `titleOverride?` / `bodyOverride?`; change body class `text-fg-muted` → `text-fg` (deep-ink AA). |
| `src/components/core/GrowthMotif.tsx` | Add `growth_history?: number[]` (alias of `history`) + `accent?: 'brand' \| 'ok'` scoped `--brand→--ok` emerald override for wins. |
| `src/app/api/teacher/student/[studentId]/signals/route.ts` | One-line fix: return `growth_history` (currently computes `snapshotScores` then drops it). |

---

## 4. FOUNDATION SECTIONS

### 4.1 NAV SHELL

**Files:** `src/app/(teacher)/layout.tsx` (modify), `src/app/(teacher)/_components/TeacherNav.tsx` (new), `src/app/(teacher)/_components/ClassSwitcherPill.tsx` (new), plus the placeholder `page.tsx` route slots in §3.

**Current code being replaced** (`src/app/(teacher)/layout.tsx`, full file, 31 lines):

```tsx
const nav = (
  <>
    <a href="/teacher/dashboard" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">Dashboard</a>
    <a href="/teacher/class" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">Class</a>
    <a href="/teacher/assignments" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">Assignments</a>
  </>
);
return <RoleLayout role="teacher" nav={nav}>{children}</RoleLayout>;
```

This is an obsolete stub: the routes (`/teacher/dashboard`, `/teacher/class`, `/teacher/assignments`) don't exist, the group is `(teacher)` so real paths are `/today`, `/roster`, etc. (no `/teacher` prefix), it has no active state, and "Assignments" here is a nav target, not a screen we ship.

**`RoleLayout` is correct and stays as-is** (`src/components/core/RoleLayout.tsx`): `role="teacher"` → `intensityFor` returns `'calm'`, sets `data-role="teacher" data-intensity="calm"`, renders the `◆ CORE` mark and a `<nav aria-label="Role navigation">` slot. We only change what we pass to `nav`.

**Locked 4b nav model** (exact groups/items, in order):
- `◆ CORE` (the mark — owned by RoleLayout, not a nav item)
- **Today** → `/today`
- **STUDENTS** (group label): Roster `/roster` · Gradebook `/gradebook` · Alerts `/alerts` · High Fives `/high-fives`
- **TEACHER** (group label): Lesson Library `/library/lessons` · Quiz Library `/library/quizzes`
- **Insights** → `/insights`
- **Upload** → `/upload`

**New `TeacherNav.tsx`** — `'use client'`, uses `usePathname()` for per-route active state. Active = `pathname === href || pathname.startsWith(href + '/')` (so `/students/[id]` and `/library/lessons/...` highlight correctly). Active link uses `text-brand` + `aria-current="page"`; inactive uses `text-fg hover:text-brand`. Group labels (STUDENTS, TEACHER) are non-interactive `text-fg-muted` eyebrow headings — **note:** these are decorative labels, not body content, so muted ink is acceptable; everything readable-as-content stays deep-ink per the global constraint. Links use Next.js `<Link>`, not raw `<a>`.

**`ClassSwitcherPill.tsx`** — a **selector, not a nav item**. Renders in the header beside the nav (passed into `RoleLayout`'s nav slot region as a sibling, or as a header-right element). It fetches `GET /api/teacher/classes`, renders the returned `{ class_id, label }[]` in a pill-styled control, and writes the selected `class_id` to the URL as `?class=<id>` — **the resolved carrier**; every screen reads it server-side via async `searchParams`, so the selection is shareable, bookmarkable, and survives reload. It is **not** in the nav list and never receives active state. Empty/loading states use `EmptyState` / a skeleton.

**Route-group folder structure** — the §3 placeholder `page.tsx` files establish every slot the 8 screens fill. The One Student screen lives at `students/[studentId]/page.tsx` (dynamic, Next 16 async `params`). Library splits into `library/lessons` and `library/quizzes`. Studio + Upload are sibling routes (`studio/`, `upload/`) where Upload is the documented front door into Studio.

**Data/auth involved:** none directly in the layout; the pill consumes `GET /api/teacher/classes` (§4.4). No screen data is fetched in the shell.

**Testing:**
- Render the layout, assert all 8 destinations + 2 group labels are present and "Homework" appears nowhere.
- Navigate to each route; assert exactly one nav item has `aria-current="page"` and the correct one is highlighted (incl. `/students/[id]` highlighting Roster's group, `/library/lessons/123` highlighting Lesson Library).
- Assert `ClassSwitcherPill` renders no `aria-current` and is outside the `<nav>` landmark.
- `npm run build` type-checks the route group; `npm run a11y` passes (nav uses only token classes).

---

### 4.2 DEMO SEED (idempotent + reset)

**Files:** `scripts/seedDemo.mjs` (new), `scripts/resetDemo.mjs` (new). Invocation mirrors V1: `node --env-file=.env.local scripts/seedDemo.mjs`, reading `NEXT_PUBLIC_SUPABASE_URL` + the service-role key (`SUPABASE_SECRET_KEY` per `createAdminSupabaseClient`). **Add npm scripts:** `"seed:demo": "node --env-file=.env.local scripts/seedDemo.mjs"` and `"seed:demo:reset": "node --env-file=.env.local scripts/resetDemo.mjs"`.

**Cast (11 users + platform admin):** 1 teacher, 8 students, 1 parent (linked to student #1 via `users.parent_id` + a `guardians` row), 1 `school_admin`. The `super_admin` is `mleventhal@inteliflowai.com` with `role = 'platform_admin'`. All created via `supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name } })`, then a matching `public.users` INSERT (`{ id: authUser.id, full_name, email, role, school_id }`). There is **no DB trigger** syncing `auth.users → public.users`; the seed must INSERT the `users` row itself after each `createUser`.

**Idempotency:** before creating an auth user, look it up by email (list/get by email) and reuse the id if present; all `public.*` inserts use upsert-on-conflict against their natural unique keys (`users.id`, `enrollments(class_id, student_id)`, `student_model_snapshots(student_id, snapshot_date)`, `skill_learning_state(student_id, skill_id)`, `skills(school_id, COALESCE(subject,''), slug)`). Re-running `seedDemo` must converge to the same state, never duplicate. `resetDemo.mjs` deletes the demo tenant (its school row + cascade, plus the auth users by email) so a fresh `seedDemo` starts clean.

**Tenant scaffold:** 1 `schools` row (`demo_mode = true`), 1 `classes` row (`teacher_id` = the demo teacher, `school_id` = demo school), `enrollments` for all 8 students, one `lessons` row → one `quizzes` row (`lesson_id` set) with `quiz_questions` (3 MCQ + 2 open, matching V1's 5-question shape), so the lesson→quiz chain exists.

**Engineered data — every screen case must render** (real columns from migrations 0001–0011):

*Eight student profiles* (band / consistency / effort drive the rest):

| Student | `quiz_attempts.mastery_band` | consistency | `effort_label` | notes |
|---|---|---|---|---|
| Alex Rivera | `advanced` | consistent | `independent_success` | high HW + high quiz (control / High Five) |
| Sofia Chen | `grade_level` | consistent | `effortful_success` | steady |
| Marcus Johnson | `reteach` | erratic | `struggling_trying` | `reteach_needed = true`; volatile |
| Emma Patel | `grade_level` | variable | `independent_struggle` | volatile |
| Jordan Kim | `grade_level` | consistent | `effortful_success` | reteach-cycle-that-improved (High Fives) |
| Lily Torres | `grade_level` | consistent | `effortful_success` | steady |
| Darius Moore | `reteach` | erratic | `independent_struggle` | **divergence case** (high HW % + low quiz %) |
| Nadia Okafor | — *(no `quiz_attempts` row)* | — | — | **not-yet-assessed** band case (cold-start) |

- **Mastery bands:** cover all three (`reteach`, `grade_level`, `advanced`) plus the not-yet-assessed case (Nadia → no quiz attempt → null band). `quiz_attempts.mastery_band` ∈ `('reteach','grade_level','advanced')` per the 0003 CHECK; set `score_pct`, `submitted_at`, `is_complete=true`, `grading_status='complete'`.
- **All Gradebook cell states:** per the 8×assignment grid, engineer `homework_attempts` to produce **graded** (`status` graded + `score_pct` + `graded_at`), **submitted** (`submitted_at` set, not yet graded), **missing** (assignment exists, no attempt, `due_at` in past), **not-due** (assignment with `due_at` in future, no attempt). At least one of each must exist across the matrix.
- **Volatile:** at least two students with erratic/variable consistency so the roster volatility flag fires (Marcus, Emma).
- **`focus_group` variety:** engineer divergence/error inputs so `diagnose()` yields one each of `reteach`, `verbal_check`, `practice`, `monitor` across students.
- **Divergence case:** Darius — high `homework_attempts.score_pct` with low `quiz_attempts.score_pct` so `divergence_score ≥ 25` and the verbal-check/reteach path triggers.
- **Varied `effort_label`:** all four of `effortful_success`, `struggling_trying`, `independent_success`, `independent_struggle` represented (per the 0011 CHECK).
- **`reteach_needed` flag:** set `assignments.reteach_needed = true` for Marcus.

**Multi-week history (so trends + Insights + High Fives light up):**
- `student_model_snapshots`: ≥4 dated rows per student (unique `(student_id, snapshot_date)`), with `avg_score` trending up for the "improved" cohort, so `GrowthMotif` (needs ≥4 points) renders and `computeTrajectory` reads a real series. Populate `mastery_band`, `consistency_label`, `dominant_effort_pattern`, `divergence_score`, `risk_score`, `improvement_4w`, `consistency_score` so Insights aggregates have inputs.
- **Reteach cycles that improved:** for Jordan (and Marcus partially), seed `skill_learning_state.last_reteach_outcome` + a snapshot uptick after the reteach date, so `detectCompletedReteachCycles` finds a completed, *improving* cycle (feeds High Fives + reteach-effectiveness). Seed `skill_learning_state.state` across the enum (`needs_different_instruction`, `needs_more_time`, `on_track`, `ready_to_extend`, `insufficient_data`, `not_attempted`) so CL verbs vary.
- `misconception_observations` for a couple of students (valid `error_type` / `reasoning_pattern` codes from the 0011 seed) so recurring-misconception surfacing has data.

**Discipline note:** the **surfaces** apply the four-audience discipline; the seed writes realistic raw data (real scores, real %, real bands). The seed must not pre-soften data — that's the copy helpers' job.

**Testing:**
- Run `seed:demo` twice; assert row counts identical the second time (idempotency) and no duplicate auth users.
- Assert the presence of: all 3 bands + 1 null-band student; ≥1 each of the 4 Gradebook cell states; ≥1 each of the 4 `effort_label` values; ≥1 each `diagnose()` action; ≥1 divergence-flagged student; ≥1 student with ≥4 snapshots; ≥1 improved reteach cycle.
- Run `seed:demo:reset` then `seed:demo`; assert clean re-seed.

---

### 4.3 PILOT / TRIAL PROVISIONING

**Files:** `src/lib/trial/provisionTrial.ts` (new), `src/lib/trial/seedTrialDemoData.ts` (new, port of V1's `lib/trial/seedTrialDemoData.ts`).

**Scope — FULLY BUILD (decided 2026-06-19; pilot contracts already going out):** NOT script-only. Build (a) the `provisionTrial.ts` + `seedTrialDemoData.ts` libraries; (b) a **provisioning API route** `src/app/api/admin/provision-trial/route.ts` — gated to `platform_admin` (and `school_sysadmin` for their own org), accepts `{ school_name, teacher_email, teacher_name, student_roster[], parent?, trial_plan, student_limit }`, calls `provisionTrial`, and returns the created school + a credentials/invite summary; (c) a **minimal admin UI** (a page under the super-admin / school-admin route group) to fill that form, trigger provisioning, and show the result. **ONBOARDING** (how pilot users first authenticate — emailed invite/magic-link vs. set-password on first login) is its own sub-area the provisioning plan must detail; flag it for a quick product decision there. Because pilots are imminent, this is a committed HIGH-PRIORITY deliverable that runs PARALLEL to the screens track once the seed + auth-user-creation pattern land.

**Goal:** a real school can be stood up with real Supabase auth accounts and per-tenant isolation — distinct from the demo seed (which is a fixed cast). `provisionTrial`:
1. Create the `schools` row with trial fields: `is_trial = true`, `trial_status = 'active'`, `trial_started_at`, `trial_expires_at`, `trial_plan`, and a `school_licenses` row (`tier`, `status = 'trialing'`, `student_limit`, `trial_starts_at`/`trial_ends_at`). (All columns exist per 0001 / 0007.)
2. Create the teacher auth user via `supabase.auth.admin.createUser`, INSERT `public.users` with `role='teacher'`, `school_id`, `is_trial_user=true`, `trial_school_id`.
3. Create the parent (`role='parent'`) and first student (`role='student'`, `is_trial_user=true`, `trial_school_id`), link parent↔student (`users.parent_id` + `guardians`).
4. Call `seedTrialDemoData({ admin, schoolId, schoolIdShort, teacherId, firstStudentId, parentId, password })` — creates the remaining 7 students, the class, enrollments, lesson→quiz, `quiz_attempts`, `assignments` + `homework_attempts` with engineered `effort_label`/`score_pct`. (Matching V1's input type and behavior. V1's seeder did **not** populate `skill_learning_state` / `misconception_observations` / `student_model_snapshots` — those are computed offline. The v2 trial seeder keeps that division: provisioning produces the transactional rows; snapshots/learning-state are derived by the scheduled jobs.)

**Per-tenant isolation — the boundary is the guards, not RLS.** Every trial tenant is scoped by `school_id`. RLS policies exist as defense-in-depth, but the access boundary on all admin-client reads is the per-route auth chain (STAFF_ROLES gate) plus the per-object IDOR guards (`guardClassAccess` / `guardStudentAccess`, which check `teacher_id` ownership and same-school membership). **"RLS is NOT the IDOR backstop"** — provisioning must not rely on RLS to keep tenants apart; it relies on every route running the guards. Provisioning's job is to set the `school_id`/`teacher_id`/enrollment relationships the guards read.

**Data/columns involved:** `schools` (trial_* + license link), `school_licenses`, `users` (`is_trial_user`, `trial_school_id`, `parent_id`), `guardians`, `classes`, `enrollments`, `lessons`, `quizzes`, `quiz_questions`, `quiz_attempts`, `assignments`, `homework_attempts`.

**Testing:**
- Provision two trial schools; assert a teacher in school A, going through the real route chain, gets 403 from `guardClassAccess` for school B's class and `guardStudentAccess` for school B's student (proves isolation is enforced by guards, not RLS).
- Assert the trial school's `school_licenses.status='trialing'` and `schools.trial_status='active'`.
- Assert the 8 students enroll and the lesson→quiz→attempt chain exists.

---

### 4.4 SHARED ENDPOINT — `GET /api/teacher/classes`

**File:** `src/app/api/teacher/classes/route.ts` (new). Consumed by the class-switcher pill (Roster, Gradebook, Insights, Library). **Does not exist today.**

**Auth chain — identical to `roster-signals`** (`src/app/api/teacher/class/[classId]/roster-signals/route.ts`), reusing the canonical set:

```ts
const STAFF_ROLES = new Set(['teacher', 'school_admin', 'school_sysadmin', 'platform_admin']);
```

This is an **aggregate "all my classes" list**, so it does **not** call the per-class `guardClassAccess` (that guard is per-`classId`). The boundary here is the role gate **plus the query scope**: a teacher sees only their own classes; admins see their school; platform_admin sees all.

**Implementation:**

```ts
// src/app/api/teacher/classes/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';

const STAFF_ROLES = new Set(['teacher', 'school_admin', 'school_sysadmin', 'platform_admin']);

export async function GET(_req: NextRequest): Promise<NextResponse> {
  // 1. Auth
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 2. STAFF_ROLES gate (read role from users; RLS-gated authed client)
  const { data: profile } = await supabase
    .from('users').select('role, school_id').eq('id', user.id).single();
  const role = profile?.role ?? null;
  if (!role || !STAFF_ROLES.has(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 3. Admin client AFTER the gate; scope by caller (the boundary, not RLS)
  const admin = createAdminSupabaseClient();
  let query = admin.from('classes').select('id, name, subject, grade_level, period');
  if (role === 'teacher') query = query.eq('teacher_id', user.id);
  else if (role === 'school_admin' || role === 'school_sysadmin') query = query.eq('school_id', profile!.school_id);
  // platform_admin: no filter
  const { data: classes } = await query.order('created_at', { ascending: false });

  // Spec shape: [{ class_id, label }]
  const out = (classes ?? []).map((c) => ({
    class_id: c.id,
    label: [c.name, c.period && `Period ${c.period}`].filter(Boolean).join(' — '),
  }));
  return NextResponse.json({ classes: out });
}
```

**Columns:** `classes(id, name, subject, grade_level, period, teacher_id, school_id, created_at)` (0002). `label` is composed from `name` + `period`. The pill consumes `{ class_id, label }`.

**Testing:**
- Unauthenticated → 401; authenticated `student`/`parent` → 403.
- Teacher sees only `teacher_id = self` classes; a second teacher's class never appears.
- `school_admin` sees same-`school_id` classes only; platform_admin sees all.
- Response is `{ classes: [{ class_id, label }] }`; type-checks under `npm run build`.

---

### 4.5 COMPONENT TWEAKS (additive, backward-compatible)

All four changes are **purely additive** — existing call sites compile and behave unchanged. No new hex; tokens only; `npm run a11y` must stay green.

#### RiskBadge — add `band?: RiskBand`
Current props (`src/components/core/RiskBadge.tsx:11-14`):
```ts
export interface RiskBadgeProps { score: number; scale?: '0to1' | '0to100'; }
```
The component already renders only the band string (`riskBandLabel(score, scale)`), never the number. Add an optional pre-banded path so callers that already have a band never pass a `score` into the DOM path:
```ts
export interface RiskBadgeProps {
  score?: number;                 // now optional
  scale?: '0to1' | '0to100';
  band?: RiskBand;                // pre-banded; bypasses riskBandLabel
}
// body: const band = props.band ?? riskBandLabel(props.score ?? 0, props.scale);
```
When `band` is supplied it is used directly; otherwise compute as today. `score` remains accepted for backward compat. Test: `<RiskBadge band="high" />` renders `high` styling with no numeric in the DOM/`aria-label`; `<RiskBadge score={80} />` still renders `critical`.

#### CLBadge — add `confidenceWord?: ConfidenceWord | null`
Current props (`src/components/core/CLBadge.tsx:21-29`) accept `confidence?: number | null`, internally mapped by `toConfidenceWord`. Add a pre-softened path:
```ts
export interface CLBadgeProps {
  state: SkillLearningState;
  confidence?: number | null;
  confidenceWord?: ConfidenceWord | null;  // soft word bypasses toConfidenceWord
}
// word = confidenceWord !== undefined
//   ? confidenceWord
//   : (verb !== null && typeof confidence === 'number' ? toConfidenceWord(confidence) : null);
```
`ConfidenceWord` (`'consistent' | 'tentative' | 'emerging'`) is already declared in the file — **export it** so callers (and the signals route's `confidence_label`) can type against it. When `confidenceWord` is provided, no numeric confidence is ever read. Test: `<CLBadge state="on_track" confidenceWord="consistent" />` shows the word with no number; omitting it preserves current behavior.

#### EmptyState — `titleOverride?` / `bodyOverride?` + deep-ink AA fix
Current props (`src/components/core/EmptyState.tsx:49-52`) take only `variant` + `className`, and the **body renders `text-fg-muted` at line 63** — the fragile ~4.7:1 gray-on-white the global constraint forbids for content. Change:
```ts
interface EmptyStateProps {
  variant: EmptyStateVariant;
  className?: string;
  titleOverride?: string;   // overrides COPY[variant].heading
  bodyOverride?: string;    // overrides COPY[variant].body
}
// heading = titleOverride ?? COPY[variant].heading
// body    = bodyOverride  ?? COPY[variant].body
```
And change the body element's class from `text-fg-muted` → **`text-fg`** (deep ink). The icon may stay `text-fg-muted` (decorative, `aria-hidden`). Test: overrides render; `npm run a11y` confirms `fg/surface ≥ 4.5:1`; snapshot asserts body uses `text-fg`.

#### GrowthMotif — `growth_history?` alias + `accent` emerald override for wins
Current props (`src/components/core/GrowthMotif.tsx:7-12`) are `history: number[]` + `deltaLabel?`. The bars read `var(--brand)` (current) / `var(--brand-accent)` (prior) inline (lines 87-88). Add:
```ts
interface GrowthMotifProps {
  history?: number[];
  growth_history?: number[];        // alias matching the signals payload key
  deltaLabel?: string;
  accent?: 'brand' | 'ok';          // 'ok' rebinds --brand→--ok (emerald) for wins
}
// const series = growth_history ?? history ?? [];
```
For `accent='ok'`, wrap the bars in a scoped style that rebinds the tokens the inline styles read — `style={{ ['--brand' as string]: 'var(--ok)', ['--brand-accent' as string]: 'var(--ok)' }}` (or a `.growth-motif--wins { --brand: var(--ok); --brand-accent: var(--ok); }` class in `globals.css`). The cold-start `<4` rule and "never fabricate" behavior are unchanged. This gives High Fives + Insights celebratory emerald without touching the role binding. Test: `accent='ok'` yields emerald bars (computed style resolves `--brand`→emerald); default stays cobalt for teacher; `<4` points → cold-start.

#### Signals route — return `growth_history` (one-line fix)
`src/app/api/teacher/student/[studentId]/signals/route.ts` (lines 226-238) reads snapshots into `snapshotScores`, feeds `computeTrajectory(snapshotScores, false)`, then **drops `snapshotScores`** — the final response (lines 243-263) returns `trajectory: { ...consistency, ...trajectoryResult }` with no raw series, so `GrowthMotif` on growth-centric screens has nothing to chart. Fix — add the array to the response:
```ts
return NextResponse.json({
  student_id: studentId,
  current_band,
  per_skill_cl,
  recurring_misconceptions,
  divergence: { ...divergence, divergence_flagged: divergence.divergence_score >= 20 },
  effort: { dominant_effort_pattern },
  risk: { roster: roster_risk, session: session_risk },
  reteach_outcomes,
  trajectory: { ...consistency, ...trajectoryResult },
  growth_history: snapshotScores,   // ← added: oldest→newest avg_score series for GrowthMotif
});
```
Teacher-only route; `snapshotScores` is already filtered to non-null numbers. Test: assert the seeded student (≥4 snapshots) returns a `growth_history` array of ≥4 numbers ordered oldest→newest; a student with <4 returns the shorter array and the component renders cold-start.

---

### 4.6 SHARED COPY HELPERS (`src/lib/copy/`)

All are **pure** (no Next.js/Supabase imports), siblings of the existing `riskBandLabel.ts` and `topicFrame.ts`. They are the enforcement point for "never a number on the wrong surface."

**`pctIncorrectToWords(pct: number): string`** — maps an incorrect proportion/percentage to soft narrative words, never echoing the number. Accepts either 0–1 or 0–100 (documented). E.g. `~0.25 → "missed about a quarter"`, `~0.5 → "missed about half"`, `~0.1 → "missed a few"`. Output contains **no digits**. Used wherever a % would otherwise reach a student/parent surface.

**`effortPhrase(effort_label: string | null): string`** — maps the `homework_attempts.effort_label` enum (`'effortful_success' | 'struggling_trying' | 'independent_success' | 'independent_struggle'`, per 0011) to teacher-facing copy (e.g. `effortful_success → "worked hard and got there"`). Returns a neutral fallback for `null`/unknown.

**`reteachWorkingPhrase(last_reteach_outcome: string | null): string`** — frames `skill_learning_state.last_reteach_outcome` as soft "this is working / keep going" copy for High Fives + reteach-effectiveness; never a percentage, never "failed".

**`diagnosisToFeedSentence(input): string`** — **the Alerts leak-fix.** `diagnose()` in `src/lib/signals/diagnosis.ts` bakes raw percentages into its `diagnosis` string (lines 86, 95, 104), e.g. `` `HW avg ${Math.round(hw_avg)}% diverges from quiz avg ${Math.round(quiz_avg)}% — consider a verbal check.` `` and `` `Quiz avg ${Math.round(quiz_avg)}% with divergence score ${Math.round(divergence_score)} — ...` ``. This helper takes the **structured** fields (`suggestedAction`, `severity`, and the inputs — not the raw `diagnosis` string) and produces a teacher feed sentence with **no raw %**, e.g. `verbal_check → "Strong on practice but the quiz didn't match — worth a quick verbal check."` The Alerts screen calls this, **never** `diagnose().diagnosis`. (Even though Alerts is teacher-only, the discipline is "banded-risk-never-a-number" — diagnostic feed sentences carry the *action*, not the arithmetic.)

**`leakGuard`** — a denylist + assertion (regex for bare digits, `%`, "avg", "score N", percentiles, rank words) plus `assertNoLeak(text: string): void` that throws in dev/test when a non-teacher-surface string contains a forbidden token. Used in unit tests for `pctIncorrectToWords`/`topicFrame`/parent-facing copy and optionally as a dev-only runtime assert. It is a **safety net**, not the primary mechanism.

**`narrativeRank(signal): number`** — salience scorer to order multiple signals in a feed (Alerts/Today). Ranks by severity then recency/actionability so the most action-worthy item floats up. Pure, deterministic, total order (stable tiebreak).

**Testing:**
- `pctIncorrectToWords`: table of inputs → assert output matches expected word and **contains no digit/`%`** (`leakGuard.assertNoLeak`).
- `effortPhrase`/`reteachWorkingPhrase`: each enum value maps to expected copy; null → safe fallback.
- `diagnosisToFeedSentence`: for each `suggestedAction`, assert the sentence is correct and `assertNoLeak` passes (no `%`, no avg numbers) — directly guards the leak `diagnose()` introduces.
- `narrativeRank`: assert ordering for a fixed signal set is stable and severity-first.

---

## 5. SEQUENCING (build order within the Foundation)

1. **Demo seed + reset (Task 1 of the entire 4b build).** Nothing — no screen, no endpoint demo, no manual QA — can be exercised without seeded data covering every case. Ship `seedDemo.mjs` + `resetDemo.mjs` first; it is the precondition for verifying everything else. *(This is explicitly Task 1 of the whole Plan 4b build, not just of the foundation.)*
2. **Copy helpers** (§4.6) + the **`diagnose()` leak audit** — pure functions, no deps, unblock Alerts/Today and are needed by component/endpoint tests. `leakGuard` lands with them.
3. **Component tweaks** (§4.5), including the **signals-route `growth_history` one-liner** — additive, low-risk, unblock every screen's rendering primitives. Verify `npm run a11y` stays green after the EmptyState deep-ink change.
4. **`GET /api/teacher/classes`** (§4.4) — required before the class-switcher pill can render.
5. **Nav shell** (§4.1) — layout swap + `TeacherNav` + `ClassSwitcherPill` + placeholder route slots. Depends on the classes endpoint (pill) and EmptyState (placeholders).
6. **Pilot/trial provisioning** (§4.3) — **now FULLY built (libraries + API route + admin UI) and HIGH-PRIORITY** (pilot contracts going out). It reuses the seed's auth-user-creation pattern, so it starts once the seed (step 1) lands and runs **parallel to the nav/screens track** rather than last. Its onboarding sub-decision (invite/magic-link vs. set-password) is settled in the provisioning plan. Given imminent pilots, the critical path is **seed → provisioning → the screens a pilot teacher actually uses**.

After all six land, the 8 screen specs are unblocked; each slots into its placeholder route and imports these primitives.

---

## 6. OPEN QUESTIONS / RISKS

> **✅ ALL 7 RESOLVED with the product owner (2026-06-19):**
> 1. Orphan-auth recovery → **reconcile-on-seed** (seed finds the auth user by email and ensures the `users` row; no mandatory reset-first).
> 2. Service-role env var → **`SUPABASE_SECRET_KEY`** (confirmed in `server.ts:30`).
> 3. Pilot/trial provisioning → **FULLY BUILD NOW** (libraries + API route + admin UI), NOT script-only — pilot contracts are already going out, so this is a committed, HIGH-PRIORITY deliverable (see expanded §4.3).
> 4. GrowthMotif emerald override → **a `globals.css` `.growth-motif--wins` class** (keeps globals.css the single source of token bindings), not inline style.
> 5. Selected-class carrier → **URL param `?class=`** (shareable, server-readable via async `searchParams`).
> 6. `diagnose()` internal %-leak → **keep `diagnose()` as-is** (teacher-only internal); enforce the no-% boundary via `leakGuard` tests + `diagnosisToFeedSentence`.
> 7. Seed `due_at` → **relative to `now()`** so the four Gradebook cell states stay stable across seed runs.
>
> The original risk notes are retained below for context.

1. **Auth-user creation has no DB trigger.** Research confirms `public.users` is **not** trigger-synced from `auth.users`; the seed/provisioning must INSERT the `users` row manually after each `auth.admin.createUser`. *Risk:* a partial failure (auth user created, `users` insert fails) leaves an orphan auth account that breaks idempotency on re-run. **Resolve:** decide the recovery contract — does `seedDemo` reconcile orphans (find auth user by email, ensure `users` row) or does `resetDemo` always run first? *Recommendation:* reconcile-on-seed.
2. **Service-role key env var name — ✅ RESOLVED (2026-06-19).** `createAdminSupabaseClient` reads `process.env.SUPABASE_SECRET_KEY` (confirmed `src/lib/supabase/server.ts:30`); the SSR client reads `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The new `seedDemo.mjs`/`resetDemo.mjs` scripts MUST read `SUPABASE_SECRET_KEY` (not V1's `SUPABASE_SERVICE_ROLE_KEY`).
3. **Pilot provisioning: UI or script-only for now?** V1 had a provisioning route; this spec defines `provisionTrial.ts` as a library. **Open:** is there an admin UI / API route that calls it in 4b, or is it script-invoked only for the first pilots? *Recommendation:* script-only for the foundation, with a route added when a self-serve trial flow is scheduled.
4. **`GrowthMotif` token override mechanism.** Inline `style` CSS-variable override (`['--brand' as string]`) vs a `globals.css` `.growth-motif--wins` class. Inline keeps it self-contained; a class keeps `globals.css` the single source of token bindings. **Pick one** for consistency (the a11y gate only checks the base matrix, so the emerald override must be visually verified separately).
5. **`ClassSwitcherPill` selected-class propagation.** URL search param vs React context vs cookie — the screens (Roster/Gradebook/Insights/Library) must all read the same selected `class_id`. **Decide** the carrier before the screens are built; a URL param (`?class=`) is the most Next-16-idiomatic (shareable, server-readable via async `searchParams`) and is the *recommendation*.
6. **`diagnose()` itself still leaks internally.** This spec routes Alerts through `diagnosisToFeedSentence` and forbids using `diagnose().diagnosis`, but the raw-% strings remain in `diagnosis.ts`. **Open:** leave `diagnose().diagnosis` as a teacher-debug-only field, or refactor `diagnose()` to stop building the %-laden string at all? *Recommendation:* keep `diagnose()` as-is (teacher-only internal) and enforce the boundary via `leakGuard` tests, to avoid touching the classifier in the foundation.
7. **Gradebook "not-due" cell state** depends on `assignments.due_at` being in the future relative to the seed run. Because the seed uses absolute timestamps, a future run date could flip "not-due" → "missing". **Resolve:** seed `due_at` relative to `now()` (e.g. `now() + interval`) rather than a fixed date, so the four cell states stay stable over time.

---

**Next step:** product-owner review of this spec (esp. the 7 open questions) → `superpowers:writing-plans` to produce the implementation plan → subagent-driven build, starting with the demo seed (Task 1). Reviews via `/code-review` or an in-house adversarial pass (Codex is on hold).
