# Grounding — SPARK integration endpoints + provisioning substrate (sub-project A)

READ-ONLY verbatim facts. Repo: SPARK = `C:/users/inteliflow/spark-platform` (Next.js 16 App Router, TS, own Supabase). Captured 2026-06-20. Quotes are `file:line`.

---

## 0. TOP-LINE FLAGS (read first)

- **NO provisioning/registration endpoint exists in SPARK.** `app/api/admin/schools/route.ts` exposes only `GET` (list) + `PATCH` (whitelisted `voice_input_enabled`). Its `POST` was **deliberately retired**:
  > `app/api/admin/schools/route.ts:134-139`
  > "POST handler retired ... School provisioning lives entirely in CORE now via `/platform/schools` (UI) + `/api/teacher/platform/schools` (API). SPARK does not provision schools; it receives them via the CORE→SPARK bridge (core_spark_links + the spark_assignment_created webhook)."
- **There is NO HTTP endpoint that creates a `spark_schools` row or a `core_spark_links` row.** Today both rows are created ONLY by **local tsx scripts run with the service-role key**: `scripts/link-core-school.ts` (Demo Academy) and `scripts/link-eduflux-pilot.ts` (dedicated tenant). There is no Bearer-authed CORE→SPARK provision route. A new `POST /api/integration/provision-school` would be **net-new**.
- The webhook handler **rejects with `school_not_linked` if no `core_spark_links` row** exists for the incoming `core_school_id` (with `enabled=true`) — proving the link MUST be pre-created before any assignment/auth handoff works. Exact code quoted in §1.
- `admin/integrations/core` POST `action: "create_link"` CAN create a `core_spark_links` row, but it is gated on a **logged-in SPARK sysadmin/platform_admin session** (`auth.getUser()` + role check) and uses **the caller's own `spark_school_id`** — it cannot create a NEW `spark_schools` tenant, and is not callable machine-to-machine from CORE.

---

## 1. Integration routes (all of `app/api/integration/**`)

```
app/api/integration/auth/route.ts                 GET   — CORE JWT student pre-auth handoff
app/api/integration/core/route.ts                 POST  — public integration API (Bearer = core_spark_links.api_key)
app/api/integration/core/health/route.ts          GET   — health probe (Bearer = api_key)
app/api/integration/webhooks/core/route.ts        POST  — spark_assignment_created receiver (Bearer = CORE_SPARK_API_SECRET)
app/api/integration/webhooks/core/test/route.ts   (test harness)
app/api/integration/highlevel/leads/route.ts      (GoHighLevel CRM — unrelated)
app/api/integration/highlevel/test/route.ts        (unrelated)
```

### School-link resolution + reject-when-unlinked (the webhook), VERBATIM

`app/api/integration/webhooks/core/route.ts:227-260`:
```ts
    // ── School link ──
    const { data: link } = await supabase
      .from("core_spark_links")
      .select("spark_school_id")
      .eq("core_school_id", data.school_id)
      .eq("enabled", true)
      .maybeSingle();

    if (!link) {
      const response = { success: false, error: "school_not_linked" };
      await persistIdempotencyResult(supabase, idempotencyKey, 200, response);
      return NextResponse.json(response);
    }
    const sparkSchoolId = link.spark_school_id;

    // ── Per-tenant feature gate ──
    const coreEnabled = await isSchoolFeatureEnabled(sparkSchoolId, "core_integration");
    if (!coreEnabled) {
      await supabase.from("spark_system_events").insert({ event_type: "webhook_rejected_flag_disabled", ... });
      const response = { success: false, error: "core_integration_disabled" };
      await persistIdempotencyResult(supabase, idempotencyKey, 200, response);
      return NextResponse.json(response);
    }
```
The same lookup gates the **student auth handoff** at `app/api/integration/auth/route.ts:37-55`:
```ts
    // 2. Verify school link
    const { data: link } = await admin
      .from("core_spark_links")
      .select("spark_school_id")
      .eq("core_school_id", payload.core_school_id)
      .eq("enabled", true)
      .maybeSingle();

    if (!link) { return redirectWithError(request, "school_not_linked"); }
    const coreEnabled = await isSchoolFeatureEnabled(link.spark_school_id, "core_integration");
    if (!coreEnabled) { return redirectWithError(request, "core_integration_disabled"); }
```
Both surfaces match on `core_school_id` (the CORE-side school UUID) + `enabled=true`, then resolve `spark_school_id`. **Provisioning must pre-create this row keyed by CORE's school id.**

---

## 2. Auth pattern for the bridge endpoints

Two DISTINCT auth schemes:

**(a) Webhook receiver** uses the shared env secret with constant-time compare.
`app/api/integration/webhooks/core/route.ts:109-113`:
```ts
    const authHeader = request.headers.get("authorization");
    if (!bearerMatches(authHeader, process.env.CORE_SPARK_API_SECRET)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
```
`lib/auth/timingSafe.ts` (full):
```ts
import { createHash, timingSafeEqual } from "crypto";
export function bearerMatches(authHeader, secret): boolean {
  if (!authHeader || !secret) return false;
  const presented = createHash("sha256").update(authHeader).digest();
  const expected  = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(presented, expected);
}
```
Note: `expected` hashes the literal string `` `Bearer ${secret}` `` — caller must send header `Authorization: Bearer <CORE_SPARK_API_SECRET>`.

**(b) `core` + `core/health`** authenticate by **per-link `api_key`** (NOT the env secret), looked up directly in `core_spark_links`:
`app/api/integration/core/route.ts:11-32` — `validateApiKey()` does `.from("core_spark_links").select(...).eq("api_key", apiKey).eq("enabled", true).single()`. `core/health/route.ts:16-21` is the same pattern (`.single()`).
The link script explicitly notes the api_key is "per-link, not currently used by SPARK's webhook auth" (`scripts/link-core-school.ts:156-159`).

**(c) JWT student handoff** (`integration/auth`) verifies an HS256 JWT signed with `CORE_SPARK_API_SECRET` via `verifyCoreJWT` (`lib/integration/core-client.ts:164-...`). Required claims: `core_user_id`, `core_school_id`, `exp`; optional `spark_attempt_id`, `return_url`, `iss` (must equal `"inteliflow-core"` if present), `alg` must be `HS256`. Deterministic SPARK auth user is `core_<core_user_id>@spark.inteliflowai.com` / password `spark_core_<core_user_id>_<CORE_SPARK_API_SECRET>` (`auth/route.ts:58-59`).

**A new provision endpoint should use scheme (a) — `bearerMatches(authHeader, process.env.CORE_SPARK_API_SECRET)` — since CORE has that secret and there is no per-link api_key yet at provision time.**

---

## 3. Table shapes (verbatim from migrations)

### `spark_schools` — base def + all later ALTERs

`supabase/migrations/001_initial_schema.sql:8-17`:
```sql
CREATE TABLE spark_schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid UNIQUE NOT NULL,                  -- SPARK-internal canonical id, NO DEFAULT (caller must supply)
  name text NOT NULL,
  tier text NOT NULL DEFAULT 'software' CHECK (tier IN ('software','standard','robotics')),
  country text NOT NULL DEFAULT 'US',
  language text NOT NULL DEFAULT 'en',
  settings jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
```
Later columns added (current effective shape):
- `012_trial_system.sql:5-7,13-14`: `trial_expires_at timestamptz NULL`, `trial_student_limit integer DEFAULT 10`, `trial_started_at timestamptz NULL`; tier CHECK widened to `('software','standard','robotics','trial')`.
- `013_class_codes.sql:5`: `class_code text UNIQUE DEFAULT encode(gen_random_bytes(4),'hex')` (8-char hex; auto-generated — provisioning need NOT supply it). Index `idx_schools_class_code`.
- `018_voice_input_flag.sql`: `voice_input_enabled` (added; whitelisted PATCH target).
- `019_customer_management.sql:21-36`: `seat_limit integer NULL`, `status text NOT NULL DEFAULT 'active'` with CHECK `status IN ('active','suspended','cancelled')`, `notes text NULL`.
- `021_feature_flags.sql:18-19`: `feature_flags jsonb NOT NULL DEFAULT '{}'` (convention: missing/null key = ON; explicit `false` = OFF; key `core_integration` gates the bridge).
- `033_spark_schools_self_read_rls.sql`: RLS self-read policy `schools_read_own` (server admin client bypasses RLS).

**Provisioning a spark_schools row REQUIRES `school_id` (uuid, UNIQUE, NOT NULL, no default).** The eduflux script supplies `randomUUID()` for it and explicitly comments it is "SPARK-internal canonical id (unique, not the CORE id)" (`scripts/link-eduflux-pilot.ts:94`). `name` is also NOT NULL. Everything else defaults.

### `core_spark_links`

`supabase/migrations/001_initial_schema.sql:238-246`:
```sql
CREATE TABLE core_spark_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  core_school_id uuid UNIQUE NOT NULL,                       -- the CORE-side school id; UNIQUE = one link per CORE school
  spark_school_id uuid NOT NULL REFERENCES spark_schools(id),
  enabled boolean DEFAULT true,
  sync_settings jsonb DEFAULT '{}',
  api_key text NOT NULL DEFAULT gen_random_uuid()::text,     -- auto-generated per-link Bearer key
  created_at timestamptz DEFAULT now()
);
```
`035_core_spark_links_core_base_url.sql:6`: `ALTER TABLE public.core_spark_links ADD COLUMN IF NOT EXISTS core_base_url text;` (NULL = use `CORE_API_URL` env default for SPARK→CORE completion webhook).

