# Teacher Gradebook (Epic 3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 10-line `(teacher)/gradebook/page.tsx` stub with a full class-scoped teacher gradebook — a students × assignments grade grid (with a class average), a separate read-only "Diagnostic checks — not graded" quiz section, and a click-a-cell drill-in that overrides a grade and toggles a reteach.

**Architecture:** A pure `loadGradebook(admin, {classId, teacherId})` loader (mirrors `loadRosterSignals`, no auth, 5 batched queries) feeds a server-component page (`gradebook/page.tsx`, mirrors `roster/page.tsx`'s auth chain + first-class redirect). The page renders three client components (`GradebookGrid`, `DiagnosticChecksSection`, `GradebookDrillIn`); the drill-in writes via a single `POST /api/teacher/gradebook/override` route (auth chain + IDOR re-checked server-side). No DB migration.

**Tech Stack:** Next.js 16 App Router (async `searchParams`, Server Components, `after()` from `next/server`), React 19, TypeScript, Tailwind v4 (token-only), Supabase (`@supabase/supabase-js`), Vitest 4 (`node` for logic/routes; `jsdom` + `@/test/setup-dom` for components).

**Spec:** `docs/superpowers/specs/2026-06-22-teacher-gradebook-design.md` (every fact verified 2026-06-22). Read it alongside this plan — the spec carries the full rationale; this plan carries the build steps.

## Global Constraints

(Every task's requirements implicitly include this section. Values copied verbatim from the spec.)

- **No migration.** All columns exist: `homework_attempts.teacher_score numeric`, `.teacher_notes text` (0004), `.allow_redo boolean` (0011). The per-attempt override reason is stored in `teacher_notes` (there is **no** `teacher_override_reason` on `homework_attempts`).
- **Override-wins (the one grade semantic):** `displayedGrade = teacher_score ?? score_pct`. An override writes **only** `teacher_score` (+ `teacher_notes`); it **NEVER** mutates `score_pct` and **NEVER** changes `status`. Clearing an override = `teacher_score = null`.
- **Auth chain (page AND route):** `createServerSupabaseClient()` → `auth.getUser()` (401) → STAFF_ROLES gate (route) / `(teacher)` layout (page) → `guardClassAccess(classId)` IDOR → `createAdminSupabaseClient()` (RLS-bypassed; the guard is the ONLY IDOR backstop). Import the canonical `STAFF_ROLES` from `@/lib/auth/roles` — do NOT redeclare a local Set.
- **Class average = assignment cells only.** Quizzes are NEVER in any average. A cell counts iff it has a non-null `displayedGrade` (statuses `graded`/`redo`/`redo_in_progress`). `submitted`/`missing`/`not_due`/`none` are excluded (not zero-filled). Empty denominator → render `—`, never `0%`/`NaN`.
- **Two leak guards — apply the right one:** count-bearing teacher prose (missing-work summary, "Class average" label, date-derived column headers, drill-in grade breakdown) → `hasBannedWord`/`assertNoBannedWord` ONLY (a digit would throw `assertNoLeak`). Number-free prose (effort phrases, diagnostic caption, empty states) → BOTH `assertNoLeak` and `assertNoBannedWord`. Banned words: `score, percentile, index, divergence, threshold, signal, model, algorithm, flag` (`risk` allowed).
- **"Assignments" never "Homework"** in UI copy. Raw mastery_band enum is NEVER rendered directly — always via `MasteryLabel`/`RiskBadge` (`band` prop).
- **Token-only Tailwind v4 + WCAG-AA:** no hardcoded hex, no arbitrary `[var(--..)]`; content text `text-fg` (deep-ink); status is glyph + token-tone, never color alone. Card `tone ∈ {surface,brand,ok,warn,risk}`; SectionLabel `tone ∈ {brand,ok,warn,risk,lime}` — do not cross them.
- **All user-facing strings are DRAFTS → `STRINGS-FOR-BARB.md`** (Barb gates).
- **Tests:** component test files start with `// @vitest-environment jsdom` then `import '@/test/setup-dom';`. Single file: `npx vitest run <path>`.

---

## File Structure

- **Create** `src/lib/copy/effortLabelPhrase.ts` — pure teacher-safe phrase for the four real effort-label enum values (Task 1).
- **Create** `src/lib/gradebook/loadGradebook.ts` — the loader + all `Gradebook*` types (Task 2).
- **Create** `src/app/api/teacher/gradebook/override/route.ts` — the override/reteach POST route (Task 3).
- **Create** `src/app/(teacher)/gradebook/_components/GradebookGrid.tsx` — the grid (Task 4).
- **Create** `src/app/(teacher)/gradebook/_components/DiagnosticChecksSection.tsx` — the quiz section (Task 5).
- **Create** `src/app/(teacher)/gradebook/_components/GradebookDrillIn.tsx` — the drill-in panel + override submit (Task 6).
- **Modify** `src/app/(teacher)/gradebook/page.tsx` — replace the stub (Task 7).
- **Tests** alongside each (`__tests__/` for the loader/route/components; `effortLabelPhrase.test.ts` next to the helper).

---

## Task 1: `effortLabelPhrase` copy helper

**Files:**
- Create: `src/lib/copy/effortLabelPhrase.ts`
- Test: `src/lib/copy/__tests__/effortLabelPhrase.test.ts`

**Interfaces:**
- Consumes: `EffortLabel`, `EFFORT_LABELS` from `@/lib/signals/computeEffortLabel`; `assertNoLeak`, `assertNoBannedWord`, `hasLeak`, `hasBannedWord` from `@/lib/copy/leakGuard`.
- Produces: `effortLabelPhrase(label: EffortLabel | null): string | null`.

- [ ] **Step 1: Write the failing test** — `src/lib/copy/__tests__/effortLabelPhrase.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { effortLabelPhrase } from '@/lib/copy/effortLabelPhrase';
import { EFFORT_LABELS } from '@/lib/signals/computeEffortLabel';
import { hasLeak, hasBannedWord } from '@/lib/copy/leakGuard';

describe('effortLabelPhrase', () => {
  it('maps each of the four real enum values to a non-empty phrase', () => {
    for (const label of EFFORT_LABELS) {
      const phrase = effortLabelPhrase(label);
      expect(phrase, label).toBeTruthy();
      expect(typeof phrase).toBe('string');
    }
  });
  it('returns null for a null label (ungraded — no phrase yet)', () => {
    expect(effortLabelPhrase(null)).toBeNull();
  });
  it('every phrase is number-free and banned-word-free (both guards)', () => {
    for (const label of EFFORT_LABELS) {
      const phrase = effortLabelPhrase(label)!;
      expect(hasLeak(phrase), `leak in ${label}: ${phrase}`).toBe(false);
      expect(hasBannedWord(phrase), `banned word in ${label}: ${phrase}`).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/copy/__tests__/effortLabelPhrase.test.ts`
Expected: FAIL — `effortLabelPhrase` is not defined / module not found.

- [ ] **Step 3: Write minimal implementation** — `src/lib/copy/effortLabelPhrase.ts`

```ts
// src/lib/copy/effortLabelPhrase.ts
// Teacher-safe coach-posture phrase for a homework attempt's effort_label.
// Keyed on the REAL four computeEffortLabel enum values (NOT effortPhrase.ts, which
// keys on a different 'low|medium|high|inconsistent' enum and never matches the stored value).
// DRAFT copy → Barb (STRINGS-FOR-BARB.md). Phrases are number-free → both guards run.
import { type EffortLabel } from '@/lib/signals/computeEffortLabel';
import { assertNoLeak, assertNoBannedWord } from '@/lib/copy/leakGuard';

const PHRASES: Record<EffortLabel, string> = {
  effortful_success: 'Worked hard and got there.',
  struggling_trying: 'Putting in real effort while wrestling with this.',
  independent_success: 'Handled this comfortably on their own.',
  independent_struggle: 'Struggled here without reaching for help yet.',
};

export function effortLabelPhrase(label: EffortLabel | null): string | null {
  if (label === null) return null;
  const phrase = PHRASES[label];
  if (!phrase) return null;
  assertNoLeak(phrase, 'effortLabelPhrase');
  assertNoBannedWord(phrase, 'effortLabelPhrase');
  return phrase;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/copy/__tests__/effortLabelPhrase.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/copy/effortLabelPhrase.ts src/lib/copy/__tests__/effortLabelPhrase.test.ts
git commit -m "feat(gradebook): effortLabelPhrase helper keyed on the real effort enum"
```

---

## Task 2: `loadGradebook` loader + types

**Files:**
- Create: `src/lib/gradebook/loadGradebook.ts`
- Test: `src/lib/gradebook/__tests__/loadGradebook.test.ts`

**Interfaces:**
- Consumes: a `SupabaseClient` (admin, RLS-bypassed); does **NO** auth (caller guards).
- Produces: `loadGradebook(admin, { classId, teacherId }): Promise<Gradebook>` and the exported types `Gradebook`, `GradebookStudent`, `GradebookAssignmentCol`, `CellStatus`, `GradebookCell`, `GradebookQuizCol`, `GradebookQuizCell`.

**Reference (verbatim current code to mirror):** `src/lib/signals/loadRosterSignals.ts` — the enrollments query (`.select('student_id, users:student_id(id, full_name, display_name)').eq('class_id', classId).eq('is_active', true)`) and the `['__none__']` empty-`.in()` sentinel.

- [ ] **Step 1: Write the failing test** — `src/lib/gradebook/__tests__/loadGradebook.test.ts`

A fake admin client whose `from(table)` returns a thenable/chainable stub yielding scripted rows. Pattern mirrors the homework-submit route test's supabase mock.

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadGradebook } from '@/lib/gradebook/loadGradebook';

// Scriptable tables.
let ENROLLMENTS: unknown[]; let ASSIGNMENTS: unknown[]; let HW: unknown[];
let QUIZZES: unknown[]; let QUIZ_ATTEMPTS: unknown[];

// Minimal chainable query stub: every filter returns `this`; awaiting yields { data }.
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
    if (t === 'enrollments') return table(() => ENROLLMENTS);
    if (t === 'assignments') return table(() => ASSIGNMENTS);
    if (t === 'homework_attempts') return table(() => HW);
    if (t === 'quizzes') return table(() => QUIZZES);
    if (t === 'quiz_attempts') return table(() => QUIZ_ATTEMPTS);
    return table(() => []);
  },
} as unknown as Parameters<typeof loadGradebook>[0];

