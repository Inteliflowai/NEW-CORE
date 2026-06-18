# Plan 4a — Design-System Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **⚠️ Read the "Review Corrections" appendix (P4a-C1…C4) at the end BEFORE executing any task — the parallel-authored slices each tried to set up the jsdom test infra and edit `vitest.config.ts`/`globals.css`; the appendix designates single owners and GOVERNS over the task bodies where they conflict.**

**Goal:** Build the fresh CORE v2 design-system foundation — token architecture, role+intensity theming, the shared component kit (RoleLayout, GrowthMotif, CLBadge, MasteryLabel, RiskBadge, MathText, Card/StatCard, EmptyState), the copy registers, and the WCAG-AA contrast CI gate — that every role screen (4b–4e) imports. NO role screens are built here.

**Architecture:** A 3-tier token system in `globals.css` (Tier-1 hex ramps in `:root` → Tier-2 semantic slots → bound per role/intensity by `[data-role][data-intensity]` selectors), exposed to Tailwind v4 via `@theme`. Presentational React components consume only the Tier-2 tokens (via Tailwind utilities) + the Plan-1–3 data shapes passed as props; they never fetch and render nothing diagnostic on student/parent surfaces. shadcn/ui primitives sit on the same token layer.

**Tech Stack:** Next.js 16.2.9 (App Router) · React 19 · Tailwind v4 (`@theme`, NO `tailwind.config.js`) · shadcn/ui · `next/font/google` (Bricolage Grotesque + Inter) · `katex` (math render) · Vitest + `@testing-library/react` + jsdom. Branch: `feat/p4a-design-system`.

## Global Constraints

- **Tailwind v4, NO `tailwind.config.js`** — tokens via `@theme` in `src/app/globals.css`. Replace the CRA-boilerplate globals.css (Geist + unused dark-mode block).
- **No hardcoded hex in components** — components reference ONLY the Tier-2 semantic tokens via Tailwind utilities (`bg-bg`, `bg-surface`, `text-fg`, `text-fg-muted`, `bg-brand`, `text-fg-on-brand`, `rounded`, `rounded-lg`, `shadow`, `shadow-pop`). Hex lives only in `globals.css` `:root`.
- **Readability is a build gate** — body text = deep ink; secondary text only to an AA-clearing mid-ink; NEVER dim gray-on-white. The contrast check (Task 4) runs in CI; a sub-threshold pair fails the build.
- **Never "Band" in UI** (soft words via the existing `masteryDisplayLabel`); **risk as a banded label, never a raw number**; **CL + diagnostic data are teacher-surface only**; growth is **"you vs your own past," never peer-relative**; struggle framed as **"still building."** Observational, never diagnostic.
- **Components are presentational** — receive data as props, do NOT fetch; cold-start/null → the dignified empty states, never a fabricated value.
- **Reuse, don't reimplement:** `masteryDisplayLabel` (`@/lib/utils/masteryLabel`), `CL_VERB_BY_STATE` + `SkillLearningState` (`@/lib/skills/clVerbs`).
- **The 663 existing backend tests stay green** (global vitest env stays `node`; component tests opt into jsdom per-file — see P4a-C1/C2).
- **One CORE brand, per-role accent + intensity:** emerald/lime Student (loud) · cobalt Teacher (calm) · coral Parent (calm) · indigo-black Admin (calm/dark) · charcoal-amber Super-admin (calm/dark). Color = accent, not reskin.
- TDD; commit each task on `feat/p4a-design-system`; `npm run build` + `npx tsc --noEmit` clean per task.

## File Structure

```
src/app/globals.css                  3-tier tokens + @theme (SOLE owner: Task 1)               [T1]
src/app/layout.tsx                   next/font Bricolage + Inter; --font-display/--font-sans    [T2]
vitest.config.ts + src/test/setup-dom.ts + package.json   jsdom component-test infra (SOLE owner: Task 3)  [T3]
scripts/a11y/contrast-check.ts       WCAG-AA contrast gate + `npm run a11y`                     [T4]
src/components/core/RoleLayout.tsx   role+intensity shell; exports `type Role`                  [T5]
src/components/core/GrowthMotif.tsx  the signature growth viz                                   [T6]
src/lib/copy/topicFrame.ts + src/components/core/MasteryLabel.tsx   "still building" + soft band [T7]
src/lib/copy/riskBandLabel.ts + src/components/core/RiskBadge.tsx   banded risk (never a number) [T8]
src/components/core/CLBadge.tsx      teacher-only CL verb + soft-word confidence                [T9]
src/components/core/MathText.tsx     KaTeX inline/block + safe degrade (adds `katex`)           [T10]
src/components/core/Card.tsx + EmptyState.tsx   surface + cold-start states                     [T11]
(verification gate)                                                                              [T12]
```

**Execution order (dependency-correct):** **T1** (tokens/globals.css) → **T3** (test infra) → **T2** (fonts) → **T4** (contrast gate) → **T5** (RoleLayout) → **T6/T7** → **T8/T9** → **T10/T11** → **T12** (verify). T3 must precede any `*.test.tsx`; T1 must precede any component (the `@theme` utilities must exist).

---

## Tasks

### Task 1: Replace globals.css with Tier-1 primitives, Tier-2 semantic slots, role/intensity bindings, and @theme block

**Files:**
- `src/app/globals.css` (replace entire file)
- `src/app/__tests__/globals-tokens.test.ts` (new)

**Interfaces:**
- Produces: all Tier-1 `--emerald-*`, `--lime-*`, `--cobalt-*`, `--coral-*`, `--amber-*`, `--ink-*` ramps; Tier-2 slots `--bg`, `--surface`, `--fg`, `--fg-muted`, `--brand`, `--brand-accent`, `--fg-on-brand`, `--ok`, `--warn`, `--risk`, `--radius`, `--radius-lg`, `--shadow`, `--shadow-pop`; `[data-role][data-intensity]` bindings for all 5 roles; `@theme` block mapping Tier-2 to Tailwind v4 utilities.
- Consumes: nothing upstream.

**Steps:**

- [ ] 1. Write the failing test (run it — it must fail because globals.css still has Geist boilerplate):

  `src/app/__tests__/globals-tokens.test.ts`
  ```ts
  import { readFileSync } from 'node:fs';
  import { join } from 'node:path';
  import { describe, it, expect } from 'vitest';

  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf-8');

  describe('globals.css token contract', () => {
    // Tier-2 semantic slots must exist
    it('defines all required Tier-2 semantic slots in :root', () => {
      const required = [
        '--bg', '--surface', '--fg', '--fg-muted',
        '--brand', '--brand-accent', '--fg-on-brand',
        '--ok', '--warn', '--risk',
        '--radius', '--radius-lg', '--shadow', '--shadow-pop',
      ];
      for (const slot of required) {
        expect(css, `missing slot ${slot}`).toContain(slot + ':');
      }
    });

    // Tier-1 ramp presence (spot-check boundary stops)
    it('defines Tier-1 primitive ramps for all 6 color families', () => {
      const families = ['--emerald-', '--lime-', '--cobalt-', '--coral-', '--amber-', '--ink-'];
      for (const f of families) {
        expect(css, `missing ramp ${f}`).toContain(f);
      }
    });

    // Role selectors for all 5 roles
    it('has data-role binding selectors for all 5 roles', () => {
      const roles = ['student', 'teacher', 'parent', 'admin', 'super-admin'];
      for (const role of roles) {
        expect(css, `missing selector for role=${role}`).toContain(`data-role="${role}"`);
      }
    });

    // data-intensity selectors
    it('has data-intensity selectors for loud and calm', () => {
      expect(css).toContain('data-intensity="loud"');
      expect(css).toContain('data-intensity="calm"');
    });

    // No raw hex values outside :root — everything between a } and :root { must be var() references
    it('has no raw hex literals outside :root', () => {
      // Strip :root block(s), then check no #xxxxxx remain
      const withoutRoot = css.replace(/:root\s*\{[^}]*\}/gs, '');
      const hexMatches = withoutRoot.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      expect(hexMatches, `raw hex outside :root: ${hexMatches.join(', ')}`).toHaveLength(0);
    });

    // @theme block maps brand/fg/bg
    it('has @theme block mapping Tier-2 slots to Tailwind v4 utilities', () => {
      expect(css).toContain('@theme');
      expect(css).toContain('--color-brand:');
      expect(css).toContain('--color-bg:');
      expect(css).toContain('--color-fg:');
    });
  });
  ```

- [ ] 2. Run: confirm it fails.
  ```
  npx vitest run src/app/__tests__/globals-tokens.test.ts
  ```
  Expected: 5 failing assertions (Geist boilerplate has none of the required tokens).

- [ ] 3. Replace `src/app/globals.css` with the full design-system token file:

  ```css
  @import "tailwindcss";

  /* ============================================================
     TIER 1 — PRIMITIVE RAMPS
     The ONLY place hex literals live. All other selectors use var().
     ============================================================ */
  :root {
    /* Emerald ramp (Student brand) */
    --emerald-50:  #ecfdf5;
    --emerald-100: #d1fae5;
    --emerald-200: #a7f3d0;
    --emerald-300: #6ee7b7;
    --emerald-400: #34d399;
    --emerald-500: #10b981;
    --emerald-600: #059669;
    --emerald-700: #047857;
    --emerald-800: #065f46;
    --emerald-900: #064e3b;
    --emerald-950: #022c22;

    /* Lime ramp (Student accent) */
    --lime-50:  #f7fee7;
    --lime-100: #ecfccb;
    --lime-200: #d9f99d;
    --lime-300: #bef264;
    --lime-400: #a3e635;
    --lime-500: #84cc16;
    --lime-600: #65a30d;
    --lime-700: #4d7c0f;
    --lime-800: #3f6212;
    --lime-900: #365314;
    --lime-950: #1a2e05;

    /* Cobalt ramp (Teacher brand) */
    --cobalt-50:  #eff6ff;
    --cobalt-100: #dbeafe;
    --cobalt-200: #bfdbfe;
    --cobalt-300: #93c5fd;
    --cobalt-400: #60a5fa;
    --cobalt-500: #3b82f6;
    --cobalt-600: #2563eb;
    --cobalt-700: #1d4ed8;
    --cobalt-800: #1e40af;
    --cobalt-900: #1e3a8a;
    --cobalt-950: #172554;

    /* Coral ramp (Parent brand) */
    --coral-50:  #fff1ee;
    --coral-100: #ffe0d9;
    --coral-200: #ffc5b8;
    --coral-300: #ff9d87;
    --coral-400: #f97055;
    --coral-500: #e0533f;
    --coral-600: #c93d29;
    --coral-700: #a72d1d;
    --coral-800: #8a271a;
    --coral-900: #72261c;
    --coral-950: #3e0f09;

    /* Amber ramp (Super-admin signal) */
    --amber-50:  #fffbeb;
    --amber-100: #fef3c7;
    --amber-200: #fde68a;
    --amber-300: #fcd34d;
    --amber-400: #fbbf24;
    --amber-500: #f59e0b;
    --amber-600: #d97706;
    --amber-700: #b45309;
    --amber-800: #92400e;
    --amber-900: #78350f;
    --amber-950: #451a03;

    /* Ink ramp (neutral — readability anchor) */
    --ink-50:  #f8f8f8;
    --ink-100: #f0f0f0;
    --ink-200: #e4e4e4;
    --ink-300: #d1d1d1;
    --ink-400: #a8a8a8;
    --ink-500: #737373;
    --ink-600: #525252;
    --ink-700: #3d3d3d;
    --ink-800: #262626;
    --ink-900: #171717;
    --ink-950: #0a0a0a;

    /* Dark canvas tokens (command-center roles) */
    --canvas-admin:    #14132b;
    --canvas-platform: #18181b;

    /* ============================================================
       TIER 2 — SEMANTIC SLOTS (default: light, teacher/calm baseline)
       Components reference ONLY these — never the Tier-1 ramps directly.
       ============================================================ */
    --bg:           var(--ink-50);
    --surface:      #ffffff;
    --fg:           var(--ink-900);
    --fg-muted:     var(--ink-600);
    --brand:        var(--cobalt-600);
    --brand-accent: var(--cobalt-400);
    --fg-on-brand:  #ffffff;
    --ok:           var(--emerald-600);
    --warn:         var(--amber-500);
    --risk:         var(--coral-500);
    --radius:       0.5rem;
    --radius-lg:    1rem;
    --shadow:       0 1px 3px 0 rgb(0 0 0 / 0.10), 0 1px 2px -1px rgb(0 0 0 / 0.08);
    --shadow-pop:   0 8px 24px -4px rgb(0 0 0 / 0.16), 0 4px 8px -2px rgb(0 0 0 / 0.10);
  }

  /* ============================================================
     TIER 3 — ROLE/INTENSITY BINDING
     Sets Tier-2 slots from the role's primitive ramp.
     data-role + data-intensity are set by RoleLayout.
     ============================================================ */

  /* --- Student (loud) --- */
  [data-role="student"] {
    --brand:        var(--emerald-600);
    --brand-accent: var(--lime-500);
    --fg-on-brand:  #ffffff;
    --ok:           var(--emerald-600);
    --bg:           var(--ink-50);
    --surface:      #ffffff;
    --fg:           var(--ink-900);
    --fg-muted:     var(--ink-600);
  }

  [data-role="student"][data-intensity="loud"] {
    --radius:      0.75rem;
    --radius-lg:   1.25rem;
    --shadow:      0 2px 6px 0 rgb(5 150 105 / 0.12);
    --shadow-pop:  0 10px 28px -4px rgb(5 150 105 / 0.22), 0 4px 10px -2px rgb(5 150 105 / 0.14);
  }

  /* --- Teacher (calm) --- */
  [data-role="teacher"] {
    --brand:        var(--cobalt-600);
    --brand-accent: var(--cobalt-400);
    --fg-on-brand:  #ffffff;
    --ok:           var(--emerald-600);
    --bg:           var(--ink-50);
    --surface:      #ffffff;
    --fg:           var(--ink-900);
    --fg-muted:     var(--ink-600);
  }

  [data-role="teacher"][data-intensity="calm"] {
    --radius:     0.5rem;
    --radius-lg:  0.875rem;
    --shadow:     0 1px 3px 0 rgb(0 0 0 / 0.10), 0 1px 2px -1px rgb(0 0 0 / 0.08);
    --shadow-pop: 0 6px 16px -3px rgb(37 99 235 / 0.12), 0 3px 6px -2px rgb(0 0 0 / 0.08);
  }

  /* --- Parent (calm) --- */
  [data-role="parent"] {
    --brand:        var(--coral-500);
    --brand-accent: var(--coral-300);
    --fg-on-brand:  #ffffff;
    --ok:           var(--emerald-600);
    --bg:           var(--ink-50);
    --surface:      #ffffff;
    --fg:           var(--ink-900);
    --fg-muted:     var(--ink-600);
  }

  [data-role="parent"][data-intensity="calm"] {
    --radius:     0.5rem;
    --radius-lg:  0.875rem;
    --shadow:     0 1px 3px 0 rgb(0 0 0 / 0.10), 0 1px 2px -1px rgb(0 0 0 / 0.08);
    --shadow-pop: 0 6px 16px -3px rgb(224 83 63 / 0.12), 0 3px 6px -2px rgb(0 0 0 / 0.08);
  }

  /* --- School Admin (calm-on-dark) --- */
  [data-role="admin"] {
    --bg:           var(--canvas-admin);
    --surface:      #1e1d3a;
    --fg:           var(--ink-100);
    --fg-muted:     var(--ink-400);
    --brand:        var(--cobalt-400);
    --brand-accent: var(--cobalt-300);
    --fg-on-brand:  var(--ink-950);
    --ok:           var(--emerald-400);
    --warn:         var(--amber-400);
    --risk:         var(--coral-400);
  }

  [data-role="admin"][data-intensity="calm"] {
    --radius:     0.5rem;
    --radius-lg:  0.75rem;
    --shadow:     0 1px 4px 0 rgb(0 0 0 / 0.40);
    --shadow-pop: 0 6px 20px -4px rgb(0 0 0 / 0.50);
  }

  /* --- Super-admin (calm-on-dark, charcoal + amber) --- */
  [data-role="super-admin"] {
    --bg:           var(--canvas-platform);
    --surface:      #27272a;
    --fg:           var(--ink-100);
    --fg-muted:     var(--ink-400);
    --brand:        var(--amber-500);
    --brand-accent: var(--amber-300);
    --fg-on-brand:  var(--ink-950);
    --ok:           var(--emerald-400);
    --warn:         var(--amber-400);
    --risk:         var(--coral-400);
  }

  [data-role="super-admin"][data-intensity="calm"] {
    --radius:     0.375rem;
    --radius-lg:  0.625rem;
    --shadow:     0 1px 4px 0 rgb(0 0 0 / 0.50);
    --shadow-pop: 0 6px 20px -4px rgb(0 0 0 / 0.60);
  }

  /* ============================================================
     @THEME — Expose Tier-2 slots as Tailwind v4 design tokens.
     Use bg-brand, text-fg, shadow-pop, rounded-radius-lg, etc.
     ============================================================ */
  @theme inline {
    /* Colors */
    --color-bg:           var(--bg);
    --color-surface:      var(--surface);
    --color-fg:           var(--fg);
    --color-fg-muted:     var(--fg-muted);
    --color-brand:        var(--brand);
    --color-brand-accent: var(--brand-accent);
    --color-fg-on-brand:  var(--fg-on-brand);
    --color-ok:           var(--ok);
    --color-warn:         var(--warn);
    --color-risk:         var(--risk);

    /* Radius */
    --radius-DEFAULT: var(--radius);
    --radius-lg:      var(--radius-lg);

    /* Shadows */
    --shadow-DEFAULT: var(--shadow);
    --shadow-pop:     var(--shadow-pop);

    /* Fonts (set by layout.tsx via next/font/google) */
    --font-display: var(--font-bricolage);
    --font-sans:    var(--font-inter);
  }

  /* ============================================================
     BASE STYLES
     ============================================================ */
  body {
    background-color: var(--bg);
    color: var(--fg);
    font-family: var(--font-sans), system-ui, sans-serif;
  }
  ```

