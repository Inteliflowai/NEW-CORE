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
- **Tests:** no test runner is configured yet. If you add one, wire it into `package.json` `scripts` and document the single-test invocation here.

## Architecture

Standard Next.js App Router scaffold; the structure is conventional, so only the non-obvious points are noted:

- **App Router under `src/`.** Routes live in `src/app/`. `layout.tsx` is the root layout (wraps every page); `page.tsx` is a route's UI. New routes are folders under `src/app/` containing a `page.tsx`; API routes are `route.ts` files. Server Components are the default — add `"use client"` only when a component needs browser APIs or state.
- **Import alias:** `@/*` maps to `src/*` (`tsconfig.json`). Prefer `@/...` over long relative paths.
- **Styling:** Tailwind CSS **v4**, configured via `@tailwindcss/postcss` in `postcss.config.mjs` — there is no `tailwind.config.js`. Global styles and Tailwind layers are in `src/app/globals.css`.
- **`next.config.ts`** is currently empty; add framework config there (TypeScript, not JSON).
- **`AGENTS.md`** holds the cross-tool agent rules and is the source of the Next.js-version warning above.

## Deployment

Targets Vercel (Next.js zero-config). The Vercel CLI is not installed locally; install with `npm i -g vercel` to enable `vercel deploy`, `vercel env pull`, etc.
