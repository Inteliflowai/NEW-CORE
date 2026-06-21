# V1 Data Model — Assignment Player (Epic 2 grounding)

> VERBATIM current-code facts from V1 (`C:/users/inteliflow/core`). No opinions, no
> proposed changes. This captures the DB shape behind the non-SPARK student
> "Assignment Player" (homework): the definition table (`assignments`), the
> attempt/grade table (`homework_attempts`), the cross-device draft table
> (`homework_drafts`), the related `tutor_sessions` hint source, and all RLS.
>
> **CRITICAL CAVEAT (CLAUDE.md "Bug #18" in V1):** the V1 schema is split across a
> committed `000_full_schema.sql` PLUS numbered migrations PLUS several
> out-of-band hand-run "reconcile" scripts under `supabase/` (NOT in
> `supabase/migrations/`). Production drifted from the migration files, so a
> column's true type/default is the union of all these sources. Where a column is
> only declared in a reconcile script (never a numbered migration), it is flagged
> below as **[reconcile-only]**. The live production source of truth for some
> columns is the application write code, not any DDL file.

---

## 1. `homework_attempts` — the attempt + grade table

This is the row the student creates when they start/submit an assignment; the
teacher gradebook, signals engine, parent narrative, effort/hug rules, and
reteach detection all read it. There is **one row per (student, assignment)** —
existence of a row = "submitted attempt exists" in V1's query patterns. A redo
re-uses / overwrites the same row (it does NOT insert a second row in the live
submit path; see §1.4).

### 1.1 Original definition — `000_full_schema.sql` (lines 214–230)

```sql
CREATE TABLE IF NOT EXISTS public.homework_attempts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id     uuid        NOT NULL REFERENCES public.assignments(id),
  student_id        uuid        NOT NULL REFERENCES public.users(id),
  status            text        DEFAULT 'in_progress',
  responses         jsonb,
  canvas_data       jsonb,
  score_pct         numeric,
  ai_feedback       jsonb,
  teacher_notes     text,
  teacher_score     numeric,
  teli_hint_count   int         DEFAULT 0,
  submitted_on_time boolean,
  submitted_at      timestamptz,
  graded_at         timestamptz,
  created_at        timestamptz DEFAULT now()
);
```

Indexes (000): `idx_homework_attempts_student (student_id)`,
`idx_homework_attempts_assignment (assignment_id)`.
RLS: `ALTER TABLE public.homework_attempts ENABLE ROW LEVEL SECURITY;` (000 line 776).

### 1.2 Columns added by numbered migrations (in order)

