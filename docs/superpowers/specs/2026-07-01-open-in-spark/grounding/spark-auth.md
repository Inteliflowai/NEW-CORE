# SPARK Platform — Auth/Role Grounding Report (verbatim current-code facts)

Repo: `C:/users/inteliflow/spark-platform` (checked 2026-07-01, branch head `f881f39 feat(spark): retire legacy teacher UI (April 29 pivot close-out)`).

**Headline correction to the feature context:** `/api/integration/auth` hardcodes `role: "student"` only when *creating* a brand-new `spark_users` row (Case C) — confirmed. But **migration 027 did NOT remove the teacher role** — it retired `school_admin`. `'teacher'` is still a valid `spark_users.role` value in the live CHECK constraint and RLS policies; what was removed is the **teacher UI + teacher API routes**, in code commit `f881f39` (2026-05-01), not a migration.

---

## 1. Auth surface — how a user gets a session

### 1a. CORE handoff: `app/api/integration/auth/route.ts` (GET)

Flow documented at top of file (`app/api/integration/auth/route.ts:8-17`):

```ts
// CORE → SPARK Pre-Authentication Flow
//
// Handles three cases:
// A) Student already has real Supabase auth (returning user) → sign in
// B) Student was pre-created by webhook (placeholder auth_id) → create real auth, update, sign in
// C) Student is brand new (no spark_users record) → create everything, sign in
//
// Students NEVER need a SPARK password. CORE identity flows through.
```

**JWT verification** — delegated to `verifyCoreJWT` (`app/api/integration/auth/route.ts:34`), implemented in `lib/integration/core-client.ts:187-292`. Hand-rolled HS256 over `CORE_SPARK_API_SECRET`:

- Algorithm check: `if (header.alg !== "HS256")` → reject (`core-client.ts:212`)
- HMAC-SHA256 with `getCoreSecret()` = `process.env.CORE_SPARK_API_SECRET` (`core-client.ts:28-30, 217-223`)
- Constant-time compare: `crypto.timingSafeEqual(sigA, sigB)` (`core-client.ts:228`)
- Required claims: `core_user_id` (string), `core_school_id` (string), `exp` (number) (`core-client.ts:242-250`)
- Optional claims: `spark_attempt_id`, `return_url`, `iat`, `iss`, `nbf` (`core-client.ts:171-185, 264-266`)
- Issuer check only if present: `if (payload.iss && payload.iss !== "inteliflow-core")` → reject (`core-client.ts:253`)
- Expiry with 30s skew: `if (payload.exp < now - 30)` → expired (`core-client.ts:258-261`)

**Claims consumed by the route:** `payload.core_school_id` → looked up in `core_spark_links` (`route.ts:42-47`); `payload.core_user_id` → deterministic identity; `payload.return_url` → forwarded as `?return=` if it passes `isValidReturnUrl` (`route.ts:198-200`, allow-list at `route.ts:222-237`, includes `newcore.inteliflowai.com` at line 229). **The JWT carries NO role claim.**

**Per-tenant gates:** school link must exist and be `enabled` (`route.ts:42-51`); feature flag `core_integration` must be on (`route.ts:56-59`).

**Identity it mints** — deterministic email/password (`route.ts:61-63`):

```ts
// 3. Deterministic email/password for this CORE user
const email = `core_${payload.core_user_id}@spark.inteliflowai.com`;
const password = `spark_core_${payload.core_user_id}_${process.env.CORE_SPARK_API_SECRET}`;
```

**Where role is hardcoded** — only in Case C (brand-new user), `route.ts:142-151`:

```ts
// Create spark_users record
await admin
  .from("spark_users")
  .upsert({
    auth_id: authUserId,
    school_id: link.spark_school_id,
    core_user_id: payload.core_user_id,
    email,
    role: "student",
  }, { onConflict: "auth_id" });
```

