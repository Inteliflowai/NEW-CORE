# Epic 3a — Teacher Gradebook (Design Spec)

**Date:** 2026-06-22
**Author:** Design pass for the Epic 3a build (CORE V2)
**Status:** Design — ready for `writing-plans` → subagent-driven-development
**Scope owner:** Marvin (sign-off on the locked decisions below)
**Grounding:** `docs/superpowers/plans/grounding/2026-06-21-teacher-completion/` (v1-gradebook.md, v1-insights.md, v2-current-state.md) + the verified-current-code facts cited inline below.

> Every file path, column name, and signature in this spec is quoted verbatim from the current codebase (verified `2026-06-22`). Where a relied-upon fact was found to be **wrong or missing**, it is called out as **FLAG** / **OPEN QUESTION** rather than papered over.

---

## 1. Goal & Non-goals

**Goal.** Replace the 10-line `(teacher)/gradebook/page.tsx` stub with a full, class-scoped teacher gradebook: a students × assignments grade grid (graded coursework, counted in a class average) with a clearly-separated, read-only "Diagnostic checks — not graded" quiz section, and a click-a-cell drill-in that lets a teacher override an assignment grade and toggle a reteach (redo) — all behind the binding auth chain, token-only Pop-Art chrome, and the four-audience copy discipline.

**Non-goals (explicitly OUT of scope for this spec):**
- **3b — LEAN Alerts, High-Fives, Insights.** Separate spec; not built here.
- **Assignment Player Segments 4 (drawing canvas) and 5 (voice).** Deferred to after Epic 3.
- **Teacher assignment-authoring UI / due-date authoring / class-meeting-schedule model.** The gradebook *reads* `assignments.due_at` and *displays* late/on-time; it does not author assignments or define "next class". (See §11 — `classes.period` is text-only; no structured meeting-days model exists.)
- **A new migration.** None is needed (see §2).
- **Bulk grade entry, CSV export, weighting/grade-category schemes.** Not V1-parity-critical for the pilot gradebook; out of scope.

---

## 2. Architecture & data flow

```
Browser (teacher)
   │  GET /gradebook?class=<classId>
   ▼
(teacher)/gradebook/page.tsx          ── Server Component (async) ──────────────
   1. resolve classId from searchParams  (first-class redirect when absent)
   2. guardClassAccess(classId)          (IDOR — teacher owns class)  ← ONLY backstop
   3. admin = createAdminSupabaseClient() (RLS-bypassed)
   4. data = await loadGradebook(admin, { classId, teacherId })
   5. render <GradebookGrid> + <DiagnosticChecksSection>
   │
   ├── (client) cell click → opens <GradebookDrillIn> panel (data already in props)
   │
   └── (client) override / reteach submit
          │  POST /api/teacher/gradebook/override   { attempt_id, … }
          ▼
       route.ts  ── auth chain again (server can't trust client) ──────────────
          1. createServerSupabaseClient() → auth.getUser()
          2. STAFF_ROLES gate (import canonical @/lib/auth/roles)
          3. resolve assignment.class_id for the attempt → guardClassAccess(classId)
          4. admin.from('homework_attempts').update({...}).eq('id', attempt_id)
          5. after(): recomputeSkillStatesForStudent(admin, { studentId, schoolId:null })
          6. revalidatePath('/gradebook')   (or client router.refresh())
```

**No migration is required.** All columns the gradebook reads/writes already exist:

- `homework_attempts.teacher_score numeric` and `homework_attempts.teacher_notes text` — migration `0004` (`0004_assignments_homework.sql:33-34`). These are the override target and the override note. **Confirmed.**
- `homework_attempts.allow_redo boolean DEFAULT false` and `flagged_by text` — migration `0011` (`0011_signals.sql:16,18`). The reteach toggle writes `allow_redo`. **Confirmed — the reteach mechanism exists; no new migration needed.**

**FLAG — `teacher_override_reason` is NOT on `homework_attempts`.** The locked-design note that `homework_attempts` has `teacher_override_reason` is **wrong**. That column lives on the **`assignments`** table only (`0004_assignments_homework.sql:16`), not on `homework_attempts` (verified: `homework_attempts` columns are `id, assignment_id, student_id, status, responses, canvas_data, score_pct, ai_feedback, teacher_notes, teacher_score, teli_hint_count, submitted_on_time, submitted_at, graded_at, created_at` from 0004, plus 0011/0015 additions — no `teacher_override_reason`). **Decision (no migration):** the per-attempt override reason is stored in the existing `homework_attempts.teacher_notes text` column. We do **not** write the assignment-level `assignments.teacher_override_reason` from the gradebook (it is assignment-scoped, not attempt-scoped, and overwriting it would corrupt assignment authoring). This is sufficient and avoids a migration. (If a *structured* reason ever becomes required, the smallest migration would be `ALTER TABLE public.homework_attempts ADD COLUMN IF NOT EXISTS teacher_override_reason text;` — but that is **not** recommended for 3a; `teacher_notes` covers it.)

---

## 3. Data model & grade semantics

### 3.1 Existing columns used (verbatim)

**`homework_attempts`** (cells — graded coursework) — `0004` + `0011` + `0015`:
| column | type | role in gradebook |
|---|---|---|
| `id` | uuid PK | drill-in target / override `.eq('id', …)` |
| `assignment_id` | uuid FK→assignments ON DELETE CASCADE | maps attempt → column |
| `student_id` | uuid FK→users ON DELETE CASCADE | maps attempt → row |
| `status` | text DEFAULT `'in_progress'`, CHECK (0015) ∈ `in_progress, submitted, grading, graded, pending_grade` | cell glyph |
| `score_pct` | numeric (no range CHECK) | the AI/auto earned grade the **student sees** |
| `teacher_score` | numeric | the **override** grade (override-wins; see §3.2) |
| `teacher_notes` | text | override note + reason (per §2 FLAG) |
| `effort_label` | text, CHECK (0011) ∈ `effortful_success, struggling_trying, independent_success, independent_struggle` or NULL | drill-in effort line |
| `teli_hint_count` | int DEFAULT 0 | drill-in; recompute effort fallback |
| `allow_redo` | boolean DEFAULT false (`0011`) | reteach toggle target |
| `is_redo` | boolean DEFAULT false (`0011`) | distinguishes redo attempts |
| `attempt_no` | int NOT NULL DEFAULT 1 (`0015`) | pick the latest attempt per assignment |
| `task_grades` | jsonb (`0015`) | optional per-task breakdown in drill-in |
| `submitted_on_time` | boolean (nullable) | late badge |
| `submitted_at` | timestamptz | drill-in date; latest-attempt ordering |
| `graded_at` | timestamptz | drill-in |
| `review_required` | boolean NOT NULL DEFAULT false (`0015`) | "needs review" cue (optional) |

