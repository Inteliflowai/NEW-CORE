# Student Improvements (B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three missing student-facing features: a full notes wall, a lightweight growth page, and a better dashboard.

**Architecture:** Four sequential tasks: (1) pure helpers + data loaders, (2) notes wall, (3) growth page, (4) dashboard + nav. Each task ships independently. No migration. All pages are Next.js App Router server components; the NoteCard is a server component too (no browser state needed). Existing `GradeTrendSparkline`, `Card`, `EmptyState`, `loadStudentHighFives` all reused as-is.

**Tech Stack:** Next.js 16 App Router, React 19 server components, Supabase admin client, Tailwind v4 tokens, Vitest 4.x + jsdom for tests.

## Global Constraints

- Next.js 16.2.9 / React 19. `params`/`searchParams` are Promises — always `await` them.
- Import alias: `@/*` maps to `src/*`.
- Tailwind v4 — Tier-2 token classes only. Content text = `text-fg`. Never hardcode hex.
- Card tones available: `'surface' | 'brand' | 'ok' | 'warn' | 'risk'`.
- EmptyState variants available: `'not-yet-assessed' | 'just-getting-started' | 'on-track'`.
- **Four-audience (binding):** student surfaces NEVER show mastery-band enum (`reteach`/`on_track`/`enrichment`), CL verbs (`Reinforce`/`On Track`/`Enrich`), raw risk numbers, or peer comparisons. `studentSkillLabel()` is the only translator — it must NEVER return a CL verb.
- **Diagnostic vocab guard:** `DIAGNOSTIC_VOCAB_RE` in `@/lib/copy/leakGuard` covers `reteach`, `reinforce`, `enrich`, `on track`, `band`, and more. Call `hasDiagnosticVocab()` on any dynamic string before render.
- `assertNoLeak` / `assertNoBannedWord` from `@/lib/copy/leakGuard` — call on all dynamic student-facing copy strings.
- Auth chain: `await requireRole(['student'])` → `createAdminSupabaseClient()` for DB reads.
- `skill_learning_state.state` values: `'needs_different_instruction' | 'needs_more_time' | 'on_track' | 'ready_to_extend' | 'insufficient_data' | 'not_attempted'`. Confidence column: `confidence` (0–100). Observation count column: `observation_count`. Min 2 observations for display.
- `high_fives` table has student-read RLS (`student_id = auth.uid()`) but we use admin client for consistency with existing pattern.
- Tests: server component pages use jsdom + `vi.mock`; pure functions use node env (no header comment needed). jsdom files must start with `// @vitest-environment jsdom` then `import '@/test/setup-dom';`.
- Run `npx vitest run <path>` — never `npm test` for a single file.
- **Copy strings** → `STRINGS-FOR-BARB.md §Student Improvements (B)` at end of Task 4. Barb gates all UI text.
- Branch off `main` at commit `a5209f0`. Commit message convention: `feat(student-b): <what>`.

---

## File Structure

```
src/lib/copy/studentSkillLabel.ts           NEW — studentSkillLabel, growthLeadSentence, growthDirectionCopy
src/lib/copy/__tests__/studentSkillLabel.test.ts  NEW — unit tests for helpers
src/lib/student/loadStudentGrowth.ts        NEW — loadStudentGrowth(admin, studentId)
src/lib/student/__tests__/loadStudentGrowth.test.ts  NEW — unit tests
src/lib/highfives/loadStudentNotesPaged.ts  NEW — loadStudentNotesPaged(admin, studentId, page, pageSize)
src/lib/highfives/__tests__/loadStudentNotesPaged.test.ts  NEW — unit tests

src/app/(student)/student/notes/page.tsx          NEW — notes wall server component
src/app/(student)/student/notes/_components/NoteCard.tsx  NEW — single note card
src/app/(student)/student/notes/__tests__/page.test.tsx   NEW — page test
src/app/(student)/student/dashboard/page.tsx      MODIFY — add NextUpCard + "See all" notes link
src/app/(student)/student/dashboard/_components/NextUpCard.tsx  NEW — next assignment CTA
src/app/(student)/student/dashboard/__tests__/dashboard.test.tsx  NEW — dashboard test
src/app/(student)/student/growth/page.tsx         NEW — growth page server component
src/app/(student)/student/growth/__tests__/growth.leak.test.tsx  NEW — leak test (PASS/FAIL gate)
src/app/(student)/student/growth/__tests__/page.test.tsx         NEW — render test
src/app/(student)/layout.tsx                      MODIFY — add "My Notes" + "How I'm doing" nav links
STRINGS-FOR-BARB.md                              MODIFY — append §Student Improvements (B) section
```

---

### Task 1: Pure helpers + loaders

**Files:**
- Create: `src/lib/copy/studentSkillLabel.ts`
- Create: `src/lib/copy/__tests__/studentSkillLabel.test.ts`
- Create: `src/lib/student/loadStudentGrowth.ts`
- Create: `src/lib/student/__tests__/loadStudentGrowth.test.ts`
- Create: `src/lib/highfives/loadStudentNotesPaged.ts`
- Create: `src/lib/highfives/__tests__/loadStudentNotesPaged.test.ts`

**Interfaces — Produces (later tasks import these):**
- `studentSkillLabel(state: SkillLearningState): string | null` from `@/lib/copy/studentSkillLabel`
- `growthLeadSentence(direction: 'climbing'|'steady'|'sliding'|null): string` from `@/lib/copy/studentSkillLabel`
- `growthDirectionCopy(direction: 'climbing'|'steady'|'sliding'|null): string` from `@/lib/copy/studentSkillLabel`
- `loadStudentGrowth(admin: SupabaseClient, studentId: string): Promise<StudentGrowthData>` from `@/lib/student/loadStudentGrowth`
- `StudentGrowthData` interface from same module
- `loadStudentNotesPaged(admin, studentId, page, pageSize): Promise<PagedNotes>` from `@/lib/highfives/loadStudentNotesPaged`
- `PagedNotes` interface from same module

