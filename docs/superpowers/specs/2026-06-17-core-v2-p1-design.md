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

### 2.1 Core entities

- **School · Teacher · Class · Student** — roster basics, **multi-school from day one**. Teacher/Student are `users` rows (§1.2). `Student` carries `grade_level` (for grade-anchored generation, §3, and the Spark grade-band gate, §7) and `schoolStudentId` (null for GC-imported, populated for SIS/Clever — the longitudinal anchor for P2).
- **Lesson** (plan + passage + objectives + key concepts) · **Assignment** (goal + per-student entry point) · **Attempt** (work + result + effort signal). **Each attempt carries a skill tag** so signals can key on skill (§2.4); the engine emits skill-tagged attempts from M1 or M2 has nothing to key on.
- **Quiz / Quiz attempt** — kept **separate** from Assignment/Attempt so the Assignment-vs-Quiz gap signal works; stores per-question (3 MCQ + 2 OEQ) + the structured cognitive fields (`error_type`, `reasoning_pattern`, etc. — §3.2).
- **`skill_learning_state`** (LIFT migration 072 — **not** an invented `skill_state`) — per `(student_id, skill_id)`, columns `state` (6-value vocabulary), `confidence`, `observation_count`, `evidence` jsonb, `last_reteach_outcome`. Computed by `lib/skills/computeSkillState.ts` (LIFT). Cold-start states are first-class in the vocabulary (`insufficient_data`, `not_attempted`), not fabricated. CL verbs are a **display mapping** over these states (§2.4, §3.2).
- **`skills_registry`** (LIFT migration 071) — the skill taxonomy `skill_learning_state` and attempts reference.
- **Snapshots** (LIFT migration 046) — weekly, written by the §1.8 snapshot cron, so trajectory is real not retrofitted.
- **Profile** — `student_model`, observational only; Strategies + Powers accrue from behavior, **per `(student_id, class_id)`** (migration 029, §2.4). Never assigned upfront (§15: "the student is not a data set").
- **Teacher action log** (LIFT migration 040) — records the success-metric-#1 click (§5.1a, §11.8).
- **Media asset** — generated illustrations/diagrams/audio, with per-school usage counters for tier limits (feeds §6 metering). **Flux URLs expire in ~10 min → persist immediately on generation** (LIFT V1 `persistImage`; §3.3, §7.4).
- **Student IEP** (LIFT migration 053) — IEP/504 fields feeding accommodation-aware generation.
- **License** — see §6 (`school_licenses`, `license_keys`, etc.).

### 2.2 Tables the integration/platform layers add

