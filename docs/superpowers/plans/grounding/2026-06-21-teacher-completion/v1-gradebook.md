# V1 Teacher Gradebook: Ground Truth

## Overview

The V1 teacher gradebook is a dense student × date matrix that displays homework grades and chapter test attempts in a sticky table layout. Teachers see one row per student and one column per school day of the month, plus dedicated columns for chapter tests (Migration 065).

**Key Files (V1 reference repo: C:/users/inteliflow/core)**
- UI: pp/(dashboard)/teacher/gradebook/page.tsx (1031 lines)
- API: pp/api/teacher/gradebook/matrix/route.ts (339 lines)
- Matrix builder: lib/gradebook/buildMatrix.ts (432 lines)
- Drill-in panel: components/teacher/gradebook/CellDrillIn.tsx (668 lines)

---

## UI Screen Layout

### Page Structure

**Header**
- Title: "Gradebook" with info tooltip
- Subtitle: Class name · Month label · Help text
- (Effort + late emoji legend removed 2026-05-05; detail moved to cell drill-in)

**Navigation Bar**
- Previous/Next month buttons
- Month dropdown (16 months: -12 through +3)
- Today button
- Student name search box (filters before render cap)

**Cell Key (above table)**
Permanent legend:
- Green 73 = graded (color: #10b981)
- Brown … = turned in (color: #92400e)
- Red — = missing (color: #ef4444)
- Gray • = not yet due (color: #a8a29e)

**Missing Work Summary**
One sentence naming first students with missing work. E.g., "Ali, Sofia, and 2 others have missing work this month"

**Gradebook Table (sticky grid)**
- Sticky left column: student names + IEP pill
- Sticky top row: dates (school days only, Mon–Fri)
- Column widths: 60px date cells (desktop), 44px (mobile); 110px chapter test cells (desktop), 80px (mobile)
- Row height: 44px
- Max render: 50 students (defensive cap for pilot ~30)

### Date Column Headers
- Day of week (Mon/Tue/...) uppercase 10px
- Day of month (01–31) bold 14px
- Week boundary: 2px left border #c7d2fe when week_label changes
- Today's column: background #eef2ff, text #4338ca, top border 3px #6366f1
- Opacity 0.45 for non-school days

### Chapter Test Column Headers (Migration 065)
- Label: "📚 Snapshot" (9px, uppercase, #86198f)
- Chapter title (11px, centered, overflow ellipsis)
- First column: 3px left border #c7d2fe separating from date band
- Background: #fdf4ff (purple)

### Student Row Headers
- Name: 13px bold #1c1917, ellipsis overflow
- IEP pill (if has_iep): purple background #ede9fe, text "IEP" (9px #5b21b6)
- Hover: background #fafaf9

### Grade Cells

**Background by status**:
- graded: white
- submitted: cream (#fffbeb)
- missing: light red (#fef2f2)
- not_yet_due: light gray (#fafaf9)
- no_assignment: white

**Content glyphs**:
- Graded: large bold numeric (16px 800-weight) in scoreColor(grade)
- Submitted: ellipsis … (14px #92400e bold)
- Missing: dash — (16px #ef4444 bold)
- Not yet due: bullet • (14px #a8a29e bold)

**Interaction**:
- Click cell (if has assignment) → CellDrillIn panel right-side
- Hover: inset box-shadow 2px #c7d2fe
- Hover tooltip (fixed position, dark #1c1917):
  - Assignment title (13.5px bold)
  - Status + grade % (colored)
  - "Due:" date (locale-aware)
  - "Completed:" date + "(on time)" or "(late)"
  - Effort label (if present)

### Chapter Test Cells (Migration 065)

**Statuses**:
- Graded: grade % (16px bold) + denominator (9px)
- Submitted: text "Submitted" (12px #92400e bold)
- In progress: text (12px #4338ca bold), background #eef2ff
- Forfeited: icon "⏰ Time up" or "⏸️ Closed early" (14px #b91c1c bold)
- Not started: dash — (14px #a8a29e)

**Click behavior**:
- Click cell (if not not_started) → `/teacher/chapter-tests/[id]/students/[studentId]`
- Click header → `/teacher/chapter-tests/[id]`

### Summary Footer

Below table:
- Leading sentence (14px bold): "Everyone is caught up" or "{n} students have missing work"
- Class average woven in: "Class average is 78%"
- Info tooltip
- Stats (13px gray): "{n} assignment(s)" · "📚 {n} Learning Snapshot(s)"

### Empty States

- No class: card "No class selected yet"
- No students: emoji 📚 + message + button "Import roster" → /import
- No search matches: "No students match your search"
- Class size >100: HTTP 413 error
- Loading: SkeletonTable "Loading gradebook…"
- Load error: red card with error detail + Retry button

### Mobile (≤767px)

- Name column: 200px → 120px
- Date cell: 60px → 44px
- Chapter test cell: 110px → 80px
- Table scrolls horizontally

---

## Data Flow & API

### Matrix API Endpoint

**GET `/api/teacher/gradebook/matrix`**

Query params:
- `class_id` (required, UUID)
- `month` (required, YYYY-MM)
- `include_archived` (optional bool)

Auth: teacher must own class (role='teacher', classes.teacher_id = user.id).

**Response**:
`
{
  class_id: string;
  class_name: string;
  month: string;
  students: Array<{student_id, full_name, class_period, iep}>;
  dates: DateInfo[];
  cells: MatrixCell[];
  chapter_test_columns: ChapterTestColumn[];
  chapter_test_cells: ChapterTestCell[];
  summary: {
    total_students: number;
    total_assignments: number;
    total_chapter_tests: number;
    class_avg_grade: number | null;
  };
}
`

### Core Queries (parallel)

**1. Enrollments**
`sql
SELECT student_id, is_active, users!inner(id, full_name, has_iep)
FROM enrollments WHERE class_id = 
`
Filtered: excludes is_active=false unless include_archived=true. Sorted by full_name.

**2. Assignments** (in month window)
`sql
SELECT id, student_id, due_at, created_at, content
FROM assignments WHERE class_id =  AND created_at >= $monthStart AND created_at < $monthBoundUpper
`
Anchor each to `due_at ?? created_at`. Title in content.title (jsonb).

**3. Chapters**
`sql
SELECT id, title FROM chapters WHERE class_id =  AND archived_at IS NULL
`

**4. Homework Attempts** (serial after assignments known)
`sql
SELECT id, assignment_id, student_id, status, grade, submitted_on_time, effort_label, submitted_at, graded_at
FROM homework_attempts WHERE assignment_id IN ($assignmentIds)
`

**5. Chapter Tests** (administered, ready only)
`sql
SELECT id, chapter_id, title, total_max, created_at, status, generation_status
FROM chapter_tests
WHERE chapter_id IN ($chapterIds) AND status != 'draft' AND generation_status = 'ready'
  AND created_at >= $monthStart AND created_at < $monthEnd
ORDER BY created_at ASC
`

**6. Chapter Test Attempts** (per-student)
`sql
SELECT id, chapter_test_id, student_id, status, total_grade, forfeit_reason
FROM chapter_test_attempts
WHERE chapter_test_id IN ($chapterTestIds) AND student_id IN ($studentIds)
`

### Cell Status Derivation (buildMatrix.ts)

1. No assignment → `status: 'no_assignment'`
2. Assignment, no attempt:
   - `dueMs < now` → `missing`
   - `dueMs >= now` → `not_yet_due`
3. Attempt, status='graded' + grade:
   - `status: 'graded'`, include grade, late flag, effort_label
4. Attempt, status='submitted':
   - `status: 'submitted'`, include late flag, effort_label
5. Attempt, other (e.g., in_progress):
   - Treat as missing-or-not-yet-due per due date

**Cell fields**:
- student_id, date, status, grade, late, effort_label, assignment_id, homework_attempt_id
- Hover tooltip: assignment_title, due_iso, submitted_at, graded_at, on_time

**Multiple assignments per (student × date)**:
- Only first match surfaces in cell (O(1) via asgByKey map)
- Second still reachable via drill-in panel (4e)

### Chapter Test Cell Status (Migration 065)

1. No attempt → `not_started`
2. Attempt + forfeit_reason → `forfeited` (closure | time_up)
3. Attempt + status='graded' + total_grade:
   - `grade: Math.round((total_grade / total_max) * 100)`
   - Include total_grade, total_max
4. Attempt + status='submitted' → `submitted`
5. Attempt + other → `in_progress`

### Class Average Grade

Across all graded HW + all graded chapter test cells (grade %):
`
Math.round(avg * 10) / 10
`
Null if no graded data.

### Date Generation

**generateMonthDates(month: YYYY-MM)**: one DateInfo per school day (Mon–Fri only).

Fields:
- date: YYYY-MM-DD (UTC)
- day_of_week: "Mon", "Tue", ...
- week_label: "Week of Apr 21" (Monday-anchored)
- is_school_day: true (always; weekends never in output)

No school_calendar table; default: all weekdays = true.

---

## Cell Drill-In Panel

**File**: `components/teacher/gradebook/CellDrillIn.tsx` (668 lines)

Right-side panel on cell click. Keeps gradebook visible.

**Responsibilities**:
- Fetch per-(student × date) homework detail
- Display assignment instructions, reading passage, tasks, SPARK rubric
- Teacher actions: override grade, flag reteach, send hug (/teacher/hugs)
- Call `onMatrixDirty()` after mutations (refetch matrix)

**Deferred**:
- No manual_override field; override writes grade directly
- No AI-vs-teacher side-by-side
- "Send hug" pre-fill not built; navigate manually

---

## Design Constraints (V2 Discipline Binding Points)

### Four-Audience Lock
- **Teacher only** sees: CL verbs, diagnoses, divergence, misconceptions, bands
- **Students/parents** never see: band enum, raw risk
- Gradebook: grades %, status glyphs, effort labels, late flags only

### Coach Posture
- Missing work named by first name only (warmer)
- Footer: interpretation first, numeric average secondary
- No effort emoji on surface (removed 2026-05-05); detail in drill-in
- Summary: "everyone caught up" or names who needs attention

### Leak-Guard at Copy Boundary
- All copy via useTranslations() (i18n, en-US + pt-BR)
- No inline literals for student/parent-facing text

### WCAG-AA
- Color supplementary; icon/text always present (no colorblind fail)
- Aria labels on all interactive cells + headers
- Fixed tooltips use colorScheme: 'light' (guard against OS dark-mode, Critical Bug #20)
- Font-weight differentiates status

### Sticky Table Layout
- CSS Grid + sticky positioning (z-indices: 3, 2, 1)
- No virtual scrolling (50 student cap)
- max-height: 70vh
- Mobile: shrink columns 50%

### Student Search
- Filters before render cap
- Students past 50 reachable by name
- Overflow notice: "Showing 50 of N students. Pagination ships in a follow-up."
- Case-insensitive substring match

### Month Navigator
- 16 month options (-12 past, current, +3 future), newest first
- "Today" button jumps to current month
- Previous/Next shift ±1

### Performance
- Class size cap: 100 (413 if exceeded)
- Pilot ~30, cap defensive
- Queries: enrollments + assignments + chapters parallel; attempts + CTs serial
- idx_assignments_class on (class_id) exists
- Lookups O(1): asgByKey, ctCellByKey, attemptByAssignment

---

## Effort Labels

| Label | UI Text | Icon Removed |
|-------|---------|-------------|
| independent_success | "Independent success" | ⚡ |
| effortful_success | "Effortful success" | 💪 |
| struggling_trying | "Struggling but trying" | 🌱 |
| independent_struggle | "Independent struggle" | ⚠️ |

Emojis removed from surface 2026-05-05. Still in model + drill-in + tooltip.

---

## Grade Colors

Uses `scoreColor(grade: number)` (lib/design/scoreColor). Always paired with numeric text.

---

## Summary: What V1 Shows

**At a glance**:
1. Month's schedule (school days)
2. Student roster
3. Homework status per student per day (glyph + color)
4. Chapter test status (purple columns)
5. Missing work names
6. Class average

**Interactions**:
- Student name → `/teacher/students/[id]`
- Cell → CellDrillIn panel
- Date header → stub (class-view-of-assignment coming)
- Chapter test header → `/teacher/chapter-tests/[id]`
- Chapter test cell → `/teacher/chapter-tests/[id]/students/[studentId]`
- Search → filters students
- Month navigator → month jump

---

## Files & Line Counts

| File | Lines | Purpose |
|------|-------|---------|
| app/(dashboard)/teacher/gradebook/page.tsx | 1031 | Page, navigator, table render, drill-in orchestration |
| app/api/teacher/gradebook/matrix/route.ts | 339 | Auth, queries, response |
| lib/gradebook/buildMatrix.ts | 432 | Cell status, matrix flattening, date generation, avg |
| components/teacher/gradebook/CellDrillIn.tsx | 668 | Drill-in panel: detail, actions, rubric |

**Total: ~2,470 lines**

---

## Backward Compat Notes

- Migration 065: Chapter test columns appended after dates (purple #fdf4ff)
  - Fields present even if empty
- Effort emoji removed 2026-05-05; still in model + drill-in
- Grade avg includes both HW + CT grades %
