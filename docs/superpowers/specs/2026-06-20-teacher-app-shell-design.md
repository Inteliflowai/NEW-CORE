# Teacher App Shell ("Pop-Art" rail) + CORE Branding — Design Spec

**Date:** 2026-06-20
**Status:** Approved direction (F · Pop-Art), ready for implementation plan
**Visual reference (locked):** `.superpowers/brainstorm/702198-1781953555/content/shell-f-final.html`
(plus the option set in `shell-funky.html` / `shell-directions.html` — for context only)

---

## 1. Goal

Replace the current header-only teacher chrome (a horizontal nav bar + `◆ CORE` text placeholder) with a **persistent left-sidebar app shell** in the approved **"Pop-Art" visual direction**, using the **real CORE logo**. This is the chrome that wraps every teacher screen, so it lifts all currently-live screens (Today, Roster, One Student) and every future teacher screen at once.

This is a **visual/structural shell change only** — no new data, no new write actions, no change to the four-audience content discipline. Existing class-switch behavior and auth are preserved exactly.

## 2. Scope

**In scope**
- A new left-sidebar shell for the **teacher route group** (`src/app/(teacher)/`).
- Real CORE logo on a snug white "plate", bigger and centered, at the top of the rail.
- Sectioned vertical nav (icons + group labels) ported from the current `TeacherNav` data, with the **lime sticker active state**.
- The class switcher restyled as an "Active class" block in the rail (same switch behavior), **plus a truthful sub-line** — `{subject} · {N} students` for the selected class, from a live active-enrollment count (requires extending `/api/teacher/classes`).
- A slim top bar (page title/breadcrumb left; greeting + help + avatar right; hamburger on mobile).
- User footer (name + role + initials avatar) and **Sign out** wired to the existing `/logout` route.
- Responsive: fixed rail on `lg+`, off-canvas drawer + hamburger below `lg`.
- New **sidebar design tokens** in `globals.css` (no hardcoded hex in components) + **WCAG-AA gate** coverage for the new pairs.

**Out of scope (future)**
- Shells for the other roles (student / parent / admin / super-admin) — they keep `RoleLayout` for now. `RoleLayout` and the `◆ CORE` text mark remain in use on auth pages and non-teacher routes; do not delete them.
- A functional help drawer, profile modal, notifications, or search — the top-bar help (`?`) and avatar are **presentational placeholders** this round.
- Any write action (high-five, notes, flag-for-reteach).
- Grade-level display and per-class color-coding in the rail — this round the sub-line shows **subject + live student count only**.

## 3. Global Constraints (binding — copied from project rules)

- **Tokens only.** No hardcoded hex and no arbitrary `[var(--..)]` in components. The pop-art palette is added as **named sidebar tokens** in `globals.css` (referencing existing Tier-1 ramps) and consumed via Tailwind token classes (`bg-sidebar`, `text-sidebar-fg`, `bg-sidebar-active`, …). Decorative-only values (halftone dot pattern, hard-offset shadow) live in `globals.css`, never inline in components.
- **WCAG-AA.** The `npm run a11y` gate (`scripts/a11y/contrast-check.ts`) must pass. Extend it with the new sidebar fg/bg pairs; every text pair ≥ 4.5:1.
- **"Assignments", never "Homework"** in any UI string (nav label is "Gradebook" — fine).
- **Four-audience discipline.** The shell is teacher-only chrome; it renders no student-facing surface, no mastery enum, no raw risk/score. (Trivially satisfied, but the final review still checks it.)
- **Auth chain unchanged.** `(teacher)/layout.tsx` keeps `await requireRole(['teacher'])` as the first call; no route becomes reachable that wasn't before.
- **Next.js 16 / App Router.** Server Components by default; `"use client"` only where browser state is needed (drawer toggle, `usePathname` active state, the existing class-switch fetch).

## 4. Visual Specification (the "Pop-Art" rail)

Rail width **256px**, full height, `overflow:hidden`, right edge a **3px solid ink** border.

