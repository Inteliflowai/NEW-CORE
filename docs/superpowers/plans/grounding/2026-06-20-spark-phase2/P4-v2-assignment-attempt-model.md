# P4 — V2 (NEW-CORE) Assignment + Attempt Data Model & Player Grounding

Repo: `C:/users/inteliflow/NEW-CORE` · Surface: assignment + attempt data model + any student player (sub-project B). READ-ONLY verbatim facts. No proposals.

---

## 0. HEADLINE GAP (read first)

**There is NO student-facing attempt PLAYER anywhere in V2.** No page where a student reads an assignment / quiz and submits responses. What exists:

- The only student route that exists is `src/app/(student)/student/dashboard/page.tsx` — a 10-line **placeholder** ("Your CORE space is being set up").
- The student layout (`src/app/(student)/layout.tsx:19,22`) links to `/student/assignments` and `/student/growth`, but **neither page file exists** (Glob of `src/app/(student)/**/*.tsx` returns only `layout.tsx`, `student/dashboard/page.tsx`, and a guard test).
- There is **no create-attempt route** (no POST that inserts `quiz_attempts` or `homework_attempts`). Grep for `.from('quiz_attempts').insert` / `homework_attempts.*insert` across `src/**/*.ts` matches **only** `src/lib/trial/seedTrialDemoData.ts` (seed, not a request handler).
- There is **no response-save route** — `quiz_responses` is touched only inside `submit`, `adapt`, the teacher generate route, and the weekly-snapshot cron. The submit route assumes `quiz_responses` rows **already exist** (it `.update()`s them, never inserts them).

So the existing attempt machinery is: teacher generates the quiz → (some not-yet-built UI inserts the attempt + responses) → `adapt` → `submit` grades. The student player is the missing middle.

---

## 1. Schema — assignments + homework_attempts (+ spark_* cols)

### `public.assignments` — base, `supabase/migrations/0004_assignments_homework.sql:4-22`
```sql
CREATE TABLE IF NOT EXISTS public.assignments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_attempt_id         uuid REFERENCES public.quiz_attempts(id),
  student_id              uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  class_id                uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  lesson_id               uuid REFERENCES public.lessons(id) ON DELETE CASCADE,
  mastery_band            text CHECK (mastery_band IN ('reteach','grade_level','advanced')),
  assignment_mode         text DEFAULT 'standard',
  learning_style          text,
  content                 jsonb NOT NULL,                 -- the Assignment shape (see §2)
  status                  text DEFAULT 'draft',           -- 'draft' on insert; no CHECK constraint
  teacher_reviewed        boolean DEFAULT false,
  teacher_override_reason text,
  push_status             text DEFAULT 'pending',         -- 'pending' default; no CHECK; not written by any read code found
  reteach_needed          boolean DEFAULT false,
  scaffold_level          text,
  due_at                  timestamptz,
  created_at              timestamptz DEFAULT now()
);
```
Added later:
- `skill_ids uuid[] NOT NULL DEFAULT '{}'` — `0005_skills.sql:44-45`
- `generation_model text` — `0010_engine_columns.sql:71-72`
- SPARK cols — `0012_spark.sql:8-12`:
```sql
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS spark_assignment_id text,   -- CORE-generated correlation id sent to SPARK
  ADD COLUMN IF NOT EXISTS spark_attempt_id    text,   -- SPARK's returned spark_attempt_id
  ADD COLUMN IF NOT EXISTS spark_experiment_id text,   -- SPARK's returned synthetic_experiment_id
  ADD COLUMN IF NOT EXISTS spark_status        text DEFAULT 'none';
-- CHECK: spark_status IN ('none','notified','created','in_progress','completed','notify_failed')   (0012:14-21)
```
NOTE re `status`/`push_status`: `'draft'`/`'pushed'` and `push_status` are NOT used by any code located — `loadChallenges` and the teacher generate route key off `spark_status` and `content`, not `status`. `status` is only ever written as `'draft'` (generate route, `:170`).