- [ ] 4. Run: confirm all 5 tests pass, and the 663 backend tests still pass.
  ```
  npx vitest run src/app/__tests__/globals-tokens.test.ts
  npx vitest run --reporter=verbose 2>&1 | tail -5
  ```
  Expected: `5 passed` for the CSS tests; overall suite still green.

- [ ] 5. Commit:
  ```bash
  git add src/app/globals.css src/app/__tests__/globals-tokens.test.ts
  git commit -m "$(cat <<'EOF'
  feat(design-system): replace globals.css with Tier-1 ramps, Tier-2 slots, role/intensity bindings, @theme (p4a T1)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 2: Replace layout.tsx — Bricolage Grotesque + Inter via next/font/google

**Files:**
- `src/app/layout.tsx` (replace)
- `src/app/__tests__/layout.test.tsx` (new)

**Interfaces:**
- Produces: `--font-display` (Bricolage Grotesque) and `--font-sans` (Inter) CSS variables on `<html>`; root layout renders children; metadata exported.
- Consumes: `src/app/globals.css` (Tier-2 @theme block already maps `--font-display`/`--font-sans` to `var(--font-bricolage)` / `var(--font-inter)`).

**Steps:**

- [ ] 1. Write the failing test. This is a jsdom component test — note the per-file pragma on line 1:

  `src/app/__tests__/layout.test.tsx`
  ```tsx
  // @vitest-environment jsdom
  import { describe, it, expect } from 'vitest';
  import { render } from '@testing-library/react';

  // We cannot import the real RootLayout (it uses next/font/google which needs the
  // Next.js bundler). Instead we test the contract: the font CSS variables are applied
  // to <html> and the children slot renders.

  // Lightweight stand-in that mirrors what the real layout.tsx does structurally.
  function StubLayout({ children }: { children: React.ReactNode }) {
    return (
      <html lang="en" style={{ '--font-bricolage': '"Bricolage Grotesque"', '--font-inter': '"Inter"' } as React.CSSProperties}>
        <body>{children}</body>
      </html>
    );
  }

  describe('RootLayout font variable contract', () => {
    it('sets --font-bricolage CSS var on html element', () => {
      const { container } = render(<StubLayout><div>hello</div></StubLayout>);
      const html = container.querySelector('html') ?? container.firstElementChild;
      // jsdom stores inline styles; verify the var name pattern is present
      expect(html?.getAttribute('style')).toContain('--font-bricolage');
    });

    it('sets --font-inter CSS var on html element', () => {
      const { container } = render(<StubLayout><div>hello</div></StubLayout>);
      const html = container.querySelector('html') ?? container.firstElementChild;
      expect(html?.getAttribute('style')).toContain('--font-inter');
    });

    it('renders children inside body', () => {
      const { getByText } = render(<StubLayout><span>content-slot</span></StubLayout>);
      expect(getByText('content-slot')).toBeTruthy();
    });
  });
  ```

- [ ] 2. Run: confirm it fails (no `@testing-library/react` installed yet — `Cannot find module` error is expected here; that dep is added in Task 3. If Task 3 runs first, the module will exist and the test will pass. Run in whatever order tasks are executed, but note the dependency.)

  Note to engineer: Task 3 installs the test deps. If running tasks in order, run Task 3 first, then come back and run this test. The test file can be written now; the `npm install` in Task 3 unblocks it.

  ```
  npx vitest run src/app/__tests__/layout.test.tsx
  ```
  Expected failure: `Cannot find module '@testing-library/react'` (resolved after Task 3).

- [ ] 3. Replace `src/app/layout.tsx`:

  ```tsx
  import type { Metadata } from "next";
  import { Bricolage_Grotesque, Inter } from "next/font/google";
  import "./globals.css";

  const bricolage = Bricolage_Grotesque({
    variable: "--font-bricolage",
    subsets: ["latin"],
    display: "swap",
    axes: ["opsz"],
  });

  const inter = Inter({
    variable: "--font-inter",
    subsets: ["latin"],
    display: "swap",
  });

  export const metadata: Metadata = {
    title: "CORE — Learning Intelligence",
    description:
      "CORE shows a teacher how each student learns and thinks, and turns it into one clear next step.",
  };

  export default function RootLayout({
    children,
  }: Readonly<{ children: React.ReactNode }>) {
    return (
      <html
        lang="en"
        className={`${bricolage.variable} ${inter.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col bg-bg text-fg font-sans">
          {children}
        </body>
      </html>
    );
  }
  ```

- [ ] 4. After Task 3 deps are installed, run the layout test to confirm pass:
  ```
  npx vitest run src/app/__tests__/layout.test.tsx
  ```
  Expected: `3 passed`.

- [ ] 5. Verify TypeScript is clean:
  ```
  npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] 6. Commit:
  ```bash
  git add src/app/layout.tsx src/app/__tests__/layout.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(design-system): swap Geist for Bricolage Grotesque + Inter via next/font (p4a T2)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: Component-test infrastructure — @testing-library/react, jsdom, DOM setup, per-file pragma

**Files:**
- `package.json` (add devDeps: `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `katex`, `@types/katex`)
- `vitest.config.ts` (add `*.test.tsx` to `include`; add `setupFiles` for DOM setup; keep global `environment: 'node'`)
- `src/test/setup-dom.ts` (new — DOM-specific setup loaded only by jsdom tests via `@vitest-environment jsdom` + project config override)
- `src/components/core/__tests__/smoke.test.tsx` (new — trivial jsdom render proof)

**Interfaces:**
- Produces: working `render()` + `screen` from `@testing-library/react` in any `*.test.tsx` file that carries `// @vitest-environment jsdom` on its first line; `expect(...).toBeInTheDocument()` matcher available; 663 node tests unaffected.
- Consumes: existing `vitest.config.ts` + `vitest.setup.ts`.

**Steps:**

- [ ] 1. Write the failing smoke test first:

  `src/components/core/__tests__/smoke.test.tsx`
  ```tsx
  // @vitest-environment jsdom
  import { describe, it, expect } from 'vitest';
  import { render, screen } from '@testing-library/react';

  describe('component test infra smoke', () => {
    it('renders a div and finds it by text', () => {
      render(<div>hello-world</div>);
      expect(screen.getByText('hello-world')).toBeInTheDocument();
    });
  });
  ```

- [ ] 2. Run: confirm it fails (`Cannot find module '@testing-library/react'`).
  ```
  npx vitest run src/components/core/__tests__/smoke.test.tsx
  ```

- [ ] 3. Install dependencies:
  ```bash
  npm install --save-dev @testing-library/react @testing-library/jest-dom jsdom katex @types/katex
  ```
  Expected: packages added to `devDependencies` in `package.json`.

- [ ] 4. Create the DOM setup file:

  `src/test/setup-dom.ts`
  ```ts
  import '@testing-library/jest-dom/vitest';
  import { afterEach } from 'vitest';
  import { cleanup } from '@testing-library/react';

  afterEach(() => {
    cleanup();
  });
  ```

- [ ] 5. Update `vitest.config.ts` to:
  - Include `*.test.tsx` files.
  - Add the DOM setup file — but load it **only** for jsdom-environment files using Vitest's `environmentMatchGlobs` so node-env files never import DOM code.
  - Keep the global `environment: 'node'` so all 663 existing tests are unaffected.

  Replace the full file:
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
        'scripts/**/*.test.ts',
        'supabase/**/*.test.ts',
      ],
      testTimeout: 15000,
      environmentMatchGlobs: [
        // Any *.test.tsx gets jsdom + the DOM setup file.
        // The per-file `// @vitest-environment jsdom` docblock is still required
        // as the canonical signal; this glob ensures the DOM setup runs too.
        ['**/*.test.tsx', 'jsdom'],
      ],
      setupFilesAfterEnv: [],
    },
  });
  ```

  Note: `@testing-library/jest-dom/vitest` is imported inside `src/test/setup-dom.ts`. To load it for jsdom test files, add a Vitest project config override. Since Vitest v2+ supports `environmentOptions.jsdom` but not per-env setup natively without projects config, the cleanest approach is to include the import directly in each DOM test file or add it to the global `setupFiles` guarded by an env check. Use the guard approach by adding to `vitest.setup.ts`:

  Update `vitest.setup.ts` — append at the end (do NOT remove existing lines):
  ```ts
  // DOM matchers — loaded for jsdom test files.
  // The import is safe in node env (jest-dom/vitest guards itself).
  if (typeof window !== 'undefined') {
    // jsdom sets window; load the matchers
    await import('@testing-library/jest-dom/vitest');
  }
  ```

  Actually, dynamic import in a setup file causes issues. Use a separate approach: each jsdom test file that needs `toBeInTheDocument()` imports `@testing-library/jest-dom/vitest` at the top, OR we use Vitest `projects` array. The cleanest zero-friction solution for this codebase (avoid projects array complexity) is to put the jest-dom import in the per-test file's `// @vitest-environment jsdom` block via an explicit import. Update the smoke test and the setup-dom.ts to make this explicit:

  Revised `src/test/setup-dom.ts`:
  ```ts
  // Loaded via vitest.setup.ts when window is defined (jsdom env).
  // Import jest-dom matchers for toBeInTheDocument() etc.
  import '@testing-library/jest-dom/vitest';
  import { afterEach } from 'vitest';
  import { cleanup } from '@testing-library/react';

  afterEach(() => {
    cleanup();
  });
  ```

  Revised `vitest.config.ts` — use the `setupFiles` array with a conditional helper:
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
        'scripts/**/*.test.ts',
        'supabase/**/*.test.ts',
      ],
      testTimeout: 15000,
      environmentMatchGlobs: [
        ['**/*.test.tsx', 'jsdom'],
      ],
    },
  });
  ```

  Add a line to `vitest.setup.ts` that conditionally loads the DOM setup when running under jsdom (append — do NOT remove existing lines):

  `vitest.setup.ts` additions at the end:
  ```ts
  // Load DOM matchers + RTL cleanup when running in a jsdom environment.
  // 'window' is undefined in node env, defined in jsdom env.
  // We use globalThis check to avoid a dynamic import (which vitest setup supports via top-level await).
  if (typeof globalThis.window !== 'undefined') {
    const { default: _jestDom } = await import('@testing-library/jest-dom/vitest');
    const { cleanup } = await import('@testing-library/react');
    const { afterEach } = await import('vitest');
    afterEach(cleanup);
  }
  ```

  However, `vitest.setup.ts` currently does not use top-level await and is plain `.ts`. The safest approach: keep `vitest.setup.ts` node-only (no changes), and instead configure `setupFiles` per environment via Vitest's `projects` feature. To keep this simple and avoid restructuring, use the following final approach: make `src/test/setup-dom.ts` the setup file and reference it only in the `environmentMatchGlobs`-companion `setupFiles` via a second entry that is guarded. **Definitively**, the correct Vitest v2 pattern is:

  Final `vitest.config.ts`:
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
        'scripts/**/*.test.ts',
        'supabase/**/*.test.ts',
      ],
      testTimeout: 15000,
      // Any *.test.tsx file is automatically run under jsdom.
      // The per-file `// @vitest-environment jsdom` docblock is the canonical
      // signal and is REQUIRED on every component test file.
      environmentMatchGlobs: [
        ['**/*.test.tsx', 'jsdom'],
      ],
    },
  });
  ```

  And update `vitest.setup.ts` — append these lines:
  ```ts
  // DOM test matchers: loaded only when running under jsdom (window is defined).
  // Component test files MUST also carry `// @vitest-environment jsdom` on line 1.
  if (typeof window !== 'undefined') {
    require('@testing-library/jest-dom/vitest');
  }
  ```

  Wait — `require` won't work cleanly here if the module uses ESM. Use a guard with a `try/catch` dynamic import: no, that's too fragile in setup context. **Final definitive approach** — no conditional in setup; instead, `src/test/setup-dom.ts` is imported directly in each `.test.tsx` file:

  Remove the conditional from `vitest.setup.ts`. Instead, update the smoke test template and document the pragma:

  **Canonical pattern for ALL component test files:**
  ```tsx
  // @vitest-environment jsdom
  import '@testing-library/jest-dom/vitest';
  import { afterEach } from 'vitest';
  import { cleanup } from '@testing-library/react';
  afterEach(cleanup);
  // ... rest of test
  ```

  This is verbose but explicit and correct. To DRY it up, `src/test/setup-dom.ts` is a re-export file that component tests import as a single line:

  `src/test/setup-dom.ts` (final):
  ```ts
  // Import this file in every component test that uses @vitest-environment jsdom.
  // It registers jest-dom matchers and cleans up the DOM after each test.
  import '@testing-library/jest-dom/vitest';
  import { afterEach } from 'vitest';
  import { cleanup } from '@testing-library/react';

  afterEach(cleanup);
  ```

  Updated `src/components/core/__tests__/smoke.test.tsx` (canonical template):
  ```tsx
  // @vitest-environment jsdom
  import { describe, it, expect } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import '@/test/setup-dom';

  describe('component test infra smoke', () => {
    it('renders a div and finds it by text', () => {
      render(<div>hello-world</div>);
      expect(screen.getByText('hello-world')).toBeInTheDocument();
    });
  });
  ```

  Final `vitest.config.ts`:
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
        'scripts/**/*.test.ts',
        'supabase/**/*.test.ts',
      ],
      testTimeout: 15000,
      environmentMatchGlobs: [
        ['**/*.test.tsx', 'jsdom'],
      ],
    },
  });
  ```