Cases A/B reuse the existing `spark_users` row without touching `role` (`route.ts:74-115`). The `admin.auth.admin.createUser` calls set `user_metadata: { core_user_id, core_school_id, spark_school_id }` — **no role in auth metadata** on this path (`route.ts:89-93, 122-126`).

**Session mint:** a real Supabase session via password sign-in with the deterministic credentials, cookies set through `@supabase/ssr` `createServerClient` (`route.ts:154-175`):

```ts
const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
```

Then redirect to `redirect` param (validated same-origin relative only, default `/student`, `route.ts:26-27`), with `?return=` appended when valid (`route.ts:197-201`). Errors redirect to `/login?error=…` (`route.ts:208-210`).

### 1b. Staff login: `app/login/page.tsx`

Client-side email+password: `getSupabase().auth.signInWithPassword({ email, password })` then `router.push("/dashboard")` (`app/login/page.tsx:89-97`). Forgot-password posts to `/api/auth/reset` (`page.tsx:105`).

### 1c. Student standalone login: `app/student-login/page.tsx` + two API routes

- `POST /api/auth/student-login` — class code + name lookup, **no password from student**: finds school by `spark_schools.class_code`, then finds a `spark_users` row with `.eq("role", "student")` matching display/full/first name (`app/api/auth/student-login/route.ts:41-52`), and returns the email for the client to sign in with.
- `POST /api/auth/student-session` — server-side session mint via `admin.auth.admin.generateLink({ type: "magiclink", email })` then `supabase.auth.verifyOtp({ token_hash, type: "magiclink" })` (`app/api/auth/student-session/route.ts:81-115`). **CORE-linked schools are blocked from this path** (`student-session/route.ts:38-53`):

```ts
// CORE-linked schools authenticate students through CORE's signed handoff
// (/api/integration/auth), not this standalone class-code+name path. Reject
if (coreLink) {
  return NextResponse.json(
    { error: "Please sign in through your school's CORE portal." },
    { status: 403 },
  );
}
```

### 1d. `app/auth/callback/route.ts`

Standard Supabase code exchange: `supabase.auth.exchangeCodeForSession(code)` → redirect to `next` (default `/dashboard`) (`app/auth/callback/route.ts:8-39`). Used for email confirm / password reset / OAuth.

### 1e. `middleware.ts` route gating

Session-presence only; **no role gating and only `/dashboard` is protected** (`middleware.ts:28-40`):

```ts
const { data: { user } } = await supabase.auth.getUser();

// Protect dashboard routes
if (!user && request.nextUrl.pathname.startsWith("/dashboard")) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}
```

Matcher is everything except static assets (`middleware.ts:42-46`). Notably `/student/*` pages and all `/api/*` are NOT middleware-gated — per `lib/auth/attemptOwnership.ts:9-12`: *"These routes were originally shipped without any auth check (middleware only guards /dashboard pages, not /api/*) … Closed 2026-06-11"* — API routes each do their own `getUser()` check.

The root page redirects to login (`app/page.tsx:3-5`): `export default function Home() { redirect("/login"); }`.

---

## 2. User/role model

**Storage:** `spark_users` table, keyed to Supabase auth via `auth_id`, created in `supabase/migrations/001_initial_schema.sql:19-31`:

```sql
CREATE TABLE spark_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id uuid UNIQUE NOT NULL,
  school_id uuid REFERENCES spark_schools(id),
  core_user_id uuid,
  email text,
  full_name text,
  role text NOT NULL CHECK (role IN ('student','teacher','admin','sysadmin')),
  ...
```

**Role value history:**
- 001: `('student','teacher','admin','sysadmin')` (`001_initial_schema.sql:26`)
- 005 renamed `admin`→`school_admin`, `sysadmin`→`platform_admin`; CHECK became `('student', 'teacher', 'school_admin', 'school_sysadmin', 'platform_admin')` (`005_role_system_update.sql:5-14`); also created the RLS helper (`005:17-20`):

```sql
CREATE OR REPLACE FUNCTION get_my_spark_role() RETURNS text
  LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT role FROM spark_users WHERE auth_id = auth.uid() LIMIT 1;
  $$;
```

