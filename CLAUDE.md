# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ Next.js 16 — verify before you code

This project runs **Next.js 16.2.9 with React 19** (see `AGENTS.md`). This is newer than most training data: APIs, conventions, and file structure may differ from what you remember (e.g. async `params`/`searchParams`, `cookies()`/`headers()` are async, caching defaults changed). The full version-matched docs are bundled locally — read the relevant guide before writing framework code:

```
node_modules/next/dist/docs/01-app/   # App Router (this project uses it)
```

Do not assume an API exists; confirm it against the bundled docs.

## Commands

```bash
npm run dev      # start dev server (Turbopack) at http://localhost:3000
npm run build    # production build (Turbopack) — also type-checks the whole project
npm run start    # serve the production build (run after `npm run build`)
npm run lint     # ESLint (flat config: next/core-web-vitals + next/typescript)
```

- **Type-checking:** there is no standalone `typecheck` script; `npm run build` runs the TypeScript pass. For a faster check without emitting, use `npx tsc --noEmit`.
- **Tests:** Vitest 4.x (+ `@testing-library/react`, `jsdom`). `npm test` (run-once) · `npm run test:watch` · single file: `npx vitest run <path>`. Default env is `node`; **React component tests must start with `// @vitest-environment jsdom` then `import '@/test/setup-dom';`** (the established pattern — follow each existing file's header). `npm run prebuild` runs the **un-bypassable WCAG-AA contrast gate** (`npm run a11y` → `scripts/a11y/contrast-check.ts`).

## Architecture

Standard Next.js App Router scaffold; the structure is conventional, so only the non-obvious points are noted:

- **App Router under `src/`.** Routes live in `src/app/`. `layout.tsx` is the root layout (wraps every page); `page.tsx` is a route's UI. New routes are folders under `src/app/` containing a `page.tsx`; API routes are `route.ts` files. Server Components are the default — add `"use client"` only when a component needs browser APIs or state.
- **Import alias:** `@/*` maps to `src/*` (`tsconfig.json`). Prefer `@/...` over long relative paths.
- **Styling:** Tailwind CSS **v4**, configured via `@tailwindcss/postcss` in `postcss.config.mjs` — there is no `tailwind.config.js`. Global styles and Tailwind layers are in `src/app/globals.css`.
- **`next.config.ts`** is currently empty; add framework config there (TypeScript, not JSON).
- **`AGENTS.md`** holds the cross-tool agent rules and is the source of the Next.js-version warning above.

## CORE v2 — status, disciplines & roadmap (read before building features)

**Product framing.** V2 is a **Beta, not an MVP** — a re-build of the proven V1 product (`C:/users/inteliflow/core`, the UX/feature reference) to contract scope. Pilots are the feedback engine before a fully-tested GA. Aim for **V1-parity** on the pilot-relevant surface; don't trim to a bare MVP, don't gold-plate beyond V1.

**Decision trail is in memory.** `MEMORY.md` (auto-loaded) indexes the project decisions — **read it first.** Designs live under `docs/superpowers/specs/`, plans under `docs/superpowers/plans/` (each plan has a `grounding/` folder of verbatim current-code facts + a review log).

**Built, merged & DEPLOYED LIVE** (`main`; production at **newcore.inteliflowai.com**). Snapshot as of 2026-06-20:
- **Foundation (Plan 4b):** demo seed (`scripts/seedDemo.ts`/`resetDemo.ts`, `src/lib/demo/`), `provisionTrial` engine + trial libs (`src/lib/trial/`), `GET /api/teacher/classes` + `STAFF_ROLES`, shared component kit (`src/components/core/`), copy helpers (`src/lib/copy/`), super-admin `POST /api/admin/provision-trial` + `(super-admin)/provision`.
- **Auth-entry UI (merged, `dd44648`):** universal `/login` (slide-image design), `/set-password`, `/logout`, `/trial-expired`, `auth/callback`, proxy gate + 5 per-role layout guards. Every surface is now reachable.
- **Teacher pop-art app shell + screens (built + deployed, `2de43ef`):** `(teacher)/_components/TeacherShell` = cobalt rail + lime active sticker + real CORE logo on white plate; `TeacherSidebar`/`SidebarNav`/`TeacherTopbar`; the teacher screens exist (Today, Roster, Spark Challenges, Gradebook, Alerts, High-fives, Insights, Library, Upload, student drill-in).
- **SPARK integration — Phase 1 + Phase 2, ALL merged + deployed live** (V2 `main` `64e92b9`, SPARK repo `master` `15c7085`): teacher half (create-notify, completion ingestion, `/challenges`), student launch (`(student)/student/assignments` + `POST /api/attempts/spark-launch`, hand-rolled HS256 JWT), super-admin `(super-admin)/schools` + `POST /api/admin/spark-enable` (one-click BOTH-sided provisioning), SPARK-repo `POST /api/integration/provision-school`. Routes verified live. **Each CORE school maps 1:1 to its own SPARK school** (`resolveCoreBaseUrl` uses `.maybeSingle()`). V2 demo→dedicated SPARK school `c4d2d2db`; V1 untouched.
- **Standing recommendation:** ROTATE `CORE_SPARK_API_SECRET` (the literal lived in private-repo git history); now also affects the launch JWT.

**Binding disciplines (non-negotiable on every surface):**
- **Four-audience discipline:** student/parent surfaces never show the mastery-band enum or a raw risk number (band label only); CL verbs / diagnoses / divergence / misconceptions are **teacher-only**; growth is "you vs your own past" (never peer-relative, never fabricated — cold-start instead); observational, not diagnostic. Enforced at the string boundary in `src/lib/copy/` (pure helpers + `leakGuard`).
- **"Assignments", never "Homework"** in any UI/copy (legacy term survives only in DB identifiers like `homework_attempts`).
- **WCAG-AA + deep-ink:** no hardcoded hex / arbitrary `[var(--..)]` in components — Tier-2 token classes only; content text is deep-ink (`text-fg`), not `text-fg-muted`.
- **Auth chain (every protected route):** `await createServerSupabaseClient()` → `auth.getUser()` → STAFF_ROLES gate → object-level IDOR guard (`src/lib/auth/guards.ts`) → `createAdminSupabaseClient()` (synchronous; reads `SUPABASE_SECRET_KEY`; **bypasses RLS — RLS is NOT the IDOR backstop**).

**Dev workflow.** Brainstorm → spec → `writing-plans` → **subagent-driven-development** (fresh implementer per task + task review + final whole-branch review). Ledger at `.git/sdd/progress.md`. **The in-house adversarial Workflow is the primary review** — Codex has been unreliable/hung; don't block on it.

**IN PROGRESS (this session, 2026-06-20) — teacher-shell visual polish.** Marvin logged in live as a teacher and gave 3 pieces of feedback; all diagnosed in code, fixes pending:
1. **SPARK sticker lost its tilt.** It was tilted (cool) in the preview, now straight. `(teacher)/_components/TeacherSidebar.tsx` ~L32-44 — the SPARK sticker `<div>` has NO rotate class. Fix: restore a slight pop-art tilt (e.g. `-rotate-3`; standard utility, not a color token, so it's allowed).
2. **Today / Roster / Spark Challenges look dull ("meh", too dull, more pizzazz/life).** Root cause: the rail's pop-art energy (shadow-sticker, `.sidebar-dots`, `.sidebar-glow`, lime active) does NOT carry into the plain-white content area — screens are just `p-6`, a `font-display` h1, a gray sentence, plain cards. Fix: inject pop-art using EXISTING tokens only — `font-display` (Bricolage), `shadow-sticker` (3px3px0 edge) / `shadow-pop`, `brand`/`brand-surface`/`brand-fg`, `ok`/`warn`/`risk` + their `-surface`/`-fg`, tilts. WCAG-AA contrast gate + four-audience leak rules remain binding (no mastery enums/raw risk to non-teachers).
3. **Class-picker FLASH on every navigation** (only 1 class, yet "pick a class" appears+disappears each click). Root cause: `SidebarNav` links are bare hrefs (`/roster`, no `?class=`) → each nav lands param-less → server page renders the `PICK_A_CLASS` EmptyState → persistent `ClassSwitcherPill` effect `router.replace`s `?class=` back → re-render. Fix: nav links must carry the current `?class=` (read via `useSearchParams` in `SidebarNav`); optional belt-and-suspenders = server pages default to the only/first class instead of PICK_A_CLASS.

**Design-system facts (just learned, `src/app/globals.css`):** 3-tier tokens (Tier-1 ramps → Tier-2 semantic slots → `@theme inline`). Teacher = cobalt brand, `sidebar-active` = lime-400. Pop-art primitives: `--shadow-sticker: 3px 3px 0 var(--sidebar-edge)`, `--shadow-pop`, `@utility sidebar-dots`/`sidebar-glow` (currently sidebar-scoped — a content-area equivalent may be worth adding), `--font-display` (Bricolage), `--font-sans` (Inter). Per-role `data-role`/`data-intensity` rebinds slots; student=loud, others=calm.

**THEN — role-surface parity program** ("finish teachers/students/parents/school-admin/super-admin so V2 can kick ass"): bring all 5 role surfaces to **V1-parity-plus**. V1 (`C:/users/inteliflow/core`, app.inteliflowai.com, live) is the **completeness floor**; V2 is the **upgrade + future base** (decommission V1 once V2 is online). Committed next epic = the full **non-SPARK student assignment player** (V1 `app/(dashboard)` `student/homework` ~1557 lines — Teli tutor, hints, canvas, TTS, autosave, graded submit). Parent surface = stub; school-admin/super-admin still use the generic `RoleLayout` placeholder (NOT the pop-art shell — and they use arbitrary `[var(--..)]` classes that violate the token rule; clean up when each gets the real shell). A **V1↔V2 parity-audit Workflow is running** (5 role auditors + synthesizer) to produce the prioritized backlog. Self-serve **trial onboarding** spec (`docs/superpowers/specs/2026-06-19-trial-onboarding-design.md`) is written + unblocked. Printable reports = future. BR/EduFlux/pt-BR = deferred (V1 carries it).

## Deployment

Targets Vercel (Next.js zero-config). **Vercel CLI is now installed** (54.14.2; team `inteliflow` / Inteliflow-projects). **Live production:** V2 = project `new-core` → **newcore.inteliflowai.com**; SPARK = `spark-platform` → spark.inteliflowai.com; V1 = `core-platform` → app.inteliflowai.com. Env vars live in Vercel; pushes to `main`/`master` auto-trigger Production builds. Note: repo's `.vercel/project.json` stale-links to a duplicate `core-v2` project (cleanup pending).
