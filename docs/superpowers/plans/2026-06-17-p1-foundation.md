# CORE v2 P1 — Foundation & Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax.

**Goal:** Stand up a deployable Next.js 16 app whose sign-in resolves to a role, whose Supabase schema + RLS spine (identity, roles, core domain, licensing substrate) is in place behind SECURITY DEFINER helpers and object-level guards, with the AI model registry + resilient wrappers and an eval-rig harness that runs green — the working spine every later plan bolts onto.

**Architecture:** A fresh Next.js App Router scaffold (`@/* → ./src/*`) gains `src/lib/{ai,supabase,auth}` modules lifted verbatim from V1 at **`V1_SOURCE_ROOT = C:/users/inteliflow/core`** (the local v2-mine source — NOT a repo named `core-platform`), a consolidated `supabase/migrations/` sequence in FK-dependency order (identity → domain → licensing substrate → skills → snapshots → platform), and a `scripts/eval/` harness that imports `scripts/eval/types.ts` and short-circuits below a corpus-size gate. RLS is enforced via per-school `SECURITY DEFINER` helpers (`get_my_school_id`, `is_platform_admin`, `get_teacher_class_ids`); object-level `guards.ts` is the IDOR backstop on every service-role (admin-client) cross-user read.

**Tech Stack:** Next.js 16.2.9 · React 19.2.4 · Tailwind v4 · TypeScript 5 · Supabase (`@supabase/ssr` + `@supabase/supabase-js`) · `@anthropic-ai/sdk` · `openai` · `zod` · `@upstash/ratelimit` + `@upstash/redis` · Vitest · Vercel (cron via `vercel.json`).

## Global Constraints  (project-wide rules — copied from spec §1 / SCOPE §13; obey verbatim)

- **Stack is locked:** Next 16.2.9 + React 19.2.4 + Tailwind v4 + TS5. `@/*` resolves to `./src/*`.
- **Turbopack API trap:** Turbopack 404s on *new* top-level `api/` folders created mid-dev. Create the full `src/app/api/**` tree (empty `route.ts` stubs) up front; nest every new route under an existing path; restart the dev server after adding any new top-level segment. Applies to every cron + webhook.
- **Auth:** use `auth.getUser()` for trust decisions, **never** `getSession()`. `cookies()` is async in Next 16 — always `await cookies()`. Session (RLS-scoped) client for DB writes, anon client browser-side only, service-role client server-only.
- **RLS / migrations:** circular RLS resolves via `SECURITY DEFINER` SQL functions (`get_my_school_id()`, `is_platform_admin()`); `DROP POLICY IF EXISTS` before every `CREATE POLICY` (re-runnable migrations); DB triggers (not app code) for seat enforcement.
- **RLS is NOT the IDOR backstop.** The service-role admin client BYPASSES RLS. Every admin-client cross-user read MUST bind an object-level guard from `guards.ts` first (`guardStudentAccess`, `guardClassAccess`, `guardSchoolAdmin`, `guardPlatformAdmin`). State this in code review.
- **Service-role client for signal/skill/profile writes** (no `authenticated` write policy on those tables).
- **Every new table** gets `GRANT ALL … TO authenticated, anon, service_role` (PostgREST returns `42501` / "Bug #7" without it) + `ENABLE ROW LEVEL SECURITY`.
- **Language/brand:** never the word "Band" in UI (DB enum stays `reteach|grade_level|advanced`); profiles are **observational, never diagnostic**; "Reinforce / On Track / Enrich" are the CL verbs.
- **No code path may assume a Stripe customer/subscription exists** (reserved columns only at pilot).
- **SCOPE.md wins** over any divergence in this plan or the design spec — flag divergences as an open risk, do not silently diverge.
- **V1 source root (every "LIFT verbatim" step):** read from **`V1_SOURCE_ROOT = C:/users/inteliflow/core`**. Concrete paths: `$V1/lib/ai/models.ts`, `$V1/lib/claude/client.ts`, `$V1/lib/openai/resilient.ts`, `$V1/lib/auth/guards.ts`, `$V1/scripts/eval/`, `$V1/supabase/migrations/`. Do NOT fabricate file contents — open the real file. (Codex/review fix.)
- **Milestone boundary:** this is plan 1 of 8 — Foundation & Spine ONLY. Do NOT implement the generation engine, signals math, screens, licensing business logic, Spark, or media. Migrations here are **schema + RLS only** (no triggers that embed business logic except the lifted seat trigger, which is a moat, not logic).

---

## File Structure

| File | Created/Modified | Responsibility |
|------|------------------|----------------|
| `package.json` | Modify | Add runtime + dev deps; add `test`, `eval` scripts |
| `vitest.config.ts` | Create | Vitest config (node env, `@/*` alias, include globs) |
| `vitest.setup.ts` | Create | Test env bootstrap (load `.env.test`, set dummy keys) |
| `src/lib/__tests__/smoke.test.ts` | Create | Proves Vitest + alias resolution work |
| `vercel.json` | Create | Cron skeleton (4 crons) + function config |
| `.env.example` | Create | Full var inventory, names only (committed) |
| `.gitignore` | Modify | Ensure `.env.local`, `.env.test` ignored |
| `src/lib/ai/models.ts` | Create (LIFT) | Model registry: model-id constants + token-param compat helpers + `PROMPT_VERSION`/`MODEL_VERSION` |
| `src/lib/ai/__tests__/models.test.ts` | Create | Unit-tests `usesLegacyTokenParam` / `tokenLimitParams` |
| `src/lib/ai/claude.ts` | Create (LIFT) | Resilient Anthropic wrapper (`resilientClaudeChat`, `claudeChat`) |
| `src/lib/ai/openai.ts` | Create (LIFT) | Resilient OpenAI wrapper (`resilientChatCompletion`, `resilientImageGeneration`) |
| `src/lib/ai/errors.ts` | Create | `LlmExhaustedError` typed terminal-failure error (§3.5 substrate) |
| `src/lib/supabase/server.ts` | Create (LIFT) | SSR server client (`await cookies()`) + admin client |
| `src/lib/supabase/client.ts` | Create | Browser client (anon key only) |
| `src/lib/auth/guards.ts` | Create (LIFT) | Object-level authz (`resolveCaller`, `guardClassAccess`, `guardStudentAccess`, `guardSchoolAdmin`, `guardPlatformAdmin`) |
| `src/lib/auth/__tests__/roles.test.ts` | Create | Asserts the 6-role constant set incl. `school_sysadmin` |
| `src/lib/auth/roles.ts` | Create | Canonical role + CL-verb constant exports |
| `src/middleware.ts` | Create | Session-refresh middleware (`auth.getUser()` every request) |
| `src/app/layout.tsx` | Modify | Replace create-next-app boilerplate metadata |
| `src/app/api/**/route.ts` | Create | Empty route stubs (cron + webhook + auth) to dodge the Turbopack trap |
| `src/app/auth/callback/route.ts` | Create | Auth callback stub (code → session exchange) |
| `supabase/migrations/0001_identity_roles.sql` | Create (LIFT 000+035 head) | `schools`, `users` (+ `school_sysadmin`), `guardians`, RLS helpers |
| `supabase/migrations/0002_classes_enrollments.sql` | Create (LIFT 000+049) | `classes`, `enrollments` + seat trigger placeholder |
| `supabase/migrations/0003_lessons_quizzes.sql` | Create (LIFT 000) | `lessons`, `quizzes`, `quiz_questions`, `quiz_attempts`, `quiz_responses` |
| `supabase/migrations/0004_assignments_homework.sql` | Create (LIFT 000) | `assignments`, `homework_attempts` |
| `supabase/migrations/0005_skills.sql` | Create (LIFT 071+072) | `skills`, `skill_learning_state` (6-state) + linkage columns |
| `supabase/migrations/0006_snapshots.sql` | Create (LIFT 046) | `student_model_snapshots` (weekly trajectory) |
| `supabase/migrations/0007_licensing.sql` | Create (LIFT 020+049) | `school_licenses`, `license_keys`, `license_events` (tier-enum reconciled) |
| `supabase/migrations/0008_platform.sql` | Create (LIFT 034 + NEW) | `platform_events` (media-meter substrate), `platform_links` |
| `supabase/migrations/__tests__/migrations.test.ts` | Create | Parses each `.sql`, asserts tables/columns/enums/RLS present |
| `scripts/eval/types.ts` | Create (LIFT verbatim) | Eval tuple shapes + `ALL_SCOPES` + `RunReport` |
| `scripts/eval/corpus/<scope>.json` | Create | Empty corpus arrays (`[]`) per scope |
| `scripts/eval/runner.ts` | Create | `loadCorpus`, `runScope`, `MIN_TUPLES` gate (short-circuit) |
| `scripts/eval/ci.ts` | Create | CI entry: run all scopes, exit 0 on pass / corpus-too-small |
| `scripts/eval/__tests__/runner.test.ts` | Create | Proves the harness runs + short-circuits "corpus too small" |

---

### Task 1: Project config — dependencies, Vitest, smoke test

**Files:**
- Modify: `C:/users/inteliflow/NEW-CORE/package.json`
- Create: `C:/users/inteliflow/NEW-CORE/vitest.config.ts`
- Create: `C:/users/inteliflow/NEW-CORE/vitest.setup.ts`
- Test: `C:/users/inteliflow/NEW-CORE/src/lib/__tests__/smoke.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `npm test` (Vitest) runnable; `@/*` alias resolved in tests; deps `@supabase/ssr`, `@supabase/supabase-js`, `zod`, `@anthropic-ai/sdk`, `openai`, `@upstash/ratelimit`, `@upstash/redis` installed for later tasks.

- [ ] Add runtime + dev dependencies (pinned to current published versions at build):
```bash
cd /c/users/inteliflow/NEW-CORE
npm install @supabase/ssr @supabase/supabase-js zod @anthropic-ai/sdk openai @upstash/ratelimit @upstash/redis
npm install -D vitest @vitejs/plugin-react vite-tsconfig-paths @vitest/coverage-v8
```
Expected: `added N packages` and `package.json` `dependencies`/`devDependencies` now list all of the above.

- [ ] Add test scripts to `package.json` `scripts`:
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "test:watch": "vitest",
  "eval": "tsx scripts/eval/ci.ts"
}
```
Then install the `eval` runner dep:
```bash
npm install -D tsx
```
Expected: `package.json` shows `test` and `eval` scripts.

- [ ] Write the Vitest config (node env, tsconfig path alias via `vite-tsconfig-paths`):
```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'supabase/**/*.test.ts'],
  },
});
```

- [ ] Write the setup file (dummy env so import-time guards in lifted files don't throw):
```ts
// vitest.setup.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.ANTHROPIC_API_KEY ||= 'test-anthropic-key';
process.env.OPENAI_API_KEY ||= 'test-openai-key';
```

- [ ] Write the failing smoke test (alias + runner proof):
```ts
// src/lib/__tests__/smoke.test.ts
import { describe, it, expect } from 'vitest';
import { SMOKE } from '@/lib/smoke';

describe('vitest smoke', () => {
  it('resolves the @/* alias and runs', () => {
    expect(SMOKE).toBe('ok');
  });
});
```

- [ ] Run it and confirm it FAILS (module not found):
```bash
npm test
```
Expected FAIL: `Failed to resolve import "@/lib/smoke"` (the module does not exist yet).

- [ ] Create the minimal module:
```ts
// src/lib/smoke.ts
export const SMOKE = 'ok';
```

- [ ] Run and confirm PASS:
```bash
npm test
```
Expected: `1 passed (1)`.

- [ ] Verify `.gitignore` ignores local env (append if absent):
```gitignore
.env.local
.env.test
.env*.local
```

- [ ] Commit:
```bash
git add -A && git commit -m "P1 Task 1: deps + Vitest config + smoke test"
```

---

### Task 2: `.env.example` + `vercel.json` cron skeleton

**Files:**
- Create: `C:/users/inteliflow/NEW-CORE/.env.example`
- Create: `C:/users/inteliflow/NEW-CORE/vercel.json`

**Interfaces:**
- Consumes: nothing.
- Produces: documented env var inventory (names only) + 4 registered cron paths every later plan's cron handlers slot into.

- [ ] Write `.env.example` — names only, never values (full inventory from spec §1.6):
```bash
# .env.example — CORE v2 P1. Names only; never commit values.

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# AI models (registry reads these — see src/lib/ai/models.ts)
ANTHROPIC_API_KEY=
ANTHROPIC_GRADING_MODEL=
OPENAI_API_KEY=
OPENAI_GEN_MODEL=
OPENAI_GRADING_FALLBACK=
OPENAI_VOICE_MODEL=

# Licensing (HMAC-SHA256 key signing)
LICENSE_KEY_SECRET=

# Spark contract (HS256 JWT signing + Spark->CORE return Bearer)
CORE_SPARK_API_SECRET=

# Media (degrade gracefully if absent)
FLUX_API_KEY=
RUNWAY_API_KEY=

# Email
RESEND_API_KEY=

# Monitoring
SENTRY_DSN=
SENTRY_AUTH_TOKEN=

# Analytics (PostHog 2-project split: public + server-side)
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=
POSTHOG_PROJECT_API_KEY=
POSTHOG_PERSONAL_API_KEY=
POSTHOG_HOST=

# Rate limit / cache
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Google Classroom OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=

# CRM (HighLevel trial-signup webhook, non-blocking)
HIGHLEVEL_WEBHOOK_URL=
HIGHLEVEL_WEBHOOK_SECRET=

# Cron (guards all cron route handlers)
CRON_SECRET=