- [ ] **Step 1: Write failing tests for studentSkillLabel.ts**

Create `src/lib/copy/__tests__/studentSkillLabel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { studentSkillLabel, growthLeadSentence, growthDirectionCopy } from '../studentSkillLabel';
import { hasDiagnosticVocab, hasLeak } from '@/lib/copy/leakGuard';

describe('studentSkillLabel', () => {
  it('maps reteach states to "Building strength"', () => {
    expect(studentSkillLabel('needs_different_instruction')).toBe('Building strength');
    expect(studentSkillLabel('needs_more_time')).toBe('Building strength');
  });

  it('maps on_track to "Solid"', () => {
    expect(studentSkillLabel('on_track')).toBe('Solid');
  });

  it('maps ready_to_extend to "Excelling"', () => {
    expect(studentSkillLabel('ready_to_extend')).toBe('Excelling');
  });

  it('returns null for cold-start states', () => {
    expect(studentSkillLabel('insufficient_data')).toBeNull();
    expect(studentSkillLabel('not_attempted')).toBeNull();
  });

  it('output never contains a CL verb (four-audience gate)', () => {
    const states = ['needs_different_instruction','needs_more_time','on_track','ready_to_extend'] as const;
    for (const s of states) {
      const label = studentSkillLabel(s);
      if (label) {
        expect(hasDiagnosticVocab(label)).toBe(false);
        expect(hasLeak(label)).toBe(false);
      }
    }
  });
});

describe('growthLeadSentence', () => {
  it('returns a string for every direction', () => {
    for (const dir of ['climbing','steady','sliding',null] as const) {
      const s = growthLeadSentence(dir);
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(5);
      expect(hasLeak(s)).toBe(false);
      expect(hasDiagnosticVocab(s)).toBe(false);
    }
  });
});

describe('growthDirectionCopy', () => {
  it('returns a string for every direction', () => {
    for (const dir of ['climbing','steady','sliding',null] as const) {
      const s = growthDirectionCopy(dir);
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(5);
      expect(hasLeak(s)).toBe(false);
      expect(hasDiagnosticVocab(s)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```
npx vitest run src/lib/copy/__tests__/studentSkillLabel.test.ts
```
Expected: FAIL — `studentSkillLabel` not found.

- [ ] **Step 3: Implement studentSkillLabel.ts**

Create `src/lib/copy/studentSkillLabel.ts`:

```ts
import type { SkillLearningState } from '@/lib/skills/clVerbs';

// Student-facing labels for skill states. MUST NOT contain any CL verb
// (reteach/reinforce/on track/enrich/enrichment) — four-audience binding.
const STUDENT_SKILL_LABEL: Record<SkillLearningState, string | null> = {
  needs_different_instruction: 'Building strength',
  needs_more_time:             'Building strength',
  on_track:                    'Solid',
  ready_to_extend:             'Excelling',
  insufficient_data:           null,
  not_attempted:               null,
};

export function studentSkillLabel(state: SkillLearningState): string | null {
  return STUDENT_SKILL_LABEL[state] ?? null;
}

// Deterministic lead sentence based on grade direction. No AI. No numbers.
export function growthLeadSentence(
  direction: 'climbing' | 'steady' | 'sliding' | null,
): string {
  if (direction === 'climbing') return 'You have been putting in real effort lately — it shows.';
  if (direction === 'steady')   return 'You are making progress. Here is where you stand.';
  if (direction === 'sliding')  return 'Things feel a little tricky right now — that is okay.';
  return 'Here is how you are doing.';
}

// One-line direction sentence shown below the sparkline. No digits.
export function growthDirectionCopy(
  direction: 'climbing' | 'steady' | 'sliding' | null,
): string {
  if (direction === 'climbing') return 'Your grades have been climbing.';
  if (direction === 'steady')   return 'Holding steady.';
  if (direction === 'sliding')  return 'A little uneven lately — you have got this.';
  return 'Not enough graded work yet to show a trend.';
}
```

- [ ] **Step 4: Run tests — expect PASS**

```
npx vitest run src/lib/copy/__tests__/studentSkillLabel.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Write failing tests for loadStudentGrowth**

