# Gradebook Dates + Trend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split same-lesson daily assignments into one column per day, add a first-class "assigned date", a per-student grade-over-time sparkline (drill-in + profile), and a grade-cell hover tooltip — to the V2 teacher gradebook.

**Architecture:** A new `assigned_at` timestamp (migration 0018, stamped at generation) becomes part of the column key `lesson:<lesson_id>:<assignedDate>`, so same-lesson work on different days splits into separate dated columns while the per-student fan-out still collapses. The grid renders columns chronologically and shows the most-recent ~12 with a "Show earlier" expand. A new pure loader reads `homework_attempts` (graded, ordered by `graded_at`) into dated grade points; one shared SVG sparkline component renders them in the cell drill-in (via a small GET route) and on the student profile page. A pure tooltip-content helper feeds a single fixed-position tooltip in the grid.

**Tech Stack:** Next.js 16.2.9 App Router (async params), React 19, TypeScript, Tailwind v4 (token-only), Supabase (admin client bypasses RLS), Vitest 4 (+ jsdom for component tests). No charting library — hand-rolled SVG.

## Global Constraints

- **Next.js 16 / React 19 / Tailwind v4**, token-only styling: NO hardcoded hex, NO arbitrary `[var(--..)]` in components — Tier-2 token classes only; content text is deep-ink (`text-fg`), not `text-fg-muted`. Never invent a token.
- **"Assignments", never "Homework"** in any UI/copy (legacy DB identifiers like `homework_attempts` are exempt).
- **Teacher-only surface:** raw grade digits/% ARE allowed at their render sites; surrounding PROSE stays banned-word-free — check count-bearing prose with `hasBannedWord` (NOT `hasLeak`; a digit/date is expected). NEVER leak the mastery-band enum (`reteach`/`grade_level`/`advanced`) or any risk number on this surface.
- **`BANNED_WORDS`** (`src/lib/copy/leakGuard.ts`): `score, percentile, index, divergence, threshold, signal, model, algorithm, flag`. `"risk"` is NOT banned.
- **Coach posture** (`COACH-POSTURE.md`): observation over metric-dump, one thing at a time, plain words.
- **All user-facing strings are DRAFTS** → append to `STRINGS-FOR-BARB.md` under `## Gradebook`; Barb gates copy. Mark new strings `(DRAFT)`.
- **WCAG-AA:** `npm run a11y` must stay green (49/49). Hover info must also be reachable without hover (existing rich `aria-label` is the screen-reader path; tooltip also opens on focus).
- **React component tests** start with `// @vitest-environment jsdom` then `import '@/test/setup-dom';` (follow each existing file's header). Pure-logic tests run in the default `node` env (no header).
- **Migration 0018 applies to NEW CORE only** (Supabase project `pmdzxwppdlnddtnkoarc`) and ONLY with explicit per-action authorization from Marvin. Never touch V1/Spark/Brasil DBs.
- **Gates (every task ends green):** `npx tsc --noEmit` → 0 · `npx vitest run <touched test>` → pass · (whole-branch at end) `npm test`, `npm run build`, `npm run a11y`.
- **Frozen test clock:** loaders take an optional `now?: Date` arg — never call bare `new Date()` in test assertions; inject a fixed date (existing `loadGradebook` pattern).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `supabase/migrations/0018_assignment_assigned_at.sql` | NEW — add `assigned_at timestamptz` to `assignments` + backfill from `created_at` |
| `src/app/api/teacher/assignments/generate/route.ts` | MODIFY — stamp `assigned_at` on the assignment insert |
| `src/lib/trial/buildTrialRows.ts` | MODIFY — `assigned_at` on `TrialAssignment`, distinct per assignment def |
| `src/lib/demo/buildSeedRows.ts` | MODIFY — `assigned_at` on `SeedAssignment`, distinct per assignment def |
| `src/lib/trial/seedTrialDemoData.ts` | MODIFY — write `assigned_at` in the assignments insert |
| `src/lib/demo/*` seed writer | MODIFY — write `assigned_at` (mirror of seedTrialDemoData) |
| `src/lib/gradebook/loadGradebook.ts` | MODIFY — per-day colKey, fetch `assigned_at` + lesson titles, chronological order, raise cap |
| `src/lib/gradebook/loadStudentGradeTrend.ts` | NEW — per-student dated grade points + direction |
| `src/components/core/GradeTrendSparkline.tsx` | NEW — shared SVG sparkline (cold-start, token colors, caller aria-label) |
| `src/app/api/teacher/gradebook/trend/route.ts` | NEW — GET trend for (studentId, classId) behind the auth chain |
| `src/app/(teacher)/gradebook/_components/GradebookGrid.tsx` | MODIFY — windowed chronological columns + "Show earlier"; header dates; cell tooltip |
| `src/app/(teacher)/gradebook/_components/GradebookDrillIn.tsx` | MODIFY — fetch + render compact sparkline + direction note |
| `src/app/(teacher)/students/[studentId]/page.tsx` | MODIFY — "Grades over time" section (fuller sparkline) |
| `STRINGS-FOR-BARB.md` | MODIFY — `## Gradebook` draft strings |

---

## Task 1: `assigned_at` data foundation (migration + generation route + seed)

**Files:**
- Create: `supabase/migrations/0018_assignment_assigned_at.sql`
- Modify: `src/app/api/teacher/assignments/generate/route.ts:160-174`
- Modify: `src/lib/trial/buildTrialRows.ts:75-82` (type), `:254-267` (defs)
- Modify: `src/lib/demo/buildSeedRows.ts` (`SeedAssignment` type + `assignmentDefs.map` at `:152-166`)
- Modify: `src/lib/trial/seedTrialDemoData.ts:257-267` (insert)
- Modify: the demo seed writer that inserts `assignments` (find with grep below; mirror the seedTrialDemoData change)
- Test: `src/lib/trial/__tests__/buildTrialRows.assignedAt.test.ts` (NEW)

**Interfaces:**
- Produces: `assignments.assigned_at` (timestamptz, nullable, set at generation). `TrialAssignment.assigned_at: string` and `SeedAssignment.assigned_at: string` (ISO). Each assignment def has a DISTINCT `assigned_at` so columns split.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0018_assignment_assigned_at.sql`:
```sql
-- 0018_assignment_assigned_at.sql
-- Gradebook v1.1: an explicit "assigned date" on assignments, stamped once at generation
-- and never changed (independent of due_at, which may be overridden per student). Becomes
-- part of the gradebook column key (lesson + assigned-day) so same-lesson work on different
-- days splits into separate dated columns. No RLS change (assignments RLS unchanged).
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

-- Backfill existing rows to their creation day so historical columns split sensibly.
-- (No column-level DEFAULT: a now() default would stamp every existing row with the
-- migration-run instant and collapse all history into one column.)
UPDATE public.assignments SET assigned_at = created_at WHERE assigned_at IS NULL;
```

- [ ] **Step 2: Stamp `assigned_at` in the generation route**

In `src/app/api/teacher/assignments/generate/route.ts`, the insert at lines 160-174 — add `assigned_at`:
```ts
    const { data: row, error: insErr } = await admin
      .from('assignments')
      .insert({
        quiz_attempt_id: attempt.id,
        student_id: attempt.student_id,
        class_id: classId,          // C15: from quizzes join
        lesson_id: lessonId,        // C15: from quizzes join
        mastery_band: band,
        learning_style: normalizeLearningStyle(style), // C6: normalize at boundary
        content: assignment,
        status: 'draft',
        assigned_at: new Date().toISOString(), // gradebook v1.1: the day this was assigned (never changes)
        generation_model: OPENAI_GEN_MODEL,
      })
      .select()
      .single();
```

- [ ] **Step 3: Add `assigned_at` to the seed builders (distinct per def)**

`src/lib/trial/buildTrialRows.ts` — add to the `TrialAssignment` interface (after `due_at: string;`):
```ts
  assigned_at: string;
```
Then in the `assignments` map (lines 254-267), stamp a distinct assigned day per def — assigned a few days before its due so the four defs (a1..a4) produce four distinct assigned-dates sharing one lesson:
```ts
  const assignments: TrialAssignment[] = assignmentDefs.map(({ key, offsetDays }) => {
    const due = daysAgo(now, -offsetDays);
    // Assigned 2 days before due → four distinct assigned-days for the four defs.
    const assigned = daysAgo(now, -offsetDays + 2);
    return {
      key,
      mastery_band: null,
      content: {
        bandLabel: 'grade_level',
        instructions: TASKS_BY_BAND.grade_level.instructions,
        tasks: TASKS_BY_BAND.grade_level.tasks,
      },
      due_at: isoOf(due),
      assigned_at: isoOf(assigned),
      status: 'published',
    };
  });
```
Apply the identical change to `src/lib/demo/buildSeedRows.ts`: add `assigned_at: string;` to its `SeedAssignment` interface, and add `assigned_at: isoOf(assigned)` (same `const assigned = daysAgo(now, -offsetDays + 2);`) in its `assignmentDefs.map` at lines 152-166.

- [ ] **Step 4: Write `assigned_at` in the seed writers**

`src/lib/trial/seedTrialDemoData.ts`, the assignments insert at lines 257-267 — add `assigned_at`:
```ts
          const { error: aErr } = await admin.from('assignments').insert({
            id: aId,
            student_id: sid,
            class_id: classId,
            lesson_id: lessonId ?? undefined,
            mastery_band: band,
            content: assignment.content, // jsonb NOT NULL (C9)
            status: assignment.status,
            due_at: assignment.due_at,
            assigned_at: assignment.assigned_at,
            reteach_needed: student.reteachNeeded ?? false,
          });
```
Then grep for the demo seed writer and mirror the change:
```bash
grep -rn "from('assignments')" src/lib/demo src/scripts scripts 2>/dev/null
grep -rn ".insert" src/lib/demo 2>/dev/null | grep -i assign
```
For any `admin.from('assignments').insert({...})` found in the demo seed path, add `assigned_at: assignment.assigned_at,` alongside `due_at`.

- [ ] **Step 5: Write the failing test (builder distinctness)**

Create `src/lib/trial/__tests__/buildTrialRows.assignedAt.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildTrialRows } from '@/lib/trial/buildTrialRows';
import { DEMO_STUDENTS } from '@/lib/demo/demoCast';

