# V1 grounding — CORE → SPARK launch / JWT handoff

Reference for CORE V2 Phase 2 SP-B (launch flow + super-admin provisioning are GREENFIELD in V2).
Repo: `C:/users/inteliflow/core` (V1, App Router, top-level `app/ lib/ components/`, NO `src/`).
READ-ONLY. Everything below is quoted verbatim with `file:line`.

---

## 0. Env vars (the secrets V2 must mirror)

From `.env.example`:
```
22  INTERNAL_API_SECRET=
25  # CORE → SPARK auth + handoff. See lib/spark/notifyAssignmentCreated.ts
27  CORE_SPARK_API_SECRET=
29  CORE_HANDOFF_SECRET=
32  CORE_PROVISIONING_SECRET=
120 CORE_LIFT_HANDOFF_SECRET=
```

Two DIFFERENT secrets are in play and must not be conflated:
- `CORE_SPARK_API_SECRET` — signs the **CORE→SPARK launch JWT** (the student handoff token) AND validates inbound SPARK→CORE webhooks. This is the launch signer secret.
- `CORE_HANDOFF_SECRET` — signs the *generic* `lib/platform/handoff.ts` token (Pulse/Spark/LIFT → CORE landing). NOT used by the spark-launch route. (See NOTE below — these are separate concerns.)
- `SPARK_API_URL` — env, default `'https://spark.inteliflowai.com'`.

---

## 1. The launch route — `app/api/attempts/spark-launch/route.ts`

Two entry shapes, ONE token scheme (header comment, lines 1-9):
- `POST` → returns `{ launch_url }` JSON (the in-app button path).
- `GET` → same flow as a browser navigation: 302 straight to the SPARK URL (the `/launch/spark/{lesson}` dispatch path, Phase 2). SAME JWT, SAME claims, SAME SPARK endpoint.

### Constants (lines 15-16)
```ts
const SPARK_API_URL = process.env.SPARK_API_URL || 'https://spark.inteliflowai.com';
const SPARK_SECRET = process.env.CORE_SPARK_API_SECRET;
```

### Signer: `jwt` (the `jsonwebtoken` library) — line 13
```ts
import jwt from 'jsonwebtoken';
```
NOTE: this route signs via the high-level `jwt.sign()` from `jsonwebtoken` (default alg HS256), NOT via `crypto.createHmac` and NOT via `lib/platform/handoff.ts`. The hand-rolled `createHmac` HS256 form lives only in the test signer (file 5).

### `buildSparkLaunch(userId, assignmentId, reqOrigin)` (lines 25-113) — server-side resolution

**How it gets `core_user_id` + `core_school_id` server-side:** purely from the authenticated session's `user.id`, then a server (admin/service-role) lookup of `users` — never from the request body. The body only carries `assignment_id`.

1. `createAdminSupabaseClient()` (line 26) — service-role client (bypasses RLS).
2. Resolve the **assignment** (lines 29-33): `from('assignments').select('id, student_id, class_id, spark_experiment_id, spark_attempt_id, assignment_mode, content').eq('id', assignmentId).single()`.
3. IDOR guard (lines 35-36): 404 if missing; **403 if `assignment.student_id !== userId`** ("Not your assignment").
4. SPARK-provisioned gate (lines 43-46): `const hasSparkAttempt = !!assignment.spark_attempt_id || !!assignment.spark_experiment_id;` — 400 "Spark not provisioned for this assignment" if neither. (Comment lines 37-42: post-Apr-29 pivot — SPARK is an embedded modality; `assignment_mode` is band-derived, so the real prerequisite is that SPARK synced back `spark_attempt_id`, NOT a mode check.)
5. Resolve the **student** (lines 49-53): `from('users').select('id, full_name, email, school_id').eq('id', userId).single()` → 404 if missing. **`school_id` comes from here.**
6. Resolve **grade** from enrollment (lines 58-66): `from('enrollments').select('class:classes(grade_level)').eq('student_id', userId).eq('is_active', true).limit(1).maybeSingle()` → `grade = enrollment?.class?.grade_level || ''`.
7. Config gate (lines 68-70): 500 "Spark integration not configured" if `!SPARK_SECRET`.