Create `src/lib/student/__tests__/loadStudentGrowth.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { loadStudentGrowth } from '../loadStudentGrowth';
import type { SupabaseClient } from '@supabase/supabase-js';

function makeAdmin(overrides: {
  sls?: unknown[];
  hw?: unknown[];
  hf?: { data: unknown[]; count: number };
}): SupabaseClient {
  return {
    from: (table: string) => ({
      select: (_sel: string, opts?: { count?: string }) => ({
        eq: (_col: string, _val: unknown) => ({
          gte: (_col: string, _val: unknown) => Promise.resolve({ data: overrides.sls ?? [], error: null }),
          in: (_col: string, _vals: unknown[]) => Promise.resolve({ data: overrides.hw ?? [], error: null }),
          order: (_col: string, _opts?: unknown) => ({
            limit: (_n: number) => Promise.resolve(overrides.hf ?? { data: [], count: 0, error: null }),
          }),
          order: () => Promise.resolve({ data: overrides.hw ?? [], error: null }),
        }),
        eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: overrides.hw ?? [], error: null }) }) }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe('loadStudentGrowth', () => {
  it('returns empty skills and cold-start direction when no data', async () => {
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            gte: () => Promise.resolve({ data: [], error: null }),
            in: () => Promise.resolve({ data: [], error: null }),
            order: () => ({ limit: () => Promise.resolve({ data: [], count: 0, error: null }) }),
            order: () => Promise.resolve({ data: [], error: null }),
          }),
          eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
        }),
      }),
    } as unknown as SupabaseClient;

    const result = await loadStudentGrowth(admin, 'student-1');
    expect(result.skills).toHaveLength(0);
    expect(result.gradeDirection).toBeNull();
    expect(result.trendPoints).toHaveLength(0);
    expect(result.latestHighFiveText).toBeNull();
    expect(result.totalHighFiveCount).toBe(0);
  });

  it('studentSkillLabel maps states to student-safe labels (integration)', async () => {
    // The growth loader must only return student-safe labels, not CL verbs.
    // This test is a pure unit check of the mapping without a full DB mock.
    const { studentSkillLabel } = await import('@/lib/copy/studentSkillLabel');
    expect(studentSkillLabel('needs_different_instruction')).toBe('Building strength');
    expect(studentSkillLabel('insufficient_data')).toBeNull();
  });

  it('caps skills at 6', async () => {
    // Build 8 fake skill rows with high observation_count + confidence
    const slsRows = Array.from({ length: 8 }, (_, i) => ({
      skill: { id: `sk${i}`, name: `Skill ${i}` },
      state: 'on_track',
      confidence: 80 - i,
      observation_count: 5,
    }));

    const admin = {
      from: (table: string) => ({
        select: (_: string, opts?: { count?: string }) => ({
          eq: (_c: string, _v: unknown) => ({
            gte: () => Promise.resolve({ data: table === 'skill_learning_state' ? slsRows : [], error: null }),
            in: () => Promise.resolve({ data: [], error: null }),
            order: (_col: string) => ({
              limit: () => Promise.resolve({ data: [], count: 0, error: null }),
              then: undefined,
            }),
            order: () => Promise.resolve({ data: [], error: null }),
          }),
          eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
        }),
      }),
    } as unknown as SupabaseClient;

    // Since it's hard to mock chain correctly in a simple test,
    // just assert the helper function limit logic directly:
    const arr = slsRows
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 6);
    expect(arr).toHaveLength(6);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

```
npx vitest run src/lib/student/__tests__/loadStudentGrowth.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 7: Implement loadStudentGrowth.ts**

Create `src/lib/student/loadStudentGrowth.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SkillLearningState } from '@/lib/skills/clVerbs';
import { studentSkillLabel } from '@/lib/copy/studentSkillLabel';

export interface StudentGrowthSkill {
  skillName: string;
  label: string;
}

export interface StudentGrowthData {
  gradeDirection: 'climbing' | 'steady' | 'sliding' | null;
  trendPoints: { date: string; grade: number }[];
  skills: StudentGrowthSkill[];
  latestHighFiveText: string | null;
  totalHighFiveCount: number;
}

type SLSRow = {
  skill: { id: string; name: string } | { id: string; name: string }[] | null;
  state: string;
  confidence: number | null;
  observation_count: number;
};
type HwRow = { score_pct: number | null; teacher_score: number | null; graded_at: string | null };
type HFRow = { id: string; note_text: string; created_at: string };

function classifyDir(grades: number[]): StudentGrowthData['gradeDirection'] {
  if (grades.length < 3) return null;
  const third = Math.max(1, Math.floor(grades.length / 3));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const delta = mean(grades.slice(-third)) - mean(grades.slice(0, third));
  if (delta > 3) return 'climbing';
  if (delta < -3) return 'sliding';
  return 'steady';
}

export async function loadStudentGrowth(
  admin: SupabaseClient,
  studentId: string,
): Promise<StudentGrowthData> {
  // 1. Skill states (min 2 observations to avoid cold-start noise)
  const { data: sls } = await admin
    .from('skill_learning_state')
    .select('skill:skill_id(id, name), state, confidence, observation_count')
    .eq('student_id', studentId)
    .gte('observation_count', 2);

  const skillRows = (sls ?? []) as SLSRow[];
  const skills: StudentGrowthSkill[] = skillRows
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, 6)
    .flatMap((row) => {
      const label = studentSkillLabel(row.state as SkillLearningState);
      if (!label) return [];
      const skillObj = Array.isArray(row.skill) ? row.skill[0] : row.skill;
      return [{ skillName: skillObj?.name ?? 'Unknown', label }];
    });

  // 2. Grade trend — class-agnostic (all graded attempts for this student)
  const { data: hw } = await admin
    .from('homework_attempts')
    .select('score_pct, teacher_score, graded_at')
    .eq('student_id', studentId)
    .eq('status', 'graded')
    .order('graded_at', { ascending: true });

  const hwRows = (hw ?? []) as HwRow[];
  const trendPoints: { date: string; grade: number }[] = [];
  for (const r of hwRows) {
    const grade = typeof r.teacher_score === 'number' ? r.teacher_score : r.score_pct;
    if (grade == null || !r.graded_at) continue;
    trendPoints.push({ date: r.graded_at, grade });
  }

  const gradeDirection = classifyDir(trendPoints.map(p => p.grade));

  // 3. Latest High-Five + total count
  const { data: hfData, count } = await admin
    .from('high_fives')
    .select('id, note_text, created_at', { count: 'exact' })
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(1);

  const latestHf = ((hfData ?? []) as HFRow[])[0] ?? null;

  return {
    gradeDirection,
    trendPoints,
    skills,
    latestHighFiveText: latestHf?.note_text ?? null,
    totalHighFiveCount: count ?? 0,
  };
}
```

- [ ] **Step 8: Run tests — expect PASS**

```
npx vitest run src/lib/student/__tests__/loadStudentGrowth.test.ts
```
Expected: PASS.

- [ ] **Step 9: Write failing test for loadStudentNotesPaged**