const IDS = { schoolId: 'sch-1', schoolIdShort: 'sch-1abc', teacherId: 't-1' };
const NOW = new Date('2026-06-20T00:00:00Z');

describe('buildTrialRows — assigned_at', () => {
  it('stamps every assignment def with an assigned_at', () => {
    const rows = buildTrialRows(DEMO_STUDENTS, IDS, NOW);
    expect(rows.assignments.length).toBeGreaterThan(0);
    for (const a of rows.assignments) {
      expect(typeof a.assigned_at).toBe('string');
      expect(a.assigned_at.length).toBeGreaterThan(0);
    }
  });

  it('gives the defs DISTINCT assigned-days so same-lesson columns will split', () => {
    const rows = buildTrialRows(DEMO_STUDENTS, IDS, NOW);
    const days = new Set(rows.assignments.map(a => a.assigned_at.slice(0, 10)));
    // Four assignment defs (a1..a4) → four distinct assigned-days.
    expect(days.size).toBe(rows.assignments.length);
  });
});
```

- [ ] **Step 6: Run the test to verify it FAILS**

Run: `npx vitest run src/lib/trial/__tests__/buildTrialRows.assignedAt.test.ts`
Expected: FAIL — `a.assigned_at` is `undefined` (type/field not yet added) until Step 3 is in place. (If you implemented Step 3 first, instead confirm it PASSES and that you saw it fail on a scratch run.)

- [ ] **Step 7: Run the test to verify it PASSES**

Run: `npx vitest run src/lib/trial/__tests__/buildTrialRows.assignedAt.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors. (If the demo seed writer's `assignment` object lacks `assigned_at` in its type, you added it in Step 3.)

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/0018_assignment_assigned_at.sql src/app/api/teacher/assignments/generate/route.ts src/lib/trial/buildTrialRows.ts src/lib/demo/buildSeedRows.ts src/lib/trial/seedTrialDemoData.ts src/lib/trial/__tests__/buildTrialRows.assignedAt.test.ts
git commit -m "feat(gradebook): assigned_at on assignments — migration 0018 + generation + seed"
```

> **Migration application is deferred** — do NOT apply 0018 to the live DB during implementation. The controller applies it to NEW CORE only, with Marvin's authorization, before the live smoke test.

---

## Task 2: `loadGradebook` — per-day keying, lesson titles, chronological columns

**Files:**
- Modify: `src/lib/gradebook/loadGradebook.ts`
- Test: `src/lib/gradebook/__tests__/loadGradebook.test.ts` (UPDATE existing + ADD)

**Interfaces:**
- Consumes: `assignments.assigned_at` (Task 1).
- Produces:
  - `colKey` now appends the assigned-day to the lesson branch: `lesson:<lesson_id>:<YYYY-MM-DD>` (null-lesson branches `due:<due_at>` / `id:<id>` unchanged).
  - `GradebookAssignmentCol` gains `assigned_at: string | null` and uses the lesson title as `title` when available (else the existing `dueLabel`).
  - `Gradebook.assignments` is ordered **chronological ascending** (oldest→newest) and capped to the most-recent `MAX_ASSIGNMENT_COLS` (raised to 40).

- [ ] **Step 1: Update existing tests to the new key format + add new behavior tests**

In `src/lib/gradebook/__tests__/loadGradebook.test.ts`:

(a) The seed rows use `lesson_id: 'L1'`, `created_at: '2026-06-01T00:00:00Z'`, and NO `assigned_at`. The new key for these = `lesson:L1:2026-06-01`. Update every literal `'lesson:L1'` to `'lesson:L1:2026-06-01'` (in `beforeEach`-derived assertions: the tests at the original lines 48, 54, 63, 65, 75-76, 98-100, 123-124, 166-167, 176, 182, 196-198, 249-255, 267-269, 281, and the `cells['s1']['lesson:L1']` / `column_averages['lesson:L1']` lookups). The `due:` and `id:` tests (original 213-214) stay unchanged.

(b) Add the headline new test — same lesson, two assigned-days → TWO columns:
```ts
  it('splits same-lesson assignments by assigned day into separate dated columns', async () => {
    ASSIGNMENTS = [
      // Same lesson L1, two distinct assigned days → two columns; per-student fan-out within a day stays one.
      { id: 'd1_s1', lesson_id: 'L1', content: {}, due_at: '2026-06-12T00:00:00Z', assigned_at: '2026-06-10T00:00:00Z', created_at: '2026-06-10T00:00:00Z', student_id: 's1' },
      { id: 'd1_s2', lesson_id: 'L1', content: {}, due_at: '2026-06-12T00:00:00Z', assigned_at: '2026-06-10T00:00:00Z', created_at: '2026-06-10T00:00:00Z', student_id: 's2' },
      { id: 'd2_s1', lesson_id: 'L1', content: {}, due_at: '2026-06-14T00:00:00Z', assigned_at: '2026-06-13T00:00:00Z', created_at: '2026-06-13T00:00:00Z', student_id: 's1' },
      { id: 'd2_s2', lesson_id: 'L1', content: {}, due_at: '2026-06-14T00:00:00Z', assigned_at: '2026-06-13T00:00:00Z', created_at: '2026-06-13T00:00:00Z', student_id: 's2' },
    ];
    HW = [];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    const keys = gb.assignments.map(a => a.assignment_key);
    expect(keys).toEqual(['lesson:L1:2026-06-10', 'lesson:L1:2026-06-13']); // chronological asc
    expect(gb.assignments).toHaveLength(2);
  });
```

(c) Add a chronological-order test:
```ts
  it('orders columns oldest → newest by assigned day', async () => {
    ASSIGNMENTS = [
      { id: 'late_s1', lesson_id: 'L1', content: {}, due_at: null, assigned_at: '2026-06-15T00:00:00Z', created_at: '2026-06-15T00:00:00Z', student_id: 's1' },
      { id: 'early_s1', lesson_id: 'L2', content: {}, due_at: null, assigned_at: '2026-06-05T00:00:00Z', created_at: '2026-06-05T00:00:00Z', student_id: 's1' },
    ];
    HW = [];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.assignments.map(a => a.assignment_key)).toEqual(['lesson:L2:2026-06-05', 'lesson:L1:2026-06-15']);
  });
