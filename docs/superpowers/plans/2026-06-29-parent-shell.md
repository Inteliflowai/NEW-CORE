# Parent Shell (C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the pilot parent app — add a `/parent/progress` page (grade trend + upcoming assignments + skill strengths) and three dashboard action cards (Contact Teacher, Help at Home, Celebrate) — all four-audience-safe, no migration.

**Architecture:** Reuse the already-live item-B loaders/helpers (`loadStudentGrowth`, `studentSkillLabel`) and the Epic-4 parent guard (`parentGuard`). New server-side loaders normalize raw grades to 0–1 and derive direction words *before* anything reaches the client (raw digits never leave the server — the established parent-surface pattern from the dashboard). Contact-Teacher is a plain `mailto:` (no messaging system, no DB write). Pages mirror the existing parent dashboard's auth chain exactly.

**Tech Stack:** Next.js 16.2.9 (App Router, async `searchParams`), React 19 server components, Supabase admin client (bypasses RLS — explicit `student_id` filter is the IDOR backstop), Tailwind v4 token classes, Vitest 4 (`jsdom` for component/page tests).

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec (`docs/superpowers/specs/2026-06-29-parent-shell.md`) and `CLAUDE.md`.

- **No migration.** Highest existing migration is `0031`. This feature adds none. Do NOT create a `supabase/migrations/00xx_*.sql` file.
- **Four-audience (binding, parent surface):** ZERO numbers on parent-visible prose — no `%`, grades, scores, band enum, or comparisons. Grade movement is expressed only as the direction words `'climbing' | 'steady' | 'sliding' | null`. Skill strengths show only `studentSkillLabel()` output (`'Solid'`/`'Excelling'`). NEVER show: mastery-band enum, CL verbs (`reteach`/`reinforce`/`on track`/`enrich`/`grade level`), raw risk numbers, peer/class comparisons.
- **Sparkline digit-safety:** `GradeTrendSparkline` renders `<title>{p.label ?? \`${p.grade}%\`}</title>`. On parent surfaces every point MUST carry `label: ''` (empty string is kept by `??`, so the `%` fallback never fires) AND its `grade` must already be a normalized 0–1 value (raw grades never reach client props). The `ariaLabel` must be digit-free.
- **Leak guards:** call `assertNoLeak(s, ctx)` + `assertNoBannedWord(s, ctx)` (from `@/lib/copy/leakGuard`) on every dynamically-composed parent-visible string that does NOT interpolate a child's name. Run `hasParentLeak(text)` (from `@/lib/copy/parentGuard`) on any AI-authored text (conversation starters, high-five notes) at the render boundary — defense-in-depth even though they were validated at generation.
- **Content identifiers rendered verbatim, NOT leak-guarded:** assignment titles and skill names are teacher/AI-authored content identifiers (the same strings the student already sees). They may legitimately contain digits ("Chapter 2"). Render them verbatim; do NOT pass them through `assertNoLeak`. Only *composed prose you author* is leak-asserted.
- **Auth chain (both pages + the contact-teacher loader):** `const { userId } = await requireRole(['parent'])` → `createAdminSupabaseClient()` → `loadParentChildren(admin, userId)` → validate `?child=` against that list → `const denied = await guardStudentAccess(childId); if (denied) redirect('<same route>')`. In a Server Component you MUST `redirect()`, never `return` the `NextResponse`.
- **IDOR:** every admin-client read is scoped with an explicit `.eq('student_id', childId)` (or `.in('id', <ids derived from the guarded child>)`). The admin client bypasses RLS.
- **Contact Teacher = `mailto:` only.** Plain `<a href="mailto:...">`. No DB write, no message stored, no server-side send.
- **Copy → Barb:** all new parent-visible strings are added to `STRINGS-FOR-BARB.md §Parent Shell` as DRAFTS. Barb gates final wording.
- **"Assignments", never "Homework"** in any UI/copy.
- **Tokens only:** `text-fg`, `text-fg-muted`, `text-brand`, `Card` `tone` prop (`'surface'|'brand'|'ok'|'warn'|'risk'`). No hardcoded hex, no arbitrary `[var(--..)]` in components.
- **Vitest headers:** every component/page test file starts with `// @vitest-environment jsdom` then `import '@/test/setup-dom';`.
- **Test commands:** run-once `npm test`; single file `npx vitest run <path>`. Type-check via `npx tsc --noEmit`.

---

## Verified current-code facts (grounding, 2026-06-29)

Implementers: these are exact and were read from live code. Use them verbatim.

**Reused libs**
- `loadStudentGrowth(admin: SupabaseClient, studentId: string): Promise<StudentGrowthData>` — `@/lib/student/loadStudentGrowth`. Returns:
  ```ts
  interface StudentGrowthData {
    gradeDirection: 'climbing' | 'steady' | 'sliding' | null;
    trendPoints: { date: string; grade: number }[];   // grade is RAW 0-100
    skills: { skillName: string; label: string }[];    // label ∈ 'Building strength'|'Solid'|'Excelling' (nulls already dropped), top 6 by confidence
    latestHighFiveText: string | null;
    totalHighFiveCount: number;
  }
  ```
- `studentSkillLabel(state): string | null` — `on_track`→`'Solid'`, `ready_to_extend`→`'Excelling'`, `needs_*`→`'Building strength'`, else `null`.
- `hasParentLeak(text: string): boolean` — `@/lib/copy/parentGuard`.
- `assertNoLeak(text, ctx?)`, `assertNoBannedWord(text, ctx?)`, `hasLeak(text)`, `hasDiagnosticVocab(text)` — `@/lib/copy/leakGuard`.

**Components**
- `GradeTrendSparkline` — `@/components/core/GradeTrendSparkline`. Props `{ points: {date:string;grade:number;label?:string}[]; ariaLabel: string; size?: 'sm'|'md'; coldStartLabel?: string }`. `<2` points → `<p data-testid="trend-cold-start">`; else `<svg data-testid="grade-trend-sparkline" role="img" aria-label=...>`.
- `Card` — `@/components/core/Card`. Props `{ children; className?; tone? }`, `tone ∈ 'surface'|'brand'|'ok'|'warn'|'risk'` (default `'surface'`). Chrome: `rounded-lg border-2 border-sidebar-edge shadow-sticker p-4`.
- `ChildSelector` — `@/app/(parent)/parent/dashboard/_components/ChildSelector` (`'use client'`). Props `{ children: {id:string;firstName:string}[]; selectedId: string }`. Renders `?child=<id>` pill nav. Reuse on the progress page.

**Parent dashboard (existing)** — `src/app/(parent)/parent/dashboard/page.tsx` (Server Component):
- `const { userId } = await requireRole(['parent'])`; `const admin = createAdminSupabaseClient()`; `const children = await loadParentChildren(admin, userId)` (each `{id, firstName}`); resolves `childId` from validated `?child=`; `guardStudentAccess(childId)` → `redirect('/parent/dashboard')` on deny.
- `Promise.all([ getParentNarrative(admin, childId, {force}), loadStudentHighFivesReadonly(admin, childId), admin.from('student_model_snapshots')... ])`.
- `getParentNarrative(...)` → `{ paragraphs: string[]; conversation_starters: string[]; source: string; generated_at: string }`.
- `loadStudentHighFivesReadonly(admin, childId)` → `ParentHighFive[]` = `{ id: string; note: string; created_at: string }[]` (already leak-filtered, newest-first, default limit 5).
- Renders: `ChildSelector` (if `children.length > 1`) → header → `<NarrativeCard paragraphs={narrative.paragraphs}/>` → `<ConversationStarter starters={narrative.conversation_starters}/>` → `<SeeMoreDetail .../>`.

**DB schema (no changes)**
- `assignments`: `id, student_id, class_id, lesson_id (nullable), due_at timestamptz (nullable), status, content jsonb, assigned_at`. **Per-student fan-out; no `title` column.** Display title = `content->>'title'` (student surface) or joined `lessons(title)` (teacher surface). Reader must fall back: lesson title → `content.title` → literal.
- `enrollments`: `id, class_id, student_id, is_active, source`. **Students only** — the enrolled-user column is `student_id`. Teachers are NOT enrollment rows.
- `classes`: `id, school_id, teacher_id (nullable), name, subject, grade_level, period, ...`. Teacher of a class = `classes.teacher_id`.
- `users`: `id, role ('teacher'|'student'|'parent'|'school_admin'|'school_sysadmin'|'platform_admin'), full_name (NOT NULL), email (NOT NULL), display_name (nullable), parent_id`. Name fallback: `display_name || full_name`. There is NO `co_teacher` role and NO `role_in_school` column.
- `high_fives`: `id, note_text, student_id, created_at`.

