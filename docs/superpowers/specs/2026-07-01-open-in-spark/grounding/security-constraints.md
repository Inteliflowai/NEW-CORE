# SECURITY-CONSTRAINTS GROUNDING — CORE→SPARK teacher-handoff feature

## 1. The current handoff token (CORE mints, SPARK verifies)

### CORE side — mint

**Route:** `C:/users/inteliflow/new-core/src/app/api/attempts/spark-launch/route.ts`
- Auth chain: `getUser()` → student-ownership guard → admin client (lines 10–26). The ownership guard is student-only:
  ```ts
  if ((assignment.student_id as string) !== user.id) return NextResponse.json({ error: 'Not your assignment' }, { status: 403 });
  ```
  (`route.ts:25`)
- Token assembly + launch URL (lines 45–56):
  ```ts
  const token = signLaunchJwt({
    core_user_id: student.id as string,
    core_school_id: student.school_id as string,
    spark_attempt_id: assignment.spark_attempt_id as string,
    email: ..., full_name: ..., grade,
    return_url: returnUrl,
  });
  const redirectPath = `/student/experiment/${assignment.spark_attempt_id as string}`;
  const launch_url = `${SPARK_API_URL}/api/integration/auth?token=${token}&redirect=${encodeURIComponent(redirectPath)}`;
  ```
  Note the token travels as a **URL query parameter** (loggable in proxies/browser history).

**Signer:** `C:/users/inteliflow/new-core/src/lib/spark/signLaunchJwt.ts:19-25`
```ts
export function signLaunchJwt(claims: LaunchClaims, ttlSeconds = 900): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ ...claims, iss: 'inteliflow-core', iat: now, exp: now + ttlSeconds }));
  const sig = createHmac('sha256', CORE_SPARK_API_SECRET).update(`${header}.${payload}`).digest('base64url');
```
- **Algorithm:** hand-rolled HS256 (HMAC-SHA256), no jsonwebtoken dep (`signLaunchJwt.ts:1-3`).
- **Claims:** `core_user_id`, `core_school_id`, `spark_attempt_id?`, `email?`, `full_name?`, `grade?`, `return_url?` (`signLaunchJwt.ts:7-15`) plus `iss: 'inteliflow-core'`, `iat`, `exp`. **There is NO role claim, NO audience claim, NO jti** — nothing distinguishes "student launch" from any other launch.
- **Secret env var:** `CORE_SPARK_API_SECRET` — `C:/users/inteliflow/new-core/src/lib/spark/config.ts:6` (`process.env.CORE_SPARK_API_SECRET || ''`). Same shared secret is reused across both repos.
- **Expiry:** default `ttlSeconds = 900` (15 min); `exp` in epoch **seconds** (`signLaunchJwt.ts:19,22`).
- **One-time-use?** **NO — replayable.** No `jti`, no nonce, no server-side single-use ledger anywhere. Any party who captures the token (URL leak) can replay it until `exp`, and SPARK will re-mint/sign-in the session each time.

### SPARK side — verify