```

(d) Add a lesson-title test (the `lessons` table is now queried — extend the test stub):
```ts
  // Extend the admin stub to serve a `lessons` table, and seed LESSONS in beforeEach.
  // In the table() dispatch add:  if (t === 'lessons') return table(() => LESSONS);
  // Declare `let LESSONS: unknown[];` at top and set in beforeEach: LESSONS = [{ id: 'L1', title: 'Fractions' }];
  it('uses the lesson title as the column title when available', async () => {
    LESSONS = [{ id: 'L1', title: 'Fractions' }];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.assignments[0].title).toBe('Fractions');
    expect(gb.assignments[0].assigned_at).toBe('2026-06-01T00:00:00Z');
  });
```
Add `let LESSONS: unknown[];` near the other `let` declarations, set `LESSONS = [];` in `beforeEach` (above the existing rows), and add the `lessons` branch to the `admin.from` dispatch.

- [ ] **Step 2: Run the updated tests to verify they FAIL**

Run: `npx vitest run src/lib/gradebook/__tests__/loadGradebook.test.ts`
Expected: FAIL — keys are still `lesson:L1` (no date), no `assigned_at` on columns, no lesson title, order is created-desc.

- [ ] **Step 3: Implement the loader changes**

In `src/lib/gradebook/loadGradebook.ts`:

(a) Raise the cap and add a UTC-date helper + extend the column type:
```ts
const MAX_ASSIGNMENT_COLS = 40; // raised: per-day columns produce more than the old 12 (grid windows to recent)
```
```ts
export interface GradebookAssignmentCol { assignment_key: string; title: string; due_at: string | null; assigned_at: string | null; }
```
(b) Extend `AsgRow` and the assignments select to include `assigned_at`:
```ts
type AsgRow = { id: string; lesson_id: string | null; due_at: string | null; assigned_at: string | null; created_at: string | null; student_id: string };
```
```ts
  const { data: asgData } = await admin.from('assignments')
    .select('id, lesson_id, due_at, assigned_at, created_at, student_id')
    .eq('class_id', classId).order('created_at', { ascending: false });
```
(c) New `colKey` (only the lesson branch changes) + a date helper:
```ts
/** UTC calendar day ('YYYY-MM-DD') of the assigned date (assigned_at, falling back to created_at). */
function assignedDay(a: AsgRow): string {
  const iso = a.assigned_at ?? a.created_at;
  return iso ? iso.slice(0, 10) : '';
}
function colKey(a: AsgRow): string {
  if (a.lesson_id) return `lesson:${a.lesson_id}:${assignedDay(a)}`; // split same-lesson work by assigned day
  if (a.due_at) return `due:${a.due_at}`;
  return `id:${a.id}`;
}
```
(d) In `colMeta`, derive the column's `assigned_at` (min non-null across the group — the day the batch was assigned) and order ascending by it; keep the most-recent `MAX_ASSIGNMENT_COLS`:
```ts
  const colMeta = [...groups.entries()]
    .map(([key, rows]) => ({
      key, rows,
      maxCreated: rows.map(r => r.created_at ?? '').sort().at(-1) ?? '',
      due_at: rows.map(r => r.due_at).filter((d): d is string => d != null).sort().at(-1) ?? null,
      // Column assigned date: min non-null across the group (the batch's assigned day). Stable.
      assigned_at: rows.map(r => r.assigned_at).filter((d): d is string => d != null).sort().at(0) ?? null,
      lesson_id: rows.find(r => r.lesson_id)?.lesson_id ?? null,
    }))
    // Keep the most-recent N (sort desc by assigned day, then created), then present chronologically.
    .sort((a, b) => (b.assigned_at ?? b.maxCreated).localeCompare(a.assigned_at ?? a.maxCreated))
    .slice(0, MAX_ASSIGNMENT_COLS)
    .sort((a, b) => (a.assigned_at ?? a.maxCreated).localeCompare(b.assigned_at ?? b.maxCreated));
```
(e) Fetch lesson titles for the kept columns (6th batched query) and build columns with title preference:
```ts
  const lessonIds = [...new Set(colMeta.map(c => c.lesson_id).filter((x): x is string => x != null))];
  const { data: lessonData } = await admin.from('lessons')
    .select('id, title')
    .in('id', lessonIds.length ? lessonIds : NONE);
  const lessonTitle = new Map<string, string>(
    ((lessonData ?? []) as Array<{ id: string; title: string | null }>)
      .map(l => [l.id, l.title ?? ''] as const));
  const assignments: GradebookAssignmentCol[] = colMeta.map((c, i) => ({
    assignment_key: c.key,
    title: (c.lesson_id && lessonTitle.get(c.lesson_id)) || dueLabel(c.due_at, i + 1),
    due_at: c.due_at,
    assigned_at: c.assigned_at,
  }));
```

- [ ] **Step 4: Run the tests to verify they PASS**

Run: `npx vitest run src/lib/gradebook/__tests__/loadGradebook.test.ts`
Expected: PASS (all updated + 3 new tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/gradebook/loadGradebook.ts src/lib/gradebook/__tests__/loadGradebook.test.ts
git commit -m "feat(gradebook): per-day column keying (lesson+assigned-day), lesson titles, chronological order"
```

---

## Task 3: `loadStudentGradeTrend` — per-student dated grade points

**Files:**
- Create: `src/lib/gradebook/loadStudentGradeTrend.ts`
- Test: `src/lib/gradebook/__tests__/loadStudentGradeTrend.test.ts` (NEW)

**Interfaces:**
- Produces:
```ts
export interface GradeTrendPoint { date: string; grade: number; assignment_title: string; on_time: boolean | null; }
export interface StudentGradeTrend { points: GradeTrendPoint[]; direction: 'climbing' | 'steady' | 'sliding' | null; latest: number | null; average: number | null; }
export function loadStudentGradeTrend(admin: SupabaseClient, args: { studentId: string; classId: string }): Promise<StudentGradeTrend>;
```
- `grade = teacher_score ?? score_pct` (override-wins, mirrors `loadGradebook`). Ordered by `graded_at` ascending. `direction` null when <3 points.

- [ ] **Step 1: Write the failing test**

