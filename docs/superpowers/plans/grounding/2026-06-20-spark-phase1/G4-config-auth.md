# G4 — Config/env + Auth chain libs (VERBATIM grounding)

Surface: Config/env module + the auth chain (`requireRole`, `guards.ts`, supabase client factories) + timing-safe-compare flag.
Branch: `feat/teacher-app-shell`. Repo: `C:/users/inteliflow/NEW-CORE`.
All snippets quoted verbatim with `file:line` refs. READ-ONLY; no changes proposed.

---

## ⚠️ TOP DISCREPANCY (read first)

**There is NO central config/env module.** The plan/spec assumes "the config module that reads/validates env vars" (per `2026-06-20-spark-integration-phase1-design.md:57`: *"add `SPARK_API_URL` to the config module … it's validated like `CORE_SPARK_API_SECRET`"*). **No such validating module exists.**

Reality of env handling in this repo:
- Env vars are read **inline** via `process.env.X` at the point of use. There is no `src/lib/config.ts`, no `src/lib/env.ts`, no zod/`envsafe`-style validator. (`Glob src/lib/config*`, `src/lib/**/config*`, `src/lib/**/env*` → only `src/lib/__tests__/config.test.ts` matched; **no module file**.)
- The only files that read `process.env` under `src/lib` are: `src/lib/ai/models.ts`, `src/lib/ai/claude.ts`, `src/lib/ai/openai.ts`, `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`.
- **`CORE_SPARK_API_SECRET` is NOT read anywhere in `src/` runtime code.** The only occurrences are in `docs/` and in `src/lib/__tests__/config.test.ts` (which only asserts the key NAME is present in `.env.example`). So the design's "validated like `CORE_SPARK_API_SECRET`" baseline does not actually exist as runtime validation — `CORE_SPARK_API_SECRET` currently has no reader/validator at all.
- **`SPARK_API_URL` is absent from BOTH `.env.example` and `.env.local`** (grep → "NO SPARK_API_URL IN EITHER ENV FILE").

### What "config validation" actually means here
The closest pattern to a "config module" is the AI model registry, which uses the `process.env.X || 'default'` idiom. `src/lib/ai/models.ts:1-39`:
```ts
// Central registry of AI model IDs — single source of truth (LIFT V1 lib/ai/models.ts).
export const CLAUDE_GRADING_MODEL =
  process.env.ANTHROPIC_GRADING_MODEL || 'claude-sonnet-4-6';
export const CLAUDE_GEN_MODEL =
  process.env.ANTHROPIC_GEN_MODEL || 'claude-sonnet-4-6';
export const OPENAI_GEN_MODEL = process.env.OPENAI_GEN_MODEL || 'gpt-4o';
export const OPENAI_VOICE_MODEL = process.env.OPENAI_VOICE_MODEL || 'gpt-4o';
```
The repo-wide convention to add `SPARK_API_URL` "the same way" = add the NAME to `.env.example`, and read it inline with `process.env.SPARK_API_URL` (optionally `|| 'https://spark.inteliflowai.com'`). There is no shared validator to register it in.

### `.env.example` / `.env.local` handling
`.env.example` (`.env.example:1-57`) is **names-only, never values** (header: `# .env.example — CORE v2 P1. Names only; never commit values.`). The Spark block already exists:
```
# Spark contract (HS256 JWT signing + Spark->CORE return Bearer)
CORE_SPARK_API_SECRET=
```
`.env.local` (gitignored, real values) currently has:
- `CORE_SPARK_API_SECRET=<redacted>` (line 41)
- `CRON_SECRET=core-cron-2026-secret` (line 19)
- **no `SPARK_API_URL`**

**The `.env.example` contract is TEST-ENFORCED** by `src/lib/__tests__/config.test.ts`:
- Lines 16-61: a hardcoded `requiredKeys` array — every listed key MUST appear in `.env.example`. `CORE_SPARK_API_SECRET` is listed (line 34). **`SPARK_API_URL` is NOT in this list** — if the plan adds `SPARK_API_URL=` to `.env.example`, it should also be added to `requiredKeys` here to keep the test as the contract.
- Lines 68-84: **every non-comment line MUST have an empty value** (`expect(value).toBe('')`). So `SPARK_API_URL=` must be added with NO default value in `.env.example` (the default lives in code, not the example file).

---

## Task 2 — `src/lib/auth/requireRole.ts` (full file, 39 lines)

`AuthedContext` (`requireRole.ts:6-11`):
```ts
export interface AuthedContext {
  userId: string;
  role: Role;
  schoolId: string | null;
  fullName: string | null;
}
```