- **Background:** `--sidebar` = `cobalt-700` (`#1d4ed8`), overlaid with a **halftone dot texture** (`radial-gradient` dots, `~13px` grid, low-opacity white) via a `globals.css` utility class, plus one soft **lime radial glow** bleed in the top-right corner (decorative, `pointer-events:none`).
- **Logo:** white **plate** (`bg-sidebar-plate` = white, `rounded`, **snug** padding ~`8px 14px`, **hard offset shadow** `3px 3px 0` in the edge ink), **centered** in the rail header, holding `public/images/brand/core-logo-white.png` (dark-wordmark variant, made for white bg) at **~60px tall**. Use `next/image` with explicit width/height.
- **"Active class" block:** small uppercase label (`text-sidebar-fg-muted`) + the class `<select>` restyled as a **white sticker** (white bg, ink border, `3px 3px 0` shadow, cobalt text). Below it, a truthful meta line `{subject} · {N} students` for the **selected** class — subject omitted if null, count from live active enrollments, pluralized.
- **Nav:** vertical list, grouped with uppercase section labels (`text-sidebar-fg-muted`). Each item = icon + label, `rounded-lg`, `text-sidebar-fg`, hover = subtle white wash.
  - **Active item = lime sticker:** `bg-sidebar-active` (`lime-400` `#a3e635`), `text-sidebar-active-fg` (`ink-950`), bold, **hard offset shadow** `3px 3px 0` ink. Icon inherits the dark active color.
  - Alerts item carries a small red count badge when relevant (static `2` in mockup; wire to real count later — for now render only if a count is passed, else omit).
- **Footer:** thin top divider; user row (white circular initials avatar, name in white, "Teacher" muted) + **Sign out** sticker button (filled `coral-600` for AA, white text, ink border, hard shadow) linking to `/logout`.
- **Content area & top bar stay light** (unchanged `--bg` / `--surface` / `--fg` teacher tokens) — the rail is the only dark surface. Top bar: white, bottom hairline border, page title/breadcrumb left, "Good morning, {name}" + `?` + initials avatar right, hamburger (mobile only) far left.
- **Fonts:** unchanged — Bricolage Grotesque (display) + Inter (body), already loaded in the root layout.

### New tokens (added to `globals.css`)

Define as Tier-2 slots referencing existing Tier-1 ramps, then expose via `@theme inline`:

| Token | Value (ramp) | Tailwind class | Purpose |
|---|---|---|---|
| `--sidebar` | `var(--cobalt-700)` `#1d4ed8` | `bg-sidebar` | rail background |
| `--sidebar-fg` | `var(--white)` | `text-sidebar-fg` | nav text / icons |
| `--sidebar-fg-muted` | `var(--cobalt-100)` `#dbeafe` | `text-sidebar-fg-muted` | section + class labels |
| `--sidebar-active` | `var(--lime-400)` `#a3e635` | `bg-sidebar-active` | active pill bg |
| `--sidebar-active-fg` | `var(--ink-950)` `#0a0a0a` | `text-sidebar-active-fg` | active pill text/icon |
| `--sidebar-edge` | `var(--ink-950)` | (border/shadow) | 3px edge + hard shadows |
| `--sidebar-plate` | `var(--white)` | `bg-sidebar-plate` | logo plate + sticker fills |
| `--sidebar-danger` | `var(--coral-600)` `#c93d29` | `bg-sidebar-danger` | sign-out fill (AA-safe) |
| `--shadow-sticker` | `3px 3px 0 var(--sidebar-edge)` | `shadow-sticker` | the pop-art hard shadow |

Plus a decorative utility `.sidebar-dots { background-image: radial-gradient(...); background-size: 13px 13px; }` and the corner glow as a second layered gradient — both decorative, no contrast requirement.

**Contrast check (must pass AA):** white / cobalt-700 ≈ 5.0:1 ✓ · cobalt-100 / cobalt-700 ≈ 5.1:1 ✓ · ink-950 / lime-400 ≈ 14:1 ✓ · white / coral-600 ≈ 5.2:1 ✓. These four pairs are added to `contrast-check.ts`.

## 5. Architecture & Files

