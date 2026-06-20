# P5 — SPARK LAUNCH (JWT) Handoff Contract — Verbatim Grounding

Surface: the CORE→SPARK pre-auth JWT launch handoff (sub-project B). Captures the
EXACT JWT contract V2 CORE must produce to land a student inside a Spark Challenge,
plus the SPARK-side allow-list change Phase 2 requires, and confirmation that V2 has
NO launch/JWT-signing code yet.

Repos:
- SPARK = `C:/users/inteliflow/spark-platform` (Next.js 16, app/ + lib/ at root, NO `src/`)
- V2 CORE = `C:/users/inteliflow/NEW-CORE` (Next.js 16, App Router under `src/`)

READ-ONLY grounding. No edits made. All facts are quoted with file:line.

---

## 1. The JWT contract V2 must produce (verifyCoreJWT)

Verifier: `spark-platform/lib/integration/core-client.ts` — `verifyCoreJWT(token)` (lines 164-266).
Consumer: `spark-platform/app/api/integration/auth/route.ts` — `GET` (lines 19-202).

### Algorithm — HS256, HMAC-SHA256
`core-client.ts:189-190`:
```ts
if (header.alg !== "HS256") {
  return { valid: false, error: `Invalid JWT algorithm: expected HS256, got ${header.alg}` };
}
```
Signature verification (`core-client.ts:194-204`):
```ts
const crypto = await import("crypto");
const secret = getCoreSecret()!;
const signingInput = `${parts[0]}.${parts[1]}`;
const expectedSig = crypto
  .createHmac("sha256", secret)
  .update(signingInput)
  .digest("base64url");

if (expectedSig !== parts[2]) {
  return { valid: false, error: "Invalid JWT signature" };
}
```
=> V2 must build a standard 3-part JWT: `base64url(header).base64url(payload).base64url(HMAC-SHA256(header.payload, secret))`.
Header must be exactly `{"alg":"HS256","typ":"JWT"}` (typ unchecked but alg MUST be "HS256").
All three parts are **base64url** (no padding) — SPARK decodes with `Buffer.from(part, "base64url")`.

### Signing secret — `CORE_SPARK_API_SECRET`
`core-client.ts:28-30`:
```ts
function getCoreSecret() {
  return process.env.CORE_SPARK_API_SECRET;
}
```
This is the SAME shared secret used as the Bearer token on the create-webhook and the
attempt-complete callback. SPARK `.env.local.example` value: `CORE_SPARK_API_SECRET=spark-core-spark-secret-2026`.
V2 already exposes it: `NEW-CORE/src/lib/spark/config.ts:6`
`export const CORE_SPARK_API_SECRET = process.env.CORE_SPARK_API_SECRET || '';`

### Required + optional claims (the JWTPayload interface)
`core-client.ts:148-162`:
```ts
interface JWTPayload {
  core_user_id: string;
  core_school_id: string;
  spark_attempt_id?: string;
  return_url?: string;   // CORE homework URL for "back to challenges"
  exp: number;
  iat?: number;
  iss?: string;
}
```
Validation enforced (`core-client.ts:216-240`):
- `core_user_id` — REQUIRED, must be string (`216-218`)
- `core_school_id` — REQUIRED, must be string (`219-221`)
- `exp` — REQUIRED, must be number; expiry checked with **30s clock-skew tolerance**: `if (payload.exp < now - 30)` rejects (`222-224`, `231-235`). `now = Math.floor(Date.now()/1000)` (epoch SECONDS).
- `iss` — OPTIONAL, but **if present must equal `"inteliflow-core"`** else rejected (`227-229`):
  ```ts
  if (payload.iss && payload.iss !== "inteliflow-core") {
    return { valid: false, error: `Invalid JWT issuer: ${payload.iss}` };
  }
  ```
- `nbf` — OPTIONAL, checked with 30s skew if present (`238-240`).
- `spark_attempt_id` — OPTIONAL (string|undefined), passed through, only used for logging (route `:180`).
- `return_url` — OPTIONAL (string|undefined), passed through; gated by `isValidReturnUrl` before forwarding (route `:194`).

