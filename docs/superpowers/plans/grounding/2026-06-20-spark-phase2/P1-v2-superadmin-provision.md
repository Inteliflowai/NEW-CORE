# P1 — V2 Super-Admin Provisioning (grounding for SPARK Phase 2, sub-project A)

READ-ONLY verbatim grounding. Repo: V2 = `C:/users/inteliflow/NEW-CORE` (Next.js 16 App Router, branch `main`).
Surface: the super-admin provisioning route group + the provision-trial API + the SPARK-link library + the SPARK config/wire surface. Captures what EXISTS and (prominently) what does NOT.

---

## 1. The `(super-admin)` route group

### 1.1 Files that exist

```
src/app/(super-admin)/layout.tsx
src/app/(super-admin)/provision/page.tsx                ← ONLY page in the group
src/app/(super-admin)/provision/__tests__/page.test.tsx
src/app/(super-admin)/__tests__/layout.guard.test.tsx
```

`Glob "src/app/(super-admin)/**/page.tsx"` → exactly one match: `provision/page.tsx`.
`Glob "src/app/platform/**"` → **No files found.**

### 1.2 Layout — `src/app/(super-admin)/layout.tsx` (FULL, 34 lines)

Server component. Gate is `requireRole(['platform_admin'])`. Wraps children in `RoleLayout role="super-admin"`.

```tsx
import { RoleLayout } from '@/components/core/RoleLayout';
import { requireRole } from '@/lib/auth/requireRole';

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole(['platform_admin']);
  const nav = (
    <>
      <a href="/platform/dashboard" ...>Dashboard</a>
      <a href="/platform/schools"   ...>Schools</a>
      <a href="/platform/users"     ...>Users</a>
      <a href="/provision" className="text-fg hover:text-brand px-3 py-1">Provision</a>
    </>
  );
  return <RoleLayout role="super-admin" nav={nav}>{children}</RoleLayout>;
}
```

- **FLAG — dead nav links.** The nav renders `/platform/dashboard`, `/platform/schools`, `/platform/users`, but `src/app/platform/**` has **no files** — those three routes DO NOT EXIST (404s). The only live super-admin page is `/provision`. (Note: `/provision` is NOT under a `/platform` path — it resolves at the root because `(super-admin)` is a route group.)
- **FLAG — no school list/picker UI exists.** There is no Schools page, no school search/select. The provision form creates a NEW school from a typed school name; it never lists or selects an existing school. A "SPARK-enable an existing school" action has **no existing UI host** — there is no place that enumerates schools or shows a single school's detail.
- The two nav-link styles are inconsistent: the three `/platform/*` links use raw `text-[var(--fg)]`/`hover:text-[var(--brand)]` arbitrary-value classes (violates the token-class discipline in CLAUDE.md); only the `/provision` link uses token classes `text-fg hover:text-brand`.

### 1.3 Page — `src/app/(super-admin)/provision/page.tsx` (FULL, 239 lines)

`'use client'`. A controlled form that POSTs JSON to `/api/admin/provision-trial`.

Request body it sends (lines 62-69):
```ts
{ school_name, teacher_name, teacher_email, student_roster: string[], trial_plan, student_limit }
```
- `student_roster` = textarea split on `\n`, trimmed, blanks filtered (lines 53-56).
- `trial_plan` options (lines 29-33): `'pro'` (default) | `'starter'` | `'enterprise'`.
- `student_limit` default `300`.

Fetch call (lines 59-77):
```ts
const res = await fetch('/api/admin/provision-trial', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ school_name, teacher_name, teacher_email, student_roster, trial_plan, student_limit }),
});
const data = await res.json() as Record<string, unknown>;
if (!res.ok) setErrorMsg((data.error as string) ?? `Request failed (${res.status})`);
else setResult(data as unknown as ProvisionResult);
```