Create `src/lib/gradebook/__tests__/loadStudentGradeTrend.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadStudentGradeTrend } from '@/lib/gradebook/loadStudentGradeTrend';

let ASSIGNMENTS: unknown[]; let HW: unknown[]; let LESSONS: unknown[];
function table(rows: () => unknown[]) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['select', 'eq', 'in', 'order']) q[m] = chain;
  (q as { then: unknown }).then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: rows(), error: null });
  return q;
}
const admin = {
  from: (t: string) => {
    if (t === 'assignments') return table(() => ASSIGNMENTS);
    if (t === 'homework_attempts') return table(() => HW);
    if (t === 'lessons') return table(() => LESSONS);
    return table(() => []);
  },
} as unknown as Parameters<typeof loadStudentGradeTrend>[0];

beforeEach(() => {
  ASSIGNMENTS = [
    { id: 'a1', lesson_id: 'L1' }, { id: 'a2', lesson_id: 'L1' }, { id: 'a3', lesson_id: 'L1' },
  ];
  LESSONS = [{ id: 'L1', title: 'Fractions' }];
  HW = [
    { assignment_id: 'a1', score_pct: 60, teacher_score: null, graded_at: '2026-06-05T00:00:00Z', submitted_on_time: true, status: 'graded' },
    { assignment_id: 'a2', score_pct: 70, teacher_score: null, graded_at: '2026-06-10T00:00:00Z', submitted_on_time: false, status: 'graded' },
    { assignment_id: 'a3', score_pct: 80, teacher_score: 90, graded_at: '2026-06-15T00:00:00Z', submitted_on_time: true, status: 'graded' },
  ];
});

describe('loadStudentGradeTrend', () => {
  it('returns graded points oldest→newest, override-wins, with assignment titles', async () => {
    const t = await loadStudentGradeTrend(admin, { studentId: 's1', classId: 'c1' });
    expect(t.points.map(p => p.grade)).toEqual([60, 70, 90]); // a3 uses teacher_score 90
    expect(t.points.map(p => p.date)).toEqual(['2026-06-05T00:00:00Z', '2026-06-10T00:00:00Z', '2026-06-15T00:00:00Z']);
    expect(t.points[0].assignment_title).toBe('Fractions');
    expect(t.points[1].on_time).toBe(false);
    expect(t.latest).toBe(90);
    expect(t.average).toBe(73); // round((60+70+90)/3)
  });

  it('classifies direction climbing/steady/sliding (null under 3 points)', async () => {
    const climbing = await loadStudentGradeTrend(admin, { studentId: 's1', classId: 'c1' });
    expect(climbing.direction).toBe('climbing');
    HW = HW.slice(0, 2); // only 2 points
    const tooFew = await loadStudentGradeTrend(admin, { studentId: 's1', classId: 'c1' });
    expect(tooFew.direction).toBeNull();
  });

  it('returns an empty trend when the student has no graded work', async () => {
    HW = [];
    const t = await loadStudentGradeTrend(admin, { studentId: 's1', classId: 'c1' });
    expect(t.points).toEqual([]);
    expect(t.direction).toBeNull();
    expect(t.latest).toBeNull();
    expect(t.average).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `npx vitest run src/lib/gradebook/__tests__/loadStudentGradeTrend.test.ts`
Expected: FAIL — module not found / function not defined.

- [ ] **Step 3: Implement the loader**

Create `src/lib/gradebook/loadStudentGradeTrend.ts`:
```ts
// src/lib/gradebook/loadStudentGradeTrend.ts
// Pure per-student grade-over-time loader — NO auth (caller guards via the route's auth chain).
// Reads this class's graded homework_attempts for one student, oldest→newest by graded_at, into
// dated grade points (override-wins: teacher_score ?? score_pct). Earned grades only — no band,
// no risk. Powers the GradeTrendSparkline in the drill-in and the student profile page.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface GradeTrendPoint { date: string; grade: number; assignment_title: string; on_time: boolean | null; }
export interface StudentGradeTrend {
  points: GradeTrendPoint[];
  direction: 'climbing' | 'steady' | 'sliding' | null;
  latest: number | null;
  average: number | null;
}

const NONE = ['__none__'];
const DIRECTION_THRESHOLD = 3; // pts of head→tail mean shift before we call it climbing/sliding

type AsgRow = { id: string; lesson_id: string | null };
type HwRow = { assignment_id: string; score_pct: number | null; teacher_score: number | null; graded_at: string | null; submitted_on_time: boolean | null };

function classifyDirection(grades: number[]): StudentGradeTrend['direction'] {
  if (grades.length < 3) return null;
  const third = Math.max(1, Math.floor(grades.length / 3));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const delta = mean(grades.slice(-third)) - mean(grades.slice(0, third));
  if (delta > DIRECTION_THRESHOLD) return 'climbing';
  if (delta < -DIRECTION_THRESHOLD) return 'sliding';
  return 'steady';
}

export async function loadStudentGradeTrend(
  admin: SupabaseClient,
  args: { studentId: string; classId: string },
): Promise<StudentGradeTrend> {
  const { studentId, classId } = args;

  // 1. This student's assignments in this class → ids + lesson_id.
  const { data: asgData } = await admin.from('assignments')
    .select('id, lesson_id')
    .eq('class_id', classId).eq('student_id', studentId);
  const asgRows = (asgData ?? []) as AsgRow[];
  const lessonByAsg = new Map(asgRows.map(a => [a.id, a.lesson_id] as const));
  const assignmentIds = asgRows.map(a => a.id);

  // 2. Lesson titles (for point labels).
  const lessonIds = [...new Set(asgRows.map(a => a.lesson_id).filter((x): x is string => x != null))];
  const { data: lessonData } = await admin.from('lessons')
    .select('id, title')
    .in('id', lessonIds.length ? lessonIds : NONE);
  const lessonTitle = new Map<string, string>(
    ((lessonData ?? []) as Array<{ id: string; title: string | null }>).map(l => [l.id, l.title ?? 'Assignment'] as const));

  // 3. Graded attempts, oldest→newest.
  const { data: hwData } = await admin.from('homework_attempts')
    .select('assignment_id, score_pct, teacher_score, graded_at, submitted_on_time, status')
    .in('assignment_id', assignmentIds.length ? assignmentIds : NONE)
    .eq('student_id', studentId)
    .eq('status', 'graded')
    .order('graded_at', { ascending: true });
  const hwRows = (hwData ?? []) as HwRow[];

  const points: GradeTrendPoint[] = [];
  for (const h of hwRows) {
    const grade = (typeof h.teacher_score === 'number') ? h.teacher_score : h.score_pct;
    if (grade == null || !h.graded_at) continue;
    const lid = lessonByAsg.get(h.assignment_id) ?? null;
    points.push({
      date: h.graded_at,
      grade,
      assignment_title: (lid && lessonTitle.get(lid)) || 'Assignment',
      on_time: h.submitted_on_time ?? null,
    });
  }

  const grades = points.map(p => p.grade);
  return {
    points,
    direction: classifyDirection(grades),
    latest: grades.length ? grades[grades.length - 1] : null,
    average: grades.length ? Math.round(grades.reduce((a, b) => a + b, 0) / grades.length) : null,
  };
}
```

- [ ] **Step 4: Run the test to verify it PASSES**

Run: `npx vitest run src/lib/gradebook/__tests__/loadStudentGradeTrend.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → 0 errors.
```bash
git add src/lib/gradebook/loadStudentGradeTrend.ts src/lib/gradebook/__tests__/loadStudentGradeTrend.test.ts
git commit -m "feat(gradebook): loadStudentGradeTrend — per-student dated grade points + direction"
```

---

## Task 4: `GradeTrendSparkline` — shared SVG sparkline

**Files:**
- Create: `src/components/core/GradeTrendSparkline.tsx`
- Test: `src/components/core/__tests__/GradeTrendSparkline.test.tsx` (NEW)

**Interfaces:**
- Produces:
```ts
export interface GradeTrendSparklineProps {
  points: { date: string; grade: number; label?: string }[];
  ariaLabel: string;              // caller-provided (teacher surface → grade digits allowed in label)
  size?: 'sm' | 'md';             // sm = drill-in, md = profile
  coldStartLabel?: string;        // shown when <2 points; DRAFT → Barb
}
```
- Pure presentational. Token colors via CSS vars (`var(--brand)`, `var(--brand-accent)`, `var(--surface)`), exactly like `GrowthMotif`. No animation → reduced-motion-safe by construction. `<2` points → calm cold-start text.

- [ ] **Step 1: Write the failing test**

