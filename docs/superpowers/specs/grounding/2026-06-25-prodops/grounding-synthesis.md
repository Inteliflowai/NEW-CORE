# Production Ops Grounding Synthesis (audit log + license gate)

> Gathered 2026-06-25 by 5 parallel readers (V2 current state + V1 reference) + opus synthesis. file:line-cited.

I have all the grounding I need from the 5 structured reports. Let me synthesize the decision-oriented map.

# Production Ops Grounding Map — Audit Log + License Write-Gate

Hardening before paying schools onboard. V2 = `C:/users/inteliflow/NEW-CORE`. V1 = reference-only (`C:/users/inteliflow/core`).

---

## 1. What exists today (V2)

### Audit infrastructure: NONE
There is no `audit_logs` table, no `logAudit()` helper, no write-trail for staff actions. The only "event" tables are `license_events` (tier/status changes) and `trial_events` (trial lifecycle) in `0007_licensing.sql:95-144` — neither records *who* did *what* to *which student record*. The v1→v2 audit doc flags this as a "Small / Adapt / Yes" priority (`C:/users/inteliflow/core/docs/audits/v1-to-v2-improvements-2026-06-24.md:22, 94`): on a real pilot, "who changed this grade and when?" is currently unanswerable, and it's the prerequisite for the roadmapped Support Ticket + Profile Settings features.