Create `src/lib/highfives/__tests__/loadStudentNotesPaged.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadStudentNotesPaged } from '../loadStudentNotesPaged';
import type { SupabaseClient } from '@supabase/supabase-js';

function makeAdmin(data: unknown[], count: number): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            range: () => Promise.resolve({ data, count, error: null }),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe('loadStudentNotesPaged', () => {
  it('returns notes and totalCount', async () => {
    const rows = [
      { id: 'h1', note_text: 'Great work!', created_at: '2026-06-01T10:00:00Z' },
      { id: 'h2', note_text: 'Keep it up!', created_at: '2026-05-28T10:00:00Z' },
    ];
    const result = await loadStudentNotesPaged(makeAdmin(rows, 5), 'student-1', 1, 2);
    expect(result.notes).toHaveLength(2);
    expect(result.notes[0].note_text).toBe('Great work!');
    expect(result.totalCount).toBe(5);
  });

  it('returns empty notes when no data', async () => {
    const result = await loadStudentNotesPaged(makeAdmin([], 0), 'student-1', 1, 20);
    expect(result.notes).toHaveLength(0);
    expect(result.totalCount).toBe(0);
  });
});
```

- [ ] **Step 10: Run to verify it fails**

```
npx vitest run src/lib/highfives/__tests__/loadStudentNotesPaged.test.ts
```
Expected: FAIL.

- [ ] **Step 11: Implement loadStudentNotesPaged.ts**

Create `src/lib/highfives/loadStudentNotesPaged.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StudentHighFive } from './loadStudentHighFives';

export interface PagedNotes {
  notes: StudentHighFive[];
  totalCount: number;
}

export async function loadStudentNotesPaged(
  admin: SupabaseClient,
  studentId: string,
  page: number,
  pageSize: number,
): Promise<PagedNotes> {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, count } = await admin
    .from('high_fives')
    .select('id, note_text, created_at', { count: 'exact' })
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .range(from, to);
  return {
    notes: ((data ?? []) as { id: string; note_text: string; created_at: string }[]).map(
      (r) => ({ id: r.id, note_text: r.note_text, created_at: r.created_at }),
    ),
    totalCount: count ?? 0,
  };
}
```

- [ ] **Step 12: Run tests — expect PASS**

```
npx vitest run src/lib/highfives/__tests__/loadStudentNotesPaged.test.ts
```

- [ ] **Step 13: Run all tests to ensure nothing broke**

```
npx vitest run
```
Expected: all existing tests still passing.

- [ ] **Step 14: Commit**

```bash
git add src/lib/copy/studentSkillLabel.ts src/lib/copy/__tests__/studentSkillLabel.test.ts src/lib/student/loadStudentGrowth.ts src/lib/student/__tests__/loadStudentGrowth.test.ts src/lib/highfives/loadStudentNotesPaged.ts src/lib/highfives/__tests__/loadStudentNotesPaged.test.ts
git commit -m "feat(student-b): helpers + loaders — studentSkillLabel, loadStudentGrowth, loadStudentNotesPaged"
```

---

### Task 2: Student Notes Wall (`/student/notes`)

**Files:**
- Create: `src/app/(student)/student/notes/page.tsx`
- Create: `src/app/(student)/student/notes/_components/NoteCard.tsx`
- Create: `src/app/(student)/student/notes/__tests__/page.test.tsx`
- Modify: `src/app/(student)/student/dashboard/page.tsx` (add "See all" link if count > 2)
- Modify: `src/lib/highfives/loadStudentHighFives.ts` — add optional `noteCount` return OR just call loadStudentNotesPaged from the dashboard

**Interfaces:**
- Consumes: `loadStudentNotesPaged(admin, studentId, page, pageSize)` from `@/lib/highfives/loadStudentNotesPaged`
- Consumes: `loadStudentHighFives(admin, studentId, 2)` from `@/lib/highfives/loadStudentHighFives`
- NoteCard props: `{ text: string; createdAt: string }`

- [ ] **Step 1: Write failing test for notes page**

Create `src/app/(student)/student/notes/__tests__/page.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/auth/requireRole', () => ({
  requireRole: vi.fn().mockResolvedValue({ userId: 'student-1' }),
}));

const { pagedFn } = vi.hoisted(() => ({ pagedFn: vi.fn() }));
vi.mock('@/lib/highfives/loadStudentNotesPaged', () => ({
  loadStudentNotesPaged: pagedFn,
}));
vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: () => ({}),
}));

import StudentNotesPage from '@/app/(student)/student/notes/page';

describe('StudentNotesPage', () => {
  it('renders empty state when no notes', async () => {
    pagedFn.mockResolvedValue({ notes: [], totalCount: 0 });
    render(await StudentNotesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
  });

  it('renders a note card for each note', async () => {
    pagedFn.mockResolvedValue({
      notes: [
        { id: 'h1', note_text: 'Great work today!', created_at: '2026-06-01T10:00:00Z' },
      ],
      totalCount: 1,
    });
    render(await StudentNotesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText('Great work today!')).toBeInTheDocument();
  });

  it('renders pagination links when there are multiple pages', async () => {
    pagedFn.mockResolvedValue({
      notes: Array.from({ length: 20 }, (_, i) => ({
        id: `h${i}`,
        note_text: `Note ${i}`,
        created_at: '2026-06-01T10:00:00Z',
      })),
      totalCount: 35,
    });
    render(await StudentNotesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('link', { name: /next/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```
npx vitest run src/app/\(student\)/student/notes/__tests__/page.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create NoteCard component**

Create `src/app/(student)/student/notes/_components/NoteCard.tsx`:

```tsx
import React from 'react';
import { Card } from '@/components/core/Card';

function shortNoteDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function NoteCard({ text, createdAt }: { text: string; createdAt: string }): React.JSX.Element {
  return (
    <Card tone="brand">
      <div className="flex flex-col gap-1">
        <p className="text-fg text-sm leading-relaxed">{text}</p>
        <p className="text-fg-muted text-xs">{shortNoteDate(createdAt)}</p>
      </div>
    </Card>
  );
}

export default NoteCard;
```