| Column | Type | Default / Constraint | Source migration | Notes |
|---|---|---|---|---|
| `grading_status` | text | `DEFAULT 'completed'`, `CHECK IN ('completed','pending','failed')` | 027_pending_grading.sql | tracks AI-grading lifecycle |
| `review_required` | boolean | `DEFAULT false` | 030_teacher_intelligence.sql | teacher-review flag; partial index `idx_hw_review_required ON (class_id, review_required) WHERE review_required = true` (note: references `class_id`, which 000 does NOT define — see §1.3) |
| `teli_transcript_visibility` | text | `DEFAULT 'metadata_only'`, `CHECK IN ('metadata_only','full_transcript')` | 042_teli_voice_v6.sql | Teli privacy policy |
| `self_unblock_flag` | boolean | `DEFAULT false` | 042_teli_voice_v6.sql | "articulation pays off" signal |
| `articulation_used` | boolean | `DEFAULT false` | 042_teli_voice_v6.sql | "what have you tried" used |
| `effort_label` | text | `CHECK IN ('effortful_success','struggling_trying','independent_success','independent_struggle')` (nullable, **no default, NOT backfilled**) | 043_homework_effort_label.sql | populated live by `lib/signals/computeEffortLabel.ts`; historical rows stay NULL |
| `hours_to_submit` | numeric | (nullable) | 045_homework_attempts_drift.sql | **was [reconcile-only] drift** — written by submit route, codified late; index `idx_homework_attempts_hours ON (assignment_id, hours_to_submit) WHERE hours_to_submit IS NOT NULL` |
| `score` | numeric | (nullable) | 045_homework_attempts_drift.sql | drift column; **later RENAMED to `grade`** by 055 (see §1.5) |
| `student_choices` | jsonb | `DEFAULT '{}'::jsonb` | 047_self_knowledge_choice_igothis.sql | "I Got This" / self-knowledge path |
| `i_got_this_offered` | boolean | `DEFAULT false` | 047 | |
| `i_got_this_offered_at` | timestamptz | (nullable) | 047 | |
| `i_got_this_response` | text | `CHECK (... IS NULL OR IN ('skipped','deeper','continued','dismissed'))` | 047 | |
| `mastery_shortcut` | boolean | `DEFAULT false` | 047 | partial index `idx_homework_attempts_mastery_shortcut_pending ON (assignment_id) WHERE mastery_shortcut = true AND mastery_shortcut_reviewed_at IS NULL` |
| `mastery_shortcut_reviewed_at` | timestamptz | (nullable) | 047 | |
| `mastery_shortcut_reviewed_by` | uuid | `REFERENCES public.users(id) ON DELETE SET NULL` | 047 | |
| `mastery_shortcut_reviewer_action` | text | `CHECK (... IS NULL OR IN ('confirmed','overridden','auto_approved'))` | 047 | |
| `extension_problem_id` | uuid | (nullable) | 047 | |
| `extension_problem_text` | text | (nullable) | 047 | |
| `extension_outcome` | text | `CHECK (... IS NULL OR IN ('correct','incorrect','partial','abandoned'))` | 047 | |
| `extension_submitted_at` | timestamptz | (nullable) | 047 | |
| `bncc_codes_addressed` | text[] | `NOT NULL DEFAULT '{}'` | 069_bncc_structured_fields.sql | Brazil/BNCC; GIN index `idx_homework_attempts_bncc_codes` |
| `bncc_competencias_addressed` | int[] | `NOT NULL DEFAULT '{}'` | 069 | GIN index `idx_homework_attempts_bncc_competencias` |

### 1.3 Columns added ONLY by reconcile scripts **[reconcile-only]** (never in `supabase/migrations/`)

These live in hand-run scripts under `supabase/` (applied to prod out-of-band).
The application code reads/writes them, so they are effectively part of the real
schema, but a fresh `migrations/`-only clone would NOT have them.

From **`reconcile-eduflux-2026-06-04b.sql`** (lines 76–85) — "Redo flow + per-task
content + teacher summary":

```sql
ALTER TABLE public.homework_attempts
  ADD COLUMN IF NOT EXISTS allow_redo      boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_redo         boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS content         jsonb,
  ADD COLUMN IF NOT EXISTS response_text   text,
  ADD COLUMN IF NOT EXISTS diagram_url     text,
  ADD COLUMN IF NOT EXISTS flagged_by      text,
  ADD COLUMN IF NOT EXISTS max_score       numeric,
  ADD COLUMN IF NOT EXISTS teacher_summary text,
  ADD COLUMN IF NOT EXISTS school_id       uuid;
```

