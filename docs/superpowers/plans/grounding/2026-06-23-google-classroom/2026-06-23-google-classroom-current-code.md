# Google Classroom — Current-Code Grounding (V1 + V2)

> **Purpose.** Verbatim current-code facts for porting the V1 (`C:/users/inteliflow/core`) Google Classroom integration into CORE **V2** (`C:/users/inteliflow/NEW-CORE`). Synthesized from 7 parallel reader passes. Every `file:line` citation and verbatim quote from the readers is preserved. Where readers disagree or a fact is unverified, it is **marked explicitly**.
>
> **Scope note.** This is the GC epic grounding. CLAUDE.md sequence: **Google Classroom → Profile Settings → Support Ticket.** GC is "OAuth + roster/assignment/grade sync (heaviest; reference V1 + the SPARK integration pattern)."
>
> **One overarching fact to hold:** V1 has **TWO coexisting generations** of GC write-back code — the modern **connector + `lms_publications`** architecture (migration `074`, `lib/integrations/lms/`) and a **legacy per-student route pair** (`/grades`, `/post-assignment`, gated by `classes.google_feed_enabled` / `google_grade_sync_enabled`). The connector path is the cleaner one to port; the legacy pair has schema drift. **Decide explicitly which to port (see Open Decisions).**

---

## 1) V1 OAuth + Token Storage

### Entry points (initiation)

| Flow | Route | Authorize-URL builder | Scopes | Params | CSRF |
|---|---|---|---|---|---|
| Plain login | `GET /api/auth/google` (no mode) | `getGoogleAuthUrl(state)` | `openid email profile` | `access_type=offline`, `prompt=select_account` | random-uuid `google_oauth_state` cookie (httpOnly, 10-min) |
| Classroom connect (scope upgrade) | `GET /api/auth/google?mode=classroom` | `getGoogleClassroomAuthUrl(state)` | 7 scopes (see §5) | `access_type=offline`, `prompt=consent` | same state cookie + `google_oauth_mode='classroom'` + same-origin-validated `google_oauth_return` cookie |
| Student silent SSO (launch) | `GET /api/auth/google/launch?next=<path>&mode=consent` | `getGoogleSilentAuthUrl(state, 'none'\|'select_account')` | `openid email profile` (NO offline) | `prompt=none` (silent) | HMAC-SHA256 `launch:<payloadB64>.<sig>` state over `INTERNAL_API_SECRET` (10-min iat) + `launch_oauth_nonce` cookie + internal-path allow-list |

- **No PKCE anywhere** — CSRF is the random-uuid state cookie only. Evidence: `app/api/auth/google/route.ts:19-52` — `const state = crypto.randomUUID();` … `cookieStore.set('google_oauth_state', state, cookieOpts);` … `const url = mode === 'classroom' ? getGoogleClassroomAuthUrl(state) : getGoogleAuthUrl(state);`
- Login authorize URL verbatim: `lib/auth/sso.ts:27-38` — `client_id: (process.env.GOOGLE_CLIENT_ID || '').trim(), redirect_uri: (process.env.GOOGLE_REDIRECT_URI || '').trim(), response_type: 'code', scope: 'openid email profile', state, access_type: 'offline', prompt: 'select_account', }); return ` ``https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`` `.
- Launch initiation: `app/api/auth/google/launch/route.ts:20-42` — `if (!isAllowedInternalPath(next)) {…} … cookieStore.set('launch_oauth_nonce', nonce, {…}); const state = signLaunchState({ next, nonce, mode });`. State sign/verify: `lib/integrations/lms/launchState.ts:60-68`/`78-98`. Requires `INTERNAL_API_SECRET` (`launchState.ts:46-49` — `if (!s) throw new Error('INTERNAL_API_SECRET is not configured');`).

### Callback (one route, three branches — same registered redirect URI)

`GET /api/auth/google/callback` multiplexes on state/cookie (`callback/route.ts:48-63`):
```
if (isLaunchState(state)) { return handleLaunchCallback(...); }   // state prefixed 'launch:'
… if (cookieStore.get('google_oauth_mode')?.value === 'classroom') { return handleConnectCallback(origin, searchParams); }
return handleLoginCallback(origin, searchParams);                  // plain login
```
- **connect** branch attaches tokens to the CURRENT logged-in user (never creates/switches sessions) — this is a documented session-switch bug fix.
- **login** branch runs `linkOrCreateUser`; only proceeds if `email && verified_email` (`callback/route.ts:243-244`).
- **launch** branch does silent SSO via `resolve_external_identity` and NEVER auto-creates (auto-creation is roster-sync only).

### Token storage (the columns)

Tokens live on **`public.users`**: `google_access_token text`, `google_refresh_token text`, `google_token_expiry timestamptz`. Plus identity columns `google_id text`, `microsoft_id text`, `sso_provider text`.

- **These columns are NOT in `000_full_schema.sql`** — added by an idempotent reconcile ALTER:
  `supabase/reconcile-eduflux-2026-06-04c.sql:111-117` — `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS google_id text, ADD COLUMN IF NOT EXISTS microsoft_id text, ADD COLUMN IF NOT EXISTS google_access_token text, ADD COLUMN IF NOT EXISTS google_refresh_token text, ADD COLUMN IF NOT EXISTS google_token_expiry timestamptz, ADD COLUMN IF NOT EXISTS sso_provider text;` (all nullable).
- **Write rules:**
  - Login branch writes all three with `tokens.refresh_token || null` (`callback/route.ts:252-256`).
  - Connect branch writes `access_token` + `token_expiry` and **only overwrites `refresh_token` when Google returns one** (never nulls an existing one): `callback/route.ts:101-108` — `...(tokens.refresh_token ? { google_refresh_token: tokens.refresh_token } : {})`.
  - `token_expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()`.
- **Plaintext at rest** — no encryption (open decision for V2).

### Token exchange + refresh

- **Code→token exchange** `exchangeGoogleCode(code)`: `POST https://oauth2.googleapis.com/token`, `application/x-www-form-urlencoded`, body `{code, client_id, client_secret, redirect_uri, grant_type:'authorization_code'}`; throws on non-200; returns `{access_token, refresh_token?, expires_in, id_token?}`. `lib/auth/sso.ts:70-84`.
- **Refresh** (grant_type=refresh_token) is **DUPLICATED in FIVE places** (no shared helper). Each POSTs `https://oauth2.googleapis.com/token` with `{client_id, client_secret, refresh_token, grant_type:'refresh_token'}` then persists the new `access_token` + new `expiry` (the refresh path **does NOT re-persist `google_refresh_token`**):
  1. GC adapter `getAccessTokenForCourse` — `lib/integrations/lms/google-classroom.ts:83-101`
  2. `app/api/teacher/google/scope-check/route.ts:37-54`
  3. `app/api/teacher/google/courses/route.ts:29-45`
  4. `app/api/teacher/google/post-assignment/route.ts:47-63`
  5. `app/api/teacher/google/grades/route.ts:46-62`
  > **Reader-flagged disagreement (minor):** the OAuth-token reader said refresh is duplicated in **2** places (adapter + scope-check); the API-surface reader counted **5**. The 5-file list is the authoritative superset (the 2-file count covered only the OAuth-scoped pass). **Treat refresh as duplicated across 5 sites; V2 should centralize into one `getValidGoogleToken()`/token-manager.**