- 027 dropped `school_admin`; **current live CHECK** (`027_retire_school_admin_role.sql:42-44`):

```sql
ALTER TABLE spark_users ADD CONSTRAINT spark_users_role_check
  CHECK (role IN ('student', 'teacher', 'school_sysadmin', 'platform_admin'));
```

**`'teacher'` is still valid in DB and is actively written by code:**
- Trial signup creates teacher accounts: `role: "teacher"` + `user_metadata: { …, spark_role: "teacher" }` (`app/api/trial/route.ts:56, 73`)
- CORE webhook pre-creates teacher rows (placeholder `auth_id: crypto.randomUUID()`, no auth user): `upsertSparkTeacher(...)` inserts `role: "teacher"` (`app/api/integration/webhooks/core/route.ts:611-641`, insert at 630-637)
- Demo seed creates a teacher (`lib/demo/seed.ts:119-126`, `role: "teacher"`)
- `create_assignment` in the integration API requires a teacher to exist: `.in("role", ["teacher", "admin", "sysadmin"])` … `"No teacher found for this school. Add a teacher first."` (`app/api/integration/core/route.ts:214-224`)
- RLS staff branches still include `'teacher'` (see §4 and migration 036 below)

**What "teacher removed" actually means** — the UI/API surface, per `lib/support/routing.ts:3-9`:

```ts
// ... The teacher role is gone (April 29 pivot — teacher UI lives in CORE)
// and the school_admin role is retired (May 2026 — school admin lives in
// CORE entirely). The remaining SPARK roles that can file tickets are
// school_sysadmin and platform_admin; ...
```

Commit `f881f39` ("retire legacy teacher UI (April 29 pivot close-out)", 2026-05-01) deleted 14 pages (`app/(dashboard)/teacher/*` incl. `teacher/sessions/[sessionId]/page.tsx`, `teacher/students/[studentId]/spark/page.tsx`) and 15 API routes (`app/api/teacher/*`, `app/api/experiments/…` catalog/drafts/sessions routes) — verified via `git show --stat f881f39`. There is no `app/(dashboard)/teacher/` or `app/api/teacher/` directory today.

**Dashboard-role remnant** — the dashboard layout retains a stub teacher nav (`app/(dashboard)/layout.tsx:10, 18-31`):

```ts
type DashboardRole = "teacher" | "school_sysadmin" | "platform_admin";
...
// The 'teacher' key is retained with a minimal nav so existing fallback
// logic (students mapping to "teacher") doesn't crash. ...
const navByRole: Record<DashboardRole, NavItem[]> = {
  teacher: [
    { label: "Support", href: "/support", icon: "help" },
  ],
```

Other remnants: `lib/design/tokens.ts:113-118` role label registry (`teacher: { label: "Teacher" }`; flagged as dead in `cleanup-audit-SPARK.md:115`); `app/api/admin/customers/route.ts:135-137` counts teacher users; `app/api/gamification/route.ts:36` `const STAFF_ROLES = new Set(["teacher", "school_sysadmin", "platform_admin"])`.

---

## 3. Migration 027 — exact contents

`supabase/migrations/027_retire_school_admin_role.sql` — retires **school_admin** (not teacher). Header (`:1-19`):

```sql
-- Migration 027 — retire school_admin role (April 29 pivot close-out)
--
-- The school_admin role retires from SPARK. CORE owns school-level
-- administration end-to-end ...
-- Three changes:
--   1. RLS on spark_users — drop school_admin from "users_read_own"
--   2. RLS on gamification + xp tables — drop school_admin from
--      "gamification_read" and "xp_read"
--   3. CHECK constraint on spark_users.role — drop 'school_admin' from
--      allowed values
```

Changes (verbatim, `:24-44`):

