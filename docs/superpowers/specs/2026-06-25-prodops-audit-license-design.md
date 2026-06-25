# Production Ops — Audit Log + Soft License Gate (Design Spec)

**Status:** DECISIONS LOCKED (Marvin, 2026-06-25) — ready for writing-plans.
**Grounding:** `docs/superpowers/specs/grounding/2026-06-25-prodops/grounding-synthesis.md` (V2 current state + V1 reference, file:line-cited).
**Memory:** [[v2-pilot-feedback-and-reprioritized-queue]] (production ops = the NEXT item), [[v2-positioning-beta-not-mvp]].

## 1. Why this, why now
Hardening before paying schools. Two gaps the reverse-audit flagged: (1) V2 records **nothing** about who changed a grade or removed a student — "who changed this grade and when?" is unanswerable, and an audit log is the prerequisite for the roadmapped Support Ticket + Profile features; (2) V2 enforces **no** seat limit on pilots (the one seat-cap trigger only fires for `status='active'`; every pilot is `trialing`), so a pilot roster can balloon unbounded.

## 2. Locked decisions (Marvin, 2026-06-25)
- **Scope = audit log (full) + a SOFT license gate.** Some teeth, never freeze an active classroom.
- **Audit which actions:** grade change (with old→new), un-enroll / re-enroll, roster/account creation, and privileged admin actions (trial provisioning, SPARK-enable). NOT high-fives / alert-resolve / quiz-publish (low-stakes noise).
- **Trial expiry stays OFF** — no pilot ever auto-suspends; the expiry cron stays a stub.
- **Mechanical defaults (applied, not asked):** entries are **append-only** (RLS: admin-client INSERT + platform_admin SELECT, no UPDATE/DELETE); capture **old→new** for value changes, who/what/when for create/delete; **platform_admin reads only** for now but **stamp `school_id`** on every row so school-admin-scoped reads are a one-policy change later; **record now, no UI this epic** (a minimal platform-admin read route only); **one epic, audit wired first** (the gate's writes are themselves audited).

### Scoping refinement (the interaction of "soft gate" + "expiry off")
Because trials won't auto-expire, the soft gate's teeth this round = **extend the existing seat-cap trigger to also cover `trialing`** (un-bypassable, already 90% built). The other soft-gate ideas are **DEFERRED with rationale**, not built:
- **"Warn/block on license expiry"** → DEFERRED. With no expiry mechanism, an app-layer expiry gate would be **dead code** — exactly V1's anti-pattern (it built `enforceActiveLicense` and never wired it). Pairs with turning expiry on.
- **"Block new-school provisioning over plan"** → DEFERRED. There is no org-level plan model for school count to gate against.
- **Auto-suspend cron + 14-day grace** → DEFERRED (Marvin's expiry-off choice).
- **Audit reader UI** → DEFERRED (record now; build the viewer with the school-admin shell / Support epic).

## 3. Scope of THIS epic

### Audit log
- **Migration 0026** — table `public.audit_logs(id, actor_id uuid null, school_id uuid null, action text, resource_type text, resource_id text null, metadata jsonb default '{}', created_at timestamptz default now())`. Append-only RLS: `service_role` FOR ALL; `platform_admin` SELECT only; **no UPDATE/DELETE policy**. Indexes: `(school_id, created_at desc)`, `(resource_type, resource_id)`, `(action, created_at desc)`. Mirror the 0017/0023 deny-by-default house pattern.
- **`logAudit(admin, entry)` helper** (`src/lib/audit/logAudit.ts`) — best-effort, **NEVER throws** (a logging failure must not roll back or 500 the originating action; catch + `console.error`). `entry = { actorId, schoolId, action, resourceType, resourceId, metadata? }`. `actorId = null` ⇒ system/cron.
- **Wire sites (route/cron level — keep libs pure; libs return summaries, callers log):**
  1. `grade.override` — `gradebook/override/route.ts`, after the successful update; metadata `{ before: { teacher_score, score_pct }, after: { teacher_score, allow_redo, notes_changed } }`; school via the class.
  2. `roster.sync` (summary) — at the callers of `reconcileCourseRoster` (the teacher `/google/sync` route **and** the nightly cron), using the returned `ReconcileResult` counts. `reconcileCourseRoster` returns counts only (`enrolled`/`reactivated`/`softRemoved`/`errors`), NOT changed ids — so log ONE summary row per reconcile: metadata `{ enrolled, reactivated, softRemoved, errors, class_id }`; **cron actor = null/system**, `/sync` actor = the teacher. This answers "who synced class X, when, and that N seats were removed" without per-row flooding or extending the (pure) lib; the `enrollments.is_active=false` rows already record *which* students. **As-built guard:** log when `softRemoved + reactivated + enrolled > 0 || skippedOther > 0 || errors > 0` (a deliberate widening over the original — captures seat-cap-throttled adds + errors, still silent on a true no-op). Metadata carries `{ enrolled, reactivated, softRemoved, skippedOther, errors, source }`.
  3. `roster.import` (summary) — teacher lean import route (`resourceType:'class'`) + admin full import route (`resourceType:'school'`). **As-built metadata uses the engines' real summary fields** (resource identity is already the top-level `resourceId`): lean `{ studentsCreated, enrolled, errors }`; full `{ studentsCreated, enrollmentsCreated }`. (The keys differ per engine because the two `*ImportSummary` types differ — `LeanImportSummary.enrolled` vs the full `ImportSummary.enrollments.created`.)
  4. `school.provision` — `admin/provision-trial` route; metadata `{ school_name, teacher_email }`.
  5. `spark.enable` — `admin/spark-enable` route; metadata `{ school_id }`.
- **Minimal read route** `GET /api/admin/audit` — **platform_admin only** (`guardPlatformAdmin`), filterable by `school_id` / `action` / `resource_type`, newest-first, capped. No UI.

### Soft license gate
- **Migration 0026** (same migration) — `CREATE OR REPLACE FUNCTION public.enforce_enrollment_limit()` changing the one line `AND status = 'active'` → `AND status IN ('active','trialing')`. Everything else identical (counts DISTINCT active students; re-enrollment of existing students still allowed; raises `check_violation` only for a genuinely-new student past `student_limit`). Re-runnable.
- **Friendly surfacing:** the enrollment-write paths (lean import, full import, GC reconcile-add) catch the trigger's `check_violation` and return a friendly "seat limit reached" message instead of a raw 500. (Verify the demo/pilot `student_limit` ≥ roster before relying on it — default 300 ≫ 8 demo students.)

## 4. Out of scope (deferred — see §2 refinement)
Expiry/suspension gate, auto-suspend cron, provisioning-over-plan, audit reader UI, porting V1's `enforceActiveLicense`, V1's dead `teacher_overrides` table.

## 5. Constraints (binding)
- **Auth chain unchanged** — bolt onto the existing per-route `getUser → role → guard → admin` flow; NO global middleware (would diverge from every route + risk skipping IDOR guards). Opt-in `logAudit` calls only.
- **`audit_logs` append-only + deny-by-default RLS**; stamp `school_id` always; read path = admin client / platform_admin.
- **Best-effort logging** — never fatal to the originating write; libs stay pure (no audit dependency), callers log using returned summaries.
- **Pilot-friendliness is the hard constraint** — widening the seat cap to `trialing` must NOT lock out a pilot: verify a generous `student_limit` (300 default). The cap only blocks NEW students past the limit; never retroactive, never re-enrollment.
- **No class freezing** — the gate never blocks grade override, content edits, or teaching writes; only new-enrollment-past-cap.
- **V1 is reference-only.** Port the `audit_logs` shape + tiny helper concept; ignore dead V1 code.
- **Migration 0026.** Advisors must stay all-WARN on NEW CORE after apply (append-only RLS = no new ERROR).
- Process: writing-plans → pre-code adversarial review → subagent-driven TDD + per-task review → whole-branch review → apply 0026 to NEW CORE + functional verify (audit rows written; seat cap fires on trialing) → Marvin merge. No Playwright needed (no new UI). Gates: tsc 0, vitest green, build 0.
