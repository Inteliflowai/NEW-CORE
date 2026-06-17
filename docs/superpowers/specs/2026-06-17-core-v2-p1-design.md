# CORE v2 — P1 (Pilot Baseline) Implementation Design

> **Inteliflow · CORE v2 · Pilot Baseline (Pro tier).** This is the implementation-ready design spec for the September pilot. It is the build manual for the phase SCOPE.md §17 calls **P1 — Pilot Baseline (Pro tier)**: the full Notice → Act → Confirm loop on the **Pro** tier, all five roles at full depth, built by mining V1 + SPARK for proven logic and re-skinning fresh.
>
> **Scope authority:** Every decision here is downstream of `docs/SCOPE.md` (all punch-list items locked as of 2026-06-17; only item 7 is ✅* pending Barb sign-off on three pedagogy deltas). Where this spec and SCOPE.md disagree, **SCOPE.md wins** — flag it as an open risk, do not silently diverge.
>
> **Source repos (reference to mine, not a base to patch):** V1 at `C:/users/inteliflow/core` (findings in `v1-mining-findings.md`); SPARK at `C:/users/inteliflow/spark-platform` (findings in `spark-mining-findings.md`). Target repo (fresh scaffold) at `C:/users/inteliflow/NEW-CORE` — Next.js **16.2.9**, React **19.2.4**, Tailwind **v4**, TS **5**, `@/* → ./src/*` alias wired.
>
> **The hard line (SCOPE §13, §16):** mine V1/SPARK for **logic, data, prompts, and patterns — never visual design.** Proven bones, brand-new skin.
>
> **Calendar honesty (read before §10):** the milestone math in §10 assumes a **parallel-staffed team starting late June 2026**, and a pilot start that is not yet pinned. Single-threaded, the calendar roughly doubles. The headcount assumption is the single biggest delivery risk and is stated up front in §10.1, not buried.

---

## Overview

**What P1 is.** CORE shows a teacher *how* each student learns and thinks, and turns it into one clear next step. P1 is the **Pro-tier pilot baseline**: not the lean Essentials MVP, but the tier where the loop actually closes. The "Confirm" half of Notice → Act → Confirm (did the intervention work, cognitive signals, Risk Index) lives in Pro — an Essentials-only pilot would repeat the V1 mistake of capturing "notice" data but never confirming "did it work" (SCOPE §0, §3). Enterprise (longitudinal, SIS, white-label) is deferred to P2.

**Pro-only at pilot (SCOPE §0/§17).** The lifted licensing gate map carries Essentials/Professional/Enterprise tiers and caps verbatim (we do **not** edit it — §6.5, SCOPE §10 "no features move tiers"), but **no Essentials tier is provisioned for the pilot.** Essentials columns existing in code ≠ Essentials being a pilot tier.

**The core loop — Notice → Act → Confirm.** The entire product is organized around one teacher loop:

- **Notice** — Teacher: Today surfaces who needs help, ranked, with a plain-language reason that passes a 5-second test.
- **Act** — one click into a recommended action (check in / targeted practice / reteach). This click is success metric #1.
- **Confirm** — later, Teacher: One Student shows whether mastery moved (reteach-effectiveness + mastery-regression alert). This is the most valuable, most-missing V1 piece.

**The lift-from-V1 thesis.** V1 built 150+ features in parallel and the result was a screen nobody could read — breadth killed clarity. But the *engine, signals, licensing, media metering, Google Classroom connector, AI prompts, and SPARK contract are production-grade and calibration-locked.* P1's discipline: **lift the proven onto a working spine first, then layer the net-new** (per-skill CL verb mapping, full Super TELI, the misconception taxonomy formalization, Canvas, the fresh design system). MVP *discipline* (one loop end-to-end, not 150 features), Pro *baseline*.

**Build stance, in one line.** Front-load proven V1/SPARK lifts onto a clean spine; sequence the fresh design and net-new pedagogy late and in parallel, never as a prerequisite for the engine.

> **Mislabeled-lift correction (from review).** Three items the draft called "net-new" already exist in V1 and are **lifts**, not greenfield. They are re-baselined throughout this spec, because mis-sizing them mis-plans the schedule:
> - **Per-skill state** already exists — `skill_learning_state` (migration 072) + `skills_registry` (071) + `computeSkillState.ts`, with a 6-state vocabulary and cold-start states. The genuine net-new is the **CL verb mapping** (3 verbs ⟷ 6 states) and surfacing it on One Student (§3.2).
> - **The misconception taxonomy is ~60% built** — `prompts.ts` already emits a closed 8-value `error_type` enum + a 6-value `reasoning_pattern` enum (which already includes a literal `misconception` value) + `misinterpretation_detected`/`vocabulary_difficulty`, and `lib/reports/diagnosis.ts` already has a recurring-error matcher. The net-new is **formalizing these into a first-class table + keying the matcher to skill** (§3.2).
> - **Per-context grain already exists** — V1's `student_model` is per-`(student_id, class_id)` as of migration 029, not per-student. Per-skill is a *third* grain that must be reconciled with the existing per-class one (§2.4).

### Lift from V1 / SPARK — at a glance

| Area | Disposition | Primary source | Net-new on top |
|------|-------------|----------------|----------------|
| **AI model registry + resilient wrappers** | LIFT verbatim | V1 `lib/ai/models.ts`, `lib/claude/client.ts`, `lib/openai/resilient.ts` | Re-pin dated model IDs at build; **rebuild the grading request shape for Opus 4.x (real work, not a copy — §1.2/§3.1)** |
| **Generation engine** (lesson → quiz 3 MCQ + 2 OEQ → adapt Q4–Q5 → OEQ grading → differentiated assignment) | LIFT prompt **text** verbatim; **extract each AI path into an import-safe `lib/` fn** (§3.4) | V1 `lib/openai/prompts.ts`, `generateQuizForLesson.ts`, `adapt/route.ts`, `submit/route.ts` (1,449 lines, 5 LLM calls) | Per-skill CL keying; misconception taxonomy formalization; **grading-path request-shape rebuild** |
| **Per-skill learning state** | **LIFT** (not net-new) | V1 migrations 071/072 + `lib/skills/computeSkillState.ts` | **CL verb mapping** (6-state ⟷ 3-verb), cold-start UI state |
| **Signal math** (8 signals, gap=20, effort labels, direction, reteach-effectiveness, Risk Index) | LIFT formulas/thresholds | V1 `lib/signals/*`, `lib/utils/scoring.ts`, `lib/admin/reteachEffectiveness.ts` | Re-key signals onto skill/class grain (§2.4); recalibrate noisy frustration/attention heuristics from pilot data |
| **Super TELI** | Build on Socratic base (base is only ~243 lines — §5.2b) | V1 `app/api/attempts/teli-chat/route.ts`, `lib/teli/prompts.ts` | **~90% net-new:** persistent memory + 3-level hint ladder + Strategy naming + voice (the §4d bundle). Memory needs a data-model design (§3.2). |
| **Misconception store** | **LIFT enums + matcher** (not net-new) | V1 `lib/openai/prompts.ts` (`error_type`/`reasoning_pattern` enums), `lib/reports/diagnosis.ts` (`findRecurringError`) | Formalize into a taxonomy table; key matcher to `skill_learning_state` (Barb ratifies/extends the existing enums) |
| **Licensing & anti-piracy** (HMAC keys, domain lock, DB seat trigger, tier gate) | LIFT as-is | V1 `lib/licensing/*`, migrations 020/033/035/049 | 4 hardening fixes (trial grace, true read-only, key-expiry-at-activation, activation rate-limit) |
| **Auth & account provisioning** | LIFT | V1 `lib/trial/*` (account-level), `lib/licensing/trial.ts` (license-level), `app/auth/callback`, `create-profile`, `reset-password` | Reconcile the two trial-state models (§2.3); §1.9 provisioning flow |
| **Object-level authorization** | LIFT | V1 `lib/auth/guards.ts` (C3 security review, 2026-06-16) | Apply to every service-role-client read of cross-user data (§1.4a) |
| **Media metering** (TTS, Whisper, Flux, Runway caps) | LIFT verbatim | V1 `lib/licensing/usageCaps.ts` + `platform_events` | Passage/question read-aloud; per-task modality descriptor (§3.3) |
| **Google Classroom** | LIFT ~95% | V1 `lib/integrations/lms/google-classroom.ts` + `app/api/teacher/google/*` | Grade *pull* as a distinct ingest pipeline (V1 only pushes — §7.5a); provider-agnostic LMS adapter seam |
| **SPARK contract** (Pro+) | LIFT contract pattern (base is ~187 lines — §10/M5) | SPARK `core-integration/spark-client.ts`, `attempt-complete-route.ts` | **5 GA reworks** = the real M5 build: rotatable/expiring keys, per-key rate-limit, idempotency TTL, codegen'd payload spec, allow-list URLs |
| **Eval rig** (6 scopes, drift gate) | LIFT scaffold verbatim | V1 `scripts/eval/` | Rebuild empty corpus with Barb; fix SPARK rubric dimension-key mismatch (§11.4) |
| **Pedagogy content** (CL states, 12 Strategies, 5 Powers, 4 effort labels, mastery scale, OEQ rubric) | LIFT verbatim | V1 `INTELIFLOW_STRATEGIES`, `powerDisplay.ts`, `effortLabels.ts`, `BAND_LABEL`, grading prompt | Barb sign-off on 3 deltas (CL verb mapping, misconception taxonomy, eval rebuild) |
| **Visual design** | **DO NOT LIFT** | — | Fresh electric pop-art skin; student-loud / adult-credible split (§16) |
| **Stripe billing** | DEFER | — | Reserved `school_licenses` columns stay; admin-provisioned keys for pilot |
| **Canvas LMS + SIS implementations** | Interface now, ship Enterprise (P2) | V1 LMS adapter seam; SIS = ~1,748 lines of real adapters, kept dark | Canvas connector; SIS sync engine |

---

## 1. Architecture & Foundations

> Scope refs: SCOPE.md §13 (Tech Architecture & V1 Gotchas, locked), §2 (5 roles), §11 (Spark contract), §14 (services). Target repo is the fresh scaffold at `C:/users/inteliflow/NEW-CORE`. Build this **first** — it is the working spine that every other section bolts onto (SCOPE §17).

This section defines the skeleton: directory layout, the identity/role model, object-level authz, the AI model registry + resilient wrappers, the Supabase access pattern, the V1 Turbopack/API gotchas, the env-var inventory, auth/account provisioning, and the eval rig wiring.

### 1.1 Repo / app structure (`src/app`, route groups per role)

Add **route groups** (parenthesized dirs — no URL segment) so each of the 5 roles gets an isolated layout while sharing one auth/tenant gate. One role = one route group = one job.

```
src/
  app/
    layout.tsx                  # root: fonts, <html>, providers (replace CRA boilerplate metadata)
    (marketing)/                # public: landing, pricing, trial signup
    (auth)/                     # sign-in, sign-up, GC OAuth callback, activation, password reset (§1.9)
    (teacher)/                  # Today / One Student / Create / Classes (§5)
      layout.tsx                # teacher chrome; resolves role via users.role (§1.2)
    (student)/                  # Home / Do the Work / Spark (Pro+)
    (parent)/                   # child narrative
    (school-admin)/             # adoption + Risk Index
    (super-admin)/              # schools / licensing / maintenance / changelog
    api/                        # SEE §1.5 — nest under existing paths; do NOT add new top-level api folders mid-build
  lib/
    ai/        models.ts        # model registry (LIFT V1 lib/ai/models.ts)
    ai/        resilient.ts     # fallback wrappers
    auth/      guards.ts        # object-level authz (LIFT V1 — §1.4a)
    supabase/  server.ts client.ts middleware.ts admin.ts
    licensing/ tiers.ts checkFeature.ts keys.ts usageCaps.ts trial.ts   # LIFT V1 (license-level)
    trial/     provisionTrial.ts seedTrialDemoData.ts sendWelcomeEmail.ts ...  # LIFT V1 (account-level, §1.9)
    skills/    computeSkillState.ts                                      # LIFT V1 (per-skill state)
    signals/   ...              # LIFT V1 signal math
    spark/     sendAssignmentToSpark.ts  # service layer wrapping the contract (§7)
    openai/    prompts.ts resilient.ts   # LIFT V1 prompt TEXT verbatim
    claude/    client.ts
    platform/  contract/        # codegen'd shared Zod wire contract (§7.3)
    engine/    grading.ts quizGen.ts assignmentGen.ts adapt.ts          # import-safe AI fns (§3.4)
    integrations/lms/  google-classroom.ts  (+ Canvas stub, net-new)
    integrations/sis/  base-adapter.ts (+ Blackbaud/Veracross/ManageBac/Clever stubs, dark)
  components/  ui/ (shadcn) + role-scoped
  scripts/eval/   types.ts runners/ ci.ts   # LIFT V1 scaffold (§10)
supabase/migrations/   # SQL migrations, consolidated from V1 (§1.7 inventory)
```

- **Per-role layout** is where the role/tenant guard lives (`auth.getUser()` → `users.role` lookup → redirect on mismatch — §1.2). Keeps "one screen / one job" structural, not just visual.
- **Visual rule (SCOPE §13 hard line):** lift V1 logic into these clean files; **never** copy V1's components/CSS. Fresh skin per §9.
- Root `layout.tsx` carries `create-next-app` boilerplate — replace title/description as the first edit.

### 1.2 Identity & role model (the table everything else depends on)

The whole auth/RLS/role-routing design rests on a single identity table; it must be the **first migration**.

- **`users`** (LIFT V1 `000_full_schema.sql:42`) is the canonical identity entity: `id` (FK `auth.users`), `school_id` (FK `schools`), `role`, `parent_id` (FK `users`), `grade_level`, `full_name`, `email`, `is_active`, `last_active_at`. **Teacher / Student / Parent / Admin are `users` rows discriminated by `role`** — they are not separate tables. The "entities" in §2.1 are conceptual roles over this one table plus their owned data (classes, attempts, etc.).
- **Role resolution:** `auth.getUser()` → select `users.role` for that `id`. This lookup is what every per-role layout guard and the `SECURITY DEFINER get_my_school_id()` read. There is no role string anywhere else.
- **The 6th role.** V1's `000` enum is `('teacher','student','parent','school_admin','platform_admin')` — five values. But V1 code (`lib/auth/guards.ts`, `lib/admin/requireSchoolAdmin.ts`, `lib/analytics/events.ts`) also uses **`school_sysadmin`**, a 6th role the DB enum does not contain. P1 must reconcile this on the first migration: **add `school_sysadmin` to the `role` CHECK constraint** (the code already depends on it; the products §6.3 activation caller list includes it), and treat it as a school-admin-tier role for routing (it shares the School Admin route group). The "5 roles" framing in SCOPE §2 is the *product* count; the *enum* is six. (Whether `school_sysadmin` gets a distinct surface vs. folding into School Admin is a Residual Open Question.)
- **`guardians`** (LIFT V1 `000_full_schema.sql:62`): the parent↔student link, `(parent_id, student_id)` unique. The Parent screen (§5.3) and the `guardStudentAccess` parent check have **no data path without it** — it ships in the first migration.

### 1.3 AI model registry (lift V1 `lib/ai/models.ts`; pick current IDs at build)

LIFT V1's pattern verbatim — a single module exporting all model IDs as named constants, sourced from env with hardcoded defaults. **Never hardcode a model ID at a call site** (the 2026-06-15 Sonnet retirement is the cautionary tale).

**Model IDs are dated and must be re-pinned at build (today = 2026-06-17):**

| Role | Env var | Build-time default (June 2026) | Notes |
|------|---------|-------------------------------|-------|
| OEQ / rubric grading (primary) | `ANTHROPIC_GRADING_MODEL` | **see decision note below** | The load-bearing 2-OEQ grader + Spark 7-dim rubric. |
| Grading fallback | `OPENAI_GRADING_FALLBACK` | current dated GPT (e.g. `gpt-4o`-class) | Keep V1's Claude→GPT fallback chain. |
| Generation (lesson/quiz/assignment) | `OPENAI_GEN_MODEL` | current dated GPT | V1 uses GPT-4o temp 0.3–0.7; confirm current ID at build. |
| Voice (Whisper/TTS) | `OPENAI_VOICE_MODEL` | `whisper-1` / `tts-1` | per V1. |

- **Grading model default — NOT settled by SCOPE; needs a product/cost call before M1 (see Residual Open Questions).** SCOPE §13/§14 name the *family* loosely ("GPT-4o + Claude for rubric grading") and V1's calibration-locked implementation ran **Claude Sonnet** at temperature 0.2. Defaulting v2 to `claude-opus-4-8` is a real change with a per-call cost delta *and* a recalibration risk (the eval corpus is calibrated against the V1 grader's output distribution). The registry pattern makes the pick a one-line, env-driven change, so P1 ships with the env var unset-to-V1-proven (`ANTHROPIC_GRADING_MODEL` defaulting to the Sonnet-class ID that matches the locked corpus) **unless** the week-1 Opus spike (§3.1) shows Opus matches the V1 grade distribution and the cost is acceptable. Do not present Opus as the settled default.
- **API surface note for the Claude client (4.6/4.7/4.8 family):** these models take `thinking: {type: "adaptive"}` + `output_config: {effort: "high"}`. `budget_tokens`, `temperature`/`top_p`/`top_k`, and last-assistant-turn prefills all **400**. V1's grading prompt uses temperature 0.2 and a JSON-parse-with-fallback contract; if Opus is selected, port the prompt **text** verbatim (§8) but rebuild the request **shape** to `output_config.format` (structured output) and drop sampling params (this is the real work flagged in §3.1, not a copy). Parse JSON output with `JSON.parse`, never raw-string-match. Handle `stop_reason: "refusal"` before reading `content[0]`.
- Registry exports a single `MODELS` object plus `PROMPT_VERSION`/`MODEL_VERSION` constants the eval rig and the Spark cache fingerprint both read.

### 1.4 Resilient wrappers + fallback

LIFT V1's `lib/claude/client.ts`, `lib/openai/resilient.ts`, and `lib/flux/client.ts`'s degrade-to-Mermaid pattern. Contract:

- **Primary → fallback chain** reads model IDs from the registry only. Grading: Claude primary → GPT fallback. (Spark's internal T2→T3→T4 generation tiering lives in SPARK; CORE's wrappers just need primary+fallback.)
- **Typed exceptions, not string matching** — branch on `RateLimitError` / `OverloadedError` / `APIError`; retry 429/5xx with backoff.
- **Stream when `max_tokens` is large** (assignment/lesson generation) to dodge SDK HTTP timeouts; use `.finalMessage()`.
- **Graceful degrade** for media (no Flux key → Mermaid/Excalidraw).
- **Terminal-failure contract (net-new, §3.5):** after primary+fallback both exhaust, the wrapper raises a typed `LlmExhaustedError`; route handlers translate it to the standard error envelope (§3.5), never a raw 500 with a partial body.

### 1.4a Object-level authorization (IDOR protection — LIFT, mandatory)

RLS is **not** a backstop on every path. V1's `lib/auth/guards.ts` (introduced by the 2026-06-16 "finding C3" security review) exists precisely because **many routes use the service-role admin client, which BYPASSES RLS — so the handler itself is the only access control.** P1's `admin.ts` client (metering, Spark webhook intake, seat triggers) inherits this exposure.

- **LIFT `lib/auth/guards.ts`** verbatim: `resolveCaller`, `guardClassAccess(classId)`, `guardStudentAccess(studentId)`, `guardSchoolAdmin`, `guardPlatformAdmin`.
- **Hard rule:** any route that touches the service-role admin client and reads cross-user data **must** call the matching object-level guard first. `requireRole('teacher')` alone does **not** stop teacher A from reading teacher B's student — `/teacher/students/[id]` (§5.1b) is a textbook IDOR target and must call `guardStudentAccess`. Every `[studentId]`/`[classId]` route binds to the corresponding guard.
- State explicitly in code review: **RLS is not a backstop on admin-client paths.** The guard is.

### 1.4b Supabase setup (SSR client, `auth.getUser`, `await cookies`, SECURITY DEFINER)

Four files under `src/lib/supabase/` (modern `@supabase/ssr` split — install `@supabase/ssr` + `@supabase/supabase-js`):

| File | Purpose | Hard rules (SCOPE §13) |
|------|---------|------------------------|
| `server.ts` | Server Components / Route Handlers / Server Actions | **`await cookies()`** (Next 16 — `cookies()` is async). |
| `client.ts` | Browser client | anon key only. |
| `middleware.ts` | Token refresh in root `middleware.ts` | refreshes session every request; calls `auth.getUser()`. |
| `admin.ts` | service-role client | server-only, never imported by client code; for metering, Spark webhook intake, seat triggers. **Every cross-user read pairs with an object-level guard (§1.4a).** |

- **`auth.getUser()`, never `getSession()`** for trust decisions — `getUser()` revalidates with the auth server. Locked V1 gotcha.
- **Session client (RLS-scoped) for DB writes**, not the anon client.
- **Circular RLS → `SECURITY DEFINER` functions.** Tenant isolation needs "user can read rows for schools they belong to," but the membership lookup is itself RLS-guarded → infinite recursion. Resolve exactly as V1 (`get_my_school_id()`, `is_platform_admin()`) and SPARK's `get_my_spark_school_id()`: a `SECURITY DEFINER` SQL function referenced inside the policies. Lock tables fail-closed (RLS on, no browser policy).
- **`DROP POLICY IF EXISTS` before every `CREATE POLICY`** (locked V1 gotcha — makes migrations re-runnable).
- **DB triggers as enforcement** (not app code): port V1's `trg_enforce_enrollment_limit` seat trigger (migration 049). Can't be bypassed from the app.

### 1.5 V1 Turbopack / API-route gotchas to honor

Locked in SCOPE §13 — bake in from line one:

- **Nest API routes under existing paths; Turbopack 404s on *new* top-level `api/` folders** created mid-dev. Practical rule: create the full `src/app/api/**` tree up front (even empty `route.ts` stubs for known endpoints); restart the dev server after adding any new top-level route segment. **This applies to every cron and webhook**, incl. `spark-attempt-complete`, the snapshot job, the trial-check job, and the idempotency sweep (§1.8).
- **Route Handlers are the API surface** — group them to mirror V1's proven paths so the lifts drop in cleanly: `api/teacher/lessons/parse`, `api/attempts/[attemptId]/{adapt,submit}`, `api/attempts/{tts,transcribe,diagram,teli-chat}`, `api/teacher/google/*`, `api/public/trial/signup`, `api/auth/callback`, `api/attempts/spark-attempt-complete` (Spark return webhook), and the cron routes in §1.8.
- **`await cookies()` / async request APIs** — Next 16 made `cookies()`, `headers()`, `params`, `searchParams` async. Every handler `await`s them.
- **`CRON_SECRET`-guarded cron routes** — verify the header before doing work.

### 1.6 Environment variable inventory

From `v1-mining-findings.md` §14 + the Spark contract. **Never print secret values.** Create `.env.example` (committed, keys only) + `.env.local` (gitignored). Add all to Vercel project env.

