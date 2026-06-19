# P4b Schema Grounding — CORE V2

**Source:** All 11 migration files read verbatim from `supabase/migrations/0001_identity_roles.sql` through `0011_signals.sql`.
**Purpose:** Exact column/constraint/FK reference for the seed, provisioning, and endpoint implementation.

---

## Auth-sync trigger

**There is NO trigger that syncs `auth.users` → `public.users`.**

`public.users.id` is a FK to `auth.users(id)` (primary key reference), but no `CREATE TRIGGER ... ON auth.users` exists in any migration. The seed and provisioning code must explicitly `INSERT INTO public.users` after each `supabase.auth.admin.createUser()` call. The spec (§4.2) explicitly confirms: "There is no DB trigger syncing `auth.users → public.users`; the seed must INSERT the `users` row itself after each `createUser`."

---

## Table: `public.schools`

**Source:** `0001_identity_roles.sql`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PRIMARY KEY |
| `name` | text | NOT NULL | — | |
| `domain` | text | NULL | — | |
| `timezone` | text | NULL | `'America/New_York'` | |
| `google_classroom_enabled` | boolean | NULL | `false` | |
| `parent_profile_visible` | boolean | NULL | `true` | |
| `is_active` | boolean | NULL | `true` | |
| `demo_mode` | boolean | NULL | `false` | |
| `demo_expires_at` | timestamptz | NULL | — | |
| `welcome_completed` | boolean | NULL | `false` | |
| `is_trial` | boolean | NULL | `false` | LIFT 035 |
| `trial_started_at` | timestamptz | NULL | — | LIFT 035 |
| `trial_expires_at` | timestamptz | NULL | — | LIFT 035 |
| `trial_status` | text | NULL | `'inactive'` | CHECK: `('inactive','active','expired','converted','cancelled')` |
| `trial_plan` | text | NULL | `'pro'` | LIFT 035 |
| `trial_source` | text | NULL | — | |
| `hl_contact_id` | text | NULL | — | |
| `trial_credentials` | jsonb | NULL | `'{}'` | |
| `allowed_email_domains` | jsonb | NULL | `'[]'` | LIFT 049 |
| `created_at` | timestamptz | NULL | `now()` | |

**Constraints:** PRIMARY KEY (`id`). CHECK on `trial_status IN ('inactive','active','expired','converted','cancelled')`.

**Natural upsert key:** `id` (uuid, known before insert for demo seed; otherwise generated).

---

## Table: `public.users`

**Source:** `0001_identity_roles.sql`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | — | PRIMARY KEY; FK → `auth.users(id)` |
| `school_id` | uuid | NULL | — | FK → `schools(id)` |
| `role` | text | NOT NULL | — | CHECK: `('teacher','student','parent','school_admin','school_sysadmin','platform_admin')` |
| `full_name` | text | NOT NULL | — | |
| `email` | text | NOT NULL | — | |
| `avatar_url` | text | NULL | — | |
| `display_name` | text | NULL | — | |
| `grade_levels` | text | NULL | — | teacher-facing multi-grade text |
| `subjects` | text | NULL | — | teacher-facing subjects text |
| `parent_id` | uuid | NULL | — | FK → `users(id)` (self-ref) |
| `grade_level` | text | NULL | — | student-facing single grade |
| `is_active` | boolean | NULL | `true` | |
| `last_active_at` | timestamptz | NULL | — | |
| `lift_candidate_id` | text | NULL | — | |
| `lift_data` | jsonb | NULL | — | |
| `is_trial_user` | boolean | NULL | `false` | LIFT 035 |
| `trial_school_id` | uuid | NULL | — | FK → `schools(id)`; LIFT 035 |
| `created_at` | timestamptz | NULL | `now()` | |

**Constraints:** PRIMARY KEY (`id`). CHECK on `role IN ('teacher','student','parent','school_admin','school_sysadmin','platform_admin')`.