**`assignments`** (columns) — `0004`:
`id`, `class_id uuid NOT NULL FK→classes`, `student_id uuid NOT NULL FK→users`, `lesson_id uuid FK→lessons` (**nullable**; the seed sets it `?? undefined` so it MAY be NULL), `content jsonb NOT NULL`, `status text DEFAULT 'draft'` (free text — no CHECK), `due_at timestamptz` (nullable), `mastery_band text CHECK (reteach/grade_level/advanced)`, `created_at timestamptz`.

**CONFIRMED FACT (not an open question) — `content` has NO `title`.** The seeded/prod `content` shape is `{ bandLabel, instructions, tasks }` only (verified `buildSeedRows.ts:157-161`, `seedDemo.ts:471-477`). There is **no `content.title`**, and **no `assignment_group_id`/`template_id`**. So a `content.title ?? 'Assignment'` header would collapse EVERY column to the literal "Assignment" — the date-derived header (§4.3 step 2) is therefore the **normal production path**, not an edge case.

**`assignments` is per-`(student_id, class_id)`** — the same logical assignment is *fanned out per student* (mirrors V1; the seed inserts one row per student per logical assignment, deduped on `(student_id, class_id, due_at)` — `seedDemo.ts:455-485`). See §4.3 step 2 for how the loader collapses this into grid columns and how the column key is derived.

**`quiz_attempts`** (diagnostic section) — `0003` + later:
`id`, `quiz_id`, `student_id`, `score_pct numeric`, `raw_score numeric`, `mastery_band text CHECK (reteach/grade_level/advanced)` (**TEACHER-ONLY** per leak-guard), `is_complete boolean DEFAULT false` (**the completeness signal the loader uses** — present since `0003`), `submitted_at`/`started_at timestamptz`. **No direct `class_id`** — class is reached via `quizzes.class_id`. (Note: `grading_status` exists too — column added in `0010`, CHECK added in `0011` — but the loader does **not** use it; `is_complete` is the diagnostic-cell completeness signal.)

**`quizzes`** (diagnostic column headers) — `0003`: `id`, `class_id`, `title text` (the human-safe column label — present, `0003_lessons_quizzes.sql:29`; the seed sets `title: 'Demo Quiz'`). See §4.3 step 4.

**`enrollments`** (rows) — `0002`: `class_id`, `student_id`, `is_active boolean DEFAULT true`, `UNIQUE(class_id, student_id)`. Roster = active enrollments for the class.

**`users`** (row labels) — `0001`: `id`, `full_name text NOT NULL`, `display_name text` (prefer for label when present), `role`, `school_id`, `is_active`.

### 3.2 Override-wins rule (the load-bearing grade semantic)

The system already has **one** authoritative precedence, used by `recomputeSkillStates.ts:248-254`:

```ts
// C10: gradePct = teacher_score ?? score_pct (no phantom `grade`)
const gradePct = (typeof graded.teacher_score === 'number')
  ? graded.teacher_score
  : (graded.score_pct ?? null);
```

The gradebook **must** use this exact rule at every render site and in the loader:

> **`displayedGrade = teacher_score ?? score_pct`** (teacher override wins; otherwise the auto/AI grade).

**Graded-attempt integrity (binding).** A grade override:
- writes **only** `homework_attempts.teacher_score` (and `teacher_notes`); it **must NOT overwrite `score_pct`**. `score_pct` is the immutable AI/auto grade. This preserves the student-visible earned-grade semantics: the student already sees `teacher_score ?? score_pct` at their render sites, so an override transparently *raises/changes the grade the student sees* without destroying the original auto grade (auditable, reversible).
- **must NOT change `status`** away from `'graded'` (the row stays graded; only the number changes).
- **clearing an override** = set `teacher_score = null` (reverts to `score_pct`).
- after a successful write, schedules `recomputeSkillStatesForStudent` so the moat (skill states, effort signals downstream) reflects the override — because `recomputeSkillStates` already reads `teacher_score ?? score_pct`.

### 3.3 Class average (assignments only)