### `public.homework_attempts` — `0004:24-40`
```sql
CREATE TABLE IF NOT EXISTS public.homework_attempts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id     uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  student_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status            text DEFAULT 'in_progress',
  responses         jsonb,
  canvas_data       jsonb,
  score_pct         numeric,
  ai_feedback       jsonb,
  teacher_notes     text,
  teacher_score     numeric,
  teli_hint_count   int DEFAULT 0,
  submitted_on_time boolean,
  submitted_at      timestamptz,
  graded_at         timestamptz,
  created_at        timestamptz DEFAULT now()
);
```
**`homework_attempts` has NO code referencing it except the seed** (`seedTrialDemoData.ts`). No route reads or writes it. It is the legacy "assignment attempt" table but the engine actually grades via the **quiz** chain (`quiz_attempts`/`quiz_responses`), not `homework_attempts`.

### `public.spark_completions` — `0012_spark.sql:24-42` (one row per assignment×student)
Columns: `id, school_id→schools, student_id→users, assignment_id→assignments, spark_attempt_id text, score int2, effort_label text, rubric_dimensions jsonb, content_quality text CHECK('engaged'|'minimal'|'non_engaged'), transfer_score int2, revision_count int, teli_hint_count int, signal_summary jsonb, completed_at timestamptz, received_at, updated_at; UNIQUE(assignment_id, student_id)`. RLS: service_role full; staff school-scoped SELECT; **no student/parent read**.

### Quiz chain (the path that actually grades) — `0003_lessons_quizzes.sql`
- `quiz_attempts` (`:53-66`): `id, quiz_id→quizzes, student_id→users, session_id text, started_at, submitted_at, is_complete bool DEFAULT false, raw_score numeric, score_pct numeric, mastery_band text CHECK(reteach|grade_level|advanced), learning_style text, created_at`. Later adds (`0010:51-64`): `adapted_questions jsonb, grading_status text, grading_failed bool DEFAULT false` (+ raw_score/score_pct already present).
- `quiz_questions` (`:39-50`): `id, quiz_id, position int, question_type text CHECK` (extended to `mcq|open|numeric` in `0010:46-48`), `question_text, choices jsonb, correct_answer text, rubric text, concept_tag text`. `numeric_spec jsonb`, `rubric_version text` added `0010:14-19`. `skill_id` added in 0005 (per submit-route comment `:347`).
- `quiz_responses` (`:70-93`): `id, attempt_id, question_id, position int, response_text, is_correct bool, ai_score numeric, ai_score_explanation text, cognitive_notes text, question_type_scored text, rubric_version text, grader_source text DEFAULT 'ai', confidence numeric` + **behavioral telemetry**: `response_time_ms, hesitation_ms, answer_changes, navigation_backs, pause_count, total_pause_ms, word_count` (all int, DEFAULT 0), `created_at`. `grading_output jsonb` added `0010:67-68`.
- RLS write policies (`0003:140-152`): students may INSERT their own `quiz_attempts` (`WITH CHECK student_id = auth.uid()`) and their own `quiz_responses` — i.e. the schema **anticipates** a student player that inserts attempts/responses, but no UI/route does it yet.

---

## 2. Assignment content shape (what a student would render) — `src/lib/engine/types.ts:139-157`

`assignments.content` jsonb is locked to `AssignmentSchema`:
```ts
AssignmentTaskSchema = { step:int, description:string,
  type: 'read'|'write'|'draw'|'discuss'|'create'|'analyze',
  strategy:string, atl_skill:string, ib_attribute:string, bloom_level:string }

AssignmentSchema = {
  title: string, mode: string, learning_style: string,
  reading_passage: string (min 1), audio_script: string (min 1),
  diagram_mode: 'image'|'structured'|'none',
  diagram_description: string|null, diagram_svg_prompt: string|null, diagram_image_prompt: string|null,
  youtube_search_query: string,
  instructions: string,
  tasks: AssignmentTask[] (min 2),
  support_note?: string, extension_prompt?: string,
  atl_summary: string[] = [], ib_attributes: string[] = [],
}
```
This is a **rich differentiated lesson/assignment** (passage + audio script + diagram prompts + multi-step tasks), NOT a question set. The gradable question set is the separate **quiz** chain (`GeneratedQuizSchema`, `types.ts:69-82`): exactly 5 questions — positions 1-3 `mcq`/`numeric`, positions 4-5 `open` (rubric required). `AdaptedQuestionsSchema` (`:85-95`) replaces Q4/Q5 with 2 personalized open questions.

