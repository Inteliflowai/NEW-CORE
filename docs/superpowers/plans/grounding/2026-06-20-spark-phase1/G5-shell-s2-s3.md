# G5 — Grounding: Teacher app shell (S2 SPARK sticker + S3 CHALLENGES nav)

Branch: `feat/teacher-app-shell`. READ-ONLY grounding. All quotes verbatim with `file:line`.

---

## 1. `src/app/(teacher)/_components/TeacherSidebar.tsx` (FULL, 1–69)

```tsx
// src/app/(teacher)/_components/TeacherSidebar.tsx
// The Pop-Art rail: logo plate → Active class block → sectioned nav → user + sign-out.
// Token-only styling (sidebar-* tokens from globals.css); decorative texture/glow
// come from the .sidebar-dots / .sidebar-glow utilities.

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
      <div className="relative z-[1] flex h-full flex-col">
        {/* Logo plate */}
        <div className="flex justify-center px-4 pt-5 pb-3">
          <div className="inline-flex items-center justify-center rounded-xl bg-sidebar-plate px-3.5 py-2 shadow-sticker">
            <Image
              src="/images/brand/core-logo-white.png"
              alt="CORE"
              width={1700}
              height={760}
              priority
              className="h-14 w-auto"
            />
          </div>
        </div>

        {/* Active class */}
        <div className="px-4 pb-3">
          <ClassSwitcherPill />
        </div>

        {/* Nav */}
        <SidebarNav />

        {/* Footer: user + sign out */}
        <div className="flex flex-col gap-2 border-t border-sidebar-fg/20 p-3">
          <div className="flex items-center gap-2.5 rounded-xl bg-sidebar-fg/15 px-2.5 py-2">
            <span
              aria-hidden
              className="grid size-8 place-items-center rounded-full bg-sidebar-plate text-sm font-bold text-brand"
            >
              {initials}
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-bold text-sidebar-fg">{userName ?? 'Teacher'}</span>
              <span className="text-[11px] text-sidebar-fg-muted">Teacher</span>
            </span>
          </div>
          <form method="post" action="/logout">
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 rounded-lg border border-sidebar-edge bg-sidebar-danger px-3 py-2 text-sm font-bold text-fg-on-brand shadow-sticker"
            >
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

**Prop facts:**
- Prop name (the ONLY prop): `userName: string | null` — inline-typed, NO exported interface. (`TeacherSidebar.tsx:12`)
- Server Component (no `"use client"`).
- Logo plate block = lines 18–30. The `{/* Logo plate */}` `<div className="flex justify-center px-4 pt-5 pb-3">` wraps a `<div ... bg-sidebar-plate px-3.5 py-2 shadow-sticker">` holding the `next/image`. **The S2 SPARK sticker goes under this block** (between the closing `</div>` of the logo plate at line 30 and the `{/* Active class */}` block at line 32–35).
- Children render order inside `<div className="relative z-[1] flex h-full flex-col">`: Logo plate → Active class (`ClassSwitcherPill`) → `<SidebarNav />` → Footer.

---

## 2. Nav config + render

### 2a. `src/app/(teacher)/_components/navConfig.ts` (FULL, 1–70)

```ts
// src/app/(teacher)/_components/navConfig.ts
// Single source of truth for the teacher sidebar nav: the entries, the group
// structure, and the pure active-route matcher. Shared by SidebarNav and tests.
//
// Destinations are identical to the legacy TeacherNav (9 links); the grouping
// (CLASS / LIBRARY / INSIGHTS & TOOLS) follows the approved Pop-Art mockup.

export type NavIconKey =
  | 'today'
  | 'roster'
  | 'gradebook'
  | 'alerts'
  | 'highFive'
  | 'lessons'
  | 'quizzes'
  | 'insights'
  | 'upload';

export interface NavItem {
  label: string;
  href: string;
  icon: NavIconKey;
  /** Extra pathname prefixes that also mark this item active (beyond href itself). */
  alsoActiveWhen?: string[];
  badgeKey?: 'alerts';
}

export interface NavGroup {
  groupLabel: string;
  items: NavItem[];
}

export type NavEntry = NavItem | NavGroup;

export function isGroup(e: NavEntry): e is NavGroup {
  return 'groupLabel' in e;
}

export const NAV_ENTRIES: NavEntry[] = [
  { label: 'Today', href: '/today', icon: 'today' },
  {
    groupLabel: 'CLASS',
    items: [
      { label: 'Roster', href: '/roster', icon: 'roster', alsoActiveWhen: ['/students'] },
      { label: 'Gradebook', href: '/gradebook', icon: 'gradebook' },
      { label: 'Alerts', href: '/alerts', icon: 'alerts', badgeKey: 'alerts' },
      { label: 'High Fives', href: '/high-fives', icon: 'highFive' },
    ],
  },
  {
    groupLabel: 'LIBRARY',
    items: [
      { label: 'Lesson Library', href: '/library/lessons', icon: 'lessons' },
      { label: 'Quiz Library', href: '/library/quizzes', icon: 'quizzes' },
    ],
  },
  {
    groupLabel: 'INSIGHTS & TOOLS',
    items: [
      { label: 'Insights', href: '/insights', icon: 'insights' },
      { label: 'Upload', href: '/upload', icon: 'upload' },
    ],
  },
];

/** True when `pathname` is `href`, a sub-path of `href`, or matches an alias prefix. */
export function matchActive(pathname: string, href: string, alsoActiveWhen?: string[]): boolean {
  if (pathname === href || pathname.startsWith(href + '/')) return true;
  return (alsoActiveWhen ?? []).some((p) => pathname === p || pathname.startsWith(p + '/'));
}
```