**Route:** `C:/users/inteliflow/spark-platform/app/api/integration/auth/route.ts` (GET), verifier `C:/users/inteliflow/spark-platform/lib/integration/core-client.ts:187-292` (`verifyCoreJWT`).
- Structural + alg check: `parts.length !== 3`; `header.alg !== "HS256"` rejected (`core-client.ts:199,212`).
- **Signature compared constant-time** (hardened in PR #7):
  ```ts
  const sigA = Buffer.from(expectedSig);
  const sigB = Buffer.from(parts[2]);
  if (sigA.length !== sigB.length || !crypto.timingSafeEqual(sigA, sigB)) {
    return { valid: false, error: "Invalid JWT signature" };
  }
  ```
  (`core-client.ts:226-230`)
- Required claims: `core_user_id`, `core_school_id`, `exp` (strings/number) (`core-client.ts:242-250`).
- Issuer check: **only enforced if present** — `if (payload.iss && payload.iss !== "inteliflow-core")` (`core-client.ts:253`). A token with no `iss` still passes.
- Expiry: `payload.exp < now - 30` (30s skew) (`core-client.ts:257-261`). `nbf` honored if present. **No max-age ceiling, no replay/jti check on verify either.**
- **CRITICAL for the new feature — the verifier and the auth route HARD-CODE a student identity.** After JWT verify, `integration/auth/route.ts` creates or signs-in a `spark_users` row with **`role: "student"`** (`auth/route.ts:150`) and always deep-links into the student runner. There is no path in the token or the route that yields anything but a student session. The existing handoff cannot express "teacher, read-only" — reusing it *is* the impersonation risk.

## 2. Blast radius of a minted SPARK student session

A student session (what the current handoff produces) can reach these authenticated **write / paid-AI** surfaces (all gated only by `requireAttemptOwner`, i.e. "own the attempt"):

- **Submit an attempt** — `POST app/api/experiments/attempts/[id]/submit/route.ts:9`: sets `state:"completed"`, writes `evidence`, `revision_count`, `teli_hint_count`, bumps run_count, updates the student signal profile and gamification, and **fires the CORE completion webhook** (`notifyCoreAttemptComplete`) — i.e. it can push a completion/score back into CORE's gradebook/skill engine.
- **Save/clear draft state** — `PUT`/`DELETE app/api/experiments/attempts/[id]/draft/route.ts:57,122`.
- **Chat with Teli (paid LLM)** — `POST app/api/experiments/attempts/teli/route.ts:18` (Anthropic/OpenAI calls).
- **Trigger analysis/scoring (paid LLM)** — `POST app/api/experiments/attempts/[id]/analyze/route.ts:46`; also `test-extension-problem` and `test-mastery-check` POSTs.
- **Write behavioral signals** — `POST app/api/experiments/attempts/signals/route.ts:5` (feeds scaffolding + the CORE student model).
- **Transcribe audio (paid Whisper)** — `POST app/api/experiments/attempts/transcribe/route.ts:62`.
- **Voice telemetry** — `POST app/api/experiments/attempts/voice-event/route.ts:19`.
- **Self-knowledge / learning-profile writes** — `POST app/api/experiments/me/learning-profile/route.ts:109`.
- **Gamification read** — `GET app/api/gamification/route.ts` returns the **student** payload only (role-gated; teacher payload withheld from students).

All of the above are self-scoped to the **owning student's** attempt via `requireAttemptOwner` (`C:/users/inteliflow/spark-platform/lib/auth/attemptOwnership.ts:22-58`): it resolves `spark_users` by `auth_id`, loads the attempt, and rejects unless `attempt.student_id === sparkUser.id` (403). So a handed-off session is confined to that one student's attempts — but within that scope it can **mutate the attempt, submit it, spend AI budget, and push signals/completions back to CORE.** That is the exact blast radius a teacher-review session must NOT inherit.

## 3. SPARK's recent security hardening (must not regress)

### PR #4 `9c9cf08` — RLS tenant isolation (context, pre-#5)
- Scoped SPARK RLS to school to close live cross-tenant data exposure; migration `036_rls_tenant_isolation_fix.sql`. RLS helper `get_my_spark_role()`; policies gate on `auth_id = auth.uid()` OR role in `('teacher','school_sysadmin','platform_admin')` (see `027_retire_school_admin_role.sql:26-37`).

### PR #5 `82b9363` — remaining criticals + HIGH auth/IDOR
- **Unauthenticated privilege / account creation (`/api/trial` PUT):** was unauthenticated, created auth users and returned their passwords keyed only on `school_id`. Now **requires the caller's session and verifies the caller owns the school (or is platform_admin)** before creating students.
- **Session minting for suspended/cancelled schools (`/api/auth/student-session`):** now enforces a status gate (`school.status === "suspended"||"cancelled"` → 403) + audits each session (`route.ts:30-31`).
- **Destructive admin ops (`/api/admin/system`):** `clear_all_data`/`clear_test_data` now require a typed confirmation `{confirm:"<action>"}` and are audit-logged.
- **HIGH — signed-token fallback (`/api/auth/reset`):** removed the hardcoded `"spark-reset"` fallback secret and `!==` compare. New `lib/auth/signedToken.ts` uses HMAC, **fails CLOSED when the secret is unset, and compares constant-time.**
- **HIGH — cross-school IDOR (`test-extension-problem`/`test-mastery-check`):** a `school_sysadmin` could probe attempts in OTHER schools; now scoped to the caller's school via `experiment_sessions.school_id` (platform_admin bypasses).
- **HIGH — assignment IDOR (`integration/core` handleCreateAssignment):** could assign ANY experiment by UUID; now restricted to the global catalog (`school_id IS NULL`) or the linked school's own.
- **Enforced pattern:** every mutation resolves the caller's school and confirms ownership/tenant match before acting; secrets fail-closed + constant-time.

### PR #6 `119e9bc` — cache scoping + standalone-login block
- **Cache cross-tenant leak:** `experiment_attempt_content` cache was keyed only on `(profile_fingerprint, lesson_plan_fingerprint)` → two schools with identical lesson plans could serve each other's generated content. Migration `037_cache_school_scope.sql` adds `school_id`; pipeline resolves school before the cache step, writes it on the row, and `lookupCache` **filters by school_id and bails when school is unknown.**
- **Standalone-login block:** `app/api/auth/student-session/route.ts:38-53` now **rejects the class-code+name flow for any CORE-linked school** (checks `core_spark_links` enabled → 403 "sign in through your school's CORE portal"). Enforced pattern: **CORE-linked schools authenticate ONLY through CORE's signed handoff; the weaker standalone path is off where CORE exists.**

### PR #7 `3cb1958` — MEDIUM/LOW batch (SSRF, open redirect, silent writes, prompt injection)
- **SSRF / secret-exfil:** `isPublicHttpsUrl` (`core-client.ts:39-48`) validates the tenant-stored `core_base_url` override before POSTing the shared CORE secret — must be `https:`, rejects `localhost`, `*.localhost`, IPv6 literals (`h.includes(":")`), and any IPv4 literal (`/^\d{1,3}(\.\d{1,3}){3}$/`). Enforced in `notifyCoreAttemptComplete` (`core-client.ts:118-121`).
- **Open redirect (`integration/auth`):** the post-sign-in `redirect` is sanitized to **same-origin relative paths only** — `redirect = (rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")) ? rawRedirect : "/student"` (`auth/route.ts:26-27`). Separately, the JWT-embedded `return_url` is allow-listed by origin via `isValidReturnUrl` (`auth/route.ts:222-237`): https-only (http only for localhost), host must be one of `app.inteliflowai.com`, `newcore.inteliflowai.com`, `eduflux.datanex.ai`, `*.vercel.app`, or localhost.
- **Timing side-channel:** JWT signature compare switched to `crypto.timingSafeEqual` (see §1).
- **Droppable webhook:** submit's CORE completion webhook moved to `after()` (was fire-and-forget before response); evidence payload capped (413 at 100 KB — `submit/route.ts:21-23`).
- **Silent write failures:** `signals` reports real accepted count + `failed` list (207 on partial); `analyze` surfaces insert/update errors; `generation/pipeline` logs write errors instead of swallowing.
- **Inbound payload cap:** `integration/webhooks/core` caps inbound at 256 KB via `content-length` before DB/LLM work (`webhooks/core/route.ts:154-155`).
- **Prompt injection:** `experiments/attempts/teli` marks the student's work as **UNTRUSTED** in the system prompt + an anti-injection rule.

## 4. Rate limiting / audit logging today

### SPARK
- **Rate limiting: NONE implemented.** No limiter lib, no Upstash, no per-user throttle exists. The only references are prose admissions that it's a documented follow-up: `app/api/auth/student-session/route.ts:121-122` ("proper rate-limiting needs a shared store; tracked as a follow-up") and `docs/wave-4c-core-interface.md:195` ("✅ None at pilot scale"). Paid-AI routes (teli, analyze, transcribe) have **no calls-per-minute backstop** — only size caps / school feature flags.
- **Audit logging: `spark_system_events` table** (`supabase/migrations/001_initial_schema.sql:275`) used as an append-style event/audit log. The CORE→SPARK auth handoff writes `event_type: "core_student_auth"` with `{core_user_id, core_school_id, spark_attempt_id, case}` (`integration/auth/route.ts:178-187`, best-effort `.then(()=>{},()=>{})`). Also used by student-session (`student_session_created`), admin customer mutations (`customer.updated`/`customer.deleted`), trial, HighLevel sync, learning-profile GET, and lead capture. Writes are non-blocking/best-effort.

### CORE (spark routes)
- **Rate limiting:** CORE has a limiter (`src/lib/rateLimit.ts`, Upstash-backed, fails-open) wired onto `transcribe`/`tts`/`homework-tutor` and the parent narrative — but it is **NOT applied to `spark-launch`, `spark-attempt-complete`, or `notifyAssignmentCreated`** (grep of those files returns nothing).
- **Audit logging:** `logAudit` (`src/lib/audit/logAudit.ts`, never-throws) is wired into `spark.enable` (only when `ok===true`, `src/app/api/admin/spark-enable/route.ts:64-70`) and grade-override/roster/provision. **`spark-launch` and `spark-attempt-complete` are NOT audited** (grep returns nothing for those files).
- The SPARK→CORE completion ingestion `src/app/api/attempts/spark-attempt-complete/route.ts` authenticates with a **constant-time Bearer** (`bearerMatches`, `src/lib/spark/auth.ts:14-19`) against `CORE_SPARK_API_SECRET`, and is **idempotent** via `webhook_idempotency_keys` (claim-on-insert, 23505 replay → stored response; `route.ts:59-80`). This is the model for machine-to-machine SPARK↔CORE calls (Bearer + idempotency), distinct from the browser JWT handoff.

## 5. Cookie / session hygiene in SPARK (as implemented)

- **Student/handoff sessions use Supabase SSR cookies**, set via `createServerClient(...).auth.signInWithPassword` / `verifyOtp` writing through the Next `cookies()` adapter (`integration/auth/route.ts:154-175`, `auth/student-session/route.ts:96-119`, `lib/supabase/server.ts:5-28`). **The app does not set explicit `httpOnly`/`SameSite`/`__Host-`/`secure` flags on the Supabase auth cookies** — those flags are whatever `@supabase/ssr` defaults to; there is no custom cookie-option hardening in this codebase for the auth session.
- **The one explicitly-hardened cookie** is the platform-admin "view as" impersonation cookie `spark_view_as` — `app/api/admin/view-as/route.ts:45-47`:
  ```ts
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  ```
  (documented drift-locked to platform_admin only in `__tests__/lib/view-as.test.ts`). **No cookie in SPARK uses the `__Host-` prefix.**
- **Middleware** (`C:/users/inteliflow/spark-platform/middleware.ts`) only refreshes the Supabase session and guards `/dashboard*` page routes (redirect to `/login` when no user). It **does NOT guard `/api/*`** — every API route must do its own auth (this is exactly why `requireAttemptOwner`/`bearerMatches` exist per-route; a new teacher-review API route gets zero protection from middleware).

### Load-bearing invariants for a teacher handoff (facts, not recommendations)
- The existing JWT carries **no role/audience/jti** and the SPARK auth route **hard-codes `role:"student"`** and a student deep-link — so the current handoff literally cannot produce a non-student session; the token is **replayable** within its 15-min `exp` and rides in a **URL query param**.
- SPARK's `spark_users.role` CHECK allows `('student','teacher','school_sysadmin','platform_admin')` (`027_retire_school_admin_role.sql:43-44`), and RLS/data-access already distinguishes those roles, but **SPARK is student-only in practice** (school_admin retired; no teacher UI/pages under `app/(dashboard)/student` — see MEMORY note that a teacher/reviewer role + read-only review page is net-new).
- Established SPARK enforcement patterns any new surface must reproduce: constant-time secret compare + fail-closed (§3 #5), tenant/ownership check on every mutation (§3 #5), CORE-linked schools authenticate only via the signed handoff (§3 #6), same-origin/allow-listed redirects (§3 #7), SSRF-guarded outbound to tenant URLs (§3 #7), and per-route auth (middleware does not cover `/api/*`, §5).