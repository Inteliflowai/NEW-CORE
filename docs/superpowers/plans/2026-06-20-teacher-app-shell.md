# Teacher App Shell ("Pop-Art" rail) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the teacher route group's header-only chrome with a persistent left-sidebar app shell in the approved "Pop-Art" direction, using the real CORE logo — lifting every teacher screen at once.

**Architecture:** A new client `TeacherShell` (owns mobile-drawer state) wraps `TeacherSidebar` (logo plate → "Active class" switcher → sectioned nav → user/sign-out footer) + a `<main>` containing `TeacherTopbar` + the page. `(teacher)/layout.tsx` swaps `RoleLayout` for `TeacherShell` but keeps `data-role="teacher" data-intensity="calm"` so all existing content tokens still resolve. The pop-art palette is added as named `--sidebar-*` tokens in `globals.css` (referencing existing Tier-1 ramps) and consumed via Tailwind token classes.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4 (`@theme inline`), Vitest 4 (+ jsdom for components), `next/image`, Supabase (`@supabase/ssr`).

**Visual reference (locked, on disk):** `.superpowers/brainstorm/702198-1781953555/content/shell-f-final.html` — the canonical look. Implementers should open it to match spacing/shape exactly.

**Spec:** `docs/superpowers/specs/2026-06-20-teacher-app-shell-design.md`.

## Global Constraints

- **Tokens only — no hardcoded hex, no arbitrary `[var(--..)]`, in components.** The pop-art palette lives as `--sidebar-*` tokens in `globals.css` (Task 1) and is used via classes `bg-sidebar`, `text-sidebar-fg`, `text-sidebar-fg-muted`, `bg-sidebar-active`, `text-sidebar-active-fg`, `bg-sidebar-plate`, `bg-sidebar-danger`, `border-sidebar-edge`, `shadow-sticker`. Decorative texture/glow live as `globals.css` utilities (`.sidebar-dots`, `.sidebar-glow`) using `color-mix`, never inline in components. Arbitrary **sizing** (e.g. `h-16`) is fine; arbitrary **colors** are not.
- **WCAG-AA.** `npm run a11y` must pass; Task 1 adds 4 sidebar pairs to the gate (all ≥ 4.5:1).
- **"Assignments", never "Homework"** in any UI string.
- **Four-audience discipline.** The shell is teacher-only chrome — no mastery enum, no raw risk/score, no student-facing leak. (Trivially true; final review still checks.)
- **Auth unchanged.** `(teacher)/layout.tsx` keeps `await requireRole(['teacher'])` first; no new route becomes reachable.
- **Server Components by default;** `"use client"` only where noted (SidebarNav, TeacherTopbar, TeacherShell, ClassSwitcherPill).
- **Component tests** start with `// @vitest-environment jsdom` then `import '@/test/setup-dom';` (mirror existing files). Route/helper tests run in the default node env.
- **Every task ends green:** the touched tests pass, and the change keeps `npx tsc --noEmit` clean. The full suite (currently 1204) + `npm run build` are verified in Task 11.

## File Structure

**Create**
- `src/components/core/icons.tsx` — inline-SVG icon kit (12 icons).
- `src/app/(teacher)/_components/navConfig.ts` — nav data + `matchActive` (pure, shared).
- `src/app/(teacher)/_components/SidebarNav.tsx` — vertical sectioned nav (client).
- `src/app/(teacher)/_components/TeacherTopbar.tsx` — slim top bar (client).
- `src/app/(teacher)/_components/TeacherSidebar.tsx` — rail composition.
- `src/app/(teacher)/_components/TeacherShell.tsx` — flex shell + drawer (client).
- Tests alongside each (see tasks).

**Modify**
- `src/app/globals.css` — sidebar tokens, `@theme` mappings, `.sidebar-dots`/`.sidebar-glow`, `--shadow-sticker`.
- `scripts/a11y/contrast-check.ts` — 4 sidebar pairs.
- `src/lib/auth/requireRole.ts` (+ its test) — additive `fullName`.
- `src/app/api/teacher/classes/route.ts` (+ new test) — `subject` + `student_count`.
- `src/app/(teacher)/_components/ClassSwitcherPill.tsx` (+ its test) — "Active class" block + sub-line + restyle.
- `src/app/(teacher)/layout.tsx` (+ `__tests__/layout.guard.test.tsx`) — use `TeacherShell`.

**Delete**
- `src/app/(teacher)/_components/TeacherNav.tsx` + its 3 test files (`TeacherNav.test.tsx`, `TeacherNav.library.test.tsx`, `TeacherNav.today.test.tsx`) — superseded by `SidebarNav`.

---

### Task 1: Sidebar design tokens + WCAG-AA gate

**Files:**
- Modify: `src/app/globals.css`
- Modify: `scripts/a11y/contrast-check.ts`
- Test: `npm run a11y` (the gate itself is the test)

**Interfaces:**
- Produces Tailwind utilities (via `@theme`): `bg-sidebar`, `text-sidebar-fg`, `text-sidebar-fg-muted`, `bg-sidebar-active`, `text-sidebar-active-fg`, `bg-sidebar-plate`, `bg-sidebar-danger`, `text-sidebar-edge`/`border-sidebar-edge`, `shadow-sticker`; CSS classes `.sidebar-dots`, `.sidebar-glow`.

- [ ] **Step 1: Add the sidebar Tier-2 slots to `:root`.** Insert just before the closing `}` of the `:root` block (after the `--shadow-pop` line, ~line 125):