- [ ] 6. Run the smoke test — confirm it passes:
  ```
  npx vitest run src/components/core/__tests__/smoke.test.tsx
  ```
  Expected: `1 passed`.

- [ ] 7. Run the full suite — confirm all 663 node tests still pass and the smoke test is the only `.tsx` test:
  ```
  npx vitest run --reporter=verbose 2>&1 | tail -10
  ```
  Expected: all previous tests pass; smoke adds 1 passing test.

- [ ] 8. Run the layout test from Task 2 (now that deps exist):
  ```
  npx vitest run src/app/__tests__/layout.test.tsx
  ```
  Expected: `3 passed`.

- [ ] 9. Commit:
  ```bash
  git add package.json vitest.config.ts vitest.setup.ts src/test/setup-dom.ts src/components/core/__tests__/smoke.test.tsx src/app/__tests__/layout.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(design-system): add @testing-library/react + jsdom component-test infra, per-file jsdom pragma pattern (p4a T3)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 4: WCAG AA contrast gate — scripts/a11y/contrast-check.ts + npm run a11y + vitest test

**Files:**
- `scripts/a11y/contrast-check.ts` (new)
- `scripts/a11y/__tests__/contrast-check.test.ts` (new)
- `package.json` (add `"a11y"` script)

**Interfaces:**
- Produces: `contrastRatio(hex1, hex2): number`; `checkAllPairs(): ContrastResult[]`; `ContrastResult` type; exits non-zero on failure when run as a script; `npm run a11y` command.
- Consumes: Tier-2 semantic hex values — the script hardcodes the resolved hex for each role/intensity pairing (same values as globals.css) so it runs outside a browser with no CSS parsing required. When globals.css token hex values are changed, this file must be updated in sync.

**Steps:**

- [ ] 1. Write the failing test first:

  `scripts/a11y/__tests__/contrast-check.test.ts`
  ```ts
  import { describe, it, expect } from 'vitest';
  import { contrastRatio, checkAllPairs, type ContrastResult } from '../contrast-check';

  describe('contrastRatio()', () => {
    it('returns ~21 for black on white', () => {
      expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    });

    it('returns ~1 for identical colors', () => {
      expect(contrastRatio('#aabbcc', '#aabbcc')).toBeCloseTo(1, 1);
    });

    it('is commutative', () => {
      const a = contrastRatio('#059669', '#ffffff');
      const b = contrastRatio('#ffffff', '#059669');
      expect(a).toBeCloseTo(b, 5);
    });
  });

  describe('checkAllPairs()', () => {
    it('returns an array of ContrastResult for every role/intensity pairing', () => {
      const results = checkAllPairs();
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r).toHaveProperty('role');
        expect(r).toHaveProperty('intensity');
        expect(r).toHaveProperty('pair');
        expect(r).toHaveProperty('ratio');
        expect(r).toHaveProperty('passes');
        expect(r).toHaveProperty('required');
      }
    });

    it('all pairs pass WCAG AA (no failures)', () => {
      const results = checkAllPairs();
      const failures = results.filter((r) => !r.passes);
      const msg = failures
        .map((f) => `${f.role}/${f.intensity} ${f.pair}: ratio=${f.ratio.toFixed(2)} required=${f.required}`)
        .join('\n');
      expect(failures, `Contrast failures:\n${msg}`).toHaveLength(0);
    });
  });
  ```

- [ ] 2. Run: confirm it fails (`Cannot find module '../contrast-check'`).
  ```
  npx vitest run scripts/a11y/__tests__/contrast-check.test.ts
  ```

- [ ] 3. Create the contrast-check script:

  `scripts/a11y/contrast-check.ts`
  ```ts
  /**
   * WCAG AA contrast gate for CORE v2 design-system tokens.
   *
   * Hardcodes the resolved hex values for every Tier-2 fg/bg pairing across
   * all 5 roles × 2 intensities. When globals.css primitive hex changes, update
   * the ROLE_PALETTES table below in sync.
   *
   * Requirements:
   *   body text  (pair: 'fg/bg')        → ≥ 4.5 : 1
   *   muted text (pair: 'fg-muted/bg')  → ≥ 4.5 : 1  (AA for normal text)
   *   brand on surface (pair: 'brand/surface') → ≥ 3 : 1  (large/UI text)
   *   fg-on-brand (pair: 'fg-on-brand/brand')  → ≥ 4.5 : 1
   *
   * Run standalone: npx tsx scripts/a11y/contrast-check.ts
   * Run via npm:    npm run a11y
   */

  export interface ContrastResult {
    role: string;
    intensity: string;
    pair: string;
    fg: string;
    bg: string;
    ratio: number;
    required: number;
    passes: boolean;
  }

  // ---------------------------------------------------------------------------
  // WCAG relative luminance + contrast ratio
  // ---------------------------------------------------------------------------

  function hexToSrgb(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    const full = h.length === 3
      ? h.split('').map((c) => c + c).join('')
      : h;
    const n = parseInt(full, 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }

  function linearize(c8bit: number): number {
    const c = c8bit / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(hex: string): number {
    const [r, g, b] = hexToSrgb(hex);
    return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
  }

  export function contrastRatio(hex1: string, hex2: string): number {
    const l1 = relativeLuminance(hex1);
    const l2 = relativeLuminance(hex2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  // ---------------------------------------------------------------------------
  // Token table — resolved hex per role / intensity
  // SYNC WITH: src/app/globals.css  (Tier-1 ramp values + Tier-3 bindings)
  // ---------------------------------------------------------------------------

  interface Palette {
    bg: string;
    surface: string;
    fg: string;
    fgMuted: string;
    brand: string;
    fgOnBrand: string;
  }

  // Tier-1 resolved values (must match globals.css :root hex)
  const T = {
    // Emerald
    emerald600: '#059669',
    // Lime
    lime500:    '#84cc16',
    // Cobalt
    cobalt600:  '#2563eb',
    cobalt400:  '#60a5fa',
    // Coral
    coral500:   '#e0533f',
    coral300:   '#ff9d87',
    // Amber
    amber500:   '#f59e0b',
    amber300:   '#fcd34d',
    // Ink
    ink50:      '#f8f8f8',
    ink100:     '#f0f0f0',
    ink400:     '#a8a8a8',
    ink600:     '#525252',
    ink900:     '#171717',
    ink950:     '#0a0a0a',
    // Dark canvases
    canvasAdmin:    '#14132b',
    canvasPlatform: '#18181b',
    surfaceAdmin:   '#1e1d3a',
    surfacePlatform:'#27272a',
    white:          '#ffffff',
  } as const;

  const ROLE_PALETTES: Record<string, Record<string, Palette>> = {
    student: {
      loud: {
        bg:        T.ink50,
        surface:   T.white,
        fg:        T.ink900,
        fgMuted:   T.ink600,
        brand:     T.emerald600,
        fgOnBrand: T.white,
      },
    },
    teacher: {
      calm: {
        bg:        T.ink50,
        surface:   T.white,
        fg:        T.ink900,
        fgMuted:   T.ink600,
        brand:     T.cobalt600,
        fgOnBrand: T.white,
      },
    },
    parent: {
      calm: {
        bg:        T.ink50,
        surface:   T.white,
        fg:        T.ink900,
        fgMuted:   T.ink600,
        brand:     T.coral500,
        fgOnBrand: T.white,
      },
    },
    admin: {
      calm: {
        bg:        T.canvasAdmin,
        surface:   T.surfaceAdmin,
        fg:        T.ink100,
        fgMuted:   T.ink400,
        brand:     T.cobalt400,
        fgOnBrand: T.ink950,
      },
    },
    'super-admin': {
      calm: {
        bg:        T.canvasPlatform,
        surface:   T.surfacePlatform,
        fg:        T.ink100,
        fgMuted:   T.ink400,
        brand:     T.amber500,
        fgOnBrand: T.ink950,
      },
    },
  };

  // ---------------------------------------------------------------------------
  // Pair definitions: [label, fgKey, bgKey, requiredRatio]
  // ---------------------------------------------------------------------------
  type PairDef = [string, keyof Palette, keyof Palette, number];

  const PAIRS: PairDef[] = [
    ['fg/bg',          'fg',        'bg',      4.5],
    ['fg/surface',     'fg',        'surface', 4.5],
    ['fg-muted/bg',    'fgMuted',   'bg',      4.5],
    ['fg-on-brand/brand', 'fgOnBrand', 'brand', 4.5],
    ['brand/surface',  'brand',     'surface', 3.0],
  ];

  export function checkAllPairs(): ContrastResult[] {
    const results: ContrastResult[] = [];

    for (const [role, intensities] of Object.entries(ROLE_PALETTES)) {
      for (const [intensity, palette] of Object.entries(intensities)) {
        for (const [pairLabel, fgKey, bgKey, required] of PAIRS) {
          const fg = palette[fgKey];
          const bg = palette[bgKey];
          const ratio = contrastRatio(fg, bg);
          results.push({
            role,
            intensity,
            pair: pairLabel,
            fg,
            bg,
            ratio,
            required,
            passes: ratio >= required,
          });
        }
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // CLI entry point
  // ---------------------------------------------------------------------------
  if (process.argv[1] && process.argv[1].endsWith('contrast-check.ts')) {
    const results = checkAllPairs();
    const failures = results.filter((r) => !r.passes);
    const total = results.length;
    const passed = total - failures.length;

    console.log(`\nCORE v2 — WCAG AA contrast check`);
    console.log(`${'─'.repeat(60)}`);

    for (const r of results) {
      const icon = r.passes ? '✓' : '✗';
      const status = r.passes ? 'PASS' : 'FAIL';
      console.log(
        `${icon} [${status}]  ${r.role}/${r.intensity}  ${r.pair.padEnd(22)}` +
        `  ratio=${r.ratio.toFixed(2).padStart(5)}  req≥${r.required}`
      );
    }

    console.log(`${'─'.repeat(60)}`);
    console.log(`${passed}/${total} pairs passed.\n`);

    if (failures.length > 0) {
      console.error(`ERROR: ${failures.length} contrast failure(s). Fix globals.css or this token table.\n`);
      process.exit(1);
    } else {
      console.log(`All pairs meet WCAG AA. ✓\n`);
      process.exit(0);
    }
  }
  ```

- [ ] 4. Add `"a11y"` script to `package.json`:

  In `package.json`, add to the `"scripts"` block:
  ```json
  "a11y": "npx tsx scripts/a11y/contrast-check.ts"
  ```
  The full scripts block becomes:
  ```json
  "scripts": {
    "dev": "next dev",
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

- [ ] 5. Run the contrast-check vitest test:
  ```
  npx vitest run scripts/a11y/__tests__/contrast-check.test.ts
  ```
  Expected: `5 passed` (contrastRatio math tests + checkAllPairs shape test + all-pairs-pass test).

- [ ] 6. Run the a11y script directly to confirm CLI output:
  ```
  npm run a11y
  ```
  Expected: all pairs PASS, exit 0, output ends with "All pairs meet WCAG AA. ✓".

- [ ] 7. Run the full suite to confirm everything is still green:
  ```
  npx vitest run 2>&1 | tail -5
  ```
  Expected: all tests pass (663 node + new component/scripts tests).

- [ ] 8. Commit:
  ```bash
  git add scripts/a11y/contrast-check.ts scripts/a11y/__tests__/contrast-check.test.ts package.json
  git commit -m "$(cat <<'EOF'
  feat(design-system): add WCAG AA contrast gate script + npm run a11y + vitest coverage (p4a T4)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 5: RoleLayout — parameterized role shell

**Files:**
- `src/components/core/RoleLayout.tsx` (create)
- `src/components/core/__tests__/RoleLayout.test.tsx` (create)

**Interfaces:**
- Consumes: nothing (pure presentational, no imports from Plan 1–3 except the `Role` type it defines itself)
- Produces: `type Role` + `<RoleLayout role={Role} nav?={React.ReactNode} children>` exported from `src/components/core/RoleLayout.tsx`

---

#### Step 1 — Write the failing test

Create `src/components/core/__tests__/RoleLayout.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RoleLayout, type Role } from '../RoleLayout';

afterEach(cleanup);

describe('RoleLayout', () => {
  it('renders children inside the layout', () => {
    render(
      <RoleLayout role="student">
        <span data-testid="child">hello</span>
      </RoleLayout>
    );
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('renders the ◆ CORE mark', () => {
    render(<RoleLayout role="teacher">content</RoleLayout>);
    expect(screen.getByText('◆ CORE')).toBeTruthy();
  });

  it('sets data-role="student" on the root element', () => {
    const { container } = render(<RoleLayout role="student">x</RoleLayout>);
    expect(container.firstElementChild?.getAttribute('data-role')).toBe('student');
  });

  it('sets data-intensity="loud" for student role', () => {
    const { container } = render(<RoleLayout role="student">x</RoleLayout>);
    expect(container.firstElementChild?.getAttribute('data-intensity')).toBe('loud');
  });

  it.each<[Role, string]>([
    ['teacher', 'calm'],
    ['parent', 'calm'],
    ['admin', 'calm'],
    ['super-admin', 'calm'],
  ])('sets data-intensity="calm" for role %s', (role, expected) => {
    const { container } = render(<RoleLayout role={role}>x</RoleLayout>);
    expect(container.firstElementChild?.getAttribute('data-intensity')).toBe(expected);
  });

  it.each<Role>(['teacher', 'parent', 'admin', 'super-admin'])(
    'sets data-role="%s" correctly',
    (role) => {
      const { container } = render(<RoleLayout role={role}>x</RoleLayout>);
      expect(container.firstElementChild?.getAttribute('data-role')).toBe(role);
    }
  );

  it('renders an optional nav slot', () => {
    render(
      <RoleLayout role="teacher" nav={<a href="/home">Home</a>}>
        content
      </RoleLayout>
    );
    expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy();
  });
});
```

#### Step 2 — Run: expect failures

```bash
npx vitest run src/components/core/__tests__/RoleLayout.test.tsx
```

Expected output: all tests **fail** (module not found / import error).

---

#### Step 3 — Install missing test-infra deps (if not already done by an earlier task in this plan)

> This step is a no-op if the foundation task (Task 1) already installed these. Run the install only if `@testing-library/react` is absent from `node_modules`.

```bash
npm install --save-dev @testing-library/react @testing-library/jest-dom jsdom
```

Add the jsdom test-setup file (if it does not yet exist at `vitest.setup.dom.ts` in the repo root):

```ts
// vitest.setup.dom.ts  — loaded ONLY by jsdom test files (via the per-file docblock)
import '@testing-library/jest-dom/vitest';
```

Open `vitest.config.ts` and add `.tsx` to the `include` glob **without** changing the global `environment` (it stays `'node'`):

```ts
// vitest.config.ts — replace the include array
include: [
  'src/**/*.test.ts',
  'src/**/*.test.tsx',
  'scripts/**/*.test.ts',
  'supabase/**/*.test.ts',
],
```

> The per-file `// @vitest-environment jsdom` docblock in each `.test.tsx` file activates jsdom per-file; the global env stays `'node'` so the 663 backend tests are unaffected.

---

#### Step 4 — Implement `src/components/core/RoleLayout.tsx`

Create the file. Every styling token is a semantic CSS variable — no hardcoded hex anywhere in this file.

```tsx
// src/components/core/RoleLayout.tsx
// Pure presentational role shell — sets data-role + data-intensity on the root,
// renders the ◆ CORE mark and an optional nav slot.
// Components and route-group layouts (4b–4e) import from here.

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

---

#### Step 5 — Run: expect all tests to pass

```bash
npx vitest run src/components/core/__tests__/RoleLayout.test.tsx
```

Expected output:

```
✓ src/components/core/__tests__/RoleLayout.test.tsx (8)
  ✓ RoleLayout > renders children inside the layout
  ✓ RoleLayout > renders the ◆ CORE mark
  ✓ RoleLayout > sets data-role="student" on the root element
  ✓ RoleLayout > sets data-intensity="loud" for student role
  ✓ RoleLayout > sets data-intensity="calm" for role teacher
  ✓ RoleLayout > sets data-intensity="calm" for role parent
  ✓ RoleLayout > sets data-intensity="calm" for role admin
  ✓ RoleLayout > sets data-intensity="calm" for role super-admin
  ✓ RoleLayout > sets data-role="teacher" correctly
  ✓ RoleLayout > sets data-role="parent" correctly
  ✓ RoleLayout > sets data-role="admin" correctly
  ✓ RoleLayout > sets data-role="super-admin" correctly
  ✓ RoleLayout > renders an optional nav slot

Test Files  1 passed (1)
Tests       13 passed (13)
```

---

#### Step 6 — Verify existing backend tests are unaffected

```bash
npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: all existing `.test.ts` (backend) tests still pass; only the new `.test.tsx` file is added to the count.

---

#### Step 7 — Type-check

```bash
npx tsc --noEmit
```

Expected output: exit 0, no errors.

---

#### Step 8 — Commit

```bash
git add src/components/core/RoleLayout.tsx src/components/core/__tests__/RoleLayout.test.tsx vitest.config.ts vitest.setup.dom.ts
git commit -m "$(cat <<'EOF'
feat(p4a): Task 5 — RoleLayout parameterized shell with data-role/intensity

Adds the RoleLayout component (student→loud, all others→calm) with the
◆ CORE mark and optional nav slot. Exports the Role union type used by
all plan-4 slices. Extends vitest include glob to cover *.test.tsx
(per-file jsdom docblock, global env stays node so backend tests are
unaffected).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

### Task 6: GrowthMotif — stepped "you vs 4 weeks ago" growth viz

**Files:**
- `src/components/core/GrowthMotif.tsx` (create)
- `src/components/core/__tests__/GrowthMotif.test.tsx` (create)

**Interfaces:**
- Consumes: nothing external (pure presentational)
- Produces: `<GrowthMotif history={number[]} deltaLabel?={string} />` — renders N stepped bars when `history.length >= 4`; renders cold-start state when `history.length < 4`; colors via `--brand`/`--brand-accent` CSS vars (loud/calm via inherited `data-intensity` CSS, NOT a prop); never peer-relative copy

---

- [ ] **Step 1 — Install deps (if not already done by an earlier task).** The test file uses `@testing-library/react`, `jsdom`, and `@testing-library/jest-dom`; if the task running the infra slice (T1) has not installed them yet, run:

  ```bash
  npm install --save-dev @testing-library/react @testing-library/jest-dom jsdom
  ```

  Expected output: packages added to `package.json` devDependencies.

- [ ] **Step 2 — Create the DOM setup file for jsdom tests (if not already created by an earlier task).** If `src/test-setup.dom.ts` does not exist, create it:

  **`src/test-setup.dom.ts`**
  ```ts
  import '@testing-library/jest-dom/vitest';
  import { cleanup } from '@testing-library/react';
  import { afterEach } from 'vitest';

  afterEach(cleanup);
  ```

- [ ] **Step 3 — Write the failing test file.**

  **`src/components/core/__tests__/GrowthMotif.test.tsx`**
  ```tsx
  // @vitest-environment jsdom
  import { describe, it, expect } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import '../.././../test-setup.dom';
  import { GrowthMotif } from '../GrowthMotif';

  describe('GrowthMotif', () => {
    it('renders one bar per history point when history has 4 or more values', () => {
      render(<GrowthMotif history={[40, 60, 55, 80]} />);
      const bars = screen.getAllByRole('presentation');
      expect(bars).toHaveLength(4);
    });

    it('renders bars for exactly 4 points', () => {
      render(<GrowthMotif history={[10, 20, 30, 40]} />);
      expect(screen.getAllByRole('presentation')).toHaveLength(4);
    });

    it('renders bars for more than 4 points', () => {
      render(<GrowthMotif history={[10, 20, 30, 40, 50, 60, 70, 80]} />);
      expect(screen.getAllByRole('presentation')).toHaveLength(8);
    });

    it('renders cold-start text when history has fewer than 4 points', () => {
      render(<GrowthMotif history={[55, 70]} />);
      expect(screen.getByText(/just getting started/i)).toBeInTheDocument();
    });

    it('renders cold-start text when history is empty', () => {
      render(<GrowthMotif history={[]} />);
      expect(screen.getByText(/just getting started/i)).toBeInTheDocument();
    });

    it('renders cold-start text when history has exactly 3 points', () => {
      render(<GrowthMotif history={[30, 50, 70]} />);
      expect(screen.getByText(/just getting started/i)).toBeInTheDocument();
    });

    it('does NOT render bars in cold-start state', () => {
      render(<GrowthMotif history={[55]} />);
      expect(screen.queryAllByRole('presentation')).toHaveLength(0);
    });

    it('shows deltaLabel when provided alongside enough history', () => {
      render(<GrowthMotif history={[40, 60, 55, 80]} deltaLabel="+18 pts vs 4 weeks ago" />);
      expect(screen.getByText('+18 pts vs 4 weeks ago')).toBeInTheDocument();
    });

    it('does NOT show deltaLabel in cold-start state even if provided', () => {
      render(<GrowthMotif history={[40]} deltaLabel="+18 pts vs 4 weeks ago" />);
      expect(screen.queryByText('+18 pts vs 4 weeks ago')).not.toBeInTheDocument();
    });

    it('copy never contains peer-relative language', () => {
      const { container } = render(<GrowthMotif history={[40, 60, 55, 80]} deltaLabel="you vs 4 weeks ago" />);
      expect(container.textContent).not.toMatch(/class average|other students|compared to peers/i);
    });
  });
  ```

- [ ] **Step 4 — Run the tests; confirm they FAIL (module not found).**

  ```bash
  npx vitest run src/components/core/__tests__/GrowthMotif.test.tsx
  ```

  Expected output: test run fails with `Cannot find module '../GrowthMotif'` or equivalent import error.

- [ ] **Step 5 — Create the component.**

  **`src/components/core/GrowthMotif.tsx`**
  ```tsx
  // src/components/core/GrowthMotif.tsx
  // Signature growth viz: "you vs your own past" — stepped bars.
  // Colors use --brand / --brand-accent CSS vars (set by role/intensity CSS binding in globals.css).
  // loud vs calm handled by inherited data-intensity CSS selectors — NOT a prop here.
  // Never peer-relative; never fabricates a trend from <4 data points.

  interface GrowthMotifProps {
    /** Ordered history of scores (oldest first). Must have ≥4 points to render bars. */
    history: number[];
    /** Optional copy shown below the bars (e.g. "+18 pts vs 4 weeks ago"). */
    deltaLabel?: string;
  }

  /** Maximum value used for bar scaling. Bars are a % of this ceiling. */
  const SCALE_CEIL = 100;

  function clamp(n: number): number {
    return Math.max(0, Math.min(SCALE_CEIL, n));
  }

  export function GrowthMotif({ history, deltaLabel }: GrowthMotifProps) {
    const hasEnoughData = history.length >= 4;

    if (!hasEnoughData) {
      return (
        <div className="growth-motif growth-motif--cold-start" data-testid="growth-motif-cold-start">
          <p className="growth-motif__cold-start-label">just getting started</p>
        </div>
      );
    }

    const maxVal = Math.max(...history, 1);
    const scale = SCALE_CEIL / Math.max(maxVal, SCALE_CEIL);

    return (
      <div className="growth-motif" data-testid="growth-motif">
        <div className="growth-motif__bars" aria-label="growth history bars">
          {history.map((value, i) => {
            const heightPct = clamp(value * scale);
            const isLast = i === history.length - 1;
            return (
              <div
                key={i}
                role="presentation"
                className={`growth-motif__bar${isLast ? ' growth-motif__bar--current' : ''}`}
                style={{ height: `${heightPct}%` }}
              />
            );
          })}
        </div>
        {deltaLabel && (
          <p className="growth-motif__delta-label">{deltaLabel}</p>
        )}
      </div>
    );
  }

  export default GrowthMotif;
  ```

- [ ] **Step 6 — Run the tests; confirm they PASS.**

  ```bash
  npx vitest run src/components/core/__tests__/GrowthMotif.test.tsx
  ```

  Expected output: `Tests 11 passed (11)` (or all passing). Zero failures.

- [ ] **Step 7 — Type-check.**

  ```bash
  npx tsc --noEmit
  ```

  Expected output: no errors.

- [ ] **Step 8 — Commit.**

  ```bash
  git add src/components/core/GrowthMotif.tsx src/components/core/__tests__/GrowthMotif.test.tsx src/test-setup.dom.ts
  git commit -m "$(cat <<'EOF'
  feat(p4a): GrowthMotif signature viz with cold-start guard

  Stepped "you vs your own past" bars; <4 history points → dignified
  cold-start state, never a fabricated trend. Colors via --brand/--brand-accent
  CSS vars; loud/calm driven by inherited data-intensity, not a prop.
  Adds jsdom test-setup + 11 RTL tests.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 7: topicFrame copy helper + MasteryLabel pill component

**Files:**
- `src/lib/copy/topicFrame.ts` (create)
- `src/lib/copy/__tests__/topicFrame.test.ts` (create)
- `src/components/core/MasteryLabel.tsx` (create)
- `src/components/core/__tests__/MasteryLabel.test.tsx` (create)

**Interfaces:**
- Consumes: `masteryDisplayLabel` from `@/lib/utils/masteryLabel` (already exists — DO NOT reimplement the mapping)
- Produces:
  - `topicFrame(topic: string): string` exported from `src/lib/copy/topicFrame.ts`
  - `<MasteryLabel band={string|null} />` exported from `src/components/core/MasteryLabel.tsx`

---

- [ ] **Step 1 — Write the failing tests for `topicFrame`.**

  **`src/lib/copy/__tests__/topicFrame.test.ts`**
  ```ts
  import { describe, it, expect } from 'vitest';
  import { topicFrame } from '@/lib/copy/topicFrame';

  describe('topicFrame', () => {
    it('prefixes with "still building: " and title-cases the topic', () => {
      expect(topicFrame('fractions')).toBe('still building: Fractions');
    });

    it('title-cases multi-word topics', () => {
      expect(topicFrame('long division')).toBe('still building: Long Division');
    });

    it('title-cases already-uppercase input correctly', () => {
      expect(topicFrame('FRACTIONS')).toBe('still building: Fractions');
    });

    it('title-cases mixed-case input', () => {
      expect(topicFrame('aLgEbRa')).toBe('still building: Algebra');
    });

    it('handles a single character', () => {
      expect(topicFrame('x')).toBe('still building: X');
    });

    it('handles a topic already in Title Case', () => {
      expect(topicFrame('Long Division')).toBe('still building: Long Division');
    });

    it('trims leading/trailing whitespace before framing', () => {
      expect(topicFrame('  fractions  ')).toBe('still building: Fractions');
    });

    it('never uses the word "struggle" in output', () => {
      const result = topicFrame('fractions');
      expect(result).not.toMatch(/struggle/i);
    });
  });
  ```

- [ ] **Step 2 — Write the failing tests for `MasteryLabel`.**

  **`src/components/core/__tests__/MasteryLabel.test.tsx`**
  ```tsx
  // @vitest-environment jsdom
  import { describe, it, expect } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import '../../../test-setup.dom';
  import { MasteryLabel } from '../MasteryLabel';

  describe('MasteryLabel', () => {
    it("renders 'Building' for band 'reteach'", () => {
      render(<MasteryLabel band="reteach" />);
      expect(screen.getByText('Building')).toBeInTheDocument();
    });

    it("renders 'On Track' for band 'grade_level'", () => {
      render(<MasteryLabel band="grade_level" />);
      expect(screen.getByText('On Track')).toBeInTheDocument();
    });

    it("renders 'Strong' for band 'advanced'", () => {
      render(<MasteryLabel band="advanced" />);
      expect(screen.getByText('Strong')).toBeInTheDocument();
    });

    it("renders 'Not yet assessed' for null band", () => {
      render(<MasteryLabel band={null} />);
      expect(screen.getByText('Not yet assessed')).toBeInTheDocument();
    });

    it("renders 'Not yet assessed' for unknown band string", () => {
      render(<MasteryLabel band="some_unknown_band" />);
      expect(screen.getByText('Not yet assessed')).toBeInTheDocument();
    });

    it('NEVER renders the raw enum value for reteach', () => {
      render(<MasteryLabel band="reteach" />);
      expect(screen.queryByText('reteach')).not.toBeInTheDocument();
    });

    it('NEVER renders the raw enum value for grade_level', () => {
      render(<MasteryLabel band="grade_level" />);
      expect(screen.queryByText('grade_level')).not.toBeInTheDocument();
    });

    it('NEVER renders the raw enum value for advanced', () => {
      render(<MasteryLabel band="advanced" />);
      expect(screen.queryByText('advanced')).not.toBeInTheDocument();
    });

    it('renders as a pill element (has mastery-label class)', () => {
      const { container } = render(<MasteryLabel band="reteach" />);
      expect(container.firstChild).toHaveClass('mastery-label');
    });
  });
  ```

- [ ] **Step 3 — Run both test files; confirm they FAIL (modules not found).**

  ```bash
  npx vitest run src/lib/copy/__tests__/topicFrame.test.ts src/components/core/__tests__/MasteryLabel.test.tsx
  ```

  Expected output: failures with `Cannot find module` for both new files.

- [ ] **Step 4 — Create the `topicFrame` helper.**

  First create the directory if needed:
  ```bash
  mkdir -p src/lib/copy src/lib/copy/__tests__
  ```

  **`src/lib/copy/topicFrame.ts`**
  ```ts
  // src/lib/copy/topicFrame.ts
  // Copy register: frames a raw struggle topic as "still building" copy
  // for student/parent surfaces (SCOPE §15 carry-forward B4).
  // Pure helper — no Next.js / Supabase imports.

  /**
   * Title-cases each word in a string.
   * "long division" → "Long Division"
   * "FRACTIONS" → "Fractions"
   */
  function toTitleCase(str: string): string {
    return str
      .toLowerCase()
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }

  /**
   * Frames a raw struggle topic as encouraging "still building" copy.
   * Example: "fractions" → "still building: Fractions"
   * Never uses the word "struggle" in output.
   */
  export function topicFrame(topic: string): string {
    return `still building: ${toTitleCase(topic.trim())}`;
  }
  ```

- [ ] **Step 5 — Create the `MasteryLabel` component.**

  First create the directory if needed:
  ```bash
  mkdir -p src/components/core src/components/core/__tests__
  ```

  **`src/components/core/MasteryLabel.tsx`**
  ```tsx
  // src/components/core/MasteryLabel.tsx
  // Renders the mastery band as a soft-word pill.
  // SCOPE §15: delegates ALL band→label mapping to masteryDisplayLabel;
  // DO NOT reimplement the mapping here.
  // Colors reference only Tier-2 CSS vars (--brand, --ok, --warn, --risk, --surface).

  import { masteryDisplayLabel } from '@/lib/utils/masteryLabel';

  interface MasteryLabelProps {
    /** Raw DB mastery_band enum value, or null for "not yet assessed". */
    band: string | null;
  }

  /**
   * Pill component that renders the human-readable mastery label.
   * 'reteach' → 'Building' | 'grade_level' → 'On Track' | 'advanced' → 'Strong' | null → 'Not yet assessed'
   */
  export function MasteryLabel({ band }: MasteryLabelProps) {
    const label = masteryDisplayLabel(band);

    return (
      <span className="mastery-label" data-band={band ?? 'none'}>
        {label}
      </span>
    );
  }

  export default MasteryLabel;
  ```

- [ ] **Step 6 — Run both test suites; confirm they PASS.**

  ```bash
  npx vitest run src/lib/copy/__tests__/topicFrame.test.ts src/components/core/__tests__/MasteryLabel.test.tsx
  ```

  Expected output: `Tests 17 passed (17)` (8 topicFrame + 9 MasteryLabel). Zero failures.

- [ ] **Step 7 — Run the full node-env test suite to confirm no regressions.**

  ```bash
  npx vitest run
  ```

  Expected output: all pre-existing node-environment tests (663+) still pass. Only the new test files are added to the passing count.

- [ ] **Step 8 — Type-check.**

  ```bash
  npx tsc --noEmit
  ```

  Expected output: no errors.

- [ ] **Step 9 — Commit.**

  ```bash
  git add src/lib/copy/topicFrame.ts src/lib/copy/__tests__/topicFrame.test.ts src/components/core/MasteryLabel.tsx src/components/core/__tests__/MasteryLabel.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(p4a): topicFrame copy helper + MasteryLabel pill component

  topicFrame() frames raw struggle topics as "still building: <Title Case>"
  copy for student/parent surfaces (never uses the word "struggle").
  MasteryLabel delegates entirely to masteryDisplayLabel — no remapped
  enum strings ever reach the UI. 17 new tests; node-env suite unaffected.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 8: riskBandLabel util + RiskBadge component

**Files:**
- `src/lib/copy/riskBandLabel.ts` (new)
- `src/lib/copy/__tests__/riskBandLabel.test.ts` (new)
- `src/components/core/RiskBadge.tsx` (new)
- `src/components/core/__tests__/RiskBadge.test.tsx` (new)

**Interfaces:**
- Consumes: nothing (pure function + Tier-2 CSS tokens `--risk`, `--fg-on-brand`, `--surface`, `--radius`)
- Produces: `riskBandLabel(score: number, scale?: '0to1' | '0to100'): 'low' | 'medium' | 'high' | 'critical'` from `src/lib/copy/riskBandLabel.ts`; `<RiskBadge score={number} scale?={'0to1'|'0to100'} />` from `src/components/core/RiskBadge.tsx`

---

- [ ] 1. Confirm branch exists or create it:

```bash
git -C C:/users/inteliflow/NEW-CORE checkout -b feat/p4a-design-system 2>/dev/null \
  || git -C C:/users/inteliflow/NEW-CORE checkout feat/p4a-design-system
```

Expected output: `Switched to a new branch 'feat/p4a-design-system'` (or `Switched to branch ...` if it already exists).

- [ ] 2. Create the `__tests__` directory for lib/copy if needed, then write the **failing test first**:

```bash
mkdir -p C:/users/inteliflow/NEW-CORE/src/lib/copy/__tests__
```

Write `src/lib/copy/__tests__/riskBandLabel.test.ts`:

```typescript
// src/lib/copy/__tests__/riskBandLabel.test.ts
import { describe, it, expect } from 'vitest';
import { riskBandLabel } from '../riskBandLabel';

describe('riskBandLabel — 0to100 scale (default)', () => {
  it('0 → low', () => expect(riskBandLabel(0)).toBe('low'));
  it('24 → low', () => expect(riskBandLabel(24)).toBe('low'));
  it('25 → medium', () => expect(riskBandLabel(25)).toBe('medium'));
  it('49 → medium', () => expect(riskBandLabel(49)).toBe('medium'));
  it('50 → high', () => expect(riskBandLabel(50)).toBe('high'));
  it('74 → high', () => expect(riskBandLabel(74)).toBe('high'));
  it('75 → critical', () => expect(riskBandLabel(75)).toBe('critical'));
  it('100 → critical', () => expect(riskBandLabel(100)).toBe('critical'));
});

describe('riskBandLabel — explicit 0to100 scale', () => {
  it('0 → low', () => expect(riskBandLabel(0, '0to100')).toBe('low'));
  it('50 → high', () => expect(riskBandLabel(50, '0to100')).toBe('high'));
  it('75 → critical', () => expect(riskBandLabel(75, '0to100')).toBe('critical'));
});

describe('riskBandLabel — 0to1 scale', () => {
  it('0.0 → low', () => expect(riskBandLabel(0.0, '0to1')).toBe('low'));
  it('0.24 → low', () => expect(riskBandLabel(0.24, '0to1')).toBe('low'));
  it('0.25 → medium', () => expect(riskBandLabel(0.25, '0to1')).toBe('medium'));
  it('0.49 → medium', () => expect(riskBandLabel(0.49, '0to1')).toBe('medium'));
  it('0.50 → high', () => expect(riskBandLabel(0.50, '0to1')).toBe('high'));
  it('0.74 → high', () => expect(riskBandLabel(0.74, '0to1')).toBe('high'));
  it('0.75 → critical', () => expect(riskBandLabel(0.75, '0to1')).toBe('critical'));
  it('1.0 → critical', () => expect(riskBandLabel(1.0, '0to1')).toBe('critical'));
});
```

- [ ] 3. Run the test — confirm it **fails** (module not found):

```bash
npx vitest run src/lib/copy/__tests__/riskBandLabel.test.ts --reporter=verbose
```

Expected: `Error: Cannot find module '../riskBandLabel'` or similar import failure.

- [ ] 4. Write the minimal implementation `src/lib/copy/riskBandLabel.ts`:

```typescript
// src/lib/copy/riskBandLabel.ts
// Bands a raw 0–100 (or 0–1) risk score into a display label.
// SCOPE §16 / spec §4: teacher/admin surfaces render the BAND, never the raw number.
// Pure + import-safe (no Next.js / Supabase imports).

export type RiskBand = 'low' | 'medium' | 'high' | 'critical';

/**
 * Converts a numeric risk score to a display band.
 *
 * @param score  - Raw score on the chosen scale.
 * @param scale  - '0to100' (default) or '0to1' (multiplied ×100 before banding).
 * @returns      - 'low' (<25) / 'medium' (<50) / 'high' (<75) / 'critical' (≥75).
 */
export function riskBandLabel(
  score: number,
  scale: '0to1' | '0to100' = '0to100',
): RiskBand {
  const normalised = scale === '0to1' ? score * 100 : score;
  if (normalised < 25) return 'low';
  if (normalised < 50) return 'medium';
  if (normalised < 75) return 'high';
  return 'critical';
}
```

- [ ] 5. Re-run — confirm **all pass**:

```bash
npx vitest run src/lib/copy/__tests__/riskBandLabel.test.ts --reporter=verbose
```

Expected: `✓ src/lib/copy/__tests__/riskBandLabel.test.ts (19 tests)`.

- [ ] 6. Create the component `__tests__` directory, then write the **failing component test**:

```bash
mkdir -p C:/users/inteliflow/NEW-CORE/src/components/core/__tests__
```

Write `src/components/core/__tests__/RiskBadge.test.tsx`:

```typescript
// @vitest-environment jsdom
// src/components/core/__tests__/RiskBadge.test.tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RiskBadge } from '../RiskBadge';

afterEach(cleanup);

describe('RiskBadge — band label rendering', () => {
  it('renders "low" for score 10 (0to100)', () => {
    render(<RiskBadge score={10} />);
    expect(screen.getByText('low')).toBeInTheDocument();
  });

  it('renders "medium" for score 30 (0to100)', () => {
    render(<RiskBadge score={30} />);
    expect(screen.getByText('medium')).toBeInTheDocument();
  });

  it('renders "high" for score 60 (0to100)', () => {
    render(<RiskBadge score={60} />);
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('renders "critical" for score 80 (0to100)', () => {
    render(<RiskBadge score={80} />);
    expect(screen.getByText('critical')).toBeInTheDocument();
  });

  it('renders "low" for score 0.1 (0to1 scale)', () => {
    render(<RiskBadge score={0.1} scale="0to1" />);
    expect(screen.getByText('low')).toBeInTheDocument();
  });

  it('renders "critical" for score 0.9 (0to1 scale)', () => {
    render(<RiskBadge score={0.9} scale="0to1" />);
    expect(screen.getByText('critical')).toBeInTheDocument();
  });
});

describe('RiskBadge — NEVER renders the raw numeric score', () => {
  it('does not render the numeric score 10 in the DOM', () => {
    render(<RiskBadge score={10} />);
    expect(screen.queryByText('10')).not.toBeInTheDocument();
    expect(screen.queryByText(/\b10\b/)).not.toBeInTheDocument();
  });

  it('does not render the numeric score 80 in the DOM', () => {
    render(<RiskBadge score={80} />);
    expect(screen.queryByText('80')).not.toBeInTheDocument();
    expect(screen.queryByText(/\b80\b/)).not.toBeInTheDocument();
  });

  it('does not render 0.9 (0to1 score) in the DOM', () => {
    render(<RiskBadge score={0.9} scale="0to1" />);
    expect(screen.queryByText('0.9')).not.toBeInTheDocument();
    expect(screen.queryByText(/0\.9/)).not.toBeInTheDocument();
  });

  it('container has no data-score attribute exposing the number', () => {
    const { container } = render(<RiskBadge score={42} />);
    expect(container.firstChild).not.toHaveAttribute('data-score');
  });
});

describe('RiskBadge — semantic role attribute', () => {
  it('has role="status" for screen readers', () => {
    render(<RiskBadge score={50} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
```

- [ ] 7. Run the component test — confirm it **fails** (module not found + missing deps):

```bash
npx vitest run src/components/core/__tests__/RiskBadge.test.tsx --reporter=verbose
```

Expected: `Cannot find module '@testing-library/react'` or `Cannot find module '../RiskBadge'`.

- [ ] 8. Install missing deps:

```bash
cd C:/users/inteliflow/NEW-CORE && npm install --save-dev @testing-library/react @testing-library/jest-dom jsdom @types/react @types/react-dom
```

Expected: package-lock updated, no peer-dep errors.

- [ ] 9. Write the minimal implementation `src/components/core/RiskBadge.tsx`:

```typescript
// src/components/core/RiskBadge.tsx
// Teacher/admin-only component. Renders a risk score as a BANDED label pill.
// NEVER renders the raw numeric score — spec §4 / SCOPE §16.
// All colors reference Tier-2 semantic tokens only (no hardcoded hex).
'use client';

import React from 'react';
import { riskBandLabel, type RiskBand } from '@/lib/copy/riskBandLabel';

export interface RiskBadgeProps {
  score: number;
  scale?: '0to1' | '0to100';
}

const BAND_STYLES: Record<RiskBand, string> = {
  low:      'bg-[color:var(--ok)]      text-[color:var(--fg-on-brand)]',
  medium:   'bg-[color:var(--warn)]    text-[color:var(--fg-on-brand)]',
  high:     'bg-[color:var(--risk)]    text-[color:var(--fg-on-brand)]',
  critical: 'bg-[color:var(--risk)]    text-[color:var(--fg-on-brand)] ring-2 ring-[color:var(--risk)]',
};

export function RiskBadge({ score, scale = '0to100' }: RiskBadgeProps) {
  const band = riskBandLabel(score, scale);

  return (
    <span
      role="status"
      aria-label={`Risk level: ${band}`}
      className={[
        'inline-flex items-center px-2 py-0.5 rounded-[var(--radius)]',
        'text-xs font-medium select-none',
        BAND_STYLES[band],
      ].join(' ')}
    >
      {band}
    </span>
  );
}
```

- [ ] 10. Re-run both test files — confirm **all pass**:

```bash
npx vitest run src/lib/copy/__tests__/riskBandLabel.test.ts src/components/core/__tests__/RiskBadge.test.tsx --reporter=verbose
```

Expected: `✓ riskBandLabel.test.ts (19 tests)` and `✓ RiskBadge.test.tsx (11 tests)`.

- [ ] 11. Run the full test suite to ensure no regressions:

```bash
npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: previously-passing node-env tests still pass; new jsdom tests pass.

- [ ] 12. Commit:

```bash
git -C C:/users/inteliflow/NEW-CORE add \
  src/lib/copy/riskBandLabel.ts \
  src/lib/copy/__tests__/riskBandLabel.test.ts \
  src/components/core/RiskBadge.tsx \
  src/components/core/__tests__/RiskBadge.test.tsx \
  package.json \
  package-lock.json
git -C C:/users/inteliflow/NEW-CORE commit -m "$(cat <<'EOF'
feat(p4a): Task 8 — riskBandLabel util + RiskBadge component

Adds riskBandLabel() (pure, 0to100/0to1 scales, 4 band cutoffs) and
RiskBadge (teacher/admin-only pill that renders ONLY the band label,
never the raw numeric score). 19 util tests + 11 component tests green.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

Expected: `[feat/p4a-design-system ...] feat(p4a): Task 8 ...`.

---

### Task 9: CLBadge component

**Files:**
- `src/components/core/CLBadge.tsx` (new)
- `src/components/core/__tests__/CLBadge.test.tsx` (new)

**Interfaces:**
- Consumes: `SkillLearningState`, `CL_VERB_BY_STATE` from `@/lib/skills/clVerbs` (already exists)
- Produces: `<CLBadge state={SkillLearningState} confidence?={number|null} />` from `src/components/core/CLBadge.tsx`; soft-word confidence mapping (`>=70` → `'consistent'`, `>=40` → `'tentative'`, else `'emerging'`; `null` → no confidence text shown); raw 0–100 number NEVER appears.

---

- [ ] 1. Write the **failing test first**:

Write `src/components/core/__tests__/CLBadge.test.tsx`:

```typescript
// @vitest-environment jsdom
// src/components/core/__tests__/CLBadge.test.tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CLBadge } from '../CLBadge';
import type { SkillLearningState } from '@/lib/skills/clVerbs';

afterEach(cleanup);

// ---------------------------------------------------------------------------
// State → CL verb mapping
// ---------------------------------------------------------------------------
describe('CLBadge — state → verb', () => {
  const cases: [SkillLearningState, string][] = [
    ['needs_different_instruction', 'Reinforce'],
    ['needs_more_time',             'Reinforce'],
    ['on_track',                    'On Track'],
    ['ready_to_extend',             'Enrich'],
  ];

  for (const [state, expectedVerb] of cases) {
    it(`${state} → "${expectedVerb}"`, () => {
      render(<CLBadge state={state} />);
      expect(screen.getByText(expectedVerb)).toBeInTheDocument();
    });
  }
});

// ---------------------------------------------------------------------------
// Null-verb states → "Not yet assessed"
// ---------------------------------------------------------------------------
describe('CLBadge — cold-start states → "Not yet assessed"', () => {
  it('insufficient_data → "Not yet assessed"', () => {
    render(<CLBadge state="insufficient_data" />);
    expect(screen.getByText('Not yet assessed')).toBeInTheDocument();
  });

  it('not_attempted → "Not yet assessed"', () => {
    render(<CLBadge state="not_attempted" />);
    expect(screen.getByText('Not yet assessed')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Confidence → soft word (never the raw number)
// ---------------------------------------------------------------------------
describe('CLBadge — confidence → soft word', () => {
  it('confidence 70 → "consistent"', () => {
    render(<CLBadge state="on_track" confidence={70} />);
    expect(screen.getByText(/consistent/i)).toBeInTheDocument();
  });

  it('confidence 95 → "consistent"', () => {
    render(<CLBadge state="on_track" confidence={95} />);
    expect(screen.getByText(/consistent/i)).toBeInTheDocument();
  });

  it('confidence 40 → "tentative"', () => {
    render(<CLBadge state="on_track" confidence={40} />);
    expect(screen.getByText(/tentative/i)).toBeInTheDocument();
  });

  it('confidence 69 → "tentative"', () => {
    render(<CLBadge state="on_track" confidence={69} />);
    expect(screen.getByText(/tentative/i)).toBeInTheDocument();
  });

  it('confidence 0 → "emerging"', () => {
    render(<CLBadge state="on_track" confidence={0} />);
    expect(screen.getByText(/emerging/i)).toBeInTheDocument();
  });

  it('confidence 39 → "emerging"', () => {
    render(<CLBadge state="on_track" confidence={39} />);
    expect(screen.getByText(/emerging/i)).toBeInTheDocument();
  });

  it('confidence null → no confidence text shown', () => {
    render(<CLBadge state="on_track" confidence={null} />);
    expect(screen.queryByText(/consistent|tentative|emerging/i)).not.toBeInTheDocument();
  });

  it('confidence undefined (omitted) → no confidence text shown', () => {
    render(<CLBadge state="on_track" />);
    expect(screen.queryByText(/consistent|tentative|emerging/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// CRITICAL: raw 0–100 number NEVER appears in DOM
// ---------------------------------------------------------------------------
describe('CLBadge — raw confidence number NEVER appears in DOM', () => {
  const scoreValues = [0, 39, 40, 69, 70, 95, 100];

  for (const score of scoreValues) {
    it(`score ${score} is not rendered as text`, () => {
      render(<CLBadge state="on_track" confidence={score} />);
      // Check exact string and as part of a longer string
      expect(screen.queryByText(String(score))).not.toBeInTheDocument();
      expect(screen.queryByText(new RegExp(`\\b${score}\\b`))).not.toBeInTheDocument();
    });
  }

  it('no numeric text appears when confidence is 55', () => {
    const { container } = render(<CLBadge state="needs_more_time" confidence={55} />);
    // No element should contain only digits
    const allText = container.textContent ?? '';
    expect(/\b\d{2,3}\b/.test(allText)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Semantic / a11y
// ---------------------------------------------------------------------------
describe('CLBadge — accessibility', () => {
  it('has role="status" for screen readers', () => {
    render(<CLBadge state="on_track" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('"Not yet assessed" state also has role="status"', () => {
    render(<CLBadge state="not_attempted" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
```

- [ ] 2. Run the test — confirm it **fails** (module not found):

```bash
npx vitest run src/components/core/__tests__/CLBadge.test.tsx --reporter=verbose
```

Expected: `Cannot find module '../CLBadge'`.

- [ ] 3. Write the minimal implementation `src/components/core/CLBadge.tsx`:

```typescript
// src/components/core/CLBadge.tsx
// Teacher-surface-only component. Renders the CL (comprehension-level) verb
// for a skill_learning_state, plus an optional soft-word confidence qualifier.
//
// RULES (spec §4 / SCOPE §16):
//   - null verb (insufficient_data / not_attempted) → "Not yet assessed"
//   - confidence shown ONLY as soft words (consistent / tentative / emerging)
//   - raw 0–100 confidence number NEVER rendered
//   - all colors via Tier-2 CSS tokens only (no hardcoded hex)
'use client';

import React from 'react';
import {
  CL_VERB_BY_STATE,
  type SkillLearningState,
} from '@/lib/skills/clVerbs';

export interface CLBadgeProps {
  state: SkillLearningState;
  confidence?: number | null;
}

type ConfidenceWord = 'consistent' | 'tentative' | 'emerging';

function confidenceWord(confidence: number): ConfidenceWord {
  if (confidence >= 70) return 'consistent';
  if (confidence >= 40) return 'tentative';
  return 'emerging';
}

const VERB_STYLES: Record<string, string> = {
  Reinforce: 'bg-[color:var(--warn)]  text-[color:var(--fg-on-brand)]',
  'On Track': 'bg-[color:var(--ok)]   text-[color:var(--fg-on-brand)]',
  Enrich:    'bg-[color:var(--brand)] text-[color:var(--fg-on-brand)]',
  'Not yet assessed': 'bg-[color:var(--surface)] text-[color:var(--fg-muted)] ring-1 ring-[color:var(--fg-muted)]',
};

export function CLBadge({ state, confidence }: CLBadgeProps) {
  const verb = CL_VERB_BY_STATE[state];
  const label = verb ?? 'Not yet assessed';
  const styleClass = VERB_STYLES[label] ?? VERB_STYLES['Not yet assessed'];

  const word: ConfidenceWord | null =
    verb !== null && typeof confidence === 'number' && confidence !== null
      ? confidenceWord(confidence)
      : null;

  return (
    <span
      role="status"
      aria-label={word ? `${label}, ${word}` : label}
      className={[
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius)]',
        'text-xs font-medium select-none',
        styleClass,
      ].join(' ')}
    >
      {label}
      {word && (
        <span className="opacity-80 font-normal">
          {word}
        </span>
      )}
    </span>
  );
}
```

- [ ] 4. Re-run — confirm **all pass**:

```bash
npx vitest run src/components/core/__tests__/CLBadge.test.tsx --reporter=verbose
```

Expected: `✓ CLBadge.test.tsx (28 tests)` (or the count matching the cases above).

- [ ] 5. Run the full suite to check no regressions:

```bash
npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: all previously-passing node-env tests still pass; Task 8 and Task 9 component tests pass.

- [ ] 6. Commit:

```bash
git -C C:/users/inteliflow/NEW-CORE add \
  src/components/core/CLBadge.tsx \
  src/components/core/__tests__/CLBadge.test.tsx
git -C C:/users/inteliflow/NEW-CORE commit -m "$(cat <<'EOF'
feat(p4a): Task 9 — CLBadge component

Adds CLBadge (teacher-only): maps skill_learning_state → CL verb via
CL_VERB_BY_STATE; insufficient_data/not_attempted → "Not yet assessed";
confidence rendered as soft words (consistent/tentative/emerging) only —
raw 0–100 number never appears in DOM. 28 jsdom tests green.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

Expected: `[feat/p4a-design-system ...] feat(p4a): Task 9 ...`.

### Task 10: MathText — KaTeX inline/block renderer with safe fallback

**Files:**
- `src/components/core/MathText.tsx` (create)
- `src/components/core/__tests__/MathText.test.tsx` (create)

**Interfaces:**
- Consumes: `katex` package (npm dep); `katex/dist/katex.min.css`
- Produces: `<MathText>{string}</MathText>` — renders inline `$…$` and block `$$…$$` math via `katex.renderToString`; on a KaTeX parse error degrades to raw segment text (never blank, never throws); exported from `src/components/core/MathText.tsx`

---

- [ ] **Step 1 — Confirm / add katex deps.** Run:

```bash
npm ls katex 2>/dev/null | grep katex || npm install katex @types/katex
```

Expected output (if already installed by the FOUND slice): a version line. If not installed, npm installs and prints the resolved version.

- [ ] **Step 2 — Confirm test infra deps are present.** Run:

```bash
npm ls @testing-library/react jsdom @testing-library/jest-dom 2>/dev/null | grep -E "@testing-library|jsdom"
```

If any are missing, install them (FOUND slice should have done this; if not):

```bash
npm install --save-dev @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 3 — Write the failing test.** Create `src/components/core/__tests__/MathText.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MathText } from '../MathText';

afterEach(() => {
  cleanup();
});

describe('MathText', () => {
  it('renders surrounding plain text', () => {
    render(<MathText>Hello world</MathText>);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders an inline $x^2$ segment as KaTeX markup (contains .katex)', () => {
    const { container } = render(<MathText>{'Solve $x^2$'}</MathText>);
    // KaTeX sets class="katex" on its output span
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  it('renders block $$x^2$$ as KaTeX markup', () => {
    const { container } = render(<MathText>{'$$x^2$$'}</MathText>);
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  it('degrades to raw text on a malformed inline segment, never throws', () => {
    // \frac{ without closing brace is a KaTeX parse error
    expect(() => render(<MathText>{'$\\frac{$'}</MathText>)).not.toThrow();
  });

  it('shows raw segment text (not blank) when KaTeX parse fails', () => {
    const { container } = render(<MathText>{'prefix $\\frac{$ suffix'}</MathText>);
    // The raw fallback text must appear somewhere in the output
    expect(container.textContent).toContain('\\frac{');
    // The surrounding text must also appear
    expect(container.textContent).toContain('prefix');
    expect(container.textContent).toContain('suffix');
  });

  it('renders a mix of plain text, inline math, and block math', () => {
    const { container } = render(
      <MathText>{'Area is $A = \\pi r^2$ and $$V = \\frac{4}{3}\\pi r^3$$ done'}</MathText>
    );
    // At least one .katex element from the valid segments
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toContain('done');
  });
});
```

- [ ] **Step 4 — Run test, confirm it fails (component does not exist yet):**

```bash
npx vitest run src/components/core/__tests__/MathText.test.tsx
```

Expected: `Cannot find module '../MathText'` error — confirms the test is wired.

- [ ] **Step 5 — Create `src/components/core/MathText.tsx`:**

```tsx
'use client';

/**
 * MathText — renders inline $…$ and block $$…$$ math via KaTeX.
 * On a KaTeX parse error the raw segment is shown as-is (never blank, never throws).
 * Colors come from inherited CSS; no hardcoded hex.
 *
 * Import katex CSS once in the nearest layout or in globals.css:
 *   @import "katex/dist/katex.min.css";
 */

import katex from 'katex';
import 'katex/dist/katex.min.css';

interface MathTextProps {
  children: string;
}

type Segment =
  | { type: 'text'; value: string }
  | { type: 'math-block'; value: string }
  | { type: 'math-inline'; value: string };

/** Split a string into plain-text and math segments. Block ($$) is tested first. */
function parseSegments(input: string): Segment[] {
  const segments: Segment[] = [];
  // Regex: block $$…$$ first, then inline $…$
  const pattern = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(input)) !== null) {
    const [full] = match;
    const start = match.index;

    if (start > lastIndex) {
      segments.push({ type: 'text', value: input.slice(lastIndex, start) });
    }

    if (full.startsWith('$$')) {
      segments.push({ type: 'math-block', value: full.slice(2, -2) });
    } else {
      segments.push({ type: 'math-inline', value: full.slice(1, -1) });
    }

    lastIndex = start + full.length;
  }

  if (lastIndex < input.length) {
    segments.push({ type: 'text', value: input.slice(lastIndex) });
  }

  return segments;
}

function renderMathSegment(
  tex: string,
  displayMode: boolean,
  rawFallback: string,
  key: number
): React.ReactNode {
  try {
    const html = katex.renderToString(tex, {
      displayMode,
      throwOnError: true,
      strict: false,
    });
    return (
      <span
        key={key}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  } catch {
    // Safe fallback: show the original delimited text so the reader knows math was intended
    return <span key={key}>{rawFallback}</span>;
  }
}

export function MathText({ children }: MathTextProps) {
  const segments = parseSegments(children);

  return (
    <span>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return <span key={i}>{seg.value}</span>;
        }
        const displayMode = seg.type === 'math-block';
        const delimiter = displayMode ? '$$' : '$';
        const rawFallback = `${delimiter}${seg.value}${delimiter}`;
        return renderMathSegment(seg.value, displayMode, rawFallback, i);
      })}
    </span>
  );
}

export default MathText;
```

- [ ] **Step 6 — Confirm vitest picks up `.test.tsx` files.** Check `vitest.config.ts` include pattern. If it only has `*.test.ts`, add `*.test.tsx`:

Open `vitest.config.ts` and verify the `include` array contains both patterns. If it only reads:
```ts
include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'supabase/**/*.test.ts'],
```
Edit it to:
```ts
include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts', 'supabase/**/*.test.ts'],
```

- [ ] **Step 7 — Run tests, confirm they pass:**

```bash
npx vitest run src/components/core/__tests__/MathText.test.tsx
```

Expected:
```
 PASS  src/components/core/__tests__/MathText.test.tsx
  MathText
    ✓ renders surrounding plain text
    ✓ renders an inline $x^2$ segment as KaTeX markup (contains .katex)
    ✓ renders block $$x^2$$ as KaTeX markup
    ✓ degrades to raw text on a malformed inline segment, never throws
    ✓ shows raw segment text (not blank) when KaTeX parse fails
    ✓ renders a mix of plain text, inline math, and block math

 Tests  6 passed (6)
```

- [ ] **Step 8 — Verify the 663 backend tests are still green:**

```bash
npx vitest run src/lib src/app/api
```

Expected: all prior tests pass (no regressions from adding `.test.tsx` to the include list).

- [ ] **Step 9 — Commit:**

```bash
git add src/components/core/MathText.tsx src/components/core/__tests__/MathText.test.tsx vitest.config.ts package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat(design-system): add MathText KaTeX renderer with safe parse-error fallback (T10)

Renders inline $…$ and block $$…$$ math via katex.renderToString; degrades to raw
delimited text on any KaTeX parse error so a malformed expression never blanks a
quiz item. Adds katex + @types/katex deps. Extends vitest include to .test.tsx.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Card, StatCard, and EmptyState — surface + cold-start components

**Files:**
- `src/components/core/Card.tsx` (create)
- `src/components/core/EmptyState.tsx` (create)
- `src/components/core/__tests__/Card.test.tsx` (create)
- `src/components/core/__tests__/EmptyState.test.tsx` (create)

**Interfaces:**
- Consumes: Tier-2 CSS tokens `--surface`, `--radius`, `--radius-lg`, `--shadow`, `--shadow-pop`, `--fg`, `--fg-muted`, `--brand` (set by RoleLayout via globals.css; built in T1–T2 of the TOKENS slice)
- Produces:
  - `<Card className?={string}>{children}</Card>` — surface card; loud intensity (`data-intensity="loud"` on an ancestor) gets `--radius-lg` + `--shadow-pop` via CSS; exported from `src/components/core/Card.tsx`
  - `<StatCard label={string} value={React.ReactNode} className?={string} />` — labeled stat surface; exported from same file
  - `<EmptyState variant={'not-yet-assessed'|'just-getting-started'|'on-track'} />` — dignified cold-start states; exported from `src/components/core/EmptyState.tsx`

---

- [ ] **Step 1 — Write the failing Card test.** Create `src/components/core/__tests__/Card.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Card, StatCard } from '../Card';

afterEach(() => {
  cleanup();
});

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Hello card</Card>);
    expect(screen.getByText('Hello card')).toBeInTheDocument();
  });

  it('has the core-card class for CSS token targeting', () => {
    const { container } = render(<Card>content</Card>);
    expect(container.firstChild).toHaveClass('core-card');
  });

  it('accepts an additional className', () => {
    const { container } = render(<Card className="extra-class">x</Card>);
    expect(container.firstChild).toHaveClass('extra-class');
  });

  it('renders as a <div> by default', () => {
    const { container } = render(<Card>x</Card>);
    expect(container.firstChild?.nodeName).toBe('DIV');
  });
});

describe('StatCard', () => {
  it('renders the label', () => {
    render(<StatCard label="Score" value="94" />);
    expect(screen.getByText('Score')).toBeInTheDocument();
  });

  it('renders the value', () => {
    render(<StatCard label="Score" value="94" />);
    expect(screen.getByText('94')).toBeInTheDocument();
  });

  it('accepts a ReactNode value', () => {
    render(<StatCard label="Status" value={<span data-testid="val-node">On Track</span>} />);
    expect(screen.getByTestId('val-node')).toBeInTheDocument();
  });

  it('has the core-card class', () => {
    const { container } = render(<StatCard label="L" value="V" />);
    expect(container.firstChild).toHaveClass('core-card');
  });
});
```

- [ ] **Step 2 — Write the failing EmptyState test.** Create `src/components/core/__tests__/EmptyState.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { EmptyState } from '../EmptyState';

afterEach(() => {
  cleanup();
});

describe('EmptyState', () => {
  it('not-yet-assessed: renders the "Not yet assessed" heading', () => {
    render(<EmptyState variant="not-yet-assessed" />);
    expect(screen.getByText('Not yet assessed')).toBeInTheDocument();
  });

  it('not-yet-assessed: renders descriptive body copy', () => {
    render(<EmptyState variant="not-yet-assessed" />);
    expect(
      screen.getByText(/data will appear once/i)
    ).toBeInTheDocument();
  });

  it('just-getting-started: renders "Just getting started" heading', () => {
    render(<EmptyState variant="just-getting-started" />);
    expect(screen.getByText('Just getting started')).toBeInTheDocument();
  });

  it('just-getting-started: renders descriptive body copy', () => {
    render(<EmptyState variant="just-getting-started" />);
    expect(
      screen.getByText(/more practice/i)
    ).toBeInTheDocument();
  });

  it('on-track: renders "You\'re on track" heading', () => {
    render(<EmptyState variant="on-track" />);
    expect(screen.getByText(/on track/i)).toBeInTheDocument();
  });

  it('on-track: renders encouraging body copy', () => {
    render(<EmptyState variant="on-track" />);
    expect(screen.getByText(/keep going/i)).toBeInTheDocument();
  });

  it('renders the correct role attribute for token targeting', () => {
    const { container } = render(<EmptyState variant="not-yet-assessed" />);
    expect(container.firstChild).toHaveClass('core-empty-state');
  });
});
```

- [ ] **Step 3 — Run tests, confirm they fail:**

```bash
npx vitest run src/components/core/__tests__/Card.test.tsx src/components/core/__tests__/EmptyState.test.tsx
```

Expected: `Cannot find module '../Card'` and `Cannot find module '../EmptyState'` — confirms tests are wired.

- [ ] **Step 4 — Create `src/components/core/Card.tsx`:**

```tsx
/**
 * Card / StatCard — shared surface components.
 *
 * Styling is entirely token-driven via CSS classes defined in globals.css.
 * No hardcoded hex. Intensity (loud/calm) is inherited from the nearest
 * ancestor with data-intensity="loud"|"calm" set by RoleLayout.
 *
 * CSS contract (defined in globals.css):
 *   .core-card {
 *     background: var(--surface);
 *     border-radius: var(--radius);
 *     box-shadow: var(--shadow);
 *     padding: 1.25rem;
 *   }
 *   [data-intensity="loud"] .core-card {
 *     border-radius: var(--radius-lg);
 *     box-shadow: var(--shadow-pop);
 *   }
 *   .core-stat-label {
 *     color: var(--fg-muted);
 *     font-size: 0.75rem;
 *     font-weight: 500;
 *     letter-spacing: 0.05em;
 *     text-transform: uppercase;
 *   }
 *   .core-stat-value {
 *     color: var(--fg);
 *     font-size: 1.5rem;
 *     font-weight: 700;
 *     line-height: 1.2;
 *   }
 */

import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return (
    <div className={['core-card', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: ReactNode;
  className?: string;
}

export function StatCard({ label, value, className }: StatCardProps) {
  return (
    <div className={['core-card', className].filter(Boolean).join(' ')}>
      <p className="core-stat-label">{label}</p>
      <div className="core-stat-value">{value}</div>
    </div>
  );
}

export default Card;
```

- [ ] **Step 5 — Create `src/components/core/EmptyState.tsx`:**

```tsx
/**
 * EmptyState — first-class cold-start / empty states.
 *
 * Three variants for the three dignified states:
 *   'not-yet-assessed'   — cold start: no data yet
 *   'just-getting-started' — insufficient history for a trend (< 4 points)
 *   'on-track'           — things are fine; no action required
 *
 * Copy rules (SCOPE §15 / global constraints):
 *   - Observational, never diagnostic
 *   - Never fabricate a trend or score
 *   - Growth framed as "you vs your own past," never peer-relative
 *   - Struggle framed as "still building," never "struggle"
 *
 * Styling is token-driven via CSS class core-empty-state (globals.css).
 * No hardcoded hex.
 *
 * CSS contract (defined in globals.css):
 *   .core-empty-state {
 *     background: var(--surface);
 *     border-radius: var(--radius);
 *     padding: 2rem 1.5rem;
 *     text-align: center;
 *   }
 *   .core-empty-state-icon {
 *     color: var(--fg-muted);
 *     font-size: 2rem;
 *     margin-bottom: 0.75rem;
 *   }
 *   .core-empty-state-heading {
 *     color: var(--fg);
 *     font-family: var(--font-display);
 *     font-size: 1.125rem;
 *     font-weight: 600;
 *     margin-bottom: 0.5rem;
 *   }
 *   .core-empty-state-body {
 *     color: var(--fg-muted);
 *     font-size: 0.9375rem;
 *     line-height: 1.5;
 *     max-width: 28ch;
 *     margin: 0 auto;
 *   }
 */

export type EmptyStateVariant =
  | 'not-yet-assessed'
  | 'just-getting-started'
  | 'on-track';

const COPY: Record<EmptyStateVariant, { heading: string; body: string; icon: string }> = {
  'not-yet-assessed': {
    icon: '○',
    heading: 'Not yet assessed',
    body: 'Data will appear once practice is complete.',
  },
  'just-getting-started': {
    icon: '◇',
    heading: 'Just getting started',
    body: 'Keep going — more practice builds a clearer picture.',
  },
  'on-track': {
    icon: '◆',
    heading: "You're on track",
    body: 'Things look good here. Keep going.',
  },
};

interface EmptyStateProps {
  variant: EmptyStateVariant;
  className?: string;
}

export function EmptyState({ variant, className }: EmptyStateProps) {
  const { icon, heading, body } = COPY[variant];

  return (
    <div className={['core-empty-state', className].filter(Boolean).join(' ')}>
      <div className="core-empty-state-icon" aria-hidden="true">
        {icon}
      </div>
      <h3 className="core-empty-state-heading">{heading}</h3>
      <p className="core-empty-state-body">{body}</p>
    </div>
  );
}

export default EmptyState;
```

- [ ] **Step 6 — Run tests, confirm they pass:**

```bash
npx vitest run src/components/core/__tests__/Card.test.tsx src/components/core/__tests__/EmptyState.test.tsx
```

Expected:
```
 PASS  src/components/core/__tests__/Card.test.tsx
  Card
    ✓ renders children
    ✓ has the core-card class for CSS token targeting
    ✓ accepts an additional className
    ✓ renders as a <div> by default
  StatCard
    ✓ renders the label
    ✓ renders the value
    ✓ accepts a ReactNode value
    ✓ has the core-card class

 PASS  src/components/core/__tests__/EmptyState.test.tsx
  EmptyState
    ✓ not-yet-assessed: renders the "Not yet assessed" heading
    ✓ not-yet-assessed: renders descriptive body copy
    ✓ just-getting-started: renders "Just getting started" heading
    ✓ just-getting-started: renders encouraging body copy
    ✓ on-track: renders "You're on track" heading
    ✓ on-track: renders encouraging body copy
    ✓ renders the correct role attribute for token targeting

 Tests  15 passed (15)
```

- [ ] **Step 7 — Run the full backend suite to confirm no regressions:**

```bash
npx vitest run src/lib src/app/api
```

Expected: all prior tests pass.

- [ ] **Step 8 — Commit:**

```bash
git add src/components/core/Card.tsx src/components/core/EmptyState.tsx src/components/core/__tests__/Card.test.tsx src/components/core/__tests__/EmptyState.test.tsx
git commit -m "$(cat <<'EOF'
feat(design-system): add Card, StatCard, and EmptyState components (T11)

Card/StatCard use CSS token classes (core-card) so loud intensity (data-intensity=loud
on an ancestor) switches to --radius-lg + --shadow-pop without prop-drilling. EmptyState
provides three first-class dignified cold-start states with copy that never fabricates
trends or uses diagnostic language.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```


---

### Task 12: Full-suite green + contrast gate + build verification (design-system foundation deployable)

**Files:** none new — verification gate.

**Interfaces:** Consumes T1–T11.

- [ ] **Step 1: Full test suite (backend stays green + new component tests)**

Run: `npm test`
Expected: the 663 existing backend tests PLUS all new component/util tests (globals-tokens, layout, RoleLayout, GrowthMotif, topicFrame, MasteryLabel, riskBandLabel, RiskBadge, CLBadge, MathText, Card, EmptyState, contrast-check) pass — exit 0. The backend tests still run under the `node` env; component `*.test.tsx` run under jsdom via the per-file pragma.

- [ ] **Step 2: Contrast gate**

Run: `npm run a11y`
Expected: every Tier-2 fg/bg pair across all 5 roles × both intensities clears WCAG AA (≥4.5:1 body, ≥3:1 large/UI); exit 0. (If a pair fails, the locked hex in `globals.css` + the `contrast-check.ts` token table must be adjusted together — they are the same values.)

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit` (exits 0) then `npm run build` (`✓ Compiled successfully`). NO new top-level `app/` route folder was added (4a adds NO routes/screens — components + tokens only; the route-group layouts are 4b–4e).

- [ ] **Step 4: Foundation checklist (manual, no code)**
  - Tokens: 3-tier, hex only in `:root`; `@theme` exposes the Tier-2 utilities; `[data-role][data-intensity]` binds all 5 roles. ✓
  - Fonts: Bricolage (display) + Inter (body) via next/font. ✓
  - Component kit: RoleLayout, GrowthMotif, MasteryLabel, CLBadge (teacher-only, soft-word confidence, null→"Not yet assessed"), RiskBadge (banded, never a number), MathText (KaTeX + degrade), Card/StatCard, EmptyState. ✓
  - Copy registers: never-Band (MasteryLabel), "still building" (topicFrame), banded risk. ✓
  - Readability CI gate green. ✓
  - OUT (correctly absent): role screens, Super TELI, onboarding, in-quiz telemetry, parent narrative — 4b+. ✓

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "P4a Task 12: full-suite green + contrast gate + build verification (design-system foundation)"
```

---

## ⚠️ Review Corrections (apply per cited task — from controller assembly self-review)

> The slices were authored in parallel; these resolve cross-slice collisions (each slice independently tried to set up the jsdom test infra and edit shared files). **Apply each before executing its task; it GOVERNS over the task body.**

- **P4a-C1 — ONE owner for the jsdom test infra: Task 3.** Multiple slices (T5, T6, T8, T10) duplicated the test-infra setup with THREE different setup-file paths (`src/test/setup-dom.ts`, `vitest.setup.dom.ts`, `src/test-setup.dom.ts`) and several `vitest.config.ts`/`package.json` edits. **Task 3 is the SOLE owner of:** (a) the devDeps `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` + `katex` + `@types/katex`; (b) the ONE canonical DOM setup file at **`src/test/setup-dom.ts`** (imports `@testing-library/jest-dom/vitest` + registers `afterEach(cleanup)`); (c) the SINGLE `vitest.config.ts` edit extending `include` to `['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,tsx}', 'supabase/**/*.test.ts']` (the current value is `*.test.ts` only — confirmed). **DELETE the duplicate infra steps in T5, T6, T8, T10** (no `vitest.setup.dom.ts`, no `src/test-setup.dom.ts`, no second dep-install, no second config edit) — they ASSUME Task 3 did it.
- **P4a-C2 — jsdom mechanism + canonical import path.** Every component test (`*.test.tsx`) begins with `// @vitest-environment jsdom` AND `import '@/test/setup-dom';` (the alias path). Fix SIG's relative `'../../../test-setup.dom'` / `'../.././../test-setup.dom'` imports to `@/test/setup-dom`. Do NOT use `environmentMatchGlobs` (deprecated/at-risk in Vitest 4.1.9) — the per-file pragma is the mechanism; the global env stays `node` so the 663 backend tests are unaffected. (If, on the real Vitest 4.1.9, the per-file pragma + `node` global needs the `jsdom` package merely installed, that's covered by C1.)
- **P4a-C3 — ONLY Task 1 edits `globals.css`; components style via `@theme` utilities (no custom `core-*` classes).** MATHCARDS T11 (Card/StatCard/EmptyState) and any other component MUST style via Tailwind utilities bound to the `@theme` tokens — `bg-surface`, `bg-bg`, `text-fg`, `text-fg-muted`, `bg-brand`, `text-fg-on-brand`, `rounded`, `rounded-lg`, `shadow`, `shadow-pop` — NOT custom `core-card`/`core-stat-*`/`core-empty-state` classes defined in `globals.css`. Rework T11 to utilities. Loud/calm differences come for free: the `[data-role][data-intensity]` selectors override the Tier-2 vars the utilities map to (so the same `rounded`/`shadow` is chunky/pop on loud, subtle on calm). Task 1 remains the sole `globals.css` editor.
- **P4a-C4 — Notes (not defects), carry into the build:**
  - Font-var indirection (FOUND): `next/font/google` outputs `--font-bricolage`/`--font-inter`; `@theme` maps `--font-display→var(--font-bricolage)` and `--font-sans→var(--font-inter)`. Correct — keep it.
  - `@theme` maps radius as `--radius-DEFAULT` (Tailwind v4) → downstream uses the `rounded` utility, not `rounded-radius`.
  - `contrast-check.ts` hardcodes the Tier-1 hex in a token table that MUST stay in sync with `globals.css` if hues are tuned in 4b–4e — a comment in the file flags this; keep it accurate.
  - `--surface: #ffffff` is the sole hex literal outside a named ramp in `:root` (no pure-white ramp entry) — the globals-tokens test strips `:root` when checking "no hex outside `:root`," so this is fine.

### Corrections → Task dispatch index
| Task | Binding corrections |
|------|---------------------|
| T1 globals.css tokens | C3 (sole globals.css owner; component classes NOT here), C4 |
| T2 fonts | C4 (font-var indirection) |
| T3 test infra | C1 (sole owner: deps + `src/test/setup-dom.ts` + the one include-glob edit), C2 |
| T4 contrast gate | C4 (token-table sync) |
| T5 RoleLayout | C1 (no infra steps — assume T3), C2 (test imports `@/test/setup-dom`) |
| T6 GrowthMotif | C1 (no infra), C2 (fix relative import) |
| T7 MasteryLabel/topicFrame | C2 |
| T8 RiskBadge/riskBandLabel | C1 (no dep install), C2 |
| T9 CLBadge | C2 |
| T10 MathText | C1 (no infra/config edit — katex dep is T3's), C2 |
| T11 Card/StatCard/EmptyState | C3 (Tailwind utilities, no custom globals.css classes), C2 |
| T12 verify | confirm C1/C2/C3 landed (one setup file, one config edit, no custom core-* classes) |

---

## Execution Handoff

subagent-driven-development on `feat/p4a-design-system`, after a Codex adversarial review of this plan. Dispatch each task with its binding corrections per the index. Execution order: T1 → T3 → T2 → T4 → T5 → T6/T7 → T8/T9 → T10/T11 → T12.
