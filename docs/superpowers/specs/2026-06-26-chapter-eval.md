# Chapter-Level Evaluation — Design Spec

> **Grounding:** inline (2026-06-26). V1 reference: `C:/users/inteliflow/core/supabase/migrations/065_chapter_tests.sql` + V1 chapter-test routes.
> **Status:** spec for sign-off. After sign-off: `writing-plans` → SDD.

## Goal

Port V1's chapter/unit-level evaluation system into V2. Teachers group lessons into chapters, generate a differentiated chapter test (per-student, 5 sections, 6 question types, 44 min, 60 pts), students take the test, and grades flow into the gradebook as first-class columns.

This is the evaluation counterpart to the Assignment Player (homework) and Quiz Runner (diagnostic). Chapter tests are **graded assessments** that count toward a student's final grade — not diagnostic.

## Locked decisions (Marvin, 2026-06-26)

| # | Decision | Choice |
|---|---|---|
| D1 | Scope | **Full port now** — all segments in one epic: chapters + tests + generation + student runner + async grading + gradebook columns |
| D2 | Schema | Explicit `chapters` table (not derived from `lessons.chapter_title`) — first-class entity matching V1 |
| D3 | Template | Port V1's locked 44-min / 60-pt / 5-section template verbatim; no customization UI for V2 |
| D4 | Question differentiation | Per-student questions keyed on `(section, student, comprehension_band, learning_style)` — mirrors V1 |
| D5 | Grade type | `total_grade` (not `score_pct`) — chapter tests are summative; counts toward GPA (mirrors V1 + the existing `teacher_score`/graded-assignment pattern) |
| D6 | Test runner | New student-facing component tree — does NOT refit the quiz runner |

## Architecture

```
Teacher creates chapter → assigns lessons → triggers test generation
  → per-student questions generated (Claude, batched)
  → teacher publishes test
  
Student receives → takes test (44 min wall-clock, 5 sections, free navigation)
  → saves responses per-question
  → submits → async grading (Claude, per-response)
  → total_grade rolled up → gradebook column updates

Teacher sees chapter_test_columns in gradebook (alongside assignment columns)
  → drill-in: total_grade + per-section grade + question count
```

## Data model (new migration: 0030)

Six new tables. All RLS-enabled, deny-by-default.

**`chapters`**
```sql
id uuid PK, class_id uuid FK classes(id), teacher_id uuid FK users(id),
title text NOT NULL, description text, sequence int NOT NULL DEFAULT 0,
created_at timestamptz DEFAULT now(), archived_at timestamptz
```
UNIQUE(class_id, title). Index on (class_id, archived_at, sequence).

**`chapter_tests`**
```sql
id uuid PK, chapter_id uuid FK chapters(id) ON DELETE CASCADE,
class_id uuid FK classes(id), teacher_id uuid FK users(id),
title text NOT NULL, template text NOT NULL CHECK IN ('humanities','stem'),
total_minutes int NOT NULL DEFAULT 44, total_points int NOT NULL DEFAULT 60,
generation_status text DEFAULT 'draft' CHECK IN ('draft','queued','generating','ready','failed'),
status text DEFAULT 'draft' CHECK IN ('draft','published','archived'),
published_at timestamptz, archived_at timestamptz,
created_at timestamptz DEFAULT now()
```

**`chapter_test_sections`**
```sql
id uuid PK, chapter_test_id uuid FK chapter_tests(id) ON DELETE CASCADE,
section_order int NOT NULL, section_kind text NOT NULL
  CHECK IN ('vocabulary','short_answer','compare_contrast','data_interpretation','mini_essay','multi_step_problem'),
title text NOT NULL, time_minutes int NOT NULL, total_points int NOT NULL,
power_skill text
```
UNIQUE(chapter_test_id, section_order).

**`chapter_test_questions`**
```sql
id uuid PK, section_id uuid FK chapter_test_sections(id) ON DELETE CASCADE,
student_id uuid FK users(id), question_order int NOT NULL,
question_type text NOT NULL CHECK IN ('mcq','matching','short_answer','data_interpretation','mini_essay','multi_step_problem'),
question_text text NOT NULL, payload jsonb NOT NULL DEFAULT '{}',
points int NOT NULL, comprehension_band text, learning_style text,
created_at timestamptz DEFAULT now()
```
UNIQUE(section_id, student_id, question_order).

**`chapter_test_attempts`**
```sql
id uuid PK, chapter_test_id uuid FK chapter_tests(id),
student_id uuid FK users(id),
started_at timestamptz DEFAULT now(), submitted_at timestamptz,
last_active_at timestamptz DEFAULT now(),
status text DEFAULT 'not_started' CHECK IN ('not_started','in_progress','submitted','graded'),
total_grade numeric, total_max int,
forfeit_reason text CHECK IN ('closure','time_up') -- NULL = normal submit
```
UNIQUE(chapter_test_id, student_id). One attempt per (test, student).

**`chapter_test_responses`**
```sql
id uuid PK, attempt_id uuid FK chapter_test_attempts(id) ON DELETE CASCADE,
question_id uuid FK chapter_test_questions(id),
response_text text, response_payload jsonb DEFAULT '{}',
grade numeric, ai_feedback text, graded_at timestamptz,
created_at timestamptz DEFAULT now()
```
UNIQUE(attempt_id, question_id).