**Auth**
- `requireRole(allowed): Promise<{ userId; role; schoolId; fullName }>` — redirects on failure.
- `guardStudentAccess(studentId): Promise<NextResponse | null>` — `null` = proceed.
- `createAdminSupabaseClient()` — synchronous, `@/lib/supabase/server`.

---

## File Structure

**New files**
- `src/lib/copy/parentTrendCopy.ts` — parent-voiced, name-free trend lead sentences (pure).
- `src/lib/parent/dueLabel.ts` — `formatDueLabel(dueAtIso, now)` → digit-free "Due tomorrow"/"Due Wednesday" (pure).
- `src/lib/parent/loadParentProgress.ts` — progress loader + exported pure `normalizeTrend`/`deriveStrengths`.
- `src/lib/parent/loadChildTeachers.ts` — teacher-of-child loader + exported pure `dedupeTeachers`.
- `src/app/(parent)/parent/progress/page.tsx` — the Progress page.
- `src/app/(parent)/parent/progress/_components/TrendCard.tsx`
- `src/app/(parent)/parent/progress/_components/UpcomingCard.tsx`
- `src/app/(parent)/parent/progress/_components/StrengthsCard.tsx`
- `src/app/(parent)/parent/dashboard/_components/ContactTeacherCard.tsx`
- `src/app/(parent)/parent/dashboard/_components/HelpAtHomeCard.tsx` (`'use client'`)
- `src/app/(parent)/parent/dashboard/_components/CelebrateCard.tsx`
- Tests: `src/lib/copy/__tests__/parentTrendCopy.test.ts`, `src/lib/parent/__tests__/dueLabel.test.ts`, `src/lib/parent/__tests__/loadParentProgress.test.ts`, `src/lib/parent/__tests__/loadChildTeachers.test.ts`, `src/app/(parent)/parent/progress/__tests__/progress.leak.test.tsx`, `src/app/(parent)/parent/dashboard/_components/__tests__/parentCards.test.tsx`

**Modified files**
- `src/app/(parent)/layout.tsx` — add the "Progress" nav link.
- `src/app/(parent)/parent/dashboard/page.tsx` — add `loadChildTeachers` to the parallel load; render the three cards; replace `ConversationStarter` with `HelpAtHomeCard`.
- `src/app/(parent)/parent/dashboard/_components/__tests__/dashboard.leak.test.tsx` — add a composed full-surface regression for the new cards.
- `STRINGS-FOR-BARB.md` — add `## Parent Shell` section.

---

## Task 1: Data + copy layer (loaders, pure helpers)

**Files:**
- Create: `src/lib/copy/parentTrendCopy.ts`
- Create: `src/lib/parent/dueLabel.ts`
- Create: `src/lib/parent/loadParentProgress.ts`
- Create: `src/lib/parent/loadChildTeachers.ts`
- Create: `src/test/fakeSupabase.ts` (chainable query recorder for loader IDOR-scoping tests)
- Test: `src/lib/copy/__tests__/parentTrendCopy.test.ts`
- Test: `src/lib/parent/__tests__/dueLabel.test.ts`
- Test: `src/lib/parent/__tests__/loadParentProgress.test.ts`
- Test: `src/lib/parent/__tests__/loadParentProgress.query.test.ts`
- Test: `src/lib/parent/__tests__/loadChildTeachers.test.ts`
- Test: `src/lib/parent/__tests__/loadChildTeachers.query.test.ts`

**Interfaces:**
- Consumes: `loadStudentGrowth` (signature above); `SupabaseClient` from `@supabase/supabase-js`; `assertNoLeak`/`assertNoBannedWord`; `hasParentLeak`.
- Produces (later tasks rely on these EXACT names/types):
  ```ts
  // parentTrendCopy.ts
  export type TrendDirection = 'climbing' | 'steady' | 'sliding' | null;
  export function parentTrendLead(direction: TrendDirection): string;

  // dueLabel.ts
  export function formatDueLabel(dueAtIso: string, now: Date): string;

  // loadParentProgress.ts
  export interface ParentProgressPoint { date: string; grade: number; label: string } // grade normalized 0-1, label always ''
  export interface ParentProgressStrength { skillName: string; label: string }         // label ∈ 'Solid' | 'Excelling'
  export interface ParentProgressUpcoming { id: string; title: string; dueLabel: string }
  export interface ParentProgressData {
    gradeDirection: TrendDirection;
    points: ParentProgressPoint[];
    strengths: ParentProgressStrength[];
    upcoming: ParentProgressUpcoming[];
  }
  export function normalizeTrend(points: { date: string; grade: number }[]): ParentProgressPoint[];
  export function deriveStrengths(skills: { skillName: string; label: string }[]): ParentProgressStrength[];
  export function loadParentProgress(admin: SupabaseClient, studentId: string, now?: Date): Promise<ParentProgressData>;

  // loadChildTeachers.ts
  export interface ChildTeacher { teacherId: string; name: string; email: string; classLabel: string }
  export function dedupeTeachers(rows: { teacherId: string; name: string; email: string; className: string }[]): ChildTeacher[];
  export function loadChildTeachers(admin: SupabaseClient, studentId: string): Promise<ChildTeacher[]>;
  ```

- [ ] **Step 1: Write the failing test for `parentTrendCopy`**

Create `src/lib/copy/__tests__/parentTrendCopy.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parentTrendLead } from '@/lib/copy/parentTrendCopy';
import { hasLeak, hasBannedWord, hasDiagnosticVocab } from '@/lib/copy/leakGuard';
import { hasParentLeak } from '@/lib/copy/parentGuard';

const DIRECTIONS = ['climbing', 'steady', 'sliding', null] as const;

describe('parentTrendLead', () => {
  it('returns a non-empty sentence for every direction', () => {
    for (const d of DIRECTIONS) {
      expect(parentTrendLead(d).length).toBeGreaterThan(0);
    }
  });

  it('never leaks a digit, banned word, diagnostic verb, or parent-forbidden phrase', () => {
    for (const d of DIRECTIONS) {
      const s = parentTrendLead(d);
      expect(hasLeak(s)).toBe(false);
      expect(hasBannedWord(s)).toBe(false);
      expect(hasDiagnosticVocab(s)).toBe(false);
      expect(hasParentLeak(s)).toBe(false);
    }
  });

  it('gives a distinct cold-start line for null', () => {
    expect(parentTrendLead(null)).not.toBe(parentTrendLead('steady'));
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run src/lib/copy/__tests__/parentTrendCopy.test.ts`
Expected: FAIL — `Cannot find module '@/lib/copy/parentTrendCopy'`.

- [ ] **Step 3: Implement `parentTrendCopy.ts`**

Create `src/lib/copy/parentTrendCopy.ts`:
```ts
// src/lib/copy/parentTrendCopy.ts
// Parent-voiced, number-free trend copy. Four-audience: no digits, no band/CL
// verbs, no peer comparisons. Name-free by design so callers can assertNoLeak.
// Barb gates final wording (STRINGS-FOR-BARB.md §Parent Shell).

export type TrendDirection = 'climbing' | 'steady' | 'sliding' | null;

/** One calm, name-free lead sentence about how grades have moved over time. */
export function parentTrendLead(direction: TrendDirection): string {
  if (direction === 'climbing') return 'There is real momentum here lately.';
  if (direction === 'steady') return 'Things are holding a steady pace.';
  if (direction === 'sliding') return 'It has been a little uneven lately — a good moment to check in.';
  return 'We are still building a learning history — keep checking back.';
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `npx vitest run src/lib/copy/__tests__/parentTrendCopy.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Write the failing test for `formatDueLabel`**

Create `src/lib/parent/__tests__/dueLabel.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatDueLabel } from '@/lib/parent/dueLabel';

// Fixed "now": Wed 2026-06-10T12:00:00Z
const NOW = new Date('2026-06-10T12:00:00Z');

describe('formatDueLabel', () => {
  it('labels same-day as "Due today"', () => {
    expect(formatDueLabel('2026-06-10T20:00:00Z', NOW)).toBe('Due today');
  });
  it('labels next calendar day as "Due tomorrow"', () => {
    expect(formatDueLabel('2026-06-11T08:00:00Z', NOW)).toBe('Due tomorrow');
  });
  it('labels 2-6 days out with the weekday name', () => {
    // 2026-06-13 is a Saturday
    expect(formatDueLabel('2026-06-13T08:00:00Z', NOW)).toBe('Due Saturday');
  });
  it('labels 7-13 days out as "Due next week"', () => {
    expect(formatDueLabel('2026-06-18T08:00:00Z', NOW)).toBe('Due next week');
  });
  it('labels 14+ days out as "Due in a few weeks"', () => {
    expect(formatDueLabel('2026-07-05T08:00:00Z', NOW)).toBe('Due in a few weeks');
  });
  it('labels a past date as "Due soon" (defensive; filter should exclude these)', () => {
    expect(formatDueLabel('2026-06-01T08:00:00Z', NOW)).toBe('Due soon');
  });
  it('never emits a digit', () => {
    for (const iso of ['2026-06-10T20:00:00Z','2026-06-11T08:00:00Z','2026-06-13T08:00:00Z','2026-06-18T08:00:00Z','2026-07-05T08:00:00Z']) {
      expect(/\d/.test(formatDueLabel(iso, NOW))).toBe(false);
    }
  });
});
```

