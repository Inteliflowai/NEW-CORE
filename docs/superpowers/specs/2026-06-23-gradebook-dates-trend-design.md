# Gradebook Dates + Trend — Design Spec

**Date:** 2026-06-23
**Status:** Draft → awaiting Marvin sign-off → `writing-plans` → SDD
**Epic:** Gradebook v1.1 (fast-follow on Epic 3a full gradebook). Relates to
[[v2-gradebook-dates-and-trend]], [[v2-epic3-teacher-screens]], [[v2-assignment-due-dates]].

> **Coach posture + four-audience:** this is a **teacher-only** surface. Earned
> assignment grades MAY render here (assignments are graded coursework —
> [[v2-assignments-graded-quizzes-coached]]); surrounding prose stays
> banned-word-free (`hasBannedWord`, not `hasLeak`) and never leaks the
> mastery band enum / risk number / diagnostic machinery. Coach voice:
> observation over metric-dump, one thing at a time. All user-facing strings
> are DRAFTS → `STRINGS-FOR-BARB.md §Gradebook`; Barb gates copy.

---

## 1. Problem

The shipped gradebook (Epic 3a) keys assignment columns by `lesson_id`
(`colKey = lesson_id ?? due_at ?? id`). Daily assignments built from the **same
lesson** all share one `lesson_id`, so a lesson assigned across five days
collapses into **one column** showing only the latest date + latest attempt.
Marvin wants to compare grades **day over day** per student, wants the three
dates he named — **assigned, due, submitted** — to be first-class, wants a
**per-student grade trend**, and Barb wants a **grade-cell hover tooltip**.

## 2. Decisions (Marvin, 2026-06-23 — AskUserQuestion)

| # | Decision | Choice |
|---|----------|--------|
| D1 | How to get per-day columns | **Add a real `assigned_date`** — migration 0018, stamped at generation. (Not the no-migration "group by creation day" shortcut.) |
| D2 | Where the per-student grade trend lives | **Both** — a compact sparkline in the grade-cell drill-in **and** a fuller trend on the One-Student profile page. |
| D3 | How much the grid shows by default | **Recent window** — default ~10–12 most-recent dated columns; older behind a "Show earlier" expand. Restraint over volume. |

## 3. Grounding facts (verbatim, from the 2026-06-23 grounding sweep)

**V1 (parity reference, `C:/users/inteliflow/core`):**
- Gradebook columns are **one per calendar day** (`buildMatrix.ts`), sorted
  chronologically, school-days only. It buckets by `anchor_iso = due_at ?? created_at`
  but **only displays `due_at`** (never surfaces `created_at` as a date).
- When multiple assignments fall on one date, V1 surfaces **only the first** in
  the cell — a known V1 limitation we will **improve on** (see §4.2).
- **Per-student trend is NOT in the gradebook** — it lives on a separate
  `StudentTrajectoryTab` (profile page): SVG sparklines (480×60, hover→value+date),
  `climbing/steady/sliding` direction, time-windowed (7/30/60/90/180d, default 90).
- **Cell hover tooltip** already shows: assignment title, status + grade,
  "Due: [date]", "Completed: [date] (on time|late)", effort label.

**V2 today (`C:/users/inteliflow/NEW-CORE`):**
- `loadGradebook.ts` collapses by `lesson_id`; fetches assignments
  `select('id, lesson_id, due_at, created_at, student_id')`; column title =
  `dueLabel(due_at, ordinal)` → `"Due Jun 14"` / `"Assignment N"`. `due_at`
  exists on the column but is **not shown** in the header.
- `GradebookGrid.tsx` (`'use client'`): sticky-header table; grade cells are
  `<button>` for interactive statuses; **no hover tooltip today** (one `title`
  on the override glyph only). `GradebookCell.submitted_at` is **already
  populated** for every cell.
- `GradebookDrillIn.tsx` (`'use client'`): right-side panel; sections =
  header (student / assignment / submitted date) → status line → grade
  breakdown (AI vs override) → effort line → write controls. A trend slots
  **after grade breakdown, before effort line**.
- `GrowthMotif` (`src/components/core/GrowthMotif.tsx`): the only existing viz —
  CSS stepped bars, ≥4 points, cold-start <4, never peer-relative. **No
  charting library installed.** Used for the "Growing" card on the One-Student
  page, fed by `growth_history` (weekly snapshot `avg_score`, NOT per-assignment).
- **Data model:** assignments has `created_at` (DB-default `now()`), `due_at`
  (nullable, **not set during generation in prod** — only in seed). **No
  `assigned_at`.** Generation route (`api/teacher/assignments/generate/route.ts`)
  inserts **one assignment per student per quiz_attempt** (1:1); the only tie
  across the class fan-out is `lesson_id`. `homework_attempts` has
  `submitted_at`, `graded_at` (populated when `status='graded'`), `score_pct`
  (AI), `teacher_score` (override). **Latest migration = 0017; next = 0018.**