## Template (locked — mirrors V1 migration 065)

| Section | Kind | Time | Pts | Power Skill | Humanities | STEM |
|---|---|---|---|---|---|---|
| 1 | vocabulary | 8 min | 10 | foundational | Matching + use-in-context | Notation/units |
| 2 | short_answer | 10 min | 15 | think | Explain principle | Explain steps |
| 3 | compare_contrast / data_interpretation | 8 min | 10 | think | Compare concepts | Data analysis |
| 4 | data_interpretation | 10 min | 15 | research | Source analysis | Lab data |
| 5a | mini_essay (humanities) | 8 min | 10 | communicate | Claim/evidence/explain | — |
| 5b | multi_step_problem (stem) | 8 min | 10 | think | — | Problem solving |

## File structure

**New lib:**
- `src/lib/chapters/chapterTemplates.ts` — section structure constants (locked)
- `src/lib/chapters/generateChapterTest.ts` — `generateChapterQuestions(chapterTestId, students, lessonTexts): Promise<void>` — calls Claude per student per section, inserts into `chapter_test_questions`
- `src/lib/chapters/gradeChapterTest.ts` — `gradeChapterAttempt(attemptId): Promise<void>` — per-response Claude grading, rolls up to `total_grade`
- `src/lib/gradebook/loadGradebook.ts` — MODIFY: add `chapter_test_columns` + `chapter_test_cells` to the return type

**New routes:**
- `POST /api/teacher/chapters` — create chapter
- `GET|PATCH|DELETE /api/teacher/chapters/[chapterId]` — manage chapter
- `POST /api/teacher/chapter-tests` — create + queue generation
- `GET /api/teacher/chapter-tests/[chapterTestId]` — poll generation_status + section counts
- `PATCH /api/teacher/chapter-tests/[chapterTestId]` — publish / archive
- `GET /api/teacher/chapter-tests/[chapterTestId]/students/[studentId]` — per-student question set (teacher preview + student fetch)
- `POST /api/attempts/chapter-test/start` — create/resume attempt (wall-clock)
- `POST /api/attempts/chapter-test/save-response` — per-question autosave
- `POST /api/attempts/chapter-test/submit` — final submit → triggers `gradeChapterAttempt` via `after()`

**New pages:**
- `src/app/(teacher)/gradebook/` — MODIFY: extend `GradebookGrid` to render chapter test columns (after assignment columns, before diagnostic quizzes)
- `src/app/(teacher)/chapters/` — chapter management page (list chapters for the class, link lessons, create test)
- `src/app/(student)/student/chapter-test/` — chapter test player (`?chapterTestId=`)

**New components:**
- `src/app/(teacher)/chapters/_components/ChapterList.tsx` — chapter list + create
- `src/app/(teacher)/chapters/_components/ChapterTestGenerator.tsx` — create test, pick template, show generation progress
- `src/app/(student)/student/chapter-test/_components/ChapterTestPlayer.tsx` — 5-section layout, per-section question render, timer, save/submit

## Segments (plan per SDD order)

**Seg 1 — Schema + chapter management (teacher)**
Migration 0030 (all 6 tables). Teacher chapters page: create/edit/sequence chapters, assign lessons. No test generation yet.

**Seg 2 — Chapter test creation + generation**
`generateChapterQuestions` engine. Teacher creates test, picks template, triggers generation, polls `generation_status`. Teacher preview of generated questions per student.

**Seg 3 — Gradebook extension**
`loadGradebook` extended with `chapter_test_columns` + `chapter_test_cells`. `GradebookGrid` renders chapter columns. Drill-in shows chapter test total_grade + per-section breakdown.

**Seg 4 — Student chapter test player**
`/student/chapter-test` player: start/resume, 5 sections, free navigation, per-question save, wall-clock timer (44 min hard + per-section soft), forfeit on tab-close or time-up, final submit.

**Seg 5 — Async grading pipeline**
`gradeChapterAttempt`: per-response Claude grading (rubric-scored for open types, exact-match for MCQ/matching), roll up to `total_grade`, write back to attempt + responses, trigger gradebook refresh signal.

## Four-audience compliance

- Chapter test results are **graded** (summative) — students SEE their `total_grade` after grading (same as homework assignments), not before.
- `per-section breakdown` shown to teacher; aggregate `total_grade` shown to student.
- No raw risk/band/CL on the chapter test result — it's a grade, not a diagnostic.
- Parent sees the chapter test grade as part of the student's grade history (no band/CL on parent view).

## Test plan (TDD, per segment)

Seg 1: chapter CRUD scoped by class; section template constants match V1; migration test assertions.
Seg 2: `generateChapterQuestions` produces questions per student; question uniqueness constraint enforced; generation_status transitions.
Seg 3: `loadGradebook` returns `chapter_test_columns`; cells keyed by (student_id, chapter_test_id); empty chapter shows column with no cells.
Seg 4: attempt UNIQUE(test, student); wall-clock timer fires forfeit at 44 min; save-response is idempotent.
Seg 5: MCQ graded synchronously; open types graded via Claude; total_grade = sum of response grades; forfeit attempt graded with available responses.

## Gates

tsc 0 · vitest green · build 0 (a11y + tokens). Migration 0030. Strings → `STRINGS-FOR-BARB.md §Chapter Eval`.