```css
  /* Sidebar (teacher "pop-art" rail) — references Tier-1 ramps; consumed via bg-sidebar etc. */
  --sidebar:           var(--cobalt-700);
  --sidebar-fg:        var(--white);
  --sidebar-fg-muted:  var(--cobalt-100);
  --sidebar-active:    var(--lime-400);
  --sidebar-active-fg: var(--ink-950);
  --sidebar-edge:      var(--ink-950);
  --sidebar-plate:     var(--white);
  --sidebar-danger:    var(--coral-600);
```

- [ ] **Step 2: Expose them in `@theme inline`.** Add inside the `@theme inline { … }` block (after the `--color-risk-fg` line):

```css
  --color-sidebar:            var(--sidebar);
  --color-sidebar-fg:         var(--sidebar-fg);
  --color-sidebar-fg-muted:   var(--sidebar-fg-muted);
  --color-sidebar-active:     var(--sidebar-active);
  --color-sidebar-active-fg:  var(--sidebar-active-fg);
  --color-sidebar-edge:       var(--sidebar-edge);
  --color-sidebar-plate:      var(--sidebar-plate);
  --color-sidebar-danger:     var(--sidebar-danger);
  --shadow-sticker:           3px 3px 0 var(--sidebar-edge);
```

- [ ] **Step 3: Add decorative utilities** to the BASE STYLES section (end of file):

```css
/* Pop-art rail texture + corner glow (decorative; token-derived, no hardcoded hex) */
.sidebar-dots {
  background-image: radial-gradient(color-mix(in srgb, var(--white) 28%, transparent) 1.5px, transparent 1.7px);
  background-size: 13px 13px;
}
.sidebar-glow::after {
  content: "";
  position: absolute;
  width: 120px; height: 120px;
  top: -30px; right: -26px;
  border-radius: 9999px;
  pointer-events: none;
  background: radial-gradient(circle, color-mix(in srgb, var(--lime-400) 40%, transparent), transparent 70%);
}
```

- [ ] **Step 4: Extend the contrast gate.** In `scripts/a11y/contrast-check.ts`, after the `PAIRS` array (~line 338) add a sidebar pair list that resolves directly from `:root`:

```ts
// Sidebar (teacher rail) pairs — resolved from :root (not role/intensity-scoped).
// [label, fgProp, bgProp, requiredRatio]
const SIDEBAR_PAIRS: Array<[string, string, string, number]> = [
  ['sidebar-fg/sidebar',               '--sidebar-fg',        '--sidebar',        4.5],
  ['sidebar-fg-muted/sidebar',         '--sidebar-fg-muted',  '--sidebar',        4.5],
  ['sidebar-active-fg/sidebar-active', '--sidebar-active-fg', '--sidebar-active', 4.5],
  ['signout/sidebar-danger',           '--white',             '--sidebar-danger', 4.5],
];
```

Then in `checkAllPairs`, immediately before `return results;` (~line 487), append sidebar results using the parsed root props:

```ts
  // Sidebar pairs (single palette, resolved from :root).
  for (const [pairLabel, fgProp, bgProp, required] of SIDEBAR_PAIRS) {
    const fg = resolveToHex(`var(${fgProp})`, parsed.rootProps, `sidebar slot="${fgProp}"`);
    const bg = resolveToHex(`var(${bgProp})`, parsed.rootProps, `sidebar slot="${bgProp}"`);
    const ratio = contrastRatio(fg, bg);
    results.push({ role: 'sidebar', intensity: 'base', pair: pairLabel, fg, bg, ratio, required, passes: ratio >= required });
  }
```

- [ ] **Step 5: Run the gate.** Run: `npm run a11y`
  Expected: all pairs PASS, including the 4 new `sidebar/base` rows (white/cobalt-700 ≈ 5.0, cobalt-100/cobalt-700 ≈ 5.1, ink-950/lime-400 ≈ 14, white/coral-600 ≈ 5.2). If any sidebar pair fails, adjust the token (e.g. bump `--sidebar-fg-muted` to a lighter ramp stop) until it passes — **do not lower the threshold.**

- [ ] **Step 6: Commit.**
```bash
git add src/app/globals.css scripts/a11y/contrast-check.ts
git commit -m "feat(shell): add sidebar pop-art tokens + AA gate pairs"
```

---

### Task 2: Icon kit

**Files:**
- Create: `src/components/core/icons.tsx`
- Test: `src/components/core/__tests__/icons.test.tsx`

**Interfaces:**
- Produces named components, each `(props: { className?: string }) => React.JSX.Element` rendering an `aria-hidden` `<svg>` with `stroke="currentColor"`:
  `IconToday, IconRoster, IconGradebook, IconAlerts, IconHighFive, IconLessons, IconQuizzes, IconInsights, IconUpload, IconChevron, IconSignOut, IconMenu`.

- [ ] **Step 1: Write the failing test** (`icons.test.tsx`):

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { IconToday, IconRoster, IconSignOut } from '../icons';

describe('icons', () => {
  it('renders an aria-hidden svg that inherits color and accepts className', () => {
    const { container } = render(<IconToday className="size-4" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toBeInTheDocument();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('class')).toContain('size-4');
  });
  it('exports distinct icon components', () => {
    expect(IconRoster).not.toBe(IconSignOut);
  });
});
```

- [ ] **Step 2: Run it, expect fail** (`npx vitest run src/components/core/__tests__/icons.test.tsx`) — "Cannot find module '../icons'".

- [ ] **Step 3: Implement `icons.tsx`.** One shared wrapper + the 12 paths (copy the `<symbol>` path data verbatim from the mockup's `<svg>` defs):

```tsx
import React from 'react';

