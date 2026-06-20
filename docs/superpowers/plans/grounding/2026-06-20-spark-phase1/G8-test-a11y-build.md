# G8 — Test conventions + a11y gate + build config (VERBATIM grounding)

Branch: `feat/teacher-app-shell`. All facts quoted verbatim with `file:line` refs. READ-ONLY; no source edits.

---

## 1. Representative node-env API-route test (mocks supabase admin client, builds Request/POST, asserts status + body)

File: `src/app/api/teacher/assignments/generate/__tests__/route.test.ts`

This is the canonical `makeChain` + `makeAdminMock` idiom (route comment says it "follows submit/__tests__/route.test.ts"). vitest default env is `node` — **no jsdom header on API tests**.

### Imports + Request construction (lines 11–22)
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

function makeRequest(body: Record<string, unknown> = { quiz_attempt_id: 'attempt-1' }): NextRequest {
  return new NextRequest('http://localhost/api/teacher/assignments/generate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}
```

### Supabase chain builder (lines 85–95) — thenable chain
```ts
function makeChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain['select'] = vi.fn().mockReturnValue(chain);
  chain['eq'] = vi.fn().mockReturnValue(chain);
  chain['insert'] = vi.fn().mockReturnValue(chain);
  chain['update'] = vi.fn().mockReturnValue(chain);
  chain['single'] = vi.fn().mockResolvedValue({ data, error });
  chain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(resolve);
  return chain;
}
```

### Admin client mock — `from(table)` router (lines 102–135, abbreviated to shape)
```ts
function makeAdminMock(opts: { /* attempt?, attemptError?, responses?, ... */ } = {}) {
  const attemptChain = makeChain(attempt, attemptError);
  const responsesChain = makeChain(responses, responsesError);
  const insertChain = makeChain(insertedRow, insertError);
  return {
    from: vi.fn((table: string) => {
      if (table === 'quiz_attempts') return attemptChain;
      if (table === 'quiz_responses') return responsesChain;
      if (table === 'assignments') {
        const chain = { ...insertChain };
        chain['insert'] = vi.fn().mockReturnValue(insertChain);
        return chain;
      }
      return makeChain(null);
    }),
  };
}
```

### Module mocks for the auth chain (lines 139–160)
```ts
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

const mockGuardStudentAccess = vi.fn();
vi.mock('@/lib/auth/guards', () => ({
  guardStudentAccess: (...a: unknown[]) => mockGuardStudentAccess(...a),
}));
```

### beforeEach reset (lines 165–170)
```ts
beforeEach(() => {
  mockGuardStudentAccess.mockReset();
  mockGenerateAssignment.mockReset();
  mockInferLearningStyle.mockReset();
  vi.resetModules();
});
```

### Wiring the mocks + asserting status (auth 401 case, lines 173–183) — note dynamic `await import` of route AFTER mocks are set
```ts
it('returns 401 when user is not authenticated', async () => {
  const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
  vi.mocked(createServerSupabaseClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
  } as never);
  vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock() as never);

  const { POST } = await import('@/app/api/teacher/assignments/generate/route');
  const res = await POST(makeRequest());
  expect(res.status).toBe(401);
});
```

### Asserting status + parsed JSON body (C20 case, lines 228–236)
```ts
const res = await POST(makeRequest());
expect([409, 422]).toContain(res.status);
expect(mockGenerateAssignment).not.toHaveBeenCalled();
const body = await res.json();
expect(body.error).toBeDefined();
```

### Guard-rejection idiom — returning a NextResponse from the guard mock (lines 205–212)
```ts
const { NextResponse } = await import('next/server');
mockGuardStudentAccess.mockResolvedValue(
  NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
);
const { POST } = await import('@/app/api/teacher/assignments/generate/route');
const res = await POST(makeRequest());
expect(res.status).toBe(403);
```

> Note: this representative test mocks the admin client via the route's own `createAdminSupabaseClient` import and **the auth getUser via `createServerSupabaseClient().auth.getUser`**. The constant-time Bearer-secret webhook auth pattern that Phase-1 SPARK ingestion needs is NOT exercised by any test quoted here — see DISCREPANCY.

---

## 2. Representative jsdom component test (header + body)

File: `src/components/core/__tests__/RiskBadge.test.tsx`

### Header + imports (lines 1–6) — EXACT order the CLAUDE.md rule mandates
```tsx
// @vitest-environment jsdom
// src/components/core/__tests__/RiskBadge.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/test/setup-dom';
import { RiskBadge } from '../RiskBadge';
```

### Render + assert (lines 8–12, 89–96)
```tsx
it('renders "low" for score 10 (0to100)', () => {
  render(<RiskBadge score={10} />);
  expect(screen.getByText('low')).toBeInTheDocument();
});