# Deferred (reserved, no keys at pilot): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
```

- [ ] Write `vercel.json` with the 4-cron skeleton (paths nested under existing `api/` segments per the Turbopack rule):
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/cron/trial-check", "schedule": "0 8 * * *" },
    { "path": "/api/cron/idempotency-sweep", "schedule": "0 3 * * *" },
    { "path": "/api/cron/weekly-snapshot", "schedule": "0 6 * * 1" },
    { "path": "/api/cron/parent-narrative", "schedule": "0 7 * * 1" }
  ]
}
```
Note: the cron handler bodies are later-plan deliverables; Task 4 creates empty stubs at these paths so the dev server registers them.

- [ ] Verify the JSON is valid:
```bash
node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('vercel.json valid')"
```
Expected: `vercel.json valid`.

- [ ] Commit:
```bash
git add -A && git commit -m "P1 Task 2: .env.example inventory + vercel.json cron skeleton"
```

---

### Task 3: AI model registry + token-param compat helper (LIFT `lib/ai/models.ts`)

**Files:**
- Create: `C:/users/inteliflow/NEW-CORE/src/lib/ai/models.ts`
- Test: `C:/users/inteliflow/NEW-CORE/src/lib/ai/__tests__/models.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `usesLegacyTokenParam(model: string): boolean`
  - `tokenLimitParams(model: string, n: number): { max_tokens: number } | { max_completion_tokens: number }`
  - constants `CLAUDE_GRADING_MODEL`, `OPENAI_GEN_MODEL`, `OPENAI_VOICE_MODEL`, `OPENAI_GRADING_FALLBACK: string`
  - `MODELS` object; `PROMPT_VERSION: string`; `MODEL_VERSION: string` (read later by eval rig + Spark fingerprint)

- [ ] Write the failing test for the token-param compat helpers:
```ts
// src/lib/ai/__tests__/models.test.ts
import { describe, it, expect } from 'vitest';
import { usesLegacyTokenParam, tokenLimitParams, MODELS, MODEL_VERSION } from '@/lib/ai/models';

describe('usesLegacyTokenParam', () => {
  it('is true for gpt-4 / gpt-3 / fine-tuned legacy', () => {
    expect(usesLegacyTokenParam('gpt-4o')).toBe(true);
    expect(usesLegacyTokenParam('gpt-4o-mini')).toBe(true);
    expect(usesLegacyTokenParam('gpt-3.5-turbo')).toBe(true);
    expect(usesLegacyTokenParam('ft:gpt-4o-2024')).toBe(true);
  });
  it('is false for gpt-5 family / o-series / claude', () => {
    expect(usesLegacyTokenParam('gpt-5.4-mini')).toBe(false);
    expect(usesLegacyTokenParam('o3-mini')).toBe(false);
    expect(usesLegacyTokenParam('claude-opus-4-8')).toBe(false);
  });
});

describe('tokenLimitParams', () => {
  it('emits max_tokens for legacy models', () => {
    expect(tokenLimitParams('gpt-4o', 600)).toEqual({ max_tokens: 600 });
  });
  it('emits max_completion_tokens for newer models', () => {
    expect(tokenLimitParams('gpt-5.4-mini', 600)).toEqual({ max_completion_tokens: 600 });
  });
});

describe('registry exports', () => {
  it('exposes a MODELS object and a MODEL_VERSION string', () => {
    expect(typeof MODELS).toBe('object');
    expect(typeof MODEL_VERSION).toBe('string');
  });
});
```

- [ ] Run and confirm it FAILS:
```bash
npm test src/lib/ai/__tests__/models.test.ts
```
Expected FAIL: `Failed to resolve import "@/lib/ai/models"`.

- [ ] Write the registry (LIFT V1 `lib/ai/models.ts` pattern verbatim; re-pin dated IDs to current Claude/GPT at build; keep the env-lever pattern; add `MODELS`/`PROMPT_VERSION`/`MODEL_VERSION`):
```ts
// src/lib/ai/models.ts
// Central registry of AI model IDs — single source of truth (LIFT V1 lib/ai/models.ts).
// Never hardcode a model ID at a call site. IDs are dated — re-pin at build.
//
// CALIBRATION CONTRACT: the grading default is NOT settled by SCOPE (spec §1.3).
// P1 ships ANTHROPIC_GRADING_MODEL defaulting to the V1-proven Sonnet-class id that
// matches the locked eval corpus, overridable by env. The week-1 Opus spike (spec §3.1)
// decides whether to flip it — keep the pick a one-line env change.

/** Anthropic grading model. Calibration-locked default; env-overridable. */
export const CLAUDE_GRADING_MODEL =
  process.env.ANTHROPIC_GRADING_MODEL || 'claude-sonnet-4-6';

/** OpenAI generation + diagnostic paths. Calibration-sensitive. */
export const OPENAI_GEN_MODEL = process.env.OPENAI_GEN_MODEL || 'gpt-4o';

/** OpenAI grading fallback (Claude -> GPT fallback chain). */
export const OPENAI_GRADING_FALLBACK =
  process.env.OPENAI_GRADING_FALLBACK || 'gpt-4o';

/** Non-graded voice/tone surfaces. PILOT LEVER — env-overridable, unset = no change. */
export const OPENAI_VOICE_MODEL = process.env.OPENAI_VOICE_MODEL || 'gpt-4o';

/** Voice models (Whisper / TTS) per V1. */
export const OPENAI_VOICE_TRANSCRIBE_MODEL =
  process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
export const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'tts-1';

/** Single object the eval rig + Spark cache fingerprint read. */
export const MODELS = {
  grading: CLAUDE_GRADING_MODEL,
  gradingFallback: OPENAI_GRADING_FALLBACK,
  generation: OPENAI_GEN_MODEL,
  voice: OPENAI_VOICE_MODEL,
  transcribe: OPENAI_VOICE_TRANSCRIBE_MODEL,
  tts: OPENAI_TTS_MODEL,
} as const;

/** Bumped whenever a calibration-locked prompt changes (eval drift trigger). */
export const PROMPT_VERSION = '1.0.0';
/** Bumped whenever a calibration-locked model id changes (eval drift trigger). */
export const MODEL_VERSION = `${CLAUDE_GRADING_MODEL}+${OPENAI_GEN_MODEL}`;

// ── Token-limit param compatibility (LIFT verbatim) ──
// gpt-4/gpt-3 families take `max_tokens`. Newer (gpt-5 family, o-series) renamed
// it to `max_completion_tokens` and reject `max_tokens` with a 400.

/** True for models that still take the legacy `max_tokens` param. */
export function usesLegacyTokenParam(model: string): boolean {
  return /^(gpt-4|gpt-3|ft:gpt-[34])/.test(model);
}

/**
 * Returns the correct token-limit param object for the given model:
 * `{ max_tokens: n }` for gpt-4/3, `{ max_completion_tokens: n }` for newer.
 */
export function tokenLimitParams(
  model: string,
  n: number,
): { max_tokens: number } | { max_completion_tokens: number } {
  return usesLegacyTokenParam(model) ? { max_tokens: n } : { max_completion_tokens: n };
}
```

- [ ] Run and confirm PASS:
```bash
npm test src/lib/ai/__tests__/models.test.ts
```
Expected: `9 passed` (or equivalent count) — all assertions green.

- [ ] Commit:
```bash
git add -A && git commit -m "P1 Task 3: AI model registry + token-param compat (LIFT V1)"
```

---

### Task 4: Resilient AI wrappers + `LlmExhaustedError` (LIFT `claude/client.ts` + `openai/resilient.ts`)

**Files:**
- Create: `C:/users/inteliflow/NEW-CORE/src/lib/ai/errors.ts`
- Create: `C:/users/inteliflow/NEW-CORE/src/lib/ai/claude.ts`
- Create: `C:/users/inteliflow/NEW-CORE/src/lib/ai/openai.ts`
- Test: `C:/users/inteliflow/NEW-CORE/src/lib/ai/__tests__/wrappers.test.ts`

**Interfaces:**
- Consumes: `CLAUDE_GRADING_MODEL`, `usesLegacyTokenParam` (Task 3).
- Produces:
  - `class LlmExhaustedError extends Error` with `{ provider: string; cause?: unknown }`
  - `resilientClaudeChat(params, options?): Promise<{ content: string } | null>`
  - `claudeChat(systemPrompt, userPrompt, options?): Promise<string | null>`
  - `resilientChatCompletion(params, options?): Promise<OpenAI.Chat.ChatCompletion | null>`
  - `resilientImageGeneration(params, options?): Promise<OpenAI.Images.ImagesResponse | null>`

NOTE: This task LIFTs the wrappers and adds the typed terminal-failure error class only. NO generation routes — those are later plans.

- [ ] Write the failing test (assert the error class + that the modules import without side-effect crashes):
```ts
// src/lib/ai/__tests__/wrappers.test.ts
import { describe, it, expect } from 'vitest';
import { LlmExhaustedError } from '@/lib/ai/errors';

describe('LlmExhaustedError', () => {
  it('is an Error with a provider tag', () => {
    const e = new LlmExhaustedError('claude', new Error('429'));
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('LlmExhaustedError');
    expect(e.provider).toBe('claude');
  });
});

describe('wrapper modules import cleanly', () => {
  it('claude + openai wrappers export their fns', async () => {
    const claude = await import('@/lib/ai/claude');
    const openai = await import('@/lib/ai/openai');
    expect(typeof claude.claudeChat).toBe('function');
    expect(typeof claude.resilientClaudeChat).toBe('function');
    expect(typeof openai.resilientChatCompletion).toBe('function');
    expect(typeof openai.resilientImageGeneration).toBe('function');
  });
});
```

- [ ] Run and confirm it FAILS:
```bash
npm test src/lib/ai/__tests__/wrappers.test.ts
```
Expected FAIL: `Failed to resolve import "@/lib/ai/errors"`.

- [ ] Write the typed error:
```ts
// src/lib/ai/errors.ts
// Terminal-failure contract substrate (spec §1.4 / §3.5). After primary+fallback
// both exhaust, wrappers raise this; route handlers (later plans) translate it to the
// standard error envelope, never a raw 500 with a partial body.
export class LlmExhaustedError extends Error {
  readonly provider: string;
  readonly cause?: unknown;
  constructor(provider: string, cause?: unknown) {
    super(`LLM exhausted after retries (provider=${provider})`);
    this.name = 'LlmExhaustedError';
    this.provider = provider;
    this.cause = cause;
  }
}
```

- [ ] Write the Claude wrapper (LIFT V1 `lib/claude/client.ts` verbatim; only the import path changes to `@/lib/ai/models`):
```ts
// src/lib/ai/claude.ts
// Resilient Anthropic Claude wrapper with retry logic (LIFT V1 lib/claude/client.ts).
import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_GRADING_MODEL } from '@/lib/ai/models';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface RetryOptions { maxRetries?: number; initialDelayMs?: number; maxDelayMs?: number; timeoutMs?: number; }
interface ClaudeMessage { role: 'user' | 'assistant'; content: string; }
interface ClaudeChatParams { system?: string; messages: ClaudeMessage[]; temperature?: number; max_tokens?: number; }
interface ClaudeChatResult { content: string; }

export async function resilientClaudeChat(
  params: ClaudeChatParams,
  options: RetryOptions = {},
): Promise<ClaudeChatResult | null> {
  const { maxRetries = 3, initialDelayMs = 1000, maxDelayMs = 10000, timeoutMs = 30000 } = options;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let abortedByTimer = false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => { abortedByTimer = true; controller.abort(); }, timeoutMs);
      const response = await anthropic.messages.create({
        model: CLAUDE_GRADING_MODEL,
        max_tokens: params.max_tokens || 1024,
        temperature: params.temperature ?? 0.3,
        system: params.system,
        messages: params.messages.map(m => ({ role: m.role, content: m.content })),
      }, { signal: controller.signal });
      clearTimeout(timer);
      const textBlock = response.content.find(b => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') { console.warn('[Claude] No text content'); return null; }
      return { content: textBlock.text };
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      if (error.status === 400 || error.status === 401 || error.status === 404) {
        console.error(`[Claude] Non-retryable (${error.status}):`, error.message); return null;
      }
      if (abortedByTimer) {
        console.warn(`[Claude] Aborted by timeout (${timeoutMs}ms) attempt ${attempt + 1} — short-circuiting so caller can fall back`); return null;
      }
      if (attempt < maxRetries) {
        const delay = Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs);
        console.warn(`[Claude] Attempt ${attempt + 1}/${maxRetries + 1} failed, retrying in ${delay}ms:`, error.message);
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.error(`[Claude] All ${maxRetries + 1} attempts failed:`, error.message); return null;
      }
    }
  }
  return null;
}

export async function claudeChat(
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; maxTokens?: number; timeoutMs?: number },
): Promise<string | null> {
  const result = await resilientClaudeChat({
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: options?.temperature ?? 0.3,
    max_tokens: options?.maxTokens || 1024,
  }, { timeoutMs: options?.timeoutMs || 30000 });
  return result?.content || null;
}
```

- [ ] Write the OpenAI wrapper (LIFT V1 `lib/openai/resilient.ts` verbatim; import path → `@/lib/ai/models`):
```ts
// src/lib/ai/openai.ts
// Resilient OpenAI wrapper with exponential backoff retry (LIFT V1 lib/openai/resilient.ts).
import OpenAI from 'openai';
import { usesLegacyTokenParam } from '@/lib/ai/models';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function normalizeTokenParam(
  params: OpenAI.Chat.ChatCompletionCreateParams,
): OpenAI.Chat.ChatCompletionCreateParams {
  const model = typeof params.model === 'string' ? params.model : '';
  if (usesLegacyTokenParam(model)) return params;
  if (params.max_tokens == null || params.max_completion_tokens != null) return params;
  const { max_tokens, ...rest } = params;
  return { ...rest, max_completion_tokens: max_tokens };
}

interface RetryOptions { maxRetries?: number; initialDelayMs?: number; maxDelayMs?: number; timeoutMs?: number; }