**Idempotent link create requires only `core_school_id` (UNIQUE NOT NULL) + `spark_school_id` (FK NOT NULL).** `enabled` defaults true; `api_key` auto-generates; `sync_settings` defaults `{}`. Conflict target for upsert = `core_school_id` (the unique col).

### `core_experiment_assignments` (context for completion flow)

`001_initial_schema.sql:248-258`: `core_homework_id uuid UNIQUE NOT NULL`, `experiment_id` FK→experiments, `student_id` FK→spark_users, `spark_attempt_id` FK→experiment_attempts, `status` CHECK `('assigned','in_progress','completed','late')`. NOTE: the webhook upserts on composite `(core_homework_id, student_id)` (`webhooks/core/route.ts:466`) — the single-col UNIQUE on `core_homework_id` in 001 is later relaxed; migration 035 adds partial unique index `idx_attempts_core_homework_student` (referenced at `webhooks/core/route.ts:410-411`). Verify 035 if assignment uniqueness matters.

---

## 4. Where a new `POST /api/integration/provision-school` slots in

- Route folder convention: create `app/api/integration/provision-school/route.ts` exporting `export async function POST(request: NextRequest)` — mirrors `webhooks/core/route.ts`.
- Auth: `if (!bearerMatches(request.headers.get("authorization"), process.env.CORE_SPARK_API_SECRET)) return 401` (scheme (a)).
- DB client: `const supabase = createAdminSupabaseClient();` (service-role, bypasses RLS) from `@/lib/supabase/server`.
- Idempotent body, minimal required fields:
  - `spark_schools`: must set `school_id` (uuid — generate or accept from CORE), `name` (NOT NULL). Recommend look-up-or-insert by `school_id` (UNIQUE) to be idempotent. `class_code` auto-generates (UNIQUE hex); `feature_flags` default `{}` (set `{ core_integration: true }` to be explicit per the eduflux pattern). `tier`/`country`/`language`/`status` all default.
  - `core_spark_links`: upsert on `core_school_id` with `spark_school_id` set; `enabled` defaults true, `api_key` auto-generates. Optionally `core_base_url`.
- Existing idempotent reference implementation to mirror: `scripts/link-eduflux-pilot.ts:70-145` (look-up-or-create dedicated spark_schools by name, then upsert core_spark_links by core_school_id) and `scripts/link-core-school.ts:65-147` (refresh-or-insert by core_school_id / by spark_school_id).

---

## 5. How a `core_spark_links` row gets created TODAY (no endpoint)

1. **`scripts/link-core-school.ts`** (Demo Academy path): `npx tsx scripts/link-core-school.ts <core_school_uuid> [core_base_url]`. Finds `spark_schools` by `name = DEMO_SCHOOL_NAME` (does NOT create the school — errors if missing, telling you to run `seed-demo.ts`), then refresh-or-insert `core_spark_links`. Uses `SUPABASE_SERVICE_ROLE_KEY`. (`scripts/link-core-school.ts:65-147`.)
2. **`scripts/link-eduflux-pilot.ts`**: creates a DEDICATED `spark_schools` tenant (insert with `school_id: randomUUID()`, `status:'active'`, `feature_flags:{core_integration:true}`) then upserts `core_spark_links` keyed by `core_school_id`. (`scripts/link-eduflux-pilot.ts:91-145`.) This is the closest existing analog to provision-school logic.
3. **`POST /api/admin/integrations/core` `action:"create_link"`** (`admin/integrations/core/route.ts:118-141`): session-authed (sysadmin/platform_admin), inserts `core_spark_links` using the CALLER's `spark_school_id` + posted `core_school_id`. Cannot create a new tenant; not machine-callable.

`spark_schools` rows otherwise come from the demo seed (`lib/demo/seed.ts` / `scripts/seed-demo.ts`) and the eduflux script — **never** from an HTTP API (admin POST retired).

---

## 6. Env / identifiers the designer needs

- `CORE_SPARK_API_SECRET` — shared secret; webhook Bearer auth + JWT HMAC signing key. MUST match on both CORE and SPARK.
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — SPARK admin client.
- `CORE_API_URL` — default base for SPARK→CORE completion webhook (per-school override = `core_spark_links.core_base_url`).
- Helper: `isSchoolFeatureEnabled(sparkSchoolId, "core_integration")` from `@/lib/tenancy/featureFlags` (default-ON unless explicit `false`).
- Admin client: `createAdminSupabaseClient()` (sync) / `createServerSupabaseClient()` (async, session) from `@/lib/supabase/server`.
- SPARK roles seen in code: `student | teacher | admin | sysadmin` (migration 001 CHECK) BUT integration/admin routes check `school_sysadmin | platform_admin` (`admin/integrations/core/route.ts:21`, `admin/schools/route.ts:21,88`) — **role-name DISCREPANCY** between the 001 CHECK and the role strings the admin routes test; flag for designer (the CHECK constraint may have been altered in a later migration not in the spark_schools grep set, or these routes may silently 403).