- **`platform_links`** (generalizes SPARK's `core_spark_links`): one row per CORE-school↔product link, columns `school_id, product, enabled, api_key, core_base_url`, plus the §7 GA-rework columns `key_version, rotated_at, expires_at`. **This config row is the only thing in §7 that is genuinely generic** (§7 framing note).
- **`webhook_idempotency_keys`** (lift SPARK migration 029 shape): `(endpoint, idempotency_key UNIQUE, status_code, response_body, created_at, expires_at)`.
- **`eval_candidates`** (LIFT migration 066): `scope, input, expected_output, raw_output`, stratification cols (`grade_band/subject/comprehension_band/learning_style`), `reviewer_notes`, `source_attempt_id`, `barb_reviewed`, `promoted_at`.
- **LMS connector + roster identity tables** (LIFT migrations 074/075) — GC course-link, identity anchoring (`rosterIdentity.ts` pattern), grade pull/push records.

### 2.3 Trial-state source of truth (reconcile the two models — locked decision needed)

V1 stores trial state in **two places with two `provisionTrial` functions**, and P1 must pick one source of truth and document the read path for every gate:

- **`schools` table (migration 035):** `is_trial`, `trial_started_at`, `trial_expires_at`, `trial_status` (CHECK `inactive|active|expired|converted|cancelled`), `trial_plan='pro'`, `trial_credentials` jsonb. Written by the **account-level** `lib/trial/provisionTrial.ts`.
- **`school_licenses` (migration 035 trial cols):** `status='trialing'`, `trial_starts_at`, `trial_ends_at`, `trial_converted`. Written by the **license-level** `lib/licensing/trial.ts::provisionTrial` (sets `student_limit=300`, `tier='professional'`).

**Decision for P1:** `school_licenses.status` is the **authoritative source for all gating** — `checkFeature`, `useLicenseGate`, `checkUsageCap`, `enforceActiveLicense`, and the trial cron all read `school_licenses`. `schools.is_trial/trial_status/trial_credentials` is **derived/presentation state** (used by onboarding and the welcome email), kept in sync by the provisioning flow. The two `provisionTrial` functions are disambiguated by path and role: `lib/trial/*` provisions the **account + school + demo data**, then calls `lib/licensing/trial.ts` to provision the **license row**. Both referenced explicitly in the lift table.

### 2.4 Context granularity — reconcile per-student / per-class / per-skill (do not pile up special cases)

The draft introduced per-skill state as a *third* grain without reconciling the two that already exist. P1 defines the granularity model **once**:

- **Canonical hierarchy:** `(student_id, class_id, skill_id)` with rollup. Legacy global per-student `student_model` rows (null `class_id`) are treated as the global rollup.
- **`student_model` (migration 029)** is already per-`(student_id, class_id)` (unique on `(student_id, class_id)`, null = legacy global). **Learner Profile, the 12 Strategies, and the 5 Powers live here, per-class** — they are cross-cutting and behavioral, not per-skill. (§8.2's "per-student band" claim is corrected to "per-class, migration 029.")
- **`skill_learning_state` (migration 072)** is per-`(student_id, skill_id)`. **CL and the misconception signal live here, per-skill.**
- **Source-of-truth rule when grains disagree:** for a *skill-specific* question (CL on this skill, the misconception on this skill), `skill_learning_state` wins; for a *cross-cutting* question (which Strategies/Powers this student shows in this class), `student_model` wins. They answer different questions and are not expected to agree.
- **Dependency:** signals re-key onto this hierarchy in M2; the engine must emit skill-tagged attempts in M1/M2 (§2.1) or per-skill state has no input.

### 2.5 Licensing tables (detail in §6)

`school_licenses` (one per school, UNIQUE on `school_id`, reserved Stripe columns), `license_keys` (HMAC burn ledger), `license_usage`, `license_events`, `billing_invoices` (PO/check/wire — no Stripe), `user_sessions`, `login_anomalies`, `platform_config` (maintenance singleton), `platform_events` (media metering). `schools.allowed_email_domains` (jsonb, domain lock). `enrollments` carries the `trg_enforce_enrollment_limit` BEFORE-INSERT trigger.

---

## 3. Generation Engine

> Scope refs: SCOPE.md §4 (the engine — the heart of CORE), §4a (grade-anchored difficulty), §4b (adaptive Q4–Q5), §4c (per-skill CL), §5 (media-rich outputs). LIFT V1's prompt **text** verbatim; the genuine net-new is the CL verb mapping, the misconception taxonomy formalization (Barb-gated, §10), and the **grading-path request-shape rebuild** if Opus is selected. Consumes the §1.3 registry + §1.4 wrappers.

### 3.1 Pipeline

**Lesson Plan → Quiz (3 MCQ + 2 OEQ) → read cognitive + behavior signals → set CL + detect Learning Strategies → generate Differentiated Assignment + Spark Challenge + Super TELI support.**

- **Lesson plan.** One sentence or one upload in → CORE writes the full plan, passage, objectives, key concepts. **Review, edit, publish** (the teacher is in the loop). Lift `app/api/teacher/lessons/parse/route.ts` logic into `lib/engine/` (§3.4).
- **Quiz: 3 MCQ + 2 OEQ.** MCQs read comprehension fast; the **2 OEQs are the engine** (reasoning, critical thinking, and the *specific misconception*). AI-graded with a rubric, eval-gated from day one. Lift `lib/teacher/generateQuizForLesson.ts` + the quiz prompt in `lib/openai/prompts.ts`.
- **Grade-anchored difficulty (§4a — hard constraint).** Questions generated to the student's **grade level** — a Grade 6 and Grade 12 item on the same skill differ in difficulty. Lift V1's Bloom-to-grade calibration in the quiz/assignment prompt. Surface a **grade selector, not a difficulty slider**.
- **Adaptive Q4–Q5 (§4b).** Within-attempt reshape (Q1–Q3 MCQ % → Q4–Q5: **0–50 scaffolded / 50–79 grade / 80+ advanced**); lift `adapt/route.ts`. **SCOPE divergence — flagged (see Residual Open Questions):** SCOPE §4b frames reshape as *sequenced* ("cold-start is a fixed 3 MCQ + 2 OEQ at grade level; once CORE has enough history, Q4–Q5 reshape"), but V1's actual behavior is *always-on within-attempt* reshape off Q1–Q3. P1 ships V1's always-on behavior (it is the proven, calibration-locked path) and flags the divergence for a SCOPE call; if history-gating is retained, "enough history" must be defined.
- **OEQ grading (the highest-stakes path).** Lift `GRADING_SYSTEM`/`gradingPrompt` (prompt 514–648) **text** verbatim. **This is not a verbatim file copy:** V1's `submit/route.ts` is **1,449 lines making 5 distinct LLM calls** (Claude grading at temperature 0.2 + GPT-4o calls for learning-style/insights at temp 0.3–0.7 with `response_format: json_object`). If the registry selects an Opus 4.x grader, **every Claude call must be re-shaped** to `output_config` structured output, sampling params stripped, prefills removed, and the `JSON.parse` contract re-derived (§1.3). Scored 0 / 0.5 / 1.0. Claude primary → GPT fallback. **Week-1 spike (mandatory, §10.5):** run the chosen grader against 5–10 hand-graded OEQs *before* committing M1 to it — if Opus structured output shifts the grade distribution vs V1's temp-0.2 Claude, the calibration-locked corpus premise weakens; decide Opus-vs-keep-Sonnet/GPT on day 3, not at soak.

### 3.2 CL, Learning Strategies, and the misconception taxonomy

- **CL = Reinforce / On Track / Enrich (§4c) — a verb mapping over the existing per-skill state.** The per-skill model already exists (`skill_learning_state`, 6 states, migration 072 — a **LIFT**, not net-new). The genuine net-new is the **CL verb mapping**: the 3 teacher verbs are a display layer over the 6 V1 states. Defined mapping for P1:
  - `needs_different_instruction`, `needs_more_time` → **Reinforce**
  - `on_track` → **On Track**
  - `ready_to_extend` → **Enrich**
  - `insufficient_data`, `not_attempted` → **"Not yet assessed"** (cold-start; null CL, never a fabricated verb)
  - This mapping is the Barb delta (ratify it), **not** the per-skill existence. Whether to keep `confidence`/`observation_count`/`last_reteach_outcome` surfaced or internal-only is a Barb call (Residual Open Questions). The cold-start "Not yet assessed" UI state is genuinely net-new and must be designed for One Student (§5.1b).
- **CL drives generation:** Reinforce → scaffolded work + more Super TELI. On Track → grade-level. Enrich → Spark / stretch + Socratic-only Super TELI.
- **Learning Strategies (12) detection.** Quiz *seeds* LS weakly; **behavior signals confirm over time** (observation supersedes; never a day-one verdict). LS/Learner Profile stay cross-cutting + per-class (`student_model`, §2.4), not per-skill.
- **Misconception taxonomy (§6b — formalize the existing enums, Barb-ratified).** Not greenfield: V1 already emits a closed **8-value `error_type`** (`none|factual_error|reasoning_gap|incomplete|misunderstood_question|vocabulary_confusion|off_topic|blank`), a **6-value `reasoning_pattern`** (incl. a literal `misconception` value), `misinterpretation_detected`, and `vocabulary_difficulty` (`prompts.ts` 589–612), plus a recurring-error matcher (`lib/reports/diagnosis.ts::findRecurringError`, threshold ≥3, drives a `check_concepts` action). P1's work: **(a)** formalize these enums into a first-class taxonomy table; **(b)** key the matcher to `skill_learning_state` so a misconception is per-skill; **(c)** surface it on One Student. The Barb decision shrinks from "invent a taxonomy" to "ratify/extend these 8 error types + 6 reasoning patterns." Until Barb signs off, the surface uses the raw (already-structured) `error_type`/`reasoning_pattern` values directly — the fallback is structured, not freetext.

### 3.3 Media-rich outputs (detail in §6)

Every passage, question, and hint can be read aloud; students can speak back; assignments include generated illustrations and diagrams. Media generation defaults-on (TTS/Whisper/Flux/diagrams all tiers; Runway video Pro+). Metering is owned by §6.

- **Per-task modality descriptor (net-new abstraction — replaces the ad-hoc `isReadingTask` boolean).** The engine emits an `affordances` descriptor on each generated task (e.g. `{read_aloud, voice_in, text_in}`). Both the client (hide the mic) and the server guard (422) read this **one descriptor** rather than re-deriving "is this a reading task." This single field enforces "voice only on non-reading tasks" (§6.7) *and* every future modality rule (no read-aloud of an answer field, no voice on math-symbol entry) without a new bespoke flag each time. There is no task-modality concept in V1 — this is built once, correctly, in the engine.
- **Persist Flux media immediately (build requirement, not an open risk).** Flux URLs expire in ~10 min; LIFT V1's `persistImage` so any generated illustration/diagram is persisted to storage on generation. A stale/expired media URL at render is a correctness bug for a loop product.

### 3.4 Lib/route split (mandatory for the eval rig — M1 deliverable)

Each AI path is a **pure, import-safe `lib/engine/` function** (no `next/server`, no `cookies()`, no SDK side-effects at import) that the route handler **and** the eval runner both import. Build the engine lib-first, not route-first. This closes the §11.3 gotcha (the eval rig can only wire `invokeCandidate` against import-safe functions) — make "engine exposes headless entry points" an explicit M1 deliverable, not an M7 discovery. Targets: `lib/engine/{grading,quizGen,assignmentGen,adapt}.ts`.

### 3.5 Error contract (net subsection — every route family)

Beyond licensing's status codes (§6.3/§6.4), the engine and integration routes define explicit error behavior via a **standard error envelope** `{ error: {code, message, retryable, userMessage} }`:

- **Terminal LLM failure** (primary+fallback exhausted): route returns `503` + `retryable:true` + a "try again" `userMessage`; grading never returns a fabricated or partial score. The attempt stays ungraded and re-queueable.
- **`stop_reason:"refusal"`:** handled before reading `content[0]`; surfaces as a neutral "couldn't process this response" to the teacher, logged for review — never a crash.
- **JSON-parse / Zod-validation failure** on structured output: treated as a terminal failure for that call (503), logged with the raw output for debugging; no partial persistence.
- **Partial generation** (e.g. 3 MCQ produced, OEQ gen failed): the whole quiz generation rolls back; nothing half-generated is published. Teacher sees a retry.
- **Spark sync-handoff timeout (35s, §7.4):** **soft-degrade** — the assignment remains usable; the Launch button shows "challenge generating, check back" and `spark_sync_failed` gates it; never a hard error that blocks the assignment.
- **Fail-open metering meets fail-closed licensing (both DB + Redis down):** licensing **fail-closed wins** — `enforceActiveLicense` blocks the write (security/compliance over availability); media metering's fail-open is moot because the gated write never reaches the metered provider call. Document this precedence so the two policies don't contradict at runtime.

### 3.6 Durable execution — Vercel Workflow DevKit (generation pipeline)

> Architecture decision (SCOPE §4e): the **background** generation pipeline runs on the Vercel Workflow DevKit. WDK adoption is scoped to **this pipeline + the §7.4 Spark round-trip only** — not Super TELI, crons, or media polling.

- **Shape.** A `"use workflow"` orchestrator drives the pipeline; **each AI call is a retryable `"use step"`** (lesson parse, quiz gen, adapt, OEQ grading, assignment gen). The §3.4 `lib/engine/*` functions **are** the step bodies, so the eval rig and the workflow share one import-safe entry point.
- **Why.** Automatic retry (with the §1.4 fallback *inside* the step), results **persisted for replay** — a mid-pipeline model failure resumes from the last completed step, not from scratch — and crash-safety on Vercel Fluid Compute. Map the §3.5 error contract onto WDK errors: `FatalError` (refusals, 4xx, JSON-parse/Zod failures → no retry) vs `RetryableError` (429/5xx/timeouts → backoff).
- **Boundary (critical).** The teacher's interactive "create a differentiated assignment in <5 min" hero path (§16d) **stays synchronous/streaming** for the snappy feel. WDK governs durable/background generation and any regeneration — *not* the live request. If a create action is heavy, kick off the workflow and stream/poll its result; don't make the teacher wait on a durable run.
- **Constraints.** Step inputs/outputs must be serializable (no class instances/functions — pass data, not callbacks); keep secrets/Node APIs inside steps, orchestration logic in the workflow. Read `node_modules/workflow/docs/` once the `workflow` package is added (it is **not** in the current scaffold — adding it is an M-stage task).

---

## 4. Signals → Actions

> Scope refs: SCOPE.md §6 (signal set + gap=20), §3 (the loop). LIFT V1 formulas/thresholds. A signal reaches the screen **only if** it passes the 5-second test *and* resolves to a plain-language action; everything else lives one tap down. **8-signal set locked; gap threshold = 20.** Signals re-key onto the §2.4 granularity hierarchy in M2.

| Signal | Source (lift) | Who | Action it triggers |
|--------|---------------|-----|--------------------|
| **Comprehension Level (per skill)** | `lib/skills/computeSkillState.ts` (state) → CL verb mapping (§3.2) | Teacher | Reinforce / leave on track / enrich |
| **Assignment-vs-Quiz gap** | `lib/signals/computeHwQuizDivergence.ts` (fires at `divergence_score ≥ 20`; alignment ±10) | Teacher | Review submissions — integrity, format, or anxiety |
| **Effort vs ability** (4 labels) | `lib/signals/computeEffortLabel.ts` (success ≥75%, effortful = ≥2 hints) | Teacher | Reteach the concept, or just check in |
| **Direction (sliding / climbing)** | `lib/signals/signalComputer.ts` (consistency + velocity, off snapshots) | Teacher + Student | Watch & check in / celebrate the climb |
| **Did-the-intervention-work (mastery moved?)** | `lib/signals/computeReteachEffectiveness.ts` + mastery-regression alert (`lib/studentModel.ts` 326–353) | Teacher | Confirm complete, or escalate — **the loop closer, in-pilot** |
| **The specific misconception (from OEQs)** | structured `error_type`/`reasoning_pattern` enums + `findRecurringError`, keyed to skill (§3.2, Barb-ratified) | Teacher | Targeted practice on that exact thing |
| **Personal growth over time** | snapshots / trajectory (`lib/studentModel.ts` 259–277) | Student | "You're getting better at X" (**vs own past, never peers**) |
| **One next step, plain words** | `lib/briefing/regenerateSignalWhy.ts` (cache: migration 041) | Student | Do this one thing |

- **Risk Index (Pro feature).** Weighted ensemble across the above — `lib/signals/computeRiskIndex.ts` + `signalComputer.ts` 310–367. Gate with `checkFeature`. Surfaced at school scale on the School Admin screen.
- **CL formula note:** `computeMasteryBand` (≤50/51–79/≥80, rolling avg of last 5) is the **per-student quiz-band instrument** — it is *not* the per-skill CL. Per-skill CL comes from `skill_learning_state`/`computeSkillState.ts` (§2.4/§3.2). Do not compute per-skill CL via `computeMasteryBand`; the two are different instruments.
- **V1 credibility risk:** don't claim a learning *strategy* from 5 answers — comprehension you can read from a quiz; strategy is behavioral and accrues. "Observation supersedes."
- **Recalibrate** the noisier V1 heuristics (frustration, attention) from pilot data; consider hiding the noisiest sub-signals at school scale until recalibrated.

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