**S3 facts for adding CHALLENGES → `/challenges` with a bolt icon:**
- `NavIconKey` is a closed union (lines 8–17). Adding a `bolt` icon requires **adding `'bolt'` to this union**.
- `NavItem` shape: `{ label, href, icon: NavIconKey, alsoActiveWhen?: string[], badgeKey?: 'alerts' }`.
- `NavEntry = NavItem | NavGroup`; `isGroup` discriminates by presence of `'groupLabel'`.
- A new CHALLENGES entry can be a top-level `NavItem` (like `Today`) or placed inside a group — both shapes are already iterated by `SidebarNav`.
- `matchActive(pathname, href, alsoActiveWhen?)` is the pure matcher — prefix-match on `href` plus aliases. No code change needed for a new straightforward `/challenges` route.

### 2b. `src/app/(teacher)/_components/SidebarNav.tsx` (FULL, 1–66)

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
  today: IconToday,
  roster: IconRoster,
  gradebook: IconGradebook,
  alerts: IconAlerts,
  highFive: IconHighFive,
  lessons: IconLessons,
  quizzes: IconQuizzes,
  insights: IconInsights,
  upload: IconUpload,
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
            {entry.items.map((i) => (
              <NavLink key={i.href} item={i} />
            ))}
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

**Active-state & icon-wiring facts (load-bearing for S3):**
- The `ICON` map (lines 11–21) is a `Record<NavIconKey, ...>` — **exhaustive over the union**. Adding `'bolt'` to `NavIconKey` REQUIRES adding a `bolt: IconBolt` entry here AND importing `IconBolt` (lines 6–9), or the build type-checks will fail.
- **Active nav state class** is applied in `NavLink` (lines 27–40): when `active`, classes are `'bg-sidebar-active text-sidebar-active-fg shadow-sticker'`; otherwise `'text-sidebar-fg hover:bg-sidebar-fg/15'`. Accessibility: `aria-current={active ? 'page' : undefined}` (line 30). Active = computed by `matchActive(pathname, item.href, item.alsoActiveWhen)` (line 24).
- `badgeKey?: 'alerts'` exists on `NavItem` but is NOT consumed in `SidebarNav` (no badge rendering present in this component).

---

## 3. `src/components/core/icons.tsx` — icon pattern + existing names

**Signature/pattern (lines 1–27):**

```tsx
// src/components/core/icons.tsx
// Inline-SVG icon kit for the teacher app shell. Stroke icons that inherit
// color via currentColor and accept a className for sizing. aria-hidden — the
// adjacent text label is the accessible name.

import React from 'react';

interface IconProps {
  className?: string;
}

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}
```

**Per-icon pattern (verbatim example, `IconUpload` lines 79–85):**

```tsx
export const IconUpload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M17 8l-5-5-5 5" />
    <path d="M12 3v12" />
  </Svg>
);
```

**Existing exported icon names (verbatim):**
`IconToday`, `IconRoster`, `IconGradebook`, `IconAlerts`, `IconHighFive`, `IconLessons`, `IconQuizzes`, `IconInsights`, `IconUpload`, `IconChevron`, `IconSignOut`, `IconMenu`.

**S3 facts:** There is NO `IconBolt` / lightning icon. A new one must follow the exact pattern: `export const IconBolt = (p: IconProps) => (<Svg {...p}>…</Svg>);` using `viewBox 0 0 24 24`, stroke-only paths (the `Svg` wrapper sets `fill="none" stroke="currentColor" strokeWidth={1.8}`). Then wire it in `SidebarNav.tsx`'s import + `ICON` map.

---

## 4. `public/images/brand/` assets (Glob + ls)