**Natural upsert key:** `id` (= `auth.users.id`; known after `createUser`).

**Note:** No UNIQUE constraint on `email`. Upsert-on-conflict uses `id`.

---

## Table: `public.guardians`

**Source:** `0001_identity_roles.sql`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PRIMARY KEY |
| `parent_id` | uuid | NOT NULL | — | FK → `users(id)` |
| `student_id` | uuid | NOT NULL | — | FK → `users(id)` |
| `created_at` | timestamptz | NULL | `now()` | |

**Constraints:** PRIMARY KEY (`id`). UNIQUE (`parent_id, student_id`).

**Natural upsert key:** `(parent_id, student_id)` — use `ON CONFLICT (parent_id, student_id)`.

---

## Table: `public.classes`

**Source:** `0002_classes_enrollments.sql`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PRIMARY KEY |
| `school_id` | uuid | NOT NULL | — | FK → `schools(id)` |
| `teacher_id` | uuid | NULL | — | FK → `users(id)` |
| `name` | text | NOT NULL | — | |
| `subject` | text | NULL | — | |
| `grade_level` | text | NULL | — | |
| `period` | text | NULL | — | |
| `google_course_id` | text | NULL | — | |
| `google_grade_sync_enabled` | boolean | NULL | `false` | |
| `google_feed_enabled` | boolean | NULL | `false` | |
| `enrollment_count` | int | NULL | `0` | denormalized counter |
| `is_active` | boolean | NULL | `true` | |
| `created_at` | timestamptz | NULL | `now()` | |

**Constraints:** PRIMARY KEY (`id`).

**No natural unique key** beyond `id`. Upsert by `id`.

---

## Table: `public.enrollments`

**Source:** `0002_classes_enrollments.sql`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PRIMARY KEY |
| `class_id` | uuid | NOT NULL | — | FK → `classes(id)` |
| `student_id` | uuid | NOT NULL | — | FK → `users(id)` |
| `enrolled_at` | timestamptz | NULL | `now()` | |
| `is_active` | boolean | NULL | `true` | |

**Constraints:** PRIMARY KEY (`id`). UNIQUE (`class_id, student_id`).

**Natural upsert key:** `(class_id, student_id)`.

**Trigger:** `trg_enforce_enrollment_limit` (BEFORE INSERT) calls `enforce_enrollment_limit()`. When `school_licenses.status = 'active'` and `student_limit` is reached, raises `check_violation`. Demo/trial schools with no active license (`status = 'trialing'`) bypass enforcement.

---

## Table: `public.lessons`

**Source:** `0003_lessons_quizzes.sql`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PRIMARY KEY |
| `class_id` | uuid | NOT NULL | — | FK → `classes(id)` |
| `teacher_id` | uuid | NOT NULL | — | FK → `users(id)` |
| `title` | text | NULL | — | |
| `file_name` | text | NULL | — | |
| `file_url` | text | NULL | — | |
| `file_type` | text | NULL | — | |
| `parsed_content` | jsonb | NULL | — | |
| `grade_level` | text | NULL | — | |
| `subject` | text | NULL | — | |
| `status` | text | NULL | `'draft'` | CHECK: `('draft','pending_review','approved','published','archived')` |
| `version` | int | NULL | `1` | |
| `created_at` | timestamptz | NULL | `now()` | |

**Constraints:** PRIMARY KEY (`id`). CHECK on `status`.

---

## Table: `public.quizzes`

**Source:** `0003_lessons_quizzes.sql` + `0010_engine_columns.sql`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PRIMARY KEY |
| `lesson_id` | uuid | NULL | — | FK → `lessons(id)` |
| `class_id` | uuid | NOT NULL | — | FK → `classes(id)` |
| `teacher_id` | uuid | NOT NULL | — | FK → `users(id)` |
| `title` | text | NULL | — | |
| `status` | text | NULL | `'draft'` | CHECK: `('draft','pending_review','approved','published','archived')` |
| `rubric_version` | text | NULL | `'1.0'` | |
| `teacher_notes` | text | NULL | — | |
| `published_at` | timestamptz | NULL | — | |
| `created_at` | timestamptz | NULL | `now()` | |
| `is_math` | boolean | NULL | `false` | Added by 0010 |
| `generation_model` | text | NULL | — | Added by 0010 |