- The class-average footer is computed **over assignment cells only** — quizzes are **never** in the average (binding: assignments-graded-vs-quizzes-coached).
- **A cell counts toward the average iff it has a non-null `displayedGrade`** — i.e. it derives from a graded attempt: statuses `graded`, `redo`, and `redo_in_progress` (the latter two keep the prior graded grade so granting/starting a redo doesn't drop the earned grade from the average until the redo is itself graded). The value used is `displayedGrade = teacher_score ?? score_pct`.
- **Per assignment column footer** = arithmetic mean of `displayedGrade` across the counted cells in that column. Cells with no grade — `submitted` (turned in, not graded), `missing`, `not_due`, `none` — are **excluded** from the denominator (they are not zeros — treating an un-graded assignment as a 0 would distort the coach-posture read; V1 parity does not zero-fill the average).
- **Per student row footer** (right-edge, optional) = mean of that student's graded assignment cells.
- **Overall class average** = mean of all graded assignment cells across the matrix (single number; teacher-only, raw number allowed).
- All averages render `—` (em dash) when the denominator is 0 (nothing graded yet), never `0%` or `NaN`.

### 3.4 Missing-work summary line

A single deep-ink sentence above/below the grid summarizing **missing/overdue** assignment work for the class. "Missing" = an assignment whose `due_at` is in the past **and** the student has no attempt for it (the `missing` cell status, §4.3 step 3). Singular/plural aware, "assignments" not "homework". **Guard discipline (binding — see §9):** this string is **count-bearing** ("2 assignments are still outstanding"), so it is leak-checked with **`hasBannedWord`/`assertNoBannedWord` only** — NOT `assertNoLeak`, whose `/\d/` pattern would throw on the digit. (This matches the existing teacher-only roster `buildSummary`, which deliberately does not run through `assertNoLeak`.) Example draft copy in §9.

---

## 4. `loadGradebook(admin, { classId, teacherId })` — loader

**New file:** `src/lib/gradebook/loadGradebook.ts` (new `src/lib/gradebook/` folder, parallel to `src/lib/signals/`).

### 4.1 Contract (mirrors `loadRosterSignals` / `loadStudentSignals`)

Like the existing loaders (`loadStudentSignals.ts:7-8`), **this fn performs NO auth.** Auth + IDOR guarding is the CALLER's responsibility; it assumes a pre-guarded `classId` and an admin (RLS-bypassed) client.

```ts
// src/lib/gradebook/loadGradebook.ts
import type { SupabaseClient } from '@supabase/supabase-js';

export async function loadGradebook(
  admin: SupabaseClient,
  args: { classId: string; teacherId: string },
): Promise<Gradebook> { … }
```

`teacherId` is passed for symmetry/telemetry and defensive scoping but is **not** the auth backstop (the caller's `guardClassAccess` is). The loader still constrains every query by `classId` (and by the resolved roster `studentIds`).

### 4.2 Return shape

```ts
export interface GradebookStudent {
  student_id: string;
  name: string;            // display_name ?? full_name
}

export interface GradebookAssignmentCol {
  assignment_key: string;  // stable logical-column key: `lesson:<lesson_id>` | `due:<iso>` | `id:<assignment_id>` (see §4.3 step 2)
  title: string;           // date-derived label ("Due Jun 12" / "Assignment {n}") — content.title is ABSENT in current data (§3.1)
  due_at: string | null;
}

// 'submitted' = turned in, not yet graded (score_pct null) — excluded from the average, distinct from 'missing'.
// 'redo_in_progress' = a graded attempt was reopened (allow_redo) AND the student started a newer in_progress attempt (attempt_no>1).
export type CellStatus = 'graded' | 'submitted' | 'not_due' | 'missing' | 'redo' | 'redo_in_progress' | 'none';

export interface GradebookCell {
  attempt_id: string | null;       // null when status === 'none'/'not_due' (no attempt)
  status: CellStatus;
  displayed_grade: number | null;  // teacher_score ?? score_pct of the latest GRADED attempt (null unless a graded attempt exists)
  is_override: boolean;            // teacher_score != null on the graded attempt
  submitted_on_time: boolean | null;
  allow_redo: boolean;
}

export interface GradebookQuizCol {
  quiz_id: string;                 // column key = quiz_id (NOT quiz_attempt_id — one column per quiz, a real grid)
  label: string;                   // quizzes.title (teacher-safe) ?? "Check {date}" fallback
}

export interface GradebookQuizCell {
  quiz_attempt_id: string | null;  // this student's latest attempt for THIS quiz (null = not taken)
  is_complete: boolean;
  score_pct: number | null;        // teacher-only render; NEVER in the class average
  mastery_band: 'reteach' | 'grade_level' | 'advanced' | null; // teacher-only — rendered ONLY via MasteryLabel/RiskBadge, never the raw enum (§7)
}

export interface Gradebook {
  class_id: string;
  students: GradebookStudent[];
  // — graded coursework —
  assignments: GradebookAssignmentCol[];      // most-recent N (see §6), newest→oldest
  cells: Record<string /*student_id*/, Record<string /*assignment_key*/, GradebookCell>>;
  // — footers —
  class_average: number | null;               // mean of graded assignment cells; null if none
  column_averages: Record<string /*assignment_key*/, number | null>;
  missing_count: number;                       // for the missing-work summary
  // — diagnostic section (NOT graded, NOT in average) —
  quizzes: GradebookQuizCol[];
  quiz_cells: Record<string /*student_id*/, Record<string /*quiz_id*/, GradebookQuizCell>>;
}
```

### 4.3 Query plan (mirrors `loadRosterSignals`)

1. **Roster (rows)** — the `loadRosterSignals.ts:69-73` template, verbatim shape:
   ```ts
   const { data: enrollments } = await admin
     .from('enrollments')
     .select('student_id, users:student_id(id, full_name, display_name)')
     .eq('class_id', classId)
     .eq('is_active', true);
   ```
   Build `students[]` (sorted by name asc). Derive `studentIds = students.map(s => s.student_id)`; use the `['__none__']` sentinel fallback for empty `.in()` (per `loadRosterSignals.ts:90-94`).

2. **Assignments (columns)** — scoped by class:
   ```ts
   const { data: assignmentRows } = await admin
     .from('assignments')
     .select('id, lesson_id, content, due_at, created_at, student_id')
     .eq('class_id', classId)
     .order('created_at', { ascending: false });
   ```
   **Collapsing per-student fan-out → one logical column (RESOLVED — verified, not an open question).** `assignments` rows are per-`(student_id, class_id)`, so group them by a stable, collision-safe `assignment_key`:
   - **Key derivation:** `lesson_id` non-null → `assignment_key = 'lesson:' + lesson_id` (the true shared logical-assignment identity across the per-student fan-out); **else** `due_at` non-null → `'due:' + due_at` (the seed's de-facto key — `seedDemo.ts:455` dedups per `(student_id, class_id, due_at)`, and a1–a4 have distinct due dates); **else** (both null) → `'id:' + assignment.id` (degenerate — the assignment becomes its own column rather than merging).
   - **Why not `(content.title, due_at)`:** `content.title` is provably absent (§3.1), so that tuple degrades to `due_at` alone. `lesson_id` is the collision-safe primary key; `due_at` is the verified fallback.
   - **Column header `title`:** derive a **distinct, human-readable** label from `due_at` — `"Due {Mon D}"` (e.g. "Due Jun 12"); for a null-`due_at` column use the ordinal `"Assignment {n}"` (n = position newest→oldest). This date-derived label is the **production header** (content.title is absent); route it to STRINGS-FOR-BARB.md and leak-check with `hasBannedWord` (it carries a date digit → **not** `assertNoLeak`; see §9).
   - Take the **most-recent N** logical columns by the group's max `created_at` (§6).
   - **Known limitation (real data, not seed):** if `lesson_id` is null for two genuinely-different assignments due the **same day**, they collapse into one `due:` column. The seed never hits this (distinct due dates); a future `assignments.assignment_group_id` migration would fully resolve it — out of scope for 3a (§11 #3).

3. **Attempts (cells)** — one batched query, `.in()` on the column assignment ids, scoped to roster students:
   ```ts
   const { data: hwAttempts } = await admin
     .from('homework_attempts')
     .select('id, assignment_id, student_id, status, score_pct, teacher_score, ' +
             'effort_label, teli_hint_count, allow_redo, is_redo, attempt_no, ' +
             'submitted_on_time, submitted_at, graded_at, task_grades, teacher_notes, review_required')
     .in('assignment_id', assignmentIds.length ? assignmentIds : ['__none__'])
     .in('student_id', studentIds.length ? studentIds : ['__none__']);
   ```
   For each `(student, assignment_key)`, consider **all** attempts in the group (not just the latest) and derive both the displayed grade and the status:
   - `gradedAttempt` = the latest attempt with `status === 'graded'` (by `attempt_no` desc, then `graded_at`/`submitted_at` desc). It sources `displayed_grade = teacher_score ?? score_pct`, `is_override = teacher_score != null`, and `allow_redo`.
   - `latestAttempt` = the latest attempt overall (any status).

   Compute `CellStatus` (first match wins):
   - `none` → no `assignments` row for this student at all (glyph `—`, inert).
   - `redo_in_progress` → a `gradedAttempt` exists **and** `latestAttempt` is a newer non-graded attempt with `attempt_no > 1` (the student reopened a redo). **`displayed_grade` stays the prior graded grade** (last-known, shown muted) — glyph `⟳`. *(Security-review fix: the cell must NOT silently revert to missing/not_due and lose the earned grade while a redo is in flight.)*
   - `redo` → `gradedAttempt` with `allow_redo === true` and **no** newer non-graded attempt (teacher granted a redo the student hasn't started) — glyph `⟳`; `displayed_grade` = the graded grade.
   - `graded` → `latestAttempt.status === 'graded'` (glyph ✓); `displayed_grade` as above. Counted in the average.
   - `submitted` → `latestAttempt.status ∈ {submitted, grading, pending_grade}` and no `gradedAttempt` (turned in, not yet graded) — glyph `⋯` + "in"; `displayed_grade = null`; **excluded from the average** (it is neither a zero nor missing — it WAS turned in). *(Completeness-review fix: the seed produces this state, e.g. A2/marcus — `buildSeedRows.ts:206-215`.)*
   - `missing` → `due_at` is in the past and there is **no attempt at all** (glyph `miss`).
   - `not_due` → no attempt and `due_at` is null or in the future (glyph `·`).

4. **Quizzes (diagnostic section)** — `quiz_attempts` has no `class_id`; resolve via `quizzes`:
   ```ts
   const { data: classQuizzes } = await admin
     .from('quizzes').select('id, title').eq('class_id', classId);
   const quizIds = classQuizzes.map(q => q.id);
   const { data: quizAttempts } = await admin
     .from('quiz_attempts')
     .select('id, quiz_id, student_id, score_pct, mastery_band, is_complete, submitted_at')
     .in('quiz_id', quizIds.length ? quizIds : ['__none__'])
     .in('student_id', studentIds.length ? studentIds : ['__none__'])
     .order('submitted_at', { ascending: false });
   ```
   **Columns keyed by `quiz_id` (RESOLVED).** Label = `quizzes.title` (`0003_lessons_quizzes.sql:29`; the seed sets it), with a `"Check {date}"` fallback when `title` is null. Build `quizzes: GradebookQuizCol[]` (most-recent N, a separate cap from assignments) and `quiz_cells[student_id][quiz_id]` = that student's **latest** attempt for that quiz (the `submitted_at` desc order makes the first row seen per `(student, quiz)` the latest). Keying columns by `quiz_id` — **not** `quiz_attempt_id` — makes a real student×quiz grid (each column has a cell for every student who took that quiz). *(Review fix: the previous `quiz_attempt_id` key gave exactly one populated cell per column.)*

5. **Footers** — compute `column_averages`, `class_average`, `missing_count` in JS over the assembled cells per §3.3–§3.4 (assignment cells only; quizzes excluded from every average).

**Performance:** roster (1 query) + assignments (1) + attempts (1 batched `.in`) + quizzes (1) + quiz_attempts (1 batched `.in`) = **5 queries, no N+1**. (Better than `loadRosterSignals`' per-student Promise.all; the gradebook does not need per-student misconception fan-out.)

---

## 5. Page — `(teacher)/gradebook/page.tsx` (replaces the stub)

Replaces the current 10-line stub (`gradebook/page.tsx:1-11`, which only renders an `<h1>` + `<EmptyState>`). **Mirrors the verified Today/Roster pattern exactly** (`roster/page.tsx:70-96`).

```ts
import React from 'react';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/requireRole';
import { firstClassIdForTeacher } from '@/lib/teacher/firstClassIdForTeacher';
import { guardClassAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadGradebook } from '@/lib/gradebook/loadGradebook';
import { EmptyState } from '@/components/core/EmptyState';
import { PageHeader } from '../_components/PageHeader';
import { GradebookGrid } from './_components/GradebookGrid';
import { DiagnosticChecksSection } from './_components/DiagnosticChecksSection';

const NO_CLASSES = (
  <EmptyState variant="just-getting-started" titleOverride="No classes yet"
    bodyOverride="Once a class is set up for you, your gradebook appears here." />
);
const CLASS_UNAVAILABLE = (
  <EmptyState variant="just-getting-started" titleOverride="That class isn't available"
    bodyOverride="Use the class selector to pick one of your classes." />
);

export default async function GradebookPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string }>;
}): Promise<React.JSX.Element> {
  // 1. Resolve classId — default to the teacher's first class when absent.
  const { class: classId } = await searchParams;
  if (!classId) {
    const { userId } = await requireRole(['teacher']);
    const firstId = await firstClassIdForTeacher(userId);
    if (!firstId) return <div className="p-6">{NO_CLASSES}</div>;
    redirect(`/gradebook?class=${firstId}`);
  }

  // 2. IDOR guard — teacher must own the class
  const guard = await guardClassAccess(classId);
  if (guard) return <div className="p-6">{CLASS_UNAVAILABLE}</div>;

  // 3. Load via admin client (RLS-bypassed; guard above is the backstop)
  const admin = createAdminSupabaseClient();
  const { userId } = await requireRole(['teacher']); // also the layout gate; gives teacherId
  const data = await loadGradebook(admin, { classId, teacherId: userId });

  // 4. Cold-start
  if (data.students.length === 0) {
    return (
      <div className="p-5 flex flex-col gap-5">
        <PageHeader title="Gradebook" kicker="Where the class stands" accent="brand" />
        <EmptyState variant="just-getting-started" />
      </div>
    );
  }

  return (
    <div className="p-5 flex flex-col gap-5">
      <PageHeader title="Gradebook" kicker="Where the class stands" accent="brand" />
      <GradebookGrid data={data} classId={classId} />
      <DiagnosticChecksSection data={data} />
    </div>
  );
}
```

**Auth chain notes (binding):** the `(teacher)` layout (`layout.tsx:9-16`) already enforces `requireRole(['teacher'])` before any page renders, so the page-level `requireRole(['teacher'])` is the redundant-safety + `userId`-source pattern (same as Today/Roster). `teacherId` is **non-load-bearing** in the loader (it scopes by `classId` + the resolved roster `studentIds`; `guardClassAccess` is the IDOR backstop) — the extra `requireRole` call is an **accepted minor cost** matching the Today/Roster `userId`-sourcing convention; do not "optimize" it away. `guardClassAccess` is the **only** IDOR backstop (the admin client bypasses RLS — RLS is **not** the backstop, per `guards.ts:1-5`). Do **not** re-apply `pop-canvas` to the page root — `TeacherShell`'s `<main>` already carries it (`TeacherShell.tsx:52`). Standardize on `PageHeader` (the stub hand-rolls a plain `<h1>` — replace it).

---

## 6. Grid component — `GradebookGrid`

**New file:** `src/app/(teacher)/gradebook/_components/GradebookGrid.tsx` (client component — owns drill-in open state + override/reteach submit).

### 6.1 Structure
- **Rows = students** (label = `display_name ?? full_name`, deep-ink `text-fg`).
- **Columns = assignments**, most-recent **N**, newest→oldest, **horizontally scrollable**.
  - **N default = 8** visible columns is the design default; the loader returns up to **12** so horizontal scroll always has room (see §11 — N is an open tuning value, 8 is the recommendation). All returned columns scroll; no client truncation beyond what the loader returns.
- **Sticky first column** (student names): `sticky left-0 z-10 bg-surface` so names stay pinned while assignment columns scroll. The horizontal scroll lives on a wrapper `div` with `overflow-x-auto`.
- **Class-average footer row** spanning the assignment columns only (per-column `column_averages`), plus an overall `class_average`. The footer row is visually distinct (e.g. `bg-brand-surface`, sticker top-border) and labeled "Class average" (teacher-safe; raw % allowed at this render site).
- **Missing-work summary line** rendered as a `SummaryCallout` (or a deep-ink sentence) above the grid (§3.4 / §9).

### 6.2 Cell rendering — glyph + grade, never color alone (WCAG-AA)
Each cell shows **both** a status glyph **and** (for graded) the number — color is never the sole signal:

| Status | Glyph | Cell content | Tone wash |
|---|---|---|---|
| `graded` | ✓ | `{displayed_grade}%` (+ a small ⤺/override marker when `is_override`) | `bg-ok-surface` |
| `submitted` | ⋯ | "in" (turned in, not graded yet) — no grade | `bg-brand-surface` |
| `not_due` | · | "—" small muted | `bg-surface` |
| `missing` | (text) "miss" | "miss" label | `bg-risk-surface` |
| `redo` | ⟳ | "redo" + last grade if any | `bg-warn-surface` |
| `redo_in_progress` | ⟳ | last grade shown muted + "redo open" | `bg-warn-surface` |
| `none` | — | em dash | `bg-surface` (muted) |

- The glyph has an accessible label: each cell is a `<button>` with `aria-label` describing student + assignment + status + grade in **leak-guarded prose** (e.g. "Maria — Fractions worksheet — graded, 88 percent"). The visible `%` digit is fine (teacher-only); the `aria-label` is allowed digits too since this is the teacher surface, but phrasing avoids banned words (no "score"/"flag").
- Late-but-graded cells add a small "late" text badge (from `submitted_on_time === false`) — text, not color-only.
- **Token-only styling, Pop-Art chrome:** cells use the established row shape borrowed from `RosterTriageCard`/`SkillMapMatrix`: `border-2 border-sidebar-edge` separators, `shadow-sticker` on the grid container, `rounded-lg`, `font-display` for the header sticker labels via `SectionLabel`. Tone washes use the validated `*-surface` tokens only — **no hardcoded hex, no arbitrary `[var(--..)]`**. Content text is `text-fg` (deep-ink); muted only for secondary glyphs.
- **Header cells** (assignment titles) render as tilted sticker chips (reuse `SectionLabel` tone='brand'); a small due-date caption beneath in `text-fg-muted`.
- Each graded/redo/missing cell is clickable (opens drill-in §8). `not_due`/`none` cells are non-interactive (`not_due` may still open a read-only drill-in showing "not submitted yet"; `none` is inert).

---

## 7. Diagnostic quiz section — `DiagnosticChecksSection`

**New file:** `src/app/(teacher)/gradebook/_components/DiagnosticChecksSection.tsx`.

- Rendered as a **separate, clearly-labeled block below the grid**, visually distinct from the graded grid so a teacher can never confuse a diagnostic with graded coursework.
- **Label:** a `SectionLabel` reading **"Diagnostic checks — not graded"** (tone differs from the graded grid — e.g. `tone='lime'` or `tone='ok'` to read as a different "kind") plus a one-line deep-ink caption (§9).
- **Visual separation (binding):** a full-width divider + a different surface tone for the whole section container, and the words "not graded" in the header. The quiz grid uses a *different* column-header chip color than the assignment grid so the two read as different sections at a glance. **The two tone vocabularies differ — do not mix them:** `Card` `tone ∈ {surface, brand, ok, warn, risk}` (`Card.tsx:28-34`); `SectionLabel` `tone ∈ {brand, ok, warn, risk, lime}` (`SectionLabel.tsx:8`). Use `Card tone='surface'` (or `'ok'`) for the section wrapper + `SectionLabel tone='lime'` for the label so the section reads as a different "kind". All validated tokens — **no hardcoded hex, no arbitrary `[var(--..)]`** (passing `tone='lime'` to `Card` is a bug — Card has no `lime`).
- **NOT in any average.** Quiz cells display `score_pct` and `mastery_band` (teacher-only) but are excluded from `class_average`/`column_averages`.
- **Read-only.** Quiz cells are **not** clickable into an override; an optional read-only drill-in may show the diagnostic detail (band label + completion), but there is **no grade override and no reteach toggle** on quiz cells (diagnostics are coached, not graded).
- **The raw `mastery_band` enum (`reteach`/`grade_level`/`advanced`) is NEVER rendered directly** — it is always passed to the teacher-only `MasteryLabel`/`RiskBadge` (both take a `band` prop, `v2-current-state.md:206-207`), which emit the humanized colored label. (Four-audience: the band enum is teacher-only AND never shown verbatim.) Raw `score_pct` digits are allowed at this teacher render site; surrounding prose stays leak-guarded.

---

## 8. Drill-in — `GradebookDrillIn` + override route

### 8.1 Drill-in panel
**New file:** `src/app/(teacher)/gradebook/_components/GradebookDrillIn.tsx` (client). Opens on assignment-cell click (a side panel / modal — design choice: a right-side panel within the page, no route change; all data already in `Gradebook` props, no extra fetch needed for read).

Shows, for the clicked `(student, assignment)` attempt:
- **Header:** student name + assignment title.
- **Grade:** `displayed_grade` with a clear "AI grade: {score_pct}% · Your grade: {teacher_score}%" breakdown when an override exists (teacher-only; digits OK at render site).
- **Status** (graded / not submitted / redo open / missing).
- **Effort label** — **FLAG (load-bearing):** the stored `homework_attempts.effort_label` uses the values `effortful_success | struggling_trying | independent_success | independent_struggle` (`computeEffortLabel.ts:16-20`), but the teacher copy helper `effortPhrase.ts:8` keys on a **different** enum `'low' | 'medium' | 'high' | 'inconsistent'` — so `effortPhrase(stored_label)` **always falls through to its fallback** ("Effort information is not yet available."). **Decision for 3a:** do **NOT** reuse `effortPhrase()` as-is. Add a small new teacher-safe mapping `effortLabelPhrase()` keyed on the **real four** enum values (new file `src/lib/copy/effortLabelPhrase.ts`, pure). It imports the enum from the verified path **`import { computeEffortLabel, type EffortLabel, EFFORT_LABELS } from '@/lib/signals/computeEffortLabel'`** (the classifier lives at `src/lib/signals/computeEffortLabel.ts` — NOT under `src/lib/engine/`; keying on `EFFORT_LABELS` keeps it enum-locked). The four draft phrases are number-free, so the helper runs each output through **BOTH `assertNoLeak()` AND `assertNoBannedWord()`** (defense-in-depth matching the §10 test, which asserts both `hasLeak===false` and `hasBannedWord===false`). Draft copy goes to STRINGS-FOR-BARB.md (§9). When `effort_label` is NULL, recompute live via `computeEffortLabel({ score: teacher_score ?? score_pct, teliHintCount })` (the one authoritative classifier).
- **Submitted date** (`submitted_at`) + late/on-time (`submitted_on_time`).
- **Override control** (assignments only): a numeric input (0–100) writing `teacher_score` + an optional reason textarea writing `teacher_notes`. A "Clear override" action sets `teacher_score = null`.
- **Reteach toggle** (assignments only): a switch writing `allow_redo` (true = student gets a redo). Label e.g. "Open this for another try."
- **Quiz drill-in:** read-only (no override, no reteach) — diagnostics are coached.

### 8.2 Write path — **POST route** (chosen over a server action)

**Choice & justification.** A **route handler** (`POST`), not a server action. Rationale: (a) it lets the gradebook reuse the *verified* class-scoped auth-chain call-site pattern (`auth.getUser()` → `STAFF_ROLES` → `guardClassAccess` → admin), exactly like `roster-signals/route.ts:45-52`; (b) the existing override-adjacent write precedent is a route (`homework-submit/route.ts`); (c) it keeps the IDOR guard + 4xx contract explicit and unit-testable in isolation. Server actions would bury the auth chain and are harder to test against the IDOR matrix.

**New file:** `src/app/api/teacher/gradebook/override/route.ts`.

**Request:**
```ts
POST /api/teacher/gradebook/override
{
  attempt_id: string;            // homework_attempts.id
  teacher_score?: number | null; // 0–100, or null to clear override (optional)
  teacher_notes?: string | null; // override reason (optional)
  allow_redo?: boolean;          // reteach toggle (optional)
}
```
At least one of `teacher_score`/`allow_redo`/`teacher_notes` must be present.

**Auth chain (binding — server cannot trust the client):**
```ts
const supabase = await createServerSupabaseClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

// STAFF_ROLES gate — import the CANONICAL export, do NOT redeclare a local Set
import { STAFF_ROLES } from '@/lib/auth/roles';
// look up users.role; reject if not in STAFF_ROLES → 403

const admin = createAdminSupabaseClient();
// 1. load the attempt → resolve its assignment.class_id
const { data: attempt } = await admin.from('homework_attempts')
  .select('id, assignment_id, student_id, status, score_pct, teacher_score')
  .eq('id', body.attempt_id).maybeSingle();
if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
const { data: asg } = await admin.from('assignments')
  .select('class_id').eq('id', attempt.assignment_id).maybeSingle();
if (!asg) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });

// 2. IDOR — caller must have class access for the attempt's class
const guard = await guardClassAccess(asg.class_id);
if (guard) return guard;   // 401/403 NextResponse
```

**Authority (clarification, not a defect).** `guardClassAccess` (`guards.ts:68-78`) admits the **owning teacher** AND a **same-school `school_admin`/`sysadmin`**, and a `platform_admin` to all. So a same-school admin can override grades in a class they don't personally teach — this is **intended** and consistent with the existing guard contract (admins correct grades). Throughout this spec read "teacher-owns-class" as **"class access (owning teacher or same-school admin)"**. If 3a ever needs owner-only override, add an explicit `cls.teacher_id === caller.id` check beyond `guardClassAccess` — **not** required for the pilot.

**Validation:**
- `teacher_score` (when present and not null): finite number, `0 ≤ x ≤ 100` → else `400 { error: 'invalid_score' }`.
- `teacher_notes` (when present): `string | null`, max **2000 chars** → else `400 { error: 'invalid_notes' }` (bound the verbatim write to the text column).
- **409 `not_graded` is scoped to GRADE overrides only:** it applies **only** when `teacher_score` is present **and not null** and `status !== 'graded'`. A `teacher_notes`-only or `allow_redo`-only request is **permitted on any owned attempt** (does NOT 409) — a teacher can leave a note or open a redo on a not-yet-graded attempt.

**Write (graded-integrity, §3.2):**
```ts
const patch: Record<string, unknown> = {};
if ('teacher_score' in body) patch.teacher_score = body.teacher_score; // number | null
if ('teacher_notes' in body) patch.teacher_notes = body.teacher_notes;
if ('allow_redo' in body)    patch.allow_redo    = body.allow_redo;
// NEVER touch score_pct; NEVER change status
await admin.from('homework_attempts').update(patch).eq('id', attempt.id);

after(async () => {
  try { await recomputeSkillStatesForStudent(admin, { studentId: attempt.student_id, schoolId: null }); }
  catch (err) { console.warn('[gradebook-override] recompute failed (non-fatal):', err); }
});
```
(`after` + `recomputeSkillStatesForStudent` mirror `homework-submit/route.ts:135`.)

**Response contract:**
- `200 { ok: true, attempt_id, displayed_grade }` where `displayed_grade = teacher_score ?? score_pct` (recomputed post-write).
- `400` — bad/missing body or `invalid_score`.
- `401` — no user.
- `403` — not STAFF_ROLES, or `guardClassAccess` denies (cross-teacher / wrong-school). 403 not 404 for the class IDOR (don't leak existence), consistent with `guards.ts:74`.
- `404` — attempt or its assignment not found.
- `409` — `not_graded` (grade override attempted on a non-graded attempt).

On `200` the client calls `router.refresh()` (or the route calls `revalidatePath('/gradebook')`) so the grid re-renders with the new `displayed_grade`.

---

## 9. Copy & four-audience discipline

**Surface is TEACHER-ONLY** → raw grades/numbers/`%` are allowed **at their render sites** (cells, footers, drill-in grade breakdown, the diagnostic `score_pct`). But **all surrounding PROSE stays leak-guarded** — no banned words (`leakGuard.ts:38`): `score, percentile, index, divergence, threshold, signal, model, algorithm, flag`. (`risk` is intentionally allowed.) **"Assignments" never "Homework"** in any UI copy.

**Two distinct guards — apply the right one (binding).** `leakGuard.ts` exposes `assertNoLeak`/`hasLeak` (rejects **digits/%/ordinals**) AND `assertNoBannedWord`/`hasBannedWord` (rejects the **banned-word list**). They are not interchangeable:
- **Count-bearing teacher prose** — the missing-work summary (#4), the "Class average" label, the date-derived column headers (§4.3 step 2), the drill-in grade breakdown — is checked with **`hasBannedWord`/`assertNoBannedWord` ONLY**. `assertNoLeak` would throw on the digit/date. (Matches the existing roster `buildSummary`, which does not run through `assertNoLeak`.)
- **Genuinely number-free prose** — the effort phrases (#8), the diagnostic caption (#5), empty-state copy — runs through **both** `assertNoLeak` and `assertNoBannedWord`.

**User-facing strings to draft → all go to `STRINGS-FOR-BARB.md` (drafts; Barb gates):**
1. Page header / kicker: title "Gradebook"; kicker "Where the class stands".
2. Empty/cold-start: "No classes yet" / "Once a class is set up for you, your gradebook appears here." + the existing `EmptyState` `just-getting-started` copy.
3. Class-average footer label: "Class average" (assignments only).
4. Missing-work summary line, singular/plural aware, e.g. — "Everything's turned in — nothing outstanding." / "1 assignment is still outstanding." / "{n} assignments are still outstanding." (no banned words; "assignments" not "homework").
5. Diagnostic section label + caption: "Diagnostic checks — not graded" + caption e.g. "These checks help you see where students are — they don't count toward grades."
6. Cell status microcopy: "graded", "not due yet", "missing", "redo open", "late", "not submitted yet".
7. Drill-in labels: "Your grade", "AI grade", "Open this for another try." (reteach toggle), "Add a note" (teacher_notes), "Clear override".
8. **NEW** effort phrases (`effortLabelPhrase()`) keyed on the real four enum values — coach-posture, leak-guarded:
   - `effortful_success`: "Worked hard and got there."
   - `struggling_trying`: "Putting in real effort while wrestling with this."
   - `independent_success`: "Handled this comfortably on their own."
   - `independent_struggle`: "Struggled here without reaching for help yet."
   (Drafts only — Barb gates; these are number-free, so every string runs through **both** `assertNoLeak` and `assertNoBannedWord`.)

---

## 10. Testing approach (TDD)

Vitest 4.x. **Non-component tests** default to the `node` env (no header). **Component tests** must start with `// @vitest-environment jsdom` then `import '@/test/setup-dom';` (the established pattern). Run a single file with `npx vitest run <path>`.

### 10.1 Loader — `src/lib/gradebook/loadGradebook.test.ts` (node env)
- **Matrix shape:** given enrollments + assignments + attempts fixtures, returns the expected `students × assignments` cells with correct `CellStatus` per cell — covering **all seven**: `graded / submitted / not_due / missing / redo / redo_in_progress / none`.
- **Logical-column key:** two students' per-student assignment rows that share a `lesson_id` collapse into ONE column; rows with null `lesson_id` but the same `due_at` collapse by `due:`; a null-`lesson_id`+null-`due_at` row gets its own `id:` column (no spurious merge).
- **`submitted` (turned in, not graded):** a `status='submitted'` attempt with `score_pct=null` → cell status `submitted`, `displayed_grade=null`, and is **excluded** from the column/class average (not zero-filled, not `missing`). *(Seed fixture: A2/marcus.)*
- **`redo_in_progress`:** fixture with a graded `attempt_no=1` + a newer in_progress `attempt_no=2` → status `redo_in_progress` with `displayed_grade` = the **prior graded grade** (the earned grade is NOT lost while the redo is open).
- **Override-wins:** a cell with `teacher_score=90, score_pct=70` returns `displayed_grade=90, is_override=true`; with `teacher_score=null` returns `score_pct`.
- **Quiz grid keyed by `quiz_id`:** two students who took the same quiz both appear in that quiz's column (`quiz_cells[s1][quizId]` and `quiz_cells[s2][quizId]` both populated) — proves columns key on `quiz_id`, not `quiz_attempt_id`.
- **Average excludes quizzes:** `class_average`/`column_averages` count graded assignment cells only; a class with quizzes but no graded assignments returns `class_average=null` (renders `—`).
- **Average excludes non-graded cells:** missing/not_due/submitted/ungraded cells are not zero-filled into the denominator.
- **Missing-work count:** `missing_count` matches the number of past-due assignments with **no attempt** for the student.
- (Loader does no auth — auth is exercised in the route + page tests below.)

### 10.2 Override route — `src/app/api/teacher/gradebook/override/route.test.ts` (node env)
- **Auth:** no user → 401; non-STAFF role → 403.
- **IDOR:** a teacher overriding an attempt in a class they do **not** own → 403 (cross-teacher rejected via `guardClassAccess`); attempt/assignment not found → 404.
- **Graded semantics:** override writes `teacher_score` (+ `teacher_notes`) and **does NOT** mutate `score_pct` or `status`; clearing sets `teacher_score=null`; reteach writes `allow_redo`.
- **Validation:** `teacher_score` out of `[0,100]` → 400 `invalid_score`; override on a non-graded attempt → 409 `not_graded`; empty body → 400.
- **Recompute hook** scheduled on success (assert `recomputeSkillStatesForStudent` invoked / `after` registered).
- **200 contract:** returns `displayed_grade = teacher_score ?? score_pct`.

### 10.3 Components (jsdom env)
- `GradebookGrid.test.tsx`: renders a glyph **and** grade per cell (asserts ✓+`%`, ⋯/"in" for `submitted`, `miss`, ⟳ for `redo` and `redo_in_progress` (the latter keeps the prior grade visible), ·, — for each status); WCAG cue is not color-only (each cell has an `aria-label`); class-average footer renders over assignment columns and **omits quizzes**; sticky-first-column class present. The **missing-work summary** string passes `hasBannedWord === false` (it is count-bearing, so it is NOT asserted against `hasLeak` — the digit is allowed on this teacher surface).
- `DiagnosticChecksSection.test.tsx`: renders the "Diagnostic checks — not graded" label; quiz cells are **not** clickable into an override (no override controls present); quiz values are absent from the average footer.
- `GradebookDrillIn.test.tsx`: shows the AI-vs-teacher grade breakdown when an override exists; renders the correct `effortLabelPhrase()` for each of the four real enum values (regression guard against the `effortPhrase` mismatch FLAG); quiz drill-in shows no override/reteach controls.
- **Copy guard test** (`src/lib/copy/effortLabelPhrase.test.ts`, node): every `effortLabelPhrase()` output passes `hasLeak === false` and `hasBannedWord === false`.

---

## 11. Open questions / risks

1. **FLAG — `teacher_override_reason` missing on `homework_attempts`** (resolved): the column is on `assignments` only (`0004:16`); 3a stores the per-attempt reason in the existing `teacher_notes` (no migration). Smallest migration *if ever needed*: `ALTER TABLE public.homework_attempts ADD COLUMN IF NOT EXISTS teacher_override_reason text;` — **not recommended** for 3a.
2. **FLAG — `effortPhrase()` enum mismatch** (resolved by design): `effortPhrase.ts` keys on `'low'|'medium'|'high'|'inconsistent'`, which never matches the stored `effortful_success|…` values. 3a adds a new `effortLabelPhrase()` keyed on the real four values rather than reusing `effortPhrase`. (Consider, as a follow-up cleanup outside 3a, reconciling `effortPhrase` itself.)
3. **RESOLVED — assignment per-student fan-out → logical column key.** `assignments` rows are per-`(student_id, class_id)` (the seed inserts one per student, deduped on `(student_id, class_id, due_at)` — `seedDemo.ts:455`). Grouping key = `lesson:<lesson_id>` when non-null, else `due:<due_at>`, else `id:<assignment.id>` (§4.3 step 2). `content.title` / `assignment_group_id` / `template_id` are **all absent** (§3.1), so the column header is date-derived ("Due {Mon D}" / "Assignment {n}"). **Residual real-data risk:** two distinct assignments with null `lesson_id` due the **same day** would collapse into one column — a future `assignments.assignment_group_id uuid` migration would fully resolve it; **not needed for the pilot seed** (distinct due dates, and `lesson_id` distinguishes when set).
4. **RESOLVED — `quizzes` label field.** `quizzes.title text` exists (`0003_lessons_quizzes.sql:29`; the seed sets `title: 'Demo Quiz'`). Diagnostic column label = `quizzes.title`, with a `"Check {date}"` fallback when null (§4.3 step 4).
5. **OPEN — N (visible assignment columns) default.** Recommendation: **N=8** visible, loader returns up to **12** for scroll headroom. Tuning value; confirm with Barb/Marvin against a real seeded class width.
6. **RISK — due-date "next class" representation.** `classes.period` is **text-only**; there is **no** structured meeting-days/schedule model ([[v2-assignment-due-dates]]). The gradebook only *reads* `assignments.due_at` and shows late/on-time — it does **not** compute "next class", so this risk does not block 3a, but the missing schedule model remains an upstream gap for assignment authoring (out of scope here).
7. **RISK — RLS has no teacher UPDATE policy on `homework_attempts`.** Confirmed: only a SELECT policy exists (`0004:52-57`); teachers cannot write `teacher_score` under RLS. The override route therefore **must** go through `createAdminSupabaseClient()` (service_role, bypasses RLS) with the explicit `guardClassAccess` IDOR guard as the **only** backstop. This is by design (matches CLAUDE.md auth chain) — flagged so implementers do not "fix" it by adding an RLS policy.
8. **MINOR — local `STAFF_ROLES` redeclarations.** Two existing teacher routes redeclare a local `STAFF_ROLES` Set instead of importing the canonical `@/lib/auth/roles` export. The new gradebook + override code **must import the canonical export** (do not copy the local-Set anti-pattern).

---

## Build order (for `writing-plans` → SDD)
1. `loadGradebook` loader + tests (node).
2. Override `POST` route + tests (node) — auth/IDOR/graded-integrity.
3. `effortLabelPhrase()` copy helper + leak-guard test (node).
4. `GradebookGrid`, `DiagnosticChecksSection`, `GradebookDrillIn` components + tests (jsdom).
5. `(teacher)/gradebook/page.tsx` replacing the stub (wire it all together).
6. Review before merge — the **full cadence**: per-task committee review during SDD + a whole-branch adversarial **committee** review + **`/code-review`** + **codex cross-model review** (codex can hang — run it but don't block on it). Gates: vitest / tsc / a11y / build. Then the **`/frontend-design-audit`** usability gate on the built grid + drill-in (the pre-merge gate agreed for Epic 3a — see [[v2-epic3-teacher-screens]]). Surface all copy drafts to `STRINGS-FOR-BARB.md` for Barb to gate before/at merge.
