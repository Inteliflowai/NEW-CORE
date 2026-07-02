# Open in SPARK — Teacher Review of Student SPARK Work (Item D)

**Date:** 2026-07-01 · **Status:** Decisions locked (Marvin), ready for writing-plans
**Grounding:** `docs/superpowers/specs/2026-07-01-open-in-spark/grounding/` (6 verbatim current-code reports: spark-auth, spark-attempt-data, spark-tenancy, core-side, v1-reference, security-constraints)

## Goal

A teacher looking at a student's scored SPARK challenge in CORE can open the student's **actual work** — the challenge the student saw, their step-by-step answers, and the full scoring detail — without leaving CORE.

## Locked decisions (Marvin, 2026-07-01)

- **D1 — Architecture: embed in CORE.** No teacher SSO into SPARK, no SPARK-side teacher UI. The review renders inside CORE, fed by ONE new read-only action on SPARK's existing school-scoped server-to-server API (`POST /api/integration/core`, Bearer per-school `api_key`). Rationale: SPARK's April 29 pivot ("teachers interact with CORE" — teacher UI deliberately retired in `f881f39`); V1 precedent (embedded `TeacherRubricViewer`, never linked out); the existing handoff can only mint *student* sessions (impersonation risk) and SPARK has no rate limiting.
- **D2 — Depth: full work view.** Challenge content + the student's per-step answers + 7-dimension rubric + AI observations + effort/revision/hint counts. This exceeds V1 (which showed rubric + narrative only; the raw answers exist in `experiment_attempts.evidence.step_responses` but NO page anywhere renders them today).
- **D3 — Mount point: Spark Challenges page only.** Expand a challenge row → "View student's work" panel (on-demand fetch, gradebook-drill-in "Student's work" pattern). Not mounted in gradebook/One-Student this epic.

## Hard constraints (from grounding)

1. **Teli transcripts DO NOT EXIST.** SPARK never persists tutor conversations (privacy promise surfaced to students: "teachers see that Teli was used, but not what was said" — `teli/route.ts:94-99`). The review may show `teli_hint_count` ONLY. The UI must not imply a transcript exists.
2. **Read-only, no session.** The SPARK-side action is a pure read on the existing API-key surface. No `spark_users` row created, no Supabase session, no cookies. The teacher never authenticates to SPARK.
3. **Tenancy (SPARK side):** the per-school `api_key` IS the tenant. Every query filters by `link.spark_school_id`; cross-school probes return **404, not 403** (house pattern from PR #5, `integration/core/route.ts:196-211`). Must not regress PRs #4–#7 patterns (constant-time secrets, school predicates, SSRF guards).
4. **Auth chain (CORE side):** `createServerSupabaseClient()` → `getUser()` → STAFF_ROLES → resolve assignment → `guardClassAccess(assignment.class_id)` → admin client. Standard house chain; the SPARK call happens only after the IDOR guard passes.
5. **Fail-soft:** SPARK unreachable/slow (10s timeout, the `spark-client.ts` house pattern) → friendly "couldn't reach SPARK right now" state. NEVER block or crash the challenges page; the panel is on-demand.
6. **Four-audience:** this is a TEACHER-ONLY surface — rubric dimensions, observations, and effort labels are allowed. But `student_profile_snapshot` (contains `mastery_band` etc.) is NOT needed for review and is EXCLUDED from the wire payload (don't ship diagnostic machinery that the panel won't render).
7. **No migration** on either side. All data already exists.
8. **Copy → `STRINGS-FOR-BARB.md §Open in SPARK review`.** Barb gates all strings.

## Design

### SPARK side (small PR to spark-platform, master)

New action **`get_attempt_review`** in `app/api/integration/core/route.ts` (joins the existing 5 actions; same Bearer `core_spark_links.api_key` auth, same school scoping style as `get_attempt_result` at `route.ts:335-419`).

- **Input:** `{ core_homework_id, core_student_id }` — matches what CORE natively holds (`assignments.id` + `users.id`); resolved against `spark_users.core_user_id` on the SPARK side; avoids depending on `assignments.spark_attempt_id` (text, absent on `notify_failed` rows). *(Field name updated post-ship: the plan/implementation standardized on `core_student_id`, matching the existing `get_student_profile` action's naming.)*
- **Resolution:** `spark_users` by `core_user_id` + `school_id = link.spark_school_id` (404 if absent) → `experiment_attempts` by `core_homework_id` + `student_id` (404 if absent) → verify attempt's session school = link school.
- **Output (read-only):**
  - attempt: `state, started_at, completed_at, score, effort_label, revision_count, teli_hint_count`
  - `step_responses` from `experiment_attempts.evidence.step_responses[]` (`{step_index, type, value, completed}`)
  - challenge: from `experiment_attempt_content.generated_content` — the sections needed to give the answers context (scenario, challenge_question, role_assignment, output_options, reflection_questions; the plan pins the exact step↔section mapping from the runner's `StepRenderer` so answers can be labeled with the prompt the student answered)
  - analysis: latest `spark_ai_analysis` `experiment_scoring` row — `rubric_dimensions`, `dimension_observations`, `key_observations`, `content_quality`
  - EXCLUDED: `student_profile_snapshot`, raw signals tables, Teli anything beyond the count
- **Size:** evidence is already capped at 100 KB at submit; response is bounded. No pagination needed.

### CORE side (main build, new-core)

1. **Route `GET /api/teacher/challenges/attempt?assignmentId=…`** — house auth chain (constraint 4), resolves the assignment row (student_id, class_id, school via class), `getSparkLink(admin, schoolId)` for the per-school `api_key`, POSTs SPARK `get_attempt_review`, validates/maps the payload, returns it. 404 when SPARK has no attempt; 502-mapped friendly error on SPARK failure.
2. **UI panel** in the challenges drill-in: expanding a challenge row gains a "View student's work" affordance on scored/in-progress rows → on-demand fetch → panel renders:
   - challenge context (scenario + question, collapsed by default)
   - per-step student answers (labeled with the step prompt; drawing/upload-type values rendered as labeled links only if present — plan confirms what value types occur)
   - observations (the AI's written notes) — *the rubric `/4` marks, engagement word, and effort/revision/hints line are NOT repeated inside the panel: they already show on the expanded challenge card directly above it (Marvin accepted this co-location reading 2026-07-01: "scores show once"). If this panel is ever mounted where no card sits above it (gradebook, One-Student), those lines must move into the panel.*
   - loading / error / "nothing submitted yet" states (Coach-posture: quiet, observational)
3. **`loadChallenges` unchanged** (correlation is `assignmentId` + `studentId`, both already on `ChallengeRow`).

### Deploy order

SPARK PR first (action is additive, dead until called) → then CORE. CORE's fail-soft state covers any gap.

## Non-goals (this epic)

- Teacher SSO into SPARK; any SPARK-side UI.
- Gradebook / One-Student mount points (future follow-up if Barb asks).
- Raw behavioral/cognitive signal rendering.
- Populating `spark_completions.spark_attempt_id` (known-unpopulated; not needed by this design).
- SPARK rate limiting (pre-existing gap, tracked separately).

## Risks & mitigations

- **SPARK payload shape drift** (generated_content is an 8-section LLM-authored template): CORE validates defensively and renders only known fields; unknown/absent sections degrade to the answers-only view.
- **Old attempts without `experiment_attempt_content`** (pre-025 rows): challenge context section degrades gracefully; answers + rubric still render.
- **Cross-repo review discipline:** SPARK PR gets its own adversarial review against the PR #4–#7 invariants (school scoping, 404-not-403, no writes).