**Constraints:** PRIMARY KEY (`id`). CHECK on `status`.

---

## Table: `public.quiz_questions`

**Source:** `0003_lessons_quizzes.sql` + `0005_skills.sql` + `0010_engine_columns.sql`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PRIMARY KEY |
| `quiz_id` | uuid | NOT NULL | — | FK → `quizzes(id)` ON DELETE CASCADE |
| `position` | int | NOT NULL | — | |
| `question_type` | text | NOT NULL | — | CHECK (after 0010): `('mcq','open','numeric')` |
| `question_text` | text | NOT NULL | — | |
| `choices` | jsonb | NULL | — | |
| `correct_answer` | text | NULL | — | |
| `rubric` | text | NULL | — | |
| `concept_tag` | text | NULL | — | |
| `created_at` | timestamptz | NULL | `now()` | |
| `skill_id` | uuid | NULL | — | FK → `skills(id)`; added by 0005 |
| `numeric_spec` | jsonb | NULL | — | Added by 0010 |
| `rubric_version` | text | NULL | — | Added by 0010 |

**Constraints:** PRIMARY KEY (`id`). CHECK on `question_type IN ('mcq','open','numeric')` (constraint named `quiz_questions_question_type_check`, replaced idempotently by 0010). No UNIQUE constraint.

---

## Table: `public.quiz_attempts`

**Source:** `0003_lessons_quizzes.sql` + `0010_engine_columns.sql` + `0011_signals.sql`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PRIMARY KEY |
| `quiz_id` | uuid | NOT NULL | — | FK → `quizzes(id)` |
| `student_id` | uuid | NOT NULL | — | FK → `users(id)` |
| `session_id` | text | NULL | — | |
| `started_at` | timestamptz | NULL | `now()` | |
| `submitted_at` | timestamptz | NULL | — | |
| `is_complete` | boolean | NULL | `false` | |
| `raw_score` | numeric | NULL | — | defined in 0003; ADD COLUMN IF NOT EXISTS again in 0010 (idempotent) |
| `score_pct` | numeric | NULL | — | defined in 0003; ADD COLUMN IF NOT EXISTS again in 0010 (idempotent) |
| `mastery_band` | text | NULL | — | CHECK: `('reteach','grade_level','advanced')` |
| `learning_style` | text | NULL | — | |
| `created_at` | timestamptz | NULL | `now()` | |
| `adapted_questions` | jsonb | NULL | — | Added by 0010 |
| `grading_status` | text | NULL | — | Added by 0010 (unconstrained); CHECK added by 0011: `(NULL OR 'pending' OR 'complete')` — constraint named `quiz_attempts_grading_status_check` |
| `grading_failed` | boolean | NULL | `false` | Added by 0010 |

**Constraints:** PRIMARY KEY (`id`). CHECK on `mastery_band IN ('reteach','grade_level','advanced')`. CHECK on `grading_status IS NULL OR grading_status IN ('pending','complete')` (named `quiz_attempts_grading_status_check`, applied by 0011).

**No UNIQUE constraint** on `(quiz_id, student_id)` — multiple attempts per student per quiz are allowed.

---

## Table: `public.quiz_responses`