---

## 3. Attempt submit / grade path

### `src/app/api/attempts/[attemptId]/submit/route.ts` (POST)
- Auth: `createServerSupabaseClient()` → `auth.getUser()` → 401. Ownership: admin-client fetch of `quiz_attempts` with `.eq('student_id', user.id)` (RLS not the backstop). 404 if not found.
- Loads `quizzes(quiz_questions(*))` + existing `quiz_responses` (`position, response_text, is_correct`). **Responses must already exist** — submit `.update()`s `quiz_responses`, never inserts.
- Scoring: positions 1-3 deterministic (`scoreMCQ` / `checkNumericAnswer`); positions 4-5 OEQ via `gradeOpenResponse` (Claude→GPT) run concurrently. Never-half-grade: any failure → `grading_status:'pending'`, `grading_failed:true`, returns `{ grading_delayed:true }`.
- All-clean path: `computeFinalScore` + `computeMasteryBand` → writes `submitted_at, is_complete:true, grading_status:'complete', raw_score, score_pct, mastery_band`. Then fires (fire-and-forget) `recomputeSkillStatesForStudent` and `recordMisconceptions`.
- `GET()` → 501.
- Signature: `POST(_req, { params }: { params: Promise<{ attemptId: string }> })` — Next 16 async params.

### `src/app/api/attempts/[attemptId]/adapt/route.ts` (POST)
- Called after Q3; auth same pattern; `.eq('student_id', user.id)`; 400 if `is_complete`; returns cached `adapted_questions` if present; else computes correctCount from positions ≤3 and calls `adaptQuestions` (never throws); persists to `quiz_attempts.adapted_questions`.

### `src/app/api/attempts/spark-attempt-complete/route.ts` (POST) — SPARK→CORE ingestion
- Auth: constant-time Bearer vs `CORE_SPARK_API_SECRET` (`bearerMatches`), NOT user auth. Idempotent via `webhook_idempotency_keys`. Payload keyed by `core_homework_id` (= `assignments.id`) + `student_id`. Upserts `spark_completions` (onConflict `assignment_id,student_id`), writes `platform_events`, feeds `recomputeSkillStatesForStudent`. Never 5xx for business outcomes (200 body).

**There is no `quiz_attempts`/`homework_attempts` CREATE route and no `quiz_responses` SAVE route.** (Confirmed via Glob of `src/app/api/**/route.ts` — full list: cron/{parent-narrative,snapshot,trial-check,trial-expiry,weekly-snapshot,idempotency-sweep}, import/lift-inbound, integrations/core, public/trial/signup, attempts/[attemptId]/{adapt,submit}, attempts/spark-attempt-complete, teacher/{lessons/parse, quizzes/generate, assignments/generate, class/[classId]/roster-signals, student/[studentId]/signals, classes}, student/growth, admin/provision-trial.)

---

## 4. How an assignment is fetched (any student GET) + status fields

**No student-facing GET route returns an assignment.** The only assignment reads found:
- `src/lib/spark/loadChallenges.ts:36-70` — **teacher** Spark Challenges loader (admin client, caller must have passed `guardClassAccess`). Selects `assignments` by `class_id` where `spark_status != 'none'`, joins `users:student_id(full_name)`, left-joins `spark_completions`, derives `status: 'assigned'|'in_progress'|'completed'` from completion presence/scoring. This is teacher-scope, not student-scope, and keys off `spark_status` (NOT `status`/`push_status`).
- `assignments_scoped_read` RLS (`0004:47-50`) DOES permit `student_id = auth.uid()` SELECT — so a future student GET could read the row directly under RLS, but no such route/page exists.