export async function resilientChatCompletion(
  params: OpenAI.Chat.ChatCompletionCreateParams,
  options: RetryOptions = {},
): Promise<OpenAI.Chat.ChatCompletion | null> {
  const { maxRetries = 3, initialDelayMs = 1000, maxDelayMs = 10000, timeoutMs = 30000 } = options;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const result = await openai.chat.completions.create(
        { ...normalizeTokenParam(params), stream: false },
        { signal: controller.signal },
      );
      clearTimeout(timeout);
      return result;
    } catch (error: unknown) {
      const err = error as { status?: number; response?: { status?: number }; message?: string };
      const status = err?.status || err?.response?.status;
      const isRetryable = !status || status === 429 || status >= 500;
      if (!isRetryable || attempt === maxRetries) {
        console.error(`[OpenAI] Failed after ${attempt + 1} attempts:`, err?.message || error); return null;
      }
      const delay = Math.min(initialDelayMs * Math.pow(2, attempt) + Math.random() * 500, maxDelayMs);
      console.warn(`[OpenAI] Attempt ${attempt + 1} failed (${status || 'timeout'}), retrying in ${Math.round(delay)}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return null;
}

export async function resilientImageGeneration(
  params: OpenAI.Images.ImageGenerateParams,
  options: RetryOptions = {},
): Promise<OpenAI.Images.ImagesResponse | null> {
  const { maxRetries = 2, initialDelayMs = 2000, maxDelayMs = 15000, timeoutMs = 60000 } = options;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const result = await openai.images.generate(params, { signal: controller.signal }) as OpenAI.Images.ImagesResponse;
      clearTimeout(timeout);
      return result;
    } catch (error: unknown) {
      const err = error as { status?: number; response?: { status?: number }; message?: string };
      const status = err?.status || err?.response?.status;
      const isRetryable = !status || status === 429 || status >= 500;
      if (!isRetryable || attempt === maxRetries) {
        console.error(`[OpenAI Image] Failed after ${attempt + 1} attempts:`, err?.message || error); return null;
      }
      const delay = Math.min(initialDelayMs * Math.pow(2, attempt) + Math.random() * 500, maxDelayMs);
      console.warn(`[OpenAI Image] Attempt ${attempt + 1} failed (${status || 'timeout'}), retrying in ${Math.round(delay)}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return null;
}

export { openai };
```

- [ ] Run and confirm PASS:
```bash
npm test src/lib/ai/__tests__/wrappers.test.ts
```
Expected: `3 passed`.

- [ ] Commit:
```bash
git add -A && git commit -m "P1 Task 4: resilient AI wrappers + LlmExhaustedError (LIFT V1)"
```

---

### Task 5: Supabase clients (`server.ts` + `client.ts`) with `@supabase/ssr`

**Files:**
- Create: `C:/users/inteliflow/NEW-CORE/src/lib/supabase/server.ts`
- Create: `C:/users/inteliflow/NEW-CORE/src/lib/supabase/client.ts`
- Test: `C:/users/inteliflow/NEW-CORE/src/lib/supabase/__tests__/clients.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `createServerSupabaseClient(): Promise<SupabaseClient>` (async; `await cookies()` internally; calls `auth.getUser()` not `getSession()` at call sites)
  - `createAdminSupabaseClient(): SupabaseClient` (service-role, server-only)
  - `createBrowserSupabaseClient(): SupabaseClient` (anon key only)

- [ ] Write the failing test (mock `next/headers` so `cookies()` resolves; assert clients construct):
```ts
// src/lib/supabase/__tests__/clients.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

describe('supabase clients', () => {
  it('server client constructs with an auth surface', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    const client = await createServerSupabaseClient();
    expect(client).toBeTruthy();
    expect(client.auth).toBeTruthy();
    expect(typeof client.auth.getUser).toBe('function');
  });
  it('admin client constructs', async () => {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    expect(createAdminSupabaseClient()).toBeTruthy();
  });
  it('browser client constructs', async () => {
    const { createBrowserSupabaseClient } = await import('@/lib/supabase/client');
    expect(createBrowserSupabaseClient()).toBeTruthy();
  });
});
```

- [ ] Run and confirm it FAILS:
```bash
npm test src/lib/supabase/__tests__/clients.test.ts
```
Expected FAIL: `Failed to resolve import "@/lib/supabase/server"`.

- [ ] Write the server + admin clients (LIFT V1 `lib/supabase/server.ts` verbatim):
```ts
// src/lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

export async function createServerSupabaseClient() {
  const cookieStore = await cookies(); // Next 16: cookies() is async
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error(`Missing Supabase env vars. URL: ${!!url}, KEY: ${!!key}`);

  const client = createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch { /* called from a Server Component — middleware refreshes the session */ }
      },
    },
  });
  if (!client?.auth) throw new Error('createServerClient returned no auth surface — check @supabase/ssr version');
  return client;
}

/** Service-role client. SERVER-ONLY — never import from client code. BYPASSES RLS;
 *  every cross-user read MUST pair with an object-level guard (src/lib/auth/guards.ts). */
export function createAdminSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
```

- [ ] Write the browser client:
```ts
// src/lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr';

/** Browser client — anon key only. Never reads the service-role key. */
export function createBrowserSupabaseClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] Run and confirm PASS:
```bash
npm test src/lib/supabase/__tests__/clients.test.ts
```
Expected: `3 passed`.

- [ ] Commit:
```bash
git add -A && git commit -m "P1 Task 5: Supabase server/admin/browser clients (@supabase/ssr, await cookies)"
```

---

### Task 6: Roles constants + object-level guards (LIFT `lib/auth/guards.ts`)

**Files:**
- Create: `C:/users/inteliflow/NEW-CORE/src/lib/auth/roles.ts`
- Create: `C:/users/inteliflow/NEW-CORE/src/lib/auth/guards.ts`
- Test: `C:/users/inteliflow/NEW-CORE/src/lib/auth/__tests__/roles.test.ts`

**Interfaces:**
- Consumes: `createServerSupabaseClient`, `createAdminSupabaseClient` (Task 5).
- Produces:
  - `ROLES`, `SCHOOL_ADMIN_ROLES`, `CL_VERB_BY_STATE` constants
  - `guardPlatformAdmin(): Promise<NextResponse | null>`
  - `guardSchoolAdmin(): Promise<{ error: NextResponse } | { schoolId: string | null; role: string; userId: string }>`
  - `guardClassAccess(classId: string): Promise<NextResponse | null>`
  - `guardStudentAccess(studentId: string): Promise<NextResponse | null>`

- [ ] Write the failing test (the 6-role reconciliation incl. `school_sysadmin`, spec §1.2):
```ts
// src/lib/auth/__tests__/roles.test.ts
import { describe, it, expect } from 'vitest';
import { ROLES, SCHOOL_ADMIN_ROLES, CL_VERB_BY_STATE } from '@/lib/auth/roles';

describe('role model', () => {
  it('has all 6 roles incl. the code-only school_sysadmin (spec §1.2)', () => {
    expect(ROLES).toEqual([
      'teacher', 'student', 'parent', 'school_admin', 'school_sysadmin', 'platform_admin',
    ]);
  });
  it('treats school_sysadmin as a school-admin-tier role', () => {
    expect(SCHOOL_ADMIN_ROLES).toContain('school_sysadmin');
    expect(SCHOOL_ADMIN_ROLES).toContain('school_admin');
    expect(SCHOOL_ADMIN_ROLES).toContain('platform_admin');
  });
});

describe('CL verb mapping (6 states -> 3 verbs + cold-start)', () => {
  it('maps the 6 skill_learning_state values to teacher verbs', () => {
    expect(CL_VERB_BY_STATE.needs_different_instruction).toBe('Reinforce');
    expect(CL_VERB_BY_STATE.needs_more_time).toBe('Reinforce');
    expect(CL_VERB_BY_STATE.on_track).toBe('On Track');
    expect(CL_VERB_BY_STATE.ready_to_extend).toBe('Enrich');
    expect(CL_VERB_BY_STATE.insufficient_data).toBeNull();
    expect(CL_VERB_BY_STATE.not_attempted).toBeNull();
  });
});
```

- [ ] Run and confirm it FAILS:
```bash
npm test src/lib/auth/__tests__/roles.test.ts
```
Expected FAIL: `Failed to resolve import "@/lib/auth/roles"`.

- [ ] Write the roles constants (reconciles the 6th role + the CL verb display layer — both load-bearing for later plans):
```ts
// src/lib/auth/roles.ts
// Canonical role model (spec §1.2). The DB CHECK in migration 0001 carries the
// same 6 values; this is the code-side mirror. `school_sysadmin` is the 6th role
// V1 code depends on but the V1 000 enum omitted — reconciled here + in 0001.
export const ROLES = [
  'teacher', 'student', 'parent', 'school_admin', 'school_sysadmin', 'platform_admin',
] as const;
export type Role = (typeof ROLES)[number];

/** Roles routed through the School Admin route group + passing guardSchoolAdmin. */
export const SCHOOL_ADMIN_ROLES = ['school_admin', 'school_sysadmin', 'platform_admin'] as const;

/** CL verb display layer over the 6 skill_learning_state values (spec §3.2).
 *  null = cold-start "Not yet assessed" (never a fabricated verb). DB enum is
 *  internal-only; the teacher never sees the raw state. */
export const CL_VERB_BY_STATE = {
  needs_different_instruction: 'Reinforce',
  needs_more_time: 'Reinforce',
  on_track: 'On Track',
  ready_to_extend: 'Enrich',
  insufficient_data: null,
  not_attempted: null,
} as const;
```

- [ ] Write the guards (LIFT V1 `lib/auth/guards.ts` verbatim; import `SCHOOL_ADMIN_ROLES` from `roles.ts` instead of re-declaring it):
```ts
// src/lib/auth/guards.ts
// Object-level authz for API route handlers (LIFT V1 lib/auth/guards.ts; finding C3).
// The service-role admin client BYPASSES RLS — these guards are the ONLY access
// control on admin-client cross-user reads. RLS is NOT the backstop here.
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { SCHOOL_ADMIN_ROLES } from '@/lib/auth/roles';

const PLATFORM_ROLE = 'platform_admin';

function isSchoolAdmin(role: string | null): boolean {
  return !!role && (SCHOOL_ADMIN_ROLES as readonly string[]).includes(role);
}
const UNAUTH = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
const FORBID = () => NextResponse.json({ error: 'Forbidden' }, { status: 403 });

async function resolveCaller(): Promise<{ id: string; role: string | null; school_id: string | null } | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser(); // getUser, not getSession
  if (!user) return null;
  const { data: profile } = await supabase
    .from('users').select('role, school_id').eq('id', user.id).single();
  return { id: user.id, role: profile?.role ?? null, school_id: profile?.school_id ?? null };
}

export async function guardPlatformAdmin(): Promise<NextResponse | null> {
  const caller = await resolveCaller();
  if (!caller) return UNAUTH();
  if (caller.role !== PLATFORM_ROLE) return FORBID();
  return null;
}

export async function guardSchoolAdmin(): Promise<
  { error: NextResponse } | { schoolId: string | null; role: string; userId: string }
> {
  const caller = await resolveCaller();
  if (!caller) return { error: UNAUTH() };
  if (!(SCHOOL_ADMIN_ROLES as readonly string[]).includes(caller.role as string)) {
    return { error: FORBID() };
  }
  return { schoolId: caller.school_id, role: caller.role as string, userId: caller.id };
}

export async function guardClassAccess(classId: string): Promise<NextResponse | null> {
  const caller = await resolveCaller();
  if (!caller) return UNAUTH();
  if (caller.role === PLATFORM_ROLE) return null;
  const admin = createAdminSupabaseClient();
  const { data: cls } = await admin.from('classes').select('teacher_id, school_id').eq('id', classId).maybeSingle();
  if (!cls) return FORBID(); // 403 not 404 — don't leak existence
  if (cls.teacher_id === caller.id) return null;
  if (isSchoolAdmin(caller.role) && cls.school_id && cls.school_id === caller.school_id) return null;
  return FORBID();
}