`requireRole` signature + body (`requireRole.ts:18-38`):
```ts
export async function requireRole(allowed: readonly Role[]): Promise<AuthedContext> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?expired=true');

  const { data: profile } = await supabase
    .from('users').select('role, school_id, full_name').eq('id', user.id).single();
  const role = (profile?.role ?? null) as Role | null;
  if (!role) redirect('/login');

  const schoolId = (profile?.school_id ?? null) as string | null;
  if (schoolId) {
    const { data: school } = await supabase
      .from('schools').select('trial_status').eq('id', schoolId).single();
    if (school?.trial_status === 'expired') redirect('/trial-expired');
  }

  if (!allowed.includes(role)) redirect(homeForRole(role));

  return { userId: user.id, role, schoolId, fullName: (profile?.full_name ?? null) as string | null };
}
```
- It REDIRECTS (throws `NEXT_REDIRECT`) on failure — designed for **server layouts/pages, NOT API route handlers**. For API routes use the `guards.ts` functions (which return `NextResponse`).
- Imports: `createServerSupabaseClient` from `@/lib/supabase/server`, `homeForRole` from `@/lib/auth/roleHome`, `type Role` from `@/lib/auth/roles`.

### `STAFF_ROLES` and role model — `src/lib/auth/roles.ts:4-13`
```ts
export const ROLES = [
  'teacher', 'student', 'parent', 'school_admin', 'school_sysadmin', 'platform_admin',
] as const;
export type Role = (typeof ROLES)[number];

/** Roles routed through the School Admin route group + passing guardSchoolAdmin. */
export const SCHOOL_ADMIN_ROLES = ['school_admin', 'school_sysadmin', 'platform_admin'] as const;

/** All staff roles allowed to access teacher-facing API routes. */
export const STAFF_ROLES = ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'] as const;
```

---

## Task 3 — `src/lib/auth/guards.ts` (object-level IDOR guards, full file 107 lines)

File header (`guards.ts:1-3`):
```ts
// Object-level authz for API route handlers (LIFT V1 lib/auth/guards.ts; finding C3).
// The service-role admin client BYPASSES RLS — these guards are the ONLY access
// control on admin-client cross-user reads. RLS is NOT the backstop here.
```
Imports (`guards.ts:4-6`): `NextResponse` from `next/server`; `createServerSupabaseClient, createAdminSupabaseClient` from `@/lib/supabase/server`; `SCHOOL_ADMIN_ROLES` from `@/lib/auth/roles`.
Constant `PLATFORM_ROLE = 'platform_admin'` (`guards.ts:8`).
Helpers (`guards.ts:14-15`): `const UNAUTH = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });` and `const FORBID = () => NextResponse.json({ error: 'Forbidden' }, { status: 403 });`

`resolveCaller` (private, `guards.ts:18-25`) — uses `getUser()` not `getSession()`:
```ts
async function resolveCaller(): Promise<{ id: string; role: string | null; school_id: string | null } | null>
```

Exported guard signatures + return/throw behavior:

1. `guardPlatformAdmin` (`guards.ts:31-36`):
```ts
export async function guardPlatformAdmin(): Promise<NextResponse | null>
```
Returns `UNAUTH()` (401) if no caller, `FORBID()` (403) if `caller.role !== 'platform_admin'`, else `null` (proceed). Does NOT throw.

2. `guardSchoolAdmin` (`guards.ts:50-61`):
```ts
export async function guardSchoolAdmin(): Promise<
  | { error: NextResponse }
  | { schoolId: string | null; role: string; userId: string; isPlatformAdmin: boolean }
>
```
Discriminated union. On denial `{ error: UNAUTH()|FORBID() }`. On success `{ schoolId, role, userId, isPlatformAdmin }`. Caller pattern: `if ('error' in r) return r.error;`. **CAUTION (doc-commented `guards.ts:44-48`):** when `isPlatformAdmin` is true, `schoolId` is null (unrestricted); callers MUST gate `.eq('school_id', schoolId)` on `if (!r.isPlatformAdmin)`.

3. `guardClassAccess` (`guards.ts:68-78`):
```ts
export async function guardClassAccess(classId: string): Promise<NextResponse | null>
```
`UNAUTH()` if no caller; `null` if platform_admin; else uses `createAdminSupabaseClient()` to read `classes.teacher_id, school_id`; `FORBID()` (403, NOT 404, "don't leak existence") if class missing; `null` if caller owns it or same-school admin; else `FORBID()`.