**return_url** (lines 85) — the URL the student returns to:
```ts
const returnUrl = `${reqOrigin}/student/homework?assignmentId=${assignment.id}`;
```
Comments (lines 72-84) are load-bearing: the param name MUST be `assignmentId` (not `assignment`) because `/student/homework`'s `loadAssignment()` reads `assignmentId` from `searchParams`; wrong name → falls through to list view. SPARK's auth handoff persists `return_url`; the runner's "back to challenges" button reads it.

### The EXACT JWT claims (lines 88-96)
```ts
const token = jwt.sign({
  core_user_id: student.id,
  core_school_id: student.school_id,
  spark_attempt_id: assignment.spark_attempt_id,
  email: student.email,
  full_name: student.full_name,
  grade,
  return_url: returnUrl,
}, SPARK_SECRET, { expiresIn: '15m' });
```
- Algorithm: HS256 (jsonwebtoken default — not explicitly set here).
- TTL: `expiresIn: '15m'` (jsonwebtoken adds `iat`/`exp` as epoch seconds automatically).
- `spark_attempt_id` claim uses ONLY `assignment.spark_attempt_id` (the new field), NOT the `||` fallback.

### The launch URL it builds (lines 98-110)
```ts
const sparkAttemptId = assignment.spark_attempt_id || assignment.spark_experiment_id;
...
const redirectPath = `/student/experiment/${sparkAttemptId}`;
const launchUrl = `${SPARK_API_URL}/api/integration/auth?token=${token}&redirect=${encodeURIComponent(redirectPath)}`;
```
- SPARK endpoint: **`/api/integration/auth`** (comment lines 99-104: NOT `/auth/core` — that returned the app shell but doesn't process the JWT; canonical handler is `/api/integration/auth`, which upgrades the placeholder "Case B" user inline).
- Query params on the launch URL: `token` (the raw JWT, base64url — NOT url-encoded) and `redirect` (url-encoded `/student/experiment/{sparkAttemptId}`).
- NOTE: the route builds `?token=...&redirect=...` only. There is NO separate top-level `return_url` query param on the launch URL — `return_url` travels INSIDE the JWT claims. (The task brief's `&return_url=` shape does not match V1.)
- The deep-link target id is `spark_attempt_id` (fallback `spark_experiment_id`) — i.e. V1 deep-links to a SPARK **experiment/attempt** id, surfaced in the path as `/student/experiment/{id}`. This id is captured by SPARK's earlier sync write-back into `assignments.spark_attempt_id` (see file 4's gate); CORE does not generate a fresh SPARK session id at launch time.

### `requestOrigin(req)` (lines 115-120)
```ts
return req.headers.get('origin')
  || req.headers.get('referer')?.split('/').slice(0, 3).join('/')
  || req.nextUrl.origin
  || 'https://app.inteliflowai.com';
```

### POST handler (lines 122-138)
- `await createServerSupabaseClient()` → `supabase.auth.getUser()` → 401 if no user.
- `const { assignment_id } = await req.json();` → 400 if missing.
- Calls `buildSparkLaunch(user.id, assignment_id, requestOrigin(req))`; on `!ok` returns `{ error }` at `result.status`; else `NextResponse.json({ launch_url: result.launch_url })`.

### GET handler (lines 144-164) — browser-nav variant
- `origin = req.nextUrl.origin`.
- `auth.getUser()` → on no user **`NextResponse.redirect(`${origin}/login`)`**.
- reads `assignment_id` from `searchParams` → if missing, redirect `${origin}/student`.
- on `!ok || !launch_url` → log + redirect `${origin}/student` (student IS authenticated, so failures bounce to dashboard).
- success → **`NextResponse.redirect(result.launch_url)`** (302 straight into SPARK).

---

## 2. Generic handoff signer — `lib/platform/handoff.ts`

NOTE: This is the *reverse-direction / generic* handoff (external product → CORE landing), distinct from the spark-launch token. V2 should port the spark-launch signer (file 1) for the launch; this file is the model for the generic single-use handoff pattern.

- Header (lines 1-6): "Signed short-lived tokens so external products (Pulse, Spark, LIFT) can hand a student off to a CORE page without forcing re-login. HS256 + `CORE_HANDOFF_SECRET`. 15-min TTL. Single-use via jti + cache."

### Types (lines 12-33)
```ts
export type HandoffSource = 'pulse' | 'spark' | 'lift' | 'internal';

export interface HandoffPayload {
  sub: string;          // core_user_id
  quiz_id?: string;
  src: HandoffSource;
  jti: string;          // unique token id (for single-use enforcement)
  iat: number;
  exp: number;
}
```

### `getSecret()` (lines 35-41) — `CORE_HANDOFF_SECRET`, min 32 chars (throws otherwise).

### `signHandoff` (lines 51-71)
```ts
const ttl = input.ttl_seconds ?? DEFAULT_TTL_SECONDS;   // 15*60 = 900s
const now = Math.floor(Date.now() / 1000);
const payload = { sub: input.core_user_id, quiz_id: input.quiz_id, src: input.src, jti: randomJti() };
const token = jwt.sign(payload, getSecret(), { algorithm: 'HS256', expiresIn: ttl });
return { token, expires_at: new Date((now + ttl) * 1000).toISOString() };
```
- HS256 explicitly. `exp`/`iat` are epoch seconds (via jsonwebtoken's `expiresIn`). `expires_at` returned as ISO string.
- `jti` via `globalThis.crypto.randomUUID()` (fallback random+timestamp) — lines 43-49.

### `verifyHandoff` (lines 77-92): `jwt.verify(token, getSecret(), { algorithms: ['HS256'] })`; malformed if no `sub`/`jti`/`src`; maps `TokenExpiredError`→`expired`, `JsonWebTokenError`→`invalid_signature`.

### `appendHandoffToken(baseUrl, token)` (lines 97-100): appends `?t=<encoded>` (or `&t=` if `?` present).

---

## 3. Student-facing launch page — `app/(public)/launch/[type]/[id]/page.tsx`

PUBLIC launch entry — `/launch/{quiz|homework|spark}/{id}` (GC launch links, Phase 2). Header (lines 1-21): the URL encodes WHAT to open, never WHO — no tokens, no student identifiers. `?src={provider}` is analytics-only and NEVER feeds an auth decision. `[type]` ∈ {quiz, homework, spark}; `[id]` is a UUID (quiz id, or for homework/spark the **lesson** id).

- `export const dynamic = 'force-dynamic';` (line 28).
- `ROLE_HOME` map (lines 30-36): teacher→`/teacher`, parent→`/parent`, school_admin/school_sysadmin→`/admin`, platform_admin→`/platform`.
- `params` is `Promise<{ type; id }>` — `const { type, id } = await params;` (lines 41-43). (Next.js async params.)

Flow (lines 45-106):
1. Validate (line 46): `if (!isLaunchType(type) || !isUuid(id))` → `<LaunchScreen variant="not_available" />`.
2. Session check (lines 51-57): `createServerSupabaseClient()` → `auth.getUser()`. If no user → `redirect('/api/auth/google/launch?next=' + encodeURIComponent('/launch/${type}/${id}'))` (silent Google SSO; destination travels as signed allow-listed state — see file 4 `launchState.ts`).
3. Profile (lines 59-64): admin client `from('users').select('id, role, school_id').eq('id', user.id).maybeSingle()`; null → `redirect('/login')`.
4. Staff interception (lines 71-80): `if (profile.role !== 'student')` → `<LaunchScreen variant="staff" primaryHref={ROLE_HOME[...] ?? '/login'} ... />`. Staff NEVER reach the student-taking view.
5. Dispatch (lines 83-106): `resolveStudentLaunch(admin, { type, id, studentId: profile.id, studentSchoolId: profile.school_id ?? null })`, then switch on `dest.kind`:
   - `redirect` → `redirect(dest.to)`.
   - **`spark_go` → `redirect(`/api/attempts/spark-launch?assignment_id=${dest.assignmentId}`)`** (lines 94-97) — i.e. the page bounces to the GET variant of the launch route, which 302s through SPARK's `/api/integration/auth`.
   - `not_ready` / `wrong_school` / `not_available` (default) → respective `<LaunchScreen variant=... />`.

---

## 4. Launch dispatch + state — `lib/integrations/lms/launchDispatch.ts`, `launchState.ts`

### `launchDispatch.ts` — destination resolution (state-shaped, no launch state machine)
NOTE on the brief's "state machine" question: there is NO launch-state machine / no persisted launch records. "State-shaped" here means it returns a discriminated-union destination the page switches on; it only decides where to go.

- `LaunchType = 'quiz' | 'homework' | 'spark'` (line 20).
- `LaunchDestination` union (lines 22-27): `{redirect; to}` | `{spark_go; assignmentId}` | `{not_available}` | `{not_ready}` | `{wrong_school}`.
- `isLaunchType` (31-33), `isUuid` (35-37, strict UUID regex line 29).
- Mapping (header lines 5-12): quiz→`quizzes.id` (class-level, direct); homework→`lessons.id` (homework is PER-STUDENT, resolve the authenticated student's own `assignments` row); spark→`lessons.id` (same + `spark_attempt_id`).

`resolveStudentLaunch(admin, {type, id, studentId, studentSchoolId})` (lines 44-104):
- `if (!isUuid(id)) return not_available`.
- **quiz** (51-66): `from('quizzes').select('id, status, class_id, classes!inner(school_id)').eq('id', id).maybeSingle()`; not published → `not_available`; school mismatch → `wrong_school`; else `redirect` to `/student/quiz?quizId=${quiz.id}`.
- **homework | spark** (68-103): resolve `lessons` row by `id` (`not_available` if missing); then
  ```ts
  from('assignments')
    .select('id, student_id, class_id, spark_attempt_id, spark_experiment_id, created_at, classes!inner(school_id)')
    .eq('lesson_id', id).eq('student_id', studentId)
    .order('created_at', { ascending: false }).limit(5)
  ```
  - **spark** (89-97): `sparkRow = mine.find(a => a.spark_attempt_id || a.spark_experiment_id)`; none → `not_ready`; school mismatch → `wrong_school`; else `{ kind: 'spark_go', assignmentId: sparkRow.id }`.
  - **homework** (99-103): `hw = mine[0]`; none → `not_ready`; school mismatch → `wrong_school`; else `redirect` to `/student/homework?assignmentId=${hw.id}`.
- `joinedSchoolId(c)` (108-112): normalizes Supabase FK join (array-or-object) → `school_id`.

### `launchState.ts` — signed OAuth `state` + internal-path allow-list (the silent-SSO CSRF guard)
Security contract (header lines 6-15): launch URLs carry no identity; only `next` (where to land) round-trips through Google — HMAC-signed, bound to a per-browser nonce cookie (CSRF), re-validated against the allow-list on return regardless of signature. Allow-list admits ONLY internal app paths (no absolute, no `//host`, no traversal).

- `import { createHmac, randomBytes, timingSafeEqual } from 'crypto';` (line 17). **This file uses `crypto.createHmac` directly (HMAC-SHA256 base64url), not jsonwebtoken.**
- `LaunchState` (19-28): `{ next; nonce; mode: 'silent'|'consent'; iat }`. `STATE_MAX_AGE_MS = 10*60*1000` (line 30).
- `isAllowedInternalPath` (37-44): must start `/`, not `//`, no `\`/`..`/CRLF, and matches `/^\/(launch|student|teacher|parent|admin|platform)(\/|\?|$)/`.
- Secret: **`INTERNAL_API_SECRET`** (lines 46-50, throws if unset).
- `hmac(payloadB64, secret)` (52-54): `createHmac('sha256', secret).update(`launch-state:${payloadB64}`).digest('base64url')`.
- `newNonce()` (56-58): `randomBytes(16).toString('base64url')`.
- `signLaunchState({next, nonce, mode})` (61-68): allow-list-checks `next` (throws if fail), payload `{...input, iat: Date.now()}`, base64url JSON, returns `"launch:<payloadB64>.<sig>"`.
- `verifyLaunchState(state, cookieNonce)` (78-98): startsWith `launch:`; split `payloadB64.sig`; `timingSafeEqual` on hmac; reject if age > 10min, nonce mismatch, bad mode, or fails allow-list; returns null on ANY failure.

---

## 5. Test signer — `app/api/admin/sign-spark-test-jwt/route.ts` (canonical minimal claim example)

Dev/ops helper that mints a SPARK JWT signed with **`CORE_SPARK_API_SECRET`** — the same secret `validateSparkJWT()` in `/api/attempts/spark-attempt-complete` uses for inbound SPARK→CORE webhooks (header lines 1-13). This is the **hand-rolled HS256** form (header.payload.signature, HMAC-SHA256 base64url over `${headerB64}.${payloadB64}`).

- Auth: `validateProvisioningAuth(req.headers)` — `X-Provisioning-Secret` / `CORE_PROVISIONING_SECRET` (lines 16-21, 37, 48-51). 401 on fail.
- `import { createHmac } from 'crypto';` (line 35).
- `DEFAULT_EXPIRES_IN_SECONDS = 300` (5 min), `MAX_EXPIRES_IN_SECONDS = 3600` (1h cap) — lines 39-40.
- 500 if `CORE_SPARK_API_SECRET` unset (53-59).

### Minting (lines 70-85) — the canonical HMAC HS256 JWT shape
```ts
const header = { alg: 'HS256', typ: 'JWT' };
const claims = { ...userPayload, iat: nowSec, exp: nowSec + expiresInSeconds };
const headerB64 = base64url(JSON.stringify(header));
const payloadB64 = base64url(JSON.stringify(claims));
const signature = createHmac('sha256', sparkSecret)
  .update(`${headerB64}.${payloadB64}`)
  .digest('base64url');
const token = `${headerB64}.${payloadB64}.${signature}`;
```
- `iat`/`exp` are **epoch seconds** (`Math.floor(Date.now()/1000)`).
- `base64url(str)` (122-124): `Buffer.from(str, 'utf8').toString('base64url')`.
- Audit (89-101): inserts `audit_logs` `action: 'spark_test_jwt_signed'`, `target_type: 'spark_jwt'`, metadata `{ operator, ip, expires_in_seconds, payload_keys }` — **token itself excluded** from the audit row. Non-blocking.
- Response (106-110): `{ token, expires_at_iso, expires_in_seconds }`.

---

## NOTES for the V2 designer

1. **return_url is inside the JWT, not on the URL.** V1's launch URL is exactly `${SPARK_API_URL}/api/integration/auth?token=<jwt>&redirect=<urlenc(/student/experiment/{sparkAttemptId})>`. There is no `&return_url=` query param; `return_url` is a JWT claim = `${origin}/student/homework?assignmentId=${assignment.id}` (param name MUST be `assignmentId`).
2. **Deep-link id = `spark_attempt_id` (fallback `spark_experiment_id`).** CORE does NOT mint a SPARK session id at launch; it reuses the id SPARK previously synced/wrote back into `assignments.spark_attempt_id`. The launch is gated on that field being present.
3. **`core_user_id` + `core_school_id` are derived server-side** from the authenticated session (`auth.getUser().user.id` → admin lookup of `users.id`/`users.school_id`), never from the request body. Body only carries `assignment_id`.
4. **Two distinct signing styles in V1, same alg:** spark-launch uses high-level `jsonwebtoken.jwt.sign(..., { expiresIn: '15m' })` (default HS256); the test signer hand-rolls HS256 via `crypto.createHmac` (header.payload.signature). Both verify against `CORE_SPARK_API_SECRET`. Pick one style for V2 but keep HS256 + the same secret if V2 talks to the same SPARK.
5. **Secret names to mirror:** `CORE_SPARK_API_SECRET` (launch JWT + webhook auth), `SPARK_API_URL`, `CORE_PROVISIONING_SECRET` (test-signer auth), `INTERNAL_API_SECRET` (launch OAuth state HMAC), `CORE_HANDOFF_SECRET` (generic external→CORE handoff, separate from launch).
6. **No launch state machine / no persisted launch record.** `launchDispatch` only resolves a destination union; the public launch page either renders a `LaunchScreen` or 302s. The only "state" is the signed OAuth `state` for silent SSO (`launchState.ts`), CSRF-bound to a `launch_oauth_nonce` cookie.
7. **JWT TTL = 15 min** for the launch token (`expiresIn: '15m'`); test signer defaults to 5 min (cap 1h). `iat`/`exp` epoch seconds throughout.
8. **The public `/launch/{type}/{id}` page bounces spark→ the GET variant** `/api/attempts/spark-launch?assignment_id=...`; same JWT/claims/endpoint as the POST in-app button path.