interface IconProps { className?: string }

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {children}
    </svg>
  );
}

export const IconToday = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/></Svg>;
export const IconRoster = (p: IconProps) => <Svg {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></Svg>;
export const IconGradebook = (p: IconProps) => <Svg {...p}><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h4"/></Svg>;
export const IconAlerts = (p: IconProps) => <Svg {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></Svg>;
export const IconHighFive = (p: IconProps) => <Svg {...p}><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.2l1-5.8L3.5 9.2l5.9-.9z"/></Svg>;
export const IconLessons = (p: IconProps) => <Svg {...p}><path d="M2 4h7a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H2z"/><path d="M22 4h-7a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H22z"/></Svg>;
export const IconQuizzes = (p: IconProps) => <Svg {...p}><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></Svg>;
export const IconInsights = (p: IconProps) => <Svg {...p}><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></Svg>;
export const IconUpload = (p: IconProps) => <Svg {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></Svg>;
export const IconChevron = (p: IconProps) => <Svg {...p}><path d="m6 9 6 6 6-6"/></Svg>;
export const IconSignOut = (p: IconProps) => <Svg {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></Svg>;
export const IconMenu = (p: IconProps) => <Svg {...p}><path d="M3 6h18M3 12h18M3 18h18"/></Svg>;
```

- [ ] **Step 4: Run the test, expect pass.**
- [ ] **Step 5: Commit.** `git add src/components/core/icons.tsx src/components/core/__tests__/icons.test.tsx && git commit -m "feat(shell): inline-SVG icon kit"`

---

### Task 3: Nav config + active matcher

**Files:**
- Create: `src/app/(teacher)/_components/navConfig.ts`
- Test: `src/app/(teacher)/_components/__tests__/navConfig.test.ts`

**Interfaces:**
- Produces: `type NavIconKey = 'today'|'roster'|'gradebook'|'alerts'|'highFive'|'lessons'|'quizzes'|'insights'|'upload'`; `interface NavItem { label; href; icon: NavIconKey; alsoActiveWhen?: string[]; badgeKey?: 'alerts' }`; `interface NavGroup { groupLabel; items: NavItem[] }`; `type NavEntry`; `function isGroup(e): e is NavGroup`; `const NAV_ENTRIES: NavEntry[]`; `function matchActive(pathname, href, alsoActiveWhen?): boolean`.
- Destinations identical to the old `TeacherNav` (9 links); grouping/labels follow the approved mockup: **CLASS / LIBRARY / INSIGHTS & TOOLS**.

- [ ] **Step 1: Write the failing test** (`navConfig.test.ts`, node env):

```ts
import { describe, it, expect } from 'vitest';
import { NAV_ENTRIES, isGroup, matchActive } from '../navConfig';

describe('navConfig', () => {
  it('has 9 destinations and 3 group labels, no "Homework"', () => {
    const labels: string[] = [];
    for (const e of NAV_ENTRIES) {
      if (isGroup(e)) { labels.push(e.groupLabel); e.items.forEach(i => labels.push(i.label)); }
      else labels.push(e.label);
    }
    for (const l of ['Today','Roster','Gradebook','Alerts','High Fives','Lesson Library','Quiz Library','Insights','Upload','CLASS','LIBRARY','INSIGHTS & TOOLS']) {
      expect(labels).toContain(l);
    }
    expect(labels.join(' ')).not.toMatch(/Homework/i);
  });
  it('matchActive: exact, prefix, and alsoActiveWhen', () => {
    expect(matchActive('/roster', '/roster')).toBe(true);
    expect(matchActive('/roster/x', '/roster')).toBe(true);
    expect(matchActive('/students/abc', '/roster', ['/students'])).toBe(true);
    expect(matchActive('/gradebook', '/roster')).toBe(false);
    // no false prefix match (/insights vs /insights-foo)
    expect(matchActive('/insights-foo', '/insights')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, expect fail.**
- [ ] **Step 3: Implement `navConfig.ts`:**

```ts
export type NavIconKey =
  | 'today' | 'roster' | 'gradebook' | 'alerts' | 'highFive'
  | 'lessons' | 'quizzes' | 'insights' | 'upload';

export interface NavItem {
  label: string;
  href: string;
  icon: NavIconKey;
  alsoActiveWhen?: string[];
  badgeKey?: 'alerts';
}
export interface NavGroup { groupLabel: string; items: NavItem[]; }
export type NavEntry = NavItem | NavGroup;

export function isGroup(e: NavEntry): e is NavGroup {
  return 'groupLabel' in e;
}

export const NAV_ENTRIES: NavEntry[] = [
  { label: 'Today', href: '/today', icon: 'today' },
  { groupLabel: 'CLASS', items: [
    { label: 'Roster', href: '/roster', icon: 'roster', alsoActiveWhen: ['/students'] },
    { label: 'Gradebook', href: '/gradebook', icon: 'gradebook' },
    { label: 'Alerts', href: '/alerts', icon: 'alerts', badgeKey: 'alerts' },
    { label: 'High Fives', href: '/high-fives', icon: 'highFive' },
  ]},
  { groupLabel: 'LIBRARY', items: [
    { label: 'Lesson Library', href: '/library/lessons', icon: 'lessons' },
    { label: 'Quiz Library', href: '/library/quizzes', icon: 'quizzes' },
  ]},
  { groupLabel: 'INSIGHTS & TOOLS', items: [
    { label: 'Insights', href: '/insights', icon: 'insights' },
    { label: 'Upload', href: '/upload', icon: 'upload' },
  ]},
];

export function matchActive(pathname: string, href: string, alsoActiveWhen?: string[]): boolean {
  if (pathname === href || pathname.startsWith(href + '/')) return true;
  return (alsoActiveWhen ?? []).some((p) => pathname === p || pathname.startsWith(p + '/'));
}
```

- [ ] **Step 4: Run the test, expect pass.**
- [ ] **Step 5: Commit.** `git commit -am "feat(shell): teacher nav config + active matcher"`

---

### Task 4: `requireRole` returns `fullName` (additive)

**Files:**
- Modify: `src/lib/auth/requireRole.ts`
- Test: update the existing `requireRole` test (find it under `src/lib/auth/__tests__/` — read it first).

**Interfaces:**
- `AuthedContext` gains `fullName: string | null`. All existing callers keep working (additive field).

- [ ] **Step 1:** Read the existing requireRole test. Add `full_name` to the mocked `users` profile row, and add an assertion `expect(ctx.fullName).toBe('<mocked name>')` to the success case. Run it — expect FAIL (field undefined).
- [ ] **Step 2: Implement.** In `requireRole.ts`: add `fullName: string | null;` to `AuthedContext`; change the profile select to `.select('role, school_id, full_name')`; return `{ userId: user.id, role, schoolId, fullName: (profile?.full_name ?? null) as string | null }`.
- [ ] **Step 3:** Run the requireRole test — expect PASS. Run `npx tsc --noEmit` to confirm no caller breaks (additive field is safe).
- [ ] **Step 4: Commit.** `git commit -am "feat(auth): requireRole returns fullName (additive)"`

---

### Task 5: `/api/teacher/classes` returns `subject` + `student_count`

**Files:**
- Modify: `src/app/api/teacher/classes/route.ts`
- Test: `src/app/api/teacher/classes/__tests__/classes.helpers.test.ts`

**Interfaces:**
- Payload item becomes `{ class_id: string; label: string; subject: string | null; student_count: number }`.
- Produces pure exports `tallyActiveCounts(rows: { class_id: string }[]): Record<string, number>` and `buildClassPayload(classes, counts)`.

- [ ] **Step 1: Write the failing test** for the pure helpers (node env):

```ts
import { describe, it, expect } from 'vitest';
import { formatClassLabel, tallyActiveCounts, buildClassPayload } from '../route';

describe('classes route helpers', () => {
  it('tallyActiveCounts counts rows per class_id', () => {
    expect(tallyActiveCounts([{class_id:'a'},{class_id:'a'},{class_id:'b'}])).toEqual({ a: 2, b: 1 });
    expect(tallyActiveCounts([])).toEqual({});
  });
  it('buildClassPayload merges label/subject/count, defaulting missing count to 0', () => {
    const classes = [{ id: 'a', name: 'Algebra', period: '3', subject: 'Math' }, { id: 'b', name: 'Geo', period: null, subject: null }];
    expect(buildClassPayload(classes, { a: 8 })).toEqual([
      { class_id: 'a', label: 'Algebra — Period 3', subject: 'Math', student_count: 8 },
      { class_id: 'b', label: 'Geo', subject: null, student_count: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Run it, expect fail** (helpers not exported).
- [ ] **Step 3: Implement.** In `route.ts`:
  - Add the subject column: `let query = admin.from('classes').select('id, name, period, subject');`
  - Add the pure helpers above `GET`:
```ts
export function tallyActiveCounts(rows: { class_id: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.class_id] = (out[r.class_id] ?? 0) + 1;
  return out;
}
type ClassRow = { id: string; name: string; period: string | null; subject: string | null };
export function buildClassPayload(classes: ClassRow[], counts: Record<string, number>) {
  return classes.map((c) => ({
    class_id: c.id,
    label: formatClassLabel({ name: c.name, period: c.period }),
    subject: c.subject ?? null,
    student_count: counts[c.id] ?? 0,
  }));
}
```
  - After the existing `if (dbError) …` guard, fetch active enrollments and build the payload (replace the current `result` mapping):
```ts
  const classIds = (classes ?? []).map((c) => c.id);
  let counts: Record<string, number> = {};
  if (classIds.length > 0) {
    const { data: enr, error: enrErr } = await admin
      .from('enrollments')
      .select('class_id')
      .in('class_id', classIds)
      .eq('is_active', true);
    if (enrErr) {
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
    counts = tallyActiveCounts((enr ?? []) as { class_id: string }[]);
  }
  const result = buildClassPayload((classes ?? []) as ClassRow[], counts);
  return NextResponse.json({ classes: result });
```
  Keep the auth + per-role scoping + 401/403 branches exactly as they are.
- [ ] **Step 4: Run the helper test, expect pass.** Run `npx tsc --noEmit`.
- [ ] **Step 5: Commit.** `git commit -am "feat(api): classes endpoint returns subject + active student_count"`

---

### Task 6: ClassSwitcherPill → "Active class" block + sub-line + rail restyle

**Files:**
- Modify: `src/app/(teacher)/_components/ClassSwitcherPill.tsx`
- Test: `src/app/(teacher)/_components/__tests__/ClassSwitcherPill.test.tsx` (update)

**Interfaces:**
- Consumes the extended payload `{ class_id, label, subject, student_count }`.
- Produces pure export `classMetaLine({ subject, student_count }): string`.

- [ ] **Step 1: Update the test.** Change `MOCK_CLASSES` to include `subject` + `student_count`:
```ts
const MOCK_CLASSES = [
  { class_id: 'c1', label: 'Algebra I — Period 3', subject: 'Mathematics', student_count: 8 },
  { class_id: 'c2', label: 'Geometry', subject: 'Mathematics', student_count: 1 },
];
```
Keep the 3 existing behavior tests. Add:
```ts
import { classMetaLine } from '../ClassSwitcherPill';
it('classMetaLine formats subject + pluralized count', () => {
  expect(classMetaLine({ subject: 'Mathematics', student_count: 8 })).toBe('Mathematics · 8 students');
  expect(classMetaLine({ subject: 'Mathematics', student_count: 1 })).toBe('Mathematics · 1 student');
  expect(classMetaLine({ subject: null, student_count: 12 })).toBe('12 students');
});
it('shows the selected class meta line', async () => {
  render(<ClassSwitcherPill />);
  await screen.findByText('Algebra I — Period 3');
  expect(screen.getByText('Mathematics · 8 students')).toBeInTheDocument();
});
```
Run — expect fail.

- [ ] **Step 2: Implement.** Add the `ClassOption` fields + the pure helper, and render the block. Keep the two `useEffect`s and `handleChange` **verbatim**. The selected option is `classes.find(c => c.class_id === (searchParams.get('class') ?? classes[0]?.class_id))`. Markup (token classes; the rail context is dark, so the select is a white "sticker"):

```tsx
export function classMetaLine({ subject, student_count }: { subject: string | null; student_count: number }): string {
  const noun = student_count === 1 ? 'student' : 'students';
  const count = `${student_count} ${noun}`;
  return subject ? `${subject} · ${count}` : count;
}
```
Render body (replacing the current `return`s; keep loading + empty states but restyle the wrappers for the dark rail):
```tsx
  if (loading) {
    return <div aria-busy="true" className="h-9 w-full rounded bg-sidebar-plate/20 animate-pulse" />;
  }
  if (!classes || classes.length === 0) {
    return <EmptyState variant="just-getting-started" />;
  }
  const selectedId = searchParams.get('class') ?? classes[0]?.class_id;
  const selected = classes.find((c) => c.class_id === selectedId) ?? classes[0];
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sidebar-fg-muted text-[10px] font-bold uppercase tracking-wider">Active class</p>
      <select
        onChange={handleChange}
        defaultValue={selectedId ?? undefined}
        aria-label="Active class"
        className="w-full rounded bg-sidebar-plate text-brand border border-sidebar-edge px-3 py-2 text-sm font-bold shadow-sticker focus:outline-none focus:ring-2 focus:ring-sidebar-active"
      >
        {classes.map((c) => (
          <option key={c.class_id} value={c.class_id}>{c.label}</option>
        ))}
      </select>
      <p className="text-sidebar-fg-muted text-[11px]">{classMetaLine(selected)}</p>
    </div>
  );
```
Update the `ClassOption` interface to add `subject: string | null; student_count: number;`.

- [ ] **Step 3: Run the test, expect pass.**
- [ ] **Step 4: Commit.** `git commit -am "feat(shell): Active class block with truthful subject + count sub-line"`

---

### Task 7: SidebarNav

**Files:**
- Create: `src/app/(teacher)/_components/SidebarNav.tsx`
- Test: `src/app/(teacher)/_components/__tests__/SidebarNav.test.tsx`

**Interfaces:**
- Client component, no props. Consumes `NAV_ENTRIES`, `isGroup`, `matchActive`, `usePathname`, and the icon kit.

- [ ] **Step 1: Write the failing test** — three pathname suites mirroring the old TeacherNav tests but with the new group labels (separate files to mock `usePathname` per file, OR one file resetting modules; mirror the existing one-pathname-per-file pattern — create `SidebarNav.test.tsx` for the `/students/abc` suite and reuse the existing structure):

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('next/navigation', () => ({ usePathname: () => '/students/abc' }));
import { SidebarNav } from '../SidebarNav';

describe('SidebarNav — /students/abc (Roster alias)', () => {
  it('renders 9 destinations + 3 group labels, no "Homework"', () => {
    render(<SidebarNav />);
    ['Today','Roster','Gradebook','Alerts','High Fives','Lesson Library','Quiz Library','Insights','Upload','CLASS','LIBRARY','INSIGHTS & TOOLS']
      .forEach((t) => expect(screen.getByText(t)).toBeInTheDocument());
    expect(screen.queryByText(/Homework/i)).toBeNull();
  });
  it('exactly one link is aria-current=page and it is Roster', () => {
    render(<SidebarNav />);
    const active = screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page');
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent('Roster');
  });
});
```
Also create `SidebarNav.library.test.tsx` (mock `/library/lessons/123` → Lesson Library) and `SidebarNav.today.test.tsx` (mock `/today` → Today), mirroring the existing TeacherNav variants.

- [ ] **Step 2: Run them, expect fail.**
- [ ] **Step 3: Implement `SidebarNav.tsx`** (match the mockup's nav markup; lime sticker active state):

```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ENTRIES, isGroup, matchActive, type NavItem, type NavIconKey } from './navConfig';
import {
  IconToday, IconRoster, IconGradebook, IconAlerts, IconHighFive,
  IconLessons, IconQuizzes, IconInsights, IconUpload,
} from '@/components/core/icons';

const ICON: Record<NavIconKey, (p: { className?: string }) => React.JSX.Element> = {
  today: IconToday, roster: IconRoster, gradebook: IconGradebook, alerts: IconAlerts,
  highFive: IconHighFive, lessons: IconLessons, quizzes: IconQuizzes, insights: IconInsights, upload: IconUpload,
};

function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const active = matchActive(pathname, item.href, item.alsoActiveWhen);
  const Icon = ICON[item.icon];
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={[
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
        active
          ? 'bg-sidebar-active text-sidebar-active-fg shadow-sticker'
          : 'text-sidebar-fg hover:bg-sidebar-fg/15',
      ].join(' ')}
    >
      <Icon className="size-[18px] shrink-0" />
      {item.label}
    </Link>
  );
}

export function SidebarNav() {
  return (
    <nav aria-label="Teacher navigation" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
      {NAV_ENTRIES.map((entry) =>
        isGroup(entry) ? (
          <div key={entry.groupLabel} className="flex flex-col gap-1">
            <span className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-sidebar-fg-muted">
              {entry.groupLabel}
            </span>
            {entry.items.map((i) => <NavLink key={i.href} item={i} />)}
          </div>
        ) : (
          <NavLink key={entry.href} item={entry} />
        ),
      )}
    </nav>
  );
}
export default SidebarNav;
```
> Note: `hover:bg-sidebar-fg/15` is a token-color opacity modifier (allowed — it references the `sidebar-fg` token, not a hardcoded hex).

- [ ] **Step 4: Run the 3 tests, expect pass.**
- [ ] **Step 5: Commit.** `git commit -am "feat(shell): SidebarNav (vertical sectioned nav, lime sticker active)"`

---

### Task 8: TeacherTopbar

**Files:**
- Create: `src/app/(teacher)/_components/TeacherTopbar.tsx`
- Test: `src/app/(teacher)/_components/__tests__/TeacherTopbar.test.tsx`

**Interfaces:**
- `TeacherTopbar(props: { userName: string | null; onMenuClick: () => void })` — client.
- Produces pure exports `pageTitleFor(pathname: string): string`, `initialsOf(name: string | null): string`, `greetingFor(hour: number): string`.

- [ ] **Step 1: Write the failing test:**

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
vi.mock('next/navigation', () => ({ usePathname: () => '/library/lessons/9' }));
import { TeacherTopbar, pageTitleFor, initialsOf, greetingFor } from '../TeacherTopbar';

describe('TeacherTopbar helpers', () => {
  it('pageTitleFor maps known prefixes', () => {
    expect(pageTitleFor('/today')).toBe('Today');
    expect(pageTitleFor('/students/abc')).toBe('Student');
    expect(pageTitleFor('/library/quizzes')).toBe('Quiz Library');
    expect(pageTitleFor('/nope')).toBe('CORE');
  });
  it('initialsOf', () => {
    expect(initialsOf('Ms. Mitchell')).toBe('MM');
    expect(initialsOf('Ana Silva')).toBe('AS');
    expect(initialsOf(null)).toBe('T');
  });
  it('greetingFor', () => {
    expect(greetingFor(9)).toBe('Good morning');
    expect(greetingFor(14)).toBe('Good afternoon');
    expect(greetingFor(20)).toBe('Good evening');
  });
});
describe('TeacherTopbar', () => {
  it('fires onMenuClick when the menu button is pressed', () => {
    const onMenuClick = vi.fn();
    render(<TeacherTopbar userName="Ms. Mitchell" onMenuClick={onMenuClick} />);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(onMenuClick).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run it, expect fail.**
- [ ] **Step 3: Implement `TeacherTopbar.tsx`:**

```tsx
'use client';
import { usePathname } from 'next/navigation';
import { IconMenu } from '@/components/core/icons';

const TITLE_MAP: Array<[string, string]> = [
  ['/today', 'Today'], ['/roster', 'Roster'], ['/students', 'Student'],
  ['/gradebook', 'Gradebook'], ['/alerts', 'Alerts'], ['/high-fives', 'High Fives'],
  ['/library/lessons', 'Lesson Library'], ['/library/quizzes', 'Quiz Library'],
  ['/insights', 'Insights'], ['/upload', 'Upload'],
];
export function pageTitleFor(pathname: string): string {
  const hit = TITLE_MAP.find(([p]) => pathname === p || pathname.startsWith(p + '/'));
  return hit ? hit[1] : 'CORE';
}
export function initialsOf(name: string | null): string {
  if (!name) return 'T';
  const parts = name.replace(/[^\p{L}\s.]/gu, '').split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  return letters || 'T';
}
export function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function TeacherTopbar({ userName, onMenuClick }: { userName: string | null; onMenuClick: () => void }) {
  const pathname = usePathname();
  const title = pageTitleFor(pathname);
  const initials = initialsOf(userName);
  const greeting = greetingFor(new Date().getHours());
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-fg-muted/15 bg-surface px-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onMenuClick} aria-label="Open menu"
          className="grid size-9 place-items-center rounded-full border border-fg-muted/20 text-fg-muted lg:hidden">
          <IconMenu className="size-5" />
        </button>
        <span className="text-sm font-semibold text-fg">{title}</span>
      </div>
      <div className="flex items-center gap-3.5">
        {userName && <span className="hidden text-sm text-fg-muted sm:inline">{greeting}, <b className="font-semibold text-fg">{userName}</b></span>}
        <span aria-hidden className="grid size-9 place-items-center rounded-full border border-fg-muted/20 font-bold text-fg-muted">?</span>
        <span aria-hidden className="grid size-9 place-items-center rounded-full bg-brand text-sm font-bold text-fg-on-brand">{initials}</span>
      </div>
    </header>
  );
}
export default TeacherTopbar;
```

- [ ] **Step 4: Run the test, expect pass.**
- [ ] **Step 5: Commit.** `git commit -am "feat(shell): TeacherTopbar (title, greeting, mobile menu button)"`

---

### Task 9: TeacherSidebar (rail composition)

**Files:**
- Create: `src/app/(teacher)/_components/TeacherSidebar.tsx`
- Test: `src/app/(teacher)/_components/__tests__/TeacherSidebar.test.tsx`

**Interfaces:**
- `TeacherSidebar(props: { userName: string | null })`. Composes logo plate + `ClassSwitcherPill` + `SidebarNav` + footer (user + Sign-out `<form method="post" action="/logout">`).

- [ ] **Step 1: Write the failing test** (mock the child clients to keep it focused):

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('../ClassSwitcherPill', () => ({ ClassSwitcherPill: () => <div data-testid="pill" /> }));
vi.mock('../SidebarNav', () => ({ SidebarNav: () => <nav data-testid="nav" /> }));
import { TeacherSidebar } from '../TeacherSidebar';

describe('TeacherSidebar', () => {
  it('renders the CORE logo, the class pill, the nav, the user name, and a POST sign-out', () => {
    render(<TeacherSidebar userName="Ms. Mitchell" />);
    expect(screen.getByAltText('CORE')).toBeInTheDocument();
    expect(screen.getByTestId('pill')).toBeInTheDocument();
    expect(screen.getByTestId('nav')).toBeInTheDocument();
    expect(screen.getByText('Ms. Mitchell')).toBeInTheDocument();
    const signout = screen.getByRole('button', { name: /sign out/i });
    expect(signout).toBeInTheDocument();
    expect(signout.closest('form')).toHaveAttribute('action', '/logout');
    expect(signout.closest('form')).toHaveAttribute('method', 'post');
  });
});
```

- [ ] **Step 2: Run it, expect fail.**
- [ ] **Step 3: Implement `TeacherSidebar.tsx`** (match the locked mockup; logo is 1700×760 → use `next/image` with intrinsic dims + CSS height). Note `next/image` needs the `<Image>` import:

```tsx
import Image from 'next/image';
import { ClassSwitcherPill } from './ClassSwitcherPill';
import { SidebarNav } from './SidebarNav';
import { IconSignOut } from '@/components/core/icons';
import { initialsOf } from './TeacherTopbar';

export function TeacherSidebar({ userName }: { userName: string | null }) {
  const initials = initialsOf(userName);
  return (
    <div className="sidebar-glow relative flex h-full flex-col overflow-hidden border-r-[3px] border-sidebar-edge bg-sidebar">
      <div className="sidebar-dots pointer-events-none absolute inset-0 opacity-50" aria-hidden />
      <div className="relative z-[1] flex flex-col h-full">
        {/* Logo plate */}
        <div className="flex justify-center px-4 pt-5 pb-3">
          <div className="inline-flex items-center justify-center rounded-xl bg-sidebar-plate px-3.5 py-2 shadow-sticker">
            <Image src="/images/brand/core-logo-white.png" alt="CORE" width={1700} height={760} priority className="h-14 w-auto" />
          </div>
        </div>
        {/* Active class */}
        <div className="px-4 pb-3"><ClassSwitcherPill /></div>
        {/* Nav */}
        <SidebarNav />
        {/* Footer */}
        <div className="flex flex-col gap-2 border-t border-sidebar-fg/20 p-3">
          <div className="flex items-center gap-2.5 rounded-xl bg-sidebar-fg/15 px-2.5 py-2">
            <span aria-hidden className="grid size-8 place-items-center rounded-full bg-sidebar-plate text-sm font-bold text-brand">{initials}</span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-bold text-sidebar-fg">{userName ?? 'Teacher'}</span>
              <span className="text-[11px] text-sidebar-fg-muted">Teacher</span>
            </span>
          </div>
          <form method="post" action="/logout">
            <button type="submit"
              className="flex w-full items-center gap-2.5 rounded-lg border border-sidebar-edge bg-sidebar-danger px-3 py-2 text-sm font-bold text-fg-on-brand shadow-sticker">
              <IconSignOut className="size-4" /> Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
export default TeacherSidebar;
```
> The `next.config.ts` is empty (no `images` config); local `public/` images need no remote-pattern allowlist, so `next/image` works as-is.

- [ ] **Step 4: Run the test, expect pass.**
- [ ] **Step 5: Commit.** `git commit -am "feat(shell): TeacherSidebar (logo plate, class block, nav, sign-out)"`

---

### Task 10: TeacherShell (flex layout + mobile drawer)

**Files:**
- Create: `src/app/(teacher)/_components/TeacherShell.tsx`
- Test: `src/app/(teacher)/_components/__tests__/TeacherShell.test.tsx`

**Interfaces:**
- `TeacherShell(props: { userName: string | null; children: React.ReactNode })` — client. Sets `data-role="teacher" data-intensity="calm"` on its root.

- [ ] **Step 1: Write the failing test:**

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
let path = '/today';
vi.mock('next/navigation', () => ({ usePathname: () => path }));
vi.mock('../TeacherSidebar', () => ({ TeacherSidebar: () => <div data-testid="sidebar" /> }));
import { TeacherShell } from '../TeacherShell';

describe('TeacherShell', () => {
  it('sets role/intensity and renders children + sidebar', () => {
    const { container } = render(<TeacherShell userName="X">hello</TeacherShell>);
    const root = container.querySelector('[data-role="teacher"]')!;
    expect(root.getAttribute('data-intensity')).toBe('calm');
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getAllByTestId('sidebar').length).toBeGreaterThan(0);
  });
  it('opens the drawer on menu click and closes it via the backdrop', () => {
    render(<TeacherShell userName="X">hi</TeacherShell>);
    expect(screen.queryByTestId('drawer-backdrop')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.getByTestId('drawer-backdrop')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('drawer-backdrop'));
    expect(screen.queryByTestId('drawer-backdrop')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, expect fail.**
- [ ] **Step 3: Implement `TeacherShell.tsx`** (real `TeacherTopbar`; sidebar rendered twice — a static `lg` column and a mobile drawer — both via `TeacherSidebar`; drawer state closes on pathname change):

```tsx
'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { TeacherSidebar } from './TeacherSidebar';
import { TeacherTopbar } from './TeacherTopbar';

export function TeacherShell({ userName, children }: { userName: string | null; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => { setOpen(false); }, [pathname]); // close drawer on navigation

  return (
    <div data-role="teacher" data-intensity="calm" className="flex h-screen overflow-hidden bg-bg text-fg">
      {/* Static rail on lg+ */}
      <aside className="hidden w-64 shrink-0 lg:block"><TeacherSidebar userName={userName} /></aside>

      {/* Mobile drawer */}
      {open && (
        <div data-testid="drawer-backdrop" onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-fg/50 lg:hidden" aria-hidden />
      )}
      <aside className={[
        'fixed inset-y-0 left-0 z-50 w-64 transition-transform lg:hidden',
        open ? 'translate-x-0' : '-translate-x-full',
      ].join(' ')}>
        <TeacherSidebar userName={userName} />
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TeacherTopbar userName={userName} onMenuClick={() => setOpen((o) => !o)} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
export default TeacherShell;
```

- [ ] **Step 4: Run the test, expect pass.**
- [ ] **Step 5: Commit.** `git commit -am "feat(shell): TeacherShell (responsive drawer layout)"`

---

### Task 11: Wire the layout, delete TeacherNav, full verification

**Files:**
- Modify: `src/app/(teacher)/layout.tsx`
- Modify: `src/app/(teacher)/__tests__/layout.guard.test.tsx`
- Delete: `src/app/(teacher)/_components/TeacherNav.tsx`, `__tests__/TeacherNav.test.tsx`, `__tests__/TeacherNav.library.test.tsx`, `__tests__/TeacherNav.today.test.tsx`

- [ ] **Step 1: Update the guard test** to mock the new import and include `fullName`:
```tsx
vi.mock('../_components/TeacherShell', () => ({ TeacherShell: ({ children }: { children: React.ReactNode }) => children }));
// remove the RoleLayout / TeacherNav / ClassSwitcherPill mocks
// in the success case:
requireRole.mockResolvedValue({ userId: 'u1', role: 'teacher', schoolId: 's1', fullName: 'Ms. Mitchell' });
```
Keep the assertion `expect(requireRole).toHaveBeenCalledWith(['teacher'])`.

- [ ] **Step 2: Rewrite `layout.tsx`:**
```tsx
import { TeacherShell } from './_components/TeacherShell';
import { requireRole } from '@/lib/auth/requireRole';

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const { fullName } = await requireRole(['teacher']);
  return <TeacherShell userName={fullName}>{children}</TeacherShell>;
}
```

- [ ] **Step 3: Delete `TeacherNav.tsx` + its 3 test files.** Then grep to confirm no remaining references: `git grep -n TeacherNav` → expect no hits.

- [ ] **Step 4: Full verification.**
  - `npx vitest run` → full suite green (count = prior 1204 minus 3 deleted TeacherNav suites' tests plus the new SidebarNav/Topbar/Shell/Sidebar/navConfig/helpers tests; **no failures**).
  - `npx tsc --noEmit` → clean.
  - `npm run build` → succeeds (its `prebuild` runs `npm run a11y`, which must pass with the new sidebar pairs).
- [ ] **Step 5: Manual smoke (optional but recommended):** `npm run dev`, log in as a teacher, confirm the rail renders with the real logo, nav active states work, the class sub-line shows real subject + count, and the mobile drawer toggles. (Live DB optional; the dev server + a seeded teacher works.)
- [ ] **Step 6: Commit.** `git commit -am "feat(shell): wire teacher layout to TeacherShell; remove old TeacherNav"`

---

## Notes for the executor

- **Visual fidelity:** open `.superpowers/brainstorm/702198-1781953555/content/shell-f-final.html` and match padding/radius/shadow. The mockup uses rgba whites for speed; the build uses the **solid tokens** from Task 1 instead.
- **Do not** reintroduce hardcoded hex or `[var(--..)]` color classes in components — only the Task-1 token classes + token-opacity modifiers (`/15`, `/20`) are allowed.
- **Other roles** keep `RoleLayout`; do not modify or delete it.
- Keep each task's commit green; the suite/build gate is Task 11.
