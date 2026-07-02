# SPARK-platform grounding facts — CORE↔SPARK tenancy, provisioning, shared secret
All paths relative to `C:/users/inteliflow/spark-platform` unless noted. Repo HEAD: `3cb1958` (PR #7).

---

## 1. `core-integration/` — the CORE↔SPARK contracts that exist today

Four files + README. These are **reference implementations meant to be copied INTO CORE**, not code SPARK executes (`core-integration/README.md:1-3`: "These files are designed to be added to the CORE platform (app.inteliflowai.com) to enable SPARK integration.").

| File | Role | Key facts |
|---|---|---|
| `spark-client.ts` | CORE→SPARK API client ("Drop into: core-platform/lib/spark/client.ts", `spark-client.ts:2`) | All calls POST to `${SPARK_API_URL}/api/integration/core` with `Authorization: Bearer ${SPARK_SCHOOL_API_KEY}` (`spark-client.ts:13-18`). Actions: `get_student_profile`, `get_experiment_suggestions`, `create_assignment`, `get_attempt_result`, `sync_student_roster` (`spark-client.ts:32-67`). 10s AbortSignal timeout, "NEVER block CORE on SPARK availability" (`spark-client.ts:20,26`). Also mints the pre-auth JWT (see §4) and builds the handoff URL: `getSparkExperimentUrl` → `${SPARK_API_URL}/api/integration/auth?token=…&redirect=/student/experiment/${attemptId}` (`spark-client.ts:110-113`). |
| `attempt-complete-route.ts` | SPARK→CORE signal-return receiver ("Drop into: core-platform/app/api/spark/attempt-complete/route.ts", line 2) | Verifies `authHeader !== 'Bearer ' + CORE_SPARK_API_SECRET` (plain `!==`, `attempt-complete-route.ts:10-15`). DB writes are **commented-out placeholders** (`:33-59`); payload fields: `core_homework_id, student_id, completed_at, score, effort_label, revision_count, teli_hint_count, signal_summary` (`:18-27`). |
| `experiment-homework-card.tsx` | CORE student homework card (`:1-3`) | Client component; props `homework, coreUserId, coreSchoolId` (`:22-26`). |
| `spark-signals-tab.tsx` | **CORE teacher view of a student's SPARK data** (`:1-3`: "Drop into: core-platform/components/teacher/SparkSignalsTab.tsx") | Renders the `get_student_profile` response: `attempt_summary` (total/completed/avg_score/avg_revision_count/avg_hint_count/dominant_effort) + `recent_attempts[]` (`:11-30`). This is the existing (V1-era, copy-file) contract for a teacher-facing SPARK view. |

README env contract for CORE (`core-integration/README.md:21-26`):
```
SPARK_API_URL=https://spark.inteliflowai.com
SPARK_SCHOOL_API_KEY=sk-spark-xxx  # Get from SPARK admin
SPARK_ENABLED=true
CORE_SPARK_API_SECRET=xxx  # Shared secret for JWT signing
```

**Live inbound/outbound contracts on the SPARK side (executed code, not core-integration/):**
- `app/api/integration/core/route.ts` — the 5-action API-key endpoint (see §5).
- `app/api/integration/core/health/route.ts` — health, API-key auth.
- `app/api/integration/webhooks/core/route.ts` — `spark_assignment_created` payload-direct webhook, Bearer `CORE_SPARK_API_SECRET`, `X-Idempotency-Key` dedupe, never 5xx (`:16-25`), inline generation await (`:498-534`).
- `app/api/integration/auth/route.ts` — CORE→SPARK student pre-auth (JWT handoff).
- `app/api/integration/provision-school/route.ts` — see §2.
- `lib/integration/core-client.ts` — SPARK→CORE: `notifyCoreAttemptComplete` POSTs to `${base}/api/attempts/spark-attempt-complete` with `Authorization: Bearer ${CORE_SPARK_API_SECRET}` + `X-Idempotency-Key = core_homework_id_student_id[_scored]` (`core-client.ts:123-137`), retries `[1s,5s,15s]`, no retry on 4xx (`:95-96,144-148`).
- `lib/integration/coreShortcut.ts` — SPARK→CORE "I got this" endpoints via a **separate key** `CORE_PLATFORM_API_KEY` (`coreShortcut.ts:33-35`): `POST ${CORE_API_URL}/api/attempts/platform/mastery-check` (2s timeout), `/extension-problem` (20s, one retry), `/event` (2s fire-and-forget) (`:30-31,77,147,247`).

---

## 2. `POST /api/integration/provision-school` — exact behavior

File: `app/api/integration/provision-school/route.ts` (added in `78039b1`, merged `15c7085`).

- **Auth:** constant-time Bearer check of the shared secret (`route.ts:11-21`):
```ts
if (!bearerMatches(request.headers.get("authorization"), process.env.CORE_SPARK_API_SECRET,)) {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
}
```
- **Body:** `{ core_school_id, name, core_base_url? }`; 400 on malformed JSON or missing id/name (`route.ts:23-46`).
- **Idempotent:** reuses an existing link's `spark_school_id` if a `core_spark_links` row exists for the `core_school_id` (`route.ts:51-62`).
- **Creates (when no link):** a new `spark_schools` row with `school_id: randomUUID()`, `name`, `status: "active"`, `feature_flags: { core_integration: true }` (`route.ts:64-72`).
- **Flag merge:** read-merge-write of `feature_flags` so `core_integration: true` never clobbers other flags (`route.ts:85-104`).
- **Linkage storage — the upsert (verbatim, `route.ts:106-119`):**
```ts
const { data: link, error: linkErr } = await admin
  .from("core_spark_links")
  .upsert(
    {
      core_school_id: coreSchoolId,
      spark_school_id: sparkSchoolId,
      core_base_url: coreBaseUrl,
      enabled: true,
    },
    { onConflict: "core_school_id" },
  )
  .select("id")
  .single();
```
- **Returns:** `{ success: true, spark_school_id, core_spark_link_id, created }` (`route.ts:131-136`). Internal errors return `{ success:false, error }` with **status 200** (`route.ts:74-80,121-129,137-142`).

**`core_spark_links` schema** (`supabase/migrations/001_initial_schema.sql:238-246`):
```sql
CREATE TABLE core_spark_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  core_school_id uuid UNIQUE NOT NULL,
  spark_school_id uuid NOT NULL REFERENCES spark_schools(id),
  enabled boolean DEFAULT true,
  sync_settings jsonb DEFAULT '{}',
  api_key text NOT NULL DEFAULT gen_random_uuid()::text,
  created_at timestamptz DEFAULT now()
);
```
plus `core_base_url` added later (`supabase/migrations/035_core_spark_links_core_base_url.sql:6`):
```sql
ALTER TABLE public.core_spark_links ADD COLUMN IF NOT EXISTS core_base_url text;
```
Note the row also carries a per-school **`api_key`** (auto-generated uuid) — this is the `SPARK_SCHOOL_API_KEY` CORE uses for `/api/integration/core` (§5).

Related linkage table `core_experiment_assignments` (`001_initial_schema.sql:248-258`): `core_homework_id`, `experiment_id`, `student_id → spark_users(id)`, `core_class_id`, `spark_attempt_id → experiment_attempts(id)`, `due_date`, `status`; composite unique `(core_homework_id, student_id)` used in upserts (`webhooks/core/route.ts:473`; partial unique index `idx_attempts_core_homework_student`, migration 035 per `webhooks/core/route.ts:413-418`).

---

## 3. How SPARK resolves which CORE a school belongs to

`lib/integration/core-client.ts:11-26` — verbatim:
```ts
/** Resolve the per-school CORE base URL from core_spark_links by the SPARK
 *  school id. Returns undefined when unset → caller falls back to the env
 *  default (US CORE). EduFlux schools store their eduflux.datanex.ai base
 *  URL here so completion webhooks reach the right CORE deployment. */
export async function resolveCoreBaseUrl(
  supabase: SupabaseClient,
  sparkSchoolId: string,
): Promise<string | undefined> {
  const { data } = await supabase
    .from("core_spark_links")
    .select("core_base_url")
    .eq("spark_school_id", sparkSchoolId)
    .eq("enabled", true)
    .maybeSingle();
  return (data?.core_base_url as string | null | undefined) || undefined;
}
```
Fallback default: `getCoreApiUrl()` = `process.env.CORE_API_URL || "https://app.inteliflowai.com"` (`core-client.ts:7-9`). Before the override is used, it is SSRF-guarded: `isPublicHttpsUrl` requires https, rejects localhost/`.localhost`, IPv6 literals, and any IPv4 literal (`core-client.ts:39-48`); `notifyCoreAttemptComplete` refuses an unsafe override with `"Unsafe core_base_url override"` (`core-client.ts:118-120`) — added in PR #7.

---

## 4. The shared secret(s)

**Primary shared secret: `CORE_SPARK_API_SECRET`** — one symmetric secret used for four distinct things:

1. **Bearer auth on SPARK inbound endpoints** — `provision-school` (`provision-school/route.ts:11-15`) and the CORE webhook (`webhooks/core/route.ts:110-113`), both via constant-time `bearerMatches` (`lib/auth/timingSafe.ts:11-19`):
```ts
export function bearerMatches(authHeader: string | null | undefined, secret: string | null | undefined): boolean {
  if (!authHeader || !secret) return false;
  const presented = createHash("sha256").update(authHeader).digest();
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(presented, expected);
}
```
2. **Bearer auth on SPARK→CORE calls** — `notifyCoreAttemptComplete` sends `Authorization: Bearer ${getCoreSecret()}` (`core-client.ts:133`).
3. **HMAC key for the CORE-minted student handoff JWT** — verified in `verifyCoreJWT` (`core-client.ts:187-292`):
   - Algorithm enforced: `header.alg !== "HS256"` → reject (`core-client.ts:212-214`).
   - Signature: `crypto.createHmac("sha256", secret)` over `header.payload`, base64url, compared with `crypto.timingSafeEqual` (`core-client.ts:217-229`; the constant-time compare was PR #7 — previously `!==`).
   - Required claims: `core_user_id`, `core_school_id`, `exp` (`core-client.ts:242-250`); optional `spark_attempt_id`, `return_url`, `iat`, `nbf`, `iss`.
   - Issuer check only **if present**: `payload.iss !== "inteliflow-core"` → reject (`core-client.ts:253-255`).
   - **TTL:** `exp` checked with 30s clock-skew tolerance (`core-client.ts:257-261`); `nbf` honored with +30s skew if present (`core-client.ts:264-266`). The CORE-side reference mints `exp = now + 600` (**10 minutes**, `core-integration/spark-client.ts:98`).
   - **No nonce / jti / one-time-use tracking anywhere in `verifyCoreJWT` or `/api/integration/auth`** — a token is replayable until `exp`. (Replay protection exists only for *webhooks*, via the `X-Idempotency-Key` + `webhook_idempotency_keys` table, composite `UNIQUE (endpoint, idempotency_key)` — `supabase/migrations/029_payload_direct_integration.sql:100-107`, probed at `webhooks/core/route.ts:122-150`.)
4. **Deterministic student password salt** — `/api/integration/auth` derives each CORE-handoff student's Supabase credentials from it (`integration/auth/route.ts:61-63`):
```ts
const email = `core_${payload.core_user_id}@spark.inteliflowai.com`;
const password = `spark_core_${payload.core_user_id}_${process.env.CORE_SPARK_API_SECRET}`;
```

**Secondary secrets/keys:**
- **Per-school `core_spark_links.api_key`** (`SPARK_SCHOOL_API_KEY` on the CORE side) — authenticates `/api/integration/core` + `/api/integration/core/health`; looked up with `.eq("api_key", apiKey).eq("enabled", true).single()` (`integration/core/route.ts:20-25`) — plain DB lookup, not timing-safe, and this is what makes every action school-scoped.
- **`CORE_PLATFORM_API_KEY`** — separate Bearer key for the CORE "platform shortcut" endpoints (`lib/integration/coreShortcut.ts:12,33-35`).
- **`lib/auth/signedToken.ts`** (PR #5) — HMAC-signed password-reset tokens; **fails CLOSED when the secret env is unset** and compares constant-time (commit `82b9363` message: "New lib/auth/signedToken.ts (HMAC) fails CLOSED when the secret env is unset and compares constant-time").

Standing note from the CORE repo's CLAUDE.md: recommendation to ROTATE `CORE_SPARK_API_SECRET` (the literal lived in private-repo git history).

---

## 5. Tenancy enforcement, RLS posture, security PRs #4–#7

### How routes scope to a school
- **API-key routes (`/api/integration/core`, `/health`):** the key IS the tenant. `validateApiKey` resolves the `core_spark_links` row; every handler filters by `link.spark_school_id` — e.g. `get_student_profile` requires `.eq("core_user_id", …).eq("school_id", link.spark_school_id)` (`integration/core/route.ts:86-91`); `create_assignment` verifies the experiment is global or school-owned: "Restrict to the global catalog (school_id IS NULL) or the linked school's own… 404 (not 403) so we don't leak existence" (`integration/core/route.ts:196-211`, closed in PR #5); `get_attempt_result` re-verifies every assignment's student `school_id === link.spark_school_id`, 403 otherwise (`integration/core/route.ts:374-385`). One residual: the health route's `failed_signal_returns_7d` counts `core_signal_failed` events with **no school filter** (`integration/core/health/route.ts:64-69`) — PR #7 scoped the *admin* dashboard count (`app/api/admin/integrations/core/route.ts`), not this one.
- **Shared-secret routes (webhook, provision):** the CORE-supplied `school_id`/`core_school_id` is mapped through `core_spark_links` (`.eq("core_school_id", data.school_id).eq("enabled", true)`) and rejected as `school_not_linked` when absent (`webhooks/core/route.ts:234-246`; `integration/auth/route.ts:41-51`); then the per-tenant `core_integration` feature flag is checked (`isSchoolFeatureEnabled`, `lib/tenancy/featureFlags.ts:42-51` — default-ON, explicit `false` = off).
- **Student runner API routes:** self-scoping ownership guard `requireAttemptOwner` — authenticated `spark_user` must own the attempt (`lib/auth/attemptOwnership.ts:22-58`); header comment: "These routes were originally shipped without any auth check (middleware only guards /dashboard pages, not /api/*)… Closed 2026-06-11" (`attemptOwnership.ts:9-12`).
- **Middleware:** only redirects unauthenticated users off `/dashboard` paths (`middleware.ts:32-37`); `/api/*` is NOT middleware-guarded — each route self-guards.
- **App DB access:** effectively **service-role only** — `createAdminSupabaseClient()` uses `SUPABASE_SERVICE_ROLE_KEY` (`lib/supabase/server.ts:31-42`), bypassing RLS; migration 036 states "every application read of these tables uses the service-role client… the only browser/authenticated read is spark_users (own row)" (`036_rls_tenant_isolation_fix.sql:12-16`).

### RLS posture
- Migration `020_rls_hardening.sql`: defense-in-depth pass; tables without a browser read path (e.g. `spark_system_events`) enabled with **no policy = locked except service role** (`020:34-38`); `core_spark_links` originally school-scoped for ALL roles (`020:38-43`).
- Migration `036_rls_tenant_isolation_fix.sql` (PR #4, applied to SPARK prod 2026-06-25): closed four LIVE cross-tenant holes where staff branches were **role-only with no school predicate** — `experiment_attempts` (any teacher could read/write EVERY school's attempts), `spark_users` (school_sysadmin cross-school), `spark_gamification`, `spark_xp_events`; adds SECURITY DEFINER `spark_student_in_my_school(uuid)` (`036:25-41`) and re-scopes each staff branch to `public.spark_student_in_my_school(student_id)` (`036:44-97`). `core_spark_links` — which "held the CORE api_key + core_base_url and was readable/writable by every role in the school" — is now restricted to `platform_admin` or same-school `school_sysadmin` (`036:99-115`).
- `webhook_idempotency_keys`: RLS enabled, `GRANT ALL … TO service_role` only (`029:113-116`).
- Roles: `spark_users.role` CHECK is now `('student', 'teacher', 'school_sysadmin', 'platform_admin')` (`027_retire_school_admin_role.sql:42-44`; original was `('student','teacher','admin','sysadmin')`, `001:26`). `school_admin` retired in 027 ("CORE owns school-level administration end-to-end", `027:3-5`).

### Security PRs #4–#7 (all 2026-06-25, same audit)
- **#4 `9c9cf08`** — the RLS pass above (migration 036 only).
- **#5 `82b9363`** — "close remaining audit criticals + HIGH auth/IDOR holes": unauthenticated `/api/trial` PUT (created auth users + returned passwords) now requires session + school-ownership/platform_admin; `/api/auth/student-session` gained the suspended/cancelled-school gate + audit; `/api/admin/system` clear-data actions require typed confirmation; `/api/auth/reset` moved off a hardcoded-fallback secret + `!==` compare to fail-closed HMAC `lib/auth/signedToken.ts`; test-extension/mastery probes scoped to caller's school; `integration/core` `create_assignment` experiment-assignability check. Deferred: generation-cache school scoping.
- **#6 `119e9bc`** — (a) migration `037_cache_school_scope.sql`: `experiment_attempt_content` cache now carries `school_id`, `lookupCache` filters by it and bails when school unknown; (b) **standalone login blocked for CORE-linked schools** — now-mandatory pattern, verbatim (`app/api/auth/student-session/route.ts:38-53`):
```ts
// CORE-linked schools authenticate students through CORE's signed handoff
// (/api/integration/auth), not this standalone class-code+name path. Reject
// here so the weaker standalone flow can't be used where a strong CORE path
// exists. Genuinely standalone (non-linked) schools still use this route.
const { data: coreLink } = await admin
  .from("core_spark_links")
  .select("id")
  .eq("spark_school_id", school.id)
  .eq("enabled", true)
  .maybeSingle();
if (coreLink) {
  return NextResponse.json(
    { error: "Please sign in through your school's CORE portal." },
    { status: 403 },
  );
}
```
  Commit rationale: "production data shows ALL student logins go through CORE's signed handoff … 18 CORE-handoff logins, 0 via the standalone class-code+name path; both live schools are CORE-linked."
- **#7 `3cb1958`** — MED/LOW batch: `isPublicHttpsUrl` guard before POSTing the shared secret to the tenant-stored `core_base_url` (SSRF/secret-exfil); `verifyCoreJWT` → `timingSafeEqual`; `/api/integration/auth` post-sign-in redirect sanitized to same-origin relative paths (`integration/auth/route.ts:23-27`); submit's CORE webhook moved into `after()`; signals route reports real accepted count (207 on partial); inbound webhook payload capped 256KB (`webhooks/core/route.ts:153-157`); Teli anti-prompt-injection; admin failed-signal count school-scoped.

### Mandatory patterns now in force (as established by these PRs / current code)
- Constant-time comparison for every shared-secret check (`bearerMatches`, `timingSafeEqual` in JWT verify, `signedToken`).
- Every staff RLS branch must carry a school predicate (`spark_student_in_my_school`).
- API-key handlers must filter every query by `link.spark_school_id`; cross-school probes return 404 to avoid existence leaks.
- Student runner `/api` routes must call `requireAttemptOwner` (middleware does not cover `/api/*`).
- CORE-linked schools: standalone class-code student login is rejected; CORE's signed handoff is the only student entry.
- Tenant-stored URLs must pass `isPublicHttpsUrl` before receiving the shared secret.
- Inbound CORE webhooks: never 5xx; idempotency via `X-Idempotency-Key` + `webhook_idempotency_keys (endpoint, idempotency_key)`.

### Facts bearing on the planned teacher read-only view
- `/api/integration/auth` **always creates/authenticates `role: "student"`** (`integration/auth/route.ts:151`, insert `role: "student"`); there is no teacher handoff path.
- The only attempt-review UI is the student's own: `app/(dashboard)/student/experiment/[sessionId]` and `app/(dashboard)/student/lab/artifact/[attemptId]` (directory listing); no teacher-facing attempt page exists under `app/(dashboard)/dashboard` or `admin` for CORE-linked review.
- Existing teacher-consumable attempt data already crosses the wire school-scoped via `get_student_profile` / `get_attempt_result` on `/api/integration/core` (Bearer per-school `api_key`), which is exactly what `core-integration/spark-signals-tab.tsx` renders.