```sql
DROP POLICY IF EXISTS "users_read_own" ON spark_users;
CREATE POLICY "users_read_own" ON spark_users FOR SELECT
  USING (auth_id = auth.uid() OR get_my_spark_role() IN ('school_sysadmin', 'platform_admin'));

DROP POLICY IF EXISTS "gamification_read" ON spark_gamification;
CREATE POLICY "gamification_read" ON spark_gamification FOR SELECT
  USING (student_id IN (SELECT id FROM spark_users WHERE auth_id = auth.uid()) OR get_my_spark_role() IN ('teacher','school_sysadmin','platform_admin'));

DROP POLICY IF EXISTS "xp_read" ON spark_xp_events;
CREATE POLICY "xp_read" ON spark_xp_events FOR SELECT
  USING (student_id IN (SELECT id FROM spark_users WHERE auth_id = auth.uid()) OR get_my_spark_role() IN ('teacher','school_sysadmin','platform_admin'));

ALTER TABLE spark_users DROP CONSTRAINT IF EXISTS spark_users_role_check;
ALTER TABLE spark_users ADD CONSTRAINT spark_users_role_check
  CHECK (role IN ('student', 'teacher', 'school_sysadmin', 'platform_admin'));
```

Tables/policies touched: `spark_users` (policy `users_read_own` + CHECK constraint), `spark_gamification` (`gamification_read`), `spark_xp_events` (`xp_read`). Note `'teacher'` is retained in both gamification policies and the CHECK.

These policies were later superseded by `036_rls_tenant_isolation_fix.sql` (2026-06-25), which re-created them with school-scoping and again kept `'teacher'` in the staff branches, e.g. `experiment_attempts` (`036:43-63`):

```sql
create policy attempts_access on public.experiment_attempts
  for all
  using (
    student_id = public.get_my_spark_user_id()
    or public.get_my_spark_role() = 'platform_admin'
    or (
      public.get_my_spark_role() = any (array['teacher','admin','sysadmin','school_sysadmin'])
      and public.spark_student_in_my_school(student_id)
    )
  )
```

(So at the RLS layer, a same-school `'teacher'` can already read `experiment_attempts` — but no application code path uses this: app reads use the service-role admin client, per `036:12-15`: *"every application read of these tables uses the service-role client (which bypasses RLS), and the only browser/authenticated read is spark_users (own row)"*.)

---

## 4. Session representation + how a route knows the caller

- **Sessions are standard Supabase auth cookies** via `@supabase/ssr`. `lib/supabase/server.ts:5-28` `createServerSupabaseClient()` (cookie-backed, anon key); `lib/supabase/server.ts:31-42` `createAdminSupabaseClient()` (synchronous, `SUPABASE_SERVICE_ROLE_KEY`, bypasses RLS). Browser: `lib/supabase/client.ts` `createBrowserSupabaseClient()`.
- **Universal route pattern** (e.g. `app/api/admin/users/route.ts:43-51`): `getUser()` on the cookie client → resolve caller row by `auth_id` with the admin client → role gate in JS:

```ts
const { data: { user }, error: authError } = await supabase.auth.getUser();
if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

const admin = createAdminSupabaseClient();
const { data: me } = await admin.from("spark_users").select("role, school_id").eq("auth_id", user.id).single();
if (!me || !["school_sysadmin", "platform_admin"].includes(me.role)) {
  return NextResponse.json({ error: "Admin access required" }, { status: 403 });
}
```