export async function guardStudentAccess(studentId: string): Promise<NextResponse | null> {
  const caller = await resolveCaller();
  if (!caller) return UNAUTH();
  if (caller.id === studentId) return null;
  if (caller.role === PLATFORM_ROLE) return null;
  const admin = createAdminSupabaseClient();
  const { data: stu } = await admin.from('users').select('school_id, parent_id').eq('id', studentId).maybeSingle();
  if (!stu) return FORBID();
  if (isSchoolAdmin(caller.role) && stu.school_id && stu.school_id === caller.school_id) return null;
  if (caller.role === 'parent' && stu.parent_id === caller.id) return null;
  if (caller.role === 'teacher') {
    const { data: classes } = await admin.from('classes').select('id').eq('teacher_id', caller.id);
    const classIds = (classes ?? []).map((c: { id: string }) => c.id);
    if (classIds.length) {
      const { data: enr } = await admin
        .from('enrollments').select('id').eq('student_id', studentId).in('class_id', classIds).limit(1).maybeSingle();
      if (enr) return null;
    }
  }
  return FORBID();
}
```

- [ ] Run and confirm PASS:
```bash
npm test src/lib/auth/__tests__/roles.test.ts
```
Expected: `4 passed`.

- [ ] Commit:
```bash
git add -A && git commit -m "P1 Task 6: 6-role model + CL verb map + object-level guards (LIFT V1)"
```

---

### Task 7: Session-refresh middleware + auth callback + route stub tree

**Files:**
- Create: `C:/users/inteliflow/NEW-CORE/src/middleware.ts`
- Create: `C:/users/inteliflow/NEW-CORE/src/app/auth/callback/route.ts`
- Create: empty `route.ts` stubs under `src/app/api/**` (cron + webhook + auth)
- Modify: `C:/users/inteliflow/NEW-CORE/src/app/layout.tsx`
- Test: `C:/users/inteliflow/NEW-CORE/src/app/api/__tests__/route-stubs.test.ts`

**Interfaces:**
- Consumes: `@supabase/ssr` `createServerClient`.
- Produces: a root `middleware.ts` that refreshes the session via `auth.getUser()` every request; the full `src/app/api/**` route-stub tree (avoids the Turbopack 404 trap); the `(auth)` callback route.

NOTE: Stubs return `501 Not Implemented` so they are deployable but obviously unfinished; later plans fill the bodies.

- [ ] Create the cron + webhook + auth route stubs (one action; matches `vercel.json` paths):
```bash
cd /c/users/inteliflow/NEW-CORE
mkdir -p src/app/api/cron/trial-check src/app/api/cron/idempotency-sweep \
  src/app/api/cron/weekly-snapshot src/app/api/cron/parent-narrative \
  src/app/api/attempts/spark-attempt-complete \
  src/app/api/public/trial/signup \
  src/app/auth/callback
for p in cron/trial-check cron/idempotency-sweep cron/weekly-snapshot cron/parent-narrative \
         attempts/spark-attempt-complete public/trial/signup; do
  printf '%s\n' \
  "import { NextResponse } from 'next/server';" \
  "// P1 stub — body is a later-plan deliverable. Created up front to dodge the" \
  "// Turbopack new-top-level-api-folder 404 trap (spec §1.5)." \
  "export async function POST() {" \
  "  return NextResponse.json({ error: 'Not implemented' }, { status: 501 });" \
  "}" \
  "export async function GET() {" \
  "  return NextResponse.json({ error: 'Not implemented' }, { status: 501 });" \
  "}" > "src/app/api/$p/route.ts"
done
```

- [ ] Write the auth callback (code → session exchange; lives in `(auth)`/`auth` path, nested under existing):
```ts
// src/app/auth/callback/route.ts
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';
  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
```

- [ ] Write the session-refresh middleware (refreshes every request via `auth.getUser()`):
```ts
// src/middleware.ts
import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  await supabase.auth.getUser(); // revalidate with the auth server, not getSession()
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

- [ ] Replace the create-next-app boilerplate metadata in `src/app/layout.tsx` (change only the `metadata` object):
```ts
export const metadata: Metadata = {
  title: "CORE — Learning Intelligence",
  description: "CORE shows a teacher how each student learns and thinks, and turns it into one clear next step.",
};
```

- [ ] Write a test asserting the stub tree exists and stubs return 501:
```ts
// src/app/api/__tests__/route-stubs.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const STUBS = [
  'src/app/api/cron/trial-check/route.ts',
  'src/app/api/cron/idempotency-sweep/route.ts',
  'src/app/api/cron/weekly-snapshot/route.ts',
  'src/app/api/cron/parent-narrative/route.ts',
  'src/app/api/attempts/spark-attempt-complete/route.ts',
  'src/app/api/public/trial/signup/route.ts',
  'src/app/auth/callback/route.ts',
];

describe('api route-stub tree (Turbopack trap mitigation)', () => {
  it('every known endpoint has a route.ts up front', () => {
    for (const p of STUBS) expect(existsSync(resolve(process.cwd(), p)), p).toBe(true);
  });
  it('the trial-signup stub returns 501', async () => {
    const mod = await import('@/app/api/public/trial/signup/route');
    const res = await mod.POST();
    expect(res.status).toBe(501);
  });
});
```

- [ ] Run and confirm PASS:
```bash
npm test src/app/api/__tests__/route-stubs.test.ts
```
Expected: `2 passed`.

- [ ] Verify the app type-checks (no build-breaking errors in the spine):
```bash
npx tsc --noEmit
```
Expected: exits `0` with no errors.

- [ ] Commit:
```bash
git add -A && git commit -m "P1 Task 7: session middleware + auth callback + api route-stub tree"
```

---

### Task 8: Migration 0001 — identity, roles, guardians + RLS helpers (LIFT 000 head + 035 trial cols + 6th role)

**Files:**
- Create: `C:/users/inteliflow/NEW-CORE/supabase/migrations/0001_identity_roles.sql`
- Test: `C:/users/inteliflow/NEW-CORE/supabase/migrations/__tests__/migrations.test.ts` (assertion block for 0001)

**Interfaces:**
- Consumes: nothing (first migration — the spine).
- Produces: `public.schools`, `public.users` (role CHECK incl. `school_sysadmin`), `public.guardians`; SECURITY DEFINER fns `is_platform_admin()`, `get_my_school_id()`, `get_teacher_class_ids(uuid)`, `get_teacher_student_ids(uuid)`, `get_student_class_ids(uuid)`. Later migrations FK back to `schools.id` / `users.id`.

NOTE: tests are static SQL-content assertions (the harness parses the `.sql` text — no live Postgres). This proves the schema/RLS contract every later plan depends on, without provisioning a DB in CI.

- [ ] Write the failing assertion block first (extend the migrations test file; create it if absent):
```ts
// supabase/migrations/__tests__/migrations.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = (f: string) =>
  readFileSync(resolve(process.cwd(), 'supabase/migrations', f), 'utf8');

describe('0001 identity_roles', () => {
  const s = () => sql('0001_identity_roles.sql');
  it('creates schools, users, guardians', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.schools/);
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.users/);
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.guardians/);
  });
  it('users.role CHECK includes all 6 roles incl. school_sysadmin (spec §1.2)', () => {
    const m = s().match(/role\s+text\s+NOT NULL\s+CHECK \(role IN \(([^)]*)\)\)/);
    expect(m).toBeTruthy();
    const list = m![1];
    for (const r of ['teacher','student','parent','school_admin','school_sysadmin','platform_admin']) {
      expect(list).toContain(`'${r}'`);
    }
  });
  it('defines the SECURITY DEFINER RLS helpers', () => {
    expect(s()).toMatch(/FUNCTION public\.is_platform_admin\(\)[\s\S]*SECURITY DEFINER/);
    expect(s()).toMatch(/FUNCTION public\.get_my_school_id\(\)[\s\S]*SECURITY DEFINER/);
    expect(s()).toMatch(/FUNCTION public\.get_teacher_class_ids\(/);
  });
  it('enables RLS and uses DROP POLICY IF EXISTS before CREATE POLICY', () => {
    expect(s()).toMatch(/ALTER TABLE public\.users ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/DROP POLICY IF EXISTS/);
  });
  it('grants ALL to authenticated, anon, service_role (Bug #7)', () => {
    expect(s()).toMatch(/GRANT ALL ON public\.users TO authenticated, anon, service_role/);
  });
});
```

- [ ] Run and confirm it FAILS:
```bash
npm test supabase/migrations/__tests__/migrations.test.ts
```
Expected FAIL: `ENOENT: no such file ... 0001_identity_roles.sql`.

- [ ] Write the migration (LIFT 000 schools/users/guardians + RLS helpers verbatim; add `school_sysadmin` to the role CHECK; fold in the 035 trial cols needed by the spine; add DROP POLICY IF EXISTS + grants):
```sql
-- supabase/migrations/0001_identity_roles.sql
-- LIFT V1 000_full_schema.sql (schools/users/guardians + RLS helpers) + 035 trial cols.
-- 6th role reconciliation (spec §1.2): V1 000 enum omitted 'school_sysadmin' though
-- V1 code (guards.ts, requireSchoolAdmin.ts) depends on it — added to the CHECK here.

-- ── Schools ──
CREATE TABLE IF NOT EXISTS public.schools (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     text NOT NULL,
  domain                   text,
  timezone                 text DEFAULT 'America/New_York',
  google_classroom_enabled boolean DEFAULT false,
  parent_profile_visible   boolean DEFAULT true,
  is_active                boolean DEFAULT true,
  welcome_completed        boolean DEFAULT false,
  -- Trial/presentation state (LIFT 035; school_licenses.status is the gating SoT, spec §2.3)
  is_trial                 boolean DEFAULT false,
  trial_started_at         timestamptz,
  trial_expires_at         timestamptz,
  trial_status             text DEFAULT 'inactive'
                           CHECK (trial_status IN ('inactive','active','expired','converted','cancelled')),
  trial_plan               text DEFAULT 'pro',
  trial_source             text,
  hl_contact_id            text,
  trial_credentials        jsonb DEFAULT '{}',
  -- Anti-piracy domain lock (LIFT 049:65)
  allowed_email_domains    jsonb DEFAULT '[]',
  created_at               timestamptz DEFAULT now()
);

-- ── Users (canonical identity; role discriminates teacher/student/parent/admin) ──
CREATE TABLE IF NOT EXISTS public.users (
  id              uuid PRIMARY KEY REFERENCES auth.users(id),
  school_id       uuid REFERENCES public.schools(id),
  role            text NOT NULL CHECK (role IN
                  ('teacher','student','parent','school_admin','school_sysadmin','platform_admin')),
  full_name       text NOT NULL,
  email           text NOT NULL,
  avatar_url      text,
  display_name    text,
  grade_levels    text,
  subjects        text,
  parent_id       uuid REFERENCES public.users(id),
  grade_level     text,
  is_active       boolean DEFAULT true,
  last_active_at  timestamptz,
  is_trial_user   boolean DEFAULT false,
  trial_school_id uuid REFERENCES public.schools(id),
  created_at      timestamptz DEFAULT now()
);

-- ── Guardians (parent ↔ student link — Parent screen has no data path without it) ──
CREATE TABLE IF NOT EXISTS public.guardians (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id  uuid NOT NULL REFERENCES public.users(id),
  student_id uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(parent_id, student_id)
);

-- ── SECURITY DEFINER RLS helpers (LIFT 000:733-759 verbatim) ──
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'platform_admin');
$$;

CREATE OR REPLACE FUNCTION public.get_my_school_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT school_id FROM public.users WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_teacher_student_ids(teacher_uuid uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT DISTINCT e.student_id FROM public.enrollments e
  JOIN public.classes c ON c.id = e.class_id
  WHERE c.teacher_id = teacher_uuid AND e.is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.get_teacher_class_ids(teacher_uuid uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM public.classes WHERE teacher_id = teacher_uuid;
$$;

CREATE OR REPLACE FUNCTION public.get_student_class_ids(student_uuid uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT class_id FROM public.enrollments WHERE student_id = student_uuid AND is_active = true;
$$;

-- ── RLS ──
ALTER TABLE public.schools   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardians ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_self_read ON public.users;
CREATE POLICY users_self_read ON public.users FOR SELECT TO authenticated
  USING (id = auth.uid() OR school_id = public.get_my_school_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS schools_member_read ON public.schools;
CREATE POLICY schools_member_read ON public.schools FOR SELECT TO authenticated
  USING (id = public.get_my_school_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS guardians_member_read ON public.guardians;
CREATE POLICY guardians_member_read ON public.guardians FOR SELECT TO authenticated
  USING (parent_id = auth.uid() OR student_id = auth.uid() OR public.is_platform_admin());

-- PostgREST grants (Bug #7 — 42501 without these)
GRANT ALL ON public.schools   TO authenticated, anon, service_role;
GRANT ALL ON public.users     TO authenticated, anon, service_role;
GRANT ALL ON public.guardians TO authenticated, anon, service_role;
```

- [ ] Run and confirm PASS:
```bash
npm test supabase/migrations/__tests__/migrations.test.ts
```
Expected: the `0001 identity_roles` block `5 passed`.

- [ ] Commit:
```bash
git add -A && git commit -m "P1 Task 8: migration 0001 identity/roles/guardians + RLS helpers (6th role reconciled)"
```

---

### Task 9: Migration 0002 — classes, enrollments + seat-enforcement trigger placeholder (LIFT 000 + 049)

**Files:**
- Create: `C:/users/inteliflow/NEW-CORE/supabase/migrations/0002_classes_enrollments.sql`
- Test: append a `0002` block to `migrations.test.ts`

**Interfaces:**
- Consumes: `schools`, `users` (0001).
- Produces: `public.classes`, `public.enrollments` (UNIQUE(class_id, student_id)) + `enforce_enrollment_limit()` SECURITY DEFINER + `trg_enforce_enrollment_limit` BEFORE INSERT trigger. The trigger references `school_licenses.student_limit WHERE status='active'` — real enforcement binds in the licensing plan; here it is a no-op until an active license exists (per 049 logic).

- [ ] Write the failing `0002` assertion block (append to `migrations.test.ts`):
```ts
describe('0002 classes_enrollments', () => {
  const s = () => sql('0002_classes_enrollments.sql');
  it('creates classes + enrollments with the unique seat key', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.classes/);
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.enrollments/);
    expect(s()).toMatch(/UNIQUE\(class_id, student_id\)/);
  });
  it('ports the seat-enforcement trigger (LIFT 049, references active license)', () => {
    expect(s()).toMatch(/FUNCTION public\.enforce_enrollment_limit\(\)[\s\S]*SECURITY DEFINER/);
    expect(s()).toMatch(/status = 'active'/);
    expect(s()).toMatch(/CREATE TRIGGER trg_enforce_enrollment_limit\s+BEFORE INSERT ON public\.enrollments/);
  });
  it('enables RLS + grants', () => {
    expect(s()).toMatch(/ALTER TABLE public\.enrollments ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/GRANT ALL ON public\.enrollments TO authenticated, anon, service_role/);
  });
});
```

- [ ] Run and confirm it FAILS:
```bash
npm test supabase/migrations/__tests__/migrations.test.ts
```
Expected FAIL: `ENOENT ... 0002_classes_enrollments.sql`.

- [ ] Write the migration (LIFT 000 classes/enrollments + 049 seat trigger verbatim):
```sql
-- supabase/migrations/0002_classes_enrollments.sql
-- LIFT V1 000 (classes, enrollments) + 049 seat-enforcement trigger.
-- The trigger reads school_licenses.student_limit (created in 0007) — guarded by
-- IF v_limit IS NULL THEN RETURN NEW, so it is inert until an active license exists
-- (a Pro trial is status='trialing', so the cap binds only after conversion).

CREATE TABLE IF NOT EXISTS public.classes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL REFERENCES public.schools(id),
  teacher_id       uuid REFERENCES public.users(id),
  name             text NOT NULL,
  subject          text,
  grade_level      text,
  period           text,
  google_course_id text,
  google_grade_sync_enabled boolean DEFAULT false,
  google_feed_enabled       boolean DEFAULT false,
  enrollment_count int DEFAULT 0,
  is_active        boolean DEFAULT true,
  created_at       timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.enrollments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id    uuid NOT NULL REFERENCES public.classes(id),
  student_id  uuid NOT NULL REFERENCES public.users(id),
  enrolled_at timestamptz DEFAULT now(),
  is_active   boolean DEFAULT true,
  UNIQUE(class_id, student_id)
);

-- ── Seat enforcement (LIFT 049:169-222 verbatim) ──
CREATE OR REPLACE FUNCTION public.enforce_enrollment_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_school_id uuid; v_current_count integer; v_limit integer;
BEGIN
  SELECT school_id INTO v_school_id FROM public.users WHERE id = NEW.student_id;
  IF v_school_id IS NULL THEN RETURN NEW; END IF;
  SELECT student_limit INTO v_limit FROM public.school_licenses
   WHERE school_id = v_school_id AND status = 'active' LIMIT 1;
  IF v_limit IS NULL THEN RETURN NEW; END IF; -- no active license = trial/pilot, no enforcement
  SELECT COUNT(DISTINCT u.id) INTO v_current_count
    FROM public.users u JOIN public.enrollments e ON e.student_id = u.id
   WHERE u.school_id = v_school_id AND u.role = 'student' AND u.is_active = true;
  IF v_current_count >= v_limit THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.enrollments e2 JOIN public.users u2 ON u2.id = e2.student_id
       WHERE u2.school_id = v_school_id AND e2.student_id = NEW.student_id
    ) THEN
      RAISE EXCEPTION 'Enrollment limit reached: school has % students, license allows %', v_current_count, v_limit
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_enrollment_limit ON public.enrollments;
CREATE TRIGGER trg_enforce_enrollment_limit
  BEFORE INSERT ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_enrollment_limit();

-- ── RLS ──
ALTER TABLE public.classes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS classes_school_read ON public.classes;
CREATE POLICY classes_school_read ON public.classes FOR SELECT TO authenticated
  USING (teacher_id = auth.uid() OR school_id = public.get_my_school_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS enrollments_school_read ON public.enrollments;
CREATE POLICY enrollments_school_read ON public.enrollments FOR SELECT TO authenticated
  USING (class_id IN (SELECT public.get_teacher_class_ids(auth.uid()))
         OR student_id = auth.uid() OR public.is_platform_admin());

GRANT ALL ON public.classes     TO authenticated, anon, service_role;
GRANT ALL ON public.enrollments TO authenticated, anon, service_role;
```

- [ ] Run and confirm PASS:
```bash
npm test supabase/migrations/__tests__/migrations.test.ts
```
Expected: the `0002 classes_enrollments` block `3 passed`.

- [ ] Commit:
```bash
git add -A && git commit -m "P1 Task 9: migration 0002 classes/enrollments + seat trigger (LIFT 049)"
```

---

### Task 10: Migration 0003 — lessons, quizzes, quiz_questions, quiz_attempts, quiz_responses (LIFT 000)

**Files:**
- Create: `C:/users/inteliflow/NEW-CORE/supabase/migrations/0003_lessons_quizzes.sql`
- Test: append a `0003` block to `migrations.test.ts`

**Interfaces:**
- Consumes: `schools`, `users`, `classes` (0001/0002).
- Produces: `public.lessons` (status CHECK gate), `public.quizzes`, `public.quiz_questions` (question_type CHECK `mcq|open`, `concept_tag`), `public.quiz_attempts` (mastery_band CHECK `reteach|grade_level|advanced`), `public.quiz_responses` (cognitive + behavioral telemetry columns).

- [ ] Write the failing `0003` assertion block (append):
```ts
describe('0003 lessons_quizzes', () => {
  const s = () => sql('0003_lessons_quizzes.sql');
  it('creates the 5 tables', () => {
    for (const t of ['lessons','quizzes','quiz_questions','quiz_attempts','quiz_responses']) {
      expect(s()).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}`));
    }
  });
  it('uses the real V1 enums (lesson status, question_type, mastery_band)', () => {
    expect(s()).toMatch(/status\s+text\s+DEFAULT 'draft' CHECK \(status IN \('draft','pending_review','approved','published','archived'\)\)/);
    expect(s()).toMatch(/question_type\s+text NOT NULL CHECK \(question_type IN \('mcq','open'\)\)/);
    expect(s()).toMatch(/mastery_band\s+text\s+CHECK \(mastery_band IN \('reteach','grade_level','advanced'\)\)/);
  });
  it('quiz_responses carries the cognitive + behavioral telemetry columns', () => {
    for (const c of ['cognitive_notes','response_time_ms','hesitation_ms','answer_changes','navigation_backs','pause_count','total_pause_ms','word_count']) {
      expect(s()).toContain(c);
    }
  });
  it('enables RLS + grants on quiz_responses', () => {
    expect(s()).toMatch(/ALTER TABLE public\.quiz_responses ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/GRANT ALL ON public\.quiz_responses TO authenticated, anon, service_role/);
  });
});
```

- [ ] Run and confirm it FAILS:
```bash
npm test supabase/migrations/__tests__/migrations.test.ts
```
Expected FAIL: `ENOENT ... 0003_lessons_quizzes.sql`.

- [ ] Write the migration (LIFT 000:98-181 verbatim — real column names + enums):
```sql
-- supabase/migrations/0003_lessons_quizzes.sql
-- LIFT V1 000_full_schema.sql (lessons, quizzes, quiz_questions, quiz_attempts, quiz_responses).
-- Quiz chain stays SEPARATE from the assignment chain so the Assignment-vs-Quiz gap signal works.

CREATE TABLE IF NOT EXISTS public.lessons (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id       uuid NOT NULL REFERENCES public.classes(id),
  teacher_id     uuid NOT NULL REFERENCES public.users(id),
  title          text,
  file_name      text,
  file_url       text,
  file_type      text,
  parsed_content jsonb,
  grade_level    text,
  subject        text,
  status         text DEFAULT 'draft' CHECK (status IN ('draft','pending_review','approved','published','archived')),
  version        int  DEFAULT 1,
  created_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.quizzes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id      uuid REFERENCES public.lessons(id),
  class_id       uuid NOT NULL REFERENCES public.classes(id),
  teacher_id     uuid NOT NULL REFERENCES public.users(id),
  title          text,
  status         text DEFAULT 'draft' CHECK (status IN ('draft','pending_review','approved','published','archived')),
  rubric_version text DEFAULT '1.0',
  teacher_notes  text,
  published_at   timestamptz,
  created_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.quiz_questions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id        uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  position       int  NOT NULL,
  question_type  text NOT NULL CHECK (question_type IN ('mcq','open')),
  question_text  text NOT NULL,
  choices        jsonb,
  correct_answer text,
  rubric         text,
  concept_tag    text,
  created_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.quiz_attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id        uuid NOT NULL REFERENCES public.quizzes(id),
  student_id     uuid NOT NULL REFERENCES public.users(id),
  session_id     text,
  started_at     timestamptz DEFAULT now(),
  submitted_at   timestamptz,
  is_complete    boolean DEFAULT false,
  raw_score      numeric,
  score_pct      numeric,
  mastery_band   text CHECK (mastery_band IN ('reteach','grade_level','advanced')),
  learning_style text,
  created_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.quiz_responses (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id           uuid NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  question_id          uuid REFERENCES public.quiz_questions(id),
  position             int  NOT NULL,
  response_text        text,
  is_correct           boolean,
  ai_score             numeric,
  ai_score_explanation text,
  cognitive_notes      text,          -- FERPA-sensitive (spec §1.10)
  question_type_scored text,
  rubric_version       text,
  grader_source        text DEFAULT 'ai',
  confidence           numeric,
  response_time_ms     int DEFAULT 0,
  hesitation_ms        int DEFAULT 0,
  answer_changes       int DEFAULT 0,
  navigation_backs     int DEFAULT 0,
  pause_count          int DEFAULT 0,
  total_pause_ms       int DEFAULT 0,
  word_count           int DEFAULT 0,
  created_at           timestamptz DEFAULT now()
);

-- ── RLS ──
ALTER TABLE public.lessons        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quizzes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lessons_school_read ON public.lessons;
CREATE POLICY lessons_school_read ON public.lessons FOR SELECT TO authenticated
  USING (teacher_id = auth.uid()
         OR class_id IN (SELECT public.get_teacher_class_ids(auth.uid()))
         OR class_id IN (SELECT public.get_student_class_ids(auth.uid()))
         OR public.is_platform_admin());

DROP POLICY IF EXISTS quiz_attempts_owner_read ON public.quiz_attempts;
CREATE POLICY quiz_attempts_owner_read ON public.quiz_attempts FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS quiz_responses_owner_read ON public.quiz_responses;
CREATE POLICY quiz_responses_owner_read ON public.quiz_responses FOR SELECT TO authenticated
  USING (attempt_id IN (SELECT id FROM public.quiz_attempts WHERE student_id = auth.uid())
         OR public.is_platform_admin());

GRANT ALL ON public.lessons        TO authenticated, anon, service_role;
GRANT ALL ON public.quizzes        TO authenticated, anon, service_role;
GRANT ALL ON public.quiz_questions TO authenticated, anon, service_role;
GRANT ALL ON public.quiz_attempts  TO authenticated, anon, service_role;
GRANT ALL ON public.quiz_responses TO authenticated, anon, service_role;
```

- [ ] Run and confirm PASS:
```bash
npm test supabase/migrations/__tests__/migrations.test.ts
```
Expected: the `0003 lessons_quizzes` block `4 passed`.

- [ ] Commit:
```bash
git add -A && git commit -m "P1 Task 10: migration 0003 lessons/quizzes/responses (LIFT 000)"
```

---

### Task 11: Migration 0004 — assignments + homework_attempts (LIFT 000)

**Files:**
- Create: `C:/users/inteliflow/NEW-CORE/supabase/migrations/0004_assignments_homework.sql`
- Test: append a `0004` block to `migrations.test.ts`

**Interfaces:**
- Consumes: `quiz_attempts`, `users`, `classes`, `lessons` (0002/0003).
- Produces: `public.assignments` (mastery_band enum, `content jsonb NOT NULL`, `teacher_reviewed`, `scaffold_level`, `due_at`), `public.homework_attempts` (the graded artifact feeding the gap signal: `responses`, `score_pct`, `ai_feedback`, `teli_hint_count`, `submitted_on_time`).

- [ ] Write the failing `0004` assertion block (append):
```ts
describe('0004 assignments_homework', () => {
  const s = () => sql('0004_assignments_homework.sql');
  it('creates assignments + homework_attempts', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.assignments/);
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.homework_attempts/);
  });
  it('assignments has content NOT NULL + mastery_band enum', () => {
    expect(s()).toMatch(/content\s+jsonb\s+NOT NULL/);
    expect(s()).toMatch(/mastery_band\s+text\s+CHECK \(mastery_band IN \('reteach','grade_level','advanced'\)\)/);
  });
  it('homework_attempts carries the gap-signal columns', () => {
    for (const c of ['score_pct','ai_feedback','teli_hint_count','submitted_on_time']) {
      expect(s()).toContain(c);
    }
  });
  it('enables RLS + grants', () => {
    expect(s()).toMatch(/ALTER TABLE public\.homework_attempts ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/GRANT ALL ON public\.assignments TO authenticated, anon, service_role/);
  });
});
```

- [ ] Run and confirm it FAILS:
```bash
npm test supabase/migrations/__tests__/migrations.test.ts
```
Expected FAIL: `ENOENT ... 0004_assignments_homework.sql`.

- [ ] Write the migration (LIFT 000:184-230 verbatim):
```sql
-- supabase/migrations/0004_assignments_homework.sql
-- LIFT V1 000 (assignments + homework_attempts). skill_ids[] is added in 0005 (LIFT 071).

CREATE TABLE IF NOT EXISTS public.assignments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_attempt_id         uuid REFERENCES public.quiz_attempts(id),
  student_id              uuid NOT NULL REFERENCES public.users(id),
  class_id                uuid NOT NULL REFERENCES public.classes(id),
  lesson_id               uuid REFERENCES public.lessons(id),
  mastery_band            text CHECK (mastery_band IN ('reteach','grade_level','advanced')),
  assignment_mode         text DEFAULT 'standard',
  learning_style          text,
  content                 jsonb NOT NULL,
  status                  text DEFAULT 'draft',
  teacher_reviewed        boolean DEFAULT false,
  teacher_override_reason text,
  push_status             text DEFAULT 'pending',
  reteach_needed          boolean DEFAULT false,
  scaffold_level          text,
  due_at                  timestamptz,
  created_at              timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.homework_attempts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id     uuid NOT NULL REFERENCES public.assignments(id),
  student_id        uuid NOT NULL REFERENCES public.users(id),
  status            text DEFAULT 'in_progress',
  responses         jsonb,
  canvas_data       jsonb,
  score_pct         numeric,
  ai_feedback       jsonb,
  teacher_notes     text,
  teacher_score     numeric,
  teli_hint_count   int DEFAULT 0,
  submitted_on_time boolean,
  submitted_at      timestamptz,
  graded_at         timestamptz,
  created_at        timestamptz DEFAULT now()
);

-- ── RLS ──
ALTER TABLE public.assignments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assignments_scoped_read ON public.assignments;
CREATE POLICY assignments_scoped_read ON public.assignments FOR SELECT TO authenticated
  USING (student_id = auth.uid()
         OR class_id IN (SELECT public.get_teacher_class_ids(auth.uid()))
         OR public.is_platform_admin());

DROP POLICY IF EXISTS homework_attempts_owner_read ON public.homework_attempts;
CREATE POLICY homework_attempts_owner_read ON public.homework_attempts FOR SELECT TO authenticated
  USING (student_id = auth.uid()
         OR assignment_id IN (SELECT id FROM public.assignments
              WHERE class_id IN (SELECT public.get_teacher_class_ids(auth.uid())))
         OR public.is_platform_admin());

GRANT ALL ON public.assignments       TO authenticated, anon, service_role;
GRANT ALL ON public.homework_attempts TO authenticated, anon, service_role;
```

- [ ] Run and confirm PASS:
```bash
npm test supabase/migrations/__tests__/migrations.test.ts
```
Expected: the `0004 assignments_homework` block `4 passed`.

- [ ] Commit:
```bash
git add -A && git commit -m "P1 Task 11: migration 0004 assignments/homework (LIFT 000)"
```

---

### Task 12: Migration 0005 — skills_registry + skill_learning_state (6-state) + linkage (LIFT 071 + 072)

**Files:**
- Create: `C:/users/inteliflow/NEW-CORE/supabase/migrations/0005_skills.sql`
- Test: append a `0005` block to `migrations.test.ts`

**Interfaces:**
- Consumes: `schools`, `users`, `quiz_questions`, `assignments` (0001/0003/0004).
- Produces: `public.skills` (per-school registry, COALESCE unique index), `quiz_questions.skill_id` + `assignments.skill_ids uuid[]` linkage columns, `public.skill_learning_state` (the 6-value CHECK + UNIQUE(student_id, skill_id) + idempotent CHECK re-add). Service-role-only writes; students/parents never read `skill_learning_state` (observational-not-diagnostic).

- [ ] Write the failing `0005` assertion block (append):
```ts
describe('0005 skills', () => {
  const s = () => sql('0005_skills.sql');
  it('creates skills + skill_learning_state + linkage columns', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.skills/);
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.skill_learning_state/);
    expect(s()).toMatch(/ALTER TABLE public\.quiz_questions[\s\S]*ADD COLUMN IF NOT EXISTS skill_id/);
    expect(s()).toMatch(/ALTER TABLE public\.assignments[\s\S]*ADD COLUMN IF NOT EXISTS skill_ids uuid\[\]/);
  });
  it('skill_learning_state CHECK carries exactly the 6 states', () => {
    for (const st of ['needs_different_instruction','needs_more_time','on_track','ready_to_extend','insufficient_data','not_attempted']) {
      expect(s()).toContain(`'${st}'`);
    }
    expect(s()).toMatch(/UNIQUE \(student_id, skill_id\)/);
  });
  it('keeps the idempotent CHECK re-add (072:68-78)', () => {
    expect(s()).toMatch(/DROP CONSTRAINT IF EXISTS skill_learning_state_state_check/);
    expect(s()).toMatch(/ADD CONSTRAINT skill_learning_state_state_check CHECK/);
  });
  it('skill_learning_state is service-role-write only (no authenticated write policy)', () => {
    expect(s()).not.toMatch(/CREATE POLICY[^\n]*skill_learning_state[^\n]*FOR INSERT TO authenticated/);
    expect(s()).toMatch(/GRANT ALL ON public\.skill_learning_state TO authenticated, anon, service_role/);
  });
});
```

- [ ] Run and confirm it FAILS:
```bash
npm test supabase/migrations/__tests__/migrations.test.ts
```
Expected FAIL: `ENOENT ... 0005_skills.sql`.

- [ ] Write the migration (LIFT 071 + 072 verbatim — keep the COALESCE unique index + the idempotent CHECK re-add):
```sql
-- supabase/migrations/0005_skills.sql
-- LIFT V1 071_skills_registry.sql + 072_skill_learning_state.sql verbatim.
-- Per-skill state is a LIFT, not net-new (spec §1.2 correction). 6-state vocabulary.

-- ── Skills registry (LIFT 071) ──
CREATE TABLE IF NOT EXISTS public.skills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  subject     text,
  name        text NOT NULL,
  slug        text NOT NULL,
  aliases     jsonb NOT NULL DEFAULT '[]',
  status      text NOT NULL DEFAULT 'unreviewed'
              CHECK (status IN ('unreviewed','active','merged','retired')),
  merged_into uuid REFERENCES public.skills(id),
  created_by  text NOT NULL DEFAULT 'ai' CHECK (created_by IN ('ai','teacher','backfill')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_skills_school_subject_slug
  ON public.skills (school_id, COALESCE(subject, ''), slug);
CREATE INDEX IF NOT EXISTS idx_skills_school ON public.skills(school_id);

-- ── Linkage columns (LIFT 071:56-66) ──
ALTER TABLE public.quiz_questions ADD COLUMN IF NOT EXISTS skill_id uuid REFERENCES public.skills(id);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_skill ON public.quiz_questions(skill_id);
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS skill_ids uuid[] NOT NULL DEFAULT '{}';

-- ── Per-(student, skill) learning state (LIFT 072) ──
CREATE TABLE IF NOT EXISTS public.skill_learning_state (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  school_id            uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  skill_id             uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  state                text NOT NULL CHECK (state IN (
                         'needs_different_instruction','needs_more_time','on_track',
                         'ready_to_extend','insufficient_data','not_attempted')),
  confidence           numeric NOT NULL DEFAULT 0,    -- 0-100, soft words only
  observation_count    int     NOT NULL DEFAULT 0,
  evidence             jsonb   NOT NULL DEFAULT '{}',
  last_reteach_outcome text,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, skill_id)
);
CREATE INDEX IF NOT EXISTS idx_sls_student ON public.skill_learning_state(student_id);
CREATE INDEX IF NOT EXISTS idx_sls_skill   ON public.skill_learning_state(skill_id);
CREATE INDEX IF NOT EXISTS idx_sls_school  ON public.skill_learning_state(school_id);

-- ── RLS (skills: same-school read; sls: same-school staff read, service-role write only) ──
ALTER TABLE public.skills               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_learning_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS skills_school_read ON public.skills;
CREATE POLICY skills_school_read ON public.skills FOR SELECT TO authenticated
  USING (school_id = public.get_my_school_id() OR public.is_platform_admin());

-- Students/parents never read this table (no diagnostic surface student-side).
DROP POLICY IF EXISTS sls_school_read ON public.skill_learning_state;
CREATE POLICY sls_school_read ON public.skill_learning_state FOR SELECT TO authenticated
  USING (school_id = public.get_my_school_id() OR public.is_platform_admin());

GRANT ALL ON public.skills               TO authenticated, anon, service_role;
GRANT ALL ON public.skill_learning_state TO authenticated, anon, service_role;

-- ── Idempotent CHECK refresh (LIFT 072:68-78) — keeps the 6-state version re-runnable ──
ALTER TABLE public.skill_learning_state DROP CONSTRAINT IF EXISTS skill_learning_state_state_check;
ALTER TABLE public.skill_learning_state ADD CONSTRAINT skill_learning_state_state_check CHECK (state IN (
  'needs_different_instruction','needs_more_time','on_track',
  'ready_to_extend','insufficient_data','not_attempted'));
```

- [ ] Run and confirm PASS:
```bash
npm test supabase/migrations/__tests__/migrations.test.ts
```
Expected: the `0005 skills` block `4 passed`.

- [ ] Commit:
```bash
git add -A && git commit -m "P1 Task 12: migration 0005 skills + skill_learning_state (LIFT 071/072)"
```

---

### Task 13: Migration 0006 — weekly snapshots (LIFT 046)

**Files:**
- Create: `C:/users/inteliflow/NEW-CORE/supabase/migrations/0006_snapshots.sql`
- Test: append a `0006` block to `migrations.test.ts`

**Interfaces:**
- Consumes: `users`, `schools` (0001).
- Produces: `public.student_model_snapshots` (per `(student_id, snapshot_date)`, the trajectory grain) with the six signal fields the historical classifier reads + `snapshot_schema_version` stamp. Written by the weekly-snapshot cron (later plan); schema-only here.

- [ ] Write the failing `0006` assertion block (append):
```ts
describe('0006 snapshots', () => {
  const s = () => sql('0006_snapshots.sql');
  it('creates student_model_snapshots with the trajectory grain', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.student_model_snapshots/);
    expect(s()).toMatch(/student_id\s+uuid/);
    expect(s()).toMatch(/snapshot_date\s+date/);
  });
  it('carries the six signal fields + schema-version stamp', () => {
    for (const c of ['risk_score','avg_hints_per_attempt','divergence_direction','divergence_score','recent_effort_labels','snapshot_schema_version']) {
      expect(s()).toContain(c);
    }
  });
  it('enables RLS + grants', () => {
    expect(s()).toMatch(/ALTER TABLE public\.student_model_snapshots ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/GRANT ALL ON public\.student_model_snapshots TO authenticated, anon, service_role/);
  });
});
```

- [ ] Run and confirm it FAILS:
```bash
npm test supabase/migrations/__tests__/migrations.test.ts
```
Expected FAIL: `ENOENT ... 0006_snapshots.sql`.

- [ ] Write the migration (LIFT 046 schema — per-student-per-week; the six signal fields + version stamp + per-student DESC index):
```sql
-- supabase/migrations/0006_snapshots.sql
-- LIFT V1 046_snapshot_schema_v2.sql (student_model_snapshots). Trajectory grain =
-- per (student, week). Weekly write job is a later-plan cron, idempotent per (student, week).
-- "<4 weeks of data" is the cold-start empty state for the "you vs 4 weeks ago" UI.

CREATE TABLE IF NOT EXISTS public.student_model_snapshots (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id              uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  school_id               uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id                uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  snapshot_date           date NOT NULL,
  -- six signal fields the historical classifier reads (046:29-42)
  risk_score              numeric,
  avg_hints_per_attempt   numeric,
  divergence_direction    text,
  divergence_score        numeric,
  recent_effort_labels    jsonb DEFAULT '[]',
  mastery_band            text CHECK (mastery_band IN ('reteach','grade_level','advanced')),
  snapshot_schema_version text CHECK (snapshot_schema_version IS NULL
                            OR snapshot_schema_version IN ('v1','v2')),
  created_at              timestamptz DEFAULT now(),
  UNIQUE (student_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_sms_student_date
  ON public.student_model_snapshots (student_id, snapshot_date DESC)
  WHERE snapshot_schema_version = 'v2';

-- ── RLS ──
ALTER TABLE public.student_model_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sms_scoped_read ON public.student_model_snapshots;
CREATE POLICY sms_scoped_read ON public.student_model_snapshots FOR SELECT TO authenticated
  USING (student_id = auth.uid()
         OR school_id = public.get_my_school_id()
         OR public.is_platform_admin());

GRANT ALL ON public.student_model_snapshots TO authenticated, anon, service_role;
```

- [ ] Run and confirm PASS:
```bash
npm test supabase/migrations/__tests__/migrations.test.ts
```
Expected: the `0006 snapshots` block `3 passed`.

- [ ] Commit:
```bash
git add -A && git commit -m "P1 Task 13: migration 0006 weekly snapshots (LIFT 046)"
```

---

### Task 14: Migration 0007 — licensing tables with tier-enum reconciliation (LIFT 020 + 049)

**Files:**
- Create: `C:/users/inteliflow/NEW-CORE/supabase/migrations/0007_licensing.sql`
- Test: append a `0007` block to `migrations.test.ts`

**Interfaces:**
- Consumes: `schools`, `users` (0001).
- Produces: `public.school_licenses` (UNIQUE(school_id), `tier 'professional'` canonical, `status` gating SoT, reserved Stripe columns, `feature_overrides`/`feature_blocks`), `public.license_keys` (HMAC burn ledger — tier CHECK reconciled to `'professional'` per spec §2.3), `public.license_events`. Schema only — activation/gating logic is the licensing plan.

NOTE: spec §2.3 — `school_licenses.tier` uses `'professional'` (020) but `license_keys.tier` used `'pro'` (049). P1 picks `'professional'` as canonical and corrects the `license_keys` CHECK here. Do not carry both.

- [ ] Write the failing `0007` assertion block (append):
```ts
describe('0007 licensing', () => {
  const s = () => sql('0007_licensing.sql');
  it('creates the three licensing tables', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.school_licenses/);
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.license_keys/);
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.license_events/);
  });
  it('school_licenses is one-per-school with the status gating enum', () => {
    expect(s()).toMatch(/school_id\s+uuid\s+NOT NULL REFERENCES public\.schools\(id\) UNIQUE/);
    expect(s()).toMatch(/status\s+text\s+NOT NULL CHECK \(status IN \('trialing','active','past_due','suspended','cancelled'\)\)/);
  });
  it('reconciles tier to professional on BOTH tables (spec §2.3 — no bare pro)', () => {
    expect(s()).toMatch(/tier\s+text\s+NOT NULL CHECK \(tier IN \('essentials','professional','enterprise'\)\)/);
    expect(s()).not.toMatch(/CHECK \(tier IN \('essentials', 'pro', 'enterprise'\)\)/);
  });
  it('keeps reserved Stripe columns + override/block jsonb', () => {
    for (const c of ['stripe_customer_id','stripe_subscription_id','feature_overrides','feature_blocks']) {
      expect(s()).toContain(c);
    }
  });
  it('enables RLS + grants', () => {
    expect(s()).toMatch(/ALTER TABLE public\.school_licenses ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/GRANT ALL ON public\.license_keys TO authenticated, anon, service_role/);
  });
});
```

- [ ] Run and confirm it FAILS:
```bash
npm test supabase/migrations/__tests__/migrations.test.ts
```
Expected FAIL: `ENOENT ... 0007_licensing.sql`.

- [ ] Write the migration (LIFT 020 school_licenses/license_events + 049 license_keys; reconcile tier enum to `'professional'`):
```sql
-- supabase/migrations/0007_licensing.sql
-- LIFT V1 020_licensing.sql (school_licenses, license_events) + 049 (license_keys).
-- TIER-ENUM RECONCILIATION (spec §2.3): 'professional' is canonical on BOTH tables
-- (020 used 'professional'; 049 used 'pro' — corrected here so activation doesn't 400).
-- No business logic here — gating/activation lives in the licensing plan.

CREATE TABLE IF NOT EXISTS public.school_licenses (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id              uuid NOT NULL REFERENCES public.schools(id) UNIQUE,
  tier                   text NOT NULL CHECK (tier IN ('essentials','professional','enterprise')),
  status                 text NOT NULL CHECK (status IN ('trialing','active','past_due','suspended','cancelled')),
  student_limit          int  NOT NULL DEFAULT 300,
  trial_starts_at        timestamptz,
  trial_ends_at          timestamptz,
  trial_converted        bool DEFAULT false,
  starts_at              timestamptz,
  ends_at                timestamptz,
  renewal_date           timestamptz,
  setup_fee_paid         bool DEFAULT false,
  setup_fee_amount       int  DEFAULT 1500000,
  stripe_customer_id     text,           -- RESERVED: no code path may assume populated
  stripe_subscription_id text,           -- RESERVED
  billing_cycle          text CHECK (billing_cycle IN ('annual','biannual')),
  feature_overrides      jsonb DEFAULT '{}'::jsonb,
  feature_blocks         jsonb DEFAULT '{}'::jsonb,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.license_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  tier text NOT NULL CHECK (tier IN ('essentials','professional','enterprise')),  -- reconciled (was 'pro')
  student_limit integer NOT NULL CHECK (student_limit > 0),
  duration_months integer NOT NULL DEFAULT 12 CHECK (duration_months > 0),
  issued_to_school_id uuid REFERENCES public.schools(id) ON DELETE SET NULL,
  issued_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  activated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','expired','revoked')),
  signature text NOT NULL,             -- HMAC-SHA256 truncated; verified at activation
  notes text,
  allowed_email_domains jsonb DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_license_keys_school  ON public.license_keys(issued_to_school_id);
CREATE INDEX IF NOT EXISTS idx_license_keys_status  ON public.license_keys(status);
CREATE INDEX IF NOT EXISTS idx_license_keys_expires ON public.license_keys(expires_at);

ALTER TABLE public.school_licenses
  ADD COLUMN IF NOT EXISTS activated_via_key_id uuid REFERENCES public.license_keys(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.license_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES public.schools(id),
  event_type   text NOT NULL,
  old_tier     text, new_tier text,
  old_status   text, new_status text,
  metadata     jsonb DEFAULT '{}'::jsonb,
  triggered_by uuid,
  created_at   timestamptz DEFAULT now()
);

-- ── RLS ──
ALTER TABLE public.school_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_keys    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_events  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS school_licenses_platform_all ON public.school_licenses;
CREATE POLICY school_licenses_platform_all ON public.school_licenses FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
DROP POLICY IF EXISTS school_licenses_member_read ON public.school_licenses;
CREATE POLICY school_licenses_member_read ON public.school_licenses FOR SELECT TO authenticated
  USING (school_id = public.get_my_school_id());

DROP POLICY IF EXISTS license_keys_platform_all ON public.license_keys;
CREATE POLICY license_keys_platform_all ON public.license_keys FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS license_events_platform_all ON public.license_events;
CREATE POLICY license_events_platform_all ON public.license_events FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
DROP POLICY IF EXISTS license_events_member_read ON public.license_events;
CREATE POLICY license_events_member_read ON public.license_events FOR SELECT TO authenticated
  USING (school_id = public.get_my_school_id());

GRANT ALL ON public.school_licenses TO authenticated, anon, service_role;
GRANT ALL ON public.license_keys    TO authenticated, anon, service_role;
GRANT ALL ON public.license_events  TO authenticated, anon, service_role;
```

- [ ] Run and confirm PASS:
```bash
npm test supabase/migrations/__tests__/migrations.test.ts
```
Expected: the `0007 licensing` block `5 passed`.

- [ ] Commit:
```bash
git add -A && git commit -m "P1 Task 14: migration 0007 licensing tables (tier-enum reconciled to professional)"
```

---

### Task 15: Migration 0008 — platform_events (media-meter substrate) + platform_links (LIFT 034 + NEW)

**Files:**
- Create: `C:/users/inteliflow/NEW-CORE/supabase/migrations/0008_platform.sql`
- Test: append a `0008` block to `migrations.test.ts`

**Interfaces:**
- Consumes: `schools`, `users` (0001).
- Produces: `public.platform_events` (the `{source, event_type, school_id, student_id, payload}` media-metering store later plans count rows in), `public.platform_links` (rename/generalization of V1 `platform_api_keys` with the §7 GA-rework columns `key_version`/`rotated_at`/`expires_at`; product CHECK keeps only `'spark'` + `'custom'`, drops `'lift'`/`'pulse'`). Schema only — metering counting + Spark wire logic are later plans.

- [ ] Write the failing `0008` assertion block (append):
```ts
describe('0008 platform', () => {
  const s = () => sql('0008_platform.sql');
  it('creates platform_events + platform_links', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.platform_events/);
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.platform_links/);
  });
  it('platform_events carries the metering shape', () => {
    for (const c of ['source','event_type','school_id','student_id','payload']) {
      expect(s()).toContain(c);
    }
  });
  it('platform_links keeps the spark product + adds GA-rework key columns', () => {
    expect(s()).toMatch(/product\s+text[^\n]*CHECK \(product IN \('spark','custom'\)\)/);
    for (const c of ['api_key','core_base_url','key_version','rotated_at','expires_at']) {
      expect(s()).toContain(c);
    }
    expect(s()).toMatch(/UNIQUE \(school_id, product\)/);
  });
  it('enables RLS + grants', () => {
    expect(s()).toMatch(/ALTER TABLE public\.platform_events ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/GRANT ALL ON public\.platform_links TO authenticated, anon, service_role/);
  });
});
```

- [ ] Run and confirm it FAILS:
```bash
npm test supabase/migrations/__tests__/migrations.test.ts
```
Expected FAIL: `ENOENT ... 0008_platform.sql`.

- [ ] Write the migration (LIFT 034 platform_events + platform_api_keys → platform_links rename/amend):
```sql
-- supabase/migrations/0008_platform.sql
-- LIFT V1 034_platform_api.sql: platform_events (media-meter substrate) +
-- platform_api_keys -> platform_links (rename + spec §7 GA-rework columns).
-- Schema only — metering counting and Spark wire logic are later-plan deliverables.

-- ── platform_events: each metered call inserts a row; checkUsageCap counts rows ──
CREATE TABLE IF NOT EXISTS public.platform_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source     text NOT NULL,         -- e.g. 'tts'|'whisper'|'flux'|'runway'|'teli_chat'
  event_type text,
  school_id  uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  payload    jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_events_meter
  ON public.platform_events (school_id, source, created_at);

-- ── platform_links: generalization of V1 platform_api_keys ──
CREATE TABLE IF NOT EXISTS public.platform_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  product       text NOT NULL CHECK (product IN ('spark','custom')),  -- dropped 'lift'/'pulse'
  api_key       text NOT NULL,
  label         text,
  core_base_url text,
  enabled       boolean DEFAULT true,   -- was is_active in V1
  key_version   int DEFAULT 1,          -- NEW (§7 GA rework)
  rotated_at    timestamptz,            -- NEW
  expires_at    timestamptz,            -- NEW
  last_used_at  timestamptz,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (school_id, product)
);

-- ── RLS (both deny-by-default to clients; service role + platform admin only) ──
ALTER TABLE public.platform_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_links  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_events_platform_all ON public.platform_events;
CREATE POLICY platform_events_platform_all ON public.platform_events FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS platform_links_platform_all ON public.platform_links;
CREATE POLICY platform_links_platform_all ON public.platform_links FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

GRANT ALL ON public.platform_events TO authenticated, anon, service_role;
GRANT ALL ON public.platform_links  TO authenticated, anon, service_role;
```

- [ ] Run and confirm PASS:
```bash
npm test supabase/migrations/__tests__/migrations.test.ts
```
Expected: the `0008 platform` block `4 passed`; whole migrations suite green.

- [ ] Commit:
```bash
git add -A && git commit -m "P1 Task 15: migration 0008 platform_events + platform_links (LIFT 034 + GA cols)"
```

---

### Task 16: Eval-rig harness — types, empty corpus, runner with MIN_TUPLES gate, CI entry

**Files:**
- Create: `C:/users/inteliflow/NEW-CORE/scripts/eval/types.ts` (LIFT V1 verbatim)
- Create: `C:/users/inteliflow/NEW-CORE/scripts/eval/corpus/{grading,quiz-generation,homework-generation,spark-generation,spark-rubric,learner-profile}.json`
- Create: `C:/users/inteliflow/NEW-CORE/scripts/eval/runner.ts`
- Create: `C:/users/inteliflow/NEW-CORE/scripts/eval/ci.ts`
- Test: `C:/users/inteliflow/NEW-CORE/scripts/eval/__tests__/runner.test.ts`

**Interfaces:**
- Consumes: `EvalScope`, `ALL_SCOPES`, `EvalTuple`, `RunReport` (`types.ts`).
- Produces:
  - `MIN_TUPLES = 50` constant (V1's "activates at ≥50 tuples/scope")
  - `loadCorpus(scope: EvalScope): EvalTuple[]`
  - `runScope(scope: EvalScope, invokeCandidate?): RunReport` — short-circuits with `gate: 'pass'`, `gate_reason: 'corpus too small'` when `total_tuples < MIN_TUPLES`
  - `runAll(invokeCandidate?): RunReport[]`
  - `ci.ts` default entry exiting 0 on all-pass (incl. corpus-too-small) and 1 on regression

NOTE: `invokeCandidate` is optional and unused now — wired against import-safe `src/lib/engine/*` functions in a later plan (spec §1.11/§3.4). The harness must run green today with an empty corpus.

- [ ] Write the failing harness test (proves run + short-circuit):
```ts
// scripts/eval/__tests__/runner.test.ts
import { describe, it, expect } from 'vitest';
import { ALL_SCOPES } from '@/../scripts/eval/types';
import { MIN_TUPLES, loadCorpus, runScope, runAll } from '@/../scripts/eval/runner';

describe('eval harness', () => {
  it('loads an empty corpus per scope without throwing', () => {
    for (const scope of ALL_SCOPES) expect(Array.isArray(loadCorpus(scope))).toBe(true);
  });
  it('short-circuits "corpus too small" below MIN_TUPLES (gate=pass)', () => {
    const report = runScope('grading');
    expect(report.total_tuples).toBeLessThan(MIN_TUPLES);
    expect(report.gate).toBe('pass');
    expect(report.gate_reason).toMatch(/corpus too small/i);
  });
  it('runAll returns one report per scope and never regresses on empty corpus', () => {
    const reports = runAll();
    expect(reports).toHaveLength(ALL_SCOPES.length);
    expect(reports.every(r => r.gate === 'pass')).toBe(true);
  });
});
```

- [ ] Run and confirm it FAILS:
```bash
npm test scripts/eval/__tests__/runner.test.ts
```
Expected FAIL: `Failed to resolve import ".../scripts/eval/types"`.

- [ ] LIFT V1 `scripts/eval/types.ts` verbatim into `scripts/eval/types.ts` (the full discriminated-union file: `TupleMetadata`, the 6 tuple interfaces, `EvalTuple`, `EvalScope`, `ALL_SCOPES`, `TupleDrift`, `RunReport` — exactly as in the V1 source). It is import-safe (types only, no SDK side-effects).

- [ ] Create the six empty corpus files (one action):
```bash
cd /c/users/inteliflow/NEW-CORE
mkdir -p scripts/eval/corpus
for f in grading quiz-generation homework-generation spark-generation spark-rubric learner-profile; do
  echo "[]" > "scripts/eval/corpus/$f.json"
done
```

- [ ] Write the runner (the `MIN_TUPLES` gate + short-circuit):
```ts
// scripts/eval/runner.ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALL_SCOPES, type EvalScope, type EvalTuple, type RunReport } from './types';

/** V1 activates the gate at >=50 tuples/scope (v1-mining-findings.md item 7). */
export const MIN_TUPLES = 50;