Status fields recap for the designer:
- `assignments.status` text DEFAULT `'draft'` — only ever written `'draft'`; no `'pushed'` value used in any located code (no push lifecycle implemented).
- `assignments.push_status` text DEFAULT `'pending'` — never written by located code.
- `assignments.spark_status` text DEFAULT `'none'`, CHECK `none|notified|created|in_progress|completed|notify_failed` — the LIVE driver of the SPARK affordance. Set to `'created'` (or `'notify_failed'`) by the teacher generate route after `notifyAssignmentCreated`; updated to `'in_progress'`/`'completed'` by the analyzer pass / completion ingestion (per loadChallenges derivation it's actually `spark_completions` presence that drives teacher status).
- `quiz_attempts`: `is_complete`, `grading_status` (`'complete'|'pending'`), `grading_failed`, `mastery_band` (null until graded).

---

## 5. SPARK linkage facts the designer needs (no JWT/launch exists)

- `getSparkLink(admin, schoolId)` — `src/lib/spark/sparkLink.ts:12-21` — reads `platform_links` where `product='spark'` AND `enabled=true`; returns `{ api_key, core_base_url, enabled }` or null. `provisionSparkLink(...)` upserts it (`:34-47`). Phase-1 SPARK gate = presence of an enabled `product='spark'` row.
- `notifyAssignmentCreated` — `src/lib/spark/notifyAssignmentCreated.ts:33-100` — CORE→SPARK POST `{SPARK_API_URL}/api/integration/webhooks/core`, Bearer `CORE_SPARK_API_SECRET`, `X-Idempotency-Key {coreHomeworkId}_{studentId}`, 35s timeout, never throws. Returns `{ success, sparkAssignmentId(uuid), sparkAttemptId?, syntheticExperimentId? }`. Rejects K-2 (`gradeToBand` null).
- Config — `src/lib/spark/config.ts:5-6`: `SPARK_API_URL` (default `https://spark.inteliflowai.com`), `CORE_SPARK_API_SECRET` (default `''`).
- Contract mappers — `src/lib/spark/contract.ts`: `bandToSparkBand`, `gradeToBand`, `computeTransferScore`, `transferWord`, `RubricDimensions` (7 dims).

**ABSENT (design will assume these and they DO NOT exist):**
- No SPARK **LAUNCH / handoff** anything. Grep for `jwt|sign|launch|jose|jsonwebtoken` across `src/lib/spark/*.ts` finds only `notifyAssignmentCreated` correlation-id text — **zero JWT/SSO/launch-token code**. The only CORE↔SPARK directions implemented are: CORE→SPARK create-notify (fire-and-forget webhook) and SPARK→CORE completion ingestion. There is no "student clicks Launch → opens a Spark Challenge with a signed token" path of any kind.
- No `jsonwebtoken`/`jose` dependency wired in the spark libs.
- No student-side rendering of `spark_status` (loadChallenges is teacher-only).

### How `spark_status` would drive a "Launch in SPARK" affordance vs a normal attempt
The data exists to branch but the UI does not:
- An assignment with `spark_status != 'none'` (i.e. `created`/`notified`/`in_progress`) is a **Spark Challenge** — the design's "Launch in SPARK" button would key off this. Completion is observed via `spark_completions` (UNIQUE per assignment×student) arriving through `spark-attempt-complete`.
- An assignment with `spark_status = 'none'` is a **normal CORE assignment/quiz** — would route to the (not-yet-built) in-app player → `quiz_responses` save → `adapt` → `submit`.
- A launch handoff (student JWT to open `core_base_url`/SPARK) must be **built from scratch**; `sparkLink.core_base_url` is the only stored per-school SPARK URL and `notifyAssignmentCreated` returns `sparkAttemptId`/`syntheticExperimentId` which a launch could reference, but nothing consumes them for a student redirect today.

---

## 6. Student app: BUILD vs REUSE summary

REUSE (exists): the grade/ingest backend — `submit`, `adapt`, `spark-attempt-complete` routes; `AssignmentSchema`/`GeneratedQuizSchema` content shapes; RLS that already lets students SELECT own assignments + INSERT own attempts/responses; `(student)` route-group + layout guard (`requireRole(['student'])`) + RoleLayout.

BUILD (absent): every student page (`/student/assignments`, `/student/growth`, an attempt **player** page); a **create-attempt** route (insert `quiz_attempts` + seed `quiz_responses`); a **response-save** route (write `quiz_responses` incl. behavioral telemetry); an assignment/quiz **fetch-for-student** GET; the **SPARK Launch handoff** (token/redirect) — no JWT/launch code exists anywhere.