**Source:** `0003_lessons_quizzes.sql` + `0010_engine_columns.sql`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PRIMARY KEY |
| `attempt_id` | uuid | NOT NULL | — | FK → `quiz_attempts(id)` ON DELETE CASCADE |
| `question_id` | uuid | NULL | — | FK → `quiz_questions(id)` |
| `position` | int | NOT NULL | — | |
| `response_text` | text | NULL | — | |
| `is_correct` | boolean | NULL | — | |
| `ai_score` | numeric | NULL | — | |
| `ai_score_explanation` | text | NULL | — | |
| `cognitive_notes` | text | NULL | — | |
| `question_type_scored` | text | NULL | — | |
| `rubric_version` | text | NULL | — | |
| `grader_source` | text | NULL | `'ai'` | |
| `confidence` | numeric | NULL | — | |
| `response_time_ms` | int | NULL | `0` | behavioral telemetry |
| `hesitation_ms` | int | NULL | `0` | |
| `answer_changes` | int | NULL | `0` | |
| `navigation_backs` | int | NULL | `0` | |
| `pause_count` | int | NULL | `0` | |
| `total_pause_ms` | int | NULL | `0` | |
| `word_count` | int | NULL | `0` | |
| `created_at` | timestamptz | NULL | `now()` | |
| `grading_output` | jsonb | NULL | — | Added by 0010 |

**Constraints:** PRIMARY KEY (`id`).

---

## Table: `public.assignments`

**Source:** `0004_assignments_homework.sql` + `0005_skills.sql` + `0010_engine_columns.sql`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PRIMARY KEY |
| `quiz_attempt_id` | uuid | NULL | — | FK → `quiz_attempts(id)` |
| `student_id` | uuid | NOT NULL | — | FK → `users(id)` |
| `class_id` | uuid | NOT NULL | — | FK → `classes(id)` |
| `lesson_id` | uuid | NULL | — | FK → `lessons(id)` |
| `mastery_band` | text | NULL | — | CHECK: `('reteach','grade_level','advanced')` |
| `assignment_mode` | text | NULL | `'standard'` | |
| `learning_style` | text | NULL | — | |
| `content` | jsonb | NOT NULL | — | |
| `status` | text | NULL | `'draft'` | unconstrained text |
| `teacher_reviewed` | boolean | NULL | `false` | |
| `teacher_override_reason` | text | NULL | — | |
| `push_status` | text | NULL | `'pending'` | |
| `reteach_needed` | boolean | NULL | `false` | |
| `scaffold_level` | text | NULL | — | |
| `due_at` | timestamptz | NULL | — | |
| `created_at` | timestamptz | NULL | `now()` | |
| `skill_ids` | uuid[] | NOT NULL | `'{}'` | Added by 0005 |
| `generation_model` | text | NULL | — | Added by 0010 |

**Constraints:** PRIMARY KEY (`id`). CHECK on `mastery_band IN ('reteach','grade_level','advanced')`.

**Note on `allow_redo`:** `assignments.allow_redo` does **NOT** exist. The `allow_redo` column is on `homework_attempts`, not `assignments`. The spec task references `assignments.allow_redo` in one place — this is a spec error; the column lives on `homework_attempts`.

**Note on `flagged_by`:** `assignments.flagged_by` does **NOT** exist in any migration. `flagged_by` exists only on `homework_attempts` (0011). The spec mentions `assignments.flagged_by` once — this is a spec error.

---

## Table: `public.homework_attempts`

**Source:** `0004_assignments_homework.sql` + `0011_signals.sql`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PRIMARY KEY |
| `assignment_id` | uuid | NOT NULL | — | FK → `assignments(id)` |
| `student_id` | uuid | NOT NULL | — | FK → `users(id)` |
| `status` | text | NULL | `'in_progress'` | unconstrained text |
| `responses` | jsonb | NULL | — | |
| `canvas_data` | jsonb | NULL | — | |
| `score_pct` | numeric | NULL | — | |
| `ai_feedback` | jsonb | NULL | — | |
| `teacher_notes` | text | NULL | — | |
| `teacher_score` | numeric | NULL | — | |
| `teli_hint_count` | int | NULL | `0` | |
| `submitted_on_time` | boolean | NULL | — | |
| `submitted_at` | timestamptz | NULL | — | |
| `graded_at` | timestamptz | NULL | — | |
| `created_at` | timestamptz | NULL | `now()` | |
| `effort_label` | text | NULL | — | Added by 0011 |
| `allow_redo` | boolean | NULL | `false` | Added by 0011 |
| `is_redo` | boolean | NULL | `false` | Added by 0011 |
| `flagged_by` | text | NULL | — | Added by 0011; unconstrained text (values: `'auto'`, `'teacher'` by convention) |