| Group | Vars | Source / notes |
|-------|------|----------------|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | service-role server-only |
| AI models | `ANTHROPIC_API_KEY`, `ANTHROPIC_GRADING_MODEL`, `OPENAI_API_KEY`, `OPENAI_GEN_MODEL`, `OPENAI_GRADING_FALLBACK`, `OPENAI_VOICE_MODEL` | §1.3 registry reads these |
| Licensing | `LICENSE_KEY_SECRET` | HMAC-SHA256 key signing (V1 `lib/licensing/keys.ts`) |
| Spark contract | `CORE_SPARK_API_SECRET` (HS256 JWT signing + Spark→CORE return Bearer); per-school `api_key` lives in `platform_links` row (DB, not env) | asymmetric auth, §7 |
| Media | `FLUX_API_KEY`, `RUNWAY_API_KEY` | degrade gracefully if absent |
| Email | `RESEND_API_KEY` | 8 templates ported from V1; trial credentials + parent narrative |
| Monitoring | `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | PII-scrubbed, free-tier tuned |
| Analytics | PostHog ×5 (2-project split: public + server-side) | Zod allow-list, no PII, FERPA delete path (§1.10) |
| Rate limit / cache | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | 3 limiters + cache, graceful degrade |
| Google Classroom | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | OAuth (§7.5) |
| CRM | HighLevel webhook URL/secret | trial-signup lead capture (`fireHLWebhook.ts`, non-blocking) |
| Cron | `CRON_SECRET` | guards all cron route handlers (§1.8) |
| SIS (architected, dark at pilot) | per-provider OAuth ×N | stubs only; ship Enterprise phase |

- **Deferred:** Stripe vars — `school_licenses` + `billing_invoices` reserve columns but no keys at pilot (SCOPE §14). **No code path may assume a Stripe customer/subscription exists.**

### 1.7 Migration inventory (consolidate, do not blindly renumber 61 files)

V1 has **61 migrations** with FK/trigger/RLS interdependencies. "Renumber into v2 sequence" is not mechanical — this is foundational work split into M0b (§10). The explicit P1 inventory below replaces the vague "port the migrations":

**In scope (consolidate, in dependency order):**

| V1 migration(s) | Provides | Why P1 needs it |
|---|---|---|
| `000_full_schema` | `users`, `guardians`, schools, classes, students, attempts, RLS helpers (`get_my_school_id`, `is_platform_admin`) | The spine; first migration (§1.2) |
| `020`, `049`, `033`, `035` | Licensing, activation keys, seat trigger, `platform_config` (maintenance), trial cols | §6 |
| `029` | per-`(student_id, class_id)` `student_model` | Existing per-context grain (§2.4) |
| `040_teacher_actions` | the success-metric-#1 action click log | §5.1a / §11.8 have nowhere to log without it |
| `041_signal_why_cache` | `regenerateSignalWhy` cache | §4 / §5.1a "why" copy |
| `043_homework_effort_label`, `045_homework_attempts_drift` | effort label + drift signal storage | §4 |
| `046_snapshot_schema_v2` | weekly snapshots | §2.1 trajectory "from day one"; §1.8 snapshot cron |
| `053_student_iep` | IEP/504 fields | IEP-aware generation (SCOPE §10 Essentials) + eval edge case (§11.6) |
| `055_score_grade_split` (+ prod fixes) | score/grade split | grading correctness |
| `066_eval_candidates` | eval corpus rebuild table | §11.6 |
| `071_skills_registry`, `072_skill_learning_state` | skills registry + per-skill 6-state model | §2.4 / §3.2 — **per-skill is a LIFT** |
| `074_lms_connector`, `075_sis_anchor_roster_imports` | LMS connector tables + roster identity anchoring | §7 |
| `056`/`059`/`060_spark_*` | Spark sync state, signal dedupe, dimensions | §7 |
| `076_math_quiz_numeric`, `077_student_table_rls`, `067_default_privileges` | numeric math items, student RLS, default grants | correctness/security |

**Dropped from P1 (Enterprise/out-of-scope):** Pulse mappings, `044_virtual_hugs`, `047_self_knowledge_choice`, `048_platform_shortcut_events`, `069_bncc_structured_fields` (BNCC/locale — SCOPE §19 out, keep only the wire seam), `039_longitudinal_data` (P2), `073_lift_intake`, and the demo-request/onboarding-variant tables not in the locked screen set.

- Net-new tables (`platform_links`, `webhook_idempotency_keys` GA-rework columns) are added as fresh v2 migrations on top.
- Every consolidated table gets school_id-scoped RLS + the `SECURITY DEFINER` helper + `DROP POLICY IF EXISTS`. **FK ordering matters** — 049 depends on 020, 035 sits on 020's `school_licenses`, 072 depends on 071. Build the consolidated sequence in that order.

### 1.8 Cron inventory (create `vercel.json` — it does not exist in the scaffold)

The scaffold has only `next.config.ts`; there is **no `vercel.json`.** Create it and register all crons. Every cron is `CRON_SECRET`-guarded and **nested under an existing API path** (§1.5 Turbopack trap):

| Cron | Schedule | Job |
|---|---|---|
| Trial check | daily | day-25 nudge email; day-30/grace-end expire (§6.4 fix #1); status flip |
| Idempotency TTL sweep | daily | purge `webhook_idempotency_keys` past `expires_at` (~30d, §7.3) |
| **Weekly snapshot** | weekly | write per-student trajectory snapshots (LIFT migration 046 logic) — **without this, "you vs 4 weeks ago" (§5.1b/§5.2a) renders empty for the whole pilot.** Idempotent per (student, week); defines the cold-start "<4 weeks of data" empty state for the trajectory UI. |
| **Parent narrative** | weekly | generate + send weekly parent narrative (§5.3) via Resend |

### 1.9 Auth & account provisioning (net section — the build starts before "sign in")

Onboarding (§5.6) starts at "teacher signs in," but the account that signs in must first exist. LIFT V1's real flow:

- **Trial signup (unauthenticated):** `POST /api/public/trial/signup` (IP-rate-limited) → `lib/trial/provisionTrial.ts` (**account-level** — distinct from the license-level `lib/licensing/trial.ts::provisionTrial`; see §2.3). It creates the school, creates a teacher `auth.users` + `users` row, **auto-generates a memorable password**, creates 3 demo role accounts (a demo student, parent, and school_admin) sharing that password under `@trial-<short>.core.com` emails, stores `trial_credentials` jsonb on `schools`, **seeds demo data via `seedTrialDemoData` (must seed exactly 8 demo students — SCOPE §12b, §6.6)**, and emails credentials via Resend (`sendWelcomeEmail.ts`, blocking) + fires the HighLevel lead webhook (`fireHLWebhook.ts`, non-blocking).
- **Role-provisioning constraint (C1 hardened fix):** `create-profile` self-service may assign only teacher/student/parent; **only `platform_admin` may mint admin/sysadmin roles.** Production rosters come from GC/admin import, not self-signup.
- **Students/parents do not self-signup** in production — they are admin/GC-imported `users` rows. Authentication is the standard Supabase email/password (or GC SSO for teachers).
- **Password reset / recovery:** LIFT V1's `app/reset-password` flow.
- **Auth callback:** LIFT `app/auth/callback/route.ts` (handles GC OAuth + email confirmation redirects); lives in the `(auth)` group, route nested under existing path.

LIFT targets: `lib/trial/{provisionTrial,seedTrialDemoData,sendWelcomeEmail,fireHLWebhook,logTrialEvent,trialExpiry}.ts`, `app/auth/callback/route.ts`, `create-profile`, `reset-password`.

### 1.10 Data lifecycle & FERPA (net subsection — compliance, not polish)

Piloting with real K-12 students makes data deletion/retention a build requirement, not a footnote.

- **Trial-expiry data policy:** define whether `expireTrials` **suspends** (read-only) or **purges** trial data, and the retention window. Default: suspend at expiry, purge after a documented retention period.
- **Student-removal cascade:** removing a student must cascade (or explicitly tombstone) attempts, OEQ `cognitive_notes` (sensitive), media assets, and snapshots.
- **Spark-side deletion gap (known limitation, document it):** the 6-action Spark contract (§7) has **no delete/forget channel** — a CORE-side FERPA deletion cannot propagate to SPARK today. P1 documents this as a stated limitation (Spark data is not purged at pilot) unless a delete action is added to the contract. Flagged in Residual Open Questions.
- **PostHog FERPA delete path** (§1.6) is the analytics-side obligation; the above covers the primary store.
- True read-only maintenance (§6.4 fix #2) blocks in-flight write-shaped FERPA deletions; document that deletions queue until maintenance clears.

### 1.11 Eval rig wired in from day one

SCOPE §13 makes this non-negotiable ("Eval rig from day one … critical for the OEQ grader"). Full treatment is in §11; the architectural commitments here are: LIFT V1's `scripts/eval/` scaffold verbatim; add the `npm run eval` script + a CI gate; the registry's `PROMPT_VERSION`/`MODEL_VERSION` are the drift-suite's change trigger; the corpus rebuild with Barb and the Spark rubric key-mismatch fix (§11.4) are owned by §10/§11. **Critical dependency on §3.4:** the rig can only wire `invokeCandidate` against import-safe `lib/` functions, so the engine *must* expose those (§3.4) — this is an M1 deliverable, not an M7 discovery.

### 1.12 Build order within this section

1. Replace scaffold boilerplate; create route-group dirs + empty per-role layouts.
2. **First migration: `users` (+ `school_sysadmin` enum reconciliation), `guardians`, schools/classes, RLS helpers** (§1.2) — the spine the role guard reads.
3. `src/lib/supabase/*` + `lib/auth/guards.ts` (§1.4a) + root `middleware.ts`.
4. `src/lib/ai/models.ts` + resilient wrappers (registry first, so everything downstream imports IDs from one place).
5. Full `src/app/api/**` route-stub tree incl. cron/webhook stubs (avoids the Turbopack 404 trap).
6. `vercel.json` (§1.8) + `.env.example` + Vercel env; `scripts/eval/` scaffold + CI hook.
7. Auth/account provisioning (§1.9) wired to the trial flow.

---

## 2. Data Model

> Scope refs: SCOPE.md §9 (Data Model, draft locked), §4c (per-skill CL), §6 (signals each entity must feed). Start minimal — every entity earns its place by feeding a signal in §4. Capture per-attempt history + weekly snapshots **from the start** (the V1 trajectory view was a painful retrofit). All tables get school_id-scoped RLS + the `SECURITY DEFINER` helper-fn pattern (§1.4b); `DROP POLICY IF EXISTS` before each `CREATE POLICY`. Identity/role/guardian tables are defined in §1.2; this section covers domain data.
>
> **Disposition column:** every table below is tagged **LIFT** (port V1 schema as-is, only re-key/RLS-harden), **LIFT+amend** (V1 table exists but needs a documented column/constraint change), or **NEW** (no V1 antecedent). **Provenance is a real V1 migration**, not a guess — paths are `C:/users/inteliflow/core/supabase/migrations/`.
>
> **One global RLS posture (don't repeat it per table):** all domain tables `ENABLE ROW LEVEL SECURITY`; reads are gated by `school_id = public.get_my_school_id()` (the `SECURITY DEFINER` helper from `000_full_schema.sql:738`) `OR public.is_platform_admin()` (`000:733`). Writes on signal/skill/profile tables are **service-role only** (no `authenticated` INSERT/UPDATE/DELETE policy — V1 `skills`/`skill_learning_state` do exactly this, `071:74`, `072:55`). Every new table needs the explicit `GRANT ALL … TO authenticated, anon, service_role` (V1 "Bug #7": PostgREST returns `42501` without it — `071:80`). The cross-user **admin-client** read paths additionally bind an object-level guard (§1.4a) — RLS is *not* the backstop there.

### 2.1 Core entities

Concrete table sketches. Columns are the load-bearing subset (full column lists live in the cited migrations); types are the real V1 types.

**School · Teacher · Class · Student — roster basics (LIFT, `000_full_schema.sql`).** Multi-school from day one.

- **`schools`** (`000:8`) — `id uuid PK`, `name`, `domain`, `timezone`, `google_classroom_enabled bool`, `parent_profile_visible bool`, `is_active bool`, `welcome_completed bool`. **LIFT+amend:** carries the trial + licensing-anchor columns added later (`is_trial`, `trial_status`, `trial_credentials jsonb` from `035`; `allowed_email_domains jsonb` domain-lock from `049:65`). RLS: tenant root — every other table joins back to `schools.id`.
- **`classes`** (`000:71`) — `id`, `school_id FK schools`, `teacher_id FK users`, `name`, `subject`, `grade_level`, `period`, `google_course_id`, `enrollment_count int`. RLS: teacher reads own (`teacher_id = auth.uid()` via `get_teacher_class_ids`, `000:751`); school-scoped otherwise.
- **`enrollments`** (`000:88`) — `id`, `class_id FK classes`, `student_id FK users`, `is_active bool`, `UNIQUE(class_id, student_id)`. **This table carries the seat-enforcement trigger — see §2.5.**
- **Teacher / Student** are **`users` rows** discriminated by `role` (§1.2), not separate tables. `users.grade_level` (`000:53`) is the grade-anchor for generation (§3, §4a) and the Spark grade-band gate (§7). `users.school_student_id` (the longitudinal anchor for P2) is **NOT in `000`** — it is added by **`075_sis_anchor_roster_imports.sql:27`** (`school_student_id text` + `school_student_id_source CHECK ('csv_import'|'provider_sync'|'admin_manual')` + a partial-unique index on `(school_id, school_student_id) WHERE … IS NOT NULL`, `075:43`). Null for GC-imported rows; populated by SIS/Clever. **LIFT the column + anchor index from 075; leave the roster-import pipeline tables dark (§2.2).**

**Lesson · Quiz · Assignment · Attempt (LIFT, `000_full_schema.sql`).**

- **`lessons`** (`000:98`) — `id`, `class_id`, `teacher_id`, `title`, `parsed_content jsonb` (plan + passage + objectives + key concepts), `grade_level`, `subject`, `status CHECK ('draft'|'pending_review'|'approved'|'published'|'archived')` (the teacher-in-the-loop gate, §3.1).
- **`quizzes`** (`000:115`) + **`quiz_questions`** (`000:129`) + **`quiz_attempts`** (`000:143`) + **`quiz_responses`** (`000:159`) — kept **separate** from the assignment chain so the Assignment-vs-Quiz gap signal works (§4, SCOPE §9).
  - `quiz_questions.question_type CHECK ('mcq'|'open')` (`000:133`) — 3 MCQ + 2 OEQ. `concept_tag text` (free-text AI tag) **plus** `skill_id uuid FK skills` added by **`071:56`** — this is the linkage that makes signals key on skill (§2.4).
  - `quiz_attempts.mastery_band CHECK ('reteach'|'grade_level'|'advanced')` (`000:153`) — the **DB enum stays `reteach|grade_level|advanced`**; the user-facing **Reinforce/On Track/Enrich** verbs are a display mapping (SCOPE §15 "never 'Band'"; §3.2).
  - **`quiz_responses` is where the cognitive fields live** (`000:159`): `ai_score numeric`, `ai_score_explanation`, `cognitive_notes text` (FERPA-sensitive — §1.10), `confidence numeric`, plus the behavioral telemetry that feeds effort/frustration signals: `response_time_ms`, `hesitation_ms`, `answer_changes`, `navigation_backs`, `pause_count`, `total_pause_ms`, `word_count`. **LIFT+amend:** the structured `error_type` / `reasoning_pattern` / `misinterpretation_detected` / `vocabulary_difficulty` values (emitted by the grader, `lib/openai/prompts.ts:589-592`) are persisted as part of the grading write but are **not yet first-class columns** — V1 folds them into `cognitive_notes`/grading output. P1 promotes them to the misconception taxonomy table (§2.4, §3.2).
- **`assignments`** (`000:184`) — `id`, `quiz_attempt_id FK quiz_attempts`, `student_id`, `class_id`, `lesson_id`, `mastery_band` (same enum), `learning_style`, `content jsonb NOT NULL` (the differentiated work), `status`, `teacher_reviewed bool`, `scaffold_level`, `due_at`. **LIFT+amend:** `skill_ids uuid[] NOT NULL DEFAULT '{}'` is added by **`071:65`** (the denormalized skill set the homework practices — *each attempt carries a skill tag* per §2.1's loop requirement). Spark columns (`spark_experiment_id`, `spark_attempt_id`) are added by `038:7` and the sync-state columns by `056` (§2.2).
- **`homework_attempts`** (`000:214`) — the student's actual work on an assignment: `assignment_id`, `student_id`, `responses jsonb`, `score_pct numeric`, `ai_feedback jsonb`, `teli_hint_count int`, `submitted_on_time bool`. (Note: V1 has **both** `assignment_submissions` and `homework_attempts`; the `homework_attempts` row is the graded artifact that feeds the gap signal.)

**`skill_learning_state` (LIFT, `072_skill_learning_state.sql`) — per `(student_id, skill_id)`.** This is the corrected lift (the draft's invented `skill_state` does not exist):

```
skill_learning_state (072:22)
  id uuid PK
  student_id  uuid FK users  ON DELETE CASCADE
  school_id   uuid FK schools ON DELETE CASCADE
  skill_id    uuid FK skills  ON DELETE CASCADE
  state       text NOT NULL CHECK (state IN (         -- the 6-value vocabulary
                'needs_different_instruction','needs_more_time',
                'on_track','ready_to_extend',
                'insufficient_data','not_attempted'))
  confidence        numeric  DEFAULT 0   -- 0-100, rendered as SOFT WORDS only (072:35)
  observation_count int      DEFAULT 0   -- graded cold + scaffolded observations
  evidence          jsonb    DEFAULT '{}' -- { drivers: string[], metrics: {...} }
  last_reteach_outcome text                -- e.g. 'different_approach_improved'
  updated_at  timestamptz
  UNIQUE (student_id, skill_id)
```

Computed by **`lib/skills/computeSkillState.ts`** (LIFT) — `MIN_OBSERVATIONS = 3` is the anti-noise guard (`computeSkillState.ts:121`): never assert a verdict on `< 3` graded observations and never score non-submission as "can't" (those route to `insufficient_data`/`not_attempted`, `:226-231`, `:320-337`). `ready_to_extend` was added after the original 5-state version shipped to prod, so 072 re-runs a `DROP CONSTRAINT … ADD CONSTRAINT` to stay idempotent (`072:68-78`) — **keep that idempotent re-add in the consolidated v2 migration.** Cold-start states (`insufficient_data`, `not_attempted`) are first-class, never fabricated. **RLS:** same-school read; **students/parents never read this table** ("no diagnostic surfaces student-side", `072:53`) — load-bearing for SCOPE §15 ("observational, not diagnostic").

**`skills` (LIFT, `071_skills_registry.sql`) — the per-school taxonomy `skill_learning_state` and `quiz_questions.skill_id` reference.**

```
skills (071:31)
  id uuid PK
  school_id uuid FK schools ON DELETE CASCADE   -- per-school registry
  subject   text                                -- nullable
  name      text NOT NULL                        -- display (first-seen cleaned tag)
  slug      text NOT NULL                        -- normalized identity (lib/skills/skillSlug.ts)
  aliases   jsonb DEFAULT '[]'                   -- folded-in raw AI tags (drift merges, not forks)
  status    text DEFAULT 'unreviewed' CHECK (status IN ('unreviewed','active','merged','retired'))
  merged_into uuid FK skills                      -- merge without losing history
  created_by  text DEFAULT 'ai' CHECK ('ai'|'teacher'|'backfill')
  UNIQUE INDEX (school_id, COALESCE(subject,''), slug)  -- 071:50, COALESCE closes the NULL hole
```

Quiz generation resolves each AI `concept_tag` → `skills` row (slug match else auto-create `status='unreviewed'`); nothing is dropped. **LIFT verbatim.**

**Snapshots (LIFT+amend, `046_snapshot_schema_v2.sql`) — weekly, written by the §1.8 snapshot cron.** V1's table is **`student_model_snapshots`** (extended by `046`, not invented). `046` adds the six signal fields the historical classifier needs — `risk_score`, `avg_hints_per_attempt`, `divergence_direction`, `divergence_score`, `recent_effort_labels jsonb`, and a `snapshot_schema_version CHECK (NULL OR 'v1'|'v2')` forensic stamp (`046:29-42`). Index is **per `(student_id, snapshot_date DESC)`** partial on `snapshot_schema_version='v2'` (`046:48`). **The trajectory grain is per-student-per-week** (not per-class, not per-skill) — see §2.4. **LIFT the schema; the weekly write job is the §1.8 cron, idempotent per `(student, week)`; "<4 weeks of data" is the cold-start empty state for the "you vs 4 weeks ago" UI (§5.1b/§5.2a).**

**Profile — `student_model` (LIFT, `000:333` + `029` per-class grain).** Observational only; Strategies + Powers accrue from behavior, **per `(student_id, class_id)`** — see §2.4 for why this is the *correct* grain and not a special case.

```
student_model (000:333)
  id uuid PK
  student_id uuid FK users
  class_id   uuid FK classes        -- ADDED by 029:8 (was per-student-only)
  risk_score numeric, risk_trend text
  attention_avg numeric, attention_trend text
  learning_velocity_avg numeric, velocity_trend text
  dominant_engagement text, frustration_avg numeric
  consistency_label text, dominant_effort_pattern text
  sessions_analyzed int
  -- 7 SPARK rubric rolling averages added by 060 (see §2.2):
  spark_dim_problem_understanding … spark_dim_collaboration  NUMERIC(3,2)
  spark_dim_attempt_count int, spark_dim_collaboration_count int
  UNIQUE (student_id, class_id)     -- 029:15 (was student_model_student_id_key)
```

**`029` is the real grain change** (`029:11` drops the old `student_id`-only unique, `029:15` adds `UNIQUE(student_id, class_id)`); **null `class_id` rows are the legacy global rollup** (`029:14`). The "8.2 per-student band" claim elsewhere is corrected to **per-class**. **LIFT 000 + 029 together; the upsert target is `onConflict: 'student_id,class_id'` (`029:18`).**

**Teacher action log (LIFT+amend, `040_teacher_actions.sql`) — success-metric-#1 click (§5.1a, §11.8).**

```
teacher_actions (040:9)
  id uuid PK
  teacher_id uuid FK users ON DELETE CASCADE
  student_id uuid FK users ON DELETE CASCADE
  class_id   uuid FK classes, school_id uuid FK schools
  tribe   text NOT NULL CHECK (tribe IN ('reteach','stretch','advanced'))   -- ⚠ see note
  signal_summary text, draft_body text NOT NULL
  status  text DEFAULT 'draft' CHECK ('draft'|'approved'|'edited'|'skipped')
  final_body text, send_to_parent bool
  source  text DEFAULT 'gpt' CHECK ('gpt'|'template'|'demo')
  briefing_date date DEFAULT current_date
  UNIQUE INDEX (teacher_id, student_id, briefing_date)   -- 040:30, one draft/teacher/student/day
```

**⚠ SCOPE divergence (flag, don't reopen):** the `tribe CHECK ('reteach'|'stretch'|'advanced')` is V1's retired **"Three Tribes"** vocabulary — SCOPE §15 retires "Tribes" in favor of **Reinforce/On Track/Enrich**. P1 renames the column to `cl` (or keeps `tribe` internal and maps at the read boundary) and aligns the CHECK to the CL verb set (§3.2). The **`status` value the success metric reads is `approved`/`edited`** (the click that proves the insight landed). RLS: `teacher_id = auth.uid()` own-rows (`040:48`) + platform-admin SELECT.

**Media asset (LIFT, metering via `platform_events`).** V1 has **no dedicated `media_assets` table**; generated illustrations/diagrams/audio are persisted to Supabase Storage and **metered as event rows in `platform_events`** (§2.5). **Flux URLs expire in ~10 min → persist immediately on generation** (LIFT V1 `lib/storage/media.ts::persistImage`; §3.3, §7.4). **NEW for P1:** if a first-class `media_assets` row is wanted (for the per-task modality descriptor and FERPA cascade, §1.10/§3.3), add it as a fresh v2 table — it does not exist to lift.

**Student IEP (LIFT, `053_student_iep.sql`) — IEP/504 fields. Correction: these are COLUMNS on `users`, not a separate table.** `053:26` adds `has_iep bool`, `iep_plan_type text CHECK (NULL|'iep'|'504'|'support_plan')`, `accommodations jsonb` (canonical codes from `lib/iep/accommodations.ts`), `iep_notes text`, `iep_updated_at`, `iep_updated_by uuid FK auth.users`. **Privacy posture (Barb 2026-04-26, `053:9`): visible to teacher/school_admin/school_sysadmin/platform_admin only — parent and student surfaces MUST NOT render it.** Feeds accommodation-aware generation (§3) + the eval IEP edge case (§11.6).

**License — see §2.5 / §6** (`school_licenses` etc.).

### 2.2 Tables the integration/platform layers add

- **`platform_links` (LIFT+amend — generalizes V1 `platform_api_keys`, `034:7`).** The V1 table is **`platform_api_keys`** (`034_platform_api.sql`), **not** SPARK's `core_spark_links` (that lives in the SPARK repo). V1 columns: `id`, `school_id FK schools`, `product text CHECK ('lift'|'spark'|'pulse'|'custom')`, `api_key text UNIQUE`, `label`, `is_active bool`, `last_used_at`, with `UNIQUE INDEX (school_id, product)` (`034:20`) — exactly one link per (school, product). **P1 renames to `platform_links` and amends** to add the §7 GA-rework columns (these are **NEW**, no V1 antecedent — V1's `api_key` is a bare value with no version/rotation/expiry):
  ```
  platform_links (rename of platform_api_keys)
    school_id, product, enabled (was is_active), api_key, core_base_url   -- LIFT shape
    key_version int, rotated_at timestamptz, expires_at timestamptz       -- NEW (§7)
    UNIQUE (school_id, product)                                            -- LIFT (034:20)
  ```
  **This config row is the only thing in §7 that is genuinely generic** (§7 framing note). Drop V1's `'lift'`/`'pulse'` product values from the pilot CHECK (Enterprise/out-of-scope) but keep `'spark'`; keep the wire seam.
- **`webhook_idempotency_keys` (NEW for P1 — lift SPARK migration 029 *shape*, no V1 CORE table).** `(endpoint, idempotency_key text UNIQUE, status_code int, response_body jsonb, created_at, expires_at)`. On hit, return the cached response and **never** re-run (prevents retry storms, §7.3). `expires_at` enforces the ~30d TTL (the §1.8 idempotency-sweep cron). V1 CORE's only idempotency surface today is the per-assignment `spark_sync_*` columns (`056`), which is *not* a generic dedupe table — hence NEW.
- **`eval_candidates` (LIFT, `066_eval_candidates.sql`).** `scope, input, expected_output, raw_output`, stratification cols (`grade_band`/`subject`/`comprehension_band`/`learning_style`), `reviewer_notes`, `source_attempt_id`, `barb_reviewed bool`, `promoted_at` — the corpus-rebuild table (§11.6). **LIFT.**
- **LMS connector tables (LIFT, `074_lms_connector.sql`).** Two real tables: **`external_identities`** (`074:12` — `school_id`, `student_id FK users`, `provider text` e.g. `'google_classroom'`, `external_user_id`, `email`, `UNIQUE(provider, external_user_id)`) and **`lms_publications`** (`074:29` — `provider`, `course_external_id`, `external_assignment_id`, `resource_type CHECK ('quiz'|'homework'|'spark'|'course_link')`, `resource_id uuid`, `launch_url`, `grade_passback_enabled bool`, `UNIQUE(provider, resource_type, resource_id, course_external_id)`). Identity resolution is the `SECURITY DEFINER` fn **`resolve_external_identity(provider, external_user_id, email)`** (`074:54`) — external-id first, *unambiguous* email second (2+ rows = no match, `074:69`). **RLS posture is the strict one to copy:** `external_identities` has **no client-facing policy at all** (deny-by-default; reads only via the definer fn + service role, `074:84-87`); `lms_publications` is teacher-owns-what-they-published (`published_by = auth.uid()`, `074:91`). **LIFT both verbatim.**
- **Roster identity / SIS anchor (LIFT schema, dark at pilot — `075`).** `roster_imports` + `roster_import_rows` (the CSV anchor-import pipeline, `075:49`/`:70`) plus the `users.school_student_id` anchor (§2.1). **Admin-only RLS** via the new `get_my_role()` definer (`075:93`) scoped to `school_admin`/`school_sysadmin`/platform_admin. **LIFT the anchor column + index now** (it is the P2 longitudinal backbone); the import-pipeline tables ship but stay dark (no GC/SIS sync wiring at pilot beyond GC).
- **SPARK sync-state (LIFT, `056` + `038`).** Not a table — **columns on `assignments`**: `spark_experiment_id`, `spark_attempt_id` (`038:7`), `spark_sync_failed bool`, `spark_sync_error text` (one of `school_not_linked|core_integration_disabled|experiment_not_found|teacher_resolution_failed|session_creation_failed|transport_exhausted|other`, `056:13`), `spark_sync_attempted_at` (last-attempt semantics, overwritten on retry, `056:24`). Launch button gates on `spark_attempt_id IS NOT NULL AND NOT spark_sync_failed` (`056:11`; soft-degrade per §3.5). **LIFT.**

### 2.3 Trial-state source of truth (reconcile the two models — locked decision needed)

V1 stores trial state in **two places with two `provisionTrial` functions**, and P1 must pick one source of truth and document the read path for every gate:

- **`schools` table (migration 035):** `is_trial bool`, `trial_started_at`, `trial_expires_at`, `trial_status text CHECK ('inactive'|'active'|'expired'|'converted'|'cancelled')` (`035:10`), `trial_plan text DEFAULT 'pro'` (`035:13`), `trial_credentials jsonb` (`035:16`), `trial_source`, `hl_contact_id` (HighLevel CRM). Plus `users.is_trial_user bool` + `users.trial_school_id` (`035:19`) and the **`trial_events`** audit table with an 18-value `event_type CHECK` (incl. `trial_signup`, `day_25_email_sent`, `day_30_email_sent`, `trial_converted`, `035:27`). Written by the **account-level** `lib/trial/provisionTrial.ts`.
- **`school_licenses` (migration 020 base + 035 trial cols):** `status text CHECK ('trialing'|'active'|'past_due'|'suspended'|'cancelled')` (`020:12`), `trial_starts_at`, `trial_ends_at`, `trial_converted bool` (`020:14`), `tier CHECK ('essentials'|'professional'|'enterprise')` (`020:11`), `student_limit int DEFAULT 300` (`020:13`). Written by the **license-level** `lib/licensing/trial.ts::provisionTrial` (sets `student_limit=300`, `tier='professional'`, `status='trialing'`).

**Decision for P1:** `school_licenses.status` is the **authoritative source for all gating** — `checkFeature`, `useLicenseGate`, `checkUsageCap`, `enforceActiveLicense`, and the trial cron all read `school_licenses`. `schools.is_trial/trial_status/trial_credentials` is **derived/presentation state** (used by onboarding and the welcome email), kept in sync by the provisioning flow. The two `provisionTrial` functions are disambiguated by path and role: `lib/trial/*` provisions the **account + school + demo data**, then calls `lib/licensing/trial.ts` to provision the **license row**. Both referenced explicitly in the lift table.

> **NEW divergence to flag (not in the draft) — tier-enum mismatch across two licensing migrations.** `school_licenses.tier` uses **`'professional'`** (`020:11`) but `license_keys.tier` uses **`'pro'`** (`049:18`). The HMAC activation path (which writes a `license_keys` row then provisions `school_licenses`) must map `'pro' → 'professional'` or the CHECK fails at activation. P1 **picks `'professional'` as canonical** (it matches `TIER_FEATURES` and SCOPE §10) and corrects the `license_keys` CHECK in the consolidated migration. Do not silently carry both.

### 2.4 Context granularity — reconcile per-student / per-class / per-skill (do not pile up special cases)

The draft introduced per-skill state as a *third* grain without reconciling the two that already exist. P1 defines the granularity model **once**, grounded in what the real migrations enforce:

- **Canonical hierarchy:** `(student_id, class_id, skill_id)` with rollup. The grain a signal lives at is **determined by what question it answers**, and each grain is a real DB constraint, not a convention:
  | Grain | DB constraint | What lives here |
  |---|---|---|
  | per `(student, class)` | `student_model UNIQUE(student_id, class_id)` (`029:15`) | Learner Profile, 12 Strategies, 5 Powers, risk/attention/velocity/consistency, the 7 SPARK rubric rolling averages (`spark_dim_*`, `060`) |
  | per `(student, skill)` | `skill_learning_state UNIQUE(student_id, skill_id)` (`072:41`) | CL (the 6-state vocabulary → 3 verbs) + the per-skill misconception |
  | per `(student, week)` | `student_model_snapshots (student_id, snapshot_date)` (`046:48`) | trajectory ("you vs 4 weeks ago") |
- **Legacy global per-student `student_model` rows (null `class_id`)** are the **global rollup** (`029:14`) — not a special case, just the top of the same hierarchy.
- **`student_model` (migration 029)** is per-`(student_id, class_id)` (unique on `(student_id, class_id)`, null = legacy global). **Learner Profile, the 12 Strategies, and the 5 Powers live here, per-class** — they are cross-cutting and behavioral, not per-skill. (§8.2's "per-student band" claim is corrected to "per-class, migration 029.") A student can be "visual in Math, auditory in English" (`029:3`) — that is *why* the grain is per-class, and it is the one rule that prevents special-casing.
- **`skill_learning_state` (migration 072)** is per-`(student_id, skill_id)`. **CL and the misconception signal live here, per-skill.** Note this grain has **no `class_id`** — a skill is school-scoped (`072:26` FK `skills`, which is per-school via `071`), so per-skill state is implicitly cross-class. That is intentional: comprehension of "decimal operations" is the same skill whether seen in 1st or 5th period.
- **Source-of-truth rule when grains disagree:** for a *skill-specific* question (CL on this skill, the misconception on this skill), `skill_learning_state` wins; for a *cross-cutting* question (which Strategies/Powers this student shows in this class), `student_model` wins; for a *trajectory* question (is this student climbing/sliding over weeks), `student_model_snapshots` wins. They answer different questions and are **not expected to agree** — `mastery_band` on `quiz_attempts` is the *attempt-level* reading; `skill_learning_state.state` is the *fused per-skill* reading; they can legitimately differ.
- **Dependency:** signals re-key onto this hierarchy in M2; the engine must emit **skill-tagged attempts** in M1/M2 — concretely, `quiz_questions.skill_id` (`071:56`) and `assignments.skill_ids[]` (`071:65`) must be populated by the generation path, or per-skill state has no input (`computeSkillState.ts` reads graded observations keyed by `skill_id`).

### 2.5 Licensing tables (detail in §6)

All from the licensing/anti-piracy migrations; **LIFT as-is** with the four §6 hardening fixes and the §2.3 tier-enum correction.

- **`school_licenses`** (`020:8`, extended `049:70`) — one per school, **`UNIQUE(school_id)`** (`020:10`); `tier`/`status`/`student_limit` (gating source of truth, §2.3); reserved Stripe columns `stripe_customer_id`/`stripe_subscription_id` stay but **no code path may assume they're populated** (§1.6, SCOPE §14); `feature_overrides jsonb`/`feature_blocks jsonb` (`020:25`) for negotiated deals; `activated_via_key_id FK license_keys` (`049:71`).
- **`license_keys`** (`049:14`) — HMAC burn ledger: `key text UNIQUE`, `signature text NOT NULL` (HMAC-SHA256 truncated, verified at activation via `LICENSE_KEY_SECRET`), `tier`/`student_limit`/`duration_months`, `status CHECK ('pending'|'active'|'expired'|'revoked')`, one-time `activated_at`/`activated_by`, `expires_at` (hardening fix #3 reads this **at activation**, today it's ignored), `allowed_email_domains jsonb` baked in at issue (`049:35`).
- **`license_usage`** (`020:34`) — monthly rollup, `UNIQUE(school_id, month)`.
- **`license_events`** (`020:50`) — audit log; auto-written `'license_created'` by the `AFTER INSERT` trigger `trg_license_created_event` (`020:113`).
- **`billing_invoices`** (`049:121`) — PO/check/wire (`payment_method text`, no Stripe), `invoice_number text UNIQUE`, `status CHECK ('issued'|'paid'|'overdue'|'cancelled')`.
- **`user_sessions`** (`049:81`) + **`login_anomalies`** (`049:229`, `anomaly_type CHECK ('many_concurrent_sessions'|'multi_geo_24h'|'rapid_ip_burst'|'auto_suspended')`) — concurrent-session tracking + anti-piracy anomaly detection.
- **`platform_config`** (`033:7`) — maintenance singleton (`maintenance_mode bool`, `maintenance_message`, seeded `INSERT … DEFAULT VALUES ON CONFLICT DO NOTHING`, `033:17`). **Hardening fix #2:** today it gates a banner only; P1 makes it *truly* read-only (block write-shaped requests; FERPA deletions queue until it clears, §1.10).
- **`platform_events`** (`034:23`) — **media metering store**. Each metered call inserts a row `{ source, event_type, school_id, student_id, payload jsonb }`; `lib/licensing/usageCaps.ts::checkUsageCap` counts rows where `source = CAP_EVENT_SOURCE[feature]` since the period start (`usageCaps.ts:159`). The exact source strings and caps (LIFT verbatim, SCOPE §5b):
  | Capped feature (`CappedFeature`) | `platform_events.source` | Period | Essentials / Professional / Enterprise |
  |---|---|---|---|
  | `teli_chat` | `teli_chat` | day | 20 / 50 / ∞ |
  | `flux_images` | `flux` | month | 50 / 200 / ∞ |
  | `runway_videos` | `runway` | month | 10 / 50 / ∞ |
  | `whisper_seconds` | `whisper` | month | 12 000 / 60 000 / ∞ |
  | `tts_characters` | `tts` | month | 100 000 / 500 000 / ∞ |

  (`usageCaps.ts:30-75`; `null` = unlimited.) **Metering fail-open vs licensing fail-closed precedence is locked in §3.5** — the gated write never reaches the metered provider call, so fail-closed wins.
- **`schools.allowed_email_domains`** (jsonb, `049:65`) — the domain-lock anti-piracy layer.
- **`enrollments`** carries the **seat-enforcement DB trigger** — the §2.1 table plus this `BEFORE INSERT` trigger:
  ```
  trg_enforce_enrollment_limit  BEFORE INSERT ON enrollments   -- 049:218
    → enforce_enrollment_limit()  SECURITY DEFINER             -- 049:169
  ```
  Logic (`049:169-216`): resolve the student's `school_id`; read `school_licenses.student_limit WHERE status='active'`; if **no active license → allow** (trial/pilot, no enforcement, `049:188`); else count `DISTINCT` active student users at the school; if `count >= limit` **and** this student is not already enrolled anywhere at the school, `RAISE EXCEPTION … USING ERRCODE='check_violation'` (`049:209`). Re-enrollments of existing students are always allowed. **Cannot be bypassed from app code** — this is the SCOPE §12a "DB-trigger seat enforcement" moat. **LIFT verbatim.** (Pilot note: a Pro trial has `status='trialing'`, not `'active'`, so the trigger is a no-op during the trial window by design — the cap binds only after conversion to an active license.)

---

## 3. Generation Engine

> Scope refs: SCOPE.md §4 (the engine — the heart of CORE), §4a (grade-anchored difficulty), §4b (adaptive Q4–Q5), §4c (per-skill CL), §5 (media-rich outputs). LIFT V1's prompt **text** verbatim; the genuine net-new is the CL verb mapping, the misconception taxonomy formalization (Barb-gated, §10), and the **grading-path request-shape rebuild** if Opus is selected. Consumes the §1.3 registry + §1.4 wrappers.

### 3.1 Pipeline

**Lesson Plan → Quiz (3 MCQ + 2 OEQ) → read cognitive + behavior signals → set CL + detect Learning Strategies → generate Differentiated Assignment + Spark Challenge + Super TELI support.**

The pipeline is **not one file copy**. V1 spreads it across four route/lib surfaces, and the heaviest one — `app/api/attempts/[attemptId]/submit/route.ts` (**1,449 lines**) — makes **4 distinct LLM call sites** (grading, learning-style, assignment, insights), with the assignment site itself a **2-provider primary→fallback path** (Claude → GPT), which is what makes "5 LLM calls" in submit. Counting the whole pipeline there are **5 generation calls end-to-end** (lesson parse, quiz gen, adapt, grading, assignment) plus **2 analysis calls** that fire inside submit (learning-style, insights). Each one becomes an import-safe `lib/engine/*` function (§3.4) and a retryable WDK step (§3.6).

#### Per-AI-call reference table (lift targets, exact params)

| # | Call (purpose) | V1 call site | Model + sampling | Prompt source (`lib/openai/prompts.ts`) | Output shape | `lib/engine` target | Primary → fallback |
|---|---|---|---|---|---|---|---|
| 1 | **Lesson parse** — sentence/upload → plan + passage + objectives + key concepts | `app/api/teacher/lessons/parse/route.ts:95–103` | `OPENAI_GEN_MODEL`, **temp 0.3**, `max_tokens 2000`, `response_format:{type:'json_object'}` | `LESSON_PARSE_SYSTEM` (268–271) + `lessonParsePrompt()` (272–296) | `{ plan, passage, objectives[], key_concepts[] }` JSON; persisted `status='pending_review'` | `lib/engine/lessonParse.ts` | GPT-only (no Claude leg); `resilientChatCompletion` retries 429/5xx |
| 2 | **Quiz gen** — 3 MCQ + 2 OEQ (STEM variant: 3 numeric + 2 OEQ) | `lib/teacher/generateQuizForLesson.ts:199–209` | `OPENAI_GEN_MODEL`, **temp 0.5**, `max_tokens 3000`, `response_format:{type:'json_object'}` | quiz prompt body (297–512); **Bloom-to-grade calibration at 367–372 — §4a hard constraint** | `{ questions:[{position,type,question_text,options?,answer?,rubric}] }` | `lib/engine/quizGen.ts` | GPT-only; numeric-math grading is deterministic (migration 076), not LLM |
| 3 | **Adapt Q4–Q5** — within-attempt reshape off Q1–Q3 MCQ % | `app/api/attempts/[attemptId]/adapt/route.ts:98–148` | `OPENAI_GEN_MODEL`, **temp 0.7**, `max_tokens 1200`, `response_format:{type:'json_object'}` | inline system+user (94–142); band thresholds from `computeMasteryBand` (**0–50 scaffolded / 50–79 grade_level / 80+ advanced**, adapt:61–62) | `{ level, mcq_pct, questions:[{position,question_text,rubric,scaffold_hint,difficulty_label}] }`; cached on `quiz_attempts.adapted_questions` | `lib/engine/adapt.ts` | GPT-only; **on null → falls back to original Q4/Q5** (adapt:151–161), never blocks the attempt |
| 4 | **OEQ grading** — score the 2 OEQs + extract cognitive signals (highest-stakes) | `submit/route.ts:245–249` (concurrent `Promise.all`, one call per OEQ) | `CLAUDE_GRADING_MODEL` via `claudeChat`, **temp 0.2**, `maxTokens 600` | `GRADING_SYSTEM` (521–569) + `gradingPrompt()` (571–648) | `{ score:0|0.5|1.0, explanation, confidence, grader_source, error_type, reasoning_pattern, misinterpretation_detected, vocabulary_difficulty, cognitive_notes }` (contract at 583–594) | `lib/engine/grading.ts` | **Claude primary → GPT fallback** (V1's calibration-locked chain); see request-shape rebuild below |
| 5 | **Assignment gen** — differentiated assignment (15 profiles = 3 bands × 5 learning styles) | `submit/route.ts:854–880` (`generateAssignmentJson`) | Claude `claudeChat` **temp 0.7**, `maxTokens` up to 4500, `timeoutMs 120000`; GPT leg temp 0.7, `response_format:{type:'json_object'}`, `timeoutMs 45000` | `ASSIGNMENT_SYSTEM` (686–743) + `assignmentPrompt()` (744+); `SCAFFOLD_INSTRUCTIONS[level]` appended (submit:748–752) | differentiated assignment JSON keyed to band + learning_style; `generation_model` recorded | `lib/engine/assignmentGen.ts` | **Claude primary → GPT fallback** (submit:869–880); 120s Claude timeout tuned to ~60–80 tok/s streaming (submit:846–853) |
| 5a | **Learning-style** — infer style from behavioral signals (analysis, fires inside submit) | `submit/route.ts:466–475` | `OPENAI_GEN_MODEL`, **temp 0.3**, `max_tokens 300`, `response_format:{type:'json_object'}` | `LEARNING_STYLE_SYSTEM` (652–656) + `learningStylePrompt()` (657–684) | `{ learning_style, confidence }`; normalized via `normalizeLearningStyle` (submit:483) | folds into `lib/engine/assignmentGen.ts` (feeds the band×style profile) | GPT-only; null → `{learning_style:'emerging',confidence:0}` (submit:477) |
| 5b | **Insights** — narrative insight rollup (analysis, fires inside submit) | `submit/route.ts:1197–1213` | `OPENAI_GEN_MODEL`, **temp 0.4**, `max_tokens 1000`, `response_format:{type:'json_object'}` | `INSIGHT_SYSTEM` (1062–1065) + `insightPrompt()` (1066+) | `{ insights:[] }` → `insights` table | not on the eval critical path; lib-ify alongside grading | GPT-only; null → `{insights:[]}` (submit:1215) |

- **Lesson plan.** One sentence or one upload in → CORE writes the full plan, passage, objectives, key concepts. **Review, edit, publish** (the teacher is in the loop). Lift call #1.
- **Quiz: 3 MCQ + 2 OEQ.** MCQs read comprehension fast; the **2 OEQs are the engine** (reasoning, critical thinking, and the *specific misconception*). AI-graded with a rubric, eval-gated from day one. Lift call #2 (`generateQuizForLesson.ts` + prompt 297–512).
- **Grade-anchored difficulty (§4a — hard constraint).** Questions generated to the student's **grade level** — a Grade 6 and Grade 12 item on the same skill differ in difficulty. Lift V1's Bloom-to-grade calibration (`prompts.ts:367–372`). Surface a **grade selector, not a difficulty slider**.
- **Adaptive Q4–Q5 (§4b).** Within-attempt reshape (Q1–Q3 MCQ % → Q4–Q5: **0–50 scaffolded / 50–79 grade / 80+ advanced**); lift call #3. The thresholds are **not** re-hardcoded in `adapt/route.ts` — they derive from `computeMasteryBand` (adapt:61), so the band vocabulary stays single-sourced. **SCOPE divergence — flagged (see Residual Open Questions):** SCOPE §4b frames reshape as *sequenced* ("cold-start is a fixed 3 MCQ + 2 OEQ at grade level; once CORE has enough history, Q4–Q5 reshape"), but V1's actual behavior (confirmed in `v1-mining-findings.md` item 4) is *always-on within-attempt* reshape off Q1–Q3. P1 ships V1's always-on behavior (it is the proven, calibration-locked path) and flags the divergence for a SCOPE call; if history-gating is retained, "enough history" must be defined.
- **OEQ grading (the highest-stakes path).** Lift `GRADING_SYSTEM`/`gradingPrompt` (521–648) **text** verbatim. **This is not a verbatim file copy:** submit/route.ts makes the 5 calls above; the grading call alone fires **once per OEQ concurrently** (`Promise.all`, submit:242–255) at temp 0.2 against `CLAUDE_GRADING_MODEL` through `claudeChat` (which today defaults to Claude Sonnet 4.6 per V1 `lib/ai/models.ts`). Scored **0 / 0.5 / 1.0**. Claude primary → GPT fallback. **If ANY of the concurrent grading calls returns null/throws, the whole submit short-circuits** to `grading_status:'pending'` + `grading_failed:true` and returns a "grading delayed" payload (submit:261–273) — **V1 never half-grades**; this is the seed of the §3.5 terminal-failure contract.
- **Grading request-shape rebuild (the real work, not a copy — §1.3).** V1's `claudeChat` builds a Messages request with `temperature` (submit passes 0.2), `max_tokens`, and a `JSON.parse(raw)`-with-fallback contract (submit:281 supplies a full default object on parse fail). If the §1.3 registry selects an **Opus 4.x** grader, **every Claude call must be re-shaped**: drop `temperature`/`top_p`/`top_k` (they 400 on 4.6/4.7/4.8), move to `output_config.format` structured output, remove last-assistant-turn prefills, set `thinking:{type:'adaptive'}` + `output_config:{effort:'high'}`, and handle `stop_reason:'refusal'` *before* reading `content[0]`. The prompt **text** ports verbatim; the request **shape** is rebuilt. Parse with `JSON.parse`, never raw-string match.
- **Week-1 spike (mandatory, §10.5).** Run the chosen grader against 5–10 hand-graded OEQs *before* committing M1 to it — if Opus structured output shifts the grade distribution vs V1's temp-0.2 Claude Sonnet, the calibration-locked corpus premise weakens. Decide Opus-vs-keep-Sonnet/GPT on day 3, not at soak. The registry pattern (§1.3) keeps the pick a one-line env change either way.

### 3.2 CL, Learning Strategies, and the misconception taxonomy

- **CL = Reinforce / On Track / Enrich (§4c) — a verb mapping over the existing per-skill state.** The per-skill model already exists: `skill_learning_state` (migration `072_skill_learning_state.sql`), per `(student_id, skill_id)` (`UNIQUE (student_id, skill_id)`, migration:40), computed by `lib/skills/computeSkillState.ts::computeSkillState(input: SkillStateInput): SkillStateResult` (072 is a **LIFT**, not net-new). The genuine net-new is the **CL verb mapping**: the 3 teacher verbs are a display layer over the **6 real `state` enum values** (the CHECK constraint, migration `072:27–34` / `71–78`; mirrored as the `SkillLearningState` union, `computeSkillState.ts:31–37`):

  | `skill_learning_state.state` (V1, exact) | CL verb (P1 display) |
  |---|---|
  | `needs_different_instruction` | **Reinforce** |
  | `needs_more_time` | **Reinforce** |
  | `on_track` | **On Track** |
  | `ready_to_extend` | **Enrich** |
  | `insufficient_data` | **"Not yet assessed"** (cold-start; null CL, never a fabricated verb) |
  | `not_attempted` | **"Not yet assessed"** (cold-start; null CL) |

  - `ready_to_extend` was added *after* the original 5-state 072 shipped to prod; the migration's idempotent `DROP CONSTRAINT … ADD CONSTRAINT` (072:68–78) is what makes the 6-state version re-runnable — P1 consolidates the **6-state** version. `insufficient_data` is a documented first-class anti-noise guard: **never assert a verdict on < 3 graded observations, and never score non-submission as "can't"** (072:17–19).
  - This mapping is the **Barb delta** (ratify it), **not** the per-skill existence. Whether to surface `confidence` (0–100, rendered as soft words only, 072:35), `observation_count` (072:36), and `last_reteach_outcome` (072:38) or keep them internal-only is a Barb call (Residual Open Questions). The cold-start "Not yet assessed" UI state is genuinely net-new and must be designed for One Student (§5.1b) and rendered by the `CLBadge` component (§9.4).
  - **Do not compute per-skill CL via `computeMasteryBand`** — that ≤50/51–79/≥80 rolling-avg-of-5 instrument (`lib/utils/scoring.ts`) is the *per-student quiz band*, a different instrument (§4 note). Per-skill CL comes from `skill_learning_state` only. Recompute triggers (072:11): **on quiz grade, homework grade, and reteach completion** — wire these as the same events that fire skill-tagged attempt writes (§2.1/§2.4).
- **CL drives generation:** Reinforce → scaffolded work + more Super TELI. On Track → grade-level. Enrich → Spark / stretch + Socratic-only Super TELI. (The generation-side scaffold lever is the `SCAFFOLD_INSTRUCTIONS[level]` block appended to `ASSIGNMENT_SYSTEM`, submit:748–752.)
- **Learning Strategies (12) detection.** Quiz *seeds* LS weakly; **behavior signals confirm over time** (observation supersedes; never a day-one verdict). LS/Learner Profile stay cross-cutting + per-class (`student_model`, migration 029, §2.4), **not** per-skill. The 12 names + prescription rule (`INTELIFLOW_STRATEGIES` at `prompts.ts:15–218`, `getStrategiesForStudent(band, style)`) lift verbatim (§8.1).
- **Misconception taxonomy (§6b — formalize the existing enums, Barb-ratified).** Not greenfield. V1 already emits, inside the grading JSON contract (`prompts.ts:589–593`), a **closed 8-value `error_type`** and a **closed 6-value `reasoning_pattern`** that P1 promotes to a first-class taxonomy table:
  - **`error_type` (8 values, exact, `prompts.ts:589`):** `none | factual_error | reasoning_gap | incomplete | misunderstood_question | vocabulary_confusion | off_topic | blank`. Rule: `error_type` uses `none` **only when score is 1.0** (`prompts.ts:604`).
  - **`reasoning_pattern` (6 values, exact, `prompts.ts:590`, definitions at 606–612):** `surface_recall | partial_reasoning | full_reasoning | misconception | creative_extension | blank_or_off_topic`. Note the literal **`misconception`** value already exists — the taxonomy is ~60% built, not invented. The grading prompt **must never return `none`** for `reasoning_pattern` unless blank/off-topic (use `blank_or_off_topic`), and submit synthesizes one from score when the LLM omits it (submit:285–287).
  - **Plus** `misinterpretation_detected: true|false` and `vocabulary_difficulty: none|low|medium|high` (`prompts.ts:591–592`).
  - **The recurring-error matcher already exists:** `lib/reports/diagnosis.ts::findRecurringError(errorTypes)` (diagnosis:61–74), gated by `RECURRING_ERROR_THRESHOLD = 3` (diagnosis:53) — filters out `none`/`''`, returns the most-frequent `error_type` recurring **≥ 3 times**, and drives the `check_concepts` suggested action (`grade_level + recurring error type → check_concepts`, diagnosis:84/117–122).
  - **P1's work, three parts:** **(a)** formalize the 8 `error_type` + 6 `reasoning_pattern` enums into a first-class taxonomy table (Barb ratifies/extends the vocabulary — the decision shrinks from "invent a taxonomy" to "ratify these 8 + 6"); **(b)** key `findRecurringError` to `skill_learning_state` so a misconception is **per-skill**, not per-student-flat (it currently counts a flat `error_types[]` array); **(c)** surface it on One Student (§5.1b). **Until Barb signs off**, the surface uses the raw (already-structured) `error_type`/`reasoning_pattern` values directly — the fallback is **structured, not freetext.**

### 3.3 Media-rich outputs (detail in §6)

Every passage, question, and hint can be read aloud; students can speak back; assignments include generated illustrations and diagrams. Media generation defaults-on (TTS/Whisper/Flux/diagrams all tiers; Runway video Pro+). Metering is owned by §6.

- **Per-task modality descriptor (net-new abstraction — replaces the ad-hoc `isReadingTask` boolean).** The engine emits an `affordances` descriptor on each generated task (e.g. `{read_aloud, voice_in, text_in}`). Both the client (hide the mic) and the server guard (**422** on `transcribe`/`teli-voice` when `voice_in` is disallowed, §6.7) read this **one descriptor** rather than re-deriving "is this a reading task." This single field enforces "voice only on non-reading tasks" (§6.7, SCOPE §5c) *and* every future modality rule (no read-aloud of an answer field, no voice on math-symbol entry) without a new bespoke flag each time. There is no task-modality concept in V1 — `v1-mining-findings.md` item 5 confirms voice-on-non-reading is "implied via assignment modality, not enforced in code" — so this is built once, correctly, in the engine. The descriptor is written by the quiz-gen / assignment-gen steps (calls #2/#5) so it travels with the persisted task.
- **Persist Flux media immediately (build requirement, not an open risk).** Flux URLs expire in ~10 min (V1 uses `flux-pro-1.1` via `lib/flux/client.ts`, degrades to Mermaid/Excalidraw with no key — `v1-mining-findings.md` item 5); LIFT V1's `persistImage` so any generated illustration/diagram is persisted to storage on generation. A stale/expired media URL at render is a correctness bug for a loop product (mirrors the §7.4 snapshot-invalidation rule).

### 3.4 Lib/route split (mandatory for the eval rig — M1 deliverable)

Each AI path is a **pure, import-safe `lib/engine/` function** (no `next/server`, no `cookies()`, no SDK side-effects at import) that the route handler **and** the eval runner both import. This is the single biggest refactor of the V1 lift, because V1 buries calls #4/#5/#5a/#5b *inside* the 1,449-line `submit/route.ts` handler — they cannot be invoked headless today. Build the engine **lib-first, not route-first**:

- Targets: `lib/engine/{lessonParse,quizGen,adapt,grading,assignmentGen}.ts` (calls #1–#5; learning-style #5a folds into `assignmentGen`, insights #5b lib-ifies alongside).
- Each function takes plain data in, returns parsed/validated data out; the route handler does auth + DB + metering around it; the eval runner calls the same function directly.
- This closes the §11.3 / §1.11 gotcha (the eval rig can only wire `invokeCandidate` against import-safe functions) — make "engine exposes headless entry points" an explicit **M1 deliverable**, not an M7 discovery. It is also the precondition for §3.6: the same functions **are** the WDK step bodies, so the eval rig and the durable workflow share one entry point.

### 3.5 Error contract (net subsection — every route family)

Beyond licensing's status codes (§6.3/§6.4), the engine and integration routes define explicit error behavior via a **standard error envelope** `{ error: {code, message, retryable, userMessage} }`:

- **Terminal LLM failure** (primary+fallback exhausted): the §1.4 wrapper raises a typed `LlmExhaustedError`; route returns `503` + `retryable:true` + a "try again" `userMessage`; grading **never returns a fabricated or partial score**. This generalizes V1's proven grading short-circuit (submit:261–273: any failed OEQ grade → `grading_status:'pending'`, `grading_failed:true`, "grading delayed" payload). The attempt stays ungraded and **re-queueable**.
- **`stop_reason:"refusal"`** (Opus 4.x path, §1.3/§3.1): handled **before** reading `content[0]`; surfaces as a neutral "couldn't process this response" to the teacher, logged for review — never a crash.
- **JSON-parse / Zod-validation failure** on structured output: treated as a terminal failure for that call (503), logged with the **raw output** for debugging; no partial persistence. (V1's `JSON.parse(raw || '{…default…}')` defaulting at submit:281 is replaced by fail-to-503, not silent-default, on the graded path — a silent default would poison the calibration-locked grade distribution.)
- **Partial generation** (e.g. quiz gen #2 produced 3 MCQ but OEQ gen failed): the whole quiz generation rolls back; nothing half-generated is published. Teacher sees a retry. (The adapt call #3 is the documented exception — it *intentionally* degrades to original Q4/Q5 rather than failing, adapt:151–161, because a missing adaptation must not block the attempt.)
- **Spark sync-handoff timeout (35s, §7.4):** **soft-degrade** — the assignment remains usable; the Launch button shows "challenge generating, check back" and `spark_sync_failed` gates it; never a hard error that blocks the assignment.
- **Fail-open metering meets fail-closed licensing (both DB + Redis down):** licensing **fail-closed wins** — `enforceActiveLicense` blocks the write (security/compliance over availability); media metering's fail-open (`checkUsageCap` on DB error, §6.7) is moot because the gated write never reaches the metered provider call. Document this precedence so the two policies don't contradict at runtime.

### 3.6 Durable execution — Vercel Workflow DevKit (generation pipeline)

> Architecture decision (SCOPE §4e): the **background** generation pipeline runs on the Vercel Workflow DevKit. WDK adoption is scoped to **this pipeline + the §7.4 Spark round-trip only** — not Super TELI, crons, or media polling.

- **Shape.** A `"use workflow"` orchestrator drives the pipeline; **each AI call is a retryable `"use step"`** (lesson parse #1, quiz gen #2, adapt #3, OEQ grading #4, assignment gen #5 — see the §3.1 table). The §3.4 `lib/engine/*` functions **are** the step bodies, so the eval rig and the workflow share one import-safe entry point. The grading step wraps the concurrent per-OEQ fan-out (submit:242–255) as one durable unit so a partial-grade failure replays the whole grade, preserving V1's "never half-grade" invariant.
- **Why.** Automatic retry (with the §1.4 Claude→GPT fallback *inside* the step), results **persisted for replay** — a mid-pipeline model failure resumes from the last completed step (e.g. lesson parse + quiz gen succeeded, grading failed → replay grading only, not the lesson), not from scratch — and crash-safety on Vercel Fluid Compute. Map the §3.5 error contract onto WDK errors: **`FatalError`** (refusals, 4xx, JSON-parse/Zod failures → no retry) vs **`RetryableError`** (429/5xx/timeouts → backoff). This subsumes V1's hand-rolled per-step null-checking and the 120s-then-fallback timeout dance (submit:846–880).
- **Boundary (critical).** The teacher's interactive "create a differentiated assignment in <5 min" hero path (§16d, §5.1c) **stays synchronous/streaming** for the snappy feel. WDK governs durable/background generation and any regeneration — *not* the live request. If a create action is heavy, kick off the workflow and stream/poll its result; don't make the teacher wait on a durable run. (Super TELI is explicitly **not** on WDK per SCOPE §4d — it is a normal implementation.)
- **Constraints.** Step inputs/outputs must be serializable (no class instances/functions — pass data, not callbacks); keep secrets/Node APIs (the SDK clients, the Supabase admin client) **inside** steps, orchestration logic in the workflow. Read `node_modules/workflow/docs/` once the `workflow` package is added (it is **not** in the current scaffold — adding it is an M-stage task). See the `vercel:workflow` skill for the `"use workflow"`/`"use step"` patterns.

---

## 4. Signals → Actions

> Scope refs: SCOPE.md §6 (signal set + gap=20), §3 (the loop). LIFT V1 formulas/thresholds. A signal reaches the screen **only if** it passes the 5-second test *and* resolves to a plain-language action; everything else lives one tap down. **8-signal set locked; gap threshold = 20.** Signals re-key onto the §2.4 granularity hierarchy in M2. Every threshold below is a **real V1 constant** — cited with its file and the variable name to lift — so M2 ports values, not vibes. The noisy heuristics are flagged for pilot recalibration at the end of this section.

**Locked invariants this section preserves verbatim (do not re-derive):**
- **Gap threshold = 20.** `divergence_score ≥ 20` fires the Assignment-vs-Quiz signal; alignment band is `±10` (`ALIGNMENT_THRESHOLD = 10`, `lib/signals/computeHwQuizDivergence.ts:29`).
- **Two different instruments, never conflated.** `computeMasteryBand` (≤50/51–79/≥80, mean of last 5 quizzes) is the **per-student quiz-band instrument**. It is **not** per-skill CL. Per-skill CL comes from `skill_learning_state` / `computeSkillState.ts` (the 6-state model, §2.4/§3.2). Do not compute per-skill CL via `computeMasteryBand`.
- **Risk Index = the weighted ensemble** `frustration .30 / attention .20 / velocity .20 / error .15 / confidence .10 / engagement .05` — a Pro feature. **Source correction:** this ensemble lives in `computeRisk()` inside `lib/signals/signalComputer.ts:310–367`, **not** in `lib/signals/computeRiskIndex.ts` (see the Risk Index entry — V1 has two distinct risk computations and the spec draft pointed at the wrong one).
- **"Observation supersedes."** Comprehension is readable from a quiz; a *strategy* is behavioral and accrues — never a day-one verdict. This is encoded as the credibility rule at the end of this section.

### The 8-signal set (locked)

| Signal | Source (lift) | Who | Action it triggers |
|--------|---------------|-----|--------------------|
| **Comprehension Level (per skill)** | `lib/skills/computeSkillState.ts` (`skill_learning_state.state`) → CL verb mapping (§3.2) | Teacher | Reinforce / leave on track / enrich |
| **Assignment-vs-Quiz gap** | `lib/signals/computeHwQuizDivergence.ts` (`divergence_score ≥ 20`; alignment `±10`) | Teacher | Review submissions — integrity, format, or anxiety |
| **Effort vs ability** (4 labels) | `lib/signals/computeEffortLabel.ts` (`SUCCESS_THRESHOLD=75`, `EFFORT_THRESHOLD=2`) | Teacher | Reteach the concept, or just check in |
| **Direction (sliding / climbing)** | `lib/studentModel.ts:259–277` (consistency) + `lib/signals/signalComputer.ts` (velocity) | Teacher + Student | Watch & check in / celebrate the climb |
| **Did-the-intervention-work (mastery moved?)** | `lib/signals/computeReteachEffectiveness.ts` + mastery-regression alert (`lib/studentModel.ts:326–353`) | Teacher | Confirm complete, or escalate — **the loop closer, in-pilot** |
| **The specific misconception (from OEQs)** | `error_type`/`reasoning_pattern` enums (`lib/openai/prompts.ts:589–592`) + `findRecurringError` (`lib/reports/diagnosis.ts:61`), keyed to skill (§3.2) | Teacher | Targeted practice on that exact thing |
| **Personal growth over time** | snapshots / `band_history` + `consistency_label` (`lib/studentModel.ts`, snapshot cron §1.8) | Student | "You're getting better at X" (**vs own past, never peers**) |
| **One next step, plain words** | `lib/briefing/regenerateSignalWhy.ts` + `lib/signals/diagnosis.ts::diagnose` (cache: migration 041) | Student | Do this one thing |

The eight rows are the **8-signal set locked** in SCOPE §6. Each is detailed below with its exact source, formula, thresholds, inputs, cold-start behavior, edge cases, surfacing screen, and the plain-language action it produces.

---

### 4.1 Comprehension Level (per skill) — the headline signal

- **Source.** `lib/skills/computeSkillState.ts::computeSkillState` (pure, import-safe — Bug #27 sibling-pure-file pattern; no DB/AI imports). Persisted to `skill_learning_state` (migration 072): `state text CHECK IN (…6 values…)`, `confidence numeric 0–100`, `observation_count int`, `evidence jsonb {drivers[], metrics{}}`, `last_reteach_outcome text`, `UNIQUE(student_id, skill_id)`. Recompute orchestration: `lib/skills/recomputeSkillStates.ts`.
- **Formula (state machine, first matching gate wins, in this order).** `not_attempted` → `insufficient_data` (anti-noise) → engagement guard → `ready_to_extend` → `on_track` → `needs_different_instruction` (the heavy claim) → `needs_more_time` → ambiguous-middle default (`needs_more_time` @ confidence 25). It fuses four observation streams — cold quiz accuracy, scaffolded homework grade, session error-pattern type, and (Pro+) SPARK transfer score — over a single skill.
- **Thresholds (all in `SKILL_STATE_WEIGHTS`, `computeSkillState.ts:118–203` — pilot-tunable in one place):**
  - `MIN_OBSERVATIONS = 3` (never a verdict below 3 graded observations)
  - `ON_TRACK_COLD_ACCURACY = 0.8` (mirrors the locked ≥80 band boundary)
  - `EXTEND_COLD_ACCURACY = 0.95`, `EXTEND_MIN_COLD_OBSERVATIONS = 4`
  - `COLD_FLOOR = 0.5`, `IMPROVING_DELTA = 0.15`
  - `CONCEPTUAL_DOMINANCE = 0.5`, `SLIP_DOMINANCE = 0.5`
  - `DIVERGENCE_GAP_PTS = 25` (scaffold-vs-cold gap that signals scaffold dependence), `STRUGGLING_SHARE = 0.4`
  - `NON_SUBMISSION_SHARE = 0.5` (engagement-gap floor), `NDI_MIN_OBSERVATIONS = 4`
  - SPARK transfer: `SPARK_STRONG_TRANSFER = 70`, `SPARK_WEAK_TRANSFER = 50`, `SPARK_TREND_DELTA = 15`
  - Confidence assembly: `CONFIDENCE_PER_OBSERVATION = 8` (cap 40), `CONFIDENCE_PER_DRIVER = 15`, `CONFIDENCE_RETEACH_BONUS = 15`, `CONFIDENCE_CAP = 95` (never claim certainty).
- **Inputs.** `SkillStateInput`: cold quiz correctness per question on the skill (`quiz[]`); scaffolded homework `{gradePct, submitted, effortLabel}` (`homework[]`); session-level `error_pattern_type` history (`sessionErrorPatterns[]`); the most recent reteach event `{type: 'more_practice'|'different_approach', completedAt}`; Pro+ `spark[]` `{transferScore, contentQuality, completed}`. Skills are resolved via `lib/skills/resolveSkills.ts` against `skills_registry` (migration 071), so each attempt must be skill-tagged from M1/M2 (§2.1/§2.4) or this signal has no input.
- **CL verb mapping (the Barb delta, §3.2).** The teacher never sees the 6 internal states; they see 3 verbs: `needs_different_instruction`/`needs_more_time` → **Reinforce**, `on_track` → **On Track**, `ready_to_extend` → **Enrich**, `insufficient_data`/`not_attempted` → **"Not yet assessed"** (null CL, never a fabricated verb).
- **Cold-start.** `not_attempted` (zero contact with the skill) and `insufficient_data` (< 3 graded observations, or a non-submission-dominant signature) are **first-class states in the CHECK constraint**, not fabricated. Both map to "Not yet assessed." `confidence` ramps with observation count (`obs × 10`, capped at 30 during cold-start). This is the genuinely net-new UI state One Student (§5.1b) must render.
- **Edge cases (already handled in V1, preserve):** (a) **"didn't do it" ≠ "can't do it"** — the engagement guard (`NON_SUBMISSION_SHARE ≥ 0.5` with thin cold evidence) routes to `insufficient_data`, never to a conceptual verdict; (b) `ready_to_extend` is **informational only** — it never auto-promotes a band or auto-generates harder work (no success-streak escalation); it tells the teacher a skill *could* go deeper, the teacher decides; (c) SPARK transfer **never flips a state by itself** — strong transfer *suppresses* the scaffold-vs-cold driver and discounts confidence (`CONFIDENCE_SPARK_DISCOUNT = 10`, floor `CONFIDENCE_FLOOR = 10`); weak transfer can only *strengthen* an already-fired Reinforce read, never initiate one; `non_engaged`/`minimal` SPARK completions are excluded as evidence entirely.
- **Screen.** Teacher → One Student (§5.1b), shown **per skill** with the soft-word confidence (never the raw number) and the `evidence.drivers` feeding the plain "why."
- **Plain-language action.** Reinforce → "Reteach this skill / assign targeted practice." On Track → "Leave on track." Enrich → "This skill could go deeper — assign a stretch / Spark." Not yet assessed → no action (suppressed from the triage ranking; never a fabricated nudge).

### 4.2 Assignment-vs-Quiz gap — gap = 20 (locked)

- **Source.** `lib/signals/computeHwQuizDivergence.ts::computeHwQuizDivergence` (pure). Emits `{divergence_score (0–100), divergence_direction ('hw_higher'|'quiz_higher'|'aligned'), divergence_trend ('widening'|'narrowing'|'stable'|null), hw_avg, quiz_avg}`.
- **Formula.** `gap = hw_avg − quiz_avg`. If `|gap| ≤ ALIGNMENT_THRESHOLD (10)` → `aligned`. Otherwise `divergence_score = round(min(100, |gap| / 50 × 100))`, direction by sign. **Trend** splits each series into chronological thirds and compares first-half vs second-half gap magnitude (`stable` if the change < 3 pts).
- **Thresholds.** `ALIGNMENT_THRESHOLD = 10` (line 29); the **locked gap threshold = 20** is the *surfacing/gating* value — a `divergence_score ≥ 20` is what reaches the teacher (consistent with SCOPE §6 "gap = 20"). **Divergence note (carry, do not silently differ):** the live diagnosis surface `lib/signals/diagnosis.ts` uses `DIVERGENCE_THRESHOLD = 25` (line 57) to *escalate* a gap to a sev-2 action ("possible inconsistency" / "knowledge not transferring"). So `20` is the locked "show it" floor; `25` is V1's "act on it loudly" floor. P1 ships gap=20 as the locked surfacing threshold (SCOPE §6) and keeps the 25-pt escalation as a sub-tier; flag any desire to collapse them as a SCOPE call.
- **Inputs.** `homeworkScores[]` and `quizScores[]`, both 0–100, newest-first (DB `ORDER BY … DESC`). The function reverses internally for trend.
- **Cold-start.** Returns `aligned`, `divergence_score = 0` until `MIN_HW_SAMPLES = 2` graded homework **and** `MIN_QUIZ_SAMPLES = 1` graded quiz exist (lines 27–28). `hw_avg`/`quiz_avg` are still surfaced (or null) so the UI can say "not enough yet" rather than "aligned."
- **Edge cases.** `aligned` with high absolute scores ≠ a problem; `aligned` with two low scores is the "major gap" pattern (handled by `diagnosis.ts` pattern 2, sev 3, → reteach). `quiz_higher` ≥ 25 → "verbal check" (possible inconsistency / integrity / format); `hw_higher` ≥ 25 → "practice" (knowledge isn't transferring under assessment).
- **Screen.** Teacher → Today (the ranked "why") and One Student.
- **Plain-language action.** "Review submissions — integrity, format, or anxiety." The direction picks the verb: `hw_higher` → look for transfer/anxiety on the assessment; `quiz_higher` → look at the homework's integrity/format.

### 4.3 Effort vs ability — the 4 labels

- **Source.** `lib/signals/computeEffortLabel.ts::computeEffortLabel` (pure; the single classification rule — never duplicate). Persisted on `homework_attempts.effort_label` (migration 043; CHECK constraint kept aligned with `EFFORT_LABELS`).
- **Formula.** `isSuccess = score ≥ SUCCESS_THRESHOLD`; `isEffortful = hints ≥ EFFORT_THRESHOLD`. The 2×2: `effortful_success`, `struggling_trying`, `independent_success`, `independent_struggle`.
- **Thresholds.** `SUCCESS_THRESHOLD = 75` (line 49 — 70 rejected as too generous, 80 as too strict for the middle band), `EFFORT_THRESHOLD = 2` (hint count). Both are documented as **Barb-review-pending** in the file header — adjust in `computeEffortLabel.ts`, not at call sites.
- **Inputs.** `{score: 0–100|null, teliHintCount: number|null}` per homework attempt (null hints treated as 0).
- **Cold-start.** Returns **null** when `score` is unavailable (ungraded attempt) — callers must skip the derived signal or wait for grading; the label is never fabricated on an ungraded row.
- **Edge cases / noise.** `EFFORT_THRESHOLD` (hint count) is explicitly flagged as a **noisy proxy** in the source: a student who asks one substantial question looks "independent," and a button-masher looks "effortful." The file's own TODO is to blend hint count with `articulation_used` + `self_unblock_flag` once those are first-class — **a pilot-recalibration target** (see §4.9).
- **Screen.** Teacher → Today/One Student. Feeds the per-skill state's `STRUGGLING_SHARE` / `independent_success_share` drivers (§4.1).
- **Plain-language action.** `struggling_trying`/`independent_struggle` → "Reteach the concept." `effortful_success` → "Check in — they got there but it cost them." `independent_success` → no action (suppressed).

### 4.4 Direction (sliding / climbing) — trajectory, not a snapshot

- **Source.** Two pieces: **consistency** from `lib/studentModel.ts:259–277` (computed on submit) and **velocity** from `lib/signals/signalComputer.ts::computeVelocity`. Trajectory history persists to weekly snapshots (migration 046, written by the §1.8 snapshot cron) and to `student_model.band_history` / `consistency_label`.
- **Formula.** Consistency = std-dev of the last 5 `quiz_attempts.score_pct`, mapped to `consistency_score`: `stdDev ≤ 5 → 95+`, `≤ 15 → 70+`, `≤ 25 → 40+`, else `< 40`; label `consistent` (≥70) / `variable` (≥40) / `erratic` (<40). Velocity = correct-answers-per-minute with a first-half-vs-second-half pace delta; `> +20% → accelerating`, `< −20% → decelerating`, else `stable`.
- **Thresholds.** Consistency std-dev bands `5 / 15 / 25`, label cuts `70 / 40`. Velocity trend `±0.2` (±20% pace delta). Trajectory direction off snapshots uses `computeTrend` (`signalComputer.ts:423`): needs ≥4 history points, compares last-3 vs prior-3 with a 10% delta threshold.
- **Inputs.** Last 5 quiz `score_pct` (consistency); within-session `QuestionAttemptData[]` timing (velocity); `risk_history`/`velocity_history`/`band_history` windows (EMA over `HISTORY_WINDOW = 10`).
- **Cold-start.** Consistency requires ≥3 quizzes (`scores.length >= 3`); below that it is unset. Trajectory direction returns `stable` until ≥4 history points exist. The "you vs 4 weeks ago" frame renders an **empty state until 4 weekly snapshots accrue** (§1.8/§5.1b/§5.2a) — for the whole early pilot this is the expected state, not a bug.
- **Edge cases.** A volatile student can show a single current band that hides swings — `bandIsVolatile` (`scoring.ts:70`, window 3) flags the ↕ marker without changing the canonical current-band read (`currentMasteryBand`, most-recent-quiz-wins). Velocity is *within-session* pace, not cross-session growth — keep them distinct in copy.
- **Screen.** Teacher → One Student (trajectory) **and** Student → Home ("You vs 4 weeks ago," never peers; SCOPE §16 leaderboard-off frame).
- **Plain-language action.** Teacher: sliding → "Watch & check in"; climbing → "Celebrate the climb." Student: the same direction in their own-past voice register.

### 4.5 Did-the-intervention-work (mastery moved?) — the loop closer

- **Source.** Two complementary mechanisms: **reteach effectiveness** `lib/signals/computeReteachEffectiveness.ts` (`detectCompletedReteachCycles` + `aggregateReteachStats`) and the **mastery-regression alert** in `lib/studentModel.ts:326–353`.
- **Formula.** A reteach *cycle* = a flagged attempt (`allow_redo = true`, has a score) + a later graded attempt on the same assignment; `improvement = post_score − pre_score` (can be negative). Aggregate `success_rate` = % of cycles with `improvement > 0`, split by `flagged_by ∈ {auto, teacher}`. Regression alert: map band to order `{reteach:0, grade_level:1, advanced:2}`; if `newOrder < oldOrder` **and** ≥3 quizzes exist, insert a `severity:'high'` row into `alerts` with `trigger_reason = 'mastery_regression'`. The per-skill counterpart is `last_reteach_outcome` on `skill_learning_state` (`more_practice_improved` / `more_practice_no_improvement` / `different_approach_improved` / `*_pending_cold_check`) — `more_practice_no_improvement` is *affirmative evidence* for a conceptual gap (it confirms practice alone isn't enough → Reinforce-by-different-approach).
- **Thresholds.** Regression requires a band drop **and** `qScores.length ≥ 3` (guards against a single bad quiz). Reteach outcome compares cold accuracy strictly before vs at/after `completedAt`.
- **Inputs.** `homework_attempts` rows (`allow_redo`, `is_redo`, `score`, `flagged_by`, timestamps); `reteach_cycles` ledger (dedupe via `original:redo` pair keys); the student's quiz band history.
- **Cold-start.** No completed cycle until a redo with a graded score exists; until then the intervention shows "in progress," not "no effect." Regression alert never fires before 3 quizzes.
- **Edge cases.** Negative `improvement` is a real, surfaced outcome (escalate, don't hide). A `*_pending_cold_check` reteach outcome means the redo hasn't met a cold quiz yet — render "waiting to confirm," not "worked." Multiple flagged attempts on one assignment are paired chronologically.
- **Screen.** Teacher → One Student (the Confirm half of Notice→Act→Confirm lives here, §5.1b). Mastery-regression alerts also surface on Today.
- **Plain-language action.** improvement > 0 → "Confirm complete." improvement ≤ 0 / regression → "Escalate — the intervention didn't move it."

### 4.6 The specific misconception (from OEQs) — formalize the existing enums

- **Source.** The grader (`GRADING_SYSTEM` / `gradingPrompt`, `lib/openai/prompts.ts:514–648`) emits structured cognitive fields per OEQ; the recurring-error matcher is `lib/reports/diagnosis.ts::findRecurringError` (and the class-level twin in `buildClassInsights`). Class-wide gaps come from `lib/signals/conceptGapDetector.ts`.
- **Formula / structured values (LOCKED enums, lift verbatim — `prompts.ts:589–592`):**
  - `error_type` (8-value): `none | factual_error | reasoning_gap | incomplete | misunderstood_question | vocabulary_confusion | off_topic | blank`
  - `reasoning_pattern` (6-value): `surface_recall | partial_reasoning | full_reasoning | misconception | creative_extension | blank_or_off_topic`
  - plus `misinterpretation_detected: bool` and `vocabulary_difficulty: none|low|medium|high`.
  - `findRecurringError`: most-frequent non-trivial `error_type` (drops `none`/empty) recurring `≥ RECURRING_ERROR_THRESHOLD = 3` (`diagnosis.ts:53`) → the `check_concepts` action.
  - `conceptGapDetector`: a quiz question wrong by `≥ 40%` of `≥ 5` students (`THRESHOLD_PCT = 40`, `MIN_STUDENTS = 5`) → a class-wide reteach topic.
- **Net-new work (§3.2, Barb-ratified — taxonomy, not invention):** (a) promote these enums into a first-class taxonomy table; (b) **key `findRecurringError` to `skill_learning_state`** so a recurring misconception is per-skill, not per-report; (c) surface it on One Student. Until Barb signs off, the surface uses the **raw structured `error_type`/`reasoning_pattern`** directly — the fallback is structured, not freetext.
- **Inputs.** Per-OEQ grader output stored on the quiz-attempt question rows (`cognitive_notes` is sensitive — FERPA cascade, §1.10); recent `error_type[]` per student/skill for the matcher.
- **Cold-start.** A single OEQ yields one `error_type`/`reasoning_pattern` but **no recurring misconception** until 3 like errors accrue; below that, show the single observation, never assert a pattern. `none`/`blank` never count as a misconception.
- **Edge cases.** Blank/idk/off-topic is forced to `error_type:"blank"`, `reasoning_pattern:"blank_or_off_topic"`, score 0.0 (no partial credit "for showing up") — exclude these from misconception ranking. `cognitive_notes` is observable-fact only ("the response did not include analysis"), never psychologizing — preserve this language rule when surfacing.
- **Screen.** Teacher → One Student (per skill) and Today (when recurring). Class-wide gaps surface to the teacher as a "10-minute review" suggestion.
- **Plain-language action.** "Targeted practice on that exact thing" (the named `error_type`/skill), e.g. "Recurring 'reasoning_gap' on fractions — assign practice on that."

### 4.7 Personal growth over time — the student's signal

- **Source.** Weekly snapshots (migration 046, §1.8 cron) + `band_history` / `consistency_label` on `student_model` (`lib/studentModel.ts`). Same trajectory machinery as §4.4, rendered in the **student** voice register (`lib/copy/effortLabels.ts`).
- **Formula.** Growth = a student's own band/score trajectory across weekly snapshots (the §4.4 `computeTrend` over their own history). **Never peer-relative** (SCOPE §16: leaderboard off by default; "You vs 4 weeks ago" is the frame).
- **Thresholds.** Inherits §4.4 (≥4 snapshots for a direction; 10% delta).
- **Inputs.** The student's own snapshot series + per-skill `ready_to_extend`/`on_track` transitions ("getting better at X").
- **Cold-start.** Empty state until 4 weekly snapshots exist — the student sees "we're just getting started," never a fabricated trend or a comparison.
- **Edge cases.** Phrase as observation, not judgment (SCOPE §15: "the student is not a data set"). No band/score numbers student-side; soft words only.
- **Screen.** Student → Home (§5.2a).
- **Plain-language action.** "You're getting better at X" + exactly **one** next-step card.

### 4.8 One next step, plain words — the "why" that resolves to an action

- **Source.** `lib/signals/diagnosis.ts::diagnose` (pure, first-match-wins pattern table → a one-line diagnosis + a single `SuggestedAction` + severity) and the LLM-polished copy in `lib/briefing/regenerateSignalWhy.ts` (cached on `student_model.signal_why_cache`, migration 041). The Today ranking uses `lib/briefing/tribes.ts::classifyStudent` (lift the pure classifier as-is).
- **Formula.** `diagnose` resolves each student's signal row to one of: `practice` / `reteach` / `verbal_check` / `profile`, severity 1–3, sorted severity-desc then `risk_score`-desc (`compareDiagnosed`). The "why" sentence is LLM-generated only for 3 signals (`learningRiskIndex`, `hwQuizDivergence`, `dominantEffortPattern`) and **drift-gated**: regenerate only when driver inputs shift `≥ DRIFT_THRESHOLD = 0.15` (15% normalized); otherwise reuse cache, and on any LLM failure fall back to the deterministic sentence (graceful degrade — never blocks the screen).
- **Thresholds (in `diagnosis.ts`, lines 57–60):** `DIVERGENCE_THRESHOLD = 25`, `LOW_HW_THRESHOLD = 50`, `OK_QUIZ_THRESHOLD = 60`, `LOW_QUIZ_THRESHOLD = 50`; plus `risk_level` catch-alls (`critical` → sev 3, `high` → sev 1).
- **Inputs.** The already-computed signal aggregates (risk, hw_avg, quiz_avg, divergence) — no DB/fetch inside the pure function; the caller passes loaded data.
- **Cold-start.** `diagnose` returns **null** when no priority pattern matches ("working fine — don't surface"); the cache returns the deterministic sentence until the LLM has run once. A student with no data is simply absent from the ranking, not shown as "fine."
- **Edge cases.** The cache is keyed per-signal with an input hash — stale "why" can't outlive a meaningful driver shift; the audit row on each regen makes the copy traceable for review.
- **Screen.** Student → Home (the one next step) and the plain "why" on Teacher → Today (§5.1a).
- **Plain-language action.** "Do this one thing" — exactly one card, no jargon, no acronyms.

### Risk Index (Pro feature) — the weighted ensemble

- **Source (corrected).** The locked ensemble lives in `computeRisk()` inside `lib/signals/signalComputer.ts:310–367`, fed by the per-session sub-signals also computed there (`computeFrustration`, `computeAttention`, `computeVelocity`, `computeErrorPattern`, `computeConfidence`, `computeEngagement`). **`lib/signals/computeRiskIndex.ts` is a *different*, roster-level risk** (weights `avgHwScore 25 / avgQuizScore 25 / completionRate 20 / scoreTrend 15 / redoRate 10 / recency 5`) producing `risk_score`/`risk_level`/`risk_factors`. P1 must not confuse the two: the **§6 / SCOPE Risk Index = the cognitive ensemble** in `signalComputer.ts`; the gradebook-style `computeRiskIndex.ts` is the at-a-glance roster risk the School Admin list can also use. Both ship; name them distinctly in code (`computeCognitiveRiskIndex` vs `computeRosterRiskIndex`) to end the ambiguity.
- **Weighted ensemble (LOCKED — `signalComputer.ts:323–363`):** `frustration .30` + `(1 − attention) .20` + `velocityRisk .20` (decelerating 0.8 / stable 0.3 / accelerating 0.05) + `(errorRisk × errorFrequency) .15` (conceptual 0.9 / procedural 0.6 / careless 0.4 / random 0.2) + `(1 − confidence.accuracy) .10` + `(1 − engagement) .05`. Output clamped to 0–1, then banded for the roster view (`0–24 low / 25–49 medium / 50–74 high / 75–100 critical`, per the sibling `computeRiskIndex.ts`). `risk_factors[]` carries the human-readable drivers ("Conceptual misunderstanding pattern", "Slowing learning pace", "Passive engagement").
- **Inputs.** Per-session `StudentEvent[]` (keypress/backspace/focus_loss/hint_request/pause/tts_play/canvas) + `QuestionAttemptData[]` (timing, correctness, change-count). EMA-blended across sessions via `updateStudentModel` (`HISTORY_WINDOW = 10`).
- **Gate.** `await checkFeature(schoolId, 'spark_experiences'?…)` → use the Pro feature flag (`requireFeature` server-side, `useLicenseGate` client-side, §6). Surfaced at school scale on the **School Admin** screen (§5.4); never to students/parents.
- **Cold-start.** Sub-signals self-guard: `errorPattern` returns `insufficient_data` below 3 attempts; `confidence` returns neutral 0.5 below 3; `attention` returns 1.0 under 5s sessions; trend helpers return `stable` below 4 history points. So a thin-data student reads "low/unknown risk," not a fabricated spike.
- **Noise warning (recalibrate from pilot — §4.9).** Frustration and attention are the two heaviest-weighted (.30 + .20 = half the index) and the two noisiest (keystroke/focus heuristics). Until recalibrated, consider **hiding the frustration/attention sub-drivers** at school scale and showing only the composite + the score-based roster risk.

### 4.9 The "observation supersedes" credibility rule (mandatory, applies to every signal)

V1's hard-won credibility lesson, encoded as a rule the surface obeys:

- **Comprehension is readable from a quiz; a *strategy* is behavioral and accrues.** Never claim a Learning Strategy or Learner-Profile trait from 5 answers (SCOPE §6, §15). The 12 Strategies / 5 Powers / Learner Profile stay **cross-cutting and per-class** (`student_model`, §2.4) and only assert once *behavior* has accrued them — never a day-one verdict, never from a single skill.
- **Mechanically enforced by the cold-start states.** `skill_learning_state` ships `insufficient_data` and `not_attempted` as first-class CHECK values; `computeMasteryBand` returns null below 1 quiz; `computeEffortLabel` returns null on ungraded; `diagnose` returns null when no pattern matches. Every consumer **must** handle null/"not yet assessed" rather than substitute a default — a fabricated band/strategy is the exact V1 trust failure CORE v2 is built to avoid (SCOPE §15: "observational, never diagnostic").
- **A heavier claim needs more evidence.** `needs_different_instruction` (the "this isn't working" claim) requires `NDI_MIN_OBSERVATIONS = 4`; `ready_to_extend` requires `EXTEND_MIN_COLD_OBSERVATIONS = 4` at `≥ 0.95` cold accuracy. Lighter reads (`needs_more_time`) fire earlier at floor confidence. Confidence is rendered as **soft words, never the 0–100 number**.

### 4.10 Heuristics flagged as noisy — recalibrate from pilot data

SCOPE §6 mandates recalibrating the noisier V1 heuristics; the specific knobs and their files:

| Heuristic | File / constant | Why noisy | Recalibration plan |
|---|---|---|---|
| **Frustration** | `signalComputer.ts::computeFrustration` (weight .30) | keystroke/backspace/focus proxies; .30 weight makes the whole Risk Index swing on it | re-fit indicator weights against pilot outcomes; hide sub-drivers until validated |
| **Attention** | `signalComputer.ts::computeAttention` (weight .20) | focus-loss + response-time variance; browser-tab heuristics are device/context-dependent | recalibrate `awayFraction`/variance penalties on real classroom traffic |
| **Effort (hint count)** | `computeEffortLabel.ts::EFFORT_THRESHOLD = 2` | hint count is a coarse effort proxy (one good question vs button-mashing) | blend with `articulation_used` + `self_unblock_flag` once first-class (file TODO) |
| **Confidence-from-speed** | `signalComputer.ts::computeConfidence` (weight .10) | speed→confidence is a loose proxy; calibration via speed↔correctness correlation | validate the correlation holds per grade band before trusting it |
| **Effort/success cuts** | `computeEffortLabel.ts::SUCCESS_THRESHOLD = 75` (Barb-pending) | the 75 cut is a pedagogy call, not yet Barb-ratified | confirm with Barb on pilot data (Stage D 50-attempt cold test) |

All threshold constants are centralized in their named modules (`SKILL_STATE_WEIGHTS`, `SUCCESS_THRESHOLD`/`EFFORT_THRESHOLD`, the `W` weights in `computeRiskIndex.ts`, `ALIGNMENT_THRESHOLD`) precisely so recalibration is a one-file edit per signal, not a code hunt — keep that discipline in v2 (change values in the constant block, never inline at call sites).

---

## 5. Roles & Screens

> Scope refs: SCOPE.md §2 (5 roles, full depth, one-job-per-role), §8 (locked screen set + onboarding), §3 (Notice→Act→Confirm), §16 (student-loud / adult-credible, leaderboard off), §18 (5-min time-to-first-value). Every screen obeys three hard rules:
> 1. **5-second test** — the one job resolves at a glance; everything else is one tap down.
> 2. **Plain-language rule** — no jargon on the surface. "Mastery" never "Band"; "differentiated" never "adaptive"; profiles are *observational, never diagnostic* (§15).
> 3. **Audience voice register** — copy pulled per role from `lib/copy/effortLabels.ts` (V1 ships student / parent / teacher registers; lift verbatim).
>
> **Lift the logic/data/signals; rebuild the skin (§13, §16 hard line).** V1's ~96 pages / ~229 routes **collapse** into the locked set below; screens not in the set fold into a tab or are cut for the pilot. Which V1 screens fold vs. cut needs a scope sign-off pass (Residual Open Questions) so a pilot teacher/admin doesn't lose a screen they expect.

### Role → one job → home route

| Role | The one thing they come for | v2 home route | Loop phase | V1 screen to mine |
|------|-----------------------------|---------------|-----------|-------------------|
| **Teacher** | "Who needs me today, and what do I do?" | `/teacher/today` | Notice → Act → Confirm | `teacher/briefing`, `teacher/students`, `teacher/lessons`, `teacher/dashboard` |
| **Student** | "Am I getting better, and what's my next step?" | `/student` | (does the work) | `student/me`, `student/homework`, `student/challenges` |
| **Parent** | "Is my child okay, in plain words?" | `/parent` | (receives narrative) | `parent/progress` |
| **School Admin** | "Are teachers/students actually being helped?" | `/admin` | (oversight) | `admin/analytics`, `admin/teachers`, `admin/alerts` |
| **Super Admin** | "Run the platform." | `/platform` | (operate) | `platform/schools`, `platform/licenses`, `platform/changelog` |
| **(first run)** | "Get to a real assignment in <5 min." | `/onboarding` | (setup) | `onboarding`, `teacher/onboarding`, `import` |

**Guardrail (§2):** "full depth" = the one job polished, not secondary features bolted on. **Note:** `school_sysadmin` (§1.2) shares the School Admin route group at pilot.

### 5.1 Teacher (4 screens)

**5.1a — Today (`/teacher/today`).** One job: 5-second triage — who needs me, ranked, why in plain words, one click to act. Mine `teacher/briefing/page.tsx` + the pure classifier `lib/briefing/tribes.ts` (`classifyStudent()`, lift as-is) + `lib/briefing/regenerateSignalWhy.ts` (cache: migration 041). Surfaces the ranked roster (name + dominant signal + plain "why"), fed by all §4 signals. **Primary action: one-click action per row** (verb chosen by the signal — concept-gap → "Assign targeted practice on X"; regression → "Confirm or escalate"). **This click logs to the teacher-action table (migration 040) and is success metric #1** (§18). Show only the top N; full roster + raw numbers one tap down.

**5.1b — One Student (`/teacher/students/[id]`).** One job: the student's *story* + the three things to do about it. **Confirm lives here** (§8). **Calls `guardStudentAccess` first (§1.4a) — IDOR target.** Mine `teacher/students/` + `lib/studentModel.ts` + `lib/admin/profileExport.ts` (`BAND_LABEL` — human Mastery labels; "Band" forbidden). Shows CL **per skill** (cold-start renders "Not yet assessed" — net-new state, §3.2), the gap, effort vs ability, **trajectory** ("you vs 4 weeks ago," never peers; empty-state before 4 weeks of snapshots exist), the **specific misconception**, and the did-the-intervention-work delta. Strategies/Powers shown **observationally only**, only when behavior accrued them (per-class, §2.4). **Primary action: three buttons — Reteach · Targeted practice · Check in — plus a Confirm/escalate control** on any open intervention.

**5.1c — Create (`/teacher/create`).** One job: one sentence (or upload) → a real lesson + quiz + differentiated assignment in hand in **<5 min** (§18 metric #2; §16 hero flow). Mine `teacher/lessons/` UI + the full engine (§3). Shows the generated plan/passage/objectives for **review + edit before publish**; previews 3 MCQ + 2 OEQ; grade selector not difficulty slider; **IEP/504-aware generation** when the student has IEP fields (migration 053). **Primary action: Publish & assign** (one-click to Google Classroom if GC-linked). Media generated by default (§6); video is Pro+ via `checkFeature`.

**5.1d — Classes (`/teacher/classes`).** One job: manage who is in which class + roster source. **`[classId]` routes call `guardClassAccess` (§1.4a).** Mine `teacher/class-settings/`, `teacher/import/`, `app/api/teacher/google/*`; fold `class-insights` into a read-only summary tab. Shows classes, student counts, roster source (GC-synced vs manual/demo), seat usage vs license (read-only echo of `school_licenses`). **Primary action: Sync / import roster.** Substitute mode (Pro) entry here, gated by `checkFeature` — see §5.8 for its token-auth model.

### 5.2 Student (3 screens — full pop-art energy, §16)

**5.2a — Home (`/student`).** One job: "You're getting better at X" + today's **one** next step. Mine `student/me/`, `student/progress/`. "You vs 4 weeks ago" frame; **leaderboard OFF by default** (keep XP/streaks/badges, opt-in only). Personal growth (own past, never peers); exactly **one** next-step card. **Primary action: Start today's work.**

**5.2b — Do-the-Work (`/student/homework/[id]`).** One job: complete the two-phase assignment (read, then tasks) with Super TELI alongside. **Super TELI is ~90% net-new:** the V1 base is only `teli-chat/route.ts` (177 lines) + `teli/prompts.ts` (66 lines) = ~243 lines with **no** persistent memory, **no** hint-ladder, **no** strategy-naming. The §4d bundle (persistent memory + 3-level hint ladder + Strategy naming + voice) builds *three features from scratch* on the Socratic base + voice (which leans on existing `tts`/`transcribe` routes). **Persistent memory needs a per-student tutor-state storage/retrieval design that touches the data model — design it before M6, not in week 9.** Read-aloud via `tts/route.ts`; speak-back via Whisper transcribe. **Primary action: Submit** (in-task: *Ask Super TELI* / *Read aloud* / *Speak your answer*). **Hard rule (§5b, code-enforced): voice-in only on non-reading tasks** — enforced by the per-task `affordances` descriptor (§3.3), server-authoritative, client mirrors.

**5.2c — Spark (`/student/spark`, Pro+ only).** One job: a single personalized enrichment challenge for Enrich-path students. **The challenge is SPARK-owned behind the typed contract** — do NOT rebuild it in CORE, and do NOT unify Super TELI with SPARK's in-runner tutor (§4d). CORE launches via `lib/spark/sendAssignmentToSpark` + an HS256 JWT redirect (§7). **Gates:** the authoritative grade-band gate (3–12) is **SPARK-side per SCOPE §10/§11**; CORE's commercial gate `checkFeature(schoolId, 'spark_experiences')` (Pro+) fires *before* the webhook. Any CORE-side grade check is a **UX pre-filter for the Launch button only** (feeding SPARK's canonical-grade normalization, §7.4), **not** the enforcement point — render Launch when the commercial gate passes and the UX pre-filter doesn't exclude. On return, SPARK's score + 7-dim signals flow back via `/api/attempts/spark-attempt-complete`; honor `content_quality` gating (gibberish ≠ "passed"). **Primary action: Launch Spark.**

### 5.3 Parent (`/parent`, one screen, adult-credible)

One job: "Is my child okay, in plain words?" A **narrative**, not a scores dump (§2, §6). Parent↔student access via `guardians` (§1.2) + `guardStudentAccess` parent branch. Mine `parent/progress/` + the parent voice register in `lib/copy/effortLabels.ts` (Mastery → Strong / Building / Needs-practice). Resend narrative templates in `lib/email/`, sent by the **weekly parent-narrative cron** (§1.8). Shows a plain-English weekly story — what they did, where they're growing, one thing to encourage at home. **No band/score language, no diagnostic claims** (§15). **Primary action: Read the weekly narrative** (opt into email summary). No drilldowns, no comparison to other children.

### 5.4 School Admin (`/admin`, adoption + Risk Index)

One job: "Are teachers and students actually being helped?" Adoption + risk, nothing operational. **`guardSchoolAdmin` (§1.4a).** Mine `admin/analytics/`, `admin/teachers/`, `admin/alerts/`; Risk Index math from §4 (Pro — gate with `checkFeature`). Shows **Adoption** (weekly logins, CORE-recommended actions taken, time-to-first-value — metrics #1/#2 at school scope) and **Risk Index** (ranked at-risk students, each resolving to "which teacher owns this / has anyone acted"). **Primary action: Nudge a teacher / open the at-risk roster.** Calm, credible information design — a clownish admin dashboard kills the sale (§16). **Scope guardrail:** longitudinal/cohort-benchmarking/custom-report screens are Enterprise (P2) — out of pilot.

### 5.5 Super Admin (`/platform`, operate the platform)

One job: run the platform — schools, licensing, maintenance mode, changelog. **`guardPlatformAdmin` (§1.4a).** Mine `platform/schools/`, `platform/licenses/`, `platform/changelog/`, `platform/monitoring/`. Licensing engine lifts as-is (§6). Four sub-areas (one job = "operate"): **Schools** (tenant list, tier, status, seats); **Licensing** (provision/activate keys — admin-provisioned, Stripe deferred; trial status; key expiry); **Maintenance** (toggle **true read-only** mode + banner — §6 hardening); **Changelog**. **Primary action: Provision a license / toggle maintenance.** The 4 hardening adds (§6) live here. **Scope guardrail:** `ai-logs`, `eval-corpus` (folds into the dev/eval rig), `pulse-mappings`, `tickets`, `leads`, `hugs-audit` are not in the locked pilot set.

### 5.6 First-run onboarding (`/onboarding`)

One job (a success metric, not a nicety, §18): teacher signs in → connects Google Classroom (or picks a pre-loaded demo class) → one sentence → **a real differentiated assignment in hand in <5 minutes**. The §16 hero flow. Mine `onboarding/page.tsx` + `teacher/onboarding/page.tsx` + `import/` + `app/api/teacher/google/*` + trial provisioning (§1.9). **Flow (4 steps, each one screen, defaults over settings):** (1) Connect GC *or* Use a demo class (the demo class loads exactly **8 demo students** — SCOPE §12b, seeded by `seedTrialDemoData`); (2) Roster import (auto from GC, or demo roster already present); (3) One sentence in → CORE generates first lesson + quiz + differentiated assignment (reuses Create's engine path); (4) First differentiated assignment in hand → hand off to Teacher: Today. **Every step is skippable to the demo path** so no external dependency (GC OAuth) can block first value (§9.7). **Primary action per step: Continue.**

- **30-minute implementation target (SCOPE §8/§16).** SCOPE references a "30-minute implementation" alongside the <5-min time-to-first-value, but the §18 locked scoreboard tracks only the <5-min metric. P1 resolves this explicitly: the **<5-min first-value metric is the measured acceptance test**; the "30-minute full implementation" (connect GC + import full roster + first real assignment across a real class) is the **non-measured guidance target** subsumed by the scoreboard, not a separate gate. Stated here so the SCOPE number doesn't silently vanish.

### 5.7 Cross-cutting build notes

- **Routing/layout:** one route group per role; role resolved post-auth via `users.role` (§1.2). Nest API routes under existing folders (§1.5).
- **Object-level authz:** every cross-user `[id]` route calls the matching guard (§1.4a) — not just the role-group guard.
- **Gating:** every Pro-only surface (Spark, Risk Index, video, substitute mode, cognitive signals) wraps the lifted central gate — server `requireFeature()` + client `useLicenseGate` (§6). No features move tiers.
- **Voice registers in code:** drive all user-facing signal copy through `lib/copy/effortLabels.ts` + `BAND_LABEL` so "Band"/"adaptive"/diagnostic phrasing can't leak (§15).
- **5-second test:** every screen surfaces **one** ranked answer + **one** primary action; raw data always one tap down.
- **Style split (§9/§16):** student screens full pop-art; teacher/parent/admin/platform same DNA dialed for credibility; WCAG AA on all.

### 5.8 Committed Pro/Essentials features beyond the core loop

SCOPE §10 (locked, adopted as-is) puts specific features in Pro/Essentials. Each is specified here or explicitly deferred-within-P1 with a SCOPE-divergence flag (per the spec's own "SCOPE wins — flag it" rule) — none are silently dropped:

- **Substitute mode (Pro).** V1 implements this as a **token-based flow** (`app/api/teacher/lessons/substitute-token`, `teacher/substitute/[token]`): a substitute is **not a logged-in role**, so it bypasses the 5-role route-group guard. P1 ships the token flow: a substitute accesses a scoped, time-limited token URL (no `users` row); the token authorizes a read-mostly view of that class's day. Entry point gated by `checkFeature` from Classes (§5.1d). The token path is the one place the role-group model is intentionally not the gate — documented so it isn't treated as a security hole.
- **Bulk grade approval (Pro):** a teacher review surface to approve pending AI grades in batch (lift V1's `pending-grading` route/UI). Lands on the Create/One Student flow.
- **Concept-gap alerts (Pro):** already a §4 signal surface (the misconception/CL signals on Today); not a separate screen.
- **PDF export (Essentials-and-up):** export an assignment/report to PDF. **Deferred-within-P1** if it is not on the loop critical path — flagged as a SCOPE-divergence to confirm (it is Essentials, and the pilot is Pro-only, so it is low-priority for the pilot cohort).
- **IEP/504-aware generation (Essentials):** wired into Create (§5.1c) via migration 053 fields + the accommodation prompt path; also an eval edge case (§11.6).

---

## 6. Licensing, Anti-Piracy, Trial & Media Metering

> Scope refs: SCOPE.md §12 (licensing + 4 hardening fixes), §10 (tier gate map, no features move tiers), §14 (defer Stripe; reuse service configs), §5 (media + caps + 2 new adds). **Reuse V1's licensing moat as-is + 4 hardening fixes. Trial = Pro, 30-day, no card, cloud self-serve. Defer Stripe.** Lift the media-metering architecture; add passage read-aloud and the per-task modality guard.

### 6.1 What to lift verbatim (modules + migrations)

| Concern | V1 file | v2 destination | Notes |
|---|---|---|---|
| HMAC single-use activation keys | `lib/licensing/keys.ts` | `src/lib/licensing/keys.ts` | `generateKey`/`verifyKey`/`computeExpiry`. Format `BRAND-TIER-YEAR-PAYLOAD-SIG`; Crockford base32; HMAC-SHA256 truncated to 6 chars; `constantTimeEqual`; secret `LICENSE_KEY_SECRET`. |
| Tier→feature gate map | `lib/licensing/tiers.ts` | `src/lib/licensing/tiers.ts` | `TIER_FEATURES` (the §10 map — **do not edit**), `tierIncludes`, `TIER_LIMITS`, `TIER_PRICING`, `FEATURE_LABELS`. |
| Server feature gate | `lib/licensing/checkFeature.ts` | `src/lib/licensing/checkFeature.ts` | `getSchoolLicense` (Redis 60s TTL + in-memory fallback), `checkFeature`, `requireFeature`, `invalidateLicenseCache`. block > override > trial > tier. Reads `school_licenses` (§2.3). |
| Client gate hook | `lib/licensing/useLicenseGate.ts` | `src/lib/licensing/useLicenseGate.ts` | mirrors server precedence; `platform_admin` bypass; reads `/api/teacher/admin/license`. |
| Write-path enforcement | `lib/licensing/enforce.ts` | `src/lib/licensing/enforce.ts` | `enforceActiveLicense(userId)` → 402/403/410; fail-closed on unknown status. Fix #2/#3 extend it. |
| Domain lock | `lib/licensing/domainCheck.ts` | `src/lib/licensing/domainCheck.ts` | empty `allowed_email_domains` = unrestricted (pilot default); parent/platform_admin exempt. |
| Soft seat warning | `lib/licensing/enrollmentCheck.ts` | `src/lib/licensing/enrollmentCheck.ts` | 90%/100% banners. Hard stop is the DB trigger. |
| Trial lifecycle (license-level) | `lib/licensing/trial.ts` | `src/lib/licensing/trial.ts` | `provisionTrial` (Pro, `trialing`, +30d, `student_limit=300`), `convertTrial`, `expireTrials`, `ensureSparkProvisioning`. Distinct from account-level `lib/trial/*` (§1.9, §2.3). |
| Media metering | `lib/licensing/usageCaps.ts` | `src/lib/licensing/usageCaps.ts` | `checkUsageCap`/`logCappedUsage`/`getCap`; `USAGE_CAPS`; counts `platform_events` by `source`. |
| Session/anomaly tracking | `lib/licensing/sessionTracking.ts` | `src/lib/licensing/sessionTracking.ts` | optional for pilot; lift the table now. |

**Migrations to consolidate** (per §1.7; `DROP POLICY IF EXISTS` before each `CREATE POLICY`):

- **`020_licensing.sql`** → `school_licenses` (UNIQUE on `school_id`; **reserved Stripe columns** `stripe_customer_id`/`stripe_subscription_id`/`billing_cycle` stay unused), `license_usage`, `license_events`; SECURITY DEFINER audit triggers.
- **`049_activation_keys_billing.sql`** → `license_keys` (HMAC burn ledger: `status pending|active|expired|revoked`, `signature`, `expires_at`, `allowed_email_domains`), `schools.allowed_email_domains`, `user_sessions`, `billing_invoices` (PO/check/wire — **no Stripe**), `login_anomalies`, and **`enforce_enrollment_limit()` + `trg_enforce_enrollment_limit`** (BEFORE INSERT on `enrollments`, SECURITY DEFINER, `RAISE EXCEPTION … ERRCODE 'check_violation'`).
- **`033_automation.sql`** → `platform_config` singleton (`maintenance_mode`, `maintenance_message`, `maintenance_started_at`, `maintenance_estimated_end`).
- **`035_trial_architecture.sql`** → trial cols on `school_licenses` **and** the `schools` trial cols (§2.3 reconciliation).

### 6.2 Anti-piracy layers (all server-validated, lift as-is)

1. **HMAC single-use keys** — `keys.ts`. Key encodes tier + studentLimit + durationMonths + issuedAt + serial; signature recomputed against the **DB row's `issued_at`** at activation. Burned on activation (`status → active`); re-presenting returns 409.
2. **Domain locking** — `domainCheck.ts` + `schools.allowed_email_domains`, baked into the key at issue, copied to the school on activation. Parents exempt.
3. **DB-trigger seat enforcement** — `trg_enforce_enrollment_limit`. Counts distinct active students; blocks new enrollments past `student_limit`; allows re-enrollment. Hard wall below the app layer.
4. **Tenant isolation** — per-school RLS + per-school `platform_links.api_key` with tenant-mismatch checks (shared with §7). Service-role admin client only in server lib, **paired with object-level guards (§1.4a).**

### 6.3 Activation flow (lift `app/api/admin/licenses/activate/route.ts`)

Caller must be `school_admin | school_sysadmin | platform_admin`. Steps: auth → `verifyKey` format → lookup `license_keys` → status guards (409 active / 410 revoked / 410 expired) → school-binding check → HMAC verify against DB `issued_at` → burn key → apply `allowed_email_domains` → upsert `school_licenses` (renewal extends `ends_at = max(current, newExpiry)`) → audit `license_events`. Companion routes to lift: `generate-key`, `revoke-key`, `send-key-email`, `request-renewal`.

### 6.4 The four hardening fixes (the only net-new licensing work)

| # | Fix | Where | Change |
|---|---|---|---|
| 1 | **Trial grace-period enforcement** | `trial.ts::expireTrials` + cron | Add `grace_until` (`trial_ends_at + N days`); during grace `enforceActiveLicense` returns `ok` but flags a banner; after, suspend. Wire the **trial-check cron** (§1.8), guard `CRON_SECRET`. Day-25 nudge + day-30/grace-end expire emails via Resend. The read-only-vs-read-write behavior *during* grace and the email cadence need product sign-off (Residual Open Questions). |
| 2 | **True read-only maintenance mode** | `enforce.ts` + Next.js middleware | V1 is **banner-only**. Add a `maintenance_mode` short-circuit at the top of `enforceActiveLicense` **and** a thin Next.js middleware/route guard returning **503** for all non-GET / mutation requests for non-`platform_admin` users when `maintenance_mode = true`. **Middleware is the authoritative interception point** (the `enforceActiveLicense` short-circuit alone misses routes that skip the gate). Cache the singleton in Redis (short TTL). Keep the banner. |
| 3 | **Key-expiry check at activation** | `activate/route.ts` | Add: if `keyRow.expires_at && new Date(keyRow.expires_at) < now`, reject 410 and flip `status → 'expired'`. Optionally enforce a max issue-to-activation window. |
| 4 | **Rate-limit the activation endpoint** | `activate/route.ts` + `lib/rateLimit.ts` | Reuse V1's Upstash `authRateLimit` (5/60s); key on `userId + IP`; return 429 on exceed; graceful no-op when Redis absent. Closes the brute-force surface against the 6-char signature space. |

### 6.5 Tier gate map & enforcement points (SCOPE §10 — adopt as-is, no features move)

- **Server:** `await requireFeature(schoolId, feature)` (throws) or `await checkFeature(...)` (boolean). Write routes call `enforceActiveLicense(userId)` first.
- **Client:** `useLicenseGate(feature)` → `{ allowed, loading, requiredTier }` for upsell/gating UI.
- **Spark gate:** Pro+ enforced **in CORE before the webhook fires** via `checkFeature(schoolId, 'spark_experiences')`. The authoritative grade-band gate (3–12) is SPARK-side (§5.2c/§7.4). The `sendAssignmentToSpark` service owns the CORE pre-flight.
- **Negotiated deals:** `feature_overrides`/`feature_blocks` (jsonb on `school_licenses`); block > override > trial > tier. Invalidate Redis + client cache on any license mutation.
- **Pilot is Pro-only (SCOPE §0/§17):** the gate map carries Essentials unedited, but no Essentials tier is provisioned.

### 6.6 Locked gotchas to carry forward

- **Two tier vocabularies coexist by design.** `keys.ts`/`license_keys` use customer-facing **`pro`**; `school_licenses` + `TIER_FEATURES` use DB **`professional`**. **Replace the inline ternary (`dbTier = keyRow.tier === 'pro' ? 'professional' : keyRow.tier`) with an explicit, total bidirectional map `CUSTOMER_TIER ⟷ DB_TIER` defined once in `tiers.ts`, exhaustive over all tier values, with a compile-time exhaustiveness check.** Preserving the two vocabularies is correct; encoding the bridge as a one-value string ternary at the activation route is the bandaid — the map is the disciplined fix and won't break when a second alias appears.
- **Trialing = professional everywhere.** `checkFeature`, `useLicenseGate`, `checkUsageCap` all treat `status === 'trialing'` as professional. This implements "trial = Pro" (§12b) — keep it consistent.
- **Demo roster vs seat limit (commit the 8-student seed).** V1 `provisionTrial` sets `student_limit = 300` (seat cap). SCOPE §12b mandates "8 demo students" (the pre-loaded roster). **These are different fields and both ship:** `seedTrialDemoData` seeds **exactly 8** demo students (committed M3/M5.6 deliverable, wired into onboarding §5.6), independent of the 300 seat cap. Do not conflate.
- **Seat trigger only enforces on `status = 'active'`** — trials are intentionally unenforced. Confirm acceptable for a 300-seat Pro trial, or extend the trigger (Residual Open Questions).

### 6.7 Media metering (SCOPE §5 — lift `usageCaps.ts` + 2 adds)

**Caps table (lift verbatim, `USAGE_CAPS`):**

| Feature | Essentials | Professional | Enterprise | Period | `platform_events.source` |
|---|---|---|---|---|---|
| `tts_characters` | 100k | 500k | ∞ | month | `tts` |
| `whisper_seconds` | 12k | 60k | ∞ | month | `whisper` |
| `flux_images` | 50 | 200 | ∞ | month | `flux` |
| `runway_videos` | 10 | 50 | ∞ | month | `runway` |
| `teli_chat` | 20/day | 50/day | ∞ | day | `teli_chat` |

**Metering contract (every metered route):** call `checkUsageCap(schoolId, feature, cost)` **before** the provider call (429 + `{ used, limit, resetAt }` on `!allowed`); on success `void logCappedUsage(schoolId, studentId, feature, units)`. Char/second caps pass real `units`; count-based default `units = 1`. Caps **fail open** on DB error — **except** when fail-closed licensing has already blocked the write (§3.5 precedence). Reference: `app/api/attempts/tts/route.ts`.

**Tier split (§5a):** TTS + Whisper + Flux + diagrams **all tiers**; **Runway video = Pro+** — enforce with a `checkFeature` video gate *in addition to* the `runway_videos` cap. Routes to lift: `app/api/attempts/{tts,transcribe,teli-voice,teli-chat,diagram}/route.ts` + the Runway client behind `?video=true`.

**Two NEW adds (§5c):**
1. **Passage / question / hint read-aloud.** V1 TTS only fires on Teli replies. Add a read-aloud affordance on assignment passages, quiz/assignment question text, and Super TELI hints — all routing through the **same** `tts/route.ts` (meters against `tts_characters` automatically). No new metering code.
2. **Voice-only-on-non-reading via the modality descriptor (§3.3).** The server guard on `transcribe`/`teli-voice` reads the generated task's `affordances` descriptor (returning **422** when `voice_in` is not allowed, e.g. reading-comprehension items); client mirrors (hide the mic) but the server check is authoritative. One descriptor, not a bespoke `isReadingTask` boolean — covers every future modality rule.

---

## 7. Integrations — Three Independent Tracks (LMS · SIS · Spark)

> Scope refs: SCOPE.md §11 (Integrations), §13 (typed-contract coupling). **Honest framing (from review): there is no single reusable "Platform API."** The three seams share nothing but the word "integration" — LMS is a duck-typed `LmsConnector` behind a `getConnector(provider)` registry; SIS is an `abstract class BaseSISAdapter` instantiated per provider; Spark is a module of free functions reading a Spark-specific 7-dimension wire payload, single-tenant per school via `platform_links`. The only genuinely generic artifact is the `platform_links` **config row** (generalizing `core_spark_links`), which generalizes config, not behavior. This section is three tracks, not a platform. (A real `ProductConnector` substrate that a second product could implement without touching CORE is a P2 design question — see Residual Open Questions.) Google Classroom ships **live at pilot** (lift V1 ~95%, add grade pull); Canvas/SIS interfaces are architected now, implementations ship Enterprise (P2). Mine for logic & contract; never visuals.

### 7.1 Source map (lift targets)

| What | Source path | Disposition |
|---|---|---|
| CORE-side Spark client (6 actions + JWT mint + URL helper) | `spark-platform/core-integration/spark-client.ts` (~117 lines) | LIFT → `lib/spark/` |
| Result-return endpoint template | `spark-platform/core-integration/attempt-complete-route.ts` (~70 lines) | LIFT → `app/api/attempts/spark-attempt-complete/route.ts` |
| Env-var contract / README | `spark-platform/core-integration/README.md` | Follow verbatim |
| SPARK inbound webhook (payload-shape reference) | `spark-platform/app/api/integration/webhooks/core/route.ts` | Read-only reference (canonical 7-dim keys) |
| SPARK JWT verify + result POST | `spark-platform/lib/integration/core-client.ts` | Read-only reference |
| Bridge tables + idempotency DDL | SPARK migration 001, `035_…`, idempotency 029 | Port pattern → v2 migrations |
| LMS connector interface + registry | `core/lib/integrations/lms/types.ts`, `registry.ts` | LIFT verbatim (provider-agnostic) |
| Google Classroom adapter | `core/lib/integrations/lms/google-classroom.ts` + `app/api/teacher/google/*` | LIFT ~95%, add grade pull |
| Grade passback (push, fail-soft, `after()`) | `core/lib/integrations/lms/gradePassback.ts` | LIFT push as-is; grade **pull** is a separate ingest pipeline (§7.5a) |
| SIS base adapter + 4 stubs + types (~1,748 lines real impl) | `core/lib/integrations/sis/baseSISAdapter.ts`, `adapters/*`, `types.ts`, `syncEngine.ts` | LIFT interface, **keep stubs dark** |
| Tier gate (Spark commercial gate) | `core/lib/licensing/tiers.ts` (`spark_experiences`), `checkFeature.ts` | Reuse (§6) |
| Rate limiters / cache | Upstash limiters (§14) | Reuse for per-key quota |

### 7.2 The Spark contract (LOCKED wire format)

Treat the wire format as **locked**; any field addition bumps a `PROTOCOL_VERSION` constant shared by both sides (§7.3 #4). Asymmetric auth + inline payloads + idempotent webhooks. Four channels:

| Direction | Channel | Auth | Idempotency | Payload (key fields) |
|---|---|---|---|---|
| CORE → product | student launch (browser redirect) | **HS256 JWT** signed by `CORE_SPARK_API_SECRET`, issuer `inteliflow-core`; optional `return_url` (allow-list validated) | n/a | `core_user_id, core_school_id, spark_attempt_id, return_url` |
| CORE → product | assignment webhook `spark_assignment_created` | **Bearer** per-school `api_key` (`platform_links`) + `X-Idempotency-Key` | key = `${core_homework_id}_${student_id}` | `lesson_plan{content, concept_tags, subject_domain, grade_band}`, `student_profile{grade, student_band, rubric_rolling_averages?, learning_pattern_flags, locale}` |
| product → CORE | result webhook → `/api/attempts/spark-attempt-complete` | **Bearer** `CORE_SPARK_API_SECRET`; target URL from `platform_links.core_base_url` | same dedup, suffix `scored` | `score, effort, signals, rubric_dimensions\|null, content_quality\|null, bncc_codes\|null` |
| CORE ↔ product | 6 read/write actions → product's `/api/integration/core` | Bearer per-school `api_key` | n/a | `get_student_profile, get_experiment_suggestions, create_assignment, get_attempt_result, sync_student_roster, checkSparkHealth` |

**Asymmetric auth (the key design):** CORE *signs* HS256 JWTs for student flows; products validate and lazy-create their user keyed on `core_user_id`. Products *return* data via a per-school Bearer secret. CORE never holds product DB credentials and vice-versa — coupling is only the wire contract (SCOPE §13: "never shared DB seeds").

**Idempotency table — `webhook_idempotency_keys`:** `(endpoint, idempotency_key UNIQUE, status_code, response_body, created_at, expires_at)`. On a duplicate key, return the **cached response** and never re-run generation/retry.

### 7.3 GA reworks (the real M5 build — net-new vs SPARK as-built, implement from day one)

The base contract is only ~187 lines; the actual work is this security/reliability rework. M5 is named accordingly (§10).

1. **Rotatable/expiring keys.** SPARK's `api_key` is a bare `gen_random_uuid()`. v2 `platform_links` adds `key_version, rotated_at, expires_at`. Reject expired/old-version keys at the auth boundary; support an overlap window; reuse the HMAC/constant-time discipline from `keys.ts`.
2. **Per-key rate limiting (Upstash).** Wrap both inbound entry points (the 6-action endpoint and the result webhook) in a per-`api_key` sliding-window limiter. Fail-closed with `429` + `Retry-After`.
3. **Idempotency-row TTL (~30d).** Add `expires_at` + the cleanup cron (§1.8).
4. **Codegen'd payload spec (single source of truth for the 7 rubric dimensions).** Define the wire contract once as a shared Zod schema (`lib/platform/contract/*.ts`), **including the seven rubric dimensions as one exported constant**; both sender (`sendAssignmentToSpark`) and receiver (`spark-attempt-complete`) **and the eval tuple type + the sparkRubric runner's STRICT/FLEXIBLE sets** import it (§11.4). Bump `PROTOCOL_VERSION` on change. This is the generalization that makes the §11.4 key-mismatch class of bug impossible to recur — §11.4 becomes "point at the shared constant." Replaces SPARK's hand-rolled `buildStudentProfile`.
5. **Allow-list validation for URLs.** Validate `core_base_url` and JWT `return_url` against an allow-list on write *and* at use time.

### 7.4 Spark service layer (the first product on the contract)

Spark is **Pro+** and rides the contract above. Build a thin service layer so the call site is not a procedural mass (SPARK flags `submit/route.ts:1119-1180` as the thing to replace):

- **`lib/spark/sendAssignmentToSpark.ts`** owns: (a) **commercial-gate pre-flight** (`checkFeature` Pro+, before the webhook) + canonical-grade normalization feeding SPARK's grade-band gate; (b) build + validate payload from the codegen'd schema; (c) **inline-await the webhook** — NOT fire-and-forget (a May-2026 Vercel teardown bug killed unawaited promises; the fix was to `await` before returning); (d) 35s sync-handoff timeout → **soft-degrade** (§3.5); (e) write `spark_sync_failed` when `generation_status='failed'` so the Launch button gates correctly.
- **`lib/spark/sparkClient.ts`** — lift the 6 actions + `generateSparkAuthToken` + `getSparkExperimentUrl`.
- **`app/api/attempts/spark-attempt-complete/route.ts`** — lift the template; **nested under an existing API path (§1.5 Turbopack trap)**; validate Bearer, dedup via idempotency table, persist `score/effort/signals/rubric_dimensions/content_quality`.

**Gate ownership (per SCOPE §10/§11, do not collapse):**
1. **Commercial gate, CORE side, *before* the webhook fires:** `checkFeature(schoolId, 'spark_experiences')` (Pro+; Essentials excluded).
2. **Grade-band gate, authoritative SPARK side:** SPARK supports grades **3–12**, rejects K-2. CORE sends a **canonical grade** (normalize `'7'` vs `'6-8'` before notifying). Any CORE-side grade check is a Launch-button UX pre-filter only (§5.2c), not the enforcement point.

The product side also checks a `core_integration` per-school flag at *webhook time* (not generation time) so in-flight disables take effect. Belt-and-suspenders.

**Cold-start rule (document + enforce):** `rubric_rolling_averages` is sent **only when the student has prior scored Spark attempts** — *absent* (undefined), not `{}`, on first attempt (emitting `{}` poisons the generation cache fingerprint). `collaboration` must be `null` (not `0`) for solo work.

**Durable round-trip — Vercel Workflow DevKit (SCOPE §11 architecture addendum).** Model the assignment→result handoff as a durable workflow rather than the hand-rolled inline-await + `webhook_idempotency_keys` + manual-retry plumbing:

- `sendAssignmentToSpark` (inside a `"use step"`, since `start()` can't run in workflow context) fires the assignment; the workflow then **suspends on a `createWebhook()`** awaiting SPARK's callback.
- SPARK's result webhook **resumes** the suspended run via `resumeWebhook(token, request)`; the run survives a deploy/restart, and a late callback still lands — that is the durability win over V1's fire-and-await.
- The 35s sync-handoff + soft-degrade (items (c)/(d) above) becomes a `sleep`-bounded race against the hook: if the hook hasn't resumed by the timeout, set `spark_sync_failed` and let the Launch button degrade (§3.5) — the durable run can still complete later and backfill.
- **WDK specifics:** `createWebhook()` generates its **own random token** — do **not** pass a `token` (deterministic tokens are only for the server-side `createHook`/`resumeHook` pair). The §7.3 #3 idempotency-TTL rework still applies on the receiver to dedup duplicate SPARK callbacks.
- This is the only integration surface on WDK for P1; the LMS/SIS tracks (§7.5–§7.7) stay conventional.

**Snapshot-invalidation rule (build requirement, not an open risk):** `student_profile_snapshot` regenerates when the source profile fingerprint changes before the attempt renders — serving a stale cached challenge is a correctness bug for a loop product. (Persist Flux media immediately per §3.3.)

**Idempotency fan-out invariant (decide for P1):** the key `${homework_id}_${student_id}` is safe **only if** one `(homework, student)` maps to exactly one Spark assignment. P1 **asserts this invariant** — a single homework does *not* fan out to per-group Spark variants for one student at pilot — and enforces it in code (not just a test). If P1 later needs per-group variants, the key gains a variant discriminator at that point. (Flagged for confirmation in Residual Open Questions.)

**Pedagogy boundary (LOCKED, §4d):** Spark's in-runner TELI tutor stays SPARK-owned and separate behind the contract — do **not** unify it with Super TELI. SPARK's 7-dim rubric is a distinct instrument from CORE's OEQ grader (0/0.5/1.0); keep them separate. Spark scores are **never** pushed to the LMS gradebook (hard guard in `gradePassback.ts`).

### 7.5 Google Classroom — live at pilot (lift V1 ~95%)

GC is the **only live integration at pilot**, all tiers, free. Lift `lib/integrations/lms/google-classroom.ts` + `app/api/teacher/google/*` (`courses`, `roster`, `import-roster`, `course-link`, `publish`, `post-assignment`, `grades`, `scope-check`). Working in V1: SSO, roster import, course link, publish CourseWork, **one-way grade push** (fail-soft via `after()`), pinned launch link.

**OAuth & token lifecycle (specify, don't just name):**
- **Token storage:** GC OAuth tokens stored in a dedicated table (LIFT migration 074 connector tables), **encrypted at rest**; never client-exposed.
- **Refresh:** refresh-token handling on expiry; on refresh failure, the connector surfaces a re-auth prompt rather than silently failing a roster sync.
- **Insufficient scopes:** `scope-check` raises `LmsScopeError`; UX prompts the teacher to re-consent with the missing scope.
- **OAuth denied/abandoned mid-onboarding:** falls through to the demo path (§5.6, §9.7) — no external dependency blocks first value. If a previously-connected token later expires, the Confirm-loop grade-pull degrades gracefully (stale grades flagged, not crashed).
- **Callback route** lives in the `(auth)` group (`app/auth/callback`), nested under an existing path.

**Grade-band pull:** surface student grade level for the Spark grade-band gate and grade-anchored generation (§3). GC carries limited grade data; fall back to roster/admin CSV (`rosterIdentity.ts` anchoring). Keep `ImportedStudentProfile.schoolStudentId` null for GC by design; populate grade where available.

### 7.5a Grade PULL as its own ingest pipeline (net-new — the Confirm loop depends on it)

V1 only *pushes* grades; `gradePassback.ts` is push-shaped end to end (resolve provider student id → `mapScoreToPoints` → fail-soft `after()` write). Pull is the **inverse dataflow** and is **not** a method bolt-on:

- Build a `GradeIngest` pipeline parallel to `gradePassback`, sharing only the connector's identity-resolution primitive: provider `studentSubmissions` → **reverse identity resolution** (provider submission → CORE student/attempt) → land on the correct CORE entity → **conflict policy** when the LMS grade disagrees with CORE's computed score.
- The `LmsConnector` interface carries a `pullGrades` capability, but the **ingest model and Confirm-loop semantics are owned here**, not implied free by the interface.
- **Pull trigger model (decide for P1):** pulled grades feed the Assignment-vs-Quiz gap signal, so pull on **Confirm-view load** (on-demand when the teacher opens One Student / the gap signal) for the pilot, avoiding a polling cron at this scale. (Cadence is confirmable in Residual Open Questions.)

### 7.6 Provider-agnostic LMS adapter (GC + Canvas) — architect now, ship Canvas in Enterprise

Lift the seam verbatim:
- **`lib/integrations/lms/types.ts`** — `LmsConnector` (`publishAssignment`, `createCourseLink`, `pushGrade`, `resolveIdentity`, `importStudentProfiles`, `exportStudentProfiles`) + `LmsCapabilities` + typed errors (`LmsScopeError`, `LmsExportNotSupportedError`). **Add `pullGrades`** capability (ingest model in §7.5a).
- **`lib/integrations/lms/registry.ts`** — `getConnector(provider)` is the only way callers get an adapter; "adding a provider = one import + one map entry." No provider SDK import leaks outside its adapter module.
- **Canvas (net-new, P2):** `lib/integrations/lms/canvas.ts` against Canvas REST + OAuth2; register one map entry. Implemented in the Enterprise phase; the interface ships now so launch/identity/publish need **zero** change later.

### 7.7 Provider-agnostic SIS adapter — architect now, ship in Enterprise

Lift the interface, keep implementations dark (the ~1,748 lines of real adapter code stay unwired at pilot):
- **`lib/integrations/sis/types.ts`** — `SISProvider` union (blackbaud/veracross/managebac/clever, + powerschool/facts reserved), `SISStudent/Class/Teacher/Grade`, `SISSyncResult`, `SISConnectionConfig`.
- **`baseSISAdapter.ts`** + 4 provider adapters + `syncEngine.ts` — the architected seam; no dashboard or cron for the pilot.
- SIS carries the **school-issued student number** (the longitudinal anchor GC lacks) — `schoolStudentId` populated with `source='provider_sync'` for Clever/OneRoster, so the Enterprise longitudinal layer (P2) lands cleanly.

### 7.8 Env-var contract & what to LEAVE behind

CORE holds `CORE_SPARK_API_SECRET` (JWT signing + result-webhook Bearer); each `platform_links` row holds the per-school `api_key` + `core_base_url`. GC uses the V1 Google OAuth env set. GA-rework keys (`key_version`/`rotated_at`/`expires_at`) are columns, not env. All secrets via Vercel env; sweepers gate on `CRON_SECRET`.

**Do not resurrect:** the retired catalog-match path (`get_experiment_suggestions` match-score filter), static seed fallback (`challenge-seeds.ts`), template-anchored generation (`generation_path` switch — v2 has one unified payload-direct interface), SPARK's hardware subsystem, and the Portuguese/BNCC/locale layer (SCOPE §19 out-of-scope — keep the `locale`/`bncc_codes` seam in the wire contract, leave the feature dark).

---

## 8. Pedagogy & Eval Reconciliation

> Scope refs: SCOPE.md §7 (pedagogy — Barb's call, ✅* approach locked), §4c, §6b. **Carry V1's locked pedagogy verbatim** as the v2 basis; Barb confirmation is queued for only **3 deltas**. The pedagogy *content* is lifted as-is; the *work* is the three deltas and the eval reconciliation they require.

### 8.1 Lift verbatim (already Barb-locked in V1)

- **CL = Reinforce / On Track / Enrich** (replaces "Tribes") — as a verb mapping over the existing 6-state `skill_learning_state` (§3.2).
- **12 Learning Strategies** (Goal First, Knowledge Bridge, Quick Look, Text Detective, Question Quest, Explain It, Note Builder, Idea Mapping, Idea Exchange, Think-Talk-Share, Comprehension Crew, Pause & Reflect) — `INTELIFLOW_STRATEGIES` in `lib/openai/prompts.ts`. Per-class (`student_model`, §2.4).
- **5 Power Skills** (Monitor, Think, Research, Communicate, Collaborate) — `lib/strategies/powerDisplay.ts`.
- **4 effort labels** (effortful success / struggling but trying / independent success / independent struggle) — `lib/copy/effortLabels.ts`.
- **Mastery scale** with human labels ("Mastery," never "Band") — `BAND_LABEL` in `lib/admin/profileExport.ts`.
- **OEQ rubric** + the grading prompt (incl. the closed `error_type`/`reasoning_pattern` enums) — `GRADING_SYSTEM`/`gradingPrompt`.

### 8.2 The three Barb-gated deltas (the only net-new pedagogy work)

1. **CL verb mapping** (§4c, §3.2) — the 3 teacher verbs (Reinforce / On Track / Enrich) mapped over V1's existing 6-state per-skill `skill_learning_state` (migration 072, a **LIFT**). The delta Barb ratifies is the **verb mapping** and the cold-start "Not yet assessed" UI state — **not** the per-skill existence (which already ships). *(Correction from the draft: this is not "net-new vs V1's per-student band"; V1's band is already per-class, migration 029. The new grain is per-skill, reconciled in §2.4.)*
2. **Misconception taxonomy** (§6b, §3.2) — **formalize** V1's existing closed `error_type` (8 values) + `reasoning_pattern` (6 values, incl. `misconception`) enums into a first-class taxonomy table, and key the existing `findRecurringError` matcher to skill. Barb ratifies/extends the existing vocabulary; this is not invention from scratch.
3. **Eval-corpus rebuild** — V1's corpus is empty (Stage A); rebuild with Barb-confirmed tuples (detail in §11).

**Process rule (SCOPE §7):** any change to graded pedagogy content must go through Barb **and** bump the drift suite (`PROMPT_VERSION`/`MODEL_VERSION`, §1.3). Wire this into the PR template.

### 8.3 The eval-tuple ↔ SPARK rubric key reconciliation (cross-cutting blocker)

Owned here, exercised in §11, **fixed generically via §7.3 #4.** V1's `scripts/eval/types.ts` `SparkRubricEvalTuple` declares dimension keys (`analysis_evidence`, `metacognition`, `growth_mindset`) that **do not match** SPARK's runtime rubric or the `sparkRubric` runner's `STRICT_DIMENSIONS` — a hard blocker for eval Stage B. The root cause is three hand-maintained copies of the dimension set; the fix is a single shared constant (§7.3 #4), with the rename detailed in §11.4.

---

## 9. Design System & UX Discipline

> Scope refs: SCOPE.md §16 (Look & Feel), §15 (non-negotiable language), §8 (screen map), §18 (success metrics), §13 (stack: Next 16 + Tailwind v4 + shadcn/ui; mine V1 for logic not visuals). This section specifies the *bones* (token architecture, intensity system, a11y, motion, discipline rules) so the design phase can drop in an exact palette without re-architecting.

### 9.1 Locked decisions this section builds to

| Locked | Design consequence |
|---|---|
| Fresh **electric pop-art** direction; exact colors explored visually later | Token layer makes palette **swappable** — no hex literals in components |
| **Student-loud / adult-credible** intensity split | Two intensity tiers over **one shared token DNA** |
| **WCAG AA always**, even on bold color | Contrast is a build gate, not a review note |
| **Leaderboard off by default**; "You vs 4 weeks ago" frame | Default-off feature flag + a default progress component |
| **Motion with purpose** | Motion tokens + `prefers-reduced-motion` honored everywhere |
| **Time-to-first-value < 5 min**, defaults-over-settings, one-screen-one-job, plain language | Enforceable discipline rules + lint/checklist |
| Stack: Next 16 + Tailwind **v4** + **shadcn/ui** | CSS-first `@theme`, no `tailwind.config.js`; shadcn in "new-york" CSS-vars mode |

**Prerequisite gate (§10.5):** the palette, font pairing, signature-element spec, and the §5 screen-collapse sign-off must **close before M8 design build starts** — they are this section's stated inputs.

### 9.2 Token architecture — three layers, palette swappable

The scaffold already uses the right pattern: `src/app/globals.css` defines raw values in `:root` and re-exposes them via `@theme inline` (Tailwind v4 CSS-first; no `tailwind.config.js`; Geist vars wired in `layout.tsx`). Extend that file with a 3-tier chain so the design phase only edits Tier 1:

- **Tier 1 — Primitives** (`:root`, the *only* place hex lives). Ramps, not single colors: `--violet-50…950`, `--coral-50…950`, `--lime-50…950`, plus a neutral `--ink-*` ramp. Abstract slot names (`--brand-1/2/3`) so hues swap without renaming downstream.
- **Tier 2 — Semantic** (references Tier 1 only): `--background`, `--foreground`, `--primary`, `--accent`, `--muted`, `--destructive`, `--success`, `--warning`, `--ring`, `--card`, `--border`, plus CL semantics (`--cl-reinforce`, `--cl-on-track`, `--cl-enrich`). **shadcn/ui consumes this tier.**
- **Tier 3 — `@theme inline`**: maps semantic vars to Tailwind utilities (`--color-primary: var(--primary)`, etc.).

**Enforceable rules:** components reference only Tier 2/3 (`bg-primary`, `text-cl-enrich`) — never a raw ramp, never a literal hex. ESLint/stylelint guard fails on hex literals in `src/components/**` and `src/app/**/*.tsx`. Palette swap = ~30 lines of Tier 1.

**Fonts:** replace Geist with the §16 pairing (expressive geometric display + highly legible body) via `next/font` in `layout.tsx`, exposed as `--font-display` / `--font-sans`. No `tailwind.config.js`.

### 9.3 The intensity split — one DNA, two tiers

Not two design systems. One token set with a `data-intensity` attribute on a layout boundary, with CSS overrides:

```
:root            { /* shared DNA: spacing, type scale, radii base, motion base, all CL/status colors */ }
[data-intensity="loud"]      { --radius: 1rem; --shadow-pop: …; --motion-scale: 1;   --display-weight: 800; --surface-saturation: high; }
[data-intensity="credible"]  { --radius: 0.5rem; --shadow-pop: none; --motion-scale: 0.6; --display-weight: 650; --surface-saturation: calm; }
```

| | **Loud (student)** | **Credible (teacher / parent / admin / platform)** |
|---|---|---|
| Surfaces | Student: Home, Do the Work, Spark | Teacher (all 4), Parent, School Admin, Super Admin |
| Color use | Saturated blocks, full brand ramp | Same hues restrained — accent/signal, calm near-white canvas |
| Type | Big friendly display, large numbers | Confident modern, tighter, information-dense but calm |
| Shape/depth | Chunky radii, pop-art shadow | Subtle radii, flat/soft elevation |
| Motion | Playful micro-animations, TELI character | Restrained, functional transitions only |
| Shared (non-negotiable) | CL colors, status, spacing, focus ring, AA contrast, plain language | identical |

Set `data-intensity` from the route group: student → `loud`; all other shells → `credible`. Spend the boldness budget on **one signature element** per loud screen (the "you're improving at X" hero, the TELI character); keep everything else calm so the 5-second test survives. **Pilot design depth (§10.5):** fully design Teacher: Today, One Student, Create, and the Student screens; admin/parent/platform get functional-credible, not bespoke.

### 9.4 shadcn/ui setup

- Init shadcn for **Tailwind v4 / React 19** in CSS-variables mode, style **"new-york"**, base color **neutral**. Writes `components.json` (absent today) + components into `src/components/ui`. Use the `vercel:shadcn` skill for the v4/React-19 install path.
- shadcn maps its theme tokens onto our **Tier 2** names — adopting shadcn is just pointing its vars at ours.
- Wrap shadcn primitives in **CORE components** that bake in discipline (`CardOneJob`, `ActionButton`, `PlainStat`). The intensity split lives in the wrapper layer.
- Component inventory (maps to §5 screens): `SignalCard` (5-second triage row), `CLBadge` (Reinforce/On-Track/Enrich via `--cl-*`; renders "Not yet assessed" for cold-start), `ProgressVsPast` (default "You vs 4 weeks ago"), `NextStepCard`, `EmptyState`, `OnboardingStep`.

### 9.5 WCAG AA as a build gate

- **Contrast:** every Tier-2 fg/bg pair clears AA (4.5:1 body, 3:1 large/UI). Highest risk is the loud tier — text never sits on raw mid-ramp brand; use `--brand-*-950`/`--ink` on light, near-white on `--brand-*-700+`. Bake a contrast-check (APCA/WCAG script over token pairs) into CI; it is the safety net until real hex exists.
- **Focus:** a single visible `--ring` token (≥3:1); never `outline: none` without replacement.
- **Hit targets & semantics:** ≥44×44px targets; semantic HTML + ARIA; label icon-only buttons. CL color is **never the only signal** — pair `--cl-*` with the word (also satisfies §15).
- Add `eslint-plugin-jsx-a11y` to `eslint.config.mjs`; run in CI.

### 9.6 Motion with purpose

- **Motion tokens:** `--motion-fast` (120ms), `--motion-base` (200ms), `--motion-slow` (320ms), `--ease-standard`, `--ease-emphasis`, `--motion-scale` (set by intensity tier).
- **Purpose rule:** motion only to (a) confirm an action landed, (b) show change over time (the "You vs 4 weeks ago" reveal), (c) guide attention in onboarding. No decorative loops on credible surfaces.
- **`prefers-reduced-motion: reduce`** collapses non-essential motion to opacity/instant — one global guard in `globals.css`.

### 9.7 Discipline encoded as concrete defaults (§16/§18)

- **One screen / one job / one action.** Each route owns a single `ActionButton variant="primary"`; lint/review rule: max one primary action per screen.
- **Defaults over settings.** No settings screen in the pilot. `EmptyState` always offers the next action. Onboarding pre-loads a demo class (8 students, §6.6).
- **Plain language is the product (§15).** Centralize user-facing strings in a copy module (lift the *pattern* — per-audience voice registers — from `lib/copy/effortLabels.ts`). Forbidden words enforced in code (deny-list in CI): never "Band" (use "Mastery"), never "adaptive" (use "personalized/differentiated"), never lead with "AI-powered"; profiles "observational not diagnostic."
- **Leaderboard off by default.** Ship XP/streaks/badges, but the default student progress surface is `ProgressVsPast` (self-referential, never peer-ranked); leaderboard behind a default-off flag.
- **Time-to-first-value < 5 min as a design requirement.** The onboarding flow (§5.6) is the most-designed surface: ≤4 steps, each one decision, progress always visible, every step skippable to the demo path so no external dependency (GC OAuth) can block first value. Treat the 5-min budget as a measurable acceptance test.

### 9.8 Mobile + a11y by default

- **Mobile-first:** build at the small breakpoint, enhance up. Teacher: Today and Student screens fully usable one-handed; the 5-second test applies on mobile. Single responsive shell, not separate mobile screens.
- Touch targets ≥44px; no hover-only affordances; test keyboard-only + screen reader on the two highest-traffic screens (Teacher: Today, Student: Do the Work).
- Honor `prefers-color-scheme` (scaffold has a dark `:root`) and `prefers-reduced-motion` from day one — both token-level, zero per-component cost.

### 9.9 Build order (front-loaded)

1. Extend `globals.css` with the 3-tier token chain + intensity overrides + motion/reduced-motion guards.
2. Swap fonts in `layout.tsx` once the §16 pairing is chosen.
3. `shadcn init` (v4/React-19, new-york, CSS-vars) → point its theme at Tier 2.
4. Build the CORE wrapper components (`SignalCard`, `CLBadge`, `ProgressVsPast`, `NextStepCard`, `ActionButton`, `EmptyState`, `OnboardingStep`).
5. Wire CI gates: hex-literal ban, contrast check, `jsx-a11y`, forbidden-copy deny-list (all net-new — not in the scaffold).
6. Hand Tier 1 + the signature-element spec to the design phase (frontend-design + visual companion).

**Source files:** `src/app/globals.css` (token chain), `src/app/layout.tsx` (fonts + `data-intensity`), `eslint.config.mjs` (a11y/hex/copy rules), `package.json` (confirms the stack; `components.json` created by `shadcn init`).

**V1/SPARK references — pattern only:** `lib/copy/effortLabels.ts` → the copy module model; `BAND_LABEL` → the Reinforce/On Track/Enrich labels behind `CLBadge` (DB enum stays the V1 vocabulary; UI never shows "Band"); `lib/strategies/powerDisplay.ts` → Strategies/Powers display rules. **Import no V1 CSS/theme/component/layout.**

---

## 10. Build Sequence & Milestones (toward September)

> Implements SCOPE §17's locked ordering: front-load proven V1/SPARK lifts onto a working spine, then layer net-new. Target = full **Pilot Baseline (Pro tier)** before September.
>
> **⚠️ Build parameters resolved 2026-06-17 (SCOPE §17 supersedes the calendar below).** Team = **solo + Claude Code** (single ordered track — *not* the parallel team §10.1 assumes). **Near-term pilots (EduFlux ~next week, US ~2–3 weeks) run on V1**, the committed safety net; **v2 builds core-loop-first** as the forward platform so the earliest usable slice can come online ASAP. The parallel-staffed calendar in §10.2/§10.3 is therefore a *capacity model*, not the plan — the **implementation plan reflects the resolved single-track, core-loop-first ordering**. Grading keeps V1's Sonnet/GPT with an Opus 4.8 week-1 spike; adaptive ships Layer 1 now + Layer 2 self-activating ~2–3 weeks in; Barb is on-demand (not blocking).

### 10.1 Staffing assumption (the headline gating fact, not a footnote)

**This calendar requires a parallel-staffed team (≈3–4 concurrent workstreams).** §10.2 runs M3/M4/M5 concurrently and M8 as a long parallel track; that only closes the ~Aug freeze with parallelism. **Single-threaded, M3/M4/M5 serialize and the calendar roughly doubles (~20–26 weeks) — and the date slips into Q4.** SCOPE §17 commits to "full Pilot Baseline before September" but makes no staffing commitment, so the parallel team is *this spec's assumption*, which must be confirmed.

**If the build is single-threaded** (the honest minimum-viable-pilot fallback): ship the **loop, not the full Pro depth** — GC-only, the core 4 teacher + student screens, locked V1 prompts behind the eval gate, and **explicitly defer Risk Index, full Super TELI, and the misconception taxonomy formalization to fast-follow.** This is the contingency the cut-line (§10.5) protects.

**Calendar anchors are unconfirmed:** today is 2026-06-17; the spec assumes a late-June start, a ~Aug 22 freeze, and a 2-week soak before a September start — **the pilot start date and build start are not pinned.** Until pinned, treat the timeline as a range, not a single line.

### 10.2 Milestones

| MS | Name | Window | Ships | Primary lifts |
|----|------|--------|-------|---------------|
| **M0a** | Spine: scaffold, auth, route-groups, registry | Wk 1 | Scaffold wired; 5(+1)-role auth (`auth.getUser()` → `users.role`, `await cookies()`); object-level guards (§1.4a); model registry; **Opus grading spike (§3.1)** | `lib/ai/models.ts`, `lib/auth/guards.ts`; Supabase SSR |
| **M0b** | Data model + RLS + migration consolidation | Wk 1–3 | `users`/`guardians`/spine schema; consolidated migration inventory (§1.7) in dependency order; multi-school isolation; SECURITY DEFINER + DROP POLICY pattern | Migration consolidation (§1.7) |
| **M1** | Engine + prompts end-to-end (lib-first) | Wk 2–5 | Lesson parse → quiz (3 MCQ + 2 OEQ) → adapt Q4–Q5 → **OEQ grading (request-shape rebuilt for the chosen model)** → differentiated assignment, **all as import-safe `lib/engine/` fns (§3.4)**. Eval rig stood up day one of this milestone. | LIFT prompt **text**: `prompts.ts` (quiz, `GRADING_SYSTEM`, `ASSIGNMENT_SYSTEM`), `adapt`, `generateQuizForLesson`; eval scaffolding |
| **M2** | Signals + per-skill state + CL mapping | Wk 4–6 (overlaps M1) | 8-signal set on real skill-tagged attempts; **per-skill state LIFTED** (`skill_learning_state`/`computeSkillState`) + the **CL verb mapping**; signals re-keyed onto the §2.4 grain | LIFT: `lib/utils/scoring.ts`, `lib/signals/*`, `lib/skills/computeSkillState.ts`, `reteachEffectiveness.ts`. **Net-new:** CL verb mapping, grain reconciliation |
| **M3** | Licensing + media metering | Wk 5–7 (parallel) | HMAC keys, domain lock, DB-trigger seats, tier gate, 60s Redis cache, JSONB overrides; media pipeline + caps; 30-day Pro trial **+ 8-student demo seed** + 4 hardening fixes | LIFT: `tiers.ts`, `checkFeature.ts`, `keys.ts`, migration 049, `usageCaps.ts`, `trial.ts`. **Hardening:** §6.4 |
| **M4** | Google Classroom | Wk 6–8 (parallel) | SSO, roster import, course link, CourseWork publish, grade push **+ grade-pull ingest pipeline (§7.5a)**; OAuth token lifecycle; behind provider-agnostic LMS adapter | LIFT ~95%: `google-classroom.ts` + `app/api/teacher/google/*`. **Net-new:** grade-pull ingest; LMS adapter seam |
| **M5** | **SPARK contract hardening** (Pro+) | Wk 7–9 | Typed payload-direct webhook, asymmetric JWT/Bearer auth, idempotency table + TTL, **inline-await + Vercel/Fluid-Compute 35s handoff validated week-1 of M5**, result webhook; CORE Pro+ gate before the call; **the 5 GA reworks + key-fix (§7.3, §11.4)** | LIFT contract (~187 lines). **The real build = GA reworks (§7.3)** + `sendAssignmentToSpark` |
| **M6** | Net-new pedagogy + Super TELI | Wk 8–11 | **Super TELI (~90% net-new):** memory (needs data-model design *before* this window) + 3-level hint ladder + Strategy naming + voice; **misconception taxonomy formalization** + skill-keyed matcher; read-aloud; modality-descriptor guard | Build on `teli-chat/route.ts`, `teli/prompts.ts`. **Net-new (Barb input):** taxonomy formalization, Super TELI bundle. Keep SPARK's in-runner tutor separate |
| **M7** | Eval corpus rebuild + drift gate | Wk 9–11 (parallel to M6) | Rebuild Barb-confirmed tuples (≥50/scope); **fix the eval-tuple ↔ SPARK rubric key mismatch via the shared constant (§7.3 #4 / §11.4)** before Stage B | `scripts/eval/*`. **Blocker fix:** shared dimension constant |
| **M8** | Role surfaces + fresh design system | Wk 6–12 (long parallel track) | All 5 roles on the new pop-art design system (Teacher/Student fully designed; admin/parent/platform functional-credible); trajectory; parent narrative; School Admin adoption + Risk Index; Super Admin; first-run onboarding (<5 min) | New skin over V1's proven screen logic; frontend-design phase (§9). Palette/font/screen-collapse decisions **must close before this starts (§9.1)** |
| **M9** | Canvas adapter | Wk 11–13 (deferrable) | Net-new Canvas implementation of the M4 LMS interface | Architect-now-ship-later; **lowest priority — first to cut if the date is at risk** |
| **M10** | Integration soak + pilot freeze | Wk 12–13 | End-to-end Notice→Act→Confirm on Pro; 3-metric scoreboard instrumented; pilot-school provisioning | Success metrics §18; PostHog server-side allow-list |

### 10.3 Critical path (includes the human + integration long-lead items)

`M0a/M0b (spine) → [Opus-grader spike + Barb scheduling, Wk1] → M1 engine (lib-first) → M2 per-skill CL re-architecture + grain reconciliation → corpus arming (Barb) → M6/M8 → M10 soak/freeze`

The two items most likely to slip the date are **on** the path, front-loaded:
- **Barb's availability** gates the corpus *and* all 3 pedagogy deltas *and* the §11.4 key-fix decision — schedule her in week 1 (§10.5).
- **The grading request-shape rebuild** (§3.1) is genuine integration work on the highest-stakes path, spiked in week 1.
- **Per-skill CL is a node, not a bullet** (§3.2/§2.4 — re-keys ~30 V1 consuming files or shims a per-student rollup).
- **M3/M4/M5 run in parallel** off the M0 spine — only if staffed concurrently (§10.1).
- **M8 (design) is a long parallel track, off the critical path.** Front-loading design would repeat the V1 "breadth killed clarity" mistake.

### 10.4 Sequencing rationale

- **Spine before features:** roles, RLS, tenancy, identity table, and the registry are prerequisites for every downstream lift. M0 split into M0a/M0b because schema mistakes are the most expensive to fix later.
- **Engine (lib-first) before signals before CL:** signals compute *from* skill-tagged attempt/quiz rows; per-skill CL needs both the engine emitting skill tags and the signal layer.
- **Licensing/media early, in parallel:** the tier gate must exist from line one (SPARK's Pro+ gate and media caps both call `checkFeature`).
- **SPARK after licensing:** the Pro+ gate must fire *before* CORE ever calls SPARK.
- **Net-new last, on a proven base:** Super TELI builds on the Socratic base; the misconception taxonomy formalizes existing enums; the eval corpus rebuilds onto lifted scaffolding. Each net-new item has a working fallback on the spine.

### 10.5 Biggest schedule risks

1. **Staffing (§10.1)** — the whole calendar assumes parallelism. **Mitigation:** confirm headcount in week 1; if single-threaded, fall back to the loop-not-depth pilot and move Risk Index / full Super TELI / taxonomy to fast-follow.
2. **Eval corpus + 3 pedagogy deltas + key-fix all gate on Barb, with no committed dates.** Corpus is empty (4-byte files confirmed); gate arms at ≥50 Barb-confirmed tuples/scope (~300 total). **Mitigation:** commit Barb's calendar in writing in week 1; freeze the grading prompt to lifted V1 text until the gate arms; emit a **loud CI warning** when a scope is below 50 so "short-circuit to PASS" is never mistaken for a real pass; define a fallback/"Barb-lite" acceptance bar so one person isn't the critical path for three deliverables.
3. **Grading request-shape rebuild on the highest-stakes path (§3.1).** **Mitigation:** week-1 Opus spike against hand-graded OEQs; decide Opus-vs-Sonnet/GPT on day 3; keep the registry change one line.
4. **Per-skill CL is a cross-cutting re-architecture (§2.4/§3.2), not "keying."** **Mitigation:** treat as a first-class workstream; decide one-skill-tag-vs-many per attempt up front; budget for re-pointing consuming files or a per-student rollup shim.
5. **Super TELI is ~90% net-new (§5.2b)** — three features from scratch + a memory data-model design. **Mitigation:** descope to Socratic base + read-aloud for the pilot if pressure mounts; design persistent-memory storage before week 9; layer memory → hint ladder → strategy naming → voice incrementally.
6. **SPARK = 5 GA reworks, not a lift (§7.3).** **Mitigation:** validate inline-await/35s handoff on Next 16 + Fluid Compute as a week-1-of-M5 spike (not at soak); if the date tightens, ship pilot SPARK with the simpler bare-uuid key and defer rotatable/expiring keys + per-key rate-limit to fast-follow (pilot is admin-provisioned, low-volume).
7. **61-migration consolidation (M0b)** is under-appreciated foundational work. **Mitigation:** the §1.7 explicit inventory + dependency ordering replaces "renumber all 61"; give M0b real time.
8. **M8 depends on unmade decisions (palette/font/tooling/screen-collapse).** **Mitigation:** close those before M8 build (§9.1); fully design only Teacher/Student screens; keep M8 late polish + M9 Canvas on the cut-line.

**The cut-line:** M9 (Canvas) and M8 late polish ship in the Enterprise phase if September pressure mounts. **GC-only + the core 4 teacher/student screens + the closed loop is the true minimum viable pilot.**

---

## 11. Testing & Eval Strategy

> Scope refs: SCOPE.md §7, §13 ("eval rig from day one"). **Thesis:** the eval rig is the single highest-leverage thing to lift from V1, and it is already built — only the corpus is empty (confirmed: all 6 corpus files are 4 bytes). Lift the scaffolding verbatim on day one, fix the one known correctness bug (SPARK dimension-key mismatch), then rebuild the corpus with Barb (Stage B). On top, add a conventional app test stack (Vitest + Playwright — neither exists in the scaffold) and a scripted verification of the Notice → Act → Confirm loop. Proven rig at `core/scripts/eval/` → ports to `NEW-CORE/scripts/eval/`.

### 11.1 What we lift, as-is

| Lift (V1 path under `core/scripts/eval/`) | Role | Change for v2 |
|---|---|---|
| `types.ts` | Tuple shapes (discriminated union), `ALL_SCOPES`, `TupleDrift`, `RunReport` | **FIX SPARK dimension keys via the shared constant (§7.3 #4 / §11.4)**; else verbatim |
| `scoring/drift.ts` | Pure drift primitives + thresholds + `aggregateGate` | Verbatim |
| `scoring/semantic.ts` | Semantic-similarity drift on prose | Verbatim |
| `scoring/voiceRules.ts` | Voice-rule compliance (per-audience; rejects raw scores, clinical framing) | Verbatim; extend forbidden-word list to match SPARK validator (`weak/poor/fail/deficit/behind/low`) |
| `runners/runnerBase.ts` | `RunnerImpl` contract, `loadCorpus`, `runCorpus`, `notImplemented` sentinel | Verbatim |
| `runners/{grading,quizGeneration,homeworkGeneration,sparkGeneration,sparkRubric,learnerProfile}.ts` | Per-scope runners | Verbatim shapes; **wire `invokeCandidate()`** in Stage B against the §3.4 import-safe fns |
| `index.ts` | CLI entry (`npx tsx scripts/eval <scope\|all>`); exit codes 0/1/2/3 | Verbatim; update `RUNNERS` import paths if scopes change |
| `ci.ts` | CI gate: diff → touched scopes → run → exit non-zero on regression | Update `PATH_RULES` regexes to v2 paths (§11.5) |
| `export-corpus.ts` | DB `eval_candidates` (promoted) → `corpus/<scope>.json` | Verbatim; depends on the `eval_candidates` table (migration 066) + promotion flow |
| `corpus/*.json` | 6 files, currently `[]` (4 bytes each, confirmed) | **Rebuild with Barb** (§11.6) |

**The 6 scopes (locked):** `grading`, `quiz-generation`, `homework-generation`, `spark-generation`, `spark-rubric`, `learner-profile`.

### 11.2 Drift scoring & thresholds (LOCKED — lift exactly)

**Tuple-level tiers** (`tierFor`): `< 0.05` **pass** · `0.05–0.15` **warning** (Barb review before merge) · `≥ 0.15` **regression** (blocking).

**Run-level gate** (`aggregateGate`): any regression tuple → regression; `>25%` warning → regression; `>10%` warning → warning; else pass. Empty corpus → trivial pass (Stage A guard).

**Per-scope drift composition (the load-bearing IP):**
- **`grading`** (canonical reference): `score_drift = abs(Δscore)/1.0`; `notes_drift` = semantic similarity on `cognitive_notes`; `voice_drift` = voice-rule check. Weighted **score×3 / notes×1 / voice×1**. Encodes Barb Lock #1 "score thinking, not writing."
- **`spark-rubric`**: per-dimension numeric drift on the 1–4 scale, normalized `/4`. Asymmetric tiers — **strict** (`reasoning_strategy`, `use_of_evidence`, `problem_understanding`, `knowledge_transfer`) regress at `>0.125`; **flexible** (`creativity_application`, `reflection_metacognition`, `communication`) warn at `>0.25`, regress at `>0.375`. Strict dims weighted ×2. `content_quality` is **binary** weighted ×2 — any mismatch is a hard regression. `collaboration: null` (solo) is skipped, never scored as 0.
- Other four scopes follow the same shape (`invokeCandidate` + per-component breakdown + weighted `aggregateDrift`).

### 11.3 Stage A → Stage B: wiring `invokeCandidate()`

Every runner today returns `notImplemented(...)` (sentinel `drift_score:1, tier:'regression'`). Stage B = replacing each runner's `invokeCandidate()` stub with a call into the v2 production path — **the §3.4 import-safe `lib/engine/` fn, not a route handler** (live route handlers have SDK side-effects at import that fight the `tsx` CLI; the rig must run headless in CI).

| Scope | Stage-B wire target (import-safe `lib/` fn) |
|---|---|
| `grading` | `lib/engine/grading.ts` (lifted `GRADING_SYSTEM`; Claude primary, GPT fallback) |
| `quiz-generation` | `lib/engine/quizGen.ts` (3 MCQ + 2 OEQ) |
| `homework-generation` | `lib/engine/assignmentGen.ts` (`ASSIGNMENT_SYSTEM`) |
| `spark-generation` | `lib/spark/sendAssignmentToSpark` → SPARK generator (via typed contract) |
| `spark-rubric` | SPARK rubric scorer — **after** the key fix (§11.4) |
| `learner-profile` | v2 Learner Profile output layer |

### 11.4 FIX: SPARK eval-tuple dimension-key mismatch (BLOCKER — do before Stage B)

The one known correctness bug, confirmed in source: `SparkRubricEvalTuple.expected_output.dimensions` (types.ts) declares keys that **do not match** SPARK's runtime rubric or the `sparkRubric` runner's `STRICT_DIMENSIONS`:

| Eval tuple key (V1) | SPARK runtime canonical key | Action |
|---|---|---|
| `reasoning_strategy` | `reasoning_strategy` | keep |
| **`analysis_evidence`** | **`use_of_evidence`** | **rename** |
| `creativity_application` | `creativity_application` | keep |
| `communication` | `communication` | keep |
| `collaboration` (nullable) | `collaboration` (nullable) | keep |
| **`metacognition`** | **`reflection_metacognition`** | **rename** |
| **`growth_mindset`** (not in SPARK) | — | **delete** |
| *(missing)* | **`problem_understanding`** | **add** |

`runners/sparkRubric.ts` `STRICT_DIMENSIONS = [reasoning_strategy, use_of_evidence, knowledge_transfer, problem_understanding]` — none of which exist on the current tuple type, so the strict ×2 weighting silently never fires. **The generic fix (§7.3 #4):** define the seven dimensions as a single exported constant in the codegen'd contract package; the eval tuple type, the runner's STRICT/FLEXIBLE sets, and the webhook validator all import it. Then this rename is "point at the shared constant," and key drift across three hand-maintained copies cannot recur. Apply the same canonical keys to `LearnerProfileEvalTuple.input.rubric_dimensions` (it aliases the Spark dimensions, so it fixes for free).

> **Adopt SPARK's drafted threshold policy verbatim** (strict `>0.125` regress; flexible `>0.25` warn / `>0.375` regress; `content_quality` mismatch = hard regression). Preserve the Barb-locked drift string `Communication L3 = "Clear, organized, and complete."` (the period is load-bearing) as a corpus regression anchor. Whether `knowledge_transfer` is a discrete scored dimension or observed indirectly via reflection is a Barb decision (Residual Open Questions) — remove it from `STRICT_DIMENSIONS` if not separately scored.

### 11.5 CI gate

`ci.ts` is the merge gate: diffs `git diff --name-only`, maps changed paths → touched scopes via `PATH_RULES`, runs only those, exits non-zero on regression (2) / warning (1). **`MIN_TUPLES_FOR_GATE = 50`** — below 50 promoted tuples a scope short-circuits to PASS so an empty corpus never blocks PRs (auto-arms per-scope as the corpus fills). **Emit a loud CI warning whenever a scope is below 50** (§10.5 risk 2) so a short-circuit PASS is never read as real coverage.

**v2 work on the gate:**
1. **Rewrite `PATH_RULES` regexes** to v2 layout — each AI-output path (`lib/engine/grading`, quiz-gen, assignment-gen, `lib/spark/*`, rubric) maps to its scope or the gate silently skips it. Add a meta-test asserting every AI-output path maps to exactly one scope.
2. **Add `.github/workflows/eval.yml`** running `npx tsx scripts/eval/ci.ts --base=origin/main` on PR. Needs `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` (+ Supabase keys if a scope reads live config) as CI secrets. Exit 1 = label "Barb review required"; exit 2 = block.
3. Keep `export-corpus.ts` as the promote→gate bridge.

### 11.6 Rebuild the corpus with Barb (Stage B) — `barb_reviewed` gating

Every tuple carries `metadata.barb_reviewed: boolean`. **Only `barb_reviewed: true` tuples gate.** Pipeline (the V1 promotion flow, lifted):
1. **Sample** real attempts into `eval_candidates` (migration 066, with stratification cols, §2.2).
2. **Barb reviews** each candidate, edits `expected_output`, flips `barb_reviewed`/`promoted_at`. This is where the OEQ rubric expected-output set gets authored (§8 delta).
3. **`export-corpus.ts`** writes promoted rows → `corpus/<scope>.json`; commit to arm the gate.
4. **Target ≥50 tuples/scope** (~300 total). Stratify across grade bands (the grade-anchored constraint, §3), comprehension levels, and at least one deliberate edge case per scope: messy-but-correct OEQ (grading), gibberish→`non_engaged` (spark-rubric `content_quality` gate), `collaboration: null` solo case, IEP-accommodation homework (migration 053), per-skill cold-start (`null` CL / `insufficient_data`) for learner-profile.

> Barb's three queued sign-offs (§8) all touch the eval suite. Any change to graded pedagogy content must bump the drift suite — wire into the PR template.

### 11.7 App-level testing (NET-NEW — no runner configured yet)

The scaffold has **no test runner** (`package.json` scripts: only `dev/build/start/lint`).
- **Vitest** (unit + integration) — best fit for Next 16 + TS + React 19; jsdom + `@testing-library/react`. Add `test`, `test:watch`, `test:coverage`. (The eval rig runs via `tsx`, not Vitest — keep separate; eval = AI-output drift, Vitest = deterministic logic.)
- **Playwright** (E2E) — the Playwright MCP is available; use it for core-loop and onboarding flows. Add `e2e` + `playwright.config.ts`.

**Unit test priorities (pure, deterministic — lift V1 logic + tests):**

| Target (v2 lib) | Assert | V1 source |
|---|---|---|
| Per-skill state → CL verb mapping | 6-state → 3-verb + "Not yet assessed" mapping (§3.2) | `computeSkillState.ts` |
| Per-student quiz band (distinct instrument) | `≤50 / 51–79 / ≥80`; rolling avg of last 5 | `computeMasteryBand` |
| Assignment-vs-Quiz gap | alignment ±10; gap fires at `divergence_score ≥ 20` | `computeHwQuizDivergence.ts` |
| Effort labels (4) | success ≥75%, effortful = ≥2 hints | `computeEffortLabel.ts` |
| Adaptive Q4–Q5 reshape | `0–50 scaffolded / 50–79 grade / 80+ advanced` off Q1–Q3 % | `adapt/route.ts` |
| Tier vocabulary map | total bidirectional `CUSTOMER_TIER ⟷ DB_TIER` (no ternary, §6.6) | `tiers.ts` |
| License gate | `checkFeature`/`requireFeature`; JSONB override/block | `checkFeature.ts` |
| Object-level guards | `guardStudentAccess` blocks cross-teacher student reads | `lib/auth/guards.ts` |
| Score→dashboard map (SPARK) | `1→25 / 2→50 / 3→75 / 4→100` | `seven-dimension-rubric.test.ts` (lift the test) |
| Voice/brand copy | "Mastery" never "Band"; "differentiated" never "adaptive" | §15 + `voiceRules.ts` |
| Idempotency fan-out invariant | one `(homework,student)` → one Spark assignment (§7.4) | — |
| Grade-band normalization | `'7'` and `'6-8'` both canonicalize | §7.4 |

**Integration tests (Vitest, mocked LLM + Supabase test schema):** quiz-gen returns exactly 3 MCQ + 2 OEQ; submit → grading → CL update writes `skill_learning_state`; the **`spark_experiences` Pro+ gate fires before the SPARK webhook** (assert SPARK is never called on Essentials); webhook idempotency (`homework_id_student_id`) returns cached response, never double-generates; cold-start — `rubric_rolling_averages` **absent (undefined), never `{}`** on first attempt (cache-poisoning trap); **terminal LLM failure returns the §3.5 envelope, never a fabricated grade**; **service-role-client route without its object-level guard fails a test (IDOR meta-test)**. Mock all AI SDK calls (no live tokens in unit/integration CI — the eval rig is the only place live models run).

### 11.8 Verifying the core loop (Notice → Act → Confirm)

The loop close is the most valuable, most-missing V1 piece (§3) — verify end-to-end with a Playwright E2E + seeded fixture:
1. **Notice** — seed a class producing a known CL + gap signal; assert Teacher: Today surfaces the right student, ranked, with a plain reason. Assert the signal only renders if it resolves to an action (§4).
2. **Act** — teacher clicks a recommended action; assert it's the success-metric click (§18 metric 1), logs to the teacher-action table (migration 040), and PostHog logs it (typed allow-list, opaque IDs, no PII).
3. **Confirm** — seed a follow-up attempt with improved mastery; assert the reteach-effectiveness delta and that "did it work" resolves on Teacher: One Student.
4. **Time-to-first-value** — Playwright timing assertion on the hero flow: sign in → connect GC / pick demo class → one sentence → real differentiated assignment in hand, target **< 5 min** (§18 metric 2). **Time against the real upgraded engine including defaults-on media generation** — assert the budget holds with media, not just text.

Drive with the Playwright MCP against `next dev`; gate in a separate (non-blocking-on-AI) CI job. Use the 30-day Pro trial's pre-loaded 8 demo students (§6) as the deterministic E2E fixture.

### 11.9 Sequencing

1. Lift `scripts/eval/` verbatim → `NEW-CORE/scripts/eval/`; add `tsx` + `@supabase/supabase-js` dev deps.
2. **Apply the SPARK dimension-key fix via the shared constant** (§11.4 / §7.3 #4) before any spark-rubric work.
3. Stand up Vitest + Playwright; port V1 pure-logic unit tests alongside the lifted signal/scoring code; smoke-test React 19.2 + Next 16 + Turbopack compatibility before committing the toolchain.
4. Rewrite `ci.ts` `PATH_RULES` to v2 layout; add the GH Actions eval workflow (short-circuits at PASS until corpus ≥50, with the loud warning).
5. As each import-safe AI fn lands (§3.4), wire its runner's `invokeCandidate` (Stage B).
6. Build the `eval_candidates` promotion flow; rebuild the corpus with Barb to ≥50 tuples/scope; arm the gate.

---

## Residual Open Questions

These genuinely require a human / Barb / product decision before the dependent work can close. They are **not** invented answers — each is flagged at the point of use above and consolidated here. Items needing a Barb or product call are marked **(decision-gated)**.

**Models & engine**
1. **(decision-gated) Default grading model — Opus 4.8 vs keep V1-proven Sonnet/GPT.** SCOPE §13/§14 name "Claude for rubric grading" generically; V1's calibration-locked grader ran Sonnet at temp 0.2. Opus raises per-call cost and risks shifting the grade distribution the eval corpus is calibrated against. Needs a product/cost call informed by the week-1 Opus spike (§3.1) before M1 commits. (The spec ships defaulting to the V1-proven model until the spike clears Opus.)
2. **(decision-gated) Adaptive Q4–Q5: always-on vs sequenced.** Spec ships V1's always-on within-attempt reshape; SCOPE §4b frames it as history-gated. Needs a SCOPE-owner call: confirm always-on (and update SCOPE) or define the "enough history" threshold.
3. Confirm the current dated GPT generation/fallback model ID against the live OpenAI catalog at build. Smoke-test `@supabase/ssr` + Next 16 async `cookies()`/Turbopack interplay early.

**Identity & roles**
4. **(decision-gated) `school_sysadmin` (6th role).** Code depends on it; the `000` enum omits it. P1 adds it to the enum and folds it into the School Admin route group — confirm it needs no distinct surface at pilot, or specify one.

**Pedagogy (Barb-gated)**
5. **(decision-gated) CL verb mapping** (the 6-state → 3-verb mapping in §3.2) and whether `confidence`/`observation_count`/`last_reteach_outcome` are surfaced or internal-only. The cold-start "Not yet assessed" UI state is net-new and must be designed.
6. **(decision-gated) Misconception taxonomy.** Barb to ratify/extend the existing 8-value `error_type` + 6-value `reasoning_pattern` enums as the formal taxonomy vocabulary, and confirm the skill-keyed matcher design.
7. **(decision-gated) SPARK rubric `knowledge_transfer`** — discrete scored dimension or observed indirectly via reflection? Determines whether it stays in `STRICT_DIMENSIONS` (§11.4).
8. **(decision-gated) Corpus rebuild = ~300 Barb-reviewed tuples + 3 design sign-offs, no committed dates.** Barb is the single point of dependency for the corpus *and* deltas 5–7. Needs a committed calendar in week 1 and/or a fallback "Barb-lite" acceptance bar.

**Licensing**
9. **(decision-gated) Trial seats unenforced** (`trg_enforce_enrollment_limit` only fires on `status='active'`). Confirm acceptable for a 300-seat Pro trial, or extend the trigger.
10. **(decision-gated) Grace-period semantics** (fix #1): read-only-vs-read-write during grace + the day-25/day-30 email cadence need product sign-off.

**Integrations / Platform**
11. **(decision-gated) Idempotency fan-out invariant.** P1 asserts one `(homework, student)` → one Spark assignment and enforces it in code. Confirm P1 never fans a single homework out to per-group Spark variants per student; if it might, the key needs a variant discriminator now.
12. **(decision-gated) Grade-pull cadence.** Spec defaults to on-Confirm-view-load (§7.5a). Confirm vs a polled/cron model, and confirm the LMS-vs-CORE grade conflict policy.
13. **(decision-gated) Spark cost circuit-breaker.** SPARK's per-school $50/mo cap needs a v2 per-school-vs-per-district decision before GA rate-limit constants are versioned.
14. **(decision-gated) Spark media stack.** Whether Spark keeps its isolated Flux/Runway/Whisper stack or shares CORE's pipeline (affects cost metering); any shared caller must persist Flux URLs immediately (~10-min expiry).
15. **(decision-gated) FERPA delete propagation to SPARK.** The 6-action contract has no delete/forget channel. Confirm the documented pilot limitation (Spark data not purged at pilot) or add a delete action.
16. **(decision-gated) Pilot-cohort LMS/SIS.** Confirm in week 1 that every committed pilot school is on Google Classroom (or accepts manual/CSV roster). Any Canvas/SIS need moves off the cut-line and the timeline must absorb it.
17. A real cross-product `ProductConnector` substrate (vs the three independent tracks of §7) is a P2 design question, not a P1 deliverable — confirm P1 does not need it.

**Roles / UX**
18. **(decision-gated) Screen-collapse sign-off.** Which of V1's ~96 pages fold into the locked 4+3+1+1+1 set vs. cut needs a product pass so no pilot teacher/admin loses an expected screen (§5).
19. **(decision-gated) PDF export (Essentials).** Confirm deferred-within-P1 for the Pro-only pilot cohort, or pull into scope (§5.8).
20. School Admin Risk Index uses V1's noisy frustration/attention heuristics — decide whether to hide the noisiest sub-signals until pilot recalibration.

**Design / tooling**
21. **(decision-gated, design phase) Exact pop-art palette, signature element per surface, and display/body font pairing** — all §9 prerequisites that must close before M8 build starts. AA contrast on the loud tier can't be fully verified until real hex exists (the CI contrast gate is the safety net).
22. Verify the shadcn/ui Tailwind-v4 + React-19 (Next 16) install path against current docs (`vercel:shadcn`); confirm shadcn's standard token names map cleanly onto the Tier-2 names.

**Schedule**
23. **(decision-gated) Headcount.** The calendar assumes ≈3–4 parallel workstreams. Confirm staffing; if single-threaded, adopt the loop-not-depth fallback (§10.1) and the date moves.
24. **(decision-gated) Pin the pilot start date and build start.** Both are currently inferred; the ~Aug 22 freeze + 2-week soak is derived, not committed.
25. Next.js 16 + Vercel Fluid Compute behavior for the inline-await 35s SPARK handoff is unverified on the new stack — validate in the week-1-of-M5 spike, not at soak.