beforeEach(() => {
  ENROLLMENTS = [
    { student_id: 's1', users: { id: 's1', full_name: 'Ana Diaz', display_name: null } },
    { student_id: 's2', users: { id: 's2', full_name: 'Ben Cole', display_name: null } },
  ];
  // Per-student fan-out: two students × one logical assignment (shared lesson_id 'L1').
  ASSIGNMENTS = [
    { id: 'a_s1', lesson_id: 'L1', content: {}, due_at: '2026-06-10T00:00:00Z', created_at: '2026-06-01T00:00:00Z', student_id: 's1' },
    { id: 'a_s2', lesson_id: 'L1', content: {}, due_at: '2026-06-10T00:00:00Z', created_at: '2026-06-01T00:00:00Z', student_id: 's2' },
  ];
  HW = [];
  QUIZZES = [{ id: 'q1', title: 'Demo Quiz' }];
  QUIZ_ATTEMPTS = [];
});

describe('loadGradebook', () => {
  it('builds rows from active enrollments and collapses per-student assignments by lesson_id', async () => {
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.students.map(s => s.name)).toEqual(['Ana Diaz', 'Ben Cole']);
    expect(gb.assignments).toHaveLength(1);              // a_s1 + a_s2 collapse to ONE column
    expect(gb.assignments[0].assignment_key).toBe('lesson:L1');
  });

  it('override-wins: displayed_grade = teacher_score ?? score_pct, is_override set', async () => {
    HW = [{ id: 'h1', assignment_id: 'a_s1', student_id: 's1', status: 'graded', score_pct: 70, teacher_score: 90, allow_redo: false, is_redo: false, attempt_no: 1, submitted_on_time: true, graded_at: '2026-06-11T00:00:00Z' }];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    const cell = gb.cells['s1']['lesson:L1'];
    expect(cell.status).toBe('graded');
    expect(cell.displayed_grade).toBe(90);
    expect(cell.is_override).toBe(true);
  });

  it('submitted-but-ungraded is its own status, excluded from the average', async () => {
    HW = [{ id: 'h2', assignment_id: 'a_s1', student_id: 's1', status: 'submitted', score_pct: null, teacher_score: null, allow_redo: false, is_redo: false, attempt_no: 1, submitted_on_time: true, submitted_at: '2026-06-09T00:00:00Z' }];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.cells['s1']['lesson:L1'].status).toBe('submitted');
    expect(gb.cells['s1']['lesson:L1'].displayed_grade).toBeNull();
    expect(gb.column_averages['lesson:L1']).toBeNull(); // nothing graded → excluded
  });

  it('redo_in_progress keeps the prior graded grade visible', async () => {
    HW = [
      { id: 'g1', assignment_id: 'a_s1', student_id: 's1', status: 'graded', score_pct: 80, teacher_score: null, allow_redo: true, is_redo: false, attempt_no: 1, graded_at: '2026-06-11T00:00:00Z' },
      { id: 'g2', assignment_id: 'a_s1', student_id: 's1', status: 'in_progress', score_pct: null, teacher_score: null, allow_redo: false, is_redo: true, attempt_no: 2, created_at: '2026-06-12T00:00:00Z' },
    ];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    const cell = gb.cells['s1']['lesson:L1'];
    expect(cell.status).toBe('redo_in_progress');
    expect(cell.displayed_grade).toBe(80); // prior grade NOT lost
  });

  it('quiz columns key on quiz_id so two students share one column', async () => {
    QUIZ_ATTEMPTS = [
      { id: 'qa1', quiz_id: 'q1', student_id: 's1', score_pct: 88, mastery_band: 'grade_level', is_complete: true, submitted_at: '2026-06-08T00:00:00Z' },
      { id: 'qa2', quiz_id: 'q1', student_id: 's2', score_pct: 60, mastery_band: 'reteach', is_complete: true, submitted_at: '2026-06-08T00:00:00Z' },
    ];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.quizzes).toHaveLength(1);
    expect(gb.quizzes[0].quiz_id).toBe('q1');
    expect(gb.quiz_cells['s1']['q1'].score_pct).toBe(88);
    expect(gb.quiz_cells['s2']['q1'].score_pct).toBe(60);
  });

  it('class_average is the mean of graded cells and excludes quizzes; null when nothing graded', async () => {
    HW = [
      { id: 'h1', assignment_id: 'a_s1', student_id: 's1', status: 'graded', score_pct: 80, teacher_score: null, allow_redo: false, is_redo: false, attempt_no: 1, graded_at: '2026-06-11T00:00:00Z' },
      { id: 'h2', assignment_id: 'a_s2', student_id: 's2', status: 'graded', score_pct: 60, teacher_score: null, allow_redo: false, is_redo: false, attempt_no: 1, graded_at: '2026-06-11T00:00:00Z' },
    ];
    QUIZ_ATTEMPTS = [{ id: 'qa1', quiz_id: 'q1', student_id: 's1', score_pct: 10, mastery_band: 'reteach', is_complete: true, submitted_at: '2026-06-08T00:00:00Z' }];
    const gb = await loadGradebook(admin, { classId: 'c1', teacherId: 't1' });
    expect(gb.class_average).toBe(70);  // (80+60)/2 — quiz 10 NOT included
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/gradebook/__tests__/loadGradebook.test.ts`
Expected: FAIL — module `@/lib/gradebook/loadGradebook` not found.

- [ ] **Step 3: Write minimal implementation** — `src/lib/gradebook/loadGradebook.ts`

```ts
// src/lib/gradebook/loadGradebook.ts
// Pure gradebook loader — NO auth (caller guards via guardClassAccess). Mirrors loadRosterSignals.
// 5 batched queries, no N+1. See spec 2026-06-22-teacher-gradebook-design.md §4.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface GradebookStudent { student_id: string; name: string; }
export interface GradebookAssignmentCol { assignment_key: string; title: string; due_at: string | null; }
export type CellStatus = 'graded' | 'submitted' | 'not_due' | 'missing' | 'redo' | 'redo_in_progress' | 'none';
export interface GradebookCell {
  attempt_id: string | null; status: CellStatus; displayed_grade: number | null;
  is_override: boolean; submitted_on_time: boolean | null; allow_redo: boolean;
}
export interface GradebookQuizCol { quiz_id: string; label: string; }
export interface GradebookQuizCell {
  quiz_attempt_id: string | null; is_complete: boolean; score_pct: number | null;
  mastery_band: 'reteach' | 'grade_level' | 'advanced' | null;
}
export interface Gradebook {
  class_id: string;
  students: GradebookStudent[];
  assignments: GradebookAssignmentCol[];
  cells: Record<string, Record<string, GradebookCell>>;
  class_average: number | null;
  column_averages: Record<string, number | null>;
  missing_count: number;
  quizzes: GradebookQuizCol[];
  quiz_cells: Record<string, Record<string, GradebookQuizCell>>;
}

const NONE = ['__none__'];
const MAX_ASSIGNMENT_COLS = 12;
const MAX_QUIZ_COLS = 8;

type AsgRow = { id: string; lesson_id: string | null; content: Record<string, unknown> | null; due_at: string | null; created_at: string | null; student_id: string };
type HwRow = { id: string; assignment_id: string; student_id: string; status: string; score_pct: number | null; teacher_score: number | null; allow_redo: boolean | null; is_redo: boolean | null; attempt_no: number | null; submitted_on_time: boolean | null; submitted_at: string | null; graded_at: string | null };
type QzRow = { id: string; title: string | null };
type QaRow = { id: string; quiz_id: string; student_id: string; score_pct: number | null; mastery_band: GradebookQuizCell['mastery_band']; is_complete: boolean | null; submitted_at: string | null };

function colKey(a: AsgRow): string {
  if (a.lesson_id) return `lesson:${a.lesson_id}`;
  if (a.due_at) return `due:${a.due_at}`;
  return `id:${a.id}`;
}
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function dueLabel(due_at: string | null, ordinal: number): string {
  if (!due_at) return `Assignment ${ordinal}`;
  const d = new Date(due_at);
  return `Due ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
function latest<T extends { attempt_no?: number | null; submitted_at?: string | null; graded_at?: string | null; created_at?: string | null }>(rows: T[]): T | null {
  if (!rows.length) return null;
  return [...rows].sort((x, y) =>
    (y.attempt_no ?? 0) - (x.attempt_no ?? 0)
    || String(y.graded_at ?? y.submitted_at ?? '').localeCompare(String(x.graded_at ?? x.submitted_at ?? '')))[0];
}

export async function loadGradebook(admin: SupabaseClient, args: { classId: string; teacherId: string }): Promise<Gradebook> {
  const { classId } = args;

  // 1. Roster (rows).
  const { data: enr } = await admin.from('enrollments')
    .select('student_id, users:student_id(id, full_name, display_name)')
    .eq('class_id', classId).eq('is_active', true);
  const students: GradebookStudent[] = ((enr ?? []) as Array<{ student_id: string; users: { full_name?: string; display_name?: string } | null }>)
    .map(e => ({ student_id: e.student_id, name: (e.users?.display_name || e.users?.full_name || 'Student') }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const studentIds = students.map(s => s.student_id);

  // 2. Assignment columns (collapse per-student fan-out).
  const { data: asgData } = await admin.from('assignments')
    .select('id, lesson_id, content, due_at, created_at, student_id')
    .eq('class_id', classId).order('created_at', { ascending: false });
  const asgRows = (asgData ?? []) as AsgRow[];
  const groups = new Map<string, AsgRow[]>();
  for (const a of asgRows) { const k = colKey(a); (groups.get(k) ?? groups.set(k, []).get(k)!).push(a); }
  const colMeta = [...groups.entries()]
    .map(([key, rows]) => ({ key, rows, maxCreated: rows.map(r => r.created_at ?? '').sort().at(-1) ?? '', due_at: rows[0].due_at }))
    .sort((a, b) => b.maxCreated.localeCompare(a.maxCreated))
    .slice(0, MAX_ASSIGNMENT_COLS);
  const assignments: GradebookAssignmentCol[] = colMeta.map((c, i) => ({ assignment_key: c.key, title: dueLabel(c.due_at, i + 1), due_at: c.due_at }));
  // assignment_id → column key (for cell mapping).
  const idToKey = new Map<string, string>();
  for (const c of colMeta) for (const r of c.rows) idToKey.set(r.id, c.key);
  const assignmentIds = [...idToKey.keys()];

  // 3. Attempts (cells).
  const { data: hwData } = await admin.from('homework_attempts')
    .select('id, assignment_id, student_id, status, score_pct, teacher_score, effort_label, teli_hint_count, allow_redo, is_redo, attempt_no, submitted_on_time, submitted_at, graded_at, task_grades, teacher_notes, review_required')
    .in('assignment_id', assignmentIds.length ? assignmentIds : NONE)
    .in('student_id', studentIds.length ? studentIds : NONE);
  const hwRows = (hwData ?? []) as HwRow[];
  // group by (student, colKey)
  const byCell = new Map<string, HwRow[]>();
  for (const h of hwRows) {
    const k = idToKey.get(h.assignment_id); if (!k) continue;
    const id = `${h.student_id}__${k}`; (byCell.get(id) ?? byCell.set(id, []).get(id)!).push(h);
  }
  const now = args && (globalThis as { __NOW__?: number }).__NOW__ ? new Date((globalThis as { __NOW__?: number }).__NOW__!) : new Date();
  const dueByKey = new Map(colMeta.map(c => [c.key, c.due_at]));
  const cells: Gradebook['cells'] = {};
  let missing_count = 0;
  for (const s of students) {
    cells[s.student_id] = {};
    for (const col of assignments) {
      const attempts = byCell.get(`${s.student_id}__${col.assignment_key}`) ?? [];
      const due = dueByKey.get(col.assignment_key) ?? null;
      const past = due ? new Date(due).getTime() < now.getTime() : false;
      const graded = latest(attempts.filter(a => a.status === 'graded'));
      const newest = latest(attempts);
      let status: CellStatus; let displayed_grade: number | null = null; let is_override = false;
      let allow_redo = false; let submitted_on_time: boolean | null = null; let attempt_id: string | null = null;
      if (graded) {
        displayed_grade = (typeof graded.teacher_score === 'number') ? graded.teacher_score : (graded.score_pct ?? null);
        is_override = graded.teacher_score != null; allow_redo = !!graded.allow_redo;
        submitted_on_time = graded.submitted_on_time ?? null; attempt_id = graded.id;
      }
      if (!attempts.length) {
        status = past ? 'missing' : 'not_due';
        if (status === 'missing') missing_count++;
      } else if (graded && newest && newest.status !== 'graded' && (newest.attempt_no ?? 1) > 1) {
        status = 'redo_in_progress';
      } else if (graded && graded.allow_redo) {
        status = 'redo';
      } else if (newest?.status === 'graded') {
        status = 'graded';
      } else {
        status = 'submitted'; attempt_id = newest?.id ?? null;
      }
      cells[s.student_id][col.assignment_key] = { attempt_id, status, displayed_grade, is_override, submitted_on_time, allow_redo };
    }
  }

  // 4. Footers.
  const column_averages: Gradebook['column_averages'] = {};
  const all: number[] = [];
  for (const col of assignments) {
    const vals: number[] = [];
    for (const s of students) {
      const c = cells[s.student_id][col.assignment_key];
      if (c.displayed_grade != null && (c.status === 'graded' || c.status === 'redo' || c.status === 'redo_in_progress')) vals.push(c.displayed_grade);
    }
    column_averages[col.assignment_key] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    all.push(...vals);
  }
  const class_average = all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : null;

  // 5. Quizzes (diagnostic — keyed by quiz_id).
  const { data: qzData } = await admin.from('quizzes').select('id, title').eq('class_id', classId);
  const qzRows = (qzData ?? []) as QzRow[];
  const quizIds = qzRows.map(q => q.id);
  const { data: qaData } = await admin.from('quiz_attempts')
    .select('id, quiz_id, student_id, score_pct, mastery_band, is_complete, submitted_at')
    .in('quiz_id', quizIds.length ? quizIds : NONE)
    .in('student_id', studentIds.length ? studentIds : NONE)
    .order('submitted_at', { ascending: false });
  const qaRows = (qaData ?? []) as QaRow[];
  const usedQuiz = new Set<string>();
  const quiz_cells: Gradebook['quiz_cells'] = {};
  for (const s of students) quiz_cells[s.student_id] = {};
  for (const qa of qaRows) { // first seen per (student, quiz) is latest (ordered desc)
    if (!quiz_cells[qa.student_id]) continue;
    if (quiz_cells[qa.student_id][qa.quiz_id]) continue;
    quiz_cells[qa.student_id][qa.quiz_id] = { quiz_attempt_id: qa.id, is_complete: !!qa.is_complete, score_pct: qa.score_pct ?? null, mastery_band: qa.mastery_band ?? null };
    usedQuiz.add(qa.quiz_id);
  }
  const quizzes: GradebookQuizCol[] = qzRows
    .filter(q => usedQuiz.has(q.id))
    .slice(0, MAX_QUIZ_COLS)
    .map(q => ({ quiz_id: q.id, label: q.title || 'Check' }));

  return { class_id: classId, students, assignments, cells, class_average, column_averages, missing_count, quizzes, quiz_cells };
}
```

> **Implementer note:** the test stub's chainable mock resolves `.in()/.order()` to `{ data }`; keep every query a single awaited chain (no `.maybeSingle()` on list queries). `MONTHS`/`dueLabel` use UTC to stay deterministic. `Date.now()` is real here (this runs server-side, not in a workflow) — fine.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/gradebook/__tests__/loadGradebook.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/gradebook/loadGradebook.ts src/lib/gradebook/__tests__/loadGradebook.test.ts
git commit -m "feat(gradebook): loadGradebook loader (matrix, cell statuses, footers, quiz grid)"
```

---

## Task 3: Override / reteach POST route

**Files:**
- Create: `src/app/api/teacher/gradebook/override/route.ts`
- Test: `src/app/api/teacher/gradebook/override/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `createServerSupabaseClient`, `createAdminSupabaseClient` (`@/lib/supabase/server`); `STAFF_ROLES` (`@/lib/auth/roles`); `guardClassAccess` (`@/lib/auth/guards`); `recomputeSkillStatesForStudent` (`@/lib/skills/recomputeSkillStates`); `after` (`next/server`).
- Produces: `POST` handler. Request `{ attempt_id, teacher_score?, teacher_notes?, allow_redo? }`. Response per spec §8.2.

**Reference:** the auth-chain call-site in `src/app/api/attempts/homework-tutor/route.ts` (getUser → admin → ownership) and `homework-submit/route.ts:135` (`after()` + `recomputeSkillStatesForStudent`).

- [ ] **Step 1: Write the failing test** — `src/app/api/teacher/gradebook/override/__tests__/route.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const guardClassAccess = vi.fn();
const recompute = vi.fn().mockResolvedValue(undefined);
const updates: Array<Record<string, unknown>> = [];
let ATTEMPT: unknown; let ROLE: string; let ASG: unknown;

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (cb: () => void) => { void Promise.resolve().then(cb); } }));
vi.mock('@/lib/auth/roles', () => ({ STAFF_ROLES: new Set(['teacher', 'school_admin', 'sysadmin', 'platform_admin']) }));
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess }));
vi.mock('@/lib/skills/recomputeSkillStates', () => ({ recomputeSkillStatesForStudent: recompute }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'users') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: ROLE } }) }) }) };
      if (t === 'assignments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ASG }) }) }) };
      return { // homework_attempts
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ATTEMPT }) }) }),
        update: (p: Record<string, unknown>) => { updates.push(p); return { eq: async () => ({ error: null }) }; },
      };
    },
  }),
}));

const req = (b: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(b) });
async function load() { vi.resetModules(); return (await import('@/app/api/teacher/gradebook/override/route')).POST; }

beforeEach(() => {
  getUser.mockReset(); guardClassAccess.mockReset(); recompute.mockClear(); updates.length = 0;
  ROLE = 'teacher'; ASG = { class_id: 'c1' };
  ATTEMPT = { id: 'h1', assignment_id: 'a1', student_id: 's1', status: 'graded', score_pct: 70, teacher_score: null };
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  guardClassAccess.mockResolvedValue(null); // access granted
});

describe('POST /api/teacher/gradebook/override', () => {
  it('401 without a user', async () => { getUser.mockResolvedValue({ data: { user: null } }); expect((await (await load())(req({ attempt_id: 'h1', teacher_score: 90 }))).status).toBe(401); });
  it('403 for a non-staff role', async () => { ROLE = 'student'; expect((await (await load())(req({ attempt_id: 'h1', teacher_score: 90 }))).status).toBe(403); });
  it('403 when guardClassAccess denies (cross-teacher IDOR)', async () => { guardClassAccess.mockResolvedValue(new Response(null, { status: 403 })); expect((await (await load())(req({ attempt_id: 'h1', teacher_score: 90 }))).status).toBe(403); });
  it('404 when the attempt is not found', async () => { ATTEMPT = null; expect((await (await load())(req({ attempt_id: 'h1', teacher_score: 90 }))).status).toBe(404); });
  it('400 on a score out of [0,100]', async () => { expect((await (await load())(req({ attempt_id: 'h1', teacher_score: 150 }))).status).toBe(400); });
  it('400 on an empty body (no fields)', async () => { expect((await (await load())(req({ attempt_id: 'h1' }))).status).toBe(400); });
  it('409 when a GRADE override targets a non-graded attempt', async () => { ATTEMPT = { id: 'h1', assignment_id: 'a1', student_id: 's1', status: 'in_progress', score_pct: null, teacher_score: null }; expect((await (await load())(req({ attempt_id: 'h1', teacher_score: 90 }))).status).toBe(409); });
  it('allows allow_redo on a non-graded attempt (no 409)', async () => { ATTEMPT = { id: 'h1', assignment_id: 'a1', student_id: 's1', status: 'in_progress', score_pct: null, teacher_score: null }; expect((await (await load())(req({ attempt_id: 'h1', allow_redo: true }))).status).toBe(200); });
  it('writes teacher_score, never touches score_pct or status, returns displayed_grade', async () => {
    const res = await (await load())(req({ attempt_id: 'h1', teacher_score: 90, teacher_notes: 'nice work' }));
    expect(res.status).toBe(200);
    expect((await res.json()).displayed_grade).toBe(90);
    const p = updates[0];
    expect(p.teacher_score).toBe(90); expect(p.teacher_notes).toBe('nice work');
    expect('score_pct' in p).toBe(false); expect('status' in p).toBe(false);
  });
  it('clearing sets teacher_score=null → displayed_grade falls back to score_pct', async () => {
    const res = await (await load())(req({ attempt_id: 'h1', teacher_score: null }));
    expect((await res.json()).displayed_grade).toBe(70);
    expect(updates[0].teacher_score).toBeNull();
  });
  it('400 on teacher_notes over the length bound', async () => { expect((await (await load())(req({ attempt_id: 'h1', teacher_notes: 'x'.repeat(2001) }))).status).toBe(400); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/teacher/gradebook/override/__tests__/route.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Write minimal implementation** — `src/app/api/teacher/gradebook/override/route.ts`

```ts
// src/app/api/teacher/gradebook/override/route.ts
// POST — teacher/admin grade override + reteach toggle. Auth chain re-checked server-side.
// Never mutates score_pct or status (override-wins is teacher_score ?? score_pct). Spec §8.2.
import { NextResponse, after } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';
import { recomputeSkillStatesForStudent } from '@/lib/skills/recomputeSkillStates';

type Body = { attempt_id?: string; teacher_score?: number | null; teacher_notes?: string | null; allow_redo?: boolean };
const MAX_NOTES = 2000;

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: Body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || !body.attempt_id) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

    const hasScore = 'teacher_score' in body;
    const hasNotes = 'teacher_notes' in body;
    const hasRedo = 'allow_redo' in body;
    if (!hasScore && !hasNotes && !hasRedo) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    if (hasScore && body.teacher_score != null && (!Number.isFinite(body.teacher_score) || body.teacher_score < 0 || body.teacher_score > 100))
      return NextResponse.json({ error: 'invalid_score' }, { status: 400 });
    if (hasNotes && body.teacher_notes != null && (typeof body.teacher_notes !== 'string' || body.teacher_notes.length > MAX_NOTES))
      return NextResponse.json({ error: 'invalid_notes' }, { status: 400 });

    const admin = createAdminSupabaseClient();
    const { data: roleRow } = await admin.from('users').select('role').eq('id', user.id).maybeSingle();
    const role = (roleRow as { role?: string } | null)?.role;
    if (!role || !STAFF_ROLES.has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: attemptRow } = await admin.from('homework_attempts')
      .select('id, assignment_id, student_id, status, score_pct, teacher_score').eq('id', body.attempt_id).maybeSingle();
    const attempt = attemptRow as { id: string; assignment_id: string; student_id: string; status: string; score_pct: number | null; teacher_score: number | null } | null;
    if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    const { data: asgRow } = await admin.from('assignments').select('class_id').eq('id', attempt.assignment_id).maybeSingle();
    const asg = asgRow as { class_id: string } | null;
    if (!asg) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });

    const guard = await guardClassAccess(asg.class_id);
    if (guard) return guard;

    // 409 only when a GRADE override targets a non-graded attempt.
    if (hasScore && body.teacher_score != null && attempt.status !== 'graded')
      return NextResponse.json({ error: 'not_graded' }, { status: 409 });

    const patch: Record<string, unknown> = {};
    if (hasScore) patch.teacher_score = body.teacher_score;
    if (hasNotes) patch.teacher_notes = body.teacher_notes;
    if (hasRedo) patch.allow_redo = body.allow_redo;
    await admin.from('homework_attempts').update(patch).eq('id', attempt.id);

    after(async () => {
      try { await recomputeSkillStatesForStudent(admin, { studentId: attempt.student_id, schoolId: null }); }
      catch (err) { console.warn('[gradebook-override] recompute failed (non-fatal):', err); }
    });

    const newScore = hasScore ? body.teacher_score : attempt.teacher_score;
    const displayed_grade = (typeof newScore === 'number') ? newScore : (attempt.score_pct ?? null);
    return NextResponse.json({ ok: true, attempt_id: attempt.id, displayed_grade });
  } catch (err) {
    console.error('[gradebook-override] error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/teacher/gradebook/override/__tests__/route.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/teacher/gradebook/override/route.ts src/app/api/teacher/gradebook/override/__tests__/route.test.ts
git commit -m "feat(gradebook): override/reteach POST route (auth chain, IDOR, graded-integrity)"
```

---

## Task 4: `GradebookGrid` component

**Files:**
- Create: `src/app/(teacher)/gradebook/_components/GradebookGrid.tsx`
- Test: `src/app/(teacher)/gradebook/_components/__tests__/GradebookGrid.test.tsx`

**Interfaces:**
- Consumes: `Gradebook`, `GradebookCell`, `CellStatus` (`@/lib/gradebook/loadGradebook`); the `GradebookDrillIn` (Task 6) opened via local state; `SectionLabel`, `Card`, `SummaryCallout` from `@/components/core/*`.
- Produces: `<GradebookGrid data={Gradebook} classId={string} />` (default export + named). Owns drill-in open state (`selectedCell`). Renders glyph **and** grade per cell, sticky student column, class-average footer over assignment columns, missing-work summary.

- [ ] **Step 1: Write the failing test** — `__tests__/GradebookGrid.test.tsx`

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { hasBannedWord } from '@/lib/copy/leakGuard';
import { GradebookGrid } from '../GradebookGrid';
import type { Gradebook } from '@/lib/gradebook/loadGradebook';

const data: Gradebook = {
  class_id: 'c1',
  students: [{ student_id: 's1', name: 'Ana Diaz' }, { student_id: 's2', name: 'Ben Cole' }],
  assignments: [{ assignment_key: 'due:d1', title: 'Due Jun 10', due_at: '2026-06-10T00:00:00Z' }],
  cells: {
    s1: { 'due:d1': { attempt_id: 'h1', status: 'graded', displayed_grade: 88, is_override: false, submitted_on_time: true, allow_redo: false } },
    s2: { 'due:d1': { attempt_id: null, status: 'missing', displayed_grade: null, is_override: false, submitted_on_time: null, allow_redo: false } },
  },
  class_average: 88, column_averages: { 'due:d1': 88 }, missing_count: 1,
  quizzes: [], quiz_cells: { s1: {}, s2: {} },
};

describe('GradebookGrid', () => {
  it('renders a glyph AND grade for graded, and the miss label for missing', () => {
    render(<GradebookGrid data={data} classId="c1" />);
    expect(screen.getByText(/88/)).toBeInTheDocument();          // grade digit
    expect(screen.getByText('✓')).toBeInTheDocument();           // graded glyph
    expect(screen.getByText(/miss/i)).toBeInTheDocument();       // missing label (not color-only)
  });
  it('every graded/missing cell is a button with an aria-label (WCAG, not color-only)', () => {
    render(<GradebookGrid data={data} classId="c1" />);
    const cellBtn = screen.getByRole('button', { name: /Ana Diaz.*Due Jun 10/i });
    expect(cellBtn).toBeInTheDocument();
  });
  it('renders the class-average footer and a missing-work summary with no banned words', () => {
    render(<GradebookGrid data={data} classId="c1" />);
    expect(screen.getByText(/Class average/i)).toBeInTheDocument();
    const summary = screen.getByTestId('missing-summary').textContent || '';
    expect(hasBannedWord(summary)).toBe(false); // count-bearing → hasBannedWord, NOT hasLeak
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/(teacher)/gradebook/_components/__tests__/GradebookGrid.test.tsx"`
Expected: FAIL — `GradebookGrid` not found.

- [ ] **Step 3: Write minimal implementation** — `GradebookGrid.tsx`

Build the grid per spec §6. Required logic (the implementer writes the JSX to satisfy the tests + spec, token-only):
- A `GLYPH: Record<CellStatus, string>` map: `graded:'✓', submitted:'⋯', not_due:'·', missing:'miss', redo:'⟳', redo_in_progress:'⟳', none:'—'`.
- A `TONE: Record<CellStatus, string>` map of `*-surface` token classes (`graded:'bg-ok-surface'`, `submitted:'bg-brand-surface'`, `missing:'bg-risk-surface'`, `redo`/`redo_in_progress:'bg-warn-surface'`, else `'bg-surface'`).
- Outer `div` with `overflow-x-auto`; a table/grid where the **first column is sticky** (`sticky left-0 z-10 bg-surface`) holding `student.name` (`text-fg`).
- Header row: assignment `title` chips via `SectionLabel tone='brand'` + a `due_at`-derived caption (`text-fg-muted`).
- Each cell for status `graded|submitted|missing|redo|redo_in_progress` is a `<button>` with `aria-label={`${student.name} — ${col.title} — ${statusWord}${grade ? ', ' + grade + ' percent' : ''}`}` and `onClick={() => setSelected({ studentId, col, cell })}`; `not_due`/`none` are inert `<div>`s. Show the glyph AND (for graded/redo/redo_in_progress) `{displayed_grade}%`; add a small override marker when `is_override`, and a "late" text badge when `submitted_on_time === false`.
- Footer row: per-column `column_averages[key]` (or `—`) + an overall `class_average` cell, labeled "Class average", visually distinct (`bg-brand-surface`, sticker top border). Raw % allowed here.
- Missing-work summary: a `<p data-testid="missing-summary">` (or `SummaryCallout`) with the count-bearing sentence from a local helper `missingSummary(n)` (see below). Render it above the grid.
- Mount `<GradebookDrillIn ... />` (Task 6) when `selected != null`, passing the selected cell + `classId` + an `onClose` and an `onWrite` that calls `router.refresh()`.

Local copy helper (count-bearing → checked with `hasBannedWord` in tests, not `hasLeak`):
```tsx
function missingSummary(n: number): string {
  if (n <= 0) return "Everything's turned in — nothing outstanding.";
  if (n === 1) return '1 assignment is still outstanding.';
  return `${n} assignments are still outstanding.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/app/(teacher)/gradebook/_components/__tests__/GradebookGrid.test.tsx"`
Expected: PASS (3 tests). (If the drill-in import is not yet built, stub `GradebookDrillIn` as a no-op render guarded by `selected`; Task 6 fills it.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(teacher)/gradebook/_components/GradebookGrid.tsx" "src/app/(teacher)/gradebook/_components/__tests__/GradebookGrid.test.tsx"
git commit -m "feat(gradebook): GradebookGrid (glyph+grade cells, sticky col, average footer, missing summary)"
```

---

## Task 5: `DiagnosticChecksSection` component

**Files:**
- Create: `src/app/(teacher)/gradebook/_components/DiagnosticChecksSection.tsx`
- Test: `src/app/(teacher)/gradebook/_components/__tests__/DiagnosticChecksSection.test.tsx`

**Interfaces:**
- Consumes: `Gradebook` (the `quizzes` + `quiz_cells` slices); `Card` (`tone='surface'`), `SectionLabel` (`tone='lime'`), `MasteryLabel`/`RiskBadge` (`band` prop) from `@/components/core/*`.
- Produces: `<DiagnosticChecksSection data={Gradebook} />`. Read-only quiz grid; NOT in any average; raw `mastery_band` enum never rendered directly.

- [ ] **Step 1: Write the failing test** — `__tests__/DiagnosticChecksSection.test.tsx`

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiagnosticChecksSection } from '../DiagnosticChecksSection';
import type { Gradebook } from '@/lib/gradebook/loadGradebook';

const data: Gradebook = {
  class_id: 'c1',
  students: [{ student_id: 's1', name: 'Ana Diaz' }],
  assignments: [], cells: {}, class_average: null, column_averages: {}, missing_count: 0,
  quizzes: [{ quiz_id: 'q1', label: 'Demo Quiz' }],
  quiz_cells: { s1: { q1: { quiz_attempt_id: 'qa1', is_complete: true, score_pct: 88, mastery_band: 'grade_level' } } },
};

describe('DiagnosticChecksSection', () => {
  it('renders the "not graded" label and the quiz column header', () => {
    render(<DiagnosticChecksSection data={data} />);
    expect(screen.getByText(/Diagnostic checks — not graded/i)).toBeInTheDocument();
    expect(screen.getByText('Demo Quiz')).toBeInTheDocument();
  });
  it('has NO override controls (quiz cells are read-only)', () => {
    render(<DiagnosticChecksSection data={data} />);
    expect(screen.queryByRole('button', { name: /override|another try|save/i })).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull(); // no numeric grade input
  });
  it('never renders the raw mastery_band enum string', () => {
    render(<DiagnosticChecksSection data={data} />);
    expect(screen.queryByText('grade_level')).toBeNull(); // raw enum must be humanized via MasteryLabel
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/(teacher)/gradebook/_components/__tests__/DiagnosticChecksSection.test.tsx"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** — `DiagnosticChecksSection.tsx`

Per spec §7: a `Card tone='surface'` wrapper + `SectionLabel tone='lime'` reading "Diagnostic checks — not graded" + a deep-ink caption ("These checks help you see where students are — they don't count toward grades."). A small student×quiz grid keyed by `quiz_id`: header = `quiz.label`; each cell shows `score_pct`% (teacher render site, digit OK) + the band via `<MasteryLabel band={cell.mastery_band} />` (NEVER the raw enum string) + a completion dot from `is_complete`. **No buttons, no inputs, no override/reteach.** Empty quizzes → render nothing (or a one-line "No diagnostic checks yet").

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/app/(teacher)/gradebook/_components/__tests__/DiagnosticChecksSection.test.tsx"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(teacher)/gradebook/_components/DiagnosticChecksSection.tsx" "src/app/(teacher)/gradebook/_components/__tests__/DiagnosticChecksSection.test.tsx"
git commit -m "feat(gradebook): DiagnosticChecksSection (read-only, separated, not in average)"
```

---

## Task 6: `GradebookDrillIn` panel + override submit

**Files:**
- Create: `src/app/(teacher)/gradebook/_components/GradebookDrillIn.tsx`
- Test: `src/app/(teacher)/gradebook/_components/__tests__/GradebookDrillIn.test.tsx`

**Interfaces:**
- Consumes: `GradebookCell` + the selected `(studentName, col)` + `classId` (props from `GradebookGrid`); `effortLabelPhrase` (`@/lib/copy/effortLabelPhrase`); `POST /api/teacher/gradebook/override`.
- Produces: `<GradebookDrillIn selected={{ studentName, col, cell }} onClose={fn} onWrite={fn} />`. Side panel; grade override input (0–100) + notes + "Clear override" + a reteach toggle; on submit `fetch('/api/teacher/gradebook/override', {...})` then `onWrite()`.

- [ ] **Step 1: Write the failing test** — `__tests__/GradebookDrillIn.test.tsx`

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GradebookDrillIn } from '../GradebookDrillIn';

const selected = {
  studentName: 'Ana Diaz',
  col: { assignment_key: 'due:d1', title: 'Due Jun 10', due_at: '2026-06-10T00:00:00Z' },
  cell: { attempt_id: 'h1', status: 'graded' as const, displayed_grade: 90, is_override: true, submitted_on_time: true, allow_redo: false, score_pct: 70 },
};

beforeEach(() => { vi.restoreAllMocks(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, displayed_grade: 95 }) })); });

describe('GradebookDrillIn', () => {
  it('shows the AI-vs-teacher grade breakdown when an override exists', () => {
    render(<GradebookDrillIn selected={selected} onClose={() => {}} onWrite={() => {}} />);
    expect(screen.getByText(/Ana Diaz/)).toBeInTheDocument();
    expect(screen.getByText(/AI grade/i)).toBeInTheDocument();   // 70
    expect(screen.getByText(/Your grade/i)).toBeInTheDocument(); // 90
  });
  it('submitting an override POSTs teacher_score then calls onWrite', async () => {
    const onWrite = vi.fn();
    render(<GradebookDrillIn selected={selected} onClose={() => {}} onWrite={onWrite} />);
    fireEvent.change(screen.getByLabelText(/grade/i), { target: { value: '95' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1].body as string);
    expect(body.attempt_id).toBe('h1'); expect(body.teacher_score).toBe(95);
    await waitFor(() => expect(onWrite).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/(teacher)/gradebook/_components/__tests__/GradebookDrillIn.test.tsx"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** — `GradebookDrillIn.tsx`

Per spec §8.1: a right-side panel (`'use client'`). Header = `selected.studentName` + `col.title`. Grade block: when `cell.is_override`, show "AI grade: {score_pct}%" and "Your grade: {displayed_grade}%"; else show the single grade. Status line. Effort line via `effortLabelPhrase` when an effort label is available (passed in or omitted in v1 — OK to show only when present). Override control: a numeric `<input type="number" min={0} max={100}>` labelled "Your grade" + a notes `<textarea>` "Add a note" + a "Save" button + a "Clear override" button (sends `teacher_score: null`). Reteach toggle: a checkbox/switch "Open this for another try." writing `allow_redo`. On Save/toggle: `await fetch('/api/teacher/gradebook/override', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ attempt_id: cell.attempt_id, ...patch }) })`; on `res.ok` call `onWrite()`. Show an inline error on `!res.ok`. Token-only; deep-ink text.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/app/(teacher)/gradebook/_components/__tests__/GradebookDrillIn.test.tsx"`
Expected: PASS (2 tests). Then re-run `GradebookGrid.test.tsx` to confirm the real drill-in import still satisfies it.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(teacher)/gradebook/_components/GradebookDrillIn.tsx" "src/app/(teacher)/gradebook/_components/__tests__/GradebookDrillIn.test.tsx"
git commit -m "feat(gradebook): GradebookDrillIn panel (grade override + notes + reteach toggle)"
```

---

## Task 7: Page — replace the gradebook stub

**Files:**
- Modify: `src/app/(teacher)/gradebook/page.tsx` (replace the 10-line stub entirely)
- Test: `src/app/(teacher)/gradebook/__tests__/page.test.tsx` (node — assert redirect/guard wiring)

**Interfaces:**
- Consumes: `requireRole` (`@/lib/auth/requireRole`), `firstClassIdForTeacher` (`@/lib/teacher/firstClassIdForTeacher`), `guardClassAccess` (`@/lib/auth/guards`), `createAdminSupabaseClient`, `loadGradebook`, `GradebookGrid`, `DiagnosticChecksSection`, `EmptyState`, `PageHeader`.
- Produces: the default async page component.

**Reference (mirror exactly):** `src/app/(teacher)/roster/page.tsx:70-96` (the classId→redirect→guard→admin→load shape).

- [ ] **Step 1: Write the failing test** — `__tests__/page.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireRole = vi.fn(); const firstClassIdForTeacher = vi.fn(); const guardClassAccess = vi.fn();
const loadGradebook = vi.fn(); const redirect = vi.fn((url: string) => { throw new Error('REDIRECT:' + url); });

vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/auth/requireRole', () => ({ requireRole }));
vi.mock('@/lib/teacher/firstClassIdForTeacher', () => ({ firstClassIdForTeacher }));
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess }));
vi.mock('@/lib/supabase/server', () => ({ createAdminSupabaseClient: () => ({}) }));
vi.mock('@/lib/gradebook/loadGradebook', () => ({ loadGradebook }));

async function load() { vi.resetModules(); return (await import('@/app/(teacher)/gradebook/page')).default; }

beforeEach(() => {
  requireRole.mockReset().mockResolvedValue({ userId: 't1' });
  firstClassIdForTeacher.mockReset().mockResolvedValue('c1');
  guardClassAccess.mockReset().mockResolvedValue(null);
  loadGradebook.mockReset().mockResolvedValue({ class_id: 'c1', students: [{ student_id: 's1', name: 'Ana' }], assignments: [], cells: { s1: {} }, class_average: null, column_averages: {}, missing_count: 0, quizzes: [], quiz_cells: { s1: {} } });
});

describe('GradebookPage', () => {
  it('redirects to the first class when no class param is given', async () => {
    const Page = await load();
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/gradebook?class=c1');
  });
  it('loads the gradebook when a class is provided and guard passes', async () => {
    const Page = await load();
    const el = await Page({ searchParams: Promise.resolve({ class: 'c1' }) });
    expect(loadGradebook).toHaveBeenCalledWith(expect.anything(), { classId: 'c1', teacherId: 't1' });
    expect(el).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/(teacher)/gradebook/__tests__/page.test.tsx"`
Expected: FAIL — the stub doesn't redirect/load.

- [ ] **Step 3: Write minimal implementation** — replace `gradebook/page.tsx`

Use the exact code from spec §5 (the full page component). It: resolves `classId` from `await searchParams`; redirects to `firstClassIdForTeacher` when absent; `guardClassAccess` IDOR; `createAdminSupabaseClient` + `loadGradebook`; cold-start `EmptyState`; renders `<PageHeader>` + `<GradebookGrid>` + `<DiagnosticChecksSection>`. Do NOT re-apply `pop-canvas` (the shell's `<main>` has it). Import canonical helpers; no local `STAFF_ROLES`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/app/(teacher)/gradebook/__tests__/page.test.tsx"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(teacher)/gradebook/page.tsx" "src/app/(teacher)/gradebook/__tests__/page.test.tsx"
git commit -m "feat(gradebook): wire the page (auth chain + first-class redirect + grid + diagnostics)"
```

---

## Final task: whole-branch review + gates

- [ ] Run all gates: `npm test` (full suite), `npx tsc --noEmit`, `npm run a11y`, `npm run build`. All must be green.
- [ ] Surface every DRAFT copy string (page header, empty states, class-average label, missing-work summary, cell microcopy, drill-in labels, the four effort phrases, diagnostic caption) to `STRINGS-FOR-BARB.md` for Barb to gate.
- [ ] Review cadence (per [[v2-epic3-teacher-screens]] + Marvin 2026-06-22): per-task committee review during SDD → whole-branch adversarial **committee** review → **`/code-review`** → **codex** cross-model review (run it; don't block if it hangs) → then the **`/frontend-design-audit`** usability gate on the built grid + drill-in.
- [ ] Then `superpowers:finishing-a-development-branch`.

---

## Self-review notes (author)

- **Spec coverage:** §1 goal → Task 7 page; §2 dataflow → Tasks 2/3/7; §3 grade semantics → Task 2 (override-wins, average rule); §4 loader → Task 2; §5 page → Task 7; §6 grid → Task 4; §7 diagnostics → Task 5; §8 drill-in+route → Tasks 3/6; §9 copy → every task's DRAFT strings + the two-guard discipline in Tasks 1/4; §10 tests → each task's tests; §11 risks → all RESOLVED in the spec, reflected in Task 2 (key derivation) and Task 3 (RLS/admin-client). No gaps.
- **Type consistency:** `Gradebook`/`GradebookCell`/`CellStatus`/`GradebookQuizCol{quiz_id}`/`GradebookQuizCell` are defined once in Task 2 and consumed verbatim in Tasks 4–7. `displayed_grade`, `assignment_key`, `quiz_id` names match across tasks. `effortLabelPhrase(EffortLabel|null)` (Task 1) consumed by Task 6.
- **No placeholders:** every code step carries real code or a precise component spec backed by a complete test that pins behavior.