Result type the UI expects (lines 22-27):
```ts
interface ProvisionResult {
  school_id: string;
  trial_expires_at: string;
  roster_status?: string;
  credentials_summary: { shared_password: string; accounts?: Record<string, { email: string }> };
}
```
Success block (lines 207-236) renders School ID, expiry, per-role account emails, and the shared password once. Error block (lines 200-204) renders `data.error`. No auth handled in the page — the route-group layout's `requireRole` is the gate; if a non-admin reaches it they're redirected before the page renders.

- **FLAG — there is NO client-side auth in the page**, and **no `data-role`/intensity beyond RoleLayout**. There is also no "manage school" or "enable SPARK" control anywhere on this page.

---

## 2. The provision-trial API — `src/app/api/admin/provision-trial/route.ts` (FULL, 87 lines)

```
src/app/api/admin/provision-trial/route.ts          ← the handler
src/app/api/admin/provision-trial/validate.ts        ← validateProvisionInput
src/app/api/admin/provision-trial/__tests__/...
```

Handler shape:
```ts
export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await guardPlatformAdmin();        // 401 no session / 403 not platform_admin
  if (guard) return guard;

  let rawBody: unknown;
  try { rawBody = await req.json(); } catch { return 400 { error: 'Invalid JSON body' }; }

  const result = validateProvisionInput(rawBody as Record<string, unknown>);
  if (!result.ok) return 400 { error: result.error };

  const { school_name, teacher_email, teacher_name, student_roster, trial_plan, student_limit } = result.value;

  const admin = createAdminSupabaseClient();        // service-role, bypasses RLS
  let provisionResult;
  try {
    provisionResult = await provisionTrial({
      admin, schoolName: school_name, teacherEmail: teacher_email, teacherName: teacher_name,
      trialPlan: trial_plan, studentLimit: student_limit,
    });
  } catch { return 500 { error: 'Internal server error' }; }   // internals never leaked

  const accounts: Record<string, { email: string }> = {};
  for (const [role, cred] of Object.entries(provisionResult.credentials)) accounts[role] = { email: cred.email };

  return NextResponse.json({
    school_id: provisionResult.schoolId,
    trial_expires_at: provisionResult.trialExpiresAt,
    roster_status: 'deferred_demo_cast_seeded',
    credentials_summary: { shared_password: provisionResult.password, accounts },
  }, { status: 201 });
}
```

Key facts:
- **Auth chain = `guardPlatformAdmin()` only** (route.ts:28-29). No redundant `getUser` pre-guard. Returns the guard's `NextResponse` (401/403) to short-circuit.
- Imports: `createAdminSupabaseClient` from `@/lib/supabase/server`; `guardPlatformAdmin` from `@/lib/auth/guards`; `provisionTrial` from `@/lib/trial/provisionTrial`; `validateProvisionInput` from `./validate`.
- **`student_roster` is validated/accepted but NOT forwarded to `provisionTrial`** (route.ts:50-51 TODO). `provisionTrial` seeds the demo cast regardless. `roster_status` is the constant string `'deferred_demo_cast_seeded'`.
- Success = **201**. Credentials surfaced once, never logged.
- **FLAG — this route knows NOTHING about SPARK.** It does not call `provisionSparkLink`, does not read SPARK config, has no `enable_spark` parameter. A "SPARK-enable a school" action is NOT a parameter of this route today.

### 2.1 `provisionTrial` signature — `src/lib/trial/provisionTrial.ts:34-63`

```ts
export interface ProvisionTrialInput {
  admin: SupabaseClient;
  schoolName: string;
  teacherEmail: string;          // guard hard-fails on cross-tenant rebind
  teacherName: string;
  trialPlan?: string;            // default 'pro'
  trialSource?: string | null;
  studentLimit?: number;         // default 300
  trialDays?: number;            // default 30
  rng?: Rng;
}
export interface ProvisionTrialResult {
  schoolId: string;
  teacherId: string;
  parentId: string | null;
  firstStudentId: string | null;
  password: string;
  trialExpiresAt: string;        // ISO string
  credentials: Record<string, TrialCredential>;  // keyed by role: teacher/parent/student
  seedReport?: SeedReport;
}
export async function provisionTrial(input: ProvisionTrialInput): Promise<ProvisionTrialResult>
```
- It UPDATEs `schools.trial_credentials` (email-only per role; password travels only in result). It does NOT touch `platform_links` / SPARK.