**Constraints:** PRIMARY KEY (`id`). CHECK on `effort_label IS NULL OR effort_label IN ('effortful_success','struggling_trying','independent_success','independent_struggle')` (named `homework_attempts_effort_label_check`, applied by 0011).

**Columns NOT present on `homework_attempts`:**
- `teacher_override_reason` — lives on `assignments`, not here
- `teacher_reviewed` — lives on `assignments`, not here
- No `class_id` column (confirmed by C18 note in `computeReteachEffectiveness.ts`)

---

## Table: `public.skills`

**Source:** `0005_skills.sql`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PRIMARY KEY |
| `school_id` | uuid | NOT NULL | — | FK → `schools(id)` ON DELETE CASCADE |
| `subject` | text | NULL | — | |
| `name` | text | NOT NULL | — | |
| `slug` | text | NOT NULL | — | |
| `aliases` | jsonb | NOT NULL | `'[]'` | |
| `status` | text | NOT NULL | `'unreviewed'` | CHECK: `('unreviewed','active','merged','retired')` |
| `merged_into` | uuid | NULL | — | FK → `skills(id)` (self-ref) |
| `created_by` | text | NOT NULL | `'ai'` | CHECK: `('ai','teacher','backfill')` |
| `created_at` | timestamptz | NOT NULL | `now()` | |
| `updated_at` | timestamptz | NOT NULL | `now()` | |

**Constraints:** PRIMARY KEY (`id`). CHECK on `status`. CHECK on `created_by`. UNIQUE INDEX `uq_skills_school_subject_slug` on `(school_id, COALESCE(subject, ''), slug)` — this is the natural upsert target (handles NULL subject).

**Natural upsert key:** `(school_id, COALESCE(subject,''), slug)` — must use the expression index, not a plain `ON CONFLICT (school_id, subject, slug)`.

---

## Table: `public.skill_learning_state`

**Source:** `0005_skills.sql` + `0011_signals.sql` (RLS tightened)

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PRIMARY KEY |
| `student_id` | uuid | NOT NULL | — | FK → `users(id)` ON DELETE CASCADE |
| `school_id` | uuid | NULL | — | FK → `schools(id)` ON DELETE CASCADE |
| `skill_id` | uuid | NOT NULL | — | FK → `skills(id)` ON DELETE CASCADE |
| `state` | text | NOT NULL | — | CHECK: `('needs_different_instruction','needs_more_time','on_track','ready_to_extend','insufficient_data','not_attempted')` |
| `confidence` | numeric | NOT NULL | `0` | 0–100 |
| `observation_count` | int | NOT NULL | `0` | |
| `evidence` | jsonb | NOT NULL | `'{}'` | |
| `last_reteach_outcome` | text | NULL | — | unconstrained text |
| `updated_at` | timestamptz | NOT NULL | `now()` | |

**Constraints:** PRIMARY KEY (`id`). UNIQUE (`student_id, skill_id`). CHECK on `state` (6-value; named `skill_learning_state_state_check`, refreshed by 0005).

**Natural upsert key:** `(student_id, skill_id)` — use `ON CONFLICT (student_id, skill_id)`.

---

## Table: `public.student_model_snapshots`