- [ ] **Step 6: Run it — verify it fails**

Run: `npx vitest run src/lib/parent/__tests__/dueLabel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `dueLabel.ts`**

Create `src/lib/parent/dueLabel.ts`:
```ts
// src/lib/parent/dueLabel.ts
// Pure, digit-free due-date label for parent surfaces. Compares UTC calendar
// days (deterministic + testable). "no digits in date" (spec §2a).

const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Digit-free "Due …" label. `now` is injected for determinism. */
export function formatDueLabel(dueAtIso: string, now: Date): string {
  const due = new Date(dueAtIso);
  const diffDays = Math.round((utcMidnight(due) - utcMidnight(now)) / 86_400_000);
  if (diffDays < 0) return 'Due soon';
  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  if (diffDays <= 6) return `Due ${WEEKDAYS[due.getUTCDay()]}`;
  if (diffDays <= 13) return 'Due next week';
  return 'Due in a few weeks';
}
```

- [ ] **Step 8: Run it — verify it passes**

Run: `npx vitest run src/lib/parent/__tests__/dueLabel.test.ts`
Expected: PASS (all 7).

- [ ] **Step 9: Write the failing test for `loadParentProgress` pure helpers**

Create `src/lib/parent/__tests__/loadParentProgress.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { normalizeTrend, deriveStrengths } from '@/lib/parent/loadParentProgress';

describe('normalizeTrend', () => {
  it('maps raw grades to 0-1 and forces an empty digit-free label', () => {
    const out = normalizeTrend([
      { date: 'a', grade: 60 },
      { date: 'b', grade: 80 },
      { date: 'c', grade: 100 },
    ]);
    expect(out.map((p) => p.grade)).toEqual([0, 0.5, 1]);
    expect(out.every((p) => p.label === '')).toBe(true);
    expect(out.map((p) => p.date)).toEqual(['a', 'b', 'c']);
  });
  it('never puts a raw grade on a point (defensive scan)', () => {
    const out = normalizeTrend([{ date: 'a', grade: 73 }, { date: 'b', grade: 91 }]);
    for (const p of out) expect(p.grade).toBeLessThanOrEqual(1);
  });
  it('handles a flat series without dividing by zero', () => {
    const out = normalizeTrend([{ date: 'a', grade: 70 }, { date: 'b', grade: 70 }]);
    expect(out.every((p) => Number.isFinite(p.grade))).toBe(true);
  });
  it('passes an empty array through', () => {
    expect(normalizeTrend([])).toEqual([]);
  });
});

describe('deriveStrengths', () => {
  it('keeps only Solid/Excelling skills, capped at 3, order preserved', () => {
    const out = deriveStrengths([
      { skillName: 'Fractions', label: 'Excelling' },
      { skillName: 'Grit', label: 'Building strength' },
      { skillName: 'Poetry', label: 'Solid' },
      { skillName: 'Algebra', label: 'Excelling' },
      { skillName: 'Geometry', label: 'Solid' },
    ]);
    expect(out).toEqual([
      { skillName: 'Fractions', label: 'Excelling' },
      { skillName: 'Poetry', label: 'Solid' },
      { skillName: 'Algebra', label: 'Excelling' },
    ]);
  });
  it('returns [] when nothing qualifies', () => {
    expect(deriveStrengths([{ skillName: 'X', label: 'Building strength' }])).toEqual([]);
  });
});
```

- [ ] **Step 10: Run it — verify it fails**

Run: `npx vitest run src/lib/parent/__tests__/loadParentProgress.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 11: Implement `loadParentProgress.ts`**

Create `src/lib/parent/loadParentProgress.ts`:
```ts
// src/lib/parent/loadParentProgress.ts
// Parent Progress page data. Reuses loadStudentGrowth (class-agnostic grade
// trend + skill labels) and adds upcoming assignments. Raw grades are
// normalized 0-1 SERVER-SIDE and never reach the client (mirrors the dashboard
// snapshot handling). Four-audience: no digits, no band/CL verbs.
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadStudentGrowth } from '@/lib/student/loadStudentGrowth';
import { formatDueLabel } from '@/lib/parent/dueLabel';
import type { TrendDirection } from '@/lib/copy/parentTrendCopy';

export interface ParentProgressPoint { date: string; grade: number; label: string }
export interface ParentProgressStrength { skillName: string; label: string }
export interface ParentProgressUpcoming { id: string; title: string; dueLabel: string }
export interface ParentProgressData {
  gradeDirection: TrendDirection;
  points: ParentProgressPoint[];
  strengths: ParentProgressStrength[];
  upcoming: ParentProgressUpcoming[];
}

const UPCOMING_LIMIT = 10;

/** Min-max normalize raw grades to 0-1; force digit-free label so the sparkline
 *  <title> fallback can never print a grade. Raw grades never leave the server. */
export function normalizeTrend(points: { date: string; grade: number }[]): ParentProgressPoint[] {
  if (points.length === 0) return [];
  const grades = points.map((p) => p.grade);
  const min = Math.min(...grades);
  const max = Math.max(...grades);
  const range = max - min || 1;
  return points.map((p) => ({ date: p.date, grade: (p.grade - min) / range, label: '' }));
}

/** Only the "doing well" skills, capped at 3, original order preserved. */
export function deriveStrengths(skills: { skillName: string; label: string }[]): ParentProgressStrength[] {
  return skills.filter((s) => s.label === 'Solid' || s.label === 'Excelling').slice(0, 3);
}

type UpcomingRow = {
  id: string;
  due_at: string | null;
  content: { title?: string } | null;
  lesson_id: string | null;
  lessons: { title: string | null } | { title: string | null }[] | null;
};

function lessonTitle(row: UpcomingRow): string | null {
  const l = row.lessons;
  if (!l) return null;
  const one = Array.isArray(l) ? l[0] : l;
  return one?.title ?? null;
}

export async function loadParentProgress(
  admin: SupabaseClient,
  studentId: string,
  now: Date = new Date(),
): Promise<ParentProgressData> {
  const growth = await loadStudentGrowth(admin, studentId);

  // One query: scalar columns (due_at, content) + the embedded lesson title.
  const { data: asgData } = await admin
    .from('assignments')
    .select('id, due_at, content, lesson_id, lessons:lesson_id(title)')
    .eq('student_id', studentId)
    .gt('due_at', now.toISOString())
    .order('due_at', { ascending: true })
    .limit(UPCOMING_LIMIT);
  const rows = (asgData ?? []) as UpcomingRow[];

  const upcoming: ParentProgressUpcoming[] = rows.map((r) => ({
    id: r.id,
    title: lessonTitle(r) || r.content?.title || 'Upcoming assignment',
    // `.gt('due_at', ...)` guarantees due_at is non-null here; `now` is a defensive fallback.
    dueLabel: formatDueLabel(r.due_at ?? now.toISOString(), now),
  }));

  return {
    gradeDirection: growth.gradeDirection,
    points: normalizeTrend(growth.trendPoints),
    strengths: deriveStrengths(growth.skills),
    upcoming,
  };
}
```

> **Behavior note (accepted — flagged to Marvin):** "Coming up" filters only `student_id` + future `due_at`; it does NOT exclude work the child already finished early. This is intentional student/parent parity — the student's own upcoming list is unfiltered too — and a completion filter on `assignments.status` would be a **no-op** (completion is written to `homework_attempts.status`, `assignments.status` stays `'published'`). If a "hide finished work" pass is wanted later, anti-join `homework_attempts` on `assignment_id`; do NOT filter `assignments.status`.

- [ ] **Step 12: Run it — verify it passes**

Run: `npx vitest run src/lib/parent/__tests__/loadParentProgress.test.ts`
Expected: PASS (all 6).

- [ ] **Step 13: Write the failing test for `dedupeTeachers`**