Create `src/components/core/__tests__/GradeTrendSparkline.test.tsx`:
```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GradeTrendSparkline } from '../GradeTrendSparkline';

const PTS = [
  { date: '2026-06-05T00:00:00Z', grade: 60, label: 'Fractions · 60%' },
  { date: '2026-06-10T00:00:00Z', grade: 70 },
  { date: '2026-06-15T00:00:00Z', grade: 90 },
];

describe('GradeTrendSparkline', () => {
  it('renders an accessible SVG line with one path and a point per grade', () => {
    const { container } = render(<GradeTrendSparkline points={PTS} ariaLabel="Grades over time: climbing" />);
    const svg = screen.getByRole('img', { name: /grades over time/i });
    expect(svg).toBeInTheDocument();
    expect(container.querySelectorAll('path')).toHaveLength(1);     // the line
    expect(container.querySelectorAll('circle').length).toBeGreaterThanOrEqual(PTS.length); // per-point dots
  });

  it('shows a calm cold-start message under 2 points (never a fake trend)', () => {
    render(<GradeTrendSparkline points={[{ date: 'x', grade: 80 }]} ariaLabel="x" coldStartLabel="Not enough yet to show a trend." />);
    expect(screen.getByTestId('trend-cold-start')).toHaveTextContent(/not enough yet/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `npx vitest run src/components/core/__tests__/GradeTrendSparkline.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `src/components/core/GradeTrendSparkline.tsx`:
```tsx
// src/components/core/GradeTrendSparkline.tsx
// Shared dated grade-over-time sparkline (you vs your own past, never peer-relative).
// Pure SVG line; token colors via CSS vars (matches GrowthMotif). No animation → reduced-motion-safe.
// Caller supplies aria-label (teacher surfaces may include grade digits). <2 points → calm cold-start.
import React from 'react';

export interface GradeTrendSparklineProps {
  points: { date: string; grade: number; label?: string }[];
  ariaLabel: string;
  size?: 'sm' | 'md';
  coldStartLabel?: string;
}

const MIN_POINTS = 2;

export function GradeTrendSparkline({
  points,
  ariaLabel,
  size = 'md',
  coldStartLabel = 'Not enough yet to show a trend.',
}: GradeTrendSparklineProps): React.JSX.Element {
  if (points.length < MIN_POINTS) {
    return (
      <p data-testid="trend-cold-start" className="text-fg-muted text-xs">
        {coldStartLabel}
      </p>
    );
  }

  const W = size === 'sm' ? 180 : 320;
  const H = size === 'sm' ? 44 : 68;
  const PAD = 5;
  const grades = points.map(p => p.grade);
  const min = Math.min(...grades);
  const max = Math.max(...grades);
  const span = Math.max(1, max - min); // guard divide-by-zero (flat line → mid-height)
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (points.length - 1);
  const y = (g: number) => PAD + (1 - (g - min) / span) * (H - 2 * PAD);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.grade).toFixed(1)}`).join(' ');
  const lastI = points.length - 1;

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      data-testid="grade-trend-sparkline"
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius)' }}
    >
      <path d={d} fill="none" stroke="var(--brand-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={x(i)}
          cy={y(p.grade)}
          r={i === lastI ? 3.5 : 2}
          fill={i === lastI ? 'var(--brand)' : 'var(--brand-accent)'}
        >
          <title>{p.label ?? `${p.grade}%`}</title>
        </circle>
      ))}
    </svg>
  );
}

export default GradeTrendSparkline;
```

- [ ] **Step 4: Run the test to verify it PASSES**

Run: `npx vitest run src/components/core/__tests__/GradeTrendSparkline.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → 0 errors.
```bash
git add src/components/core/GradeTrendSparkline.tsx src/components/core/__tests__/GradeTrendSparkline.test.tsx
git commit -m "feat(gradebook): GradeTrendSparkline — shared token-styled SVG grade sparkline"
```

---

## Task 5: `GradebookGrid` — windowed chronological columns, header dates, cell tooltip

**Files:**
- Modify: `src/app/(teacher)/gradebook/_components/GradebookGrid.tsx`
- Test: `src/app/(teacher)/gradebook/_components/__tests__/GradebookGrid.test.tsx` (UPDATE if present, else CREATE)
- Modify: `STRINGS-FOR-BARB.md` (`## Gradebook`)

**Interfaces:**
- Consumes: `Gradebook.assignments` chronological asc + `GradebookAssignmentCol.assigned_at` / `.due_at` / `.title` (Task 2). `GradebookCell.submitted_at` / `.submitted_on_time` (already present).
- Produces: a pure exported `cellTooltipLines(col, cell)` helper (testable, banned-word-free); `DEFAULT_VISIBLE_COLS = 12`.

- [ ] **Step 1: Write the failing tests**

Create/extend `src/app/(teacher)/gradebook/_components/__tests__/GradebookGrid.test.tsx`:
```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GradebookGrid } from '../GradebookGrid';
import { cellTooltipLines } from '../GradebookGrid';
import { hasBannedWord } from '@/lib/copy/leakGuard';
import type { Gradebook, GradebookCell } from '@/lib/gradebook/loadGradebook';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function gradedCell(grade: number, over: Partial<GradebookCell> = {}): GradebookCell {
  return {
    attempt_id: 'h1', status: 'graded', displayed_grade: grade, score_pct: grade,
    effort_label: null, teacher_notes: null, submitted_at: '2026-06-09T00:00:00Z',
    is_override: false, submitted_on_time: true, allow_redo: false, ...over,
  };
}

function makeData(nCols: number): Gradebook {
  const assignments = Array.from({ length: nCols }, (_, i) => ({
    assignment_key: `lesson:L:${String(i).padStart(2, '0')}`,
    title: `Lesson ${i}`,
    due_at: `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    assigned_at: `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
  }));
  const cells: Gradebook['cells'] = { s1: {} };
  for (const a of assignments) cells.s1[a.assignment_key] = gradedCell(80);
  return {
    class_id: 'c1', students: [{ student_id: 's1', name: 'Ana Diaz' }],
    assignments, cells, class_average: 80, column_averages: {}, missing_count: 0,
    quizzes: [], quiz_cells: {},
  };
}

describe('cellTooltipLines', () => {
  it('shows assignment name + submitted date + due, banned-word-free', () => {
    const lines = cellTooltipLines(
      { assignment_key: 'k', title: 'Fractions', due_at: '2026-06-16T00:00:00Z', assigned_at: null },
      gradedCell(88, { submitted_on_time: false }),
    );
    expect(lines[0]).toBe('Fractions');
    expect(lines.join(' ')).toMatch(/Turned in Jun 9/);
    expect(lines.join(' ')).toMatch(/late/i);
    expect(lines.join(' ')).toMatch(/Due Jun 16/);
    for (const l of lines) expect(hasBannedWord(l)).toBe(false);
  });
  it('says not turned in yet when there is no submission', () => {
    const lines = cellTooltipLines(
      { assignment_key: 'k', title: 'Fractions', due_at: null, assigned_at: null },
      { ...gradedCell(0), status: 'missing', submitted_at: null, displayed_grade: null },
    );
    expect(lines.join(' ')).toMatch(/not turned in yet/i);
  });
});

describe('GradebookGrid — windowing', () => {
  it('shows only the most-recent DEFAULT_VISIBLE_COLS columns, newest visible; expands on Show earlier', () => {
    render(<GradebookGrid data={makeData(15)} />);
    // 15 cols, default window 12 → "Lesson 0/1/2" (oldest) hidden until expanded.
    expect(screen.queryByText('Lesson 0')).toBeNull();
    expect(screen.getByText('Lesson 14')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show earlier/i }));
    expect(screen.getByText('Lesson 0')).toBeInTheDocument();
  });
  it('does NOT show the Show earlier control when columns fit the window', () => {
    render(<GradebookGrid data={makeData(5)} />);
    expect(screen.queryByRole('button', { name: /show earlier/i })).toBeNull();
  });
  it('renders the assigned/due dates in the column header', () => {
    render(<GradebookGrid data={makeData(2)} />);
    expect(screen.getAllByText(/Assigned Jun|Due Jun/).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they FAIL**

Run: `npx vitest run "src/app/(teacher)/gradebook/_components/__tests__/GradebookGrid.test.tsx"`
Expected: FAIL — `cellTooltipLines` not exported; no windowing; no header dates.

- [ ] **Step 3: Implement the grid changes**

In `src/app/(teacher)/gradebook/_components/GradebookGrid.tsx`:

(a) Add date helpers + the pure tooltip-content export near the top (after imports):
```ts
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
/** How many of the most-recent dated columns the grid shows before "Show earlier". */
export const DEFAULT_VISIBLE_COLS = 12;