### Staff write sites that need auditing
| Action | Route | Write site | Actor / sensitivity |
|---|---|---|---|
| Grade override / reteach toggle | `src/app/api/teacher/gradebook/override/route.ts:59-60` | `homework_attempts.update({teacher_score, teacher_notes, allow_redo})` | teacher — **highest** (changes a student's grade) |
| Soft un-enroll / re-enroll (manual + GC sync + cron) | `src/lib/google/reconcileCourseRoster.ts:189-192, 239-243` via `…/google/sync/route.ts:36-39` | `enrollments.upsert(is_active:true)` / `.update({is_active:false})` | teacher / **automatic cron** — high (removes a student's seat) |
| Lean roster import | `src/app/api/teacher/roster/import/route.ts:88-89` → `importStudentsToClass.ts:137-142` | `enrollments.insert(source:'file')` | teacher — high |
| Full 5-sheet import | `src/app/api/admin/roster/import/route.ts:32-138` → `importRoster.ts:92-220` | creates `users`/`classes`/`enrollments` | teacher/admin — high (creates accounts) |
| Reinforce assignment | `src/app/api/teacher/assignments/reinforce/route.ts:146-161` | `assignments.insert(band:'reteach')` in **`after()` background** | teacher — medium |
| Quiz publish/unpublish/archive/edit | `src/app/api/teacher/quizzes/manage/route.ts:74,80,86,120` | `quizzes.update(status,…)` | teacher — medium (publish = student visibility gate) |
| Lesson edit/archive | `src/app/api/teacher/lessons/manage/route.ts:76,82` | `lessons.update(…)` | teacher — low/medium |
| Alert resolve | `src/app/api/teacher/alerts/resolve/route.ts:32-34` | `alerts.update(status:'resolved')` | teacher — low |
| High-five send | `src/app/api/teacher/high-fives/send/route.ts:39-43` | `high_fives.insert(…)` | teacher — low (transactional) |
| Assignment generate (post-quiz) | `src/app/api/teacher/assignments/generate/route.ts:160-175` | `assignments.insert(…)` | student-triggered system write |
| SPARK enable | `src/app/api/admin/spark-enable/route.ts:46-54` | `platform_links` + `school_licenses.feature_overrides` | platform_admin — **privileged** |
| Provision trial | `src/app/api/admin/provision-trial/route.ts:52-59` → `provisionTrial.ts` | creates school/teacher/license | platform_admin — **privileged** |

### License tables/columns (`0007_licensing.sql`)
- **`school_licenses`** (`:15-36`): `school_id` UNIQUE, `tier` (essentials|professional|enterprise), `status` (trialing|active|past_due|suspended|cancelled), `student_limit` (default 300), `trial_starts_at`/`trial_ends_at`, `starts_at`/`ends_at`, `renewal_date`, `feature_overrides`.
- **`license_keys`** (`:41-63`), **`license_usage`** (`:76-90`, per-month seat/usage counts), **`license_events`** (`:95-109`), **`trial_events`** (`:114-144`).

### The ONLY existing gate
`enforce_enrollment_limit()` — a `SECURITY DEFINER` **BEFORE INSERT trigger on `enrollments`** (`0009_security_hardening.sql:9-59`, trigger created `:93`). It blocks a new enrollment when `school_licenses.status='active'` AND current count `>= student_limit` (`:25-54`). **Crucially: only `status='active'` is enforced — `'trialing'` bypasses everything** (`:29-33`; `provisionTrial.ts:117` comment confirms "trialing bypasses the seat-cap trigger"). Limit is the per-license `student_limit`, not hardcoded.

### Trial expiry: UI-only, NOT a gate
- `/trial-expired/page.tsx` is a static read-only message page.
- `requireRole.ts:32` redirects there when `trial_status='expired'` — a **UI redirect, not a write-gate**.
- Both cron stubs return **501 Not Implemented**: `api/cron/trial-expiry/route.ts:4-10`, `api/cron/trial-check/route.ts`. Nothing flips a trial to expired/past_due today.

### Instrumentation choke points (`guards.ts`)
Auth is **per-route, not centralized** — every staff write route runs the same chain: `createServerSupabaseClient()` → `auth.getUser()` (401) → resolve role / STAFF_ROLES (403) → guard call (`guardClassAccess`/`guardStudentAccess`/`guardSchoolAdmin`/`guardPlatformAdmin`, `guards.ts:31-106`, all return `NextResponse|null`) → `createAdminSupabaseClient()` (synchronous, service-role, **bypasses RLS**, `supabase/server.ts:27-32`) → `admin.insert/update`.
- **Audit hook slot**: after the guard passes, immediately after the successful `admin.update/insert` — a shared `logAudit(caller, action, resourceId, before?, after?)`. No global middleware exists, so it's an **opt-in per-route call**.
- **License-gate slot**: after the guard, before the write; `school_id` is in hand via `resolveCaller()` (`guards.ts:18-25`) or `guardSchoolAdmin`'s return (`:50-61`).
- Next migration number = **0026** (last is `0025_skill_state_snapshots.sql`).

---

## 2. V1 reference

### `teacher_overrides` — exists but DEAD
Schema in `core/supabase/migrations/000_full_schema.sql:460-470`: `teacher_id, assignment_id, student_id, override_type, old_value, new_value, reason, created_at` — a who/what/why override trail. **Zero call sites** in V1 `app/` or `lib/` (no INSERT/UPDATE/SELECT). It was superseded by the general-purpose `audit_logs` pattern. **Lesson: don't build a per-feature override table; build one general log.**

### V1's live audit pattern (the model to adapt)
- **`audit_logs`** (live schema in `_reconcile_baseline/000_core_baseline.sql`): `id, actor_id, school_id, event_type, resource_type, resource_id, metadata (jsonb), ip_address, created_at`. (The older `000_full_schema.sql` has *dead* column names — `user_id/action/target_type/target_id/payload` — that silently fail; a drift-lock test `__tests__/supabase/audit-logs-columns.test.ts` guards against using them.)
- Written by **20+ endpoints** via a small `audit()` helper, e.g. `app/api/attempts/start/route.ts:151-157` (`event_type:'quiz_attempt_start'`), enrollment mutations `app/api/teacher/admin/enrolment/route.ts:49-57,71,79,98` (`'admin.enrolment_add'`, `resource_type:'enrollment'`).
- Read via `GET /api/teacher/platform/audit` (filter by `event_type`), write via POST to same — **platform_admin only** (`app/api/teacher/platform/audit/route.ts:5-64`).
- Known gap: `school_id` is inconsistently populated (e.g. quiz-start path omits it).

### V1's license/trial gating
- **`enforceActiveLicense()`** exists (`core/lib/licensing/enforce.ts:37-145`): hard-stops writes on expired (402) / suspended (403) / cancelled (410); checks dual expiry `ends_at || trial_ends_at` (`:123-142`). **BUT it has ZERO call sites in `app/api`** — built, never wired. (`checkFeature()`/`useLicenseGate()` are wired for feature-tier gating, `lib/licensing/checkFeature.ts:104-135`.)
- **Enrollment cap** is the same DB-trigger pattern V2 ported (`core/.../049_activation_keys_billing.sql:166-222`, active-only).
- **Trial expiry IS wired in V1**: `expireTrials()` cron finds `trialing` + not-converted + past `trial_ends_at` → bulk `status='suspended'` + logs `license_events` (`lib/licensing/trial.ts:157-209`); dashboard redirects expired users to a `/trial-expired` interstitial offering a **14-day grace window** ("no data will be lost") before deletion (`app/(dashboard)/layout.tsx`, `trial-expired/page.tsx:6-204`).
- V1 does **not** gate writes at the RLS layer on license status — RLS only gates license-table *reads* (`020_licensing.sql:123-217`).

**Net V1 takeaway:** the general `audit_logs` + tiny `audit()` helper is proven and worth porting almost verbatim. The license-status *write*-gate (`enforceActiveLicense`) was designed but never actually enforced even in V1 — only the trial→suspend cron + enrollment cap trigger are live.

---

## 3. What does NOT exist (the precise gaps)

**Audit:**
1. No `audit_logs` table in V2.
2. No `logAudit()` helper; no calls in any of the 13 write sites above.
3. No reader UI/route to answer "who changed this grade?"
4. GC cron un-enrollments (`reconcileCourseRoster`) leave no trace of automatic seat removals.

**License gate:**
5. No license-status write-gate anywhere in `src/` (grep for `school_licenses`/`student_limit`/`ends_at` in API paths = zero matches). `enforceActiveLicense` was never ported.
6. Trial expiry is non-functional: both crons are 501 stubs; nothing ever flips `trialing`→expired/`suspended`, so the `/trial-expired` redirect can essentially never fire from data.
7. The one live gate (`enforce_enrollment_limit`) **only fires for `status='active'`** — every pilot is `trialing`, so seat caps are **completely unenforced during pilots** (by design today).
8. No gate on content-generation or provisioning routes (quizzes/lessons/assignments generate, provision-trial) — none check seats/expiry.

---

## 4. Decisions Marvin must make (plain English)

### AUDIT

**A1 — Which actions get a record in the history log?**
Options: (a) just the two highest-stakes — a grade being changed and a student being removed from a class; (b) those plus account/roster creation and SPARK/provisioning by admins; (c) every staff write including low-stakes ones (publishing a quiz, sending a high-five, resolving an alert).
**Recommend (b).** Rationale: the question pilots will actually ask is "who touched this student's record/account?"; grade-change + un-enroll + account-creation + privileged-admin actions cover that, while high-fives/alerts are low-value noise.

**A2 — What does each history entry remember?**
Options: (a) who + what + when only; (b) who + what + when **plus the old value → new value** for changes (e.g. grade 72 → 88).
**Recommend (b) for value-changing actions, (a) for create/delete.** Rationale: "who changed this grade" is only useful if you can see *what it was before*; V1's `metadata` jsonb already carries this shape cheaply.

**A3 — Who is allowed to read the history?**
Options: (a) platform_admin only (V1's choice); (b) platform_admin + a school's own admin can see their own school's history; (c) the acting teacher can see their own actions too.
**Recommend (a) now, design the table so (b) is a later flip.** Rationale: pilots have no school-admin shell yet (per CLAUDE.md); keep reads locked to platform until that surface exists, but stamp `school_id` on every row so school-scoped reads are a one-policy change later (fixes V1's inconsistent-school_id gap).

**A4 — Can history entries ever be edited or deleted?**
Options: (a) append-only, no update/delete policy at all; (b) editable.
**Recommend (a), append-only.** Rationale: a trail you can rewrite is not a trail; enforce with RLS that grants INSERT (admin-client) + SELECT only, no UPDATE/DELETE.

**A5 — Show it in the app now, or just record it?**
Options: (a) record silently this epic, surface later with Support/Profile; (b) build a reader screen now.
**Recommend (a).** Rationale: recording is the irreversible/retrofit-expensive part; a viewer is cheap to add when the school-admin shell lands. Matches the v1→v2 doc's "land it first to avoid a retrofit."

### LICENSE GATE

**A6 — How hard should the license gate be?**
Options: (a) **strict** — hard-block writes when a license is expired or over-seat; (b) **revenue-protecting-soft** — never interrupt a class that's already teaching; only block *new* growth (new enrollments past the seat cap, new school provisioning) and *show* a warning on expiry; (c) **off for the pilot.**
**Recommend (b).** Rationale: paying-school readiness needs *some* teeth, but hard-blocking mid-pilot teaching is the fastest way to burn a pilot. Block the things that cost money (seats, new schools), warn on the rest, never freeze an active classroom.

**A7 — What exactly gets gated?**
Options, pick a set: (i) new enrollments beyond `student_limit`; (ii) new school provisioning when over plan; (iii) all writes once a trial/license has expired.
**Recommend (i) + a functional trial-expiry that flips status, defer (iii).** Rationale: (i) is already 90% built — just **extend `enforce_enrollment_limit` to also fire for `trialing`** (or a configurable pilot seat cap) so pilots can't balloon unbounded; implement the 501 trial-expiry cron so `trial_ends_at` actually transitions to `past_due`/`suspended` + logs to the audit log; leave "block all writes on expiry" out for now since even V1 never shipped it.

**A8 — Reuse the existing database trigger, or gate in the app code?**
Options: (a) extend the existing `enforce_enrollment_limit` DB trigger (can't be bypassed, already live); (b) port V1's app-layer `enforceActiveLicense` into the route chain; (c) both.
**Recommend (a) for seat caps, light app-layer for expiry.** Rationale: the seat cap belongs at the DB (un-bypassable, already there — just widen the status condition); license-*expiry* messaging is better in the app where you can return a friendly 402 + the existing `/trial-expired` page, rather than a raw SQL exception. Avoid porting the full unused `enforceActiveLicense` until expiry semantics are decided.

### SEQUENCING

**A9 — Audit and license-gate: one epic or two? Which first?**
Options: (a) one epic; (b) two, audit first; (c) two, gate first.
**Recommend one epic, audit-first within it.** Rationale: they share the same choke point (post-guard, pre/post-write) and the trial-expiry cron's status flips *should be audited*, so the audit helper is a dependency of the gate's logging. Build `audit_logs` + `logAudit()` first, wire it into the highest-stakes writes, then layer the seat-cap widening + trial-expiry cron on top (each flip logs an audit row).

---

## 5. Risks / constraints

- **Auth chain stays as-is.** Both features bolt onto the existing per-route `getUser → guard → admin` flow (`guards.ts`, `supabase/server.ts:27-32`); do **not** introduce global middleware — it would diverge from every existing route and risk silently skipping IDOR guards. Opt-in helper calls only.
- **New `audit_logs` table must be RLS deny-by-default**, admin-client INSERT + platform_admin SELECT only, **no UPDATE/DELETE policy** (append-only). Stamp `school_id` on every row (fix V1's gap) to enable later school-scoped reads. Mirrors the house pattern (migration 0023 behavioral_signals deny-by-default RLS).
- **Don't break existing flows.** The audit helper must be best-effort/non-fatal — a logging failure must never roll back or 500 a successful grade override or import. The GC cron and `after()` background writes (`reinforce`) must pass a sensible actor (`user.id` for cron-on-behalf, or a `'system'` marker) — decide in A1/A2.
- **Pilot-friendliness is the hard constraint.** Every pilot school is `status='trialing'`; if you widen the seat-cap trigger to fire on `trialing` without setting a generous pilot `student_limit`, you can lock out a legitimate pilot mid-roster-import. Set/verify a pilot-appropriate `student_limit` before enabling, and keep the gate soft (A6/A7).
- **Trial-expiry cron is currently a 501 stub** with no caller — implementing it means real schools could get auto-suspended. Pair it with V1's 14-day grace semantics (`trial.ts:157-209`, `trial-expired/page.tsx`) and audit every status flip; verify the cron auth header convention (Bearer vs `x-cron-secret`, a deferred-minor already flagged in GC Seg 2).
- **V1 is reference-only.** Port the `audit_logs` shape + `audit()` helper and the trial-suspend cron *logic*, not the code; ignore the dead `teacher_overrides` table and the unwired `enforceActiveLicense`.
- **Migration number is 0026.** RLS advisors must stay all-WARN (no new ERRORs) on NEW CORE after applying.

**Files of record:** V2 — `supabase/migrations/{0007_licensing,0009_security_hardening,0002_classes_enrollments}.sql`, `src/lib/auth/guards.ts`, `src/lib/supabase/server.ts`, the 13 write routes listed in §1, `src/lib/trial/provisionTrial.ts`, `src/app/api/cron/{trial-expiry,trial-check}/route.ts`, `src/app/trial-expired/page.tsx`. V1 — `core/lib/licensing/{enforce,trial,checkFeature}.ts`, `core/supabase/migrations/{020_licensing,049_activation_keys_billing}.sql`, `core/supabase/_reconcile_baseline/000_core_baseline.sql`, `core/app/api/teacher/platform/audit/route.ts`, `core/app/api/teacher/admin/enrolment/route.ts`, `core/docs/audits/v1-to-v2-improvements-2026-06-24.md`.