Create `src/lib/parent/__tests__/loadChildTeachers.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { dedupeTeachers } from '@/lib/parent/loadChildTeachers';

describe('dedupeTeachers', () => {
  it('collapses one teacher across multiple classes and joins class labels', () => {
    const out = dedupeTeachers([
      { teacherId: 't1', name: 'Ms. Whitfield', email: 'w@x.edu', className: 'English Literature' },
      { teacherId: 't2', name: 'Mr. Bell', email: 'b@x.edu', className: 'Math' },
      { teacherId: 't1', name: 'Ms. Whitfield', email: 'w@x.edu', className: 'Reading Lab' },
    ]);
    expect(out).toEqual([
      { teacherId: 't1', name: 'Ms. Whitfield', email: 'w@x.edu', classLabel: 'English Literature · Reading Lab' },
      { teacherId: 't2', name: 'Mr. Bell', email: 'b@x.edu', classLabel: 'Math' },
    ]);
  });
  it('does not duplicate a class label if it repeats', () => {
    const out = dedupeTeachers([
      { teacherId: 't1', name: 'A', email: 'a@x.edu', className: 'Math' },
      { teacherId: 't1', name: 'A', email: 'a@x.edu', className: 'Math' },
    ]);
    expect(out).toEqual([{ teacherId: 't1', name: 'A', email: 'a@x.edu', classLabel: 'Math' }]);
  });
  it('returns [] for no rows', () => {
    expect(dedupeTeachers([])).toEqual([]);
  });
});
```

- [ ] **Step 14: Run it — verify it fails**

Run: `npx vitest run src/lib/parent/__tests__/loadChildTeachers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 15: Implement `loadChildTeachers.ts`**

Create `src/lib/parent/loadChildTeachers.ts`:
```ts
// src/lib/parent/loadChildTeachers.ts
// Resolve the teacher(s) of a child's active classes for the Contact Teacher
// card. child → active enrollments → classes.teacher_id → users(email,name).
// A student may be in several classes (demo: English Lit + Math), so this can
// return >1 teacher; dedupe by teacher and merge their class labels.
// mailto only — no message is stored. admin client + explicit student_id scope.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ChildTeacher { teacherId: string; name: string; email: string; classLabel: string }

/** Collapse rows to one per teacher; join distinct class labels with " · ". */
export function dedupeTeachers(
  rows: { teacherId: string; name: string; email: string; className: string }[],
): ChildTeacher[] {
  const byId = new Map<string, { name: string; email: string; classes: string[] }>();
  for (const r of rows) {
    const cur = byId.get(r.teacherId);
    if (cur) {
      if (!cur.classes.includes(r.className)) cur.classes.push(r.className);
    } else {
      byId.set(r.teacherId, { name: r.name, email: r.email, classes: [r.className] });
    }
  }
  return [...byId.entries()].map(([teacherId, v]) => ({
    teacherId,
    name: v.name,
    email: v.email,
    classLabel: v.classes.join(' · '),
  }));
}

export async function loadChildTeachers(admin: SupabaseClient, studentId: string): Promise<ChildTeacher[]> {
  const { data: enr } = await admin
    .from('enrollments')
    .select('class_id')
    .eq('student_id', studentId)
    .eq('is_active', true);
  const classIds = (enr ?? []).map((e: { class_id: string }) => e.class_id);
  if (classIds.length === 0) return [];

  const { data: classes } = await admin
    .from('classes')
    .select('id, name, subject, teacher_id')
    .in('id', classIds);
  const classRows = (classes ?? []) as { id: string; name: string; subject: string | null; teacher_id: string | null }[];
  const teacherIds = [...new Set(classRows.map((c) => c.teacher_id).filter((t): t is string => t != null))];
  if (teacherIds.length === 0) return [];

  const { data: users } = await admin
    .from('users')
    .select('id, email, display_name, full_name')
    .in('id', teacherIds)
    .eq('role', 'teacher');
  const teacherById = new Map(
    ((users ?? []) as { id: string; email: string; display_name: string | null; full_name: string | null }[])
      .map((u) => [u.id, { email: u.email, name: u.display_name || u.full_name || 'Teacher' }]),
  );

  const rows = classRows
    .filter((c) => c.teacher_id && teacherById.has(c.teacher_id))
    .map((c) => {
      const t = teacherById.get(c.teacher_id as string)!;
      return { teacherId: c.teacher_id as string, name: t.name, email: t.email, className: c.subject || c.name };
    });

  return dedupeTeachers(rows);
}
```

- [ ] **Step 16: Run it — verify it passes**

Run: `npx vitest run src/lib/parent/__tests__/loadChildTeachers.test.ts`
Expected: PASS (all 3).

- [ ] **Step 17: Create the fake-Supabase recorder (for loader IDOR-scoping tests)**

The IDOR backstop is the explicit `.eq('student_id', ...)` filter (the admin client bypasses RLS). The leak/page tests fully mock the loaders, so the loader bodies — and those filters — need their own regression guard. This tiny chainable recorder makes that testable without a live DB.

Create `src/test/fakeSupabase.ts`:
```ts
// src/test/fakeSupabase.ts
// Minimal chainable Supabase query recorder for unit-testing loader IDOR scoping.
// Every builder method returns the same thenable object, so `await admin.from(t)
// .select(...).eq(...)...` resolves to the per-table result while recording calls.
export interface RecordedCall { method: string; args: unknown[] }
export interface RecordedQuery { __calls: RecordedCall[] }
export interface FakeAdmin {
  from(table: string): Record<string, unknown> & RecordedQuery;
  __used: Record<string, RecordedQuery>;
}

const CHAIN_METHODS = ['select', 'eq', 'gt', 'gte', 'lt', 'in', 'order', 'limit', 'maybeSingle', 'single'];

export function makeFakeAdmin(byTable: Record<string, { data: unknown }>): FakeAdmin {
  const used: Record<string, RecordedQuery> = {};
  return {
    from(table: string) {
      const calls: RecordedCall[] = [];
      const result = byTable[table] ?? { data: [] };
      const q: Record<string, unknown> & RecordedQuery = { __calls: calls };
      for (const m of CHAIN_METHODS) {
        q[m] = (...args: unknown[]) => { calls.push({ method: m, args }); return q; };
      }
      // Thenable: `await q` (at any chain position) resolves to `result`.
      (q as unknown as { then: unknown }).then = (
        onF: (v: unknown) => unknown,
        onR?: (e: unknown) => unknown,
      ) => Promise.resolve(result).then(onF, onR);
      used[table] = q;
      return q;
    },
    __used: used,
  };
}
```

- [ ] **Step 18: Write + run the `loadParentProgress` scoping test**

Create `src/lib/parent/__tests__/loadParentProgress.query.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { makeFakeAdmin } from '@/test/fakeSupabase';

// Isolate the assignment query: stub loadStudentGrowth so only .from('assignments') runs.
vi.mock('@/lib/student/loadStudentGrowth', () => ({
  loadStudentGrowth: vi.fn().mockResolvedValue({
    gradeDirection: null, trendPoints: [], skills: [], latestHighFiveText: null, totalHighFiveCount: 0,
  }),
}));

import { loadParentProgress } from '@/lib/parent/loadParentProgress';

const NOW = new Date('2026-06-10T00:00:00Z');

describe('loadParentProgress — IDOR scoping + title fallback', () => {
  it('scopes the upcoming query by student_id and future due_at', async () => {
    const admin = makeFakeAdmin({ assignments: { data: [] } });
    await loadParentProgress(admin as never, 'stu-1', NOW);
    const calls = admin.__used.assignments.__calls;
    expect(calls).toContainEqual({ method: 'eq', args: ['student_id', 'stu-1'] });
    expect(calls.some((c) => c.method === 'gt' && c.args[0] === 'due_at')).toBe(true);
  });

  it('prefers the lesson title, then content.title, then a literal', async () => {
    const admin = makeFakeAdmin({
      assignments: {
        data: [
          { id: 'a1', due_at: '2026-06-12T00:00:00Z', content: { title: 'C-title' }, lesson_id: 'l1', lessons: { title: 'Lesson Title' } },
          { id: 'a2', due_at: '2026-06-13T00:00:00Z', content: { title: 'C-title-2' }, lesson_id: null, lessons: null },
          { id: 'a3', due_at: '2026-06-14T00:00:00Z', content: null, lesson_id: null, lessons: null },
        ],
      },
    });
    const out = await loadParentProgress(admin as never, 'stu-1', NOW);
    expect(out.upcoming.map((u) => u.title)).toEqual(['Lesson Title', 'C-title-2', 'Upcoming assignment']);
  });
});
```
Run: `npx vitest run src/lib/parent/__tests__/loadParentProgress.query.test.ts`
Expected: PASS (both). If the title order fails, check the `lessonTitle(row) || content?.title || 'Upcoming assignment'` precedence in `loadParentProgress.ts`.

- [ ] **Step 19: Write + run the `loadChildTeachers` scoping test**

Create `src/lib/parent/__tests__/loadChildTeachers.query.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { makeFakeAdmin } from '@/test/fakeSupabase';
import { loadChildTeachers } from '@/lib/parent/loadChildTeachers';

