# SPARK Integration — Phase 1 (Teacher-Bookended Live Loop) — Design Spec

**Date:** 2026-06-20
**Status:** Scope approved (decomposition + sequencing signed off); ready for plan after user spec review
**Branch:** `feat/teacher-app-shell` (Phase 1 folds shell S2/S3 + merges the held shell at the end)
**Grounding:** `.superpowers/grounding-spark.md` + `.superpowers/grounding-spark-v2.md` (verbatim V1 contract + V2 substrate facts)

---

## 1. Goal

Stand up the **teacher-bookended SPARK loop** in V2, wired to the live SPARK platform: a teacher generates a SPARK-enabled assignment → CORE notifies SPARK and a challenge is created → the student completes it in SPARK → SPARK posts the completion back → CORE ingests it, feeds the skill engine, and shows it on a new **teacher "Spark Challenges" screen**. Ship the shell's **SPARK recognition (S2 sticker + S3 nav)** as part of this, then **merge the held shell**.

## 2. Scope

**In scope (Phase 1)**
- **Provisioning & foundation:** `spark_completions` table; assignment↔SPARK binding columns; `SPARK_API_URL` config; `platform_links` SPARK-key provisioning (seed for the demo school + a minimal admin path); `spark_experiences` license gate; an `external_identities` resolver.
- **CORE→SPARK create-notify:** fire SPARK's `/api/integration/webhooks/core` when a teacher generates a SPARK-enabled assignment; persist the returned `spark_attempt_id` / `synthetic_experiment_id`.
- **SPARK→CORE completion ingestion:** implement `POST /api/attempts/spark-attempt-complete` — the exact path SPARK already calls (auth + idempotency + CORE-native identity → write `spark_completions`) → feed `recomputeSkillStates`; implement the `idempotency-sweep` cron. **No SPARK code change** — routing the demo school to V2 is a `core_spark_links.core_base_url` DB row on SPARK's side.
- **Teacher "Spark Challenges" screen** (the S3 target): class-level per-student assigned / in-progress / completed + 7-dim rubric & transfer score (teacher-only).
- **Shell:** S2 (SPARK sticker under the CORE plate) + S3 (Spark Challenges nav → the screen) folded into `TeacherSidebar`/`navConfig`; then **merge `feat/teacher-app-shell`** → deploy.
- **Demo seed:** seed `spark_completions` for demo students so the screen + skill enrichment are demoable without a live round-trip.

**Out of scope (Phase 2 / later)**
- The **V2 student assignment app** (`/student/assignments` list + detail + attempt) and the **SPARK launch** card + JWT launch route. V2 has no student app yet — this is the next phase.
- Parent-facing SPARK surface; BR/EduFlux locale (`pt-BR`) in the SPARK payload (send `en-US`).
- Auto-fire-on-homework-submit (V1's path) — Phase 1 creates challenges from **teacher assignment generation**, not student submission (no student submit UI yet).

## 3. The contract (verbatim, from V1 + spark-platform)

**CORE → SPARK (create):** `POST {SPARK_API_URL}/api/integration/webhooks/core`
- Headers: `Authorization: Bearer {CORE_SPARK_API_SECRET}`, `X-Idempotency-Key: {core_homework_id}_{student_id}`, 35s timeout.
- Body: `{ event:'spark_assignment_created', data:{ spark_assignment_id, core_homework_id, student_id, school_id, core_class_id?, teacher_id?, due_date?, lesson_plan:{content, concept_tags[], subject_domain, title?, grade_band?}, student_profile:{grade?, learning_style?, student_band?, iep_accommodations?, rubric_rolling_averages?, learning_pattern_flags?, locale}, session_config? } }`
  - `grade_band` ∈ `'3-5'|'6-8'|'9-12'` (SPARK rejects K-2). `student_band` ∈ `mastery|developing|struggling` (map from CORE `advanced|grade_level|reteach`). `rubric_rolling_averages` sent ONLY when the student has SPARK history.
- Returns: `{ success, session_id, spark_attempt_id, spark_user_id, synthetic_experiment_id, generation_status }`. Never 5xx — `{success:false,error}` on failure.

**SPARK → CORE (complete):** `POST {core_base_url}/api/attempts/spark-attempt-complete` — V2 implements **this exact path** (it's where SPARK's `lib/integration/core-client.ts` already posts; `core_base_url` is resolved per-school from SPARK's `core_spark_links`, so we point the demo school at `https://newcore.inteliflowai.com`).
- Headers: `Authorization: Bearer {CORE_SPARK_API_SECRET}`, `X-Idempotency-Key` (`{core_homework_id}_{student_id}` for submit; `..._scored` for the analyzer pass).
- Body (`AttemptCompletePayload`): `{ core_homework_id (= CORE assignments.id), student_id (CORE users.id — SPARK resolves it from spark_users.core_user_id; NO external_identities lookup needed), completed_at, score (0-100|null), effort_label|null, revision_count, teli_hint_count, signal_summary, rubric_dimensions:{problem_understanding,reasoning_strategy,use_of_evidence,creativity_application,communication,reflection_metacognition,collaboration} (1-4 ints, collaboration nullable; whole object null at submit-time), content_quality:'engaged'|'minimal'|'non_engaged'|null, bncc_codes?, bncc_competencias_gerais? (PT-only — V2 ignores) }`
- Arrival pattern: **submit-time** webhook (rubric/content_quality null) then a **delayed analyzer** webhook (`_scored` key) carrying rubric + engagement. Respond 200 always (`{ok:true,received:true}` / `{ok:true,deduped:true}`); 401 on bad auth; 400 on missing student.
- `transfer_score` = `avg(non-null rubric dims) × 25`, else fall back to `score`.

## 4. Global Constraints (binding)

- **Four-audience discipline.** The teacher Spark Challenges screen is **teacher-only** and may show rubric dimensions, transfer scores, and `content_quality` framing (diagnostic detail is teacher-appropriate). **No student/parent SPARK surface ships this phase.** SPARK completions feed `computeSkillState` → the existing teacher screens already render bands/CL-verbs (not raw spark numbers), so no new leak path opens. Run the leak audit on the new screen regardless.
- **"Assignments", never "Homework"** in any new UI string (DB identifiers like `core_homework_id`/`homework_attempts` are the legacy wire/identifier names — keep them).
- **Tokens only / WCAG-AA** for the new screen + S2/S3 (sidebar tokens already exist; the screen uses the calm content tokens). `npm run a11y` stays green. SPARK orange for S2/S3 accents must be added as a token if used on a gated text pair (or kept to non-text/decorative + the existing chip-on-white treatment, which needs no new gate pair).
- **Auth + IDOR:** every new teacher route uses the full chain (`createServerSupabaseClient` → `getUser` → STAFF_ROLES/role gate → object-level guard → `createAdminSupabaseClient`). The ingestion webhook authenticates via **constant-time** Bearer comparison against `CORE_SPARK_API_SECRET` (not user auth) and resolves the school via `platform_links`/`external_identities`.
- **Webhook discipline:** ingestion is **idempotent** (the `webhook_idempotency_keys` state machine) and **never returns 5xx** to SPARK for business errors (mirror SPARK's discipline) — log + 200 with a status body; reserve non-200 for auth(401)/malformed(400).
- **Next.js 16 App Router; Supabase admin client bypasses RLS (guards are the backstop).**

## 5. Sub-projects (design)

### SP-1 — Foundation & provisioning
- **Migration `spark_completions`:** `id uuid pk`, `school_id uuid fk`, `student_id uuid fk→users`, `assignment_id uuid fk→assignments (ON DELETE CASCADE)`, `spark_attempt_id text`, `score int2 null`, `effort_label text null`, `rubric_dimensions jsonb null` (the 7 dims), `content_quality text null CHECK in (engaged,minimal,non_engaged)`, `transfer_score int2 null`, `revision_count int null`, `teli_hint_count int null`, `signal_summary jsonb null`, `completed_at timestamptz null`, `received_at timestamptz default now()`. Indexes: `(student_id)`, `(assignment_id)`, `(school_id)`. RLS: service-role write; teacher read via class/IDOR (or admin-client-only reads through guarded routes — match the project's existing pattern).
- **Assignment binding:** add `spark_attempt_id text`, `spark_experiment_id text`, `spark_status text` (`none|notified|created|in_progress|completed`) to `assignments` (new migration; nullable/defaulted, additive).
- **Config:** add `SPARK_API_URL` to the config module + `.env.example`/`.env.local` (default `https://spark.inteliflowai.com`); it's validated like `CORE_SPARK_API_SECRET`.
- **Provisioning:** a seed/admin helper to write the demo school's `platform_links` row (`product='spark'`, `api_key`, `enabled=true`, `core_base_url`); a `external_identities` resolver `resolveCoreStudent(school_id, 'spark', external_id) → core_student_id`; a `licenseHasSpark(school_id)` gate reading the license feature.

### SP-2 — CORE→SPARK create-notify
- New lib `src/lib/spark/notifyAssignmentCreated.ts` (V2 port): builds the payload from the persisted assignment + the student model (band→spark band map; rubric rolling averages only when `spark_dim_attempt_count > 0` — note V2 may not have those columns yet; if absent, omit `rubric_rolling_averages`), POSTs to SPARK with Bearer + idempotency + 35s timeout, returns the result.
- **Hook point:** in `POST /api/teacher/assignments/generate` (after the assignment row is persisted, line ~125-137), **if** `sparkEnabled` AND `licenseHasSpark` AND a provisioned `platform_links` SPARK key exists → call `notifyAssignmentCreated`; persist `spark_attempt_id`/`spark_experiment_id`/`spark_status='created'` on the assignment. **Non-blocking:** a SPARK failure logs + sets `spark_status='notify_failed'` but never fails assignment generation.
- Add a teacher-facing `sparkEnabled` toggle on the generate path (or default per license) — minimal; the screen is the payoff.

### SP-3 — Completion ingestion (SPARK→CORE) + cron
- Implement `POST /api/attempts/spark-attempt-complete` (the path SPARK calls): constant-time Bearer check vs `CORE_SPARK_API_SECRET`; parse + validate; **idempotency** via `webhook_idempotency_keys` keyed on `(endpoint, X-Idempotency-Key)` (in_progress→completed/failed; replay returns the stored response — submit-time and `_scored` are distinct keys, last-writer-wins on the row); resolve **directly** by `student_id` (CORE `users.id`) + `core_homework_id` (= `assignments.id`) — no `external_identities` needed (SPARK echoes CORE-native ids); compute `transfer_score` = avg(non-null rubric dims) × 25 else `score`; **upsert** `spark_completions` (submit-time row created, analyzer pass updates rubric/content_quality/transfer); write a `platform_events` audit row (`source='spark'`); then `await recomputeSkillStatesForStudent(admin, {studentId, schoolId, skillIds})` where `skillIds` = the assignment's `skill_ids`. **Respond 200 always** for business outcomes (`{ok:true,received:true}` / `{ok:true,deduped:true}`); only 401 (bad Bearer) / 400 (missing ids) are non-200 (SPARK does not retry 4xx).
- **Feed the engine:** in `recomputeSkillStates.ts`, replace the hardcoded `spark: []` (line ~325) with a fetch of `spark_completions` for the student joined to the skill's assignments → map to `SkillSparkObservation[]` (`transferScore`, `contentQuality`, `completed`, `occurredAt`), filtering `content_quality ∈ {non_engaged,minimal}` OUT (engagement guard). `computeSkillState` already consumes this — no engine change.
- Implement `idempotency-sweep` cron: delete `webhook_idempotency_keys` past `expires_at`; return a summary.
- **spark-platform side — NO code change.** SPARK's completion callback is already implemented (`lib/integration/core-client.ts` → `{core_base_url}/api/attempts/spark-attempt-complete`, Bearer + idempotency + retries). Routing the demo school to V2 is a **DB row** on SPARK's Supabase: a `core_spark_links` row for the demo school = `{ core_school_id: <V2 demo school id>, spark_school_id: <a SPARK school>, core_base_url: 'https://newcore.inteliflowai.com' }`. That row ALSO lets SPARK accept the inbound create webhook (school must be linked). This is an ops/provisioning step (SQL on SPARK's DB), not a code deploy. **Phase-2 note:** SPARK's `isValidReturnUrl` allow-list must add `newcore.inteliflowai.com` for the launch back-button.

### SP-4 — Teacher "Spark Challenges" screen + shell S2/S3
- **Route:** `src/app/(teacher)/challenges/page.tsx` (server component, `?class=`), full auth+IDOR chain. Load: assignments for the class with `spark_status != 'none'` joined to `spark_completions`; derive per-student status (`assigned`=created/notified, `in_progress`, `completed`/`scored`). 
- **UI (teacher-only, tokens, calm):** a restrained class view — per-student rows or grouped-by-challenge cards showing status, transfer score (word + %), the 7-dim rubric (compact), and `content_quality` as a soft teacher label. **Dignified cold-start** when no challenges (`EmptyState` — "Generate a SPARK-enabled assignment to start a challenge"). Restrained per V2's stats ethos — the data is the star, no volume dump.
- **Shell S2:** add the SPARK sticker (white chip + `spark.svg`, "INSIDE CORE" tag) under the CORE plate in `TeacherSidebar` (already prototyped in the mockup).
- **Shell S3:** add a `CHALLENGES` nav entry "Spark Challenges" → `/challenges` in `navConfig` (with a bolt icon), gated/badged as appropriate.
- **Merge:** after SP-4 + full gates green, run finishing-a-development-branch → merge `feat/teacher-app-shell` → deploy.

## 6. Live-wiring switch (precise — from spark-platform + V1 config)
The shared secret already matches (`CORE_SPARK_API_SECRET=spark-core-secret-2026` on both repos' `.env.local`). To go live:
1. **V2 Vercel env:** `SPARK_API_URL=https://spark.inteliflowai.com`; ensure `CORE_SPARK_API_SECRET=spark-core-secret-2026` (the prod Vercel value must equal SPARK's).
2. **V2 DB:** a `platform_links` row for the demo school (`product='spark'`, `enabled=true`) — V2's "is this school SPARK-enabled" gate. (Seedable.)
3. **SPARK DB (ops):** a `core_spark_links` row for the demo school (`core_school_id` = V2 demo school id, `spark_school_id`, `core_base_url='https://newcore.inteliflowai.com'`) — links the school AND routes its completions to V2. Provide the SQL for the user/ops to run on SPARK's Supabase.
4. **License:** `spark_experiences` enabled for the demo school (confirm V2 has a license system; else gate on the `platform_links` row).

Build SP-1..SP-4 against the contract + **demo-seed `spark_completions`** so the screen + skill enrichment demo immediately. With (1)-(4) set, real round-trips flow end-to-end (teacher generates → SPARK creates → student completes in SPARK → SPARK posts to V2). No SPARK code deploy needed.

## 7. Testing
- **Pure helpers (node):** band→spark-band map; `transfer_score` compute (avg×25, fallbacks); idempotency-key format; payload builder (rubric omitted when no history; grade_band mapping; locale en-US).
- **Ingestion route (node):** 401 bad Bearer; 400 missing student; first call writes + 200; replay → `deduped:true`; submit-then-analyzer updates the same row; `non_engaged/minimal` excluded from skill evidence; identity resolution via `external_identities`.
- **recomputeSkillStates (node):** with seeded `spark_completions`, `SkillSparkObservation[]` reaches `computeSkillState` and shifts state/confidence as designed (engine logic already tested).
- **Teacher screen (jsdom):** renders per-student status + scores; cold-start when empty; **leak audit** — no student-facing leak; "Assignment" not "Homework".
- **Shell (jsdom):** S2 sticker renders the logo; S3 nav item active-state → `/challenges`; existing shell tests stay green.
- **Gates:** full suite + `tsc` + `npm run a11y` + `npm run build` green. Adversarial whole-branch review before merge.

## 8. Risks / notes
- **No student SPARK history columns in V2** (`spark_dim_*` on a student_model) — V2 may lack these; if so, omit `rubric_rolling_averages` from the create payload (the contract allows absence; cold-start parity). Confirm during plan grounding.
- **No spark-platform code change** for Phase 1 — SPARK's callback is implemented; the only SPARK-side action is the `core_spark_links` DB row (ops). (A code change — adding `newcore.inteliflowai.com` to SPARK's `isValidReturnUrl` allow-list — is a Phase-2 item for the launch back-button.)
- **Live dependency:** end-to-end live demo needs SPARK provisioned; the seed path keeps the screen demoable meanwhile.
- **Don't fabricate:** the screen shows only real (or demo-seeded) completions; cold-start otherwise.