const CORPUS_DIR = resolve(process.cwd(), 'scripts/eval/corpus');

export function loadCorpus(scope: EvalScope): EvalTuple[] {
  const file = resolve(CORPUS_DIR, `${scope}.json`);
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? (parsed as EvalTuple[]) : [];
}

/** Candidate invoker is wired against import-safe src/lib/engine/* in a later plan
 *  (spec §1.11/§3.4). Optional now so the harness runs green with an empty corpus. */
export type InvokeCandidate = (tuple: EvalTuple) => Promise<unknown>;

export function runScope(scope: EvalScope, _invokeCandidate?: InvokeCandidate): RunReport {
  const corpus = loadCorpus(scope);
  const ran_at = new Date().toISOString();
  if (corpus.length < MIN_TUPLES) {
    return {
      scope, variant_label: 'candidate', baseline_label: null, ran_at,
      total_tuples: corpus.length,
      tier_counts: { pass: 0, warning: 0, regression: 0 },
      flagged: [], mean_drift: 0,
      gate: 'pass',
      gate_reason: `corpus too small (${corpus.length} < MIN_TUPLES=${MIN_TUPLES}); gate inactive`,
    };
  }
  // Full drift scoring is a later-plan deliverable; reaching here means a real corpus exists.
  throw new Error(`Drift scoring not implemented for scope "${scope}" (requires src/lib/engine/*)`);
}