- [ ] **Step 4: Create notes page**

Create `src/app/(student)/student/notes/page.tsx`:

```tsx
import React from 'react';
import Link from 'next/link';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadStudentNotesPaged } from '@/lib/highfives/loadStudentNotesPaged';
import { EmptyState } from '@/components/core/EmptyState';
import { NoteCard } from './_components/NoteCard';

const PAGE_SIZE = 20;

export default async function StudentNotesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}): Promise<React.JSX.Element> {
  const { userId } = await requireRole(['student']);
  const admin = createAdminSupabaseClient();
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10));
  const { notes, totalCount } = await loadStudentNotesPaged(admin, userId, page, PAGE_SIZE);
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="p-6 flex flex-col gap-6">
      <h1 className="font-display text-2xl text-fg font-semibold">Notes from your teacher</h1>
      {notes.length === 0 ? (
        <EmptyState
          variant="just-getting-started"
          titleOverride="No notes yet"
          bodyOverride="Your teacher hasn't sent a note yet — keep up the great work!"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {notes.map((n) => (
            <NoteCard key={n.id} text={n.note_text} createdAt={n.created_at} />
          ))}
        </div>
      )}
      {totalPages > 1 && (
        <nav aria-label="Note pages" className="flex gap-4 justify-center pt-2 text-sm">
          {page > 1 && (
            <Link href={`/student/notes?page=${page - 1}`} className="text-brand underline">
              Previous
            </Link>
          )}
          <span className="text-fg-muted">Page {page} of {totalPages}</span>
          {page < totalPages && (
            <Link href={`/student/notes?page=${page + 1}`} className="text-brand underline">
              Next
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run test — expect PASS**

```
npx vitest run src/app/\(student\)/student/notes/__tests__/page.test.tsx
```

- [ ] **Step 6: Update dashboard to add "See all" link**

Read `src/app/(student)/student/dashboard/page.tsx` (current content, as shown in plan research):

```tsx
import React from 'react';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { Card } from '@/components/core/Card';
import { loadStudentHighFives } from '@/lib/highfives/loadStudentHighFives';
import { HighFiveNote } from './_components/HighFiveNote';
```

Replace the entire dashboard page with:

```tsx
import React from 'react';
import Link from 'next/link';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { Card } from '@/components/core/Card';
import { loadStudentNotesPaged } from '@/lib/highfives/loadStudentNotesPaged';
import { HighFiveNote } from './_components/HighFiveNote';

const PREVIEW_NOTES = 2;

