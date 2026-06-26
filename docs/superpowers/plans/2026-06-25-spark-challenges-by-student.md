# SPARK Challenges — Group-by-Student + Drill-in + Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix the teacher SPARK Challenges page so a student appears ONCE (not once per challenge), with their challenges grouped under them — expandable to review each challenge's scores, plus a gradebook-style hover tooltip (challenge name + submission date).

**Architecture:** The flat per-student-per-challenge `assignments` rows already loaded by `loadChallenges` get grouped by student with a pure helper, then rendered by a new client component (`ChallengesList`) with expandable student rows + a single fixed-position tooltip (the exact gradebook pattern). `spark_completions` already holds everything for review — **no migration, no auth change**.

**Tech Stack:** Next.js 16 App Router, React 19, TS-strict, Tailwind v4 token-only (WCAG-AA gate), Vitest 4.

## Global Constraints

- **Four-audience:** this is a TEACHER surface — transfer % + scores + rubric are allowed (teacher-only). No change to student/parent surfaces. The loader is admin-client; the page already runs `requireRole(['teacher'])` (layout) + `guardClassAccess`.
- **Token-only Tailwind:** reuse the existing challenge/gradebook token classes (`border-sidebar-edge`, `bg-surface`, `shadow-sticker`, `text-fg`, `text-fg-muted`, `bg-ok-surface`/`text-ok-fg` etc., `outline-brand`). No hardcoded hex / arbitrary values. `npm run a11y` must pass.
- **Reuse the gradebook tooltip pattern verbatim** (GradebookGrid.tsx): a single `fixed z-40` `role="tooltip"` card (`pointer-events-none ... -translate-x-1/2 -translate-y-full rounded-md border-2 border-sidebar-edge bg-surface px-2 py-1 text-xs text-fg shadow-sticker`, positioned `style={{left, top: y-6}}`, first line bold); triggers `onMouseEnter`/`onMouseLeave`/`onFocus`/`onBlur`; **Escape dismisses** (WCAG 1.4.13); tooltip lines folded into the trigger's `aria-label` (SR path).
- **Coach-posture copy** (DRAFT → Barb): quiet mixed-state summary, soft engagement labels; no raw stats dump. Strings → `STRINGS-FOR-BARB.md §Spark Challenges`.
- **NO "Open in SPARK"** this pass (deferred — needs a net-new SPARK-side teacher-review build; Marvin: ship CORE fix now).
- **Test env headers:** pure-lib tests = node env (no header); component tests start with `// @vitest-environment jsdom` then `import '@/test/setup-dom';`.
- **Gates:** `npx tsc --noEmit` 0, `npx vitest run` green, `npm run build` 0 (a11y + tokens).

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/spark/loadChallenges.ts` (modify) | Select + expose `completedAt`/`effortLabel`/`revisionCount`/`teliHintCount` | 1 |
| `src/lib/spark/groupChallenges.ts` (create) | Pure: `groupChallengesByStudent` + `studentSummaryLabel` + `challengeTooltipLines` + `shortDate` | 2 |
| `src/app/(teacher)/challenges/_components/ChallengeCard.tsx` (rewrite) | Per-challenge detail row + hover-tooltip trigger | 3 |
| `src/app/(teacher)/challenges/_components/ChallengesList.tsx` (create) | Client: expandable student groups + the single fixed tooltip | 4 |
| `src/app/(teacher)/challenges/page.tsx` (modify) | Wire loader → group → `<ChallengesList>` | 5 |

---

### Task 1: Extend the loader with completion detail fields

**Files:** Modify `src/lib/spark/loadChallenges.ts`; Test `src/lib/spark/__tests__/loadChallenges.test.ts` (update).

**Interfaces:**
- Produces: `ChallengeRow` gains `completedAt: string | null`, `effortLabel: string | null`, `revisionCount: number | null`, `teliHintCount: number | null` (the rest unchanged).

- [ ] **Step 1: Update the test** — add the new columns to the `spark_completions` mock row and assert they flow into the `ChallengeRow`. (Read the existing test; add to the existing completed-challenge case: `completed_at: '2026-06-22T10:00:00Z', effort_label: 'persistent', revision_count: 2, teli_hint_count: 1` in the completion mock, and assert `challenges[i].completedAt === '2026-06-22T10:00:00Z'`, `.effortLabel === 'persistent'`, `.revisionCount === 2`, `.teliHintCount === 1`.)

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx vitest run src/lib/spark/__tests__/loadChallenges.test.ts`
Expected: FAIL (fields undefined / not selected).