**Source:** `0006_snapshots.sql` + `0011_signals.sql`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PRIMARY KEY |
| `student_id` | uuid | NOT NULL | — | FK → `users(id)` ON DELETE CASCADE |
| `school_id` | uuid | NULL | — | FK → `schools(id)` ON DELETE CASCADE |
| `class_id` | uuid | NULL | — | FK → `classes(id)` ON DELETE CASCADE |
| `snapshot_date` | date | NOT NULL | `CURRENT_DATE` | |
| `mastery_band` | text | NULL | — | CHECK: `('reteach','grade_level','advanced')` |
| `learning_style` | text | NULL | — | |
| `consistency_label` | text | NULL | — | unconstrained text |
| `dominant_effort_pattern` | text | NULL | — | unconstrained text |
| `preferred_scaffold_level` | text | NULL | — | |
| `avg_score` | numeric | NULL | — | |
| `total_quizzes` | integer | NULL | — | |
| `total_homework` | integer | NULL | — | |
| `strength_topics` | text[] | NULL | — | |
| `struggle_topics` | text[] | NULL | — | |
| `improvement_4w` | numeric | NULL | — | |
| `risk_score` | numeric | NULL | — | |
| `avg_hints_per_attempt` | numeric | NULL | — | |
| `divergence_direction` | text | NULL | — | |
| `divergence_score` | numeric | NULL | — | |
| `recent_effort_labels` | jsonb | NULL | `'[]'` | |
| `snapshot_schema_version` | text | NULL | — | CHECK: `(NULL OR 'v1' OR 'v2')` |
| `created_at` | timestamptz | NULL | `now()` | |
| `consistency_score` | numeric | NULL | — | Added by 0011 |

**Constraints:** PRIMARY KEY (`id`). UNIQUE (`student_id, snapshot_date`). CHECK on `mastery_band`. CHECK on `snapshot_schema_version`.

**Natural upsert key:** `(student_id, snapshot_date)` — use `ON CONFLICT (student_id, snapshot_date)`.

**Note:** `consistency_label` is an unconstrained `text` column (no CHECK enum). `divergence_direction` is also unconstrained text. The spec references these as "consistency_label" and "divergence_direction/score" — present and correct.

---

## Table: `public.school_licenses`

**Source:** `0007_licensing.sql`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PRIMARY KEY |
| `school_id` | uuid | NOT NULL | — | FK → `schools(id)` UNIQUE (one license per school) |
| `tier` | text | NOT NULL | — | CHECK: `('essentials','professional','enterprise')` |
| `status` | text | NOT NULL | — | CHECK: `('trialing','active','past_due','suspended','cancelled')` |
| `student_limit` | int | NOT NULL | `300` | |
| `trial_starts_at` | timestamptz | NULL | — | |
| `trial_ends_at` | timestamptz | NULL | — | |
| `trial_converted` | bool | NULL | `false` | |
| `starts_at` | timestamptz | NULL | — | |
| `ends_at` | timestamptz | NULL | — | |
| `renewal_date` | timestamptz | NULL | — | |
| `setup_fee_paid` | bool | NULL | `false` | |
| `setup_fee_amount` | int | NULL | `1500000` | cents |
| `stripe_customer_id` | text | NULL | — | RESERVED |
| `stripe_subscription_id` | text | NULL | — | RESERVED |
| `billing_cycle` | text | NULL | — | CHECK: `('annual','biannual')` |
| `feature_overrides` | jsonb | NULL | `'{}'` | |
| `feature_blocks` | jsonb | NULL | `'{}'` | |
| `created_at` | timestamptz | NULL | `now()` | |
| `updated_at` | timestamptz | NULL | `now()` | trigger-maintained |
| `activated_via_key_id` | uuid | NULL | — | FK → `license_keys(id)` ON DELETE SET NULL; added by 0007 ALTER |

**Constraints:** PRIMARY KEY (`id`). UNIQUE (`school_id`). CHECK on `tier`. CHECK on `status`. CHECK on `billing_cycle`.

**Trigger:** `trg_license_updated_at` (BEFORE UPDATE) maintains `updated_at`.