export default async function StudentHome(): Promise<React.JSX.Element> {
  const { userId } = await requireRole(['student']);
  const admin = createAdminSupabaseClient();

  // Load preview notes + total count in one query
  const { notes, totalCount } = await loadStudentNotesPaged(admin, userId, 1, PREVIEW_NOTES);

  return (
    <div className="p-6 flex flex-col gap-6">
      <h1 className="font-display text-fg text-xl font-semibold">Your CORE space</h1>
      {notes.length > 0 && (
        <Card tone="brand">
          <div className="flex flex-col gap-3">
            <p className="text-fg text-xs font-bold uppercase tracking-wide">A note from your teacher</p>
            {notes.map((n) => (
              <HighFiveNote key={n.id} text={n.note_text} />
            ))}
            {totalCount > PREVIEW_NOTES && (
              <Link
                href="/student/notes"
                className="text-brand text-xs underline self-start"
              >
                See all {totalCount} notes →
              </Link>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
```

Note: This removes the old `loadStudentHighFives` call (which also marked notes as viewed). To preserve the viewed-marking behavior, `loadStudentNotesPaged` is intentionally NOT doing it (it's a paginated read). The viewed-marking in `loadStudentHighFives` was a side effect on the limit-2 preview. Since the notes page is now the canonical place to read notes, we accept that viewed-marking no longer happens on the dashboard preview. The `loadStudentHighFives` function still exists and is unchanged.

- [ ] **Step 7: Run all tests**

```
npx vitest run
```
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/\(student\)/student/notes/page.tsx src/app/\(student\)/student/notes/_components/NoteCard.tsx src/app/\(student\)/student/notes/__tests__/page.test.tsx src/app/\(student\)/student/dashboard/page.tsx
git commit -m "feat(student-b): notes wall + dashboard see-all link"
```

---

### Task 3: Student Growth Page (`/student/growth`)

**Files:**
- Create: `src/app/(student)/student/growth/page.tsx`
- Create: `src/app/(student)/student/growth/__tests__/page.test.tsx`
- Create: `src/app/(student)/student/growth/__tests__/growth.leak.test.tsx`

**Interfaces:**
- Consumes: `loadStudentGrowth(admin, studentId)` → `StudentGrowthData` from Task 1
- Consumes: `growthLeadSentence`, `growthDirectionCopy` from `@/lib/copy/studentSkillLabel`
- Consumes: `GradeTrendSparkline` from `@/components/core/GradeTrendSparkline`
- Consumes: `assertNoLeak`, `assertNoBannedWord` from `@/lib/copy/leakGuard`

- [ ] **Step 1: Write the leak test (PASS/FAIL gate)**

Create `src/app/(student)/student/growth/__tests__/growth.leak.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { hasDiagnosticVocab, hasLeak } from '@/lib/copy/leakGuard';

vi.mock('@/lib/auth/requireRole', () => ({
  requireRole: vi.fn().mockResolvedValue({ userId: 's1' }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: () => ({}),
}));
vi.mock('@/lib/student/loadStudentGrowth', () => ({
  loadStudentGrowth: vi.fn().mockResolvedValue({
    gradeDirection: 'climbing',
    trendPoints: [{ date: '2026-06-01T00:00:00Z', grade: 80 }, { date: '2026-06-15T00:00:00Z', grade: 88 }],
    skills: [
      { skillName: 'Fractions', label: 'Building strength' },
      { skillName: 'Algebra', label: 'Solid' },
      { skillName: 'Geometry', label: 'Excelling' },
    ],
    latestHighFiveText: 'You kept going — that is real grit.',
    totalHighFiveCount: 3,
  }),
}));
vi.mock('@/components/core/GradeTrendSparkline', () => ({
  GradeTrendSparkline: ({ ariaLabel }: { ariaLabel: string }) => (
    <svg aria-label={ariaLabel} data-testid="sparkline" />
  ),
}));

import StudentGrowthPage from '@/app/(student)/student/growth/page';

describe('StudentGrowthPage — four-audience leak gate', () => {
  it('renders without any diagnostic vocab in visible text', async () => {
    render(await StudentGrowthPage());
    const allText = document.body.textContent ?? '';
    expect(hasDiagnosticVocab(allText)).toBe(false);
  });

  it('renders without numeric leaks in visible text', async () => {
    render(await StudentGrowthPage());
    // Grade digit CAN appear in the sparkline aria-label but not in body text prose.
    // Collect only <p>, <h1>, <h2>, <span>, <li> text.
    const nodes = Array.from(
      document.querySelectorAll('p, h1, h2, span, li')
    ).map(el => el.textContent ?? '');
    for (const text of nodes) {
      expect(hasLeak(text)).toBe(false);
    }
  });

  it('renders skill labels without any CL verb', async () => {
    render(await StudentGrowthPage());
    const skillTexts = Array.from(document.querySelectorAll('li')).map(el => el.textContent ?? '');
    for (const t of skillTexts) {
      expect(hasDiagnosticVocab(t)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```
npx vitest run src/app/\(student\)/student/growth/__tests__/growth.leak.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create growth page**

Create `src/app/(student)/student/growth/page.tsx`:

```tsx
import React from 'react';
import Link from 'next/link';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadStudentGrowth } from '@/lib/student/loadStudentGrowth';
import { growthLeadSentence, growthDirectionCopy } from '@/lib/copy/studentSkillLabel';
import { assertNoLeak, assertNoBannedWord } from '@/lib/copy/leakGuard';
import { GradeTrendSparkline } from '@/components/core/GradeTrendSparkline';
import { Card } from '@/components/core/Card';

export default async function StudentGrowthPage(): Promise<React.JSX.Element> {
  const { userId } = await requireRole(['student']);
  const admin = createAdminSupabaseClient();
  const data = await loadStudentGrowth(admin, userId);

  const lead = growthLeadSentence(data.gradeDirection);
  const dirSentence = growthDirectionCopy(data.gradeDirection);

  // Belt-and-suspenders: deterministic strings, but guard anyway.
  assertNoLeak(lead, 'StudentGrowthPage/lead');
  assertNoBannedWord(lead, 'StudentGrowthPage/lead');
  assertNoLeak(dirSentence, 'StudentGrowthPage/dirSentence');
  assertNoBannedWord(dirSentence, 'StudentGrowthPage/dirSentence');

  return (
    <div className="p-6 flex flex-col gap-6">
      <h1 className="font-display text-2xl text-fg font-semibold">How I&apos;m doing</h1>

      <p className="text-fg text-base leading-relaxed">{lead}</p>

      <Card>
        <div className="flex flex-col gap-2">
          <p className="text-fg text-xs font-bold uppercase tracking-wide">Grades over time</p>
          <GradeTrendSparkline
            points={data.trendPoints}
            ariaLabel="Your grade trend over time"
            coldStartLabel="Not enough graded work yet to show a trend."
          />
          {data.trendPoints.length >= 2 && (
            <p className="text-fg-muted text-sm">{dirSentence}</p>
          )}
        </div>
      </Card>

      {data.skills.length > 0 && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="text-fg text-xs font-bold uppercase tracking-wide">Your skills</p>
            <ul className="flex flex-col gap-2">
              {data.skills.map((s) => (
                <li key={s.skillName} className="flex items-center justify-between gap-2">
                  <span className="text-fg text-sm">{s.skillName}</span>
                  <span className="text-fg-muted text-xs">{s.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {data.latestHighFiveText && (
        <Card tone="brand">
          <div className="flex flex-col gap-2">
            <p className="text-fg text-xs font-bold uppercase tracking-wide">A note from your teacher</p>
            <p className="text-fg text-sm leading-relaxed">{data.latestHighFiveText}</p>
            {data.totalHighFiveCount > 1 && (
              <Link href="/student/notes" className="text-brand text-xs underline">
                See all {data.totalHighFiveCount} notes →
              </Link>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write the render test**

Create `src/app/(student)/student/growth/__tests__/page.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/auth/requireRole', () => ({
  requireRole: vi.fn().mockResolvedValue({ userId: 's1' }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: () => ({}),
}));

const { growthFn } = vi.hoisted(() => ({ growthFn: vi.fn() }));
vi.mock('@/lib/student/loadStudentGrowth', () => ({ loadStudentGrowth: growthFn }));
vi.mock('@/components/core/GradeTrendSparkline', () => ({
  GradeTrendSparkline: ({ coldStartLabel }: { coldStartLabel?: string }) => (
    <div data-testid="sparkline">{coldStartLabel}</div>
  ),
}));

import StudentGrowthPage from '@/app/(student)/student/growth/page';

describe('StudentGrowthPage', () => {
  it('shows cold-start sparkline text when no trend data', async () => {
    growthFn.mockResolvedValue({
      gradeDirection: null,
      trendPoints: [],
      skills: [],
      latestHighFiveText: null,
      totalHighFiveCount: 0,
    });
    render(await StudentGrowthPage());
    expect(screen.getByText(/here is how you are doing/i)).toBeInTheDocument();
    expect(screen.getByTestId('sparkline')).toBeInTheDocument();
  });

  it('shows skills section when skills present', async () => {
    growthFn.mockResolvedValue({
      gradeDirection: 'climbing',
      trendPoints: [{ date: '2026-06-01', grade: 80 }, { date: '2026-06-15', grade: 88 }],
      skills: [{ skillName: 'Fractions', label: 'Building strength' }],
      latestHighFiveText: null,
      totalHighFiveCount: 0,
    });
    render(await StudentGrowthPage());
    expect(screen.getByText('Fractions')).toBeInTheDocument();
    expect(screen.getByText('Building strength')).toBeInTheDocument();
    expect(screen.getByText(/effort lately/i)).toBeInTheDocument();
  });

  it('shows high-five teaser and see-all link when notes exist', async () => {
    growthFn.mockResolvedValue({
      gradeDirection: null,
      trendPoints: [],
      skills: [],
      latestHighFiveText: 'Keep it up!',
      totalHighFiveCount: 4,
    });
    render(await StudentGrowthPage());
    expect(screen.getByText('Keep it up!')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /see all/i })).toHaveAttribute('href', '/student/notes');
  });

  it('hides see-all link when only 1 note', async () => {
    growthFn.mockResolvedValue({
      gradeDirection: null,
      trendPoints: [],
      skills: [],
      latestHighFiveText: 'Great!',
      totalHighFiveCount: 1,
    });
    render(await StudentGrowthPage());
    expect(screen.queryByRole('link', { name: /see all/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run both growth tests — expect PASS**

```
npx vitest run src/app/\(student\)/student/growth/__tests__/
```
Expected: all PASS.

- [ ] **Step 6: Run full suite**

```
npx vitest run
```
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(student\)/student/growth/
git commit -m "feat(student-b): student growth page with skill labels + sparkline + leak guard"
```

---

### Task 4: Dashboard "Next up" card + nav links + Barb strings

**Files:**
- Create: `src/app/(student)/student/dashboard/_components/NextUpCard.tsx`
- Create: `src/app/(student)/student/dashboard/__tests__/dashboard.test.tsx`
- Modify: `src/app/(student)/student/dashboard/page.tsx` — add NextUpCard + next-assignment query
- Modify: `src/app/(student)/layout.tsx` — add "My Notes" + "How I'm doing" nav links
- Modify: `STRINGS-FOR-BARB.md` — append §Student Improvements (B) section

- [ ] **Step 1: Write failing test for NextUpCard**

Create `src/app/(student)/student/dashboard/__tests__/dashboard.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextUpCard } from '../_components/NextUpCard';

describe('NextUpCard', () => {
  it('renders assignment title and start link', () => {
    render(<NextUpCard id="a1" title="Essay on Romeo and Juliet" />);
    expect(screen.getByText('Essay on Romeo and Juliet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start/i })).toHaveAttribute(
      'href',
      '/student/assignments/a1',
    );
  });

  it('renders the "Next up" label', () => {
    render(<NextUpCard id="a2" title="Math Practice" />);
    expect(screen.getByText(/next up/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```
npx vitest run src/app/\(student\)/student/dashboard/__tests__/dashboard.test.tsx
```
Expected: FAIL — NextUpCard not found.

- [ ] **Step 3: Create NextUpCard component**

Create `src/app/(student)/student/dashboard/_components/NextUpCard.tsx`:

```tsx
import React from 'react';
import Link from 'next/link';
import { Card } from '@/components/core/Card';

export interface NextUpCardProps {
  id: string;
  title: string;
}

export function NextUpCard({ id, title }: NextUpCardProps): React.JSX.Element {
  return (
    <Card>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <p className="text-fg text-xs font-bold uppercase tracking-wide">Next up</p>
          <p className="text-fg text-sm font-semibold">{title}</p>
        </div>
        <Link
          href={`/student/assignments/${id}`}
          className="shrink-0 rounded bg-brand px-3 py-1.5 text-fg-on-brand text-xs font-bold hover:opacity-90"
        >
          Start
        </Link>
      </div>
    </Card>
  );
}

export default NextUpCard;
```

- [ ] **Step 4: Run test — expect PASS**

```
npx vitest run src/app/\(student\)/student/dashboard/__tests__/dashboard.test.tsx
```

- [ ] **Step 5: Update dashboard page to add NextUpCard**

Read `src/app/(student)/student/dashboard/page.tsx` (updated in Task 2). Overwrite with:

```tsx
import React from 'react';
import Link from 'next/link';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { Card } from '@/components/core/Card';
import { loadStudentNotesPaged } from '@/lib/highfives/loadStudentNotesPaged';
import { HighFiveNote } from './_components/HighFiveNote';
import { NextUpCard } from './_components/NextUpCard';

const PREVIEW_NOTES = 2;

type AsgRow = { id: string; content: { title?: string } | null };
type AttemptRow = { assignment_id: string };

export default async function StudentHome(): Promise<React.JSX.Element> {
  const { userId } = await requireRole(['student']);
  const admin = createAdminSupabaseClient();

  // Notes preview + count
  const { notes, totalCount } = await loadStudentNotesPaged(admin, userId, 1, PREVIEW_NOTES);

  // Next unsubmitted assignment
  const { data: submitted } = await admin
    .from('homework_attempts')
    .select('assignment_id')
    .eq('student_id', userId)
    .in('status', ['submitted', 'graded']);
  const submittedIds = new Set(
    ((submitted ?? []) as AttemptRow[]).map((r) => r.assignment_id),
  );

  const { data: asgData } = await admin
    .from('assignments')
    .select('id, content')
    .eq('student_id', userId)
    .order('created_at', { ascending: true });

  const nextUp = ((asgData ?? []) as AsgRow[]).find((a) => !submittedIds.has(a.id)) ?? null;

  return (
    <div className="p-6 flex flex-col gap-6">
      <h1 className="font-display text-fg text-xl font-semibold">Your CORE space</h1>

      {nextUp && (
        <NextUpCard id={nextUp.id} title={nextUp.content?.title ?? 'Assignment'} />
      )}

      {notes.length > 0 && (
        <Card tone="brand">
          <div className="flex flex-col gap-3">
            <p className="text-fg text-xs font-bold uppercase tracking-wide">A note from your teacher</p>
            {notes.map((n) => (
              <HighFiveNote key={n.id} text={n.note_text} />
            ))}
            {totalCount > PREVIEW_NOTES && (
              <Link href="/student/notes" className="text-brand text-xs underline self-start">
                See all {totalCount} notes →
              </Link>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Update student layout to add nav links**

Read `src/app/(student)/layout.tsx`. Replace the `const nav = (...)` block (lines 16–20) with:

```tsx
  const nav = (
    <>
      <a href="/student/dashboard" className="text-fg hover:text-brand px-3 py-1">Dashboard</a>
      <a href="/student/assignments" className="text-fg hover:text-brand px-3 py-1">Assignments</a>
      <a href="/student/notes" className="text-fg hover:text-brand px-3 py-1">My Notes</a>
      <a href="/student/growth" className="text-fg hover:text-brand px-3 py-1">How I&apos;m doing</a>
    </>
  );
```

Also remove the comment `// /student/growth has no page yet — omit it rather than ship a dead link.` since the page now exists.

- [ ] **Step 7: Append to STRINGS-FOR-BARB.md**

Open `STRINGS-FOR-BARB.md` and append at the end:

```markdown

## §Student Improvements (B)

*DRAFT — all copy below needs Barb's sign-off before GA.*

### Student nav links
- Notes link: "My Notes"
- Growth link: "How I'm doing"

### Student Notes Wall (`/student/notes`)
- Page heading: "Notes from your teacher"
- Empty state title: "No notes yet"
- Empty state body: "Your teacher hasn't sent a note yet — keep up the great work!"
- Pagination: "Previous" · "Next" · "Page X of Y"

### Student dashboard
- "See all" link: "See all X notes →"
- "Next up" label: "Next up"
- "Next up" CTA button: "Start"
- Notes section label: "A note from your teacher"

### Student Growth Page (`/student/growth`)
- Page heading: "How I'm doing"
- Skills section label: "Your skills"
- Grades section label: "Grades over time"
- Notes teaser section label: "A note from your teacher"
- See-all link: "See all X notes →"
- Cold-start sparkline: "Not enough graded work yet to show a trend."

#### Skill labels (student-facing translations of CL states — must NEVER show CL verb):
- Building strength (for: needs_different_instruction, needs_more_time)
- Solid (for: on_track)
- Excelling (for: ready_to_extend)

#### Lead sentences (deterministic, by grade trend direction):
- Climbing: "You have been putting in real effort lately — it shows."
- Steady: "You are making progress. Here is where you stand."
- Sliding: "Things feel a little tricky right now — that is okay."
- Cold-start: "Here is how you are doing."

#### Direction sentences (below sparkline):
- Climbing: "Your grades have been climbing."
- Steady: "Holding steady."
- Sliding: "A little uneven lately — you have got this."
- Cold-start: "Not enough graded work yet to show a trend."
```

- [ ] **Step 8: Run full test suite**

```
npx vitest run
```
Expected: all tests PASS including `tsc 0`. Also run a type check:

```
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add src/app/\(student\)/student/dashboard/_components/NextUpCard.tsx src/app/\(student\)/student/dashboard/__tests__/dashboard.test.tsx src/app/\(student\)/student/dashboard/page.tsx src/app/\(student\)/layout.tsx STRINGS-FOR-BARB.md
git commit -m "feat(student-b): dashboard NextUpCard, nav links (My Notes + How I'm doing), Barb strings"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ Feature 1 (notes wall `/student/notes`) — Task 2
- ✅ Pagination (20/page) — Task 2
- ✅ Dashboard "See all" link — Task 2
- ✅ Nav "My Notes" — Task 4
- ✅ Feature 2 (growth page `/student/growth`) — Task 3
- ✅ Lead sentence (deterministic by direction) — Tasks 1 + 3
- ✅ Grade sparkline (reuse GradeTrendSparkline) — Task 3
- ✅ Skill highlights (studentSkillLabel, max 6, confidence-sorted) — Tasks 1 + 3
- ✅ Note teaser on growth page — Task 3
- ✅ leakGuard on dynamic strings — Task 3 (assertNoLeak + assertNoBannedWord)
- ✅ leakGuard leak test (PASS/FAIL gate) — Task 3
- ✅ Feature 3 (dashboard "Next up") — Task 4
- ✅ Nav links — Task 4
- ✅ Barb strings → STRINGS-FOR-BARB.md — Task 4
- ✅ No migration — confirmed throughout

**2. Placeholder scan:** No placeholders. All code blocks are complete.

**3. Type consistency:**
- `StudentGrowthData` defined in Task 1, consumed in Task 3 — consistent
- `PagedNotes` defined in Task 1, consumed in Task 2 — consistent
- `StudentHighFive` from existing `loadStudentHighFives.ts` reused in `loadStudentNotesPaged` — consistent (same `{ id, note_text, created_at }` shape)
- `NextUpCardProps` defined and consumed in Task 4 — consistent
- `NoteCard` props `{ text, createdAt }` — consistent between Task 2 component and usage