NOTE: `exp` is in **seconds** (epoch). V2 must emit seconds, not ms.

### URL shape the student is launched at
The auth route is a **GET** consuming query params (`route.ts:21-23`):
```ts
const { searchParams } = new URL(request.url);
const token = searchParams.get("token");
const redirect = searchParams.get("redirect") || "/student";
```
So the launch URL is:
`GET {SPARK_API_URL}/api/integration/auth?token=<jwt>&redirect=<path>`
- `token` — REQUIRED; missing → redirect `/login?error=missing_token` (`route.ts:25-27`, `204-206`).
- `redirect` — OPTIONAL **path** (default `/student`); resolved relative to request origin (`route.ts:193` `new URL(redirect, request.url)`). To land directly in a Challenge, CORE would pass e.g. `redirect=/student/experiment/<sessionId>` (the runner route — see §3).
- `return_url` is carried INSIDE the JWT (NOT a top-level query param). SPARK re-emits it on the final redirect as `?return=` (`route.ts:194-196`).

SPARK base URL on V2 side: `NEW-CORE/src/lib/spark/config.ts:5`
`export const SPARK_API_URL = process.env.SPARK_API_URL || 'https://spark.inteliflowai.com';`
(SPARK's own env uses `NEXT_PUBLIC_APP_URL=https://spark.inteliflowai.com`.)

---

## 2. isValidReturnUrl allow-list (VERBATIM) — the Phase-2 SPARK change

`spark-platform/app/api/integration/auth/route.ts:208-232`:
```ts
// Allowed origins:
//   - app.inteliflowai.com (CORE prod)
//   - core-platform-*.vercel.app (CORE preview deploys)
//   - eduflux.datanex.ai (CORE Brazil pilot — same codebase, different brand)
//   - localhost (dev)
function isValidReturnUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    // http only allowed for localhost dev
    if (url.protocol === "http:" && !url.hostname.includes("localhost")) return false;
    if (url.hostname === "app.inteliflowai.com") return true;
    if (url.hostname === "eduflux.datanex.ai") return true;
    if (url.hostname.endsWith(".vercel.app")) return true;
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
    return false;
  } catch {
    return false;
  }
}
```
**GAP / required SPARK code change for Phase 2:** the allow-list does NOT include
`newcore.inteliflowai.com` (V2's live host — per MEMORY: V2 is LIVE at newcore.inteliflowai.com).
A `return_url` pointing at `https://newcore.inteliflowai.com/...` will fail `isValidReturnUrl`,
so SPARK will NOT append `?return=` and the runner's "back to challenges" button falls back to
SPARK's dashboard. Note `*.vercel.app` IS allowed (covers V2 preview deploys), so only PROD V2
return URLs are blocked. Phase 2 must add `if (url.hostname === "newcore.inteliflowai.com") return true;`.
(This is defense-in-depth, not the primary gate — the JWT signature is the real trust boundary —
but the back-nav UX silently degrades without it.)

---

## 3. Student→attempt mapping, landing, and return flow

### spark_attempt_id origin (create-webhook)
`spark_attempt_id` is created by the create-webhook, NOT the launch. The webhook
(`spark-platform/app/api/integration/webhooks/core/route.ts`) creates an `experiment_attempts`
row and returns its id (`route.ts:554-562`):
```ts
const response: Record<string, unknown> = {
  success: generationOk,
  session_id: sessionId,
  spark_attempt_id: attempt.id,
  spark_user_id: sparkUserId,
  synthetic_experiment_id: syntheticExperimentId,
  ...
};
```
It also persists `spark_attempt_id` onto `core_experiment_assignments` (`route.ts:453-467`,
UNIQUE on `(core_homework_id, student_id)`). V2 captures this from the webhook response:
`NEW-CORE/src/lib/spark/notifyAssignmentCreated.ts:88-93` (`sparkAttemptId: json.spark_attempt_id`,
`syntheticExperimentId: json.synthetic_experiment_id`). The webhook also returns `session_id`,
which V2 does NOT currently capture (see FLAG below) — `session_id` is what the runner route needs.

### Student→spark_users mapping (by core_user_id)
The auth route looks up the student by `core_user_id` (`route.ts:62-66`):
```ts
const { data: existingSparkUser } = await admin
  .from("spark_users")
  .select("id, auth_id")
  .eq("core_user_id", payload.core_user_id)
  .maybeSingle();
```
The create-webhook upserts the same `spark_users` row keyed on `core_user_id`
(`route.ts:303-309` → `upsertSparkStudent`, `route.ts:637-686`, also `.eq("core_user_id", ...)`).
Deterministic SPARK auth identity per CORE user (`route.ts:57-59`):
```ts
const email = `core_${payload.core_user_id}@spark.inteliflowai.com`;
const password = `spark_core_${payload.core_user_id}_${process.env.CORE_SPARK_API_SECRET}`;
```
=> Student NEVER needs a SPARK password; CORE identity flows through (`route.ts:16`).

### Three auth cases (A/B/C) — does SPARK expect the student to pre-exist?
Header comment `route.ts:8-17` + body `route.ts:68-148`:
- **Case A — returning user**: `spark_users` row exists AND `auth.admin.getUserById(auth_id)` finds a real auth user → `authUserId = existingSparkUser.auth_id` (`75-77`).
- **Case B — webhook-created (placeholder auth_id)**: `spark_users` row exists (the create-webhook inserted it with `auth_id: crypto.randomUUID()`, NO real auth user — see webhook `route.ts:670-683`), `getUserById` finds nothing → auth route CREATES the real Supabase auth user and updates `spark_users.auth_id`+`email` (`79-111`).
- **Case C — brand new (no spark_users record)**: launch with no prior webhook → auth route creates BOTH the auth user and the `spark_users` row (`role: "student"`) (`112-148`).
=> **SPARK self-provisions on launch (Case C).** The student does NOT strictly need to pre-exist;
but in the normal flow the create-webhook already inserted the row (Case B). Case B is the expected
path because the Challenge content (`experiment_attempts` + generated content) only exists if the
webhook ran. Case C lands the student authenticated but, absent a valid `redirect` to an existing
session, with no assigned Challenge.

### Where the student lands
Default landing = `/student` (`route.ts:23`, the SPARK student dashboard
`app/(dashboard)/student/page.tsx`). The Challenge RUNNER is
`app/(dashboard)/student/experiment/[sessionId]/page.tsx` — so to drop a student straight into the
Challenge, CORE passes `redirect=/student/experiment/<session_id>` (the session_id from the webhook
response). Final redirect built at `route.ts:193-197`.

### Return flow (back to CORE)
On final redirect, SPARK appends the JWT's `return_url` as `?return=` (`route.ts:193-196`):
```ts
const target = new URL(redirect, request.url);
if (payload.return_url && isValidReturnUrl(payload.return_url)) {
  target.searchParams.set("return", payload.return_url);
}
return NextResponse.redirect(target);
```
The runner reads it on mount (`app/(dashboard)/student/experiment/[sessionId]/page.tsx:46,54`):
```ts
const searchParams = useSearchParams();
...
const returnUrl = searchParams?.get("return") || undefined;
```
The runner's "back to challenges" button uses `returnUrl`, falling back to SPARK's dashboard when
absent. (Historical bug — `core-client.ts:248-257` — `return_url` was once declared in the interface
but not extracted, so it always arrived undefined; now extracted at `core-client.ts:257`.)
Completion data flows back separately via the attempt-complete callback (POST
`{base}/api/attempts/spark-attempt-complete`, Bearer secret — `core-client.ts:80-142`), which V2
already RECEIVES at `NEW-CORE/src/app/api/attempts/spark-attempt-complete/route.ts`.

---

## 4. V2 CORE state — NO launch/JWT code exists (what V2 must build)

Grep of `NEW-CORE/src` for `createHmac | jsonwebtoken | jose | spark-launch | /integration/auth`:
**zero matches.** V2's only SPARK API surface:
- `src/app/api/attempts/spark-attempt-complete/` — INBOUND receiver (SPARK→CORE callback). Exists.
- (no outbound launch route at all)

V2's existing SPARK lib (`src/lib/spark/`): `config.ts`, `contract.ts`, `notifyAssignmentCreated.ts`
(outbound create-webhook caller), `loadChallenges.ts`, `sparkLink.ts`, `auth.ts` (constant-time
Bearer check for INBOUND only). None sign or build a JWT.

`src/lib/spark/auth.ts` is INBOUND-only (`bearerMatches`/`safeEqual`, lines 1-19) — it verifies a
Bearer header on requests SPARK makes to CORE; it does NOT mint JWTs.

**V2 MUST BUILD (sub-project B):**
1. A launch lib (e.g. `src/lib/spark/signLaunchJwt.ts`) that:
   - builds header `{"alg":"HS256","typ":"JWT"}`, base64url-encodes header + payload,
   - payload claims: `core_user_id` (REQUIRED), `core_school_id` (REQUIRED), `exp` (REQUIRED, epoch
     SECONDS, short-lived; SPARK tolerates 30s skew), optional `iss:"inteliflow-core"`, optional
     `iat`, optional `spark_attempt_id`, optional `return_url`,
   - signs with `crypto.createHmac("sha256", CORE_SPARK_API_SECRET).update(`${h}.${p}`).digest("base64url")`.
2. A launch route/handler that redirects the student's browser to
   `{SPARK_API_URL}/api/integration/auth?token=<jwt>&redirect=/student/experiment/<session_id>`.
   To know `<session_id>`, V2 must persist the webhook response's `session_id` (currently
   `notifyAssignmentCreated.ts` only captures `spark_attempt_id` + `synthetic_experiment_id`, NOT
   `session_id` — see FLAG) — OR pass `redirect=/student` and let the dashboard route.

---

## FLAGS — discrepancies / risks / gaps

- **[GAP — SPARK code change]** `isValidReturnUrl` (auth/route.ts:218-232) does NOT allow
  `newcore.inteliflowai.com` (V2 prod). Phase 2 must add it or V2-prod `return_url`s are dropped
  and "back to challenges" silently falls to SPARK's dashboard. `*.vercel.app` IS allowed (V2 previews OK).
- **[SECRET]** Single shared symmetric secret `CORE_SPARK_API_SECRET` does triple duty: JWT HMAC key,
  create-webhook Bearer, attempt-complete Bearer. V2 reads it at `src/lib/spark/config.ts:6`. SPARK
  example value `spark-core-spark-secret-2026`. Both repos must hold the IDENTICAL secret.
- **[CLAIMS]** `exp` is epoch **SECONDS** (not ms); `iss` if sent MUST be exactly `"inteliflow-core"`;
  alg MUST be `HS256`; all 3 JWT parts are **base64url** (no padding). 30s clock-skew tolerance on `exp`/`nbf`.
- **[Case B/C — self-provision]** SPARK self-provisions the student on launch (Case C) and creates
  real auth for webhook-stub users (Case B). Student need not pre-exist for auth, BUT the Challenge
  content only exists if the create-webhook ran first → normal flow is webhook-then-launch (Case B).
  Launching without a prior webhook (Case C) authenticates but lands on an empty `/student`.
- **[GAP — session_id]** To deep-link into a Challenge, the launch needs SPARK's `session_id`. The
  create-webhook RETURNS `session_id` (webhook/route.ts:556) but V2's `notifyAssignmentCreated.ts`
  (lines 82-94) does NOT capture it (only `spark_attempt_id` + `synthetic_experiment_id`). Either
  start capturing `session_id`, or launch to `/student` (dashboard) and rely on SPARK routing.
- **[NO V2 CODE]** V2 has zero JWT-signing/launch code (grep clean). The entire launch lib + route
  is greenfield for sub-project B.
- **[redirect is a path, not URL]** `redirect` query param is resolved relative to the SPARK origin
  (`new URL(redirect, request.url)`); pass a path like `/student/experiment/<id>`, not an absolute URL.