/** Pure, testable tooltip lines for a grade cell (assignment name + dates). Count-bearing prose →
 *  banned-word-free (dates are expected). DRAFT → Barb. */
export function cellTooltipLines(col: GradebookAssignmentCol, cell: GradebookCell): string[] {
  const lines: string[] = [col.title];
  if (cell.submitted_at) {
    const late = cell.submitted_on_time === false;
    lines.push(`Turned in ${shortDate(cell.submitted_at)}${late ? ' (late)' : ' (on time)'}`);
  } else {
    lines.push('Not turned in yet');
  }
  if (col.due_at) lines.push(`Due ${shortDate(col.due_at)}`);
  return lines;
}
```

(b) In `GradebookGrid`, derive the visible window + a tooltip state. After the existing destructure (`const { students, assignments, ... } = data;`):
```ts
  const [showAll, setShowAll] = useState(false);
  const hasEarlier = assignments.length > DEFAULT_VISIBLE_COLS;
  // assignments arrive chronological asc; default shows the most-recent window (the tail).
  const visibleCols = showAll ? assignments : assignments.slice(-DEFAULT_VISIBLE_COLS);
  // Single fixed-position tooltip (avoids clipping inside the scroll container).
  const [tip, setTip] = useState<{ lines: string[]; x: number; y: number } | null>(null);
```

(c) Replace every `assignments.map(...)` in the header row, body rows, and footer with `visibleCols.map(...)`. (Three sites: the `<thead>` header `<th>` map, the per-row body `<td>` map, and the `<tfoot>` column-average map.)

(d) In the header `<th>` map, render the date subline under the title:
```tsx
              {visibleCols.map((col) => (
                <th
                  key={col.assignment_key}
                  className="sticky top-0 z-20 bg-surface border-b-2 border-l-2 border-sidebar-edge p-2 text-center align-bottom"
                >
                  <div className="flex flex-col items-center gap-1">
                    <SectionLabel tone="brand">{col.title}</SectionLabel>
                    <span className="text-[10px] text-fg-muted whitespace-nowrap">
                      {col.assigned_at ? `Assigned ${shortDate(col.assigned_at)}` : ''}
                      {col.assigned_at && col.due_at ? ' · ' : ''}
                      {col.due_at ? `Due ${shortDate(col.due_at)}` : ''}
                    </span>
                  </div>
                </th>
              ))}
```

(e) Add a "Show earlier" control just above the scroll wrapper (`<div className="max-h-[70vh] ...">`):
```tsx
      {hasEarlier && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="self-start rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1 text-sm text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {showAll ? 'Show recent only' : 'Show earlier'}
        </button>
      )}
```

(f) Wire the tooltip onto the interactive cell button. In the `<button>` (currently lines ~227-234) add hover/focus handlers and ensure `safeCell` includes ALL required fields. Replace the `safeCell` fallback to include `teacher_notes` and `submitted_at`:
```ts
                  const safeCell: GradebookCell = cell ?? {
                    attempt_id: null, status: 'none', displayed_grade: null, score_pct: null,
                    effort_label: null, teacher_notes: null, submitted_at: null,
                    is_override: false, submitted_on_time: null, allow_redo: false,
                  };
```
And on the `<button>`:
```tsx
                        <button
                          type="button"
                          aria-label={ariaLabel}
                          onMouseEnter={(e) => setTip({ lines: cellTooltipLines(col, safeCell), x: e.clientX, y: e.clientY })}
                          onMouseLeave={() => setTip(null)}
                          onFocus={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            setTip({ lines: cellTooltipLines(col, safeCell), x: r.left + r.width / 2, y: r.top });
                          }}
                          onBlur={() => setTip(null)}
                          onClick={() => setSelected({ studentName: s.name, col, cell: toDrillCell(safeCell) })}
                          className="flex w-full cursor-pointer items-center justify-center rounded-md p-1 text-fg ring-1 ring-sidebar-edge/40 hover:shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                        >
                          {inner}
                        </button>
```

(g) Render the single fixed tooltip at the end of the component's returned fragment (just before `{selected && (`):
```tsx
      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-40 max-w-xs -translate-x-1/2 -translate-y-full rounded-md border-2 border-sidebar-edge bg-surface px-2 py-1 text-xs text-fg shadow-sticker"
          style={{ left: tip.x, top: tip.y - 6 }}
        >
          {tip.lines.map((l, i) => (
            <div key={i} className={i === 0 ? 'font-bold' : ''}>{l}</div>
          ))}
        </div>
      )}
```

(h) Import `GradebookCell` and `GradebookAssignmentCol` types (already imported) — confirm `GradebookAssignmentCol` is in the import on line 25 (it is).

- [ ] **Step 4: Run the tests to verify they PASS**

Run: `npx vitest run "src/app/(teacher)/gradebook/_components/__tests__/GradebookGrid.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Append draft strings to `STRINGS-FOR-BARB.md`**

Under a `## Gradebook` section (create if absent), add:
```markdown
### Gradebook dates + trend (DRAFT — 2026-06-23)
- Column header subline: "Assigned {Mon D} · Due {Mon D}" (DRAFT)
- Cell tooltip lines: "{Assignment name}" / "Turned in {Mon D} (on time|late)" / "Not turned in yet" / "Due {Mon D}" (DRAFT)
- Window control: "Show earlier" / "Show recent only" (DRAFT)
```

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` → 0 errors.
```bash
git add "src/app/(teacher)/gradebook/_components/GradebookGrid.tsx" "src/app/(teacher)/gradebook/_components/__tests__/GradebookGrid.test.tsx" STRINGS-FOR-BARB.md
git commit -m "feat(gradebook): windowed chronological columns + Show earlier + header dates + cell tooltip"
```

---

## Task 6: GET `/api/teacher/gradebook/trend` route

**Files:**
- Create: `src/app/api/teacher/gradebook/trend/route.ts`
- Test: `src/app/api/teacher/gradebook/trend/__tests__/route.test.ts` (NEW)

**Interfaces:**
- Consumes: `loadStudentGradeTrend` (Task 3), the auth chain (`createServerSupabaseClient`, `auth.getUser`, `guardStudentAccess`, `createAdminSupabaseClient`).
- Produces: `GET /api/teacher/gradebook/trend?studentId=<uuid>&classId=<uuid>` → `200 { points, direction, latest, average }` | `401` | `400` (missing params) | guard response (IDOR).

- [ ] **Step 1: Write the failing test (auth + shape; mock the deps)**

Create `src/app/api/teacher/gradebook/trend/__tests__/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const guard = vi.fn();
const load = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({}),
}));
vi.mock('@/lib/auth/guards', () => ({ guardStudentAccess: (...a: unknown[]) => guard(...a) }));
vi.mock('@/lib/gradebook/loadStudentGradeTrend', () => ({ loadStudentGradeTrend: (...a: unknown[]) => load(...a) }));

import { GET } from '../route';

function req(url: string) { return new Request(url) as unknown as import('next/server').NextRequest; }

beforeEach(() => {
  getUser.mockReset(); guard.mockReset(); load.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 't1' } }, error: null });
  guard.mockResolvedValue(null);
  load.mockResolvedValue({ points: [{ date: 'd', grade: 80, assignment_title: 'L', on_time: true }], direction: null, latest: 80, average: 80 });
});