- **Refresh is lazy/on-demand only** — triggered when `google_token_expiry < now()`. **No cron, no background refresh.** Revocation handling = throw / `needsReconnect`.

### Whose grant runs GC calls

GC API calls run **as the TEACHER linked to the course**: `getAccessTokenForCourse(courseExternalId)` resolves `classes.teacher_id` from `classes.google_course_id == courseExternalId`, then uses that teacher's stored tokens. `lib/integrations/lms/google-classroom.ts:55-82`. No class linked / no token / refresh fails → throws (`no_google_token` / `token_refresh_failed`). **Per-teacher, not per-school.**

### Scope verification / reconnect

`GET /api/teacher/google/scope-check`: refresh if expired → call `https://oauth2.googleapis.com/tokeninfo?access_token=...` → read live `info.scope` → diff vs `GC_REQUIRED_SCOPES` → return `{connected, needsReconnect, missing}`. **No stored-scope column; scopes checked at runtime.** Reconnect == re-run `/api/auth/google?mode=classroom` (`prompt=consent`). `app/api/teacher/google/scope-check/route.ts:60-75`.

Mid-session insufficient-scope: a 403 from `classroom.googleapis.com` matching `/insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i` → `LmsScopeError` (surfaces reconnect CTA). `google-classroom.ts:117-125`.

Profile fetch `getGoogleProfile`: `GET https://www.googleapis.com/oauth2/v2/userinfo` (Bearer) → `{id, email, name, picture?, verified_email}`. `lib/auth/sso.ts:86-92`.