describe('loadChildTeachers — IDOR scoping', () => {
  it('scopes enrollments by student_id + is_active, classes by id set, users by role=teacher', async () => {
    const admin = makeFakeAdmin({
      enrollments: { data: [{ class_id: 'c1' }, { class_id: 'c2' }] },
      classes: {
        data: [
          { id: 'c1', name: 'Eng 7', subject: 'English Literature', teacher_id: 't1' },
          { id: 'c2', name: 'Math 9', subject: 'Math', teacher_id: 't2' },
        ],
      },
      users: {
        data: [
          { id: 't1', email: 'w@x.edu', display_name: 'Ms. Whitfield', full_name: 'Dana Whitfield' },
          { id: 't2', email: 'b@x.edu', display_name: null, full_name: 'Marcus Bell' },
        ],
      },
    });
    const out = await loadChildTeachers(admin as never, 'stu-1');

    expect(admin.__used.enrollments.__calls).toContainEqual({ method: 'eq', args: ['student_id', 'stu-1'] });
    expect(admin.__used.enrollments.__calls).toContainEqual({ method: 'eq', args: ['is_active', true] });
    expect(admin.__used.classes.__calls).toContainEqual({ method: 'in', args: ['id', ['c1', 'c2']] });
    expect(admin.__used.users.__calls).toContainEqual({ method: 'eq', args: ['role', 'teacher'] });

    expect(out).toEqual([
      { teacherId: 't1', name: 'Ms. Whitfield', email: 'w@x.edu', classLabel: 'English Literature' },
      { teacherId: 't2', name: 'Marcus Bell', email: 'b@x.edu', classLabel: 'Math' },
    ]);
  });

  it('returns [] and never queries classes when the child has no active enrollments', async () => {
    const admin = makeFakeAdmin({ enrollments: { data: [] } });
    const out = await loadChildTeachers(admin as never, 'stu-1');
    expect(out).toEqual([]);
    expect(admin.__used.classes).toBeUndefined();
  });
});
```
Run: `npx vitest run src/lib/parent/__tests__/loadChildTeachers.query.test.ts`
Expected: PASS (both).

- [ ] **Step 20: Type-check + commit**

Run: `npx tsc --noEmit` — Expected: 0 errors.
```bash
git add src/lib/copy/parentTrendCopy.ts src/lib/parent/dueLabel.ts src/lib/parent/loadParentProgress.ts src/lib/parent/loadChildTeachers.ts src/test/fakeSupabase.ts src/lib/copy/__tests__/parentTrendCopy.test.ts src/lib/parent/__tests__/dueLabel.test.ts src/lib/parent/__tests__/loadParentProgress.test.ts src/lib/parent/__tests__/loadParentProgress.query.test.ts src/lib/parent/__tests__/loadChildTeachers.test.ts src/lib/parent/__tests__/loadChildTeachers.query.test.ts
git commit -m "feat(parent-shell): data + copy layer (progress loader, due-label, child-teachers) + IDOR scoping tests"
```

---

## Task 2: Progress page (`/parent/progress`) + nav link

**Files:**
- Create: `src/app/(parent)/parent/progress/_components/TrendCard.tsx`
- Create: `src/app/(parent)/parent/progress/_components/UpcomingCard.tsx`
- Create: `src/app/(parent)/parent/progress/_components/StrengthsCard.tsx`
- Create: `src/app/(parent)/parent/progress/page.tsx`
- Modify: `src/app/(parent)/layout.tsx`
- Test: `src/app/(parent)/parent/progress/__tests__/progress.leak.test.tsx`

**Interfaces:**
- Consumes from Task 1: `loadParentProgress`, `ParentProgressData`, `ParentProgressPoint`, `ParentProgressStrength`, `ParentProgressUpcoming`, `parentTrendLead`, `TrendDirection`. Also: `requireRole`, `createAdminSupabaseClient`, `loadParentChildren` (`@/lib/parent/loadParentChildren` → `{id, firstName}[]`), `guardStudentAccess`, `ChildSelector` (`../dashboard/_components/ChildSelector`), `Card`, `GradeTrendSparkline`, `assertNoLeak`, `assertNoBannedWord`. (Do NOT import `EmptyState` — the empty-children state is inlined; an unused import would fail `tsc`/lint.)
- Produces: the route `/parent/progress` and three presentational components:
  ```ts
  export function TrendCard(props: { direction: TrendDirection; points: ParentProgressPoint[] }): React.JSX.Element;
  export function UpcomingCard(props: { items: ParentProgressUpcoming[] }): React.JSX.Element;
  export function StrengthsCard(props: { firstName: string; strengths: ParentProgressStrength[] }): React.JSX.Element | null;
  ```

- [ ] **Step 1: Write the three presentational components**

Create `src/app/(parent)/parent/progress/_components/TrendCard.tsx`:
```tsx
import React from 'react';
import { Card } from '@/components/core/Card';
import { GradeTrendSparkline } from '@/components/core/GradeTrendSparkline';
import { parentTrendLead, type TrendDirection } from '@/lib/copy/parentTrendCopy';
import type { ParentProgressPoint } from '@/lib/parent/loadParentProgress';
import { assertNoLeak, assertNoBannedWord } from '@/lib/copy/leakGuard';

export function TrendCard({
  direction,
  points,
}: {
  direction: TrendDirection;
  points: ParentProgressPoint[];
}): React.JSX.Element {
  const lead = parentTrendLead(direction);
  // Belt-and-suspenders: name-free composed prose must never leak.
  assertNoLeak(lead, 'TrendCard/lead');
  assertNoBannedWord(lead, 'TrendCard/lead');

  return (
    <Card>
      <div className="flex flex-col gap-2">
        <p className="text-fg text-xs font-bold uppercase tracking-wide">Grades over time</p>
        {/* Gate the lead on a real direction so it never contradicts the sparkline's
            own cold-start. `direction` is null for <3 graded attempts; the sparkline
            cold-start fires at <2 points — showing parentTrendLead(null) alongside a
            drawn 2-point line (or duplicating the cold-start copy) would read wrong.
            Mirrors the shipped student growth page (gate on gradeDirection !== null). */}
        {direction !== null && <p className="text-fg text-base leading-relaxed">{lead}</p>}
        <GradeTrendSparkline
          points={points}
          ariaLabel="How grades have moved over time"
          coldStartLabel="We are still building a learning history — keep checking back."
        />
      </div>
    </Card>
  );
}

export default TrendCard;
```

Create `src/app/(parent)/parent/progress/_components/UpcomingCard.tsx`:
```tsx
import React from 'react';
import { Card } from '@/components/core/Card';
import type { ParentProgressUpcoming } from '@/lib/parent/loadParentProgress';

export function UpcomingCard({ items }: { items: ParentProgressUpcoming[] }): React.JSX.Element {
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <p className="text-fg text-xs font-bold uppercase tracking-wide">Coming up</p>
        {items.length === 0 ? (
          <p className="text-fg-muted text-sm">No assignments coming up right now — a good place to be.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3">
                {/* Title is a teacher/AI content identifier — rendered verbatim, not leak-guarded.
                    data-verbatim marks it so the leak test excludes it from the authored-prose scan
                    (a title like "Chapter 2" legitimately contains a digit). */}
                <span data-verbatim className="text-fg text-sm">{a.title}</span>
                <span className="text-fg-muted text-xs whitespace-nowrap">{a.dueLabel}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export default UpcomingCard;
```

Create `src/app/(parent)/parent/progress/_components/StrengthsCard.tsx`:
```tsx
import React from 'react';
import { Card } from '@/components/core/Card';
import type { ParentProgressStrength } from '@/lib/parent/loadParentProgress';

export function StrengthsCard({
  firstName,
  strengths,
}: {
  firstName: string;
  strengths: ParentProgressStrength[];
}): React.JSX.Element | null {
  if (strengths.length === 0) return null;
  return (
    <Card tone="brand">
      <div className="flex flex-col gap-3">
        <p className="text-fg text-xs font-bold uppercase tracking-wide">
          Areas where {firstName} is doing well
        </p>
        <ul className="flex flex-col gap-2">
          {strengths.map((s) => (
            <li key={s.skillName} className="flex items-center justify-between gap-2">
              {/* Skill name is a content identifier — verbatim (data-verbatim → excluded from
                  the authored-prose leak scan). Label is coach-safe ('Solid'/'Excelling'). */}
              <span data-verbatim className="text-fg text-sm">{s.skillName}</span>
              <span className="text-fg-muted text-xs">{s.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export default StrengthsCard;
```

- [ ] **Step 2: Write the Progress page**

Create `src/app/(parent)/parent/progress/page.tsx`:
```tsx
// src/app/(parent)/parent/progress/page.tsx
// Parent Progress — calm grade trend + skill strengths + upcoming assignments.
// Auth chain mirrors the dashboard exactly (requireRole → children → validate
// ?child= → guardStudentAccess → redirect on deny). Four-audience: zero numbers.
import React from 'react';
import { redirect } from 'next/navigation';

import { requireRole } from '@/lib/auth/requireRole';
import { guardStudentAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadParentChildren } from '@/lib/parent/loadParentChildren';
import { loadParentProgress } from '@/lib/parent/loadParentProgress';

import { ChildSelector } from '../dashboard/_components/ChildSelector';
import { TrendCard } from './_components/TrendCard';
import { UpcomingCard } from './_components/UpcomingCard';
import { StrengthsCard } from './_components/StrengthsCard';

export default async function ParentProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string }>;
}): Promise<React.JSX.Element> {
  const { userId } = await requireRole(['parent']);
  const admin = createAdminSupabaseClient();
  const children = await loadParentChildren(admin, userId);

  if (children.length === 0) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="rounded-xl bg-surface p-8 flex flex-col gap-3">
          <h1 className="font-display text-fg text-xl">Progress</h1>
          <p className="text-fg-muted text-sm leading-relaxed">
            Your child&apos;s progress will appear here once they are connected to your account.
          </p>
        </div>
      </div>
    );
  }

  const { child: childIdParam } = await searchParams;
  const selectedChild =
    childIdParam && children.some((c) => c.id === childIdParam)
      ? children.find((c) => c.id === childIdParam)!
      : children[0];
  const childId = selectedChild.id;

  const denied = await guardStudentAccess(childId);
  if (denied) redirect('/parent/progress');

  const data = await loadParentProgress(admin, childId);

  return (
    <div className="p-5 max-w-2xl mx-auto flex flex-col gap-5">
      {children.length > 1 && <ChildSelector children={children} selectedId={childId} />}

      <header>
        <h1 className="font-display text-fg text-xl">How {selectedChild.firstName} is doing</h1>
      </header>

      <TrendCard direction={data.gradeDirection} points={data.points} />
      <StrengthsCard firstName={selectedChild.firstName} strengths={data.strengths} />
      <UpcomingCard items={data.upcoming} />
    </div>
  );
}
```

- [ ] **Step 3: Add the "Progress" nav link**

Modify `src/app/(parent)/layout.tsx` — insert a Progress link between Dashboard and Reports inside the `nav` fragment:
```tsx
  const nav = (
    <>
      <a href="/parent/dashboard" className="text-fg hover:text-brand px-3 py-1">
        Dashboard
      </a>
      <a href="/parent/progress" className="text-fg hover:text-brand px-3 py-1">
        Progress
      </a>
      <a href="/parent/reports" className="text-fg hover:text-brand px-3 py-1">
        Reports
      </a>
    </>
  );
```

- [ ] **Step 4: Write the progress leak test**

Create `src/app/(parent)/parent/progress/__tests__/progress.leak.test.tsx`:
```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { hasDiagnosticVocab, hasLeak } from '@/lib/copy/leakGuard';
import { hasParentLeak } from '@/lib/copy/parentGuard';
import { loadParentProgress } from '@/lib/parent/loadParentProgress';

// Convention: page-level Server Component tests mock next/navigation so a deny-path
// redirect() is a controllable throw, not the opaque NEXT_REDIRECT (see student.leak.test).
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => { throw new Error('REDIRECT'); }),
}));
vi.mock('@/lib/auth/requireRole', () => ({
  requireRole: vi.fn().mockResolvedValue({ userId: 'p1' }),
}));
vi.mock('@/lib/auth/guards', () => ({
  guardStudentAccess: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: () => ({}),
}));
vi.mock('@/lib/parent/loadParentChildren', () => ({
  loadParentChildren: vi.fn().mockResolvedValue([{ id: 's1', firstName: 'Alex' }]),
}));
vi.mock('@/lib/parent/loadParentProgress', () => ({
  loadParentProgress: vi.fn().mockResolvedValue({
    gradeDirection: 'climbing',
    points: [
      { date: '2026-05-01', grade: 0, label: '' },
      { date: '2026-05-08', grade: 0.5, label: '' },
      { date: '2026-05-15', grade: 1, label: '' },
    ],
    strengths: [
      { skillName: 'Fractions', label: 'Solid' },
      { skillName: 'Poetry', label: 'Excelling' },
    ],
    upcoming: [
      { id: 'a1', title: 'Persuasive Essay', dueLabel: 'Due tomorrow' },
      { id: 'a2', title: 'Vocabulary Practice', dueLabel: 'Due Friday' },
    ],
  }),
}));

import ParentProgressPage from '@/app/(parent)/parent/progress/page';

describe('ParentProgressPage — four-audience leak gate', () => {
  it('renders no diagnostic vocabulary anywhere on the surface', async () => {
    render(await ParentProgressPage({ searchParams: Promise.resolve({}) }));
    expect(hasDiagnosticVocab(document.body.textContent ?? '')).toBe(false);
  });

  it('renders no parent leak anywhere (digit-free fixtures)', async () => {
    render(await ParentProgressPage({ searchParams: Promise.resolve({}) }));
    expect(hasParentLeak(document.body.textContent ?? '')).toBe(false);
  });

  it('has no numeric leak in AUTHORED prose nodes (verbatim identifiers + sparkline aria-label excepted)', async () => {
    render(await ParentProgressPage({ searchParams: Promise.resolve({}) }));
    // Scan only prose we author. [data-verbatim] spans (assignment titles, skill
    // names) are content identifiers that may legitimately carry digits (Global
    // Constraints, "content identifiers verbatim") and are excluded; <li> aggregates
    // verbatim children so it is not scanned directly.
    const nodes = Array.from(
      document.querySelectorAll('p, h1, h2, span:not([data-verbatim])'),
    ).map((el) => el.textContent ?? '');
    for (const text of nodes) expect(hasLeak(text)).toBe(false);
  });

  it('shows the child name, a strength, and an upcoming item', async () => {
    render(await ParentProgressPage({ searchParams: Promise.resolve({}) }));
    const body = document.body.textContent ?? '';
    expect(body).toContain('Alex');
    expect(body).toContain('Fractions');
    expect(body).toContain('Persuasive Essay');
    expect(body).toContain('Due tomorrow');
  });

  it('renders a digit-bearing assignment title verbatim (content identifiers are not stripped)', async () => {
    vi.mocked(loadParentProgress).mockResolvedValueOnce({
      gradeDirection: 'steady',
      points: [{ date: 'a', grade: 0, label: '' }, { date: 'b', grade: 1, label: '' }],
      strengths: [],
      upcoming: [{ id: 'a9', title: 'Chapter 2 Essay', dueLabel: 'Due Friday' }],
    });
    render(await ParentProgressPage({ searchParams: Promise.resolve({}) }));
    // The digit-bearing title renders as-is (verbatim content identifier)…
    expect(document.body.textContent).toContain('Chapter 2 Essay');
    // …while authored prose (excluding verbatim spans) stays digit-free.
    const nodes = Array.from(
      document.querySelectorAll('p, h1, h2, span:not([data-verbatim])'),
    ).map((el) => el.textContent ?? '');
    for (const text of nodes) expect(hasLeak(text)).toBe(false);
  });
});
```

- [ ] **Step 5: Run the progress test — verify pass**

Run: `npx vitest run src/app/(parent)/parent/progress/__tests__/progress.leak.test.tsx`
Expected: PASS (all 4). If the diagnostic-vocab test fails on `'Coming up'`/`'doing well'`, inspect which token tripped `DIAGNOSTIC_VOCAB_RE` and reword — do NOT weaken the guard.

- [ ] **Step 6: Type-check, full suite, commit**

Run: `npx tsc --noEmit` — Expected: 0.
Run: `npx vitest run src/app/(parent) src/lib/parent src/lib/copy` — Expected: all green.
```bash
git add "src/app/(parent)/parent/progress" "src/app/(parent)/layout.tsx"
git commit -m "feat(parent-shell): /parent/progress page (trend + strengths + upcoming) + nav link"
```

---

## Task 3: Dashboard action cards (Contact Teacher, Help at Home, Celebrate)

**Files:**
- Create: `src/app/(parent)/parent/dashboard/_components/ContactTeacherCard.tsx`
- Create: `src/app/(parent)/parent/dashboard/_components/HelpAtHomeCard.tsx` (`'use client'`)
- Create: `src/app/(parent)/parent/dashboard/_components/CelebrateCard.tsx`
- Modify: `src/app/(parent)/parent/dashboard/page.tsx`
- Test: `src/app/(parent)/parent/dashboard/_components/__tests__/parentCards.test.tsx`

**Interfaces:**
- Consumes from Task 1: `loadChildTeachers`, `ChildTeacher`. Existing: `Card`, `hasParentLeak`, the dashboard's existing `loadStudentHighFivesReadonly` result (`{id, note, created_at}[]`), `getParentNarrative` (`.conversation_starters`).
- Produces:
  ```ts
  export function ContactTeacherCard(props: { teachers: ChildTeacher[] }): React.JSX.Element | null;   // null when teachers.length === 0
  export function HelpAtHomeCard(props: { starters: string[] }): React.JSX.Element | null;              // null when no safe starters ('use client')
  export function CelebrateCard(props: { note: string | null }): React.JSX.Element | null;              // null when note == null
  ```

- [ ] **Step 1: Write the card component tests (RED)**

Create `src/app/(parent)/parent/dashboard/_components/__tests__/parentCards.test.tsx`:
```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { hasParentLeak } from '@/lib/copy/parentGuard';