it('low band uses bg-ok-surface and text-ok-fg (not saturated bg-ok)', () => {
  const { container } = render(<RiskBadge score={10} />);
  const badge = container.firstChild as HTMLElement;
  expect(badge.className).toContain('bg-ok-surface');
  expect(badge.className).toContain('text-ok-fg');
  expect(badge.className).not.toContain('text-fg-on-brand');
});
```

### The shared DOM setup file `src/test/setup-dom.ts` (verbatim, full)
```ts
// Import this file in every component test that uses @vitest-environment jsdom.
// It registers jest-dom matchers (toBeInTheDocument etc.) and cleans up the DOM after each test.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
```

---

## 3. `package.json` scripts block (verbatim, lines 5–18)

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
  "a11y": "npx tsx scripts/a11y/contrast-check.ts",
  "seed:demo": "node --env-file=.env.local --import tsx scripts/seedDemo.ts",
  "seed:demo:reset": "node --env-file=.env.local --import tsx scripts/resetDemo.ts"
}
```

- `prebuild` runs `a11y` (the contrast gate) before every `build`.
- No standalone `typecheck` script (CLAUDE.md: use `npm run build` or `npx tsc --noEmit`).

---

## 4. a11y contrast gate — token-pair definitions + pair-count assertion

File: `scripts/a11y/contrast-check.ts`

### `PAIRS` array (role/intensity-scoped pairs, lines 322–338) — currently **9 pairs**
```ts
const PAIRS: PairDef[] = [
  ['fg/bg',             'fg',        'bg',      4.5],
  ['fg/surface',        'fg',        'surface', 4.5],
  ['fg-muted/bg',       'fgMuted',   'bg',      4.5],
  ['fg-on-brand/brand', 'fgOnBrand', 'brand',   3.0],
  ['brand/surface',     'brand',     'surface', 3.0],
  ['ok-fg/ok-surface',     'okFg',        'okSurface',   4.5],
  ['warn-fg/warn-surface', 'warnFg',      'warnSurface', 4.5],
  ['risk-fg/risk-surface', 'riskFg',      'riskSurface', 4.5],
  ['brand-fg/brand-surface', 'brandFg', 'brandSurface', 4.5],
];
```
`PairDef` type (line 320): `type PairDef = [string, keyof Palette, keyof Palette, number];`
These run across **5 discovered roles** (student/teacher/parent/admin + one more inheriting role; test names confirm student, teacher, parent, admin). 5 roles × 9 pairs = 45.

### `SIDEBAR_PAIRS` array (`:root`-scoped, lines 342–347) — currently **4 pairs**
```ts
const SIDEBAR_PAIRS: Array<[string, string, string, number]> = [
  ['sidebar-fg/sidebar',               '--sidebar-fg',        '--sidebar',        4.5],
  ['sidebar-fg-muted/sidebar',         '--sidebar-fg-muted',  '--sidebar',        4.5],
  ['sidebar-active-fg/sidebar-active', '--sidebar-active-fg', '--sidebar-active', 4.5],
  ['signout/sidebar-danger',           '--white',             '--sidebar-danger', 4.5],
];
```