### Env vars (V1)

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (all `process.env` + `.trim()`), plus `NEXT_PUBLIC_APP_URL` (redirect/launch-URL base, defaults `https://app.inteliflowai.com` when unset) and `INTERNAL_API_SECRET` (launch-state HMAC).
- **V1 `.env.example` GAP:** `GOOGLE_REDIRECT_URI` is required by code but **NOT listed** in `.env.example` (`.env.example:93-101` lists only `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`NEXT_PUBLIC_APP_URL`). **V2 `.env.example` already lists `GOOGLE_REDIRECT_URI`** (fixes the gap).

---

## 2) V1 Roster Import + GC→CORE Mapping / Anchors

### The wizard

Single client page `/teacher/import/google` — state machine `'select-course' | 'preview' | 'importing' | 'done'`. `app/(dashboard)/teacher/import/google/page.tsx:1-20`.

**Two preconditions before listing courses:**
1. A **per-school Google-SSO config** row (`sso_configs` where `provider='google' AND enabled=true`).
2. A stored **`google_access_token`** on the teacher's `users` row.
`page.tsx:46-57` — `.from('sso_configs').select('provider').eq('school_id', profile.school_id).eq('provider', 'google').eq('enabled', true).maybeSingle(); setHasGoogleSso(!!cfg); … setHasToken(!!profile?.google_access_token);`
> **V2 has NO `sso_configs` table** → open decision whether to keep the school-level gate.

If no token → link to `/api/auth/google?mode=classroom&return=%2Fteacher%2Fimport%2Fgoogle` (`page.tsx:150`). Course-list errors `not_connected`/`token_expired` re-trigger the reconnect prompt (`page.tsx:65-70`).

### The flow (steps)

1. **List courses** — `GET /api/teacher/google/courses` (see §5). Maps `id/name/section/descriptionHeading`; `studentCount: null` (not in list endpoint). No pagination loop (pageSize=50). `app/api/teacher/google/courses/route.ts:54-73`.
2. **Select course → roster** — `GET /api/teacher/google/roster?courseId=<id>`. Seeds all returned students `selected=true`, advances to `preview`. `page.tsx:81-87`.
3. **Roster fetch** — fetches BOTH students (`pageSize=100`) AND teachers (`pageSize=30`) in parallel (`Promise.allSettled`); **only students are used for import** (teachers returned in JSON but unused). **No pagination** in this route. `app/api/teacher/google/roster/route.ts:30-58`. Student mapping: `{ googleId: s.userId, name: s.profile.name.fullName, email: s.profile.emailAddress, photoUrl: s.profile.photoUrl }` (`:38-45`).
4. **"Already in CORE" badge** — determined by an **email-IN query against `public.users`** (`existsInCore = email present`), NOT by `external_identities` or `google_id`. `roster/route.ts:60-68`. (A student already in CORE under a different email shows as new.)
5. **Import** — POST `/api/teacher/google/import-roster` with `{courseId, courseName, gradeLevel, subject, students:[{googleId,name,email}]}` (photoUrl dropped). `page.tsx:96-105`.

### Mapping / anchors (import-roster route)

- **GC course → CORE class** via **`classes.google_course_id` (text)** — THE anchor (1:1, `maybeSingle`): find-by-`google_course_id` → update `name/grade_level/subject`, else insert `{name, grade_level, subject, teacher_id, school_id, google_course_id, is_active:true}`. `import-roster/route.ts:42-65`.
- **Per-student match = EMAIL** (not google_id): if a `users` row exists with that email → reuse (linked++) and **backfill `google_id` if missing**; else create. `import-roster/route.ts:70-86`. **No-email student → silently SKIPPED** (`skipped++`, `:70`).
- **New student creation:** `admin.auth.admin.createUser` with temp password `` `CORE-${crypto.randomUUID().slice(0,8)}` ``, `email_confirm:true`, `full_name` in metadata; then `public.users` insert `{id, full_name, email, role:'student', school_id, google_id}`. `import-roster/route.ts:88-111`. **Auto-creation happens ONLY on this roster-import path.**
- **Enrollment:** `enrollments.upsert({student_id, class_id, is_active:true}, {onConflict:'student_id,class_id'})` — idempotent across re-imports. `:124-128`.
- **Identity capture:** `applyImportedStudentProfile(...)` with `provider:'google_classroom'`, `schoolStudentId:null` (GC never carries the SIS anchor — `capabilities.supportsSisId=false`). `:135-146`. This writes/updates the `external_identities` row, then is a no-op for the SIS anchor (returns `'none'` when `schoolStudentId`/`schoolId` absent). `lib/integrations/lms/rosterIdentity.ts:159-180`.
- **Side-effect:** `ensureCourseLink(...)` pins an "Open CORE" link material into the GC course (idempotent via `lms_publications`), **fail-soft** so a missing `courseworkmaterials` scope doesn't fail the import. `import-roster/route.ts:153-158`; `lib/integrations/lms/courseLink.ts:60-65`.
- **Response:** `{created, linked, skipped, class_id, course_link}` → Created/Linked/Skipped stat tiles. `:160`.

### Two roster-read paths (unify in V2)

| Path | Pagination | Email handling | Used by |
|---|---|---|---|
| `GET /api/teacher/google/roster` | **None** (pageSize=100 only) | as-is | the wizard |
| adapter `importStudentProfiles` | **Paginated** (loops `nextPageToken`) | lowercased | the connector layer (canonical) |
`google-classroom.ts:254-285` (paginated). **V2 should unify on the paginated one.**

### V1 identity tables (074) — the canonical GC identity model

- **`external_identities`** (074): `id, school_id, student_id (NOT NULL → users), provider, external_user_id (nullable), email, created_at, last_seen_at`; **`UNIQUE(provider, external_user_id)`**; idx `(provider, lower(email))` + `(student_id)`. **RLS enabled, NO client policies (deny-by-default)** — read only via the definer fn / service role. `074_lms_connector.sql:12-26, 80-87`.
- **`resolve_external_identity(provider, external_user_id, email)`** — SECURITY DEFINER: external id first, then **UNAMBIGUOUS** verified-email (`count(DISTINCT student_id)=1 … ELSE NULL`), else NULL; **never auto-creates**. Used at **LAUNCH** (silent SSO), NOT at import. `074_lms_connector.sql:54-78`; callback `route.ts:164-178`.

> **CRITICAL SHAPE MISMATCH:** V1's `external_identities` keys on **`(student_id, provider, external_user_id, email)`** with `UNIQUE(provider, external_user_id)`. **V2's existing `external_identities` (migration 0008) keys on `(school_id, provider, external_id)` with `core_student_id`** — a DIFFERENT shape, built for LIFT/Spark. V2 has **no `resolve_external_identity` function**. The port must reconcile (see Open Decisions).

### SIS anchor (out of GC scope, FYI)

`school_student_id` on `users` (075) arrives via **admin CSV** (`roster_imports`/`roster_import_rows`), NOT GC. GC adapter always sets `schoolStudentId:null`. For a pure GC port this is a no-op. `075_sis_anchor_roster_imports.sql:27-45,70-81`.

---

## 3) V1 Assignment Publish + Grade Passback

> **Two generations coexist (both live code):**
> **(A) CURRENT connector + `lms_publications`** (migration 074, `lib/integrations/lms/`).
> **(B) LEGACY per-student routes** (`/post-assignment`, `/grades`, gated by `classes.google_feed_enabled` / `google_grade_sync_enabled`).

### (A) CURRENT — publish

- **Trigger:** `POST /api/teacher/google/publish`. Authorizes the class (teacher owns it AND `classes.google_course_id` set), idempotent on the `lms_publications` UNIQUE, builds CORE launch URL, calls `connector.publishAssignment`, then INSERTs `lms_publications`. `publish/route.ts:160-199`.
  `const launchUrl = ` ``${appUrl()}/launch/${resource_type}/${resource_id}?src=${PROVIDER}`` `;` … `grade_passback_enabled: grade_passback_enabled ?? true` (**defaults true at publish time**).
- **courseWork.create:** `POST /courses/{courseId}/courseWork`, body `{title, description, workType:'ASSIGNMENT', state:'PUBLISHED', materials:[{link:{url:launchUrl}}], maxPoints?, dueDate?/dueTime?}` — **launch URL is a LINK MATERIAL, not pasted into description.** Returns `id` → `externalAssignmentId`. `google-classroom.ts:152-176`. Due split via `toGcDue` (UTC y/m+1/d, h/m) `:131-137`.
- **Persisted join key:** `external_assignment_id` on the `lms_publications` row (`publish/route.ts:191`). This is the courseWork id the passback path later reads.

### (A) CURRENT — grade passback

- **Gate = `lms_publications.grade_passback_enabled`** (per-PUBLICATION boolean), **NOT** a column on `classes`. `pushGradeForResource` only pushes for `status='published' AND grade_passback_enabled=true`. `gradePassback.ts:131-137`.
- **Triggers** — 3 call sites, all fire-and-forget via Next.js `after()` AFTER grading:
  1. student homework submit → `resourceType:'homework'`, keys on **lesson id** — `homework-submit/route.ts:475-482`
  2. student quiz submit → `resourceType:'quiz'`, keys on `quiz.id` — `[attemptId]/submit/route.ts:380-388`
  3. teacher grade override → `resourceType:'homework'` (re-sync) — `teacher/homework/grade/route.ts:71-91`
  SPARK hard-blocked (`gradePassback.ts:119` → `spark_not_graded`).
- **Endpoint sequence:** list `/courses/{course}/courseWork/{cw}/studentSubmissions?userId={studentExternalId}` → take `studentSubmissions[0]` → **PATCH** `/studentSubmissions/{id}?updateMask=assignedGrade,draftGrade` with **both** `{assignedGrade, draftGrade}` set to the score. **Does NOT call `:return`.** `google-classroom.ts:211-237`.
- **Score scaling:** CORE 0-100 → `publication.max_points` (clamp 0..max, 1 decimal). `mapScoreToPoints` `gradePassback.ts:69-73`.
- **Student-id resolution:** from `external_identities` for the student (provider `google_classroom`), prefer `external_user_id` then email. `gradePassback.ts:97-111`. GC `userId` param accepts either.
- **Failure handling:** FAIL-SOFT (never throws into grading). Retries `[1000,3000]ms`, records `lms_publications.last_sync_error` + Sentry; `LmsScopeError` (403 insufficient-scope) short-circuits retries (permanent until reconnect). `gradePassback.ts:64-65,193,202-204`.

### (B) LEGACY — publish (`POST /api/teacher/google/post-assignment`)

- **Gated by `classes.google_feed_enabled`.** Posts **PER-STUDENT** courseWork (`assigneeMode:'INDIVIDUAL_STUDENTS'`, `individualStudentsOptions:{studentIds:[student.google_id]}`), launch URL **pasted into description**, `maxPoints:100` hardcoded, raw fetch (no connector). Logs to `google_assignment_posts`. `post-assignment/route.ts:24-30,82-101`.

### (B) LEGACY — grades (`POST /api/teacher/google/grades`)

- **Gated by `classes.google_grade_sync_enabled`** (the per-class column). Find-or-create courseWork **by exact title match**, list `studentSubmissions?userId={google_id}`, PATCH `updateMask=assignedGrade,draftGrade`, **THEN call `:return`** to release the grade. Logs to `google_grade_sync`. `grades/route.ts:24-30,128-146`.
- **KEY DIVERGENCE:** legacy `/grades` calls `studentSubmissions:return`; the CURRENT connector does **NOT**. (Open decision: does V2 want to release the grade to students?)
- **Schema drift (do NOT copy):** `000_full_schema.sql` defines `google_grade_sync` with `gc_coursework_id/status/synced_at`, but the route inserts `google_coursework_id/sync_status/core_attempt_id/attempt_type/score` — a 42703 risk noted in eduflux-parity audits. V2 should skip the legacy tables entirely.

### Which gate is which (resolves the prompt's column question)

- `classes.google_grade_sync_enabled` → gates **ONLY the LEGACY `/grades` route**.
- `lms_publications.grade_passback_enabled` → gates the **CURRENT connector** passback.
- `classes.google_feed_enabled` → gates **ONLY the LEGACY `/post-assignment` route**.

---

## 4) V1 Data Model + Env + Raw-fetch-vs-googleapis

### Raw fetch, zero deps

**No `googleapis` / `google-auth-library` / `@googleapis` / `jsonwebtoken` dependency anywhere** (grep of `package.json` = "No matches found"). The adapter is the **only file allowed to call `classroom.googleapis.com`**; `const GC_BASE = 'https://classroom.googleapis.com/v1';` (`google-classroom.ts:41`). Header comment: "all GC calls are raw fetch (no googleapis npm package anywhere … zero new dependencies)" (`google-classroom.ts:6-8`). The connector registry is the single seam: `getConnector('google_classroom')` (`registry.ts:11-24`).

### Columns / tables (V1)

| Object | Columns / shape | Where defined |
|---|---|---|
| `public.users` | `google_id, microsoft_id, google_access_token, google_refresh_token, google_token_expiry, sso_provider` (all nullable) | **reconcile** `reconcile-eduflux-2026-06-04c.sql:108-117` (NOT in 000) |
| `public.classes` | `google_course_id text`, `google_grade_sync_enabled bool DEFAULT false`, `google_feed_enabled bool DEFAULT false` | `000_full_schema.sql:71-85` |
| `public.classes` (later) | `google_classroom_id text` (redundant/legacy duplicate of `google_course_id`, apparently unused), `leaderboard_enabled`, `updated_at` | reconcile `:84-88` |
| `public.schools` | `google_classroom_enabled bool DEFAULT false` | `000_full_schema.sql:8-19` |
| `external_identities` | see §2 (074) | `074_lms_connector.sql:12-26` |
| `lms_publications` | `id, school_id, provider, course_external_id NOT NULL, external_assignment_id, resource_type CHECK IN ('quiz','homework','spark','course_link'), resource_id, published_by, launch_url NOT NULL, grade_passback_enabled NOT NULL DEFAULT true, max_points numeric, status NOT NULL DEFAULT 'published', last_sync_error` ; **UNIQUE(provider, resource_type, resource_id, course_external_id)** | `074_lms_connector.sql:29-46` |
| `resolve_external_identity(...)` | SECURITY DEFINER RPC | `074:54-78` |
| LEGACY logs | `google_grade_sync`, `google_assignment_posts` (with 000↔route column drift) | `000:508-530` + reconcile-16b |
| SIS anchor (non-GC) | `users.school_student_id` + `roster_imports`/`roster_import_rows` | `075` |
| SIS hint (non-GC) | `users.sis_external_id`, `classes.sis_external_id` (match HINT only, NOT the anchor) | `025_sis_integration.sql:78-80` |

`lms_publications` RLS limits teachers to `published_by = auth.uid()`; `external_identities` has NO client policies. `074:84-104`.

### Env (V1)

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (read+`.trim()`), `NEXT_PUBLIC_APP_URL`, `INTERNAL_API_SECRET`. `GOOGLE_REDIRECT_URI` absent from V1 `.env.example` (code-required gap).

---

## 5) Exact Google API Surface V1 Uses (endpoint table)

Base: `https://classroom.googleapis.com/v1` (pinned). OAuth: `accounts.google.com/o/oauth2/v2/auth`, `oauth2.googleapis.com/token`, `oauth2.googleapis.com/tokeninfo`, `www.googleapis.com/oauth2/v2/userinfo`. Drive: `www.googleapis.com/drive/v3`.

| # | URL | Method | Scope | Request fields / params | Response fields read | Citation |
|---|---|---|---|---|---|---|
| 1 | `accounts.google.com/o/oauth2/v2/auth` | GET (redirect) | — | login: `scope=openid email profile`, `access_type=offline`, `prompt=select_account`; classroom: 7 scopes + `prompt=consent` | (consent redirect) | `sso.ts:27-38, 49-68` |
| 2 | `oauth2.googleapis.com/token` | POST (form) | — | exchange: `{code, client_id, client_secret, redirect_uri, grant_type:'authorization_code'}` ; refresh: `{client_id, client_secret, refresh_token, grant_type:'refresh_token'}` | `access_token, refresh_token?, expires_in, id_token?` | `sso.ts:70-84`; refresh ×5 (see §1) |
| 3 | `oauth2.googleapis.com/tokeninfo?access_token=<t>` | GET | — | — | `info.scope` (space-delimited) | `scope-check/route.ts:60-69` |
| 4 | `www.googleapis.com/oauth2/v2/userinfo` | GET (Bearer) | `openid email profile` | — | `id, email, name, picture?, verified_email` | `sso.ts:86-92` |
| 5 | `/courses?teacherId=me&courseStates=ACTIVE&pageSize=50` | GET (Bearer) | `classroom.courses.readonly` | (no pagination loop) | `courses[].{id,name,section,descriptionHeading}` (`enrollmentCode` in the dup route); `studentCount: null` (not returned) | `courses/route.ts:54-72`; DUP `lessons/google-courses/route.ts:41-59` (5-min cache) |
| 6 | `/courses/{courseId}/students?pageSize=100` | GET (Bearer) | `classroom.rosters.readonly` + `classroom.profile.emails` | (no pagination, wizard route) | `students[].userId`, `students[].profile.{name.fullName, emailAddress, photoUrl}` | `roster/route.ts:31-45` |
| 7 | `/courses/{courseId}/teachers?pageSize=30` | GET (Bearer) | `classroom.rosters.readonly` | — | `teachers[].userId`, `profile.{name.fullName, emailAddress}` (fetched, unused in import) | `roster/route.ts:32,48-57` |
| 8 | `/courses/{courseId}/students?pageToken=<t>` | GET (Bearer) | rosters.readonly + profile.emails | loops `nextPageToken` | `students[].userId`, `profile.emailAddress` (lowercased), `profile.name.fullName`; `schoolStudentId:null` | adapter `google-classroom.ts:264-285` |
| 9 | `/courses/{courseId}/courseWork` | POST (Bearer) | `classroom.coursework.students` | adapter: `{title, description, workType:'ASSIGNMENT', state:'PUBLISHED', materials:[{link:{url}}], maxPoints?, dueDate?/dueTime?}` | `id` → externalAssignmentId | `google-classroom.ts:152-175` |
| 10 | `/courses/{courseId}/courseWork` | POST (Bearer) | `classroom.coursework.students` | LEGACY: `{title:'CORE Homework: …', description:'…launch URL as text', workType:'ASSIGNMENT', state:'PUBLISHED', maxPoints:100, assigneeMode:'INDIVIDUAL_STUDENTS', individualStudentsOptions:{studentIds:[google_id]}, dueDate?/dueTime(23:59)?}` | `id` | `post-assignment/route.ts:82-102` |
| 11 | `/courses/{courseId}/courseWorkMaterials` | POST (Bearer) | `classroom.courseworkmaterials` | `{title, state:'PUBLISHED', materials:[{link:{url}}]}` | `id` → externalMaterialId | `google-classroom.ts:186-203` |
| 12 | `/courses/{courseId}/courseWork?pageSize=100` | GET (Bearer) | coursework.students | find-or-create by **exact `title===`** | `courseWork[].id` | `grades/route.ts:74-100` |
| 13 | `/courses/{courseId}/courseWork?pageSize=50` + `/courses/{courseId}/courseWorkMaterials?pageSize=50` | GET (Bearer) | coursework.students / courseworkmaterials | parallel | `data.courseWork[]` and **`data.courseWorkMaterial[]` (SINGULAR key)**; `{id,title,description,creationTime,materials}` | `lessons/google-items/route.ts:34-67` |
| 14 | `/courses/{c}/courseWork/{cw}/studentSubmissions?userId=<googleUserId>` | GET (Bearer) | coursework.students | — | `studentSubmissions[0].id` | `google-classroom.ts:212-222`; `grades/route.ts:110-120` |
| 15 | `/courses/{c}/courseWork/{cw}/studentSubmissions/{id}?updateMask=assignedGrade,draftGrade` | PATCH (Bearer) | coursework.students | `{assignedGrade, draftGrade}` (both = score) | — | `google-classroom.ts:227-234`; `grades/route.ts:128-133` |
| 16 | `/courses/{c}/courseWork/{cw}/studentSubmissions/{id}:return` | POST (Bearer) | coursework.students | (no body) — **LEGACY `/grades` ONLY; connector does NOT** | — | `grades/route.ts:142-146` |
| 17 | `drive/v3/files/{id}/export?mimeType=text/plain` then `drive/v3/files/{id}?alt=media` | GET (Bearer) | `drive.readonly` | from `att.driveFile.driveFile.id` | file content (Docs export / binary) | `parse-google/route.ts:54-84` |

**Scope sets (two lists exist):**
- **Requested** by `getGoogleClassroomAuthUrl` (7): `openid email profile`, `classroom.courses.readonly`, `classroom.rosters.readonly`, `classroom.profile.emails`, `classroom.coursework.students`, `classroom.courseworkmaterials`, `drive.readonly`. `sso.ts:49-67`.
- **Required/gated** `GC_REQUIRED_SCOPES` (5, the reconnect-check list): omits `drive.readonly` AND `openid/email/profile`. `google-classroom.ts:44-50`.

**API-version note (unverified against live API):** `classroom/v1`, `oauth2/v2/userinfo`, `tokeninfo` are version-pinned in V1; the API-surface reader flagged these should be sanity-checked against the current live Google API before the V2 build (e.g. tokeninfo deprecation status). **Unverified.**

---

## 6) V2 Current GC Scaffolding + Standard Auth Chain + Next Migration

### What V2 already has (schema stubs, no code)

| Item | Where | Note |
|---|---|---|
| `classes.google_course_id text` | `0002_classes_enrollments.sql:19` | the GC↔course link column — **already present** |
| `classes.google_grade_sync_enabled bool DEFAULT false` | `0002:20` | per-class grade-sync toggle — already present |
| `classes.google_feed_enabled bool DEFAULT false` | `0002:21` | pre-existing extra toggle, **no code reader; semantics vs grade_sync undocumented in V2** |
| `schools.google_classroom_enabled bool DEFAULT false` | `0001_identity_roles.sql:18` | school-level GC gate — already present |
| `schools.state text` (nullable) | `0020_content_studio_generate.sql:17-20` | **UNPOPULATED**; comment: "Populated manually/at provisioning later". CLAUDE.md defers auto-populate to **this GC epic** |
| `external_identities (school_id, provider, external_id, core_student_id)`, `UNIQUE(school_id, provider, external_id)`, idx lookup | `0008_platform.sql:69-80` | provider comment already lists `'google'`; **DIFFERENT shape than V1's** (see §2); **UNUSED in src** today |
| `platform_links (school_id, product, api_key, label, core_base_url, enabled, key_version, rotated_at, expires_at, last_used_at)`, **`product CHECK IN ('spark','lift','custom')`**, `UNIQUE(school_id, product)` | `0008:44-59` | **`'google'` is NOT an allowed product** |
| `webhook_idempotency_keys`, `platform_events` | `0008:18-28, 87-101` | idempotency state-machine + audit substrate, RLS deny-by-default |
| GC env placeholders | `.env.example:48-51` (`GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`) | name-only; read by NO code (only `config.test.ts:53-56` asserts presence) |

**ABSENT in V2 (greenfield):** no `src/app/api/auth/google` route, no `src/app/api/teacher/google` route, **no `google_access_token`/`google_refresh_token`/`google_token_expiry` columns anywhere**, no `googleapis`/`google-auth-library` dependency, no `resolve_external_identity` function, no `sso_configs` table, no `lms_publications` table. Searched: `classroom`, `courseWork`, `courses`, `studentSubmissions`, `googleapis`, `accounts.google.com/o/oauth2`, `oauth2/v4/token`, `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`, `refresh_token`, `access_token`.

### The standard protected-route auth chain (V2 canonical)

From `src/app/api/teacher/classes/route.ts:30-66` (the clean example to port from):
```
const supabase = await createServerSupabaseClient();
const { data: { user }, error: authError } = await supabase.auth.getUser();   // 401 on fail
if (authError || !user) return 401;
const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
if (!role || !new Set(STAFF_ROLES).has(role)) return 403;
const admin = createAdminSupabaseClient();   // synchronous, reads SUPABASE_SECRET_KEY, BYPASSES RLS
// then explicit per-role scoping: teacher → .eq('teacher_id', user.id); school_admin → .eq('school_id', …); platform_admin → no filter
```
- `STAFF_ROLES = ['teacher','school_admin','school_sysadmin','platform_admin']`; `SCHOOL_ADMIN_ROLES = ['school_admin','school_sysadmin','platform_admin']`. `src/lib/auth/roles.ts:10-13`.
- Object-level IDOR guards (the ONLY access control on admin-client cross-user reads — "RLS is NOT the backstop here"): `guardPlatformAdmin()`, `guardSchoolAdmin()` (returns `{schoolId|null, role, userId, isPlatformAdmin}` — **branch on `isPlatformAdmin` before using `schoolId` in a filter, it's null for platform_admin**), `guardClassAccess(classId)`, `guardStudentAccess(studentId)`. `src/lib/auth/guards.ts:31-106`.
- `createAdminSupabaseClient()` is **synchronous**, reads `SUPABASE_SECRET_KEY`, bypasses RLS — the only way to read RLS-locked `external_identities`/`platform_links`/token rows. `createServerSupabaseClient()` is async (Next 16 async `cookies()`). `src/lib/supabase/server.ts:5-32`.

### Next migration number

Latest is **`0021_student_drawings.sql`** → the GC epic's next migration is **`0022_*.sql`**. Migrations are static-text-asserted in `supabase/migrations/__tests__/migrations.test.ts`. Storage-bucket idiom (if needed): idempotent `insert into storage.buckets (… public=false) on conflict do update`, admin-client proxy route for per-read authz, no `storage.objects` policies (`0021:2-9`).

### House env idiom

No central config module; each integration reads `process.env` at module top-level with a default, e.g. `src/lib/spark/config.ts:5-6`. GC should add `src/lib/google/config.ts` reading the three `GOOGLE_*` vars the same way.

---

## 7) V2 SPARK External-Integration Pattern to Mirror

| Concern | SPARK precedent | GC adaptation |
|---|---|---|
| Config | 2 module-top `process.env` reads w/ defaults, no central module (`spark/config.ts:5-6`) | `src/lib/google/config.ts` for `GOOGLE_*` |
| Secret model | ONE symmetric `CORE_SPARK_API_SECRET` (Bearer + HS256 HMAC + inbound-Bearer) — `signLaunchJwt.ts:23`, `notifyAssignmentCreated.ts:73`, `spark-attempt-complete:42` | **DIVERGES** — GC is **asymmetric OAuth** (per-school/per-teacher refresh+access tokens). The single-secret model does NOT fit token storage |
| Minimal deps | hand-rolled HS256 JWT over `node:crypto`, "No jsonwebtoken dependency (V2 choice)" (`signLaunchJwt.ts:1-2`) | GC token exchange: choose hand-rolled `fetch` (mirrors V1 + SPARK ethos) vs `google-auth-library` |
| Inbound auth | constant-time `bearerMatches`/`safeEqual` (`spark/auth.ts:6-19`) | reuse IF GC adds an inbound webhook (Pub/Sub); GC inbound would verify a Google-signed message, not a static Bearer |
| Per-school provisioning | two-sided idempotent: `provisionSparkSchool()` (remote POST) + `provisionSparkLink()` upsert `platform_links` `onConflict 'school_id,product'` (`provisionSparkSchool.ts:20-23`, `sparkLink.ts:34-46`) | GC connect could upsert a `platform_links`-style row — but OAuth tokens (refresh/access/expiry/scope) don't fit one `api_key` column |
| Enablement gate | presence of enabled `platform_links` row, `.maybeSingle()` (1:1 read), no license table (`sparkLink.ts:12-25`) | GC connected/disconnected state ↔ equivalent row |
| 1:1 mapping | `platform_links UNIQUE(school_id,product)` + `.maybeSingle()` (`sparkLink.ts:18`). **`resolveCoreBaseUrl` is SPARK-side, ABSENT from V2 src** | GC keeps the same 1:1 read idiom |
| Outbound call discipline | fire-and-forget, **never throws**, non-blocking at call site, writes a status column on failure (`notifyAssignmentCreated.ts:2-3`; call site `assignments/generate/route.ts:181-226` → `spark_status:'notify_failed'`) | GC grade-push / assignment-push should NOT fail the teacher action; record status instead |
| Timeout + idempotency | `AbortController` 35s, `X-Idempotency-Key = ${coreHomeworkId}_${studentId}` (`notifyAssignmentCreated.ts:40,66-78`) | reusable idempotency-key derivation |
| Inbound idempotency | full state machine on `webhook_idempotency_keys` (`in_progress→completed\|failed`), `UNIQUE(endpoint, idempotency_key)`, 7-day TTL, **NEVER 5xx for business outcomes** (200 + status body; only 401/400 non-200) (`spark-attempt-complete:13-15,62-102,167-172`) | reuse IF GC has inbound push |
| Identity | SPARK got away WITHOUT `external_identities` (round-trips CORE-native ids). **GC CANNOT** — independent Google userIds/courseIds → `external_identities` create-vs-match is **mandatory** (`spark-attempt-complete:4` comment) | GC is `external_identities`' intended first real consumer |
| Admin one-click | `POST /api/admin/spark-enable` — `guardPlatformAdmin`, 3-step orchestration, idempotent-on-repeat (reuses api_key), per-step status map (`spark-enable/route.ts:14-57`) | template for a "Connect GC for this school" admin action — BUT GC connect is usually **teacher-initiated OAuth consent**, not super-admin one-click |
| Contract purity | pure mappers, no I/O (`spark/contract.ts:1`) | isolate GC field mapping in `src/lib/google/contract.ts` |
| Audit | writes `platform_events` (source/event_type/school_id/student_id/payload/processed) (`spark-attempt-complete:146-158`) | GC sync events write here with `source:'google_classroom'` |
| Cron | `/api/cron/idempotency-sweep` gated by `CRON_SECRET` (`config.test.ts:112-117`) | model for nightly GC sync / token refresh if desired |
| External binding columns | additive nullable cols on `assignments` + CHECK status enum, written back post-call (`0012_spark.sql:8-21`; `spark_status IN ('none','notified','created','in_progress','completed','notify_failed')`) | parallel `google_coursework_id` + `google_grade_sync` status enum on `assignments`/publications |

---

## 8) V1→V2 GAP MAP

| Capability | V1 has | V2 has | Net-new for V2 |
|---|---|---|---|
| **OAuth login (Google)** | `getGoogleAuthUrl`, callback login branch, `linkOrCreateUser` | nothing | entire login flow (or decide GC-only, skip Google-login) |
| **Classroom connect (scope upgrade)** | `?mode=classroom`, cookies, connect callback attaches to current user | nothing | build the connect route + callback branch |
| **Token storage** | `users.google_access_token/refresh_token/token_expiry` (+ `google_id/sso_provider`) via reconcile SQL | **NONE** | migration 0022 to add token storage (grain TBD: per-teacher users cols vs per-school table) |
| **Token exchange/refresh** | `exchangeGoogleCode` + refresh duplicated ×5 | nothing | one centralized token-manager |
| **Scope check / reconnect** | `/scope-check` via tokeninfo, `GC_REQUIRED_SCOPES`, `LmsScopeError` 409 | nothing | port route + scope list + error mapping |
| **Course list** | `/courses` + duplicate `lessons/google-courses` (cached) | nothing | one consolidated route |
| **Roster read** | un-paginated `/roster` + paginated adapter `importStudentProfiles` | nothing | one paginated route |
| **Roster import (class+enroll+create)** | `import-roster` (class upsert by `google_course_id`, email-match, auto-create students, enroll, identity, pin link) | `classes.google_course_id` column exists; `enrollments` exists | the whole import route |
| **Identity table** | `external_identities (student_id, provider, external_user_id, email)` + `resolve_external_identity` RPC | `external_identities (school_id, provider, external_id, core_student_id)` — **different shape**, no RPC | reconcile shapes OR add a GC-resolution fn |
| **Assignment publish** | connector `publishAssignment` → courseWork link-material + `lms_publications` row | nothing (no `lms_publications`) | publications table + publish route + connector |
| **Grade passback** | `gradePassback.pushGradeForResource` (fire-and-forget `after()`, gate `grade_passback_enabled`, 0-100→max_points, fail-soft, retry) | nothing | the whole passback path |
| **Course-link material** | `ensureCourseLink` / `createCourseLink` ("Open CORE") | nothing | port (or fold into publish) |
| **GC content import (Drive)** | `parse-google` via `drive.readonly` | V2 has its own URL-import (Content Studio Seg 2) | decide if GC-attachment import is in GC-epic scope |
| **Silent SSO launch** | `/api/auth/google/launch`, HMAC state, `resolve_external_identity`, `/launch/unmatched` | nothing; `INTERNAL_API_SECRET` presence unknown | decide if student launch is in scope |
| **School-level GC gate** | `schools.google_classroom_enabled` + per-school `sso_configs` | `schools.google_classroom_enabled` exists; **no `sso_configs`** | decide gate model |
| **`schools.state` population** | N/A | column exists, **UNPOPULATED** | CLAUDE.md defers auto-populate to THIS epic |
| **Connector registry seam** | `registry.ts` getConnector | nothing | optional (single-provider; may not need the abstraction) |
| **Dependencies** | none (raw fetch) | none | choose raw fetch (recommended) vs SDK |

---

## 9) OPEN DECISIONS for the Spec

1. **Token storage location + grain.** V1 = plaintext text cols on `users` (per-TEACHER). V2 has none. Options: (a) port the V1 `users` columns (per-teacher, mirrors V1's "act as the linked teacher" model); (b) a dedicated `0022` table (e.g. `google_oauth_tokens`); (c) `platform_links` with a new `'google'` product (but refresh/access/expiry/scope don't fit one `api_key` column — would need ALTER + extra columns). **Recommendation: per-teacher columns on `users` (mirror V1 exactly) — it's the proven model and GC calls run as the linked teacher. Consider at-rest encryption (see #2).**
2. **At-rest token encryption.** V1 stores plaintext. **Recommendation: port as-is for the pilot Beta (matches V1, no infra), log an explicit deferred security item to encrypt (sits next to the `security-advisories-deferred` memory).**
3. **Per-teacher vs per-school OAuth.** V1 = per-teacher grant (course→`teacher_id`→tokens); SPARK = per-school. **Recommendation: per-teacher** (GC consent is teacher-initiated; co-teachers each grant their own). Keep `schools.google_classroom_enabled` as the school feature flag.
4. **Scope set — read-only vs read-write.** V1 requests 7 (incl. `drive.readonly` + write scopes `coursework.students` + `courseworkmaterials`); `GC_REQUIRED_SCOPES` gates 5 (omits drive + login triplet). **Recommendation: request the full V1 write set (roster + publish + grade need it); make `GC_REQUIRED_SCOPES` the canonical reconnect-check list. Include `drive.readonly` ONLY if GC-attachment lesson import is in scope (see #9).**
5. **Which write-back generation to port.** CURRENT connector + `lms_publications` (per-publication `grade_passback_enabled`, class-wide link-material, no `:return`) vs LEGACY per-student routes (`classes.google_feed_enabled`/`google_grade_sync_enabled`, `:return`, schema-drifted log tables). **Recommendation: port ONLY the connector path; ignore the legacy pair and its drifted tables. Note V2 already has the unused `classes.google_feed_enabled`/`google_grade_sync_enabled` stubs — leave them or repurpose `google_grade_sync_enabled` as a per-class master toggle layered above per-publication gating.**
6. **Grade-sync trigger + direction + release.** Direction = CORE→GC (push grades OUT). V1 triggers: fire-and-forget `after()` on homework-submit / quiz-submit / teacher-override. **Decision: does V2 release grades to students (`studentSubmissions:return`)?** Connector does NOT; legacy DOES. **Recommendation: mirror the connector (PATCH `assignedGrade`+`draftGrade`, no `:return`) so teachers control release in GC; revisit if pilots want auto-release.**
7. **Identity model — reconcile the `external_identities` shape clash.** V1 = `(student_id, provider, external_user_id, email)` + `resolve_external_identity` RPC; V2 = `(school_id, provider, external_id, core_student_id)`, no RPC. **Recommendation: adapt onto V2's existing table** (`provider='google'`, `external_id=Google userId`, `core_student_id`), and add a small `resolve` helper (SECURITY DEFINER fn OR a service-role TS function: external_id-first, then unambiguous verified-email). Decide whether to add an `email`/`last_seen_at` column to V2's table for the email-fallback + freshness (V1 relies on them).
8. **Import-time match key.** V1 matches by EMAIL at import (google_id backfilled), but resolves by google-id-first at LAUNCH. **Recommendation: keep email as the import-time match key (V1 parity) AND write the `external_identities` google-id row at import so any future launch resolves by id.**
9. **GC-attachment lesson import (Drive) in scope?** V1 has `parse-google` (`drive.readonly`); V2 already has a generic URL-import (Content Studio Seg 2). **Recommendation: OUT of the GC epic's core (roster/assignment/grade). Defer GC-attachment import as a follow-up; if dropped, also drop `drive.readonly` from the requested scopes.**
10. **Student silent-SSO launch in scope?** V1 has the full `/launch` + HMAC-state + `resolve_external_identity` + `/launch/unmatched` flow (needs `INTERNAL_API_SECRET`). **Recommendation: NOT in the first GC slice** — focus on teacher connect + roster + publish + grade. Re-scope launch as a fast-follow once identity rows exist. (Confirm whether `INTERNAL_API_SECRET` exists in V2 if launch is pulled in.)
11. **googleapis lib vs raw fetch.** V1 + SPARK both hand-roll raw fetch, zero deps. **Recommendation: raw fetch over `classroom/v1`** (mirror V1, honor the minimal-dep ethos). Centralize the one token-manager (fix V1's 5× duplication).
12. **Provisioning / secret storage (mirror SPARK).** `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` are app-global env (one Google Cloud project, ONE registered redirect URI shared by login+connect+launch). Connect is teacher-initiated OAuth (not super-admin one-click). **Recommendation: app-global client creds in Vercel env; per-teacher tokens in DB; school enablement via `schools.google_classroom_enabled` (admin toggles). Confirm the exact registered redirect URI for V2's Google Cloud project.**
13. **`schools.state` auto-population.** CLAUDE.md defers this to the GC epic. **Recommendation: derive `state` from the school's address/profile at GC provisioning (or admin-set); falls back to the existing inline teacher-pick in the generator when null.** Source of the value is undecided in code — the spec must name it.
14. **Co-teacher behavior.** V1 fetches GC teachers but uses only the importing user as `class.teacher_id`. **Recommendation: keep single-teacher-of-record for the pilot; note co-teacher handling as deferred.**
15. **No-email students.** V1 silently skips them. **Recommendation: surface a "skipped (no email)" count on the done screen (V1 already returns `skipped`); decide if a queue is needed — likely not for the pilot.**
16. **Course-list/roster route consolidation.** V1 has 2 course-list routes (one cached) and 2 roster-read paths (one paginated). **Recommendation: ONE paginated course-list + ONE paginated roster route in V2.**

---

## 10) Files-of-Record (exact paths an implementer must read)

### V1 — `C:/users/inteliflow/core`
**OAuth + tokens + launch**
- `lib/auth/sso.ts` (auth URLs, exchange, refresh, profile, silent-launch URL)
- `app/api/auth/google/route.ts` (initiation, mode=classroom cookies)
- `app/api/auth/google/callback/route.ts` (3-branch callback: login / connect / launch)
- `app/api/auth/google/launch/route.ts` (student silent SSO initiation)
- `lib/integrations/lms/launchState.ts` (HMAC state sign/verify)
- `app/api/teacher/google/scope-check/route.ts` (tokeninfo scope check / reconnect)

**Connector + write-back (CURRENT)**
- `lib/integrations/lms/google-classroom.ts` (THE adapter — every GC HTTP call)
- `lib/integrations/lms/gradePassback.ts` (passback orchestration, scaling, fail-soft)
- `lib/integrations/lms/types.ts` (`LmsScopeError`, connector types)
- `lib/integrations/lms/registry.ts` (connector seam)
- `lib/integrations/lms/rosterIdentity.ts` (`applyImportedStudentProfile`, `captureRosterIdentity`)
- `lib/integrations/lms/courseLink.ts` (`ensureCourseLink` / `createCourseLink`)
- `app/api/teacher/google/publish/route.ts` (publish trigger → `lms_publications`)
- `app/api/attempts/homework-submit/route.ts` (passback trigger — homework)
- `app/api/attempts/[attemptId]/submit/route.ts` (passback trigger — quiz)
- `app/api/teacher/homework/grade/route.ts` (passback trigger — override re-sync)

**Roster import**
- `app/(dashboard)/teacher/import/google/page.tsx` (wizard UI)
- `app/api/teacher/google/courses/route.ts` (course list + inline refresh)
- `app/api/teacher/google/roster/route.ts` (un-paginated roster + existsInCore)
- `app/api/teacher/google/import-roster/route.ts` (class upsert, create/enroll, identity, pin link)

**Legacy write-back (read to decide NOT to port)**
- `app/api/teacher/google/post-assignment/route.ts`
- `app/api/teacher/google/grades/route.ts`

**GC content import (Drive — only if in scope)**
- `app/api/teacher/lessons/google-courses/route.ts` (duplicate course list, cached)
- `app/api/teacher/lessons/google-items/route.ts` (courseWork/courseWorkMaterials list — note SINGULAR `courseWorkMaterial` key)
- `app/api/teacher/lessons/parse-google/route.ts` (Drive export)

**Schema**
- `supabase/migrations/074_lms_connector.sql` (`external_identities`, `lms_publications`, `resolve_external_identity`, RLS)
- `supabase/migrations/075_sis_anchor_roster_imports.sql` (SIS anchor — non-GC, context)
- `supabase/migrations/025_sis_integration.sql` (`sis_external_id` hint columns)
- `supabase/migrations/000_full_schema.sql` (classes/schools GC columns; legacy log tables)
- `supabase/reconcile-eduflux-2026-06-04c.sql` (the users `google_*` token columns DDL)
- `supabase/reconcile-eduflux-2026-06-16b.sql` (legacy log-table column drift notes)
- `.env.example` (GC env — note the missing `GOOGLE_REDIRECT_URI`)

**Tests / docs (reference)**
- `__tests__/lib/integrations/lms/gradePassback.test.ts`
- `__tests__/lib/integrations/lms/googleClassroom.test.ts`
- `docs/gc-launch-links-runbook.md`

### V2 — `C:/users/inteliflow/NEW-CORE`
- `supabase/migrations/0001_identity_roles.sql` (`schools.google_classroom_enabled`)
- `supabase/migrations/0002_classes_enrollments.sql` (`classes.google_course_id/google_grade_sync_enabled/google_feed_enabled`)
- `supabase/migrations/0008_platform.sql` (`external_identities`, `platform_links` CHECK, `webhook_idempotency_keys`, `platform_events`, RLS)
- `supabase/migrations/0012_spark.sql` (assignments external-binding columns + status enum pattern)
- `supabase/migrations/0020_content_studio_generate.sql` (`schools.state` — unpopulated)
- `supabase/migrations/0021_student_drawings.sql` (latest; next = **0022**; storage-bucket idiom)
- `supabase/migrations/__tests__/migrations.test.ts` (migrations are static-text-asserted)
- `src/lib/supabase/server.ts` (server vs admin client)
- `src/lib/auth/roles.ts` (`STAFF_ROLES`, `SCHOOL_ADMIN_ROLES`)
- `src/lib/auth/guards.ts` (`guardPlatformAdmin/SchoolAdmin/ClassAccess/StudentAccess`)
- `src/app/api/teacher/classes/route.ts` (canonical auth-chain example to port)
- `src/lib/spark/config.ts` (env idiom)
- `src/lib/spark/auth.ts` (constant-time bearer compare)
- `src/lib/spark/signLaunchJwt.ts` (hand-rolled crypto ethos)
- `src/lib/spark/notifyAssignmentCreated.ts` (fire-and-forget outbound discipline)
- `src/lib/spark/provisionSparkSchool.ts` + `src/lib/spark/sparkLink.ts` (per-school provisioning + 1:1 link)
- `src/lib/spark/contract.ts` (pure-mapper convention)
- `src/app/api/attempts/spark-attempt-complete/route.ts` (idempotency state machine, never-5xx, platform_events audit)
- `src/app/api/admin/spark-enable/route.ts` (admin one-click orchestration template)
- `src/lib/__tests__/config.test.ts` (asserts the 3 GOOGLE_* env keys + cron list)
- `.env.example` (GC OAuth placeholders — already includes `GOOGLE_REDIRECT_URI`)

---

## Unverified / disagreement markers (collected)

- **Refresh duplication count:** OAuth reader said 2 sites; API-surface reader said 5. **Authoritative = 5** (adapter + scope-check + courses + post-assignment + grades). Marked in §1.
- **Live Google API versions** (`classroom/v1`, `oauth2/v2/userinfo`, `tokeninfo`): version-pinned in V1, **not verified against the current live API** — sanity-check before build (§5).
- **`classes.google_classroom_id`** (V1, reconcile) appears redundant/dead vs `google_course_id`; "apparently unused in the code paths read" — **confirm dead before V2 omits** (it's not in V2 at all, so V2 is clean here).
- **`classes.google_feed_enabled`** exists in V2 (0002) with **no code reader**; semantics vs `google_grade_sync_enabled` undocumented in V2 — flagged as a gap.
- **`drive.readonly` consumption:** confirmed used by V1 `parse-google` (Drive export). Whether GC content import is in V2 scope = Open Decision #9.
- **`INTERNAL_API_SECRET` presence in V2:** unverified; only needed if the student-launch flow is pulled into scope (Open Decision #10).