export function runAll(invokeCandidate?: InvokeCandidate): RunReport[] {
  return ALL_SCOPES.map(scope => runScope(scope, invokeCandidate));
}
```

- [ ] Write the CI entry:
```ts
// scripts/eval/ci.ts
import { runAll } from './runner';

function main() {
  const reports = runAll();
  let regressed = false;
  for (const r of reports) {
    console.log(`[eval] ${r.scope}: gate=${r.gate} tuples=${r.total_tuples} — ${r.gate_reason}`);
    if (r.gate === 'regression') regressed = true;
  }
  process.exit(regressed ? 1 : 0);
}
main();
```

- [ ] Run and confirm PASS:
```bash
npm test scripts/eval/__tests__/runner.test.ts
```
Expected: `3 passed`.

- [ ] Run the eval CI entry and confirm it exits green with "corpus too small":
```bash
npm run eval
```
Expected (stdout): six lines `[eval] <scope>: gate=pass tuples=0 — corpus too small (0 < MIN_TUPLES=50); gate inactive`, process exits `0`.

- [ ] Commit:
```bash
git add -A && git commit -m "P1 Task 16: eval-rig harness (LIFT types, empty corpus, MIN_TUPLES gate)"
```

---

### Task 17: Full-suite green + build verification (deployable spine)

**Files:**
- Test: all (no new files; verification gate per superpowers:verification-before-completion)

**Interfaces:**
- Consumes: every prior task.
- Produces: evidence the spine is deployable — full Vitest suite green, `tsc` clean, `next build` succeeds, `npm run eval` green.

- [ ] Run the full test suite:
```bash
npm test
```
Expected: all test files pass (smoke, models, wrappers, supabase clients, roles, route-stubs, migrations ×8 blocks, eval runner) — `Test Files  N passed`, `Tests  M passed`, exit `0`.

- [ ] Type-check the whole project:
```bash
npx tsc --noEmit
```
Expected: exits `0`, no errors.

- [ ] Run the eval gate:
```bash
npm run eval
```
Expected: all scopes `gate=pass`, exit `0`.

- [ ] Production build (proves it deploys — the milestone's "deployable Next.js app" bar):
```bash
npm run build
```
Expected: `✓ Compiled successfully`; the `src/app/api/**` stub routes and `auth/callback` appear in the route manifest; no build errors. (Build does not require live Supabase/AI keys — clients construct lazily at request time.)

- [ ] Confirm the milestone deliverables in one pass (manual checklist, no code):
  - sign-in resolves to a role: `guards.ts::resolveCaller` reads `users.role` via `auth.getUser()` (Task 6); `users.role` CHECK carries all 6 roles (Task 8). ✓
  - schema + RLS in place: migrations 0001–0008, every table `ENABLE ROW LEVEL SECURITY` + `GRANT ALL` + `DROP POLICY IF EXISTS`, SECURITY DEFINER helpers (Tasks 8–15). ✓
  - eval harness runs green: `npm run eval` short-circuits corpus-too-small (Task 16). ✓
  - NOT included (correctly out of scope): generation engine, signals math, screens, licensing business logic, Spark, media. ✓

- [ ] Final commit:
```bash
git add -A && git commit -m "P1 Task 17: full-suite green + build verification (deployable spine)"
```

---

## Out of scope for this plan (later plans 2–8)

Do NOT implement here — each is a named later deliverable referenced by this spine:
- Generation engine (`src/lib/engine/{lessonParse,quizGen,adapt,grading,assignmentGen}.ts`) + WDK workflow (spec §3) — plan(s) covering the engine.
- Signals math (`src/lib/signals/*`, `computeSkillState.ts`, divergence/effort/risk) (spec §4).
- Cron handler bodies (trial-check, idempotency-sweep, weekly-snapshot, parent-narrative) — stubs only here.
- Licensing business logic (`checkFeature`, `requireFeature`, HMAC `keys.ts`, `usageCaps.ts`, activation/gating) (spec §6).
- Trial/account provisioning (`lib/trial/*`, `seedTrialDemoData`, welcome email, HighLevel webhook) (spec §1.9) — `signup` route stub only.
- Spark contract service layer + webhook idempotency table (spec §7).
- All role screens + onboarding flow + fresh design system (spec §5, §9).
- LMS/SIS connector tables (074/075) and additional domain migrations (040 teacher_actions, 041 why-cache, 043/045 effort/drift, 053 IEP, 055 score/grade split, 066 eval_candidates) — added in the plans that consume them.

## Notes / divergences flagged (SCOPE wins)
- **Grading model default:** ships `claude-sonnet-4-6` (V1-proven, corpus-calibrated) via env default, NOT Opus — Opus is a week-1 spike candidate, decided later (spec §1.3 / §3.1 / SCOPE §17 build param 3). Re-pin all dated model IDs to current published versions at build time.
- **Tier enum:** `'professional'` is canonical on both `school_licenses` and `license_keys` (spec §2.3) — the V1 `license_keys 'pro'` value is corrected, not carried.
- **6th role:** `school_sysadmin` added to the `users.role` CHECK and to `ROLES`/`SCHOOL_ADMIN_ROLES` (spec §1.2); routed as school-admin-tier.
- **Migration tests are static SQL-text assertions** (no live Postgres in CI). A live pgTAP/`supabase db` run against a real instance is recommended in the environment where Supabase is provisioned but is not a CI gate in this plan.
---

## ⚠️ Review Corrections (apply per cited task — from the adversarial review pass)

> The auto-finalizer could not emit the fully-merged plan (it exceeds the 64k single-response limit), so these 26 findings are listed here as binding corrections. **Before executing a cited task, apply its correction.** HIGH = must-fix (the task is wrong/unbuildable without it). `$V1` = `C:/users/inteliflow/core`.

### HIGH (must fix)
- **[Header — DONE]** V1 source path corrected to `$V1 = C:/users/inteliflow/core` (was "core-platform"). Every LIFT step opens the real file under `$V1`.
- **Task 16 — inline `scripts/eval/types.ts` (do NOT leave as "lift verbatim").** Open `$V1/scripts/eval/types.ts` (250 lines) and copy it **verbatim**. Downstream (`runner.ts`, `ci.ts`, `runner.test.ts`) hard-depends on these exact exports: `TupleMetadata { sampled_from_attempt_id: string|null; sampled_at: string; barb_reviewed: boolean; notes: string }`; the six tuple interfaces (`GradingEvalTuple, QuizGenerationEvalTuple, HomeworkGenerationEvalTuple, SparkGenerationEvalTuple, SparkRubricEvalTuple, LearnerProfileEvalTuple`); `EvalTuple` (union); `EvalScope = EvalTuple['scope']`; `ALL_SCOPES = ['grading','quiz-generation','homework-generation','spark-generation','spark-rubric','learner-profile'] as const`; `TupleDrift { tuple_id; drift_score; tier:'pass'|'warning'|'regression'; components:Record<string,number>; failures:string[] }`; `RunReport { scope; variant_label; baseline_label:string|null; ran_at; total_tuples; tier_counts:Record<tier,number>; flagged:TupleDrift[]; mean_drift; gate; gate_reason }`.
- **Task 16 — fix the test import.** Use relative imports in `scripts/eval/__tests__/runner.test.ts`: `import { ALL_SCOPES } from '../types'` and `import { MIN_TUPLES, loadCorpus, runScope, runAll } from '../runner'`. The `@/../scripts/...` alias-escape is undefined behavior (the `@/*`→`./src/*` mapping appends the remainder literally).
- **Task 14 — licensing substrate is incomplete.** 0007 creates only `school_licenses / license_keys / license_events`; §2.5/§6.1 require the full lifted set from `$V1/supabase/migrations/020_*` + `049_*` (incl. `license_usage` + the activation/seat columns + `trial_events`, see below). Add the missing tables/columns.
- **NEW migration task — `platform_config` (maintenance-mode singleton).** Missing entirely; §1.7/§2.5 require it (lifted from `$V1/.../033_*`). Add a migration: singleton `platform_config(maintenance_mode bool, maintenance_message text, ...)` + RLS.
- **NEW migration task — `webhook_idempotency_keys`.** Missing, yet `vercel.json` (Task 2) registers the `/api/cron/idempotency-sweep` cron that purges it. Add the table: `(endpoint, idempotency_key)` UNIQUE + `status` + `expires_at` (the SPARK idempotency state machine substrate).
- **Task 16 — surface the SparkRubric blocker.** §11.4: the `SparkRubricEvalTuple` dimension keys must equal SPARK's 7 canonical dimensions. Add a note/TODO at the eval task that this is a Stage-B blocker to reconcile (don't lift stale keys).

### MEDIUM (fix before the cited task is "done")
- **Migration order — 0002 `enforce_enrollment_limit()` forward-refs `school_licenses` (created in 0007).** Add as the function's first statement: `IF to_regclass('public.school_licenses') IS NULL THEN RETURN NEW; END IF;` so the trigger is inert until 0007 exists. (Static text-tests miss this; it fails on live `db push`.)
- **Migration order — 0001 SECURITY DEFINER helpers forward-ref `enrollments`/`classes` (created in 0002).** Keep only `is_platform_admin()` + `get_my_school_id()` (touch only `users`) in 0001; **move `get_teacher_student_ids` / `get_teacher_class_ids` / `get_student_class_ids` to the END of 0002** (after the CREATE TABLEs). Update Task 8's text assertion to expect them in 0002.
- **0002 RLS policy `enrollments_school_read`** calls `get_teacher_class_ids()` — resolve together with the helper move above (helper must exist before the policy).
- **Task 16 — lift the full eval scaffold, not just types:** also `$V1/scripts/eval/scoring/{drift.ts,semantic.ts}` (drift primitives + thresholds + `aggregateGate`) and the runner scoring modules; `ci.ts` path-rules.
- **NEW migration task — `student_model` (per-`(student_id, class_id)`, `$V1/.../000` + `029`).** Missing and not in Out-of-scope; §2.1 lists it as core domain (LS/Profile per-class grain). Add it (or explicitly defer with a stated reason).
- **`trial_events` audit table (`$V1/.../035`, 18-value `event_type` CHECK incl. `trial_signup`/`day_25`/…).** Add to the licensing migration (§2.3 trial reconciliation).
- **Task 4 — `LlmExhaustedError` contract.** The Produces/doc says wrappers "raise" it after primary+fallback exhaust; make the impl + test consistent (raise vs return). Pick one and state it.
- **Task 3 — `models.ts` lift scope.** V1's real `lib/ai/models.ts` exports only `CLAUDE_GRADING_MODEL`, `OPENAI_GEN_MODEL`, `OPENAI_VOICE_MODEL` (+ token-param helper). Don't over-claim a larger registry; re-pin dated IDs to current Claude/GPT at build.
- **Task 13 — snapshots name/provenance drift.** Verify the real V1 table name (`student_model_snapshots`?) and migration number against `$V1/supabase/migrations/` before writing 0006; the "LIFT 046" label and table name must match the source.
- **Task 15 — platform `034` lift drops columns.** Re-check `$V1/.../034_platform_api.sql` (`platform_events.event_type` etc.) and carry the real column set; the static test won't catch silent drops.

### LOW (nits — fix opportunistically)
- Task 8: add the 6th helper `get_my_role()` (`$V1/.../075:93`, scoped to school_admin/school_sysadmin/platform_admin) for admin-only RLS.
- Task 7: stub the full §1.5 proven API path tree (`api/teacher/lessons/parse`, `api/attempts/[attemptId]/{adapt,submit}`, …) up front (Turbopack trap).
- Task 7: the `layout.tsx` metadata edit instruction is ambiguous — replace the exact `create-next-app` `metadata` export, don't add a duplicate.
- Task 16: V1's gate constant is `MIN_TUPLES_FOR_GATE = 50` — keep the name on lift (plan renamed it `MIN_TUPLES`).
- Tasks 3/4: replace guessed expected test counts ("9 passed", "3 passed") with the actual count after writing the tests.
- Task 1: pin dep versions explicitly (bare `npm install <pkg>` floats versions against the locked stack).
- Task 6: `guardSchoolAdmin()` return type vs `users.school_id` nullability — internally consistent; just confirm at impl.

### Role-model resolution (referenced throughout)
- **`school_sysadmin` (6th role):** lock it in the `0001` role enum + fold into the School Admin route group + `get_my_role()` before any RLS policy references it (SCOPE §1.2 / design §1.2 open item #3). Confirm enum = `student|teacher|parent|school_admin|school_sysadmin|platform_admin`.

### LIFT handoff provisioning (added 2026-06-17 — Codex LIFT re-pass)
- **Task 15 (`platform_links`):** the `product`/`provider` CHECK must be **`IN ('spark','lift','custom')`** — the LIFT pre-populate handoff (P1) provisions a `provider='lift'` row. The draft's `('spark','custom')` rejects LIFT. Update the migration + its test.
- **NEW (foundation) — `external_identities` table:** `(school_id uuid, provider text, external_id text, core_student_id uuid, created_at)` with **UNIQUE (school_id, provider, external_id)** — the school-scoped identity map the LIFT inbound route uses to resolve create-vs-match (ambiguous matches rejected, never silently merged). Spark/LIFT both key idempotency on `provider+school_id+external_id`.
- **`lift_integration` feature** must be in the tier gate map as **Pro+** (not just a raw flag).
