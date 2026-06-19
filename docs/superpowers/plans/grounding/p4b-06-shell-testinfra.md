# P4b Grounding: Nav Shell + Test Infrastructure
> Captured: 2026-06-19. Verbatim from source files. Do not paraphrase.

---

## 1. `src/app/(teacher)/layout.tsx` — VERBATIM

```tsx
// Route-group layout for the teacher role.
// Sets data-role="teacher" + data-intensity="calm" via RoleLayout.
// The root layout (src/app/layout.tsx) owns <html>/<body> — this nests inside it.

import { RoleLayout } from '@/components/core/RoleLayout';

export default function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nav = (
    <>
      <a href="/teacher/dashboard" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">
        Dashboard
      </a>
      <a href="/teacher/class" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">
        Class
      </a>
      <a href="/teacher/assignments" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">
        Assignments
      </a>
    </>
  );

  return (
    <RoleLayout role="teacher" nav={nav}>
      {children}
    </RoleLayout>
  );
}
```

**Nav items present:** Dashboard (`/teacher/dashboard`), Class (`/teacher/class`), Assignments (`/teacher/assignments`).
Nav links use inline `text-[var(--fg)] hover:text-[var(--brand)]` — NOT the Tailwind utility classes `text-fg` / `text-brand`.

---

## 2. `src/components/core/RoleLayout.tsx` — VERBATIM

```tsx
// src/components/core/RoleLayout.tsx
// Pure presentational role shell — sets data-role + data-intensity on the root,
// renders the ◆ CORE mark and an optional nav slot.
// Route-group layouts (4b–4e) import from here.

import React from 'react';

export type Role = 'student' | 'teacher' | 'parent' | 'admin' | 'super-admin';

function intensityFor(role: Role): 'loud' | 'calm' {
  return role === 'student' ? 'loud' : 'calm';
}

interface RoleLayoutProps {
  role: Role;
  /** Optional navigation rendered inside the header beside the mark. */
  nav?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * RoleLayout
 *
 * Sets data-role + data-intensity on its root <div> so every descendant
 * component can read the correct Tier-2 CSS token values without prop-drilling.
 *
 * student → data-intensity="loud"
 * teacher | parent | admin | super-admin → data-intensity="calm"
 */
export function RoleLayout({ role, nav, children }: RoleLayoutProps) {
  const intensity = intensityFor(role);

  return (
    <div
      data-role={role}
      data-intensity={intensity}
      className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--fg)]"
    >
      <header className="flex items-center gap-4 px-6 py-4 border-b border-[var(--surface)]">
        <span
          aria-label="CORE"
          className="font-display font-bold text-[var(--brand)] tracking-tight select-none"
        >
          ◆ CORE
        </span>
        {nav && (
          <nav className="flex-1" aria-label="Role navigation">
            {nav}
          </nav>
        )}
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

export default RoleLayout;
```

### Nav-slot prop API

| Prop | Type | Required | Notes |
|------|------|----------|-------|
| `role` | `Role` | yes | `'student' \| 'teacher' \| 'parent' \| 'admin' \| 'super-admin'` |
| `nav` | `React.ReactNode` | no (optional `?`) | Rendered inside `<nav aria-label="Role navigation">` |
| `children` | `React.ReactNode` | yes | Placed in `<main className="flex-1">` |

### `intensityFor` mapping (teacher)
```ts
function intensityFor(role: Role): 'loud' | 'calm' {
  return role === 'student' ? 'loud' : 'calm';
}
```
`role="teacher"` → `data-intensity="calm"` (all non-student roles get `"calm"`).

### DOM structure rendered
```
<div data-role={role} data-intensity={intensity} className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--fg)]">
  <header className="flex items-center gap-4 px-6 py-4 border-b border-[var(--surface)]">
    <span aria-label="CORE" className="font-display font-bold text-[var(--brand)] tracking-tight select-none">
      ◆ CORE
    </span>
    {nav && (
      <nav className="flex-1" aria-label="Role navigation">
        {nav}
      </nav>
    )}
  </header>
  <main className="flex-1">{children}</main>
</div>
```

- **`<nav>` landmark:** `aria-label="Role navigation"` (NOT "Primary navigation" or anything else)
- **CORE mark:** `<span aria-label="CORE">◆ CORE</span>` — a `<span>`, not a link or heading
- **Nav slot:** only rendered when `nav` prop is truthy; placed after the mark inside `<header>`
- **Children:** rendered in `<main className="flex-1">`, outside the header

---

## 3. Route slots already present under `src/app/(teacher)/`