**Natural upsert key:** `school_id` — one license per school.

**Status enum note:** Trial provisioning must use `status = 'trialing'` (not `'active'`). The enrollment limit trigger only enforces against `status = 'active'` licenses, so `'trialing'` schools bypass the seat cap.

---

## Table: `public.misconception_observations`

**Source:** `0011_signals.sql`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PRIMARY KEY |
| `student_id` | uuid | NOT NULL | — | FK → `users(id)` ON DELETE CASCADE |
| `skill_id` | uuid | NULL | — | FK → `skills(id)` ON DELETE SET NULL |
| `quiz_response_id` | uuid | NULL | — | FK → `quiz_responses(id)` ON DELETE SET NULL |
| `school_id` | uuid | NULL | — | FK → `schools(id)` ON DELETE CASCADE |
| `error_type` | text | NULL | — | unconstrained; valid values from `misconception_types.code` |
| `reasoning_pattern` | text | NULL | — | unconstrained; valid values from `misconception_types.code` |
| `observed_at` | timestamptz | NULL | `now()` | |

**Constraints:** PRIMARY KEY (`id`). No UNIQUE constraint.

**Index:** `idx_mo_student_skill_error` on `(student_id, skill_id, error_type)`.

**RLS:** staff-only read (teacher/school_admin/school_sysadmin/platform_admin in same school); service_role full access. Students/parents have no read policy.

---

## Table: `public.misconception_types`

**Source:** `0011_signals.sql`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `code` | text | NOT NULL | — | PRIMARY KEY |
| `kind` | text | NOT NULL | — | CHECK: `('error_type','reasoning_pattern')` |
| `display_label` | text | NOT NULL | — | |
| `sort_order` | int | NULL | — | |
| `active` | boolean | NULL | `true` | |

**Constraints:** PRIMARY KEY (`code`). CHECK on `kind`.

**Seeded rows (14 total):**

*error_type (8):* `'none'`, `'factual_error'`, `'reasoning_gap'`, `'incomplete'`, `'misunderstood_question'`, `'vocabulary_confusion'`, `'off_topic'`, `'blank'`

*reasoning_pattern (6):* `'surface_recall'`, `'partial_reasoning'`, `'full_reasoning'`, `'misconception'`, `'creative_extension'`, `'blank_or_off_topic'`

---

## Tables that DO NOT exist in any migration

The following tables are referenced in spec/plan/code but have **no `CREATE TABLE` in migrations 0001–0011**:

### `reteach_cycles`
Referenced in:
- `src/lib/signals/computeReteachEffectiveness.ts` (function reads/upserts into it by name)
- `docs/superpowers/plans/2026-06-18-p3-signals.md` (multiple references)
- `docs/v1-mining-findings.md`

**Does NOT exist.** No migration creates this table. The P4b seed spec references `detectCompletedReteachCycles` which returns records "ready for upsert into reteach_cycles" — the migration must be written as part of P4b or the function must hold results in memory only.

### `high_fives`
Referenced in spec nav (High Fives screen at `/high-fives`) but no table by this name exists in any migration. "High Fives" is a UI screen concept, not necessarily a DB table — the screen may derive its data from existing tables (`skill_learning_state.last_reteach_outcome`, `student_model_snapshots`, `homework_attempts` with improved reteach cycles). **No `high_fives` table exists.**

### `alert_dismissals`
No table by this name exists in any migration. Alerts screen is in scope for P4b but the dismissal state table is not present. **No `alert_dismissals` table exists.**

### `notifications`
No `notifications` table exists in any migration. `SCOPE.md` and config reference Resend for transactional email but there is no DB notifications table. **No `notifications` table exists.**

---

## Additional platform/licensing tables (present but not in spec scope)

These exist in migrations but are not primary consumers of the seed/provisioning plan. Noted for completeness:

- `public.license_keys` (0007) — HMAC burn ledger; `tier` CHECK: `('essentials','professional','enterprise')`; `status` CHECK: `('pending','active','expired','revoked')`
- `public.license_usage` (0007) — monthly snapshots; UNIQUE `(school_id, month)`
- `public.license_events` (0007) — audit log
- `public.trial_events` (0007) — lifecycle breadcrumbs; `event_type` CHECK: 18 values including `'trial_signup'`, `'upgrade_completed'`, `'trial_converted'`, etc.
- `public.platform_events` (0008)
- `public.platform_links` (0008) — `product` CHECK: `('spark','lift','custom')`; UNIQUE `(school_id, product)`
- `public.external_identities` (0008) — UNIQUE `(school_id, provider, external_id)`
- `public.webhook_idempotency_keys` (0008) — `status` CHECK: `('in_progress','completed','failed')`

---

## Enum and CHECK-value quick reference

| Table.Column | CHECK values |
|---|---|
| `schools.trial_status` | `'inactive','active','expired','converted','cancelled'` |
| `users.role` | `'teacher','student','parent','school_admin','school_sysadmin','platform_admin'` |
| `lessons.status` | `'draft','pending_review','approved','published','archived'` |
| `quizzes.status` | `'draft','pending_review','approved','published','archived'` |
| `quiz_questions.question_type` | `'mcq','open','numeric'` (0010 extended from `'mcq','open'`) |
| `quiz_attempts.mastery_band` | `'reteach','grade_level','advanced'` |
| `quiz_attempts.grading_status` | `NULL \| 'pending' \| 'complete'` (named constraint, 0011) |
| `assignments.mastery_band` | `'reteach','grade_level','advanced'` |
| `homework_attempts.effort_label` | `NULL \| 'effortful_success' \| 'struggling_trying' \| 'independent_success' \| 'independent_struggle'` |
| `student_model_snapshots.mastery_band` | `'reteach','grade_level','advanced'` |
| `student_model_snapshots.snapshot_schema_version` | `NULL \| 'v1' \| 'v2'` |
| `skill_learning_state.state` | `'needs_different_instruction','needs_more_time','on_track','ready_to_extend','insufficient_data','not_attempted'` |
| `skills.status` | `'unreviewed','active','merged','retired'` |
| `skills.created_by` | `'ai','teacher','backfill'` |
| `school_licenses.tier` | `'essentials','professional','enterprise'` |
| `school_licenses.status` | `'trialing','active','past_due','suspended','cancelled'` |
| `school_licenses.billing_cycle` | `'annual','biannual'` |
| `license_keys.tier` | `'essentials','professional','enterprise'` |
| `license_keys.status` | `'pending','active','expired','revoked'` |
| `misconception_types.kind` | `'error_type','reasoning_pattern'` |
| `platform_links.product` | `'spark','lift','custom'` |
| `webhook_idempotency_keys.status` | `'in_progress','completed','failed'` |

---

## Natural upsert keys (for `ON CONFLICT` seed idempotency)

| Table | Conflict target |
|---|---|
| `users` | `(id)` |
| `guardians` | `(parent_id, student_id)` |
| `enrollments` | `(class_id, student_id)` |
| `skills` | expression index `(school_id, COALESCE(subject,''), slug)` — use `ON CONFLICT ON CONSTRAINT uq_skills_school_subject_slug` or the expression form |
| `skill_learning_state` | `(student_id, skill_id)` |
| `student_model_snapshots` | `(student_id, snapshot_date)` |
| `school_licenses` | `(school_id)` — UNIQUE constraint |
| `license_usage` | `(school_id, month)` |
| `external_identities` | `(school_id, provider, external_id)` |
| `platform_links` | `(school_id, product)` |

All other tables (classes, lessons, quizzes, quiz_questions, quiz_attempts, assignments, homework_attempts, misconception_observations) have no UNIQUE natural key — upsert by `id` or re-query by known `id` before insert.