import { ContactTeacherCard } from '../ContactTeacherCard';
import { HelpAtHomeCard } from '../HelpAtHomeCard';
import { CelebrateCard } from '../CelebrateCard';

describe('ContactTeacherCard', () => {
  it('renders a mailto link per teacher', () => {
    const { container } = render(
      <ContactTeacherCard
        teachers={[
          { teacherId: 't1', name: 'Ms. Whitfield', email: 'w@x.edu', classLabel: 'English Literature' },
          { teacherId: 't2', name: 'Mr. Bell', email: 'b@x.edu', classLabel: 'Math' },
        ]}
      />,
    );
    const links = Array.from(container.querySelectorAll('a[href^="mailto:"]'));
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('mailto:w@x.edu');
    expect(container.textContent).toContain('Ms. Whitfield');
    expect(hasParentLeak(container.textContent ?? '')).toBe(false);
  });
  it('renders nothing when there are no teachers', () => {
    const { container } = render(<ContactTeacherCard teachers={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('HelpAtHomeCard', () => {
  it('shows up to 3 clean starters and drops leaky ones', () => {
    const { container } = render(
      <HelpAtHomeCard
        starters={[
          'What surprised you today?',
          'What was their class average this week?', // leaky → dropped
          'What is something you want to try tomorrow?',
          'What made you laugh today?',
          'One more idea here.',
        ]}
      />,
    );
    expect(container.textContent).toContain('What surprised you today?');
    expect(container.textContent).not.toContain('class average');
    // max 3 rendered starters
    const items = container.querySelectorAll('[data-testid="starter-row"]');
    expect(items.length).toBeLessThanOrEqual(3);
    expect(hasParentLeak(container.textContent ?? '')).toBe(false);
  });
  it('renders nothing when no safe starters remain', () => {
    const { container } = render(<HelpAtHomeCard starters={['What was their class average?']} />);
    expect(container.firstChild).toBeNull();
  });
  it('renders a copy button for each shown starter', () => {
    render(<HelpAtHomeCard starters={['What surprised you today?']} />);
    expect(screen.getAllByRole('button', { name: /copy/i }).length).toBeGreaterThan(0);
  });
});

describe('CelebrateCard', () => {
  it('renders the note when present', () => {
    const { container } = render(<CelebrateCard note="Great listening today!" />);
    expect(container.textContent).toContain('Great listening today!');
    expect(hasParentLeak(container.textContent ?? '')).toBe(false);
  });
  it('renders nothing when note is null', () => {
    const { container } = render(<CelebrateCard note={null} />);
    expect(container.firstChild).toBeNull();
  });
  it('renders nothing when the note would leak (defense-in-depth)', () => {
    const { container } = render(<CelebrateCard note="Alex is on track this week." />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run src/app/(parent)/parent/dashboard/_components/__tests__/parentCards.test.tsx`
Expected: FAIL — the three component modules don't exist.

- [ ] **Step 3: Implement `ContactTeacherCard.tsx`**

Create `src/app/(parent)/parent/dashboard/_components/ContactTeacherCard.tsx`:
```tsx
import React from 'react';
import { Card } from '@/components/core/Card';
import type { ChildTeacher } from '@/lib/parent/loadChildTeachers';

/** mailto-only contact card. Hidden when the child has no resolvable teacher. */
export function ContactTeacherCard({ teachers }: { teachers: ChildTeacher[] }): React.JSX.Element | null {
  if (teachers.length === 0) return null;
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <p className="text-fg text-xs font-bold uppercase tracking-wide">Reach out to the teacher</p>
        <ul className="flex flex-col gap-3">
          {teachers.map((t) => (
            <li key={t.teacherId} className="flex items-center justify-between gap-3">
              <span className="flex flex-col">
                <span className="text-fg text-sm">{t.name}</span>
                <span className="text-fg-muted text-xs">{t.classLabel}</span>
              </span>
              <a
                href={`mailto:${t.email}`}
                className="text-brand text-sm underline whitespace-nowrap"
              >
                Send an email →
              </a>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export default ContactTeacherCard;
```

- [ ] **Step 4: Implement `HelpAtHomeCard.tsx`**

Create `src/app/(parent)/parent/dashboard/_components/HelpAtHomeCard.tsx`:
```tsx
'use client';
import React, { useState } from 'react';
import { Card } from '@/components/core/Card';
import { hasParentLeak } from '@/lib/copy/parentGuard';

const MAX_STARTERS = 3;

/** Conversation starters as a dedicated card, each with a copy button.
 *  Defense-in-depth: drops any starter that trips the parent guard. Hidden when
 *  none survive. Replaces the plain ConversationStarter on the dashboard. */
export function HelpAtHomeCard({ starters }: { starters: string[] }): React.JSX.Element | null {
  const safe = starters.filter((s) => !hasParentLeak(s)).slice(0, MAX_STARTERS);
  // Track the copied starter by its text (stable across a narrative refresh), not
  // by index over a filtered/sliced list, so the "Copied" state can't attach to the
  // wrong row when `starters` changes.
  const [copied, setCopied] = useState<string | null>(null);
  if (safe.length === 0) return null;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
    } catch {
      // Clipboard unavailable (older browser / denied) — no-op; the text is still visible.
    }
  };

  return (
    <Card tone="brand">
      <div className="flex flex-col gap-3">
        <p className="text-fg text-xs font-bold uppercase tracking-wide">Questions to start a conversation tonight</p>
        <ul className="flex flex-col gap-3">
          {safe.map((s) => (
            <li key={s} data-testid="starter-row" className="flex items-start justify-between gap-3">
              <span className="text-fg text-sm leading-relaxed">{s}</span>
              <button
                type="button"
                onClick={() => copy(s)}
                aria-label={`Copy: ${s}`}
                className="text-brand text-xs underline whitespace-nowrap shrink-0"
              >
                {copied === s ? 'Copied' : 'Copy'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export default HelpAtHomeCard;
```

- [ ] **Step 5: Implement `CelebrateCard.tsx`**

Create `src/app/(parent)/parent/dashboard/_components/CelebrateCard.tsx`:
```tsx
import React from 'react';
import { Card } from '@/components/core/Card';
import { hasParentLeak } from '@/lib/copy/parentGuard';

/** Surfaces the latest high-five note as a warm highlight. The note is
 *  teacher-authored for the student and already leak-filtered upstream by
 *  loadStudentHighFivesReadonly — the render-boundary hasParentLeak check is
 *  defense-in-depth (Global Constraint: guard AI-authored text at render).
 *  Hidden when there is no note, or if a leaky one somehow reaches here. */
export function CelebrateCard({ note }: { note: string | null }): React.JSX.Element | null {
  if (note == null || hasParentLeak(note)) return null;
  return (
    <Card tone="brand">
      <div className="flex flex-col gap-2">
        <p className="text-fg text-xs font-bold uppercase tracking-wide">Something your teacher wanted you to know</p>
        <p className="text-fg text-sm leading-relaxed">{note}</p>
      </div>
    </Card>
  );
}

export default CelebrateCard;
```

- [ ] **Step 6: Run the card tests — verify pass**

Run: `npx vitest run src/app/(parent)/parent/dashboard/_components/__tests__/parentCards.test.tsx`
Expected: PASS (all 7).

- [ ] **Step 7: Wire the cards into the dashboard page**

Modify `src/app/(parent)/parent/dashboard/page.tsx`:

1. Add imports (with the other `_components` imports):
```tsx
import { loadChildTeachers } from '@/lib/parent/loadChildTeachers';
import { ContactTeacherCard } from './_components/ContactTeacherCard';
import { HelpAtHomeCard } from './_components/HelpAtHomeCard';
import { CelebrateCard } from './_components/CelebrateCard';
```
Remove the now-unused `import { ConversationStarter } from './_components/ConversationStarter';` (the component file stays in the repo; it is simply no longer rendered here).

2. Add `loadChildTeachers` to the parallel load (extend the existing `Promise.all`):
```tsx
  const [narrative, highFives, snapshotResult, teachers] = await Promise.all([
    getParentNarrative(admin, childId, { force: forceRefresh }),
    loadStudentHighFivesReadonly(admin, childId),
    admin
      .from('student_model_snapshots')
      .select('avg_score, snapshot_date')
      .eq('student_id', childId)
      .order('snapshot_date', { ascending: false })
      .limit(20),
    loadChildTeachers(admin, childId),
  ]);

  // Celebrate surfaces the newest note prominently; hand the REST to SeeMoreDetail
  // so the same note isn't shown twice on the calm dashboard.
  const latestNote = highFives[0]?.note ?? null;
  const restHighFives = latestNote ? highFives.slice(1) : highFives;
```

3. Replace the render block (swap `ConversationStarter` → `HelpAtHomeCard`, add `CelebrateCard` after the narrative and `ContactTeacherCard` before the collapsible):
```tsx
      {/* Centerpiece: AI narrative */}
      <NarrativeCard paragraphs={narrative.paragraphs} />

      {/* Warm highlight: the latest high-five */}
      <CelebrateCard note={latestNote} />

      {/* Conversation starters with copy buttons */}
      <HelpAtHomeCard starters={narrative.conversation_starters} />

      {/* Reach the teacher (mailto) */}
      <ContactTeacherCard teachers={teachers} />

      {/* Collapsible: digit-free growth + the remaining high-fives (newest is in CelebrateCard) */}
      <SeeMoreDetail
        highFives={restHighFives}
        growthHistory={growthHistory}
        sparklinePoints={sparklinePoints}
        gradeTrendDirection={gradeTrendDirection}
      />
```

> Card order is a UI decision — final order is confirmed at Playwright preview (propose-only). Do not add `'use client'` to the dashboard page; it stays a Server Component (`HelpAtHomeCard` is the only client component and is imported into it, which is allowed).

- [ ] **Step 8: Type-check + targeted suite + commit**

Run: `npx tsc --noEmit` — Expected: 0 (verify no "ConversationStarter is declared but never used" — it must be removed from imports).
Run: `npx vitest run "src/app/(parent)/parent/dashboard"` — Expected: green.
```bash
git add "src/app/(parent)/parent/dashboard"
git commit -m "feat(parent-shell): dashboard action cards (contact-teacher, help-at-home, celebrate)"
```

---

## Task 4: Barb strings + composed dashboard leak regression

**Files:**
- Modify: `STRINGS-FOR-BARB.md`
- Modify: `src/app/(parent)/parent/dashboard/_components/__tests__/dashboard.leak.test.tsx`

**Interfaces:**
- Consumes: the three cards from Task 3 + `hasParentLeak`.
- Produces: a documented copy section + a cross-card full-surface regression.

- [ ] **Step 1: Add the composed regression test (RED first)**

Append to `src/app/(parent)/parent/dashboard/_components/__tests__/dashboard.leak.test.tsx` (keep the existing imports; add these):
```tsx
import { ContactTeacherCard } from '../ContactTeacherCard';
import { HelpAtHomeCard } from '../HelpAtHomeCard';
import { CelebrateCard } from '../CelebrateCard';

describe('Parent Shell cards — composed surface leak regression', () => {
  it('renders all three cards together with no parent leak', () => {
    const { container } = render(
      <div>
        <CelebrateCard note="You showed real focus today!" />
        <HelpAtHomeCard starters={['What surprised you today?', 'What was their class average?']} />
        <ContactTeacherCard
          teachers={[{ teacherId: 't1', name: 'Ms. Whitfield', email: 'w@x.edu', classLabel: 'English Literature' }]}
        />
      </div>,
    );
    // leaky starter dropped
    expect(container.textContent).not.toContain('class average');
    // clean content present
    expect(container.textContent).toContain('You showed real focus today!');
    expect(container.textContent).toContain('Ms. Whitfield');
    // full surface clean
    expect(hasParentLeak(container.textContent ?? '')).toBe(false);
  });
});
```

- [ ] **Step 2: Run — verify the new block passes (imports resolve from Task 3)**

Run: `npx vitest run src/app/(parent)/parent/dashboard/_components/__tests__/dashboard.leak.test.tsx`
Expected: PASS (existing blocks + the new one).

- [ ] **Step 3: Add the Barb strings section**

Append to `STRINGS-FOR-BARB.md`:
```markdown
## Parent Shell (C) — DRAFT (Barb sign-off required, 2026-06-29)

Four-audience: parent surfaces show NO numbers, grades, band labels, CL verbs, or comparisons. All strings below are drafts.

### Progress page (`/parent/progress`)
- Page heading: "How {firstName} is doing"
- Trend card label: "Grades over time"
- Trend lead — climbing: "There is real momentum here lately."
- Trend lead — steady: "Things are holding a steady pace."
- Trend lead — sliding: "It has been a little uneven lately — a good moment to check in."
- Trend lead — cold-start (null): "We are still building a learning history — keep checking back."
- Trend sparkline aria-label: "How grades have moved over time"
- Trend sparkline cold-start: "We are still building a learning history — keep checking back."
- Strengths card label: "Areas where {firstName} is doing well" (each row: skill name + "Solid" / "Excelling")
- Upcoming card label: "Coming up"
- Upcoming empty: "No assignments coming up right now — a good place to be."
- Due labels (digit-free): "Due today" / "Due tomorrow" / "Due {Weekday}" / "Due next week" / "Due in a few weeks"
- Children-not-connected empty: "Your child's progress will appear here once they are connected to your account."

### Dashboard cards
- Contact Teacher label: "Reach out to the teacher"; row action: "Send an email →" (mailto)
- Help at Home label: "Questions to start a conversation tonight"; per-starter button: "Copy" / "Copied"
- Celebrate label: "Something your teacher wanted you to know" (shows the latest high-five note verbatim)
```

- [ ] **Step 4: Full suite + gates + commit**

Run: `npx vitest run` — Expected: all green (prior count + the new parent-shell tests).
Run: `npx tsc --noEmit` — Expected: 0.
Run: `npm run build` — Expected: success (a11y contrast gate + token check pass).
```bash
git add STRINGS-FOR-BARB.md "src/app/(parent)/parent/dashboard/_components/__tests__/dashboard.leak.test.tsx"
git commit -m "docs(parent-shell): Barb strings + composed dashboard leak regression"
```

---

## Self-Review (run against the spec after the plan is written)

**Spec coverage:**
- §2a Progress page (trend / upcoming / strengths / nav link) → Task 1 (data) + Task 2 (page). ✓
- §2b Contact Teacher (mailto) → Task 1 (`loadChildTeachers`) + Task 3 (`ContactTeacherCard`). ✓
- §2b Help at Home (starters + copy) → Task 3 (`HelpAtHomeCard`). ✓
- §2b Celebrate (latest high-five) → Task 3 (`CelebrateCard`). ✓
- §3 Four-audience → global constraints + leak tests in Tasks 1/2/3/4. ✓
- §4 D1 mailto / D2 upcoming / D3 celebrate / D4 help-at-home → all present. ✓
- §6 constraints (tokens, admin+IDOR, no migration, mailto-only) → global constraints. ✓

**Two deliberate deviations from the spec's literal text — APPROVED by Marvin (2026-06-30):**
1. Contact Teacher returns **all** the child's teachers (deduped), not `LIMIT 1` — the demo enrolls each student in two classes, so a single arbitrary teacher would look broken. Still mailto-only, no DB.
2. Help at Home **replaces** the existing `ConversationStarter` on the dashboard (same starters, now a dedicated card with copy buttons) instead of rendering starters twice.

**Pre-code adversarial review (5 lenses + adjudication, 2026-06-30) — folded before execution:** 8 findings (3 IMPORTANT, 5 MINOR) from 18 raw. Folded: CelebrateCard render-boundary `hasParentLeak` guard (IMP); TrendCard lead gated on `direction !== null` to match the sparkline cold-start threshold (IMP); loader IDOR-scoping regression tests via a fake-Supabase recorder (IMP); verbatim-node test scoping + digit-title fixture; latest high-five de-dup (`slice(1)` to SeeMoreDetail); dropped unused `EmptyState`; HelpAtHome keyed by string; `next/navigation` mock. Accepted with rationale: "Coming up" shows finished-but-future-due work (student parity; a status filter is a no-op).

**Placeholder scan:** none — every step has complete code, exact commands, expected output.

**Type consistency:** `TrendDirection`, `ParentProgressData`/`Point`/`Strength`/`Upcoming`, `ChildTeacher`, `formatDueLabel`, `parentTrendLead` names are identical across the tasks that define and consume them. `GradeTrendSparkline` point shape (`{date, grade, label}`) matches `ParentProgressPoint`. `ParentHighFive.note` (not `note_text`) is the field feeding `CelebrateCard`.

---

## Execution Handoff

Gates before merge: `npx tsc --noEmit` (0), `npx vitest run` (all green), `npm run build` (0 — a11y + tokens). Then Playwright preview of `/parent/progress` and the updated dashboard for Marvin's propose-only approval (card order, Contact-Teacher multi-teacher layout), then the whole-branch adversarial review, then Marvin's merge call.