- [ ] **Step 3: Implement**

In `loadChallenges.ts`, extend the `ChallengeRow` interface (add the four fields after `rubric`), extend `CompletionRow`:
```ts
interface CompletionRow {
  assignment_id: string;
  transfer_score: number | null;
  content_quality: 'engaged' | 'minimal' | 'non_engaged' | null;
  rubric_dimensions: Record<string, number | null> | null;
  completed_at: string | null;
  effort_label: string | null;
  revision_count: number | null;
  teli_hint_count: number | null;
}
```
Change the `spark_completions` select to:
```ts
.select('assignment_id, transfer_score, content_quality, rubric_dimensions, completed_at, effort_label, revision_count, teli_hint_count')
```
In the `.map`, add to the returned object:
```ts
completedAt: c?.completed_at ?? null,
effortLabel: c?.effort_label ?? null,
revisionCount: c?.revision_count ?? null,
teliHintCount: c?.teli_hint_count ?? null,
```

- [ ] **Step 4: Run the test, watch it pass.** `npx vitest run src/lib/spark/__tests__/loadChallenges.test.ts`

- [ ] **Step 5: Commit** — `git commit -m "feat(spark-challenges): loader exposes completed_at + effort/revision/hint detail"`

---

### Task 2: Pure grouping + label helpers

**Files:** Create `src/lib/spark/groupChallenges.ts`; Test `src/lib/spark/__tests__/groupChallenges.test.ts`.

**Interfaces:**
- Consumes: `ChallengeRow` (Task 1).
- Produces: `StudentChallengeGroup = { studentId, studentName, summary: {scored, inProgress, notStarted}, challenges: ChallengeRow[] }`; `groupChallengesByStudent(rows): StudentChallengeGroup[]`; `studentSummaryLabel(summary): string`; `shortDate(iso): string`; `challengeTooltipLines(row): string[]`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/spark/__tests__/groupChallenges.test.ts
import { describe, it, expect } from 'vitest';
import { groupChallengesByStudent, studentSummaryLabel, shortDate, challengeTooltipLines } from '@/lib/spark/groupChallenges';
import type { ChallengeRow } from '@/lib/spark/loadChallenges';

const base: Omit<ChallengeRow, 'assignmentId' | 'status' | 'completedAt'> = {
  studentId: 's1', studentName: 'Maya Chen', title: 'C', transferScore: null,
  contentQuality: null, rubric: null, effortLabel: null, revisionCount: null, teliHintCount: null,
};
const row = (o: Partial<ChallengeRow>): ChallengeRow =>
  ({ ...base, assignmentId: 'a', status: 'assigned', completedAt: null, ...o } as ChallengeRow);