Glob result (only one match):

```
src/app/(teacher)/layout.tsx
```

**No page routes exist yet.** There are no `page.tsx` files, no sub-folders (e.g. no `dashboard/`, `class/`, `assignments/`). The nav links in layout.tsx reference routes that do not yet have corresponding files.

---

## 4. `src/app/globals.css` — Token Audit

### Tailwind utility classes confirmed

The `@theme inline` block (lines 259–291) maps CSS vars to Tailwind color tokens. The comment on line 257 explicitly lists: `bg-brand, text-fg, shadow-pop, rounded, rounded-lg`.

**Confirmed present as `@theme inline` `--color-*` entries:**

| Utility class | Backing CSS var | Value in `:root` |
|---------------|-----------------|-------------------|
| `text-fg` | `--color-fg: var(--fg)` | `var(--ink-900)` |
| `text-fg-muted` | `--color-fg-muted: var(--fg-muted)` | `var(--ink-600)` |
| `text-brand` | `--color-brand: var(--brand)` | `var(--cobalt-600)` (default / teacher) |
| `bg-ok` / `text-ok` | `--color-ok: var(--ok)` | `var(--emerald-600)` |

**CSS variables confirmed present in `:root`:**

| Variable | Value |
|----------|-------|
| `--brand` | `var(--cobalt-600)` |
| `--brand-accent` | `var(--cobalt-400)` |
| `--ok` | `var(--emerald-600)` |
| `--fg` | `var(--ink-900)` |
| `--fg-muted` | `var(--ink-600)` |

For `[data-role="teacher"]`, `--brand` → `var(--cobalt-600)`, `--brand-accent` → `var(--cobalt-400)`, `--ok` → `var(--emerald-600)`.

### IMPORTANT: Nav links use inline CSS vars, NOT Tailwind utility classes

The nav links in `(teacher)/layout.tsx` use `text-[var(--fg)]` (arbitrary value syntax), **not** `text-fg`. This is a mismatch vs the plan's intent to use Tailwind utility classes. When updating the nav, use `text-fg`, `text-brand` etc. (the `@theme inline` tokens), not `text-[var(--fg)]`.

### `.growth-motif--wins` — does NOT exist

No `.growth-motif--wins` class exists anywhere in `globals.css`. The Glob/Grep confirms zero matches.

### Pattern for ADDING `.growth-motif--wins`

The established pattern in `globals.css` for modifier classes that rebind `--brand` and `--brand-accent` is demonstrated by the role/intensity Tier-3 selectors. A `.growth-motif--wins` class should follow the same pattern and be placed after the `@theme inline` block, in a new "GROWTH MOTIFS" section:

```css
/* ============================================================
   GROWTH MOTIFS — transient signal overlays
   ============================================================ */
.growth-motif--wins {
  --brand:        var(--ok);
  --brand-accent: var(--ok);
}
```

This rebinds `--brand` and `--brand-accent` to `var(--ok)` (which resolves to `var(--emerald-600)` in the teacher context), causing all components that read `text-brand` / `bg-brand` / `border-brand` to render in the "ok" green while the motif class is active. Place at the end of the file, after line 301.

---

## 5. `package.json` — VERBATIM `"scripts"` block

```json
"scripts": {
  "dev": "next dev",
  "prebuild": "npm run a11y",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "test:watch": "vitest",
  "eval": "tsx scripts/eval/ci.ts",
  "spike:grader": "tsx scripts/eval/grader-spike.ts",
  "a11y": "npx tsx scripts/a11y/contrast-check.ts"
}
```

**Key scripts:**
- `"test"` → `vitest run` (single-pass CI mode)
- `"test:watch"` → `vitest` (interactive watch)
- `"prebuild"` → `npm run a11y` (runs before every `npm run build`)
- `"a11y"` → `npx tsx scripts/a11y/contrast-check.ts`

### `devDependencies` — VERBATIM

```json
"devDependencies": {
  "@tailwindcss/postcss": "^4",
  "@testing-library/jest-dom": "^6.9.1",
  "@testing-library/react": "^16.3.2",
  "@types/katex": "^0.16.8",
  "@types/node": "^20",
  "@types/react": "^19",
  "@types/react-dom": "^19",
  "@vitejs/plugin-react": "6.0.2",
  "@vitest/coverage-v8": "4.1.9",
  "eslint": "^9",
  "eslint-config-next": "16.2.9",
  "jsdom": "^29.1.1",
  "supabase": "^2.107.0",
  "tailwindcss": "^4",
  "tsx": "4.22.4",
  "typescript": "^5",
  "vite-tsconfig-paths": "6.1.1",
  "vitest": "4.1.9"
}
```