---

## 3. Auth gating for super-admin-only surfaces

### 3.1 `guardPlatformAdmin` — `src/lib/auth/guards.ts:31-36` (API-route gate)

```ts
const PLATFORM_ROLE = 'platform_admin';
const UNAUTH = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
const FORBID = () => NextResponse.json({ error: 'Forbidden' }, { status: 403 });

export async function guardPlatformAdmin(): Promise<NextResponse | null> {
  const caller = await resolveCaller();
  if (!caller) return UNAUTH();              // 401
  if (caller.role !== PLATFORM_ROLE) return FORBID();  // 403
  return null;                               // proceed
}
```
`resolveCaller()` (guards.ts:18-25): `createServerSupabaseClient()` → `auth.getUser()` (NOT getSession) → `select role, school_id from users where id = user.id`. Returns `{ id, role, school_id } | null`.

Comment at guards.ts:1-3: *"The service-role admin client BYPASSES RLS — these guards are the ONLY access control on admin-client cross-user reads. RLS is NOT the backstop here."*

### 3.2 `requireRole` — `src/lib/auth/requireRole.ts:18-38` (layout/page gate)

```ts
export async function requireRole(allowed: readonly Role[]): Promise<AuthedContext> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?expired=true');
  // select role, school_id, full_name from users
  if (!role) redirect('/login');
  if (schoolId) { /* select trial_status; if 'expired' redirect('/trial-expired') */ }
  if (!allowed.includes(role)) redirect(homeForRole(role));
  return { userId, role, schoolId, fullName };
}
```
- **The established pattern for a super-admin-only PAGE/layout = `await requireRole(['platform_admin'])` in the route-group layout** (used in `(super-admin)/layout.tsx`).
- **The established pattern for a super-admin-only API ROUTE = `const guard = await guardPlatformAdmin(); if (guard) return guard;`** (used in provision-trial route).
- Note: `platform_admin` accounts typically have `school_id = null`, so `requireRole`'s trial-expiry gate is skipped for them.

### 3.3 Roles — `src/lib/auth/roles.ts:4-13`

```ts
export const ROLES = ['teacher','student','parent','school_admin','school_sysadmin','platform_admin'] as const;
export type Role = (typeof ROLES)[number];
export const SCHOOL_ADMIN_ROLES = ['school_admin','school_sysadmin','platform_admin'] as const;
export const STAFF_ROLES = ['teacher','school_admin','school_sysadmin','platform_admin'] as const;
```
`platform_admin` = the super-admin role. DB CHECK in migration 0001 mirrors the same 6 values.

---

## 4. SPARK-link library — `src/lib/spark/sparkLink.ts` (FULL, 47 lines) — ALREADY BUILT

```ts
export interface SparkLink { api_key: string; core_base_url: string | null; enabled: boolean; }

export async function getSparkLink(admin: SupabaseClient, schoolId: string): Promise<SparkLink | null> {
  const { data } = await admin
    .from('platform_links')
    .select('api_key, core_base_url, enabled')
    .eq('school_id', schoolId).eq('product', 'spark').maybeSingle();
  if (!data || (data as SparkLink).enabled !== true) return null;   // disabled row → null
  return data as SparkLink;
}

export async function isSparkEnabled(admin: SupabaseClient, schoolId: string): Promise<boolean> {
  return (await getSparkLink(admin, schoolId)) !== null;
}

export interface ProvisionSparkLinkArgs { schoolId: string; apiKey: string; coreBaseUrl?: string | null; label?: string; }

export async function provisionSparkLink(admin: SupabaseClient, args: ProvisionSparkLinkArgs): Promise<void> {
  const { error } = await admin.from('platform_links').upsert(
    { school_id: args.schoolId, product: 'spark', api_key: args.apiKey,
      core_base_url: args.coreBaseUrl ?? null, label: args.label ?? 'SPARK', enabled: true },
    { onConflict: 'school_id,product' },        // upsert keyed on (school_id, product)
  );
  if (error) throw new Error(`provisionSparkLink failed: ${error.message}`);
}
```
- Header comment (sparkLink.ts:1-3): *"Phase-1 SPARK gate = presence of an ENABLED product='spark' row (no license table exists). platform_links is RLS-deny-to-clients; callers must pass the admin (service-role) client."*
- **A new "SPARK-enable a school" action would call `provisionSparkLink(admin, { schoolId, apiKey, coreBaseUrl, label })`** — the helper already exists. The missing piece is a route + UI that resolve a `schoolId` and supply an `apiKey` (no API-route caller exists today; see §5).