Confirmed present:
- `public/images/brand/spark.svg` — **EXISTS** (310,296 bytes / ~303KB). Valid SVG: `<svg version="1.1" id="Layer_1" … width="100%" viewBox="0 0 1071 481" enable-background="new 0 0 1071 481">`. First path `fill="#FEFEFE"`. NOTE it is a large multi-path illustration (not a tiny icon).
- `public/images/brand/core-logo-white.png` — 455,497 bytes (the logo currently used in `TeacherSidebar` logo plate).
- `public/images/brand/core-logo.png` — 68,411 bytes.
- `public/images/brand/core.svg` — 329,528 bytes.

No other files in the directory.

---

## 5. Sidebar tokens in `src/app/globals.css`

**Tier-2 `--sidebar*` slots (`:root` block, lines 127–135):**

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

**`@theme inline` color mappings (lines 290–298) — these create the `bg-sidebar`, `text-sidebar-fg`, etc. Tailwind utilities:**

```css
  /* Sidebar (teacher rail) tokens */
  --color-sidebar:            var(--sidebar);
  --color-sidebar-fg:         var(--sidebar-fg);
  --color-sidebar-fg-muted:   var(--sidebar-fg-muted);
  --color-sidebar-active:     var(--sidebar-active);
  --color-sidebar-active-fg:  var(--sidebar-active-fg);
  --color-sidebar-edge:       var(--sidebar-edge);
  --color-sidebar-plate:      var(--sidebar-plate);
  --color-sidebar-danger:     var(--sidebar-danger);
```

**`--shadow-sticker` token (in `@theme inline`, line 307):**

```css
  --shadow-sticker: 3px 3px 0 var(--sidebar-edge);
```

**`@utility` blocks (lines 329–345) — the only sidebar `@utility`s:**

```css
@utility sidebar-dots {
  background-image: radial-gradient(color-mix(in srgb, var(--white) 28%, transparent) 1.5px, transparent 1.7px);
  background-size: 13px 13px;
}
@utility sidebar-glow {
  &::after {
    content: "";
    position: absolute;
    width: 120px;
    height: 120px;
    top: -30px;
    right: -26px;
    border-radius: 9999px;
    pointer-events: none;
    background: radial-gradient(circle, color-mix(in srgb, var(--lime-400) 40%, transparent), transparent 70%);
  }
}
```

**SPARK-orange token: DOES NOT EXIST.** Grep for `orange`/`spark` in `globals.css` = 0 matches. There is also NO `--orange-*` Tier-1 ramp. Existing Tier-1 ramps: `--lime-*`, `--cobalt-*`, `--coral-*` (#fff1ee…#3e0f09), `--amber-*` (#fffbeb…#451a03), plus ink/emerald/white. The closest existing warm ramp to "orange" is `--coral-*` and `--amber-*`. If a SPARK-orange token is required for S2 styling, the planner must EITHER add a new `--spark*` Tier-2 slot (+ `--color-spark*` in `@theme inline`) backed by a Tier-1 ramp, OR reuse `--amber-*`/`--coral-*`. Per CLAUDE.md "no hardcoded hex / arbitrary `[var(--..)]`" + WCAG-AA contrast gate, a new token (not inline hex) is the conformant path.

---

## DISCREPANCY / RISK FLAGS

- **FLAG (S2 token):** No SPARK-orange token and no `--orange-*` ramp exist anywhere in `globals.css`. Any SPARK orange must be introduced as a new token (Tier-1 ramp + Tier-2 `--spark*` slot + `--color-spark*` mapping) to pass the un-bypassable WCAG-AA contrast gate; inline hex / arbitrary `[var(...)]` violate the token contract.
- **FLAG (S2 asset):** `spark.svg` is a large (~303KB) full-illustration SVG with `viewBox 0 0 1071 481` (wide aspect), NOT a compact sticker glyph. Rendered via `next/image` it needs explicit `width`/`height` matching that aspect ratio (mirroring how `core-logo-white.png` is sized `h-14 w-auto` in the logo plate).
- **FLAG (S3 type exhaustiveness):** `ICON` in `SidebarNav.tsx` is `Record<NavIconKey, …>`. Adding `'bolt'` to `NavIconKey` WITHOUT adding `bolt:` to the `ICON` map (and importing the new icon) is a TYPE ERROR caught by `npm run build` / `tsc --noEmit`. Both edits must land together.
- **FLAG (prop shape):** `TeacherSidebar` has exactly one inline-typed prop `userName: string | null` — no exported props interface to extend. `SidebarNav` takes NO props (active state derived internally via `usePathname`).
- **FLAG (active-class location):** Active styling is NOT centralized in a token/util; it is the conditional className in `NavLink` (`SidebarNav.tsx:33-35`): active → `bg-sidebar-active text-sidebar-active-fg shadow-sticker`. `aria-current="page"` is the a11y signal. A new CHALLENGES nav item inherits this automatically.
- **NOTE:** `badgeKey?: 'alerts'` is declared on `NavItem` but unused in `SidebarNav` (no badge render). If S3/SPARK wants a CHALLENGES badge, no existing render path covers it.