- **Trend data:** the clean source for a per-student assignment-grade trend is
  `homework_attempts` directly — filter `(student_id, status='graded')`, order
  `graded_at` asc, value `teacher_score ?? score_pct`. Do **not** reuse
  `growth_history` (weekly snapshots, wrong granularity).
- **Leak guard:** `BANNED_WORDS` includes `score, percentile, index, divergence,
  threshold, signal, model, algorithm, flag`; `"risk"` is intentionally NOT
  banned. Teacher surfaces may show raw grade digits; prose stays banned-free.

## 4. Design

### 4.1 `assigned_at` — the new date (D1)

**Migration `0018_assignment_assigned_at.sql`:**
```sql
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
-- Backfill existing rows to a sensible assigned day (their creation day),
-- so historical columns split correctly. (NO column-level DEFAULT — a default
-- of now() would stamp every existing row with the migration-run instant and
-- collapse all history into one column.)
UPDATE public.assignments SET assigned_at = created_at WHERE assigned_at IS NULL;
```
- No RLS change (assignments RLS unchanged; service-role writes via admin client).
- `assigned_at` is set **once at generation** and never changes — independent of
  `due_at` (which may be overridden per student — [[v2-assignment-due-dates]]).

**Generation route** (`api/teacher/assignments/generate/route.ts`): add
`assigned_at: new Date().toISOString()` to the insert payload. The route is
called once per student, so per-student copies of the same day's batch get
timestamps within seconds of each other — the **column key date-truncates**
(§4.2), so same-day copies still land in one column. (A shared exact timestamp
is unnecessary; we never compare `assigned_at` for equality, only its UTC date.)

**Seed** (`seedTrialDemoData.ts` / `buildSeedRows.ts`): set `assigned_at` on
seeded assignments, spread across multiple days for at least one lesson, so the
demo visibly shows **multiple per-day columns for one lesson** (proves the feature).

### 4.2 Per-day column keying (D1) — improving on V1

New column identity = **(logical assignment) = same lesson, same assigned day**:
```
assignedDate(a) = utcDateString(a.assigned_at ?? a.created_at)   // 'YYYY-MM-DD'
colKey(a) = a.lesson_id ? `lesson:${a.lesson_id}:${assignedDate(a)}`
                        : `id:${a.id}`                            // no-lesson → standalone
```
- **Splits** same-lesson-different-day into separate columns ✅ (the fix).
- **Keeps** different-lesson-same-day as **separate** columns ✅ — *better than
  V1*, which merges them and shows only the first. No silent loss.
- **Keeps** the per-student fan-out (same lesson, same day, N students) as **one
  column** ✅ ([[v2-gradebook-dates-and-trend]] point 4).
- **Ordering:** chronological by `assignedDate` (oldest→newest, left→right) so a
  row reads as a timeline and matches the sparkline direction (§4.4).
- Column meta gains `assigned_at` (the column's assigned day) and `lesson_title`.

**Lesson title for header + tooltip:** `loadGradebook` currently has no human
name for a column. Add a batched fetch of `lessons(id, title)` for the column
`lesson_id` set (6th query, keyed-in, no N+1) → `GradebookAssignmentCol.title`
becomes the lesson title; assigned/due dates move to a header subline.
Fallback when no lesson title: keep `dueLabel` behavior.

### 4.3 Recent-window grid + "Show earlier" (D3)

- `loadGradebook` builds **all** dated columns (cap the fetch at a safe upper
  bound, e.g. 60, with a `log`-style note if truncated — no silent cap) and
  returns them chronologically, plus a `default_visible_count` (≈12).
- `GradebookGrid` renders the **most-recent `default_visible_count`** columns by
  default; a **"Show earlier" control** reveals older columns (prepended to the
  left). Class-average + column-averages still computed over all assignment
  columns (unchanged semantics), independent of what's visible.
- Horizontal scroll container + sticky student-name column unchanged.
- *(Exact control placement / scroll direction previewed via Playwright per the
  binding frontend-review workflow before merge — [[v2-frontend-review-workflow]].)*

### 4.4 Per-student grade trend (D2 — both sites)

**Data loader** `loadStudentGradeTrend(admin, { studentId, classId })` (new, in
`src/lib/gradebook/`):
- Query `homework_attempts` joined to `assignments` (this class), filter
  `student_id`, `status='graded'`, order `graded_at` asc.
- Each point: `{ date: graded_at, grade: teacher_score ?? score_pct,
  assignment_title, on_time }`. Returns `{ points[], direction, latest, average }`
  where `direction ∈ 'climbing'|'steady'|'sliding'` (first-third vs last-third
  mean, like V1; higher grade = climbing — confirm direction semantics, NOT the
  `lowerIsBetter` risk default).
- Earned grades only; no band/risk; prose banned-free.

**Shared component** `GradeTrendSparkline` (new, `src/components/core/`,
`'use client'`):
- A small **dated SVG line sparkline**, token-colored (`--brand`/`--brand-accent`),
  hover → `grade + date` (V1 affordance). Cold-start (<3 points) → calm
  "Not enough yet to show a trend" (Barb copy), matching the GrowthMotif
  cold-start pattern. `prefers-reduced-motion` respected (no draw animation).
- Used in **both** render sites for consistency (DRY). `GrowthMotif` stays as-is
  for the whole-child "Growing" snapshot card (different data, different purpose).

**Site A — drill-in** (`GradebookDrillIn.tsx`): compact `GradeTrendSparkline`
inserted **after grade breakdown, before effort line**, with a one-line
plain-language direction note ("Climbing over the last few" — Barb). Scope =
the clicked student's graded assignments in this class.

**Site B — One-Student profile** (`/students/[studentId]`): a fuller
"Grades over time" section (same component, larger) in the academic/grades
context, beside the existing "Growing" card. *Preview to confirm it reads as
distinct from "Growing" and doesn't feel like stat-volume (D3 restraint
applies here too) — [[v2-frontend-review-workflow]].*