---

## 5. How V2 stores/knows SPARK config + who writes `platform_links`

### 5.1 Config — `src/lib/spark/config.ts` (FULL, 7 lines)

```ts
export const SPARK_API_URL = process.env.SPARK_API_URL || 'https://spark.inteliflowai.com';
export const CORE_SPARK_API_SECRET = process.env.CORE_SPARK_API_SECRET || '';
```
- No central/validating config module — these two top-level `process.env` reads are the entire SPARK config surface.
- **Per-school SPARK `api_key` is NOT in env** — it lives per-row in `platform_links.api_key`. `CORE_SPARK_API_SECRET` is the GLOBAL bearer used for the CORE→SPARK webhook (see §6), distinct from per-school keys.

### 5.2 `platform_links` schema — `supabase/migrations/0008_platform.sql:44-62`

```sql
CREATE TABLE IF NOT EXISTS public.platform_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  product       text NOT NULL CHECK (product IN ('spark','lift','custom')),
  api_key       text NOT NULL,
  label         text,
  core_base_url text,
  enabled       boolean DEFAULT true,
  key_version   int DEFAULT 1, rotated_at timestamptz, expires_at timestamptz, last_used_at timestamptz,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (school_id, product)
);
```
RLS (0008_platform.sql:116-119): `platform_links_platform_all` — `FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin())`. Deny to non-platform-admin clients; service-role bypasses. So `getSparkLink`/`provisionSparkLink` MUST use the admin client.

### 5.3 Who writes `platform_links` today

Grep `provisionSparkLink` callers across `src/`:
- **ONLY caller in app/lib code: `scripts/seedDemo.ts:617`** (the demo seed). No `src/app/**` route, no `src/lib/**` module other than the helper itself calls it.

`scripts/seedDemo.ts:616-622`:
```ts
await provisionSparkLink(admin, {
  schoolId,
  apiKey: 'demo-spark-key-2026',
  coreBaseUrl: 'https://newcore.inteliflowai.com',
  label: 'SPARK (demo)',
});
```
- **FLAG — confirms the Phase-1 plan decision (`2026-06-20-spark-phase1.md:37`): "Admin provisioning route deferred. SP-1 ships `provisionSparkLink()` (lib helper) + a demo-seed call; a dedicated super-admin UI/route is not needed to demo (deferred)."** So Phase 2's sub-project A is exactly that deferred work: there is NO super-admin route or UI that writes `platform_links` — only the seed script does.

---

## 6. SPARK endpoints called FROM V2 (outbound)

Grep for SPARK URLs / `/api/integration` over `src/`:
- **`src/lib/spark/notifyAssignmentCreated.ts:69`** — the ONLY outbound HTTP call to SPARK in app/lib code:
  ```ts
  const res = await fetch(`${SPARK_API_URL}/api/integration/webhooks/core`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',
               Authorization: `Bearer ${CORE_SPARK_API_SECRET}`,
               'X-Idempotency-Key': `${coreHomeworkId}_${studentId}` },
    ...
  });
  ```
  35s timeout, never throws, returns `NotifyResult`. Caller: `src/app/api/teacher/assignments/generate/route.ts:185` (gated by `getSparkLink`).