### The guarded sidebar loop in `checkAllPairs` (lines 498–505) — only runs when `--sidebar` exists in `:root`
```ts
if (parsed.rootProps.has('--sidebar')) {
  for (const [pairLabel, fgProp, bgProp, required] of SIDEBAR_PAIRS) {
    const fg = resolveToHex(`var(${fgProp})`, parsed.rootProps, `sidebar slot="${fgProp}"`);
    const bg = resolveToHex(`var(${bgProp})`, parsed.rootProps, `sidebar slot="${bgProp}"`);
    const ratio = contrastRatio(fg, bg);
    results.push({ role: 'sidebar', intensity: 'base', pair: pairLabel, fg, bg, ratio, required, passes: ratio >= required });
  }
}
```

### Adding a SPARK-orange pair
- If S2/S3 uses orange on a **role/intensity-scoped** text pair, add a `Palette` slot (extend the `Palette` interface lines 300–315, `SlotAssignment` lines 81–96, and `SLOT_CSS_PROP` lines 109–124) and append to `PAIRS`. Each new `PAIRS` entry multiplies by 5 roles → +5 to the total.
- If it is a single `:root`-level pair (like the sidebar tokens), append one entry to `SIDEBAR_PAIRS` → +1 to the total, and ensure the gating token (`--sidebar` today) is present, or add a parallel guarded block.

### CLI exit behaviour (lines 538–544): exits 1 on any failure, 0 if all pass.

---

## a11y gate test — pair-count assertion (the number a new pair must bump)

File: `scripts/a11y/__tests__/contrast-check.test.ts`

### The exact total-count assertion (lines 184–188) — **CURRENT TOTAL = 49**
```ts
it('total pair count is 49 (5 roles × 9 pairs + 4 sidebar pairs)', () => {
  const results = checkAllPairs();
  // 5 roles × 9 pairs = 45, plus 4 sidebar/base pairs = 49 total
  expect(results.length).toBe(49);
});
```

> **To add a SPARK-orange pair you MUST update this assertion** (and its comment):
> - new role/intensity-scoped pair → `49` becomes **`54`** (45→50 + 4) and `9 pairs` becomes `10`.
> - new single `:root`/sidebar-style pair → `49` becomes **`50`** and `4 sidebar pairs` becomes `5`.

Other count-sensitive assertions in the same file the planner may need to touch:
- line 193: `expect(brandPairs.length, ...).toBe(5);` (asserts 5 roles for `brand-fg/brand-surface`).
- lines 171–182: loops over `['ok-fg/ok-surface','warn-fg/warn-surface','risk-fg/risk-surface']` and asserts `.length > 0` + `ratio >= 4.5`.
- The regression anchor (lines 142–152) asserts **0 failures** against the real `globals.css` — a new orange pair must actually pass its threshold or this fails.

---

## 5. vitest config + `@/*` alias

### `vitest.config.ts` (verbatim, full)
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
- Default env `node`; alias is resolved by `vite-tsconfig-paths` (reads tsconfig `paths`), NOT a manual `resolve.alias`.

### `vitest.setup.ts` (verbatim, full) — global env-var seeding for ALL tests
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
> **`CORE_SPARK_API_SECRET` and `SPARK_API_URL` are NOT seeded here.** Any test that imports a module reading `process.env.SPARK_API_URL`/`CORE_SPARK_API_SECRET` at module-eval time must seed it (here or in the test) or it will be `undefined`.

### `@/*` alias — `tsconfig.json` (lines 21–23)
```json
"paths": {
  "@/*": ["./src/*"]
}
```

---

## FLAG — how config-module env validation is tested

