# Grounding — V2 data consumers of `homework_attempts` (Assignment Player write-contract)

**Date:** 2026-06-21
**Epic:** 2 — non-SPARK student Assignment Player
**Scope of this fragment:** VERBATIM current-code facts about what V2 ALREADY consumes from `homework_attempts` (and the non-existent `homework_drafts`). This is the **write-contract** the new player MUST satisfy. No opinions, no proposed changes — only what exists today.

> **Keystone confirmed.** V2's teacher signal layer + the weekly-snapshot cron already SELECT `homework_attempts` columns. **No API route writes `homework_attempts` today** — the only writers are the demo/trial *seeders*. The student Assignment Player is the missing producer; it must write exactly the columns these consumers read.

---

## 1. Does V2 have a `homework_attempts` table? Yes. `homework_drafts`? **No.**

### `homework_attempts` — full current column set

Created in **`supabase/migrations/0004_assignments_homework.sql`** (lines 24–40), then extended by **`0010_engine_columns.sql`** (none — 0010 only touches `assignments`, not `homework_attempts`) and **`0011_signals.sql`** (lines 15–34). No other migration alters it (0013/0014 are quiz-runner only; grep-confirmed). Complete column set:

| Column | Type | Default / Constraint | Added in |
|---|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` | 0004 |
| `assignment_id` | uuid | NOT NULL, FK → `assignments(id)` ON DELETE CASCADE | 0004 |
| `student_id` | uuid | NOT NULL, FK → `users(id)` ON DELETE CASCADE | 0004 |
| `status` | text | DEFAULT `'in_progress'` (no CHECK constraint) | 0004 |
| `responses` | jsonb | nullable | 0004 |
| `canvas_data` | jsonb | nullable | 0004 |
| `score_pct` | numeric | nullable | 0004 |
| `ai_feedback` | jsonb | nullable | 0004 |
| `teacher_notes` | text | nullable | 0004 |
| `teacher_score` | numeric | nullable | 0004 |
| `teli_hint_count` | int | DEFAULT `0` | 0004 |
| `submitted_on_time` | boolean | nullable | 0004 |
| `submitted_at` | timestamptz | nullable | 0004 |
| `graded_at` | timestamptz | nullable | 0004 |
| `created_at` | timestamptz | DEFAULT `now()` | 0004 |
| `effort_label` | text | nullable; named CHECK `homework_attempts_effort_label_check` | 0011 |
| `allow_redo` | boolean | DEFAULT `false` | 0011 |
| `is_redo` | boolean | DEFAULT `false` | 0011 |
| `flagged_by` | text | nullable (no CHECK; code treats as `'auto' | 'teacher' | null`) | 0011 |

**`effort_label` CHECK (0011, lines 27–34)** — `effort_label IS NULL OR effort_label IN (`
- `'effortful_success'`
- `'struggling_trying'`
- `'independent_success'`
- `'independent_struggle'`
`)`

**`status`** has **no DB CHECK**. Default is `'in_progress'` (0004). Observed values in seed code: `'graded'`, `'submitted'` (`SeedHomeworkAttempt.status: 'graded' | 'submitted'`, `buildSeedRows.ts:31`). So the live value vocabulary in use is `{in_progress (default), submitted, graded}` — unconstrained text.

**There is NO `class_id` column** on `homework_attempts` (intentional — "C10"/"C18"). Class scoping is done via the parent `assignments.class_id`. The seeders + `computeReteachEffectiveness` explicitly assert `class_id` is absent. The player must NOT write `class_id`.

**RLS (0004, lines 43–60):** `homework_attempts_owner_read` SELECT policy = `student_id = auth.uid()` OR teacher-of-class OR platform_admin. `GRANT ALL` to authenticated/anon/service_role. (Writes from the player would go through the admin/service-role client per V2 auth-chain convention.)

### `homework_drafts` — does NOT exist

- **Zero matches** for `homework_drafts` anywhere in the repo (no migration, no `.ts`, no docs). Grep over `C:/users/inteliflow/NEW-CORE` returned "No matches found."
- V2's **autosave-of-in-progress-work mechanism for assignments does not exist yet.** (For the quiz runner, in-progress signal capture lands in `quiz_responses` + `quiz_attempts.session_aggregates`, a *different* table family — see `api/attempts/[attemptId]/signal/route.ts`.) The Assignment Player's autosave target is an **open design question**: reuse `homework_attempts` row with `status='in_progress'` + `responses`/`canvas_data`, or introduce a new `homework_drafts` table. **Nothing is built either way.**

---

## 2. The three named signal consumers — EXACT columns SELECTed + how used

### `src/lib/signals/loadRosterSignals.ts` (teacher roster + focus-group)

SELECT (line 140): `.from('homework_attempts').select('score_pct, teli_hint_count, submitted_at, allow_redo, is_redo')` — `.eq('student_id', …).order('submitted_at', {ascending:false}).limit(10)`.

Usage:
- `score_pct` → fed to `computeRosterRiskIndex` (as `score`), to `computeHwQuizDivergence` (`homeworkScores`), and averaged into `hw_avg`.
- `submitted_at` → passed as `submitted_at` into risk index (recency/lateness), and is the ORDER key.
- `allow_redo`, `is_redo` → passed into risk index (reteach signal).
- `teli_hint_count` → **selected but not used in this file** (selected, never referenced after).
- Outputs: `RosterItem.risk`, `FocusGroupItem.{divergence_score, hw_avg, quiz_avg, diagnosis}`. Diagnosis ("Needs you today") combines divergence + hw_avg + quiz_avg + recurring misconception error_types.
- **Drives:** the teacher Today/roster "who needs you" focus group + risk badges.

### `src/lib/signals/loadStudentSignals.ts` (one-student drill-in)

SELECT (lines 156–159): `.from('homework_attempts').select('id, score_pct, teli_hint_count, effort_label, submitted_at, allow_redo, is_redo, assignment_id, student_id, flagged_by, created_at')` — `.eq('student_id', …).order('submitted_at', desc).limit(20)`.

Usage:
- `score_pct` → `computeHwQuizDivergence` (`homeworkScores`) + `computeRosterRiskIndex` (`score`).
- `effort_label` → **dominant effort pattern** = modal of last 5 non-null `effort_label` values (`effort.dominant_effort_pattern`). Requires the 4-value enum.
- `allow_redo`, `is_redo`, `flagged_by`, `id`, `student_id`, `assignment_id`, `created_at`, `submitted_at` → all passed to `detectCompletedReteachCycles` (reteach-outcome detection — see §below).
- `teli_hint_count` → **selected but not used in this file**.
- Outputs `StudentSignals.{divergence, effort, risk.roster, reteach_outcomes}`.
- **Drives:** the per-student drill-in (divergence flag, effort read, risk, reteach outcomes).

### `src/lib/signals/computeHwQuizDivergence.ts` (pure fn — no DB)

Pure compute, **reads no DB**. Inputs `homeworkScores: (number|null)[]` (= `score_pct` newest-first) and `quizScores`. Constants: `MIN_HW_SAMPLES=2`, `MIN_QUIZ_SAMPLES=1`, `ALIGNMENT_THRESHOLD=10`. Returns `{divergence_score 0–100, divergence_direction 'hw_higher'|'quiz_higher'|'aligned', divergence_trend 'widening'|'narrowing'|'stable'|null, hw_avg, quiz_avg}`. Score formula when gap > 10: `Math.round(Math.min(100,(abs(gap)/50)*100))`. **Only consumes `score_pct`** (via its caller).

---

## 3. Every OTHER consumer of `homework_attempts` (grep over V2 src)

### `src/lib/signals/computeReteachEffectiveness.ts` (`detectCompletedReteachCycles`)
Pure fn, no DB. Input row shape `HomeworkAttemptRow` = `{id, student_id, assignment_id, score, allow_redo, is_redo, flagged_by:'auto'|'teacher'|null, submitted_at, created_at}` (called by `loadStudentSignals`). Logic: a reteach cycle is "complete" when an attempt has `allow_redo=true` + a graded `score`, and a *later* attempt on the same `assignment_id` exists with a `score` + `submitted_at` (the redo). Produces `pre_score`/`post_score`/`improvement`. **Comment line 17:** "homework_attempts has no class_id column — removed from HomeworkAttemptRow." Consumes: `id, student_id, assignment_id, score_pct(→score), allow_redo, is_redo, flagged_by, submitted_at, created_at`.

### `src/app/api/cron/weekly-snapshot/route.ts` (the BIG read — feeds every snapshot)
SELECT (lines 204–205): `.from('homework_attempts').select('score_pct, teli_hint_count, effort_label, submitted_at, allow_redo, is_redo')` — `.eq('student_id', …).order('submitted_at', desc).limit(20)`. Computes and writes to `student_model_snapshots`:
- `total_homework` = count of hw rows.
- `divergence_score`, `divergence_direction` ← `computeHwQuizDivergence(score_pct)`.
- `risk_score` ← `computeRosterRiskIndex(score_pct, submitted_at, allow_redo, is_redo)`.
- `dominant_effort_pattern` ← modal of last-5 `effort_label`.
- `recent_effort_labels` (jsonb) ← last 5 `{score: score_pct, hints: teli_hint_count, effort_label, submitted_at}`. **This is the ONE place `teli_hint_count` is actually consumed** (also into `avg_hints_per_attempt`).
- `avg_hints_per_attempt` ← mean of non-null `teli_hint_count`.
- These snapshot columns are then read across teacher growth/insights + parent narrative (Epic 4).

### Seeders (the ONLY current writers — NOT runtime)
- `src/lib/demo/buildSeedRows.ts` + `scripts/seedDemo.ts` (demo) and `src/lib/trial/buildTrialRows.ts` + `src/lib/trial/seedTrialDemoData.ts` (trial). **Write shape is identical** across both (`seedDemo.ts:513–525`, `seedTrialDemoData.ts:290–302`):
  ```
  { assignment_id, student_id, status, score_pct, submitted_at,
    responses (= { response_text }), effort_label, allow_redo, is_redo,
    flagged_by, [graded_at if present] }
  ```
  They DO write: `status, score_pct, submitted_at, responses, effort_label, allow_redo, is_redo, flagged_by, graded_at`.
  They do NOT write: `canvas_data, ai_feedback, teacher_notes, teacher_score, teli_hint_count, submitted_on_time`. (`teli_hint_count` falls to its DB default `0`.)
  `SeedHomeworkAttempt.responses` is typed `{ response_text: string }` — a single-string answer blob, not per-question.

### Stub consumers (built but empty — Epics 3 & 4)
- `src/app/(teacher)/gradebook/page.tsx` — **10-line `EmptyState` stub.** Does NOT yet read `homework_attempts`. (Epic 3 will need raw rows: `status, score_pct, submitted_at, graded_at, teacher_score`.)
- `src/app/(teacher)/high-fives/page.tsx`, `alerts/page.tsx`, `insights/page.tsx` — stubs (per CLAUDE.md, 10-line stubs).
- `src/app/(parent)/parent/dashboard/page.tsx` — stub ("being set up").
- These do **not** read `homework_attempts` directly today; they will consume it via the snapshot/signal libs above once built.

### Tests (assert the contract — must keep green)
- `supabase/migrations/__tests__/migrations.test.ts` — asserts table creation + that `score_pct, ai_feedback, teli_hint_count, submitted_on_time` columns exist + ON DELETE CASCADE on `assignment_id`/`student_id`.
- `src/lib/signals/__tests__/migration0011.test.ts` — asserts `effort_label`, `allow_redo`, `is_redo`, `flagged_by` columns + named effort CHECK.
- `src/lib/demo/__tests__/buildSeedRows.test.ts` + `buildTrialRows.test.ts` — assert effort enum, `class_id` ABSENT, the four gradebook cell states (graded / submitted / missing / not-due).

### NOT a consumer (clarification)
- `src/app/api/attempts/[attemptId]/signal/route.ts` and `spark-attempt-complete/route.ts` write `quiz_attempts` / `quiz_responses` / `assignments`, **never `homework_attempts`**. The grep hit on `signal/route.ts` was a `quiz_attempts` `.from()`, not homework.

---

## 4. AUTHORITATIVE TABLE — column → consumer → what the player MUST write

| `homework_attempts` column | Consumed by | What the player MUST write |
|---|---|---|
| `id` | reteach cycles (loadStudentSignals → detectCompletedReteachCycles) | auto (PK) |
| `assignment_id` | reteach grouping; FK | the assignment being worked |
| `student_id` | every consumer (`.eq('student_id')`), reteach | the student |
| `status` | seed gradebook-state test; Epic-3 gradebook (future) | `'in_progress'` while working → `'submitted'` on submit → `'graded'` after grading. (No CHECK; keep to this vocabulary.) |
| `responses` (jsonb) | seeders write it; grader reads student answers | the student's answers (player's answer payload) |
| `canvas_data` (jsonb) | **nothing yet** (column exists since 0004) | the drawing-canvas strokes (player feature) — no current reader, but the column is the intended home |
| `score_pct` (numeric) | **divergence, risk, hw_avg, reteach pre/post, snapshot avg/divergence/risk** — the single most-consumed column | graded percentage 0–100 (written at grade time) |
| `ai_feedback` (jsonb) | migration test asserts existence; no runtime reader yet | Teli/grader feedback (player + grader) |
| `teacher_notes` (text) | none yet (Epic 3 gradebook) | n/a for player (teacher write) |
| `teacher_score` (numeric) | none yet (Epic 3 gradebook override) | n/a for player (teacher write) |
| `teli_hint_count` (int) | **weekly-snapshot** `recent_effort_labels` + `avg_hints_per_attempt`; selected (unused) in roster/student libs | **count of hints the student pulled from the hint ladder** — currently ALWAYS 0 because nothing writes it. The player is the intended writer. |
| `submitted_on_time` (boolean) | migration test only; **no runtime reader** | optional; safe to set vs `due_at`, but no consumer depends on it |
| `submitted_at` (timestamptz) | **ORDER key in all 3 libs + cron; recency/lateness in risk; reteach completed_at** | timestamp at submit |
| `graded_at` (timestamptz) | seeders write it; gradebook cell-state test (graded vs submitted) | timestamp at grade |
| `created_at` (timestamptz) | reteach chronological sort | auto (default `now()`) |
| `effort_label` (text, 4-enum) | **loadStudentSignals dominant-effort; weekly-snapshot dominant + recent_effort_labels** | one of `effortful_success`/`struggling_trying`/`independent_success`/`independent_struggle` — **HOW the player derives this is an open question** (V1 reference). Seeders set it directly; no runtime derivation exists in V2. |
| `allow_redo` (boolean) | **risk index + reteach-cycle detection** (loadRoster, loadStudent, cron) | reteach/redo eligibility flag |
| `is_redo` (boolean) | **risk index + reteach-cycle detection** | true when this attempt is a redo of a flagged one |
| `flagged_by` (text) | reteach `flagged_by` ('auto'|'teacher') | who flagged the reteach (player likely writes `'auto'` on auto-reteach, else teacher) |

---

## 5. GAP FLAGS (player epic must resolve)

1. **`homework_drafts` table does not exist.** If the player wants a separate autosave/draft store (V1 had assignment autosave), the migration must add it. Otherwise autosave reuses the `homework_attempts` row with `status='in_progress'` + `responses`/`canvas_data`. **Both columns already exist** — so a new table is NOT required if reusing the in-progress row is acceptable. **Open design question, nothing built.**
2. **`teli_hint_count` is read by the weekly-snapshot cron but written by NOTHING.** Every snapshot's `avg_hints_per_attempt` / `recent_effort_labels.hints` is currently `0`/`null` because the only writers (seeders) omit it. The player's hint ladder is the intended producer — **this is the headline "consumed but unproduced" column.**
3. **`effort_label` has no runtime derivation in V2.** Consumers (student-drill effort read, snapshot dominant-effort) depend on it, but only seeders set it. The player (or grader) must derive it from the 4-value enum — derivation logic is a V1-reference / spec question.
4. **`canvas_data` + `ai_feedback` exist since 0004 but have zero runtime readers** — the player/grader are their intended first writers; no existing consumer constrains their shape.
5. **No column is consumed-but-MISSING-from-schema.** Every column the libs/cron SELECT (`score_pct, teli_hint_count, effort_label, submitted_at, allow_redo, is_redo, id, assignment_id, student_id, flagged_by, created_at`) exists in a V2 migration. The gap is *production*, not *schema* — the player must POPULATE these, not add them.

---

## Files read in full
- `supabase/migrations/0004_assignments_homework.sql`
- `supabase/migrations/0010_engine_columns.sql`
- `supabase/migrations/0011_signals.sql`
- `src/lib/signals/loadRosterSignals.ts`
- `src/lib/signals/loadStudentSignals.ts`
- `src/lib/signals/computeHwQuizDivergence.ts`
- `src/lib/signals/computeReteachEffectiveness.ts`
- `src/app/api/cron/weekly-snapshot/route.ts`
- `src/app/api/attempts/[attemptId]/signal/route.ts`
- `src/lib/demo/buildSeedRows.ts` (relevant ranges) + `scripts/seedDemo.ts` (writer)
- `src/lib/trial/seedTrialDemoData.ts` (writer)
- `src/app/(teacher)/gradebook/page.tsx`, `high-fives/page.tsx`; `src/app/(parent)/parent/dashboard/page.tsx`