---

## 6. Test Infrastructure Status

### Packages installed: YES

| Package | Installed | Version |
|---------|-----------|---------|
| `vitest` | YES | `4.1.9` |
| `@testing-library/react` | YES | `^16.3.2` |
| `@testing-library/jest-dom` | YES | `^6.9.1` |
| `jsdom` | YES | `^29.1.1` |
| `@vitejs/plugin-react` | YES | `6.0.2` |
| `vite-tsconfig-paths` | YES | `6.1.1` |
| `@vitest/coverage-v8` | YES | `4.1.9` |

Plan 4a did install all required test dependencies.

### `vitest.config.ts` — VERBATIM

```ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'scripts/**/*.test.{ts,tsx}',
      'supabase/**/*.test.ts',
    ],
    testTimeout: 15000,
    css: true,
  },
});
```

### CRITICAL: Default environment is `'node'`, NOT `'jsdom'`

The config sets `environment: 'node'`. This means React component tests (which need a DOM) will FAIL unless they either:

1. **Use a per-file pragma** at the top of the test file:
   ```ts
   // @vitest-environment jsdom
   ```
   This is the per-file override mechanism Vitest supports.

2. **Or** the config is updated to set `environment: 'jsdom'` globally (or use `environmentMatchGlobs`).

There is NO global jsdom environment currently set. Any `.test.tsx` files that render React components (e.g. snapshot tests of `RoleLayout`, `NavItem`, signal-badge components) MUST include the `// @vitest-environment jsdom` pragma at the top of the file, or they will error with "document is not defined".

**Note:** `@vitejs/plugin-react` is installed in `devDependencies` but is NOT included in `vitest.config.ts`'s `plugins` array. It currently only includes `tsconfigPaths()`. To support React JSX transform in tests, `@vitejs/plugin-react` may need to be added to the vitest config plugins.

### `vitest.setup.ts` — VERBATIM

```ts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||= 'test-publishable-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_SECRET_KEY ||= 'test-secret-key';
process.env.ANTHROPIC_API_KEY ||= 'test-anthropic-key';
process.env.OPENAI_API_KEY ||= 'test-openai-key';
process.env.ANTHROPIC_GEN_MODEL ||= 'claude-gen-test';
```

The setup file only stubs environment variables. It does NOT import `@testing-library/jest-dom` matchers (`expect.extend`). Any test that uses jest-dom matchers like `toBeInTheDocument()` must either import `@testing-library/jest-dom` directly or the setup file must be extended.

---

## 7. `scripts/a11y/contrast-check.ts` — Existence Confirmed

File exists at: `scripts/a11y/contrast-check.ts`

`package.json` scripts confirm:
- `"a11y": "npx tsx scripts/a11y/contrast-check.ts"` — a11y script wired
- `"prebuild": "npm run a11y"` — runs automatically before every `npm run build`

---

## 8. Summary of Critical Findings

### What exists and is correct for 4b:
- `RoleLayout` nav-slot prop: `nav?: React.ReactNode` — optional, correct
- `intensityFor("teacher")` → `"calm"` — correct
- `<nav aria-label="Role navigation">` landmark — present
- CORE mark: `<span aria-label="CORE">◆ CORE</span>` — present
- CSS vars `--brand`, `--brand-accent`, `--ok` — all present in `:root` and `[data-role="teacher"]`
- Tailwind utilities `text-fg`, `text-fg-muted`, `text-brand` — all present via `@theme inline`
- All test packages installed: vitest 4.1.9, @testing-library/react ^16.3.2, @testing-library/jest-dom ^6.9.1, jsdom ^29.1.1
- `scripts/a11y/contrast-check.ts` exists; `prebuild` and `a11y` scripts exist

### What does NOT exist / needs action in 4b:
1. **No page routes** under `(teacher)/` — only `layout.tsx` exists; dashboard, class, assignments pages all need to be created
2. **`.growth-motif--wins` class** does not exist in `globals.css` — needs to be added
3. **vitest jsdom environment is per-file opt-in** — all component test files must include `// @vitest-environment jsdom` pragma OR the config must be updated
4. **`@vitejs/plugin-react` not in vitest config plugins** — needs to be added for JSX in tests
5. **`@testing-library/jest-dom` not imported in `vitest.setup.ts`** — setup file only stubs env vars; jest-dom matchers need to be imported either in setup or per test
6. **Nav links use `text-[var(--fg)]` not `text-fg`** — plan should update these to use Tailwind utilities