From **`reconcile-2026-04-23.sql`**:
- `responses jsonb` (line 17–18) — note: 000 already declares this; prod was missing it (PGRST204).
- `updated_at timestamptz DEFAULT now()` (line 22–23) — written on every update path; never in a numbered migration.
- `task_grades jsonb` (line 164–165) — per-task grades; shape = jsonb array of `{ step, description, grade, feedback }`. (See §1.5: this is the renamed `task_scores`; on prod the rename no-op'd because `task_scores` never existed, so it was added fresh here.)

From **`reconcile-eduflux-2026-06-04.sql`** (lines 87–88): `task_grades jsonb`
(EduFlux variant of the same add).

From **`brazil-pilot/RECONCILE.sql`** (lines 55–57): `review_required boolean DEFAULT false`
and `class_id uuid REFERENCES public.classes(id)`.

**`class_id uuid REFERENCES public.classes(id)` [reconcile-only]** — this is the
single most load-bearing drift column. It is NOT in 000 but IS referenced by:
- the 030 partial index (`(class_id, review_required)`),
- the live submit-route INSERT (`class_id` is set on insert, §1.4),
- the signals engine select (`runSignalComputation.ts` selects `class_id`),
- teacher-scoped queries.
It exists on prod via the Brazil RECONCILE + the EduFlux reconciles.

### 1.4 What the live submit route actually writes — `app/api/attempts/homework-submit/route.ts`

This is the canonical writer (the V1 grade route). Sequence:

1. **Existing-attempt lookup:** `select('id, status, diagram_url') .eq(student_id) .eq(assignment_id) .maybeSingle()`.
2. **Redo gate:** if `existing.status === 'graded'`, re-select `allow_redo`; if `!allow_redo` → `409 'Already graded'`.
3. **On existing row → UPDATE** with: `diagram_url`, `response_text` (or null), `responses` (= perTaskResponses), `status: 'submitted'`, `submitted_at`, `updated_at`, **`allow_redo: false`** (consumes the redo permission).
4. **On no existing row → INSERT** with: `student_id`, `assignment_id`, **`class_id`**, `diagram_url`, `response_text`, `responses`, `status: 'submitted'`, `submitted_at`.
5. **Grading update** (after AI grade returns) sets:
   - `grade` (the AI grade 0–100; migration-055 renamed `score`→`grade`),
   - `ai_feedback`,
   - `teacher_notes` (= grading.teacher_summary or null),
   - `status: 'graded'`,
   - `graded_at`, `updated_at`,
   - `hours_to_submit` (= `Math.round(hoursToSubmit * 10) / 10`; hoursToSubmit = (submittedAt − assignment.created_at)/3600000),
   - `submitted_on_time` (= hoursToSubmit ≤ 48),
   - `teli_hint_count` (= latest `tutor_sessions.hint_count` for that student+assignment, default 0),
   - `effort_label` (= `computeEffortLabel({ score: grading.grade, teliHintCount })`).
6. **On grading failure:** update `status: 'pending_grade', review_required: true`.
7. **Separate non-blocking update:** `task_grades: grading.task_grades` (kept separate because the column is reconcile-only and may not exist on an env).
8. On successful submit, the matching `homework_drafts` row is **deleted** (admin client, non-blocking).

**Submit gates (before insert):**
- Gate 1 — every task in `assignment.content.tasks` must have a non-empty response (text OR image_url). Per-task responses keyed by `task.step` (canonical) or array index (legacy). Returns `400 incomplete_homework { missing_count, total_tasks }`.
- Gate 2 — SPARK completion: if `assignment.spark_attempt_id` set and `spark_sync_failed !== true`, requires `content.spark_completed_at` OR `status === 'completed'`, else `400 spark_not_completed`.

### 1.5 The score→grade rename (migrations 055 / 055b)

V1 LOCKED a language split: **quizzes produce SCORES** (diagnostic, never affect
GPA → `quiz_attempts.score_pct`), **homework produces GRADES** (evaluative →
`homework_attempts.grade`). Migration `055_score_grade_split.sql` (+ prod replay
`055b_score_grade_split_prod_fix.sql`):
- `homework_attempts.score` → RENAME → **`grade`** (idempotent; only if `score` still exists).
- `homework_attempts.task_scores` → RENAME → **`task_grades`**, plus rewrites inner jsonb keys `{step, description, score, feedback}` → `{...grade...}`.
- (On `student_model`: adds `quiz_score_history`, `hw_grade_history`, `avg_quiz_score_trend`, `avg_hw_grade_trend`; drops legacy `score_history`, `avg_score_trend`.)

> **Net effect on the live column name:** the homework grade column is **`grade`**
> (numeric). `score_pct` (from 000) still physically exists but is the
> quiz-era name; the homework writer/readers use `grade`. `signals` code even
> aliases on read: `.select('... score:grade, ...')` (`runSignalComputation.ts`
> line 272) — i.e. it reads `grade` but exposes it under the name `score`
> internally. `effectiveness_snapshots` splits to `avg_hw_grade` (= mean of
> `homework_attempts.grade`) per migration 058.

### 1.6 `mastery_band` is NOT on `homework_attempts`

`mastery_band` lives on **`assignments`** (the definition table, see §3) and on
`student_model`. The homework attempt does not carry its own mastery band; the
grader reads `assignments.mastery_band` to grade in-band.

### 1.7 Columns a teacher surface / signals engine consumes (callout)

From the V1 consumer type `components/teacher/student-detail/types.ts → HomeworkAttempt`:
```ts
id, assignment_id, status, diagram_url, response_text, grade (number|null),
ai_feedback, teacher_notes, submitted_at, graded_at, allow_redo (boolean),
responses (Record<step, {text?, image_url?}>),
teli_hint_count?, effort_label?, submitted_on_time?, hours_to_submit?
```
From `lib/signals/runSignalComputation.ts` select:
`id, student_id, class_id, assignment_id, score:grade, allow_redo, is_redo, flagged_by, submitted_at, created_at`.
- **Redo count signal:** `homeworkAttempts.filter(a => a.allow_redo || a.is_redo).length` (`computeRiskIndex.ts` line 164) feeds the risk index.
- The grader-consumed columns the prompt asked about, summarized:
  - **`grade`** (numeric, was `score_pct`/`score`) — the evaluative homework grade 0–100.
  - **`teli_hint_count`** (int, default 0) — copied from `tutor_sessions.hint_count`; effort + risk input.
  - **`allow_redo`** / **`is_redo`** (boolean, default false) [reconcile-only] — redo flow + redo-count signal.
  - **`effort_label`** (text enum, nullable, not backfilled) — `effortful_success | struggling_trying | independent_success | independent_struggle`.
  - **`submitted_at`** (timestamptz) + **`submitted_on_time`** (boolean, = hours ≤ 48) + **`hours_to_submit`** (numeric) — timeliness/effort.
  - **`status`** (text, default `'in_progress'`) — observed values in code: `in_progress`, `submitted`, `graded`, `pending_grade` (plus `completed` checked on the parent assignment for SPARK).

### 1.8 RLS policies for `homework_attempts`

RLS is ENABLED in 000. The canonical policy set lives in the pilot/reconcile
scripts (the live prod source-of-truth snapshot):
- **Student read own** (`brazil-pilot/RECONCILE.sql` lines 328–330):
  ```sql
  CREATE POLICY homework_attempts_read_own ON public.homework_attempts
    FOR SELECT USING (student_id = auth.uid());
  ```
- **Teacher read for own classes** (`brazil-pilot/ADDENDUM_teacher_rls.sql` lines 120–133):
  ```sql
  CREATE POLICY homework_attempts_teacher_read ON public.homework_attempts
    FOR SELECT USING (
      student_id IN (SELECT e.student_id FROM enrollments e
                     JOIN classes c ON c.id = e.class_id
                     WHERE c.teacher_id = auth.uid())
      OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid()
                 AND u.role IN ('school_admin','school_sysadmin','platform_admin'))
    );
  ```
- Writes go through the **service-role / admin client** (`createAdminSupabaseClient`),
  which bypasses RLS — consistent with V2's "RLS is NOT the IDOR backstop" rule.

---

## 2. `homework_drafts` — cross-device in-progress persistence (064)

Net-new table (migration `064_homework_drafts.sql`). Holds the draft the player
hydrates from on mount and debounce-writes as the student works; **deleted on
successful submit** (the submitted snapshot then lives on `homework_attempts`).
Chosen as a SEPARATE table (not columns on `homework_attempts`) so the existing
"submitted attempt exists = row exists" query pattern stays intact.

```sql
CREATE TABLE IF NOT EXISTS public.homework_drafts (
  assignment_id  uuid        PRIMARY KEY REFERENCES public.assignments(id) ON DELETE CASCADE,
  student_id     uuid        NOT NULL,
  draft_state    jsonb       NOT NULL,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);
```

- **PK is `assignment_id` alone** (assignments are per-student — `assignments.student_id` — so assignment_id uniquely identifies the draft). `student_id` stored redundantly for index/filter without a join.
- `draft_state` jsonb is a free-form blob owned by the homework page. Today's shape: `{ responses, completed_tasks, current_task_index, phase }`. Adding fields needs no migration.
- `last_active_at` drives the dashboard's "in progress · last worked X min ago" surface + future stale-draft cleanup.
- Index: `idx_homework_drafts_student ON (student_id, last_active_at DESC)`.

### 2.1 RLS (064) — three policies, all `TO authenticated`
- **`"Students manage own drafts"`** — `FOR ALL USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid())`.
- **`"Teachers read student drafts"`** — `FOR SELECT USING (student_id IN (SELECT public.get_teacher_student_ids(auth.uid())))`.
- **`"Platform admins full access"`** — `FOR ALL USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin())`.
- Grants: `GRANT ALL ON public.homework_drafts TO authenticated, anon, service_role;` (required per V1 "Critical Bug #7" or service-role 42501s).

---

## 3. `assignments` — the homework DEFINITION table (`000_full_schema.sql` lines 184–202)

The homework "items"/content are NOT a separate questions table — they live as a
jsonb blob on `assignments.content`. The assignment is **per-student**
(`student_id NOT NULL`), one row per student per assigned lesson.

```sql
CREATE TABLE IF NOT EXISTS public.assignments (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_attempt_id          uuid        REFERENCES public.quiz_attempts(id),
  student_id               uuid        NOT NULL REFERENCES public.users(id),
  class_id                 uuid        NOT NULL REFERENCES public.classes(id),
  lesson_id                uuid        REFERENCES public.lessons(id),
  mastery_band             text        CHECK (mastery_band IN ('reteach','grade_level','advanced')),
  assignment_mode          text        DEFAULT 'standard',
  learning_style           text,
  content                  jsonb       NOT NULL,
  status                   text        DEFAULT 'draft',
  teacher_reviewed         boolean     DEFAULT false,
  teacher_override_reason  text,
  push_status              text        DEFAULT 'pending',
  reteach_needed           boolean     DEFAULT false,
  scaffold_level           text,
  due_at                   timestamptz,
  created_at               timestamptz DEFAULT now()
);
```

Indexes (000): `idx_assignments_student (student_id)`, `idx_assignments_class (class_id)`. RLS enabled in 000. Student read-own policy (`brazil-pilot/RECONCILE.sql`): `assignments_read_own FOR SELECT USING (student_id = auth.uid())`.

### 3.1 `assignments.content` jsonb shape (the actual "questions/items")

The player renders tasks from `content`. From the submit route + V1 consumer types:
```ts
content = {
  title: string;
  instructions: string;
  tasks: { step: number; description: string; type: string;
           strategy?: string; atl_skill?: string; ib_attribute?: string;
           bloom_level?: string }[];
  atl_summary?: string[];
  ib_attributes?: string[];
  spark_completed_at?: string;   // set when an injected SPARK challenge is done
}
```
The submit-route grader reads: `content.title`, `content.instructions`,
`content.tasks`, plus `assignments.mastery_band`, `assignments.learning_style`,
`reteach_needed`, `reteach_completed_at`, `class_id`, `lesson_id`.

### 3.2 Drift columns on `assignments` referenced by code (not all in 000)
The submit route selects `reteach_completed_at` and the gate path reads
`spark_attempt_id` / `spark_sync_failed` (SPARK-injection drift columns on
`assignments`). These are SPARK-integration columns, out of scope for the
non-SPARK player but present on the table.

### 3.3 `assignment_submissions` (000 lines 205–211) — secondary/legacy
```sql
CREATE TABLE IF NOT EXISTS public.assignment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.assignments(id),
  student_id    uuid NOT NULL REFERENCES public.users(id),
  content       jsonb,
  submitted_at  timestamptz DEFAULT now()
);
```
RLS on in 077; no browser policy (service-role only). The live homework player
does NOT write here — the canonical attempt record is `homework_attempts`.

---

## 4. `tutor_sessions` — Teli hint source (read by the grader)

Not part of the assignment tables, but the assignment player's hint ladder /
Teli tutor writes here, and the submit route reads `hint_count` from the latest
`tutor_sessions` row for (student, assignment) to populate
`homework_attempts.teli_hint_count`. Linked via `tutor_sessions.assignment_id`.
Many of its columns are **[reconcile-only]** drift (`reconcile-2026-04-23.sql`
lines 67–77): `status`, `completed_at`, `hint_count` (int), `hint_type_that_worked`,
`recovery_pattern`, `scaffold_dependency_score`, `tasks_completed`, `tasks_total`,
`completion_time_ms`, `last_activity_at`; plus 04-04b adds `created_at`,
`tasks_completed/total`, `scaffold_dependency_score`, `hint_type_that_worked`.
`teli_nudges` (042) references `homework_attempts(id) ON DELETE SET NULL` via
`homework_attempt_id`.

---

## 5. FK / relationship summary

- `homework_attempts.assignment_id` → `assignments.id` (NOT NULL).
- `homework_attempts.student_id` → `users.id` (NOT NULL).
- `homework_attempts.class_id` → `classes.id` **[reconcile-only]**.
- `homework_attempts.mastery_shortcut_reviewed_by` → `users.id` ON DELETE SET NULL (047).
- `homework_drafts.assignment_id` → `assignments.id` ON DELETE CASCADE (PK).
- `assignments.student_id` → `users.id`; `assignments.class_id` → `classes.id`; `assignments.lesson_id` → `lessons.id`; `assignments.quiz_attempt_id` → `quiz_attempts.id`.
- `teli_nudges.homework_attempt_id` → `homework_attempts.id` ON DELETE SET NULL (042).

---

## 6. Status-enum values seen in code (not a DB CHECK constraint)

`homework_attempts.status` has **no CHECK constraint** (just `DEFAULT 'in_progress'`).
Values the V1 code sets/reads: `in_progress`, `submitted`, `graded`,
`pending_grade`. (The parent `assignments.status` separately uses `draft`,
`completed`, etc.)

`grading_status` (027): `completed | pending | failed` (CHECK-constrained).

---

## 7. Source files read (verbatim)

- `supabase/migrations/000_full_schema.sql` (homework_attempts §214–230, assignments §184–202, assignment_submissions §205–211, indexes, RLS enable)
- `supabase/migrations/027_pending_grading.sql`
- `supabase/migrations/030_teacher_intelligence.sql`
- `supabase/migrations/042_teli_voice_v6.sql`
- `supabase/migrations/043_homework_effort_label.sql`
- `supabase/migrations/045_homework_attempts_drift.sql`
- `supabase/migrations/047_self_knowledge_choice_igothis.sql`
- `supabase/migrations/055_score_grade_split.sql` + `055b_score_grade_split_prod_fix.sql`
- `supabase/migrations/058_effectiveness_snapshots_split.sql`
- `supabase/migrations/064_homework_drafts.sql`
- `supabase/migrations/069_bncc_structured_fields.sql`
- `supabase/migrations/077_student_table_rls.sql`
- `supabase/reconcile-2026-04-23.sql`
- `supabase/reconcile-eduflux-2026-06-04.sql` + `reconcile-eduflux-2026-06-04b.sql`
- `supabase/brazil-pilot/RECONCILE.sql` + `ADDENDUM_teacher_rls.sql` + `SETUP.sql`
- `app/api/attempts/homework-submit/route.ts` (writer / grader)
- `components/teacher/student-detail/types.ts` + `components/student/homework/types.ts` (consumer shapes)
- `lib/signals/runSignalComputation.ts` + `lib/signals/computeRiskIndex.ts` (signal reads)