describe('groupChallengesByStudent', () => {
  it('groups a student\'s challenges into one group', () => {
    const groups = groupChallengesByStudent([
      row({ studentId: 's1', studentName: 'Maya', assignmentId: 'a1', status: 'completed', completedAt: '2026-06-18T00:00:00Z' }),
      row({ studentId: 's1', studentName: 'Maya', assignmentId: 'a2', status: 'in_progress' }),
      row({ studentId: 's1', studentName: 'Maya', assignmentId: 'a3', status: 'completed', completedAt: '2026-06-22T00:00:00Z' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].summary).toEqual({ scored: 2, inProgress: 1, notStarted: 0 });
    // completed first, most-recent first; in_progress last
    expect(groups[0].challenges.map((c) => c.assignmentId)).toEqual(['a3', 'a1', 'a2']);
  });
  it('sorts students alphabetically', () => {
    const groups = groupChallengesByStudent([
      row({ studentId: 's2', studentName: 'Zoe', assignmentId: 'z1' }),
      row({ studentId: 's1', studentName: 'Abe', assignmentId: 'b1' }),
    ]);
    expect(groups.map((g) => g.studentName)).toEqual(['Abe', 'Zoe']);
  });
});

describe('studentSummaryLabel', () => {
  it('lists only non-zero states', () => {
    expect(studentSummaryLabel({ scored: 2, inProgress: 1, notStarted: 0 })).toBe('2 scored · 1 in progress');
    expect(studentSummaryLabel({ scored: 0, inProgress: 0, notStarted: 3 })).toBe('3 not started');
    expect(studentSummaryLabel({ scored: 0, inProgress: 0, notStarted: 0 })).toBe('No challenges yet');
  });
});

describe('shortDate + challengeTooltipLines', () => {
  it('formats a short date', () => {
    expect(shortDate('2026-06-22T10:00:00Z')).toMatch(/Jun 2[12]/); // tz-tolerant
    expect(shortDate(null)).toBe('');
  });
  it('tooltip: name + submitted date for scored, state otherwise', () => {
    expect(challengeTooltipLines(row({ title: 'Photosynthesis', status: 'completed', completedAt: '2026-06-22T10:00:00Z' }))[0]).toBe('Photosynthesis');
    expect(challengeTooltipLines(row({ status: 'completed', completedAt: '2026-06-22T10:00:00Z' }))[1]).toMatch(/^Submitted Jun 2[12]$/);
    expect(challengeTooltipLines(row({ status: 'in_progress' }))[1]).toBe('In progress — not submitted yet');
    expect(challengeTooltipLines(row({ status: 'assigned' }))[1]).toBe('Not started yet');
  });
});
```

- [ ] **Step 2: Run, watch it fail.** `npx vitest run src/lib/spark/__tests__/groupChallenges.test.ts` (module not found).

- [ ] **Step 3: Implement** `src/lib/spark/groupChallenges.ts`

```ts
// src/lib/spark/groupChallenges.ts — pure grouping + labels for the teacher Spark Challenges screen.
// Teacher surface (scores/dates allowed). Count-bearing copy is DRAFT → Barb.
import type { ChallengeRow } from '@/lib/spark/loadChallenges';

export interface StudentChallengeGroup {
  studentId: string;
  studentName: string;
  summary: { scored: number; inProgress: number; notStarted: number };
  challenges: ChallengeRow[];
}

const STATE_ORDER: Record<ChallengeRow['status'], number> = { completed: 0, in_progress: 1, assigned: 2 };

/** Group flat challenge rows by student. Within a student: scored (completed) first by completedAt
 *  desc, then in-progress, then not-started. Students sorted by name (stable, scannable). */
export function groupChallengesByStudent(rows: ChallengeRow[]): StudentChallengeGroup[] {
  const byStudent = new Map<string, ChallengeRow[]>();
  for (const r of rows) {
    const arr = byStudent.get(r.studentId);
    if (arr) arr.push(r); else byStudent.set(r.studentId, [r]);
  }
  const groups: StudentChallengeGroup[] = [];
  for (const [studentId, list] of byStudent) {
    const challenges = [...list].sort((a, b) => {
      const s = STATE_ORDER[a.status] - STATE_ORDER[b.status];
      if (s !== 0) return s;
      return (b.completedAt ?? '').localeCompare(a.completedAt ?? ''); // most-recent first
    });
    groups.push({
      studentId,
      studentName: list[0].studentName,
      summary: {
        scored: list.filter((c) => c.status === 'completed').length,
        inProgress: list.filter((c) => c.status === 'in_progress').length,
        notStarted: list.filter((c) => c.status === 'assigned').length,
      },
      challenges,
    });
  }
  groups.sort((a, b) => a.studentName.localeCompare(b.studentName));
  return groups;
}

/** Quiet mixed-state summary, e.g. "2 scored · 1 in progress". Only non-zero states. DRAFT → Barb. */
export function studentSummaryLabel(summary: StudentChallengeGroup['summary']): string {
  const parts: string[] = [];
  if (summary.scored > 0) parts.push(`${summary.scored} scored`);
  if (summary.inProgress > 0) parts.push(`${summary.inProgress} in progress`);
  if (summary.notStarted > 0) parts.push(`${summary.notStarted} not started`);
  return parts.join(' · ') || 'No challenges yet';
}

/** Short date e.g. "Jun 22". Rendered client-side (post-interaction), so no SSR/CSR mismatch. */
export function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Tooltip lines: challenge name (first, bold in the card) + submission date or current state.
 *  Mirrors the gradebook cellTooltipLines. DRAFT → Barb. */
export function challengeTooltipLines(row: ChallengeRow): string[] {
  const lines = [row.title];
  if (row.status === 'completed' && row.completedAt) lines.push(`Submitted ${shortDate(row.completedAt)}`);
  else if (row.status === 'in_progress') lines.push('In progress — not submitted yet');
  else lines.push('Not started yet');
  return lines;
}
```

- [ ] **Step 4: Run, watch it pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(spark-challenges): pure group-by-student + summary/tooltip helpers"`

---

### Task 3: Rewrite ChallengeCard as the per-challenge detail row

**Files:** Rewrite `src/app/(teacher)/challenges/_components/ChallengeCard.tsx`; Test `src/app/(teacher)/challenges/_components/__tests__/ChallengeCard.test.tsx` (rewrite).

**Interfaces:**
- Consumes: `ChallengeRow`, `transferWord`, `challengeTooltipLines`/`shortDate`.
- Produces: `ChallengeCard({ row, onTip, onHideTip })` where `onTip: (lines: string[], x: number, y: number) => void`, `onHideTip: () => void`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChallengeCard } from '../ChallengeCard';
import type { ChallengeRow } from '@/lib/spark/loadChallenges';

const base: ChallengeRow = {
  studentId: 's1', studentName: 'Maya', assignmentId: 'a1', title: 'Photosynthesis',
  status: 'completed', transferScore: 88, contentQuality: 'engaged',
  rubric: { use_of_evidence: 2, reasoning_strategy: 3 }, completedAt: '2026-06-22T10:00:00Z',
  effortLabel: 'persistent', revisionCount: 2, teliHintCount: 1,
};

describe('ChallengeCard', () => {
  it('scored: shows transfer word+%, engagement, rubric, and the date', () => {
    render(<ChallengeCard row={base} onTip={vi.fn()} onHideTip={vi.fn()} />);
    expect(screen.getByText('Photosynthesis')).toBeInTheDocument();
    expect(screen.getByText(/strong/i)).toBeInTheDocument();
    expect(screen.getByText(/88%/)).toBeInTheDocument();
    expect(screen.getByText(/engaged deeply/i)).toBeInTheDocument();
    expect(screen.getByText(/Evidence 2\/4/)).toBeInTheDocument();
    expect(screen.getByText(/Submitted Jun 2[12]/)).toBeInTheDocument();
  });
  it('in-progress: shows "not submitted yet", no score', () => {
    render(<ChallengeCard row={{ ...base, status: 'in_progress', transferScore: null, contentQuality: null, rubric: null, completedAt: null }} onTip={vi.fn()} onHideTip={vi.fn()} />);
    expect(screen.getByText(/not submitted yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
  it('hover fires onTip with the tooltip lines', () => {
    const onTip = vi.fn();
    render(<ChallengeCard row={base} onTip={onTip} onHideTip={vi.fn()} />);
    fireEvent.mouseEnter(screen.getByText('Photosynthesis'));
    expect(onTip).toHaveBeenCalledWith(expect.arrayContaining(['Photosynthesis']), expect.any(Number), expect.any(Number));
  });
});
```

- [ ] **Step 2: Run, watch it fail.**

- [ ] **Step 3: Implement** (rewrite `ChallengeCard.tsx`)

```tsx
// src/app/(teacher)/challenges/_components/ChallengeCard.tsx
// Per-challenge detail row inside an expanded student group. Teacher-only: transfer + engagement +
// rubric + date for scored ones; soft state for the rest. The title is the hover-tooltip trigger
// (name + submission date), mirroring the gradebook cell. Tokens only; deep-ink text.
'use client';
import React from 'react';
import type { ChallengeRow } from '@/lib/spark/loadChallenges';
import { transferWord } from '@/lib/spark/contract';
import { challengeTooltipLines, shortDate } from '@/lib/spark/groupChallenges';

const STATE_GLYPH: Record<ChallengeRow['status'], string> = { completed: '✓', in_progress: '◷', assigned: '○' };
const QUALITY_LABEL: Record<NonNullable<ChallengeRow['contentQuality']>, string> = {
  engaged: 'engaged deeply', minimal: 'engaged lightly', non_engaged: 'did not engage',
};
const RUBRIC_LABEL: Record<string, string> = {
  problem_understanding: 'Problem', reasoning_strategy: 'Reasoning', use_of_evidence: 'Evidence',
  creativity_application: 'Creativity', communication: 'Communication',
  reflection_metacognition: 'Reflection', collaboration: 'Collaboration',
};

function rubricParts(rubric: Record<string, number | null> | null): string[] {
  if (!rubric) return [];
  return Object.entries(rubric)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => `${RUBRIC_LABEL[k] ?? k} ${v}/4`);
}

export function ChallengeCard({
  row, onTip, onHideTip,
}: {
  row: ChallengeRow;
  onTip: (lines: string[], x: number, y: number) => void;
  onHideTip: () => void;
}): React.JSX.Element {
  const lines = challengeTooltipLines(row);
  const dateLabel = row.status === 'completed' && row.completedAt ? `Submitted ${shortDate(row.completedAt)}` : '';
  const effortBits: string[] = [];
  if (row.effortLabel) effortBits.push(row.effortLabel);
  if (row.revisionCount != null) effortBits.push(`${row.revisionCount} ${row.revisionCount === 1 ? 'revision' : 'revisions'}`);
  if (row.teliHintCount != null) effortBits.push(`${row.teliHintCount} ${row.teliHintCount === 1 ? 'hint' : 'hints'}`);
  const rubric = rubricParts(row.rubric);

  return (
    <div className="flex flex-col gap-1 rounded-md border-2 border-sidebar-edge bg-surface px-3 py-2">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-fg-muted">{STATE_GLYPH[row.status]}</span>
        <span
          tabIndex={0}
          aria-label={lines.join(', ')}
          className="rounded text-fg text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          onMouseEnter={(e) => onTip(lines, e.clientX, e.clientY)}
          onMouseLeave={onHideTip}
          onFocus={(e) => { const r = e.currentTarget.getBoundingClientRect(); onTip(lines, r.left + r.width / 2, r.top); }}
          onBlur={onHideTip}
          onKeyDown={(e) => { if (e.key === 'Escape') onHideTip(); }}
        >
          {row.title}
        </span>
      </div>
      {row.status === 'completed' ? (
        <div className="flex flex-col gap-0.5 pl-6 text-xs text-fg">
          <span>
            Transfer: <span className="font-semibold">{transferWord(row.transferScore)}</span>
            {row.transferScore != null && <> ({row.transferScore}%)</>}
            {row.contentQuality && <> · {QUALITY_LABEL[row.contentQuality]}</>}
            {dateLabel && <> · {dateLabel}</>}
          </span>
          {rubric.length > 0 && <span className="text-fg-muted">Rubric: {rubric.join(' · ')}</span>}
          {effortBits.length > 0 && <span className="text-fg-muted">{effortBits.join(' · ')}</span>}
        </div>
      ) : (
        <span className="pl-6 text-xs text-fg-muted">
          {row.status === 'in_progress' ? 'In progress — not submitted yet' : 'Not started yet'}
        </span>
      )}
    </div>
  );
}

export default ChallengeCard;
```

- [ ] **Step 4: Run, watch it pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(spark-challenges): ChallengeCard = per-challenge detail row + hover tooltip trigger"`

---

### Task 4: ChallengesList — expandable student groups + the tooltip

**Files:** Create `src/app/(teacher)/challenges/_components/ChallengesList.tsx`; Test `src/app/(teacher)/challenges/_components/__tests__/ChallengesList.test.tsx`.

**Interfaces:**
- Consumes: `StudentChallengeGroup`, `studentSummaryLabel`, `ChallengeCard`.
- Produces: `ChallengesList({ groups })`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChallengesList } from '../ChallengesList';
import type { StudentChallengeGroup } from '@/lib/spark/groupChallenges';
import type { ChallengeRow } from '@/lib/spark/loadChallenges';

const ch = (o: Partial<ChallengeRow>): ChallengeRow => ({
  studentId: 's1', studentName: 'Maya', assignmentId: 'a1', title: 'Photosynthesis', status: 'completed',
  transferScore: 88, contentQuality: 'engaged', rubric: null, completedAt: '2026-06-22T10:00:00Z',
  effortLabel: null, revisionCount: null, teliHintCount: null, ...o,
});
const groups: StudentChallengeGroup[] = [{
  studentId: 's1', studentName: 'Maya Chen', summary: { scored: 1, inProgress: 1, notStarted: 0 },
  challenges: [ch({}), ch({ assignmentId: 'a2', title: 'Osmosis', status: 'in_progress', transferScore: null, completedAt: null })],
}];

describe('ChallengesList', () => {
  it('collapsed: shows the student + summary, hides challenges', () => {
    render(<ChallengesList groups={groups} />);
    expect(screen.getByText('Maya Chen')).toBeInTheDocument();
    expect(screen.getByText('1 scored · 1 in progress')).toBeInTheDocument();
    expect(screen.queryByText('Photosynthesis')).not.toBeInTheDocument();
  });
  it('expands on click to reveal the challenges', () => {
    render(<ChallengesList groups={groups} />);
    fireEvent.click(screen.getByRole('button', { name: /Maya Chen/ }));
    expect(screen.getByText('Photosynthesis')).toBeInTheDocument();
    expect(screen.getByText('Osmosis')).toBeInTheDocument();
  });
  it('hovering a challenge shows the tooltip', () => {
    render(<ChallengesList groups={groups} />);
    fireEvent.click(screen.getByRole('button', { name: /Maya Chen/ }));
    fireEvent.mouseEnter(screen.getByText('Photosynthesis'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Photosynthesis');
  });
});
```

- [ ] **Step 2: Run, watch it fail.**

- [ ] **Step 3: Implement** `ChallengesList.tsx`

```tsx
// src/app/(teacher)/challenges/_components/ChallengesList.tsx
// Client: expandable student groups (one row per student) + a single fixed-position tooltip
// (the gradebook pattern). Teacher-only surface.
'use client';
import React, { useState } from 'react';
import type { StudentChallengeGroup } from '@/lib/spark/groupChallenges';
import { studentSummaryLabel } from '@/lib/spark/groupChallenges';
import { ChallengeCard } from './ChallengeCard';

export function ChallengesList({ groups }: { groups: StudentChallengeGroup[] }): React.JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tip, setTip] = useState<{ lines: string[]; x: number; y: number } | null>(null);

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="flex flex-col gap-2">
      {groups.map((g) => {
        const open = expanded.has(g.studentId);
        return (
          <div key={g.studentId} className="rounded-lg border-2 border-sidebar-edge bg-surface shadow-sticker">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => toggle(g.studentId)}
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="text-fg-muted">{open ? '▾' : '▸'}</span>
                <span className="text-fg text-sm font-semibold">{g.studentName}</span>
              </span>
              <span className="text-fg-muted text-xs">{studentSummaryLabel(g.summary)}</span>
            </button>
            {open && (
              <div className="flex flex-col gap-2 px-4 pb-3">
                {g.challenges.map((c) => (
                  <ChallengeCard
                    key={c.assignmentId}
                    row={c}
                    onTip={(lines, x, y) => setTip({ lines, x, y })}
                    onHideTip={() => setTip(null)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

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
    </div>
  );
}

export default ChallengesList;
```

- [ ] **Step 4: Run, watch it pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(spark-challenges): ChallengesList expandable student groups + fixed tooltip"`

---

### Task 5: Wire the page to group-by-student

**Files:** Modify `src/app/(teacher)/challenges/page.tsx`. (No new test — the existing component tests cover the rendering; the page is thin glue. If a page test exists, keep it green.)

- [ ] **Step 1: Implement** — replace the flat map with the grouped list.

Add imports:
```ts
import { groupChallengesByStudent } from '@/lib/spark/groupChallenges';
import { ChallengesList } from './_components/ChallengesList';
```
Remove the `import { ChallengeCard } from './_components/ChallengeCard';` line (ChallengeCard is now only used by ChallengesList).
After `const { challenges } = await loadChallenges(admin, classId);` add:
```ts
const groups = groupChallengesByStudent(challenges);
```
Replace the render branch:
```tsx
{challenges.length === 0 ? (
  <EmptyState
    variant="just-getting-started"
    titleOverride="No Spark Challenges yet"
    bodyOverride="Generate a SPARK-enabled assignment to start a challenge for this class."
  />
) : (
  <ChallengesList groups={groups} />
)}
```

- [ ] **Step 2: Type-check + the full gates** — `npx tsc --noEmit` (0), `npx vitest run src/lib/spark src/app/(teacher)/challenges` (green), then the controller runs the whole suite + `npm run build`.

- [ ] **Step 3: Commit** — `git commit -m "feat(spark-challenges): page renders grouped-by-student challenges"`

---

## Self-Review

- **Spec coverage:** (1) duplicate rows → grouped by student (Task 2/4/5); (2) drill-in to review submissions+scores → expandable rows with transfer/engagement/rubric/date (Task 3/4); (3) condense/categorize by student → `groupChallengesByStudent` (Task 2); (4) gradebook-style hover tooltip (name + submission date) → `challengeTooltipLines` + the fixed `role="tooltip"` card + Escape (Task 3/4).
- **No migration / no auth change.** Four-audience preserved (teacher-only). Tokens only. "Open in SPARK" intentionally deferred.
- **Type consistency:** `ChallengeRow` extended in Task 1 and consumed unchanged in 2/3/4; `StudentChallengeGroup` defined in Task 2, consumed in 4/5; `onTip`/`onHideTip` signatures match between `ChallengeCard` (Task 3) and `ChallengesList` (Task 4).