**There is NO `src/lib/config.ts` module.** Glob `src/lib/config.ts` → "No files found". The closest thing to a "config module" pattern is `src/lib/ai/models.ts`, which reads env at module top-level with `||` defaults (verbatim lines 17–39):
```ts
export const CLAUDE_GRADING_MODEL = process.env.ANTHROPIC_GRADING_MODEL || 'claude-sonnet-4-6';
export const CLAUDE_GEN_MODEL     = process.env.ANTHROPIC_GEN_MODEL || 'claude-sonnet-4-6';
export const OPENAI_GEN_MODEL     = process.env.OPENAI_GEN_MODEL || 'gpt-4o';
export const OPENAI_VOICE_MODEL   = process.env.OPENAI_VOICE_MODEL || 'gpt-4o';
```

The ONLY env-validation test is `src/lib/__tests__/config.test.ts`, and it validates **the `.env.example` FILE** (key presence + no placeholder values), NOT a runtime config object:

- Required-keys check (lines 16–66): asserts `.env.example` `content` `.toContain(key)` for a hardcoded `requiredKeys[]` list. **`CORE_SPARK_API_SECRET` is already in that list (line 34, under `// Spark`).** `SPARK_API_URL` is **NOT** in the list.
- No-placeholder check (lines 68–84): every non-comment line must be `KEY=` with empty value (`expect(value).toBe('')`).
- Also validates `vercel.json` exists / valid JSON / has `crons` array / required cron paths (lines 87–139).

`.env.example` (verbatim lines 22–23):
```
# Spark contract (HS256 JWT signing + Spark->CORE return Bearer)
CORE_SPARK_API_SECRET=
```
→ `.env.example` currently has `CORE_SPARK_API_SECRET=` but **no `SPARK_API_URL=` line.**

### Pattern for a `SPARK_API_URL` config test to match
The spec (`docs/superpowers/specs/2026-06-20-spark-integration-phase1-design.md:57`) says `SPARK_API_URL` "is validated like `CORE_SPARK_API_SECRET`". Given the actual code: "validated like" today means **adding `'SPARK_API_URL'` to the `requiredKeys` array in `config.test.ts` (line ~34) AND adding a `SPARK_API_URL=` line to `.env.example`.** If a real runtime config module/getter is introduced (e.g. `getSparkApiUrl()` with a `https://spark.inteliflowai.com` default), there is **no existing precedent test** for it — the nearest live pattern is the bare `process.env.X || 'default'` export in `models.ts` (untested for default-fallback behaviour beyond model-routing tests).

---

## DISCREPANCY / RISK flags
1. **No `src/lib/config.ts` exists.** The Phase-1 spec repeatedly references "the config module" for `SPARK_API_URL`. The planner must decide: create a new config module (no precedent test pattern) OR follow the `models.ts` top-level-`process.env` idiom. Env validation today = `.env.example` file-content assertion only.
2. **a11y total-count = 49** and is a hard `expect(results.length).toBe(49)` assertion. Any new SPARK-orange token pair breaks this test until the number is bumped (54 for a scoped pair, 50 for a `:root`/sidebar pair) AND the comment is updated AND the new pair actually passes its WCAG threshold (the 0-failures regression anchor will catch a dim orange).
3. **`SPARK_API_URL` is NOT in `.env.example` nor in `config.test.ts`'s `requiredKeys`; `CORE_SPARK_API_SECRET` IS in both.** Adding `SPARK_API_URL` requires editing both files in lockstep, else `config.test.ts` (no-placeholder check) or a new presence check fails.
4. **`vitest.setup.ts` does not seed `SPARK_API_URL`/`CORE_SPARK_API_SECRET`.** Tests for modules that read these at import time must seed them; the established `vi.mock(...)` + dynamic `await import('@/...route')` ordering (Section 1) is the safe pattern when a module captures env at eval time.
5. **No existing test exercises constant-time Bearer-secret webhook auth** (the SPARK ingestion `Authorization: Bearer {CORE_SPARK_API_SECRET}` path). Existing API tests only mock `createServerSupabaseClient().auth.getUser`. The planner is writing a net-new auth-assertion pattern; reuse `makeRequest` (set the `Authorization` header) + `makeAdminMock` for the `platform_links`/`external_identities` resolution chains.