- **FLAG CONFIRMED — `notifyAssignmentCreated` (CORE→SPARK create-notify) is the ONLY existing call to a SPARK endpoint from V2.** There is no SPARK student-launch/JWT call yet.

### 6.1 SPARK auth helper present but for INBOUND — `src/lib/spark/auth.ts` (FULL, 19 lines)

```ts
export function safeEqual(a: string, b: string): boolean { /* timingSafeEqual, length-guarded */ }
export function bearerMatches(authHeader, secret): boolean  // true iff "Bearer <secret>" and secret non-empty
```
- This is a constant-time **bearer check for the SPARK→CORE ingestion webhook** (inbound). It is NOT a JWT signer. **There is no JWT-launch / `verifyCoreJWT` / token-mint code in V2** — `docs/spark-mining-findings.md:35` describes the CORE→SPARK student-launch HS256 JWT (`issuer 'inteliflow-core'`, signed by `CORE_SPARK_API_SECRET`) as the V1/SPARK contract, but no such minting exists in V2 (this is sub-project B work, out of scope for P1).

---

## MANIFEST — discrepancies / risks / gaps for the designer

1. **Super-admin route-group has ONE page (`/provision`).** Nav links to `/platform/{dashboard,schools,users}` are DEAD (`src/app/platform/**` = no files). No school list/picker, no per-school detail page exists → a "SPARK-enable a school" action has no UI host today.
2. **`/provision` creates a NEW trial school from a typed name; it cannot select an existing school.** SPARK-enabling an existing (e.g. dedicated SPARK) school needs a new schoolId-resolving surface.
3. **`provisionSparkLink` is written only by `scripts/seedDemo.ts:617`** — NO API route or UI writes `platform_links`. Phase-1 explicitly deferred the admin provisioning route (`spark-phase1.md:37`). This is sub-project A's gap to fill.
4. **`provision-trial` route is SPARK-unaware** — no SPARK param, no SPARK call. Extending it OR adding a sibling route are both options; the established API-gate pattern to copy is `guardPlatformAdmin()` then `createAdminSupabaseClient()` then call the lib helper.
5. **Gate patterns to extend:** page/layout → `requireRole(['platform_admin'])`; API route → `const guard = await guardPlatformAdmin(); if (guard) return guard;` (401/403 NextResponse). Both resolve role from `users.role === 'platform_admin'`.
6. **CONFIRMED:** `notifyAssignmentCreated` (`SPARK_API_URL/api/integration/webhooks/core`, Bearer `CORE_SPARK_API_SECRET`) is the ONLY outbound SPARK call in V2. No student-launch JWT minting exists.
7. **Per-school SPARK key lives in `platform_links.api_key` (UNIQUE(school_id,product), upsert onConflict 'school_id,product'), NOT in env.** `CORE_SPARK_API_SECRET` is the global webhook bearer; `SPARK_API_URL` defaults to `https://spark.inteliflowai.com`. RLS denies non-platform-admin clients → admin client required.
8. Minor: `(super-admin)/layout.tsx` nav uses raw `text-[var(--fg)]` arbitrary-value classes on 3 links (token-class discipline violation); fix opportunistically if touched.

Key signatures the designer needs:
- `provisionSparkLink(admin: SupabaseClient, { schoolId, apiKey, coreBaseUrl?, label? }): Promise<void>` — `src/lib/spark/sparkLink.ts:34`
- `getSparkLink(admin, schoolId): Promise<SparkLink|null>` / `isSparkEnabled(admin, schoolId): Promise<boolean>` — sparkLink.ts:12,23
- `guardPlatformAdmin(): Promise<NextResponse|null>` — `src/lib/auth/guards.ts:31`
- `requireRole(allowed: readonly Role[]): Promise<AuthedContext>` — `src/lib/auth/requireRole.ts:18`
- `provisionTrial(ProvisionTrialInput): Promise<ProvisionTrialResult>` — `src/lib/trial/provisionTrial.ts:63`
- POST `/api/admin/provision-trial` → 201 `{ school_id, trial_expires_at, roster_status, credentials_summary: { shared_password, accounts } }`