describe('GET /api/teacher/gradebook/trend', () => {
  it('401 when unauthenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(req('http://x/api?studentId=s1&classId=c1'));
    expect(res.status).toBe(401);
  });
  it('400 when studentId or classId missing', async () => {
    const res = await GET(req('http://x/api?studentId=s1'));
    expect(res.status).toBe(400);
  });
  it('returns the guard response on IDOR failure', async () => {
    guard.mockResolvedValue(new Response('no', { status: 403 }));
    const res = await GET(req('http://x/api?studentId=s1&classId=c1'));
    expect(res.status).toBe(403);
    expect(load).not.toHaveBeenCalled();
  });
  it('200 with the trend payload on success', async () => {
    const res = await GET(req('http://x/api?studentId=s1&classId=c1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.points).toHaveLength(1);
    expect(guard).toHaveBeenCalledWith('s1');
  });
});
```

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `npx vitest run "src/app/api/teacher/gradebook/trend/__tests__/route.test.ts"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route** (mirror the auth pattern of the sibling `gradebook/override/route.ts` and `assignments/generate/route.ts`)

Create `src/app/api/teacher/gradebook/trend/route.ts`:
```ts
// src/app/api/teacher/gradebook/trend/route.ts
// GET /api/teacher/gradebook/trend?studentId=&classId=
// Per-student grade-over-time trend for the drill-in + profile sparkline.
// Auth chain: getUser → 401; guardStudentAccess(studentId) → guard response (IDOR — RLS is NOT
// the backstop on the admin client). Then admin client reads via loadStudentGradeTrend.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardStudentAccess } from '@/lib/auth/guards';
import { loadStudentGradeTrend } from '@/lib/gradebook/loadStudentGradeTrend';

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get('studentId');
  const classId = searchParams.get('classId');
  if (!studentId || !classId) {
    return NextResponse.json({ error: 'Missing studentId or classId' }, { status: 400 });
  }

  const guard = await guardStudentAccess(studentId);
  if (guard) return guard;

  const admin = createAdminSupabaseClient();
  const trend = await loadStudentGradeTrend(admin, { studentId, classId });
  return NextResponse.json(trend);
}
```
> Verify the sibling `override/route.ts` uses this same auth chain; if it guards with a different helper (e.g. `guardClassAccess`), match the established gradebook pattern instead — the goal is consistency with the existing gradebook routes.

- [ ] **Step 4: Run the test to verify it PASSES**

Run: `npx vitest run "src/app/api/teacher/gradebook/trend/__tests__/route.test.ts"`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → 0 errors.
```bash
git add "src/app/api/teacher/gradebook/trend/route.ts" "src/app/api/teacher/gradebook/trend/__tests__/route.test.ts"
git commit -m "feat(gradebook): GET trend route — per-student grade trend behind the auth chain"
```

---

## Task 7: Drill-in — fetch + render the compact sparkline

**Files:**
- Modify: `src/app/(teacher)/gradebook/_components/GradebookDrillIn.tsx`
- Modify: `src/app/(teacher)/gradebook/_components/GradebookGrid.tsx` (pass `studentId` + `classId` into the selection)
- Test: `src/app/(teacher)/gradebook/_components/__tests__/GradebookDrillIn.test.tsx` (UPDATE if present, else CREATE)
- Modify: `STRINGS-FOR-BARB.md` (`## Gradebook`)

**Interfaces:**
- Consumes: `GradeTrendSparkline` (Task 4), `GET /api/teacher/gradebook/trend` (Task 6), `StudentGradeTrend` type (Task 3).
- Produces: `GradebookDrillInSelection` gains `studentId: string` and `classId: string`. `Selection` in the grid gains the same. The drill-in fetches the trend on open and renders the sparkline between the grade breakdown and the effort line.

- [ ] **Step 1: Write the failing test**

Create/extend `src/app/(teacher)/gradebook/_components/__tests__/GradebookDrillIn.test.tsx`:
```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { GradebookDrillIn } from '../GradebookDrillIn';
import type { GradebookCell } from '@/lib/gradebook/loadGradebook';

beforeEach(() => vi.restoreAllMocks());

const baseCell: GradebookCell = {
  attempt_id: 'h1', status: 'graded', displayed_grade: 88, score_pct: 88,
  effort_label: null, teacher_notes: null, submitted_at: '2026-06-09T00:00:00Z',
  is_override: false, submitted_on_time: true, allow_redo: false,
};
const selected = {
  studentName: 'Ana Diaz', studentId: 's1', classId: 'c1',
  col: { assignment_key: 'k', title: 'Fractions', due_at: null, assigned_at: null },
  cell: baseCell,
};

describe('GradebookDrillIn — grade trend', () => {
  it('fetches the trend on open and renders the sparkline when there are ≥2 points', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      points: [{ date: 'd1', grade: 70, assignment_title: 'L', on_time: true }, { date: 'd2', grade: 90, assignment_title: 'L', on_time: true }],
      direction: 'climbing', latest: 90, average: 80,
    }), { status: 200 })));
    render(<GradebookDrillIn selected={selected as never} onClose={() => {}} onWrite={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('grade-trend-sparkline')).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/teacher/gradebook/trend?studentId=s1&classId=c1'));
  });

  it('shows the cold-start message when fewer than 2 points', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ points: [{ date: 'd', grade: 80, assignment_title: 'L', on_time: true }], direction: null, latest: 80, average: 80 }), { status: 200 })));
    render(<GradebookDrillIn selected={selected as never} onClose={() => {}} onWrite={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('trend-cold-start')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify it FAILS**

Run: `npx vitest run "src/app/(teacher)/gradebook/_components/__tests__/GradebookDrillIn.test.tsx"`
Expected: FAIL — `studentId`/`classId` not on the selection type; no sparkline fetch.

- [ ] **Step 3: Thread `studentId`/`classId` through the grid**

In `GradebookGrid.tsx`:
- Extend the `Selection` interface:
```ts
interface Selection {
  studentName: string;
  studentId: string;
  classId: string;
  col: GradebookAssignmentCol;
  cell: DrillInCell;
}
```
- In the cell `onClick`, include the ids (the grid has `s.student_id` and `data.class_id`):
```ts
                          onClick={() => setSelected({ studentName: s.name, studentId: s.student_id, classId: data.class_id, col, cell: toDrillCell(safeCell) })}
```

- [ ] **Step 4: Implement the drill-in trend**

In `GradebookDrillIn.tsx`:
- Extend the selection type:
```ts
export interface GradebookDrillInSelection {
  studentName: string;
  studentId: string;
  classId: string;
  col: GradebookAssignmentCol;
  cell: DrillInCell;
}
```
- Add imports:
```ts
import { GradeTrendSparkline } from '@/components/core/GradeTrendSparkline';
import type { StudentGradeTrend } from '@/lib/gradebook/loadStudentGradeTrend';
```
- Add a plain-language direction phrase helper (banned-word-free; DRAFT → Barb), near `submittedDateLabel`:
```ts
function trendDirectionPhrase(d: StudentGradeTrend['direction']): string {
  if (d === 'climbing') return 'Climbing over the last few.';
  if (d === 'sliding') return 'Slipping a little lately.';
  if (d === 'steady') return 'Holding steady lately.';
  return 'Grades over time';
}
```
- Inside the component, destructure `studentId, classId` from `selected` and fetch the trend on open:
```ts
  const { studentName, studentId, classId, col, cell } = selected;
  const [trend, setTrend] = useState<StudentGradeTrend | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/teacher/gradebook/trend?studentId=${encodeURIComponent(studentId)}&classId=${encodeURIComponent(classId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((t) => { if (live) setTrend(t); })
      .catch(() => { if (live) setTrend(null); });
    return () => { live = false; };
  }, [studentId, classId]);
```
- Render the sparkline section between the grade breakdown and the effort line (after the `is_override ? ... : ...` grade block, before `{effortPhrase && ...}`):
```tsx
        {/* Grade trend — this student's graded assignments over time (teacher-only; earned grades). */}
        {trend && (
          <div className="flex flex-col gap-1 border-t-2 border-sidebar-edge pt-4">
            <p className="text-sm font-bold text-fg">{trendDirectionPhrase(trend.direction)}</p>
            <GradeTrendSparkline
              size="sm"
              points={trend.points.map((p) => ({ date: p.date, grade: p.grade, label: `${p.assignment_title} · ${p.grade}%` }))}
              ariaLabel={`${studentName}'s grades over time${trend.latest != null ? `, latest ${trend.latest} percent` : ''}`}
              coldStartLabel="Not enough graded work yet to show a trend."
            />
          </div>
        )}
```

- [ ] **Step 5: Run to verify it PASSES**

Run: `npx vitest run "src/app/(teacher)/gradebook/_components/__tests__/GradebookDrillIn.test.tsx" "src/app/(teacher)/gradebook/_components/__tests__/GradebookGrid.test.tsx"`
Expected: PASS (both files).

- [ ] **Step 6: Append draft strings + typecheck + commit**

Add to `STRINGS-FOR-BARB.md` `## Gradebook`:
```markdown
- Drill-in trend direction: "Climbing over the last few." / "Slipping a little lately." / "Holding steady lately." / "Grades over time" (DRAFT)
- Drill-in trend cold-start: "Not enough graded work yet to show a trend." (DRAFT)
```
Run: `npx tsc --noEmit` → 0 errors.
```bash
git add "src/app/(teacher)/gradebook/_components/GradebookDrillIn.tsx" "src/app/(teacher)/gradebook/_components/GradebookGrid.tsx" "src/app/(teacher)/gradebook/_components/__tests__/GradebookDrillIn.test.tsx" STRINGS-FOR-BARB.md
git commit -m "feat(gradebook): drill-in grade-over-time sparkline + direction note"
```

---

## Task 8: Student profile — "Grades over time" section

**Files:**
- Modify: `src/app/(teacher)/students/[studentId]/page.tsx`
- Create: `src/app/(teacher)/students/[studentId]/_components/GradeTrendSection.tsx` (client island wrapping the shared sparkline)
- Test: `src/app/(teacher)/students/[studentId]/_components/__tests__/GradeTrendSection.test.tsx` (NEW)

**Interfaces:**
- Consumes: `loadStudentGradeTrend` (Task 3, called server-side in the page), `GradeTrendSparkline` (Task 4), `StudentGradeTrend` (Task 3).
- Produces: a `GradeTrendSection` client component (`{ trend: StudentGradeTrend; studentName: string }`) rendered in the RIGHT column of the profile page. The page needs `classId` — it already reads `?class` from `searchParams` (`const { from, class: classId } = await searchParams;`). When `classId` is absent, the section is not rendered (the trend is class-scoped).

- [ ] **Step 1: Write the failing test**

Create `src/app/(teacher)/students/[studentId]/_components/__tests__/GradeTrendSection.test.tsx`:
```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GradeTrendSection } from '../GradeTrendSection';
import { hasBannedWord } from '@/lib/copy/leakGuard';

describe('GradeTrendSection', () => {
  it('renders the sparkline + a heading when there are points', () => {
    const trend = { points: [{ date: 'd1', grade: 70, assignment_title: 'L', on_time: true }, { date: 'd2', grade: 90, assignment_title: 'L', on_time: true }], direction: 'climbing' as const, latest: 90, average: 80 };
    const { container } = render(<GradeTrendSection trend={trend} studentName="Ana" />);
    expect(screen.getByText(/grades over time/i)).toBeInTheDocument();
    expect(screen.getByTestId('grade-trend-sparkline')).toBeInTheDocument();
    // heading prose is banned-word-free
    expect(hasBannedWord(screen.getByText(/grades over time/i).textContent ?? '')).toBe(false);
    expect(container).toBeTruthy();
  });
  it('renders cold-start under 2 points', () => {
    const trend = { points: [{ date: 'd', grade: 80, assignment_title: 'L', on_time: true }], direction: null, latest: 80, average: 80 };
    render(<GradeTrendSection trend={trend} studentName="Ana" />);
    expect(screen.getByTestId('trend-cold-start')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it FAILS**

Run: `npx vitest run "src/app/(teacher)/students/[studentId]/_components/__tests__/GradeTrendSection.test.tsx"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the section component**

Create `src/app/(teacher)/students/[studentId]/_components/GradeTrendSection.tsx`:
```tsx
'use client';
// Student profile "Grades over time" — fuller (md) grade sparkline. Teacher-only (earned grades).
// Distinct from the rail's "Growing" snapshot card: this is assignment-by-assignment, by graded date.
import React from 'react';
import { GradeTrendSparkline } from '@/components/core/GradeTrendSparkline';
import { SectionLabel } from '../../../_components/SectionLabel';
import type { StudentGradeTrend } from '@/lib/gradebook/loadStudentGradeTrend';

function directionPhrase(d: StudentGradeTrend['direction']): string {
  if (d === 'climbing') return 'Climbing across recent assignments.';
  if (d === 'sliding') return 'Slipping a little across recent assignments.';
  if (d === 'steady') return 'Holding steady across recent assignments.';
  return '';
}

export function GradeTrendSection({ trend, studentName }: { trend: StudentGradeTrend; studentName: string }): React.JSX.Element {
  const phrase = directionPhrase(trend.direction);
  return (
    <section className="flex flex-col gap-2">
      <h2><SectionLabel tone="brand">Grades over time</SectionLabel></h2>
      {phrase && <p className="text-fg text-[13px] leading-snug">{phrase}</p>}
      <GradeTrendSparkline
        size="md"
        points={trend.points.map((p) => ({ date: p.date, grade: p.grade, label: `${p.assignment_title} · ${p.grade}%` }))}
        ariaLabel={`${studentName}'s grades over time${trend.latest != null ? `, latest ${trend.latest} percent` : ''}`}
        coldStartLabel="Not enough graded work yet to show a trend."
      />
    </section>
  );
}

