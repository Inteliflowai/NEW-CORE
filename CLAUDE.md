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
- **Design tokens (single source of truth):** the tokens — Tier-1 ramps, Tier-2 semantic slots, Tier-3 role×intensity bindings, the `@theme` exposure, and the **motion** tokens (for framer-motion) — live in **`src/lib/design/tokens.ts`**. The CSS in `globals.css` between the `TOKENS:GENERATED:BEGIN/END` markers is **generated** from it by `npm run tokens:gen`. **Never hand-edit the generated region** — edit `tokens.ts` and regenerate; `npm run tokens:check` (run in `prebuild`) fails on drift. Components keep the same token classes (`text-fg`, `bg-brand`, `shadow-sticker`…); never hardcode hex/spacing/type, and **ask before inventing a token**.
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
- **Coach posture (the moat):** every surface obeys [`COACH-POSTURE.md`](COACH-POSTURE.md) — speaks first (observation, not a metric), one thing at a time, plain human language (no geek/raw stats), notices→suggests→confirms (never decides), quiet on good days, **not a chatbot**. User-facing strings go to `STRINGS-FOR-BARB.md` as drafts; Barb gates all copy.
- **Four-audience discipline:** student/parent surfaces never show the mastery-band enum or a raw risk number (band label only); CL verbs / diagnoses / divergence / misconceptions are **teacher-only**; growth is "you vs your own past" (never peer-relative, never fabricated — cold-start instead); observational, not diagnostic. Enforced at the string boundary in `src/lib/copy/` (pure helpers + `leakGuard`).
- **"Assignments", never "Homework"** in any UI/copy (legacy term survives only in DB identifiers like `homework_attempts`).
- **WCAG-AA + deep-ink:** no hardcoded hex / arbitrary `[var(--..)]` in components — Tier-2 token classes only; content text is deep-ink (`text-fg`), not `text-fg-muted`.
- **Auth chain (every protected route):** `await createServerSupabaseClient()` → `auth.getUser()` → STAFF_ROLES gate → object-level IDOR guard (`src/lib/auth/guards.ts`) → `createAdminSupabaseClient()` (synchronous; reads `SUPABASE_SECRET_KEY`; **bypasses RLS — RLS is NOT the IDOR backstop**).

**Dev workflow.** Brainstorm → spec → `writing-plans` → **subagent-driven-development** (fresh implementer per task + task review + final whole-branch review). Ledger at `.git/sdd/progress.md`. **The in-house adversarial Workflow is the primary review** — Codex has been unreliable/hung; don't block on it.

**DONE + MERGED TO PROD (`main` `532d36e`, 2026-06-20) — Pop-Art polish pass.** A long screenshot-driven (Playwright) + adversarial-reviewed cosmetic/UX pass shipped: full-bleed gallery **login** (SPARK pop-art slides, real CORE+SPARK logos, frosted-cobalt translucent sign-in card in a left column, on-glass text deep-inked for AA over the art), **teacher** Pop-Art content (sticker-label card titles, tone-tinted **color-coded** cards via a new `Card` `tone` prop + `SectionLabel`, denser/smaller text, `pop-dots`/`pop-canvas` textures), **student** whole-child redesign (tone-tinted Skill Map rows), the **class-picker flash fix** (`SidebarNav` carries `?class=` + `firstClassIdForTeacher` server-default redirect), the SPARK sticker tilt, and the **/assignments 404 fix** (deferred the dead `Open Assignments` CTA through IdentityHeader/PriorityRecommendation/WholeChildRail). Design tokens: 3-tier (`src/app/globals.css`), teacher=cobalt, `sidebar-active`=lime, `--shadow-sticker`/`--shadow-sticker-lg`, `@utility pop-dots`/`pop-canvas`. Deferred Nit: the 5 login slide source PNGs are ~23 MB (next/image optimizes delivery; compress sources later).

**NOW — the "meat and potatoes" V1-parity feature build (see [[v2-parity-program-meat-and-potatoes]] memory).** Data-producers first, epics **1→4**. **Status as of 2026-06-22:**
1. **Student Quiz Runner — ✅ DONE + merged + deployed live** (`main`; turns on the behavioral-signals pipeline).
2. **Non-SPARK Assignment Player — ✅ DONE + merged + deployed live + smoke-tested.** Segments 1–2 (core player: read→typed tasks→autosave→AI grade the student SEES) + **Segment 3 Teli tutor** (Socratic, bounded 4-rung hint ladder, **FAIL-CLOSED never-reveals-the-answer** guard, real `teli_hint_count`/`effort_label` into the moat; `claude-opus-4-8`; route `POST /api/attempts/homework-tutor`; migration 0016). GOTCHA banked: newest Claude reasoning models (opus-4.x/fable) reject the `temperature` param (400) — `claudeChat` now omits it for them. Segments **4 (drawing canvas) + 5 (voice) DEFERRED to AFTER Epic 3** (Marvin's call, 2026-06-21).
3. **Teacher completion (Epic 3) — HYBRID: 3a full gradebook, 3b lean trio (see [[v2-epic3-teacher-screens]]).** **3a — FULL GRADEBOOK ✅ DONE + MERGED + DEPLOYED LIVE** (`main` `f1f5494`, newcore.inteliflowai.com, 2026-06-22; NO migration): assignment-column grid (7 cell statuses, class-avg over assignments only) + separated read-only "Diagnostic checks — not graded" quiz section + click-cell drill-in (grade override → existing `teacher_score`; reteach → `allow_redo`). Files: `src/lib/gradebook/loadGradebook.ts`, `POST /api/teacher/gradebook/override` (override-wins: writes ONLY teacher_score/teacher_notes/allow_redo), `GradebookGrid`/`DiagnosticChecksSection`/`GradebookDrillIn` + `(teacher)/gradebook/page.tsx`, `src/lib/copy/effortLabelPhrase.ts`. Reviewed via committee + `/code-review` + `/frontend-design-audit` + **codex** (codex caught 2 genuine P2 the in-house missed); all fixed; gates vitest 1899/1899, tsc 0, build 0, a11y 49/49. Deferred cosmetic polish + Barb copy gating are in the ledger / `STRINGS-FOR-BARB.md §Gradebook`. **NEXT = 3b — LEAN Alerts + High-Fives + Insights** (then player Seg 4 canvas / Seg 5 voice).
4. **Parent dashboard + AI narrative** (9-paragraph summary over already-ported leak-guard primitives) — after Epic 3.

Per epic: ground in V1 → spec (user sign-off) → `writing-plans` → subagent-driven-development + adversarial review before merge. V1 (`C:/users/inteliflow/core`) is the completeness floor; V2 is the upgrade + future base. Self-serve trial onboarding (`docs/superpowers/specs/2026-06-19-trial-onboarding-design.md`) written. BR/EduFlux/pt-BR deferred.

## Deployment

Targets Vercel (Next.js zero-config). **Vercel CLI is now installed** (54.14.2; team `inteliflow` / Inteliflow-projects). **Live production:** V2 = project `new-core` → **newcore.inteliflowai.com**; SPARK = `spark-platform` → spark.inteliflowai.com; V1 = `core-platform` → app.inteliflowai.com. Env vars live in Vercel; pushes to `main`/`master` auto-trigger Production builds. Note: repo's `.vercel/project.json` stale-links to a duplicate `core-v2` project (cleanup pending).