### 4.5 Grade-cell hover tooltip (Barb)

- Attach a **styled, token'd tooltip** to each grade cell (`GradebookGrid`),
  fixed-position to avoid clip (V1 pattern). Content: **assignment name**
  (lesson title, §4.2) · status + grade · **Due [date]** (real `due_at` only) ·
  **Submitted [date] (on time | late)** (`submitted_at` + `submitted_on_time`) ·
  effort phrase (graded cells). Empty-state cells: name + due + "Not turned in yet".
- Accessibility unchanged: the existing rich `aria-label` stays the screen-reader
  source; the tooltip is a visual enhancement (not the only path to the info).
- Copy = DRAFT → Barb. Tooltip visual previewed via Playwright before merge.

## 5. Files

| File | Change |
|------|--------|
| `supabase/migrations/0018_assignment_assigned_at.sql` | **NEW** — add `assigned_at` + backfill |
| `src/app/api/teacher/assignments/generate/route.ts` | set `assigned_at` on insert |
| `src/lib/trial/seedTrialDemoData.ts` / `src/lib/demo/buildSeedRows.ts` | seed `assigned_at`, spread one lesson over days |
| `src/lib/gradebook/loadGradebook.ts` | new `colKey` (lesson+assignedDate); fetch `assigned_at` + lesson titles; chronological order; all dated columns + `default_visible_count` |
| `src/lib/gradebook/loadStudentGradeTrend.ts` | **NEW** — per-student dated grade points + direction |
| `src/components/core/GradeTrendSparkline.tsx` | **NEW** — shared dated SVG sparkline (reduced-motion, cold-start) |
| `src/app/(teacher)/gradebook/_components/GradebookGrid.tsx` | chronological windowed columns + "Show earlier"; header name + assigned/due; cell hover tooltip |
| `src/app/(teacher)/gradebook/_components/GradebookDrillIn.tsx` | embed compact sparkline + direction note |
| `src/app/(teacher)/students/[studentId]/...` | embed fuller "Grades over time" trend |
| `STRINGS-FOR-BARB.md` | §Gradebook draft strings (tooltip, trend direction, cold-start, "Show earlier") |
| tests | colKey/keying + window, trend loader + direction, sparkline (cold-start, reduced-motion, hover), tooltip presence + leak-clean, drill-in trend render |

## 6. Out of scope / non-goals

- No charting library — hand-rolled SVG sparkline (token-styled).
- No custom date-range picker (V1's 7/30/60/90/180 presets) — recent-window +
  "Show earlier" is the v1.1 scope; presets deferrable.
- No change to grade-override / reteach / class-average semantics (Epic 3a).
- No class-schedule model (still no "meeting days" — [[v2-assignment-due-dates]]).
- Player Segment 4 (canvas) / 5 (voice) remain deferred.

## 7. Gates (unchanged bar)

`npx tsc --noEmit` 0 · `npm test` green (new tests added) · `npm run build` 0 ·
`npm run a11y` (WCAG-AA) pass · migration 0018 applied live to **NEW CORE only**
(`pmdzxwppdlnddtnkoarc`) with explicit authorization. Whole-branch adversarial
review + Playwright preview of all new visual surfaces before merge.