export default GradeTrendSection;
```

- [ ] **Step 4: Wire it into the profile page**

In `src/app/(teacher)/students/[studentId]/page.tsx`:
- Add imports:
```ts
import { loadStudentGradeTrend } from '@/lib/gradebook/loadStudentGradeTrend';
import { GradeTrendSection } from './_components/GradeTrendSection';
```
- Load the trend alongside signals (only when a class is in context). Replace the `Promise.all` block:
```ts
  const admin = createAdminSupabaseClient();
  const [signals, identity, gradeTrend] = await Promise.all([
    loadStudentSignals(admin, studentId),
    loadStudentIdentity(admin, studentId),
    classId ? loadStudentGradeTrend(admin, { studentId, classId }) : Promise.resolve(null),
  ]);
```
- Render the section in the RIGHT column, immediately after the Skill Map `<section>` (before "A pattern worth knowing"):
```tsx
          {gradeTrend && <GradeTrendSection trend={gradeTrend} studentName={fullName} />}
```

- [ ] **Step 5: Run to verify it PASSES**

Run: `npx vitest run "src/app/(teacher)/students/[studentId]/_components/__tests__/GradeTrendSection.test.tsx"`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` → 0 errors.
```bash
git add "src/app/(teacher)/students/[studentId]/page.tsx" "src/app/(teacher)/students/[studentId]/_components/GradeTrendSection.tsx" "src/app/(teacher)/students/[studentId]/_components/__tests__/GradeTrendSection.test.tsx"
git commit -m "feat(gradebook): student profile Grades-over-time trend section"
```

---

## Final verification (whole branch, before review)

- [ ] `npm test` — entire suite green (no regressions; new tests counted).
- [ ] `npx tsc --noEmit` — 0 errors.
- [ ] `npm run build` — 0 errors (production type pass).
- [ ] `npm run a11y` — WCAG-AA gate green.
- [ ] Whole-branch adversarial review (`scripts/review-package <merge-base> HEAD` → final reviewer).
- [ ] Playwright preview of all new visual surfaces (windowed grid + "Show earlier", header dates, cell tooltip, drill-in sparkline, profile "Grades over time") per the binding propose-only frontend-review workflow — Marvin signs off before merge.
- [ ] Controller applies migration 0018 to NEW CORE only (`pmdzxwppdlnddtnkoarc`) with Marvin's authorization; reseed demo; confirm multiple per-day columns appear for the trial lesson.