4. `guardStudentAccess` (`guards.ts:86-106`):
```ts
export async function guardStudentAccess(studentId: string): Promise<NextResponse | null>
```
`UNAUTH()` if no caller; `null` if caller IS the student or platform_admin; else admin-client reads `users.school_id, parent_id`; `FORBID()` if missing; `null` for same-school admin, linked parent (`role === 'parent' && parent_id === caller.id`), or a teacher with an enrollment of that student in one of the caller's classes; else `FORBID()`.

`isSchoolAdmin` helper (`guards.ts:10-12`): `return !!role && (SCHOOL_ADMIN_ROLES as readonly string[]).includes(role);`

---

## Task 4 — Supabase client factories — `src/lib/supabase/server.ts` (full file 32 lines)

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

export async function createServerSupabaseClient() {
  const cookieStore = await cookies(); // Next 16: cookies() is async
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
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
    process.env.SUPABASE_SECRET_KEY!,
  );
}
```

CONFIRMED:
- `createServerSupabaseClient()` — **async** (`Promise`), reads `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (anon/publishable, RLS-respecting), wires cookies. Import path: `@/lib/supabase/server`.
- `createAdminSupabaseClient()` — **synchronous**, reads `process.env.SUPABASE_SECRET_KEY!` (service role) + `NEXT_PUBLIC_SUPABASE_URL!`. **This is the one that BYPASSES RLS.** Import path: `@/lib/supabase/server`. SERVER-ONLY.
- Browser client (`src/lib/supabase/client.ts:4-9`): `createBrowserSupabaseClient()` uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` only; never the secret key.

---

## FLAG — Timing-safe / constant-time bearer compare

**ABSENT.** Grep over `src/` for `timingSafe|bearerMatches|timingSafeEqual|crypto`:
- `src/lib/trial/provisionTrial.ts:27` and `src/lib/trial/seedTrialDemoData.ts:20` import `randomUUID` from `'crypto'` (NOT for comparison).
- No `timingSafeEqual`, no `bearerMatches`, no `timingSafe*` helper exists anywhere in `src/`.

**Existing secret-compare is a plain `!==` string compare, NOT constant-time.** The only bearer/secret gate in the repo is the cron gate, `src/app/api/cron/weekly-snapshot/route.ts:73-78`:
```ts
const secret = process.env.CRON_SECRET;
const provided = req.headers.get('x-cron-secret');
if (!secret || provided !== secret) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```
**=> SP-3 (constant-time bearer compare) MUST add a new utility — none exists to reuse.** Use Node `crypto.timingSafeEqual` (length-guarded, since timingSafeEqual throws on length mismatch). The Spark webhook auth (per design `2026-06-20-...:48`) requires constant-time Bearer comparison against `CORE_SPARK_API_SECRET`.

---

## Bonus context the planner will need (Spark webhook DB substrate)

`platform_links`, `external_identities`, `webhook_idempotency_keys` tables already exist in migration `0008_platform.sql` (schema-only; "Spark wire logic are later-plan deliverables"). **No `src/` runtime code references these tables yet** (grep `platform_links|external_identities|core_base_url` over `src` → no hits). Key columns:
- `platform_links` (`0008:44-59`): `school_id`, `product CHECK IN ('spark','lift','custom')`, `api_key NOT NULL`, `core_base_url`, `enabled`, `key_version`, `rotated_at`, `expires_at`, `last_used_at`. `UNIQUE (school_id, product)`.
- `external_identities` (`0008:69-77`): `school_id`, `provider`, `external_id`, `core_student_id`. `UNIQUE (school_id, provider, external_id)`.
- `webhook_idempotency_keys` (`0008:87-96`): `endpoint`, `idempotency_key`, `status CHECK IN ('in_progress','completed','failed')`, `response_body jsonb`, `expires_at`. `UNIQUE (endpoint, idempotency_key)`. Swept by cron `idempotency-sweep`.
- All four tables: RLS deny-by-default, `is_platform_admin()` only (so service-role/admin client is required for webhook access).

### Migrations — next number
Existing: `0001`..`0011` (highest = `0011_signals.sql`; note `0008_platform.sql` already holds the Spark tables). **Next migration = `0012_*.sql`**, 4-digit zero-padded prefix + snake_case description (e.g. `0012_spark_attempts.sql`). Note there is no `0000`; numbering starts at `0001`.

### Demo-school identity
`src/lib/demo/demoCast.ts:42`: `export const DEMO_SCHOOL_NAME = 'CORE Demo School';`. Demo staff: `DEMO_TEACHER` = Dana Whitfield (teacher), `DEMO_PARENT` = Rosa Rivera (parent), `DEMO_ADMIN` = Priya Anand (school_admin) (`demoCast.ts:44-46`). Demo IDs are generated at seed time (no static UUID constant in demoCast).