### New files
- `src/components/core/icons.tsx` — small inline-SVG icon set (stroke, `currentColor`): `Today, Roster, Gradebook, Alerts, HighFive, Lessons, Quizzes, Insights, Upload, Chevron, SignOut, Menu`. Reusable kit; sized via `className`.
- `src/app/(teacher)/_components/navConfig.ts` — the nav data (sections + items + icon key + optional `alsoActiveWhen`), extracted so both the shell and tests share one source. Carries over the exact entries from today's `TeacherNav`.
- `src/app/(teacher)/_components/TeacherShell.tsx` — **client**. Owns mobile drawer `open` state; renders `<div data-role="teacher" data-intensity="calm">` → `TeacherSidebar` (fixed on `lg+`, off-canvas + backdrop below) + `<main>` (`TeacherTopbar` + `children`). Closes drawer on `usePathname` change. Props: `{ userName: string | null; children }`.
- `src/app/(teacher)/_components/TeacherSidebar.tsx` — the rail composition: logo plate + "Active class" block (`ClassSwitcherPill`) + `SidebarNav` + footer (user + Sign out).
- `src/app/(teacher)/_components/SidebarNav.tsx` — **client**. Renders `navConfig` vertically with icons, section labels, and active sticker state via `usePathname` (reuse today's active-match logic incl. `alsoActiveWhen`).
- `src/app/(teacher)/_components/TeacherTopbar.tsx` — **client**. Page title from pathname→label map, greeting, `?` placeholder, initials avatar, and a hamburger button (mobile) calling an `onMenuClick` prop.

### Modified files
- `src/app/(teacher)/layout.tsx` — fetch the teacher's display name (see §6), wrap `children` in `TeacherShell` instead of `RoleLayout`. Keep `requireRole(['teacher'])` first.
- `src/app/(teacher)/_components/ClassSwitcherPill.tsx` — restyle the `<select>` as the white "sticker" control inside an "Active class" labeled block; switch **behavior unchanged** (fetch, default-to-first, `?class=` flow). Now also renders the truthful sub-line (`{subject} · {N} students`) for the selected class from the extended payload.
- `src/app/api/teacher/classes/route.ts` — extend the payload: add `subject` to the `classes` select and a **live active-student count** per class (tally `enrollments` where `is_active = true`), returning `{ class_id, label, subject, student_count }` per class. Keep the existing per-role scoping (teacher / school_admin / sysadmin / platform_admin) + auth + 401/403/500 paths intact. Update its test.
- `src/app/globals.css` — add the sidebar token block, `@theme` mappings, `.sidebar-dots`, and `--shadow-sticker`.
- `scripts/a11y/contrast-check.ts` — add the four sidebar pairs above.
- `src/lib/auth/requireRole.ts` — additively return `fullName` (add `full_name` to the existing profile `select`; extend `AuthedContext`). Non-breaking for other callers. Update its test.

### Deleted
- `src/app/(teacher)/_components/TeacherNav.tsx` — superseded by `SidebarNav` + `navConfig`. Remove after no references remain.

## 6. Data flow

- `requireRole` already runs one `users` query; add `full_name` to its `select` and return `fullName` on `AuthedContext`. `(teacher)/layout.tsx` passes `fullName` to `TeacherShell` → topbar greeting + footer name; initials derived from the name (fallback "Teacher" / "T").
- `ClassSwitcherPill` keeps its own `/api/teacher/classes` fetch and `?class=` URL behavior verbatim. The endpoint now also returns `subject` + `student_count` (active enrollments tallied per class); the pill shows `{subject} · {N} students` for the selected class.
- Sign out: confirm `/logout` method during plan grounding; render the correct control (link for GET, or a `<form method="post" action="/logout">` button for POST).

## 7. Responsive behavior

- `lg+` (≥1024px): rail is a fixed 256px column; content fills the rest.
- `< lg`: rail is hidden off-canvas (`-translate-x-full`), slides in over a dimmed backdrop when the topbar hamburger is tapped; closes on backdrop click and on route change. Body scroll lock while open.
- Tap targets ≥ 40px; nav is keyboard-navigable; active item carries `aria-current="page"`.

## 8. Testing

- **SidebarNav** (jsdom): active item gets `aria-current="page"` and the active classes for `/roster` and for an `alsoActiveWhen` alias (`/students/...`); inactive items do not.
- **TeacherShell** (jsdom): drawer starts closed; hamburger opens it; backdrop click closes; a `usePathname` change closes it.
- **ClassSwitcherPill** (jsdom): existing behavior intact (renders options, defaults `?class=` to first, `onChange` replaces URL) — keep/adapt current tests; plus the sub-line shows `{subject} · {N} students` for the selected class and pluralizes ("1 student").
- **/api/teacher/classes** (node): payload now includes `subject` + `student_count`; the count reflects only `is_active` enrollments; per-role scoping + 401/403/500 paths unchanged.
- **requireRole** (node): updated for the additive `fullName` field; redirect paths unchanged.
- **a11y gate:** `npm run a11y` passes with the four new sidebar pairs.
- **Full suite + types:** existing 1204 tests stay green; `npx tsc --noEmit` clean; `npm run build` succeeds (prebuild runs the a11y gate).
- **Leak check:** final review confirms no raw score/enum/jargon enters the shell DOM (it's chrome; expected clean).

## 9. Risks / notes

- `RoleLayout` is shared; we stop using it **only** for teacher. Verify no teacher page imports it directly (only the layout does).
- Adding `full_name` to `requireRole` touches a shared auth helper — additive only; the plan must update the requireRole test and confirm other role layouts still compile.
- The halftone texture + hard shadows must come from `globals.css` classes/tokens, not inline arbitrary values, to satisfy the no-hardcoded-hex rule and keep the look centralized.
- This shell intentionally diverges from the other roles' (still text-mark) chrome; that's acceptable while only teacher screens are live. A later spec generalizes the shell per role.