- **Student-runner routes** use the shared ownership guard `lib/auth/attemptOwnership.ts:22-58` (`requireAttemptOwner`): 401 if no user, 404 if no `spark_users` row, 403 unless `attempt.student_id === sparkUser.id`. Comment at `:3-7`: *"the caller must be an authenticated spark_user AND own the attempt. Teachers/admins have their own surfaces; these endpoints are for the owning student only."* Same self-scoping inline in the read routes, e.g. `app/api/experiments/attempts/[id]/content/route.ts:47-60` and `GET /api/experiments/attempts/my` which filters `.eq("student_id", sparkUser.id)` (`app/api/experiments/attempts/my/route.ts:34-49`).
- **Non-Supabase tokens** (not sessions): `lib/auth/signedToken.ts:26-57` — HMAC HS256 short-lived proofs for password-reset/trial flows, secret = `CORE_SPARK_API_SECRET || SUPABASE_SERVICE_ROLE_KEY`, fail-closed.
- **Server-to-server (no user session at all):** `POST /api/integration/core` authenticates by `core_spark_links.api_key` Bearer token, school-scoped (`app/api/integration/core/route.ts:6-32`). Actions: `get_student_profile`, `get_experiment_suggestions`, `create_assignment`, `get_attempt_result`, `sync_student_roster` (`route.ts:52-63`). `get_attempt_result` (`route.ts:338-419`) already returns per-student attempt state/score/effort/revision/hints + latest `spark_ai_analysis` `experiment_scoring` result — but summary fields only, not the full evidence/responses.
- **Provision:** `POST /api/integration/provision-school` (CORE→SPARK school+link creation) exists at `app/api/integration/provision-school/route.ts`.

---

## 5. Existing admin/staff/reviewer surfaces

- **Dashboard shell** `app/(dashboard)/layout.tsx` is client-side role-adaptive: fetches `spark_users.role` (`layout.tsx:104-126`); students falling into the dashboard are mapped to the stub `"teacher"` nav (`layout.tsx:120-121`: `if (dbRole === "student") { setRole("teacher"); // fallback — students shouldn't be here }`). Nav by role (`layout.tsx:28-48`): `school_sysadmin` → Connectors / Integrations / API Test / Support; `platform_admin` → Customers / Platform / Trials / Users / Connectors / Integrations / API Test / Support. Role labels (`layout.tsx:57-63`): `teacher: "Teacher"`, `school_sysadmin: "School IT Admin"`, `platform_admin: "Platform Admin"`.
- **Admin pages** (`app/(dashboard)/admin/`): `api-test`, `connectors`, `customers`, `generation` (+cost/library-audit/recent), `integrations/core`, `system`, `trials`, `users`. Gated in their API routes to `school_sysadmin`/`platform_admin` (e.g. `app/api/admin/users/route.ts:49`; platform_admin-only: `app/api/admin/customers/route.ts:44`, `app/api/admin/demo-seed/route.ts:30`, `app/api/admin/generation/recent/route.ts:26`).
- **Platform-admin impersonation ("view-as")**: cookie `spark_view_as=<schoolId>`, set/cleared by `/api/admin/view-as` (role-checked to `platform_admin` at `app/api/admin/view-as/route.ts:28, 80`), resolved by `getEffectiveSchoolId(callerRole, callerSchoolId)` — non-platform callers always get their own school (`lib/tenancy/viewAs.ts:40-50`).
- **Support** (`app/(dashboard)/support/page.tsx` + `HelpTicketModal`): submitters limited to `school_sysadmin`/`platform_admin` (`lib/support/routing.ts:42-47` `canFileTicket`); handler tiers via `canHandleTier` (`routing.ts:64-68`).
- **Attempt-review-shaped surfaces that exist today:**
  - Student-only read-only artifact view: `app/(dashboard)/student/lab/artifact/[attemptId]/page.tsx:1-17` — *"Read-only view of a single completed experiment. Reuses PostSubmission with readOnly=true"*; data comes from the self-scoped `/api/experiments/attempts/my` (`page.tsx:66-74`).
  - Staff-scoped test endpoints (sysadmin/platform_admin, school-checked): `app/api/experiments/attempts/[id]/test-mastery-check/route.ts:28-44` and `test-extension-problem/route.ts:24-46`.
  - Server-to-server attempt summary: `get_attempt_result` in `/api/integration/core` (§4).
- **There is NO teacher-facing page or teacher-gated API route anywhere in `app/`** (verified: no `app/(dashboard)/teacher/`, no `app/api/teacher/`; the only remaining teacher-role code paths are the RLS staff branches, user-creation writes, gamification STAFF_ROLES set, and the dashboard nav stub listed above).