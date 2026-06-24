# Grounding — NEW CORE V2 Google Classroom Segment 2 (Roster Import) — Current-Code Facts

> Implementer bible for GC Seg 2 (roster import). Assembled from three research reports: **A** (V1 roster import, verbatim), **B** (V2 schema + patterns to build on, verbatim), **C** (binding decisions + Google Classroom REST API facts). All file:line refs and excerpts are preserved verbatim — do NOT paraphrase the code facts away. V1 repo = `C:/users/inteliflow/core`; V2 repo = `C:/users/inteliflow/NEW-CORE`.

---

## 0. Scope and binding decisions

These bind Segment 2 (roster import). Quoted from `docs/superpowers/specs/2026-06-23-google-classroom-design.md` and the GC epic grounding `docs/superpowers/plans/grounding/2026-06-23-google-classroom/2026-06-23-google-classroom-current-code.md`.

### Per-teacher OAuth model (D3)
> **D3 | OAuth grain | Per-teacher** — each teacher grants their own Google consent; CORE acts as the linked teacher for their classes. `schools.google_classroom_enabled` stays the school feature flag.

Default taken (spec §2):
> **School gate:** `schools.google_classroom_enabled` + presence of a teacher connection. **No `sso_configs`** (V2 lacks it; don't port it).

Whose grant runs the GC calls (epic grounding §1):
> GC API calls run **as the TEACHER linked to the course** … **Per-teacher, not per-school.**

Seg 1 already built the token-manager Seg 2 calls (spec §6):
> **Token-manager** (`src/lib/google/tokens.ts`): `getValidAccessTokenForTeacher(teacherId)` and `...ForCourse(courseId→teacher)` — decrypt, refresh-on-expiry (single implementation), re-encrypt + persist. Refresh does not null an existing refresh token.

### Single teacher-of-record per class (co-teacher deferred)
Spec §2 default: **Single teacher-of-record** per class for the pilot; co-teacher handling deferred. Spec §9 (out of scope): co-teacher multi-teacher-of-record deferred. V1 fetches GC teachers but uses only the importing user as `class.teacher_id`. **Recommendation: keep single-teacher-of-record for the pilot; co-teacher deferred.** V1 behavior to mirror: the roster route fetches BOTH students AND teachers in parallel, but **only students are used for import** (teachers returned in JSON but unused).

### Identity mapping via `external_identities`
Spec §2 default:
> **Identity:** adapt V2's existing `external_identities` `(school_id, provider, external_id, core_student_id)` — GC is its first real consumer — adding `email` + `last_seen_at` columns + a resolve helper. `provider='google'`, `external_id=` Google `userId`.

Spec §4 (the adapt + resolve helper, verbatim):
> **`external_identities`** (ADAPT existing 0008 table): add `email text` + `last_seen_at timestamptz`. Keep `(school_id, provider, external_id, core_student_id)` + `UNIQUE(school_id, provider, external_id)`. Add a **resolve helper** — a service-role TS function `resolveExternalIdentity({schoolId, provider, externalId, email})`: external_id-first, then **unambiguous** verified-email (exactly one match, else null), never auto-creates (auto-create is roster-import only). (TS service-role over a SECURITY DEFINER RPC — keeps logic in code, mirrors how V2 already gates the table to admin-client only.)

Where these columns/helper land (spec §7, Seg 2): the `resolveExternalIdentity` helper + the email/last_seen_at columns land here if not in Seg 1's migration. **(Seg 1 used migration 0022; this report names the new migration 0023/0024 — see §5 Open Decisions. The prompt names it "migration 0024"; the next free number on disk is the plan's call.)**

Match-key decision (spec §2 default):
> **Match key:** email at import (parity), but ALSO write the `external_identities` google-id row at import so launch resolves by id.

Critical shape note (epic grounding §2): V1's table keys on `(student_id, provider, external_user_id, email)` with `UNIQUE(provider, external_user_id)`; **V2's table is the different `(school_id, provider, external_id)` + `core_student_id` shape and is the one to adapt.** Do NOT copy V1's column names.

### Class upsert by `google_course_id`
Spec §3 (architecture): roster import ──► classes (by google_course_id) + students + enrollments + external_identities. Spec §7 (Seg 2): `import-roster` (class upsert by `google_course_id`; student match-by-email + create + enroll; `external_identities` google-id row; pin an "Open CORE" course-link material, fail-soft). V1 behavior to port (epic grounding §2): **GC course → CORE class** via **`classes.google_course_id` (text)** — THE anchor (1:1, `maybeSingle`): find-by-`google_course_id` → update `name/grade_level/subject`, else insert `{name, grade_level, subject, teacher_id, school_id, google_course_id, is_active:true}`.

### Student match-by-email / create / enroll
V1 behavior to port (epic grounding §2): **Per-student match = EMAIL** (not google_id): existing `users` row → reuse (linked++), backfill missing google_id; else create. **No-email student → silently SKIPPED** (`skipped++`). New student creation via `admin.auth.admin.createUser` (temp password, `email_confirm:true`) then `public.users` insert with `role:'student'`. **Auto-creation happens ONLY on this roster-import path.** Enrollment: `enrollments.upsert(..., {onConflict:'student_id,class_id'})` — idempotent across re-imports. **V2 note:** V1 backfilled `google_id` onto `users`; in V2 the canonical home for the Google userId is the `external_identities` row (`provider='google'`, `external_id=` Google userId). V2 has **no `google_id`/`sso_provider`/token columns on `users`**.

### "Pin an Open-CORE link" step is fail-soft
Spec §7 (Seg 2): pin an "Open CORE" course-link material, fail-soft. V1 (epic grounding §2): `ensureCourseLink(...)` pins an "Open CORE" link material into the GC course (idempotent via `lms_publications`), **fail-soft** so a missing `courseworkmaterials` scope doesn't fail the import. **V2 reconciliation:** V2 has **no `lms_publications` table yet** — it is created in Seg 3 (`google_publications`). So Seg 2's pin cannot lean on a publications table for idempotency; the plan must decide how Seg 2 records/idempotents the pin (gap-map lists "port (or fold into publish)"). The binding requirement is only that the pin is **fail-soft** (a missing `courseworkmaterials` scope must NOT fail the import).

### Wizard UI
Spec §7 (Seg 2): Import wizard UI (`select course → preview → import → done` with Created/Linked/Skipped tiles; surface the no-email skip count). No-email students: V1 silently skips them. **Recommendation: surface a "skipped (no email)" count on the done screen; a resolution queue is likely NOT needed for the pilot.** V1 response shape to port: `{created, linked, skipped, class_id, course_link}`.

### Route consolidation (one course-list, one roster route)
Spec §2 default: **One** paginated course-list route + **one** paginated roster route (V1 had duplicates). Spec §7: routes `courses` (list, paginated), `roster` (paginated, students), `import-roster`. V1's wizard roster route was **un-paginated** (pageSize=100 only); **V2 must use the paginated approach** (V1's adapter `importStudentProfiles` is the paginated one to unify on).

### Stated non-goals / deferrals touching Seg 2
- Co-teacher multi-teacher-of-record — deferred.
- A no-email-student resolution queue — deferred (just surface the count).
- The legacy V1 per-student routes + their drifted tables — do not port.
- Student silent-SSO launch (and `resolveExternalIdentity` *consumption*) is **Seg 4**, not Seg 2 — Seg 2 only **writes** the google-id identity rows so a later launch can resolve by id.
- `schools.state` auto-population is part of **Seg 1's** migration 0022, not Seg 2.

### Auth chain every Seg 2 route must obey (spec §3)
> Every protected route obeys V2's auth chain: `createServerSupabaseClient()` → `auth.getUser()` → `STAFF_ROLES` gate → object-level IDOR guard (`guardClassAccess`/`guardStudentAccess`) → `createAdminSupabaseClient()` (the only way to read the RLS-locked token + identity rows). **RLS is not the IDOR backstop.**

All Google HTTP lives behind the one adapter (spec §3): `src/lib/google/classroom.ts` is "the single seam that touches `classroom.googleapis.com` — mirrors V1's `google-classroom.ts`."

---

## 1. V1 roster import — verbatim

**Source:** `C:/users/inteliflow/core`. All excerpts VERBATIM. **Critical structural note:** V1 has TWO parallel GC roster code paths that do **not** call each other:

1. **The LIVE wizard path** (what the teacher actually uses): `app/(dashboard)/teacher/import/google/page.tsx` → `GET /api/teacher/google/courses` → `GET /api/teacher/google/roster?courseId=…` → `POST /api/teacher/google/import-roster`. These three routes fetch `classroom.googleapis.com` **inline** (NOT through the connector) for read operations.
2. **The connector path** (`lib/integrations/lms/google-classroom.ts` `importStudentProfiles`) is the "strategic seam" abstraction but is **NOT invoked by the import-roster route** for fetching the roster — the route reads `students` straight from the request body (the wizard already fetched them via `/roster`). The connector's GC reads are dead-ish for roster import; only its **`createCourseLink`** (write) is reached, via `ensureCourseLink`. Implementers must decide whether V2 unifies these.

### (1) Courses-list route — `app/api/teacher/google/courses/route.ts`

**Auth gate (L11-13):** `createServerSupabaseClient()` → `auth.getUser()` → 401 if no user. **No role/STAFF gate** — any authenticated user.

**Token read + inline refresh (L15-52):** reads `google_access_token, google_refresh_token, google_token_expiry` from `users` (admin client). If `!google_access_token` → `{ error: 'not_connected', message: 'Please sign in with Google first' }` (HTTP 200). If `google_token_expiry < now` AND a refresh token exists, it refreshes inline against `https://oauth2.googleapis.com/token` using `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` env (plaintext tokens stored — V2 encrypts), writing back `google_access_token` + new expiry. On refresh failure → `{ error: 'token_expired', message: 'Please reconnect Google Classroom' }` (HTTP 200).

**Exact Google API URL + params (L54-57):**
```ts
const res = await fetch(
  'https://classroom.googleapis.com/v1/courses?teacherId=me&courseStates=ACTIVE&pageSize=50',
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
```
`teacherId=me`, `courseStates=ACTIVE`, `pageSize=50`. **NO pagination** — `nextPageToken` is ignored; a teacher with >50 active courses silently loses the tail.

**Token-expiry surface (L59-61):** a `401` from the courses call → `{ error: 'token_expired', message: 'Please reconnect Google Classroom' }`. Other `!ok` → 500 `{ error: 'Failed to fetch courses' }`.

**Response shape to client (L66-75):**
```ts
const courses = (data.courses || []).map((c) => ({
  id: c.id,
  name: c.name,
  section: c.section || null,
  descriptionHeading: c.descriptionHeading || null,
  studentCount: null, // GC doesn't return count in list endpoint
}));
return NextResponse.json({ courses });
```

### (2) Roster-list route — `app/api/teacher/google/roster/route.ts`

**Auth gate (L11-13):** same `getUser()` → 401. **No role gate.** Requires `courseId` query param (L15-16) → 400 if missing.

**Token read (L18-25):** reads ONLY `google_access_token` (admin client). **No inline refresh here** (unlike `/courses`) — if `!google_access_token` → `{ error: 'not_connected' }` (HTTP 200, no message). A stale-but-present token is used as-is.

**Exact API URLs + params (L30-33) — students AND teachers fetched in parallel via `Promise.allSettled`:**
```ts
const [studentsRes, teachersRes] = await Promise.allSettled([
  fetch(`https://classroom.googleapis.com/v1/courses/${courseId}/students?pageSize=100`, { headers }),
  fetch(`https://classroom.googleapis.com/v1/courses/${courseId}/teachers?pageSize=30`, { headers }),
]);
```
**NO pagination — `nextPageToken` ignored on both.** Students cap at one `pageSize=100` page; teachers at `pageSize=30`. A class with >100 students silently truncates.

**Where it reads each student email/profile (L36-46):**
```ts
for (const s of (data.students || [])) {
  students.push({
    googleId: s.userId || '',
    name: s.profile?.name?.fullName || '',
    email: s.profile?.emailAddress || '',
    photoUrl: s.profile?.photoUrl || null,
  });
}
```
Teachers similarly read `t.userId`, `t.profile?.name?.fullName`, `t.profile?.emailAddress` (no photo).

**Pre-existence annotation (L60-65):** collects non-empty emails, queries `users.email IN (emails)`, builds a `Set`, marks each student.

**Response (L67-70):** `{ students: students.map(s => ({ ...s, existsInCore: existingEmails.has(s.email) })), teachers }`.

**Token-expiry surface:** there is **none** here — a 401/403 from GC just yields an empty `students`/`teachers` list (the `.ok` checks at L36/L49 silently drop the failed call). Any thrown error → 500 `{ error: 'Internal server error' }`. This is a notable gap: an expired token on the roster step does NOT surface "reconnect".

### (3) Import-roster route — `app/api/teacher/google/import-roster/route.ts` + connectors

**Auth gate (L19-21):** `getUser()` → 401. **No role/STAFF gate** anywhere.

**Input (L23-30):** reads `{ courseId, courseName, gradeLevel, subject, students: GoogleStudent[] }` from body — `students` is `{ googleId, name, email }[]` supplied by the client (already fetched by `/roster`). The route does **NOT** re-fetch GC. Validation: 400 if `!courseId || !courseName || !students?.length`.

**Teacher school resolution (L34-38):** `users.school_id` for `user.id` → `schoolId` (nullable).

#### Class upsert keyed on `google_course_id` (L41-65)
```ts
const { data: existingClass } = await admin.from('classes')
  .select('id').eq('google_course_id', courseId).maybeSingle();
if (existingClass) {
  classId = existingClass.id;
  await admin.from('classes').update({ name: courseName, grade_level: gradeLevel, subject }).eq('id', classId);
} else {
  const { data: newClass, error: classErr } = await admin.from('classes').insert({
    name: courseName, grade_level: gradeLevel, subject,
    teacher_id: user.id, school_id: schoolId,
    google_course_id: courseId, is_active: true,
  }).select('id').single();
  if (classErr) throw new Error('Failed to create class: ' + classErr.message);
  classId = newClass.id;
}
```
Match-or-create on `classes.google_course_id`; on re-import, name/grade/subject are overwritten (NOT teacher_id/school_id).

#### Per-student match / create / enroll loop (L67-147)
Counters `created, linked, skipped`. Per student (L69-128):
- **Skip if no email (L70):** `if (!student.email) { skipped++; continue; }`
- **Match by email (L73-76):** `admin.from('users').select('id, google_id').eq('email', student.email).maybeSingle()`.
- **If existing (L80-86):** reuse id; if `!existing.google_id && student.googleId` → `update({ google_id: student.googleId })`; `linked++`.
- **If new — creates a Supabase auth user (L87-121):**
```ts
const tempPassword = `CORE-${crypto.randomUUID().slice(0, 8)}`;
const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
  email: student.email, password: tempPassword, email_confirm: true,
  user_metadata: { full_name: student.name },
});
if (authErr) { console.error(...); skipped++; continue; }
const { error: profileErr } = await admin.from('users').insert({
  id: authUser.user.id, full_name: student.name, email: student.email,
  role: 'student', school_id: schoolId, google_id: student.googleId || null,
});
if (profileErr) { console.error(...); skipped++; continue; }
studentUserId = authUser.user.id; created++;
```
So: creates an `auth.users` row (email-confirmed, random temp password) **and** a `public.users` profile row with `role:'student'`, `google_id` denormalized onto the user. (V1 stores `google_id` directly on `users` — V2 should rely on `external_identities` instead.)

- **Enroll (L124-128):** `admin.from('enrollments').upsert({ student_id, class_id, is_active: true }, { onConflict: 'student_id,class_id' })` — idempotent on `(student_id, class_id)`.

#### External-identity / id-mapping rows (L130-146) — `applyImportedStudentProfile`
Each imported student also flows through the single connector-shaped identity path:
```ts
await applyImportedStudentProfile(admin, {
  studentId: studentUserId, schoolId, actorId: user.id,
  provider: 'google_classroom',
  profile: { externalUserId: student.googleId || null, email: student.email,
             fullName: student.name || null, schoolStudentId: null },
});
```
**`applyImportedStudentProfile`** (`lib/integrations/lms/rosterIdentity.ts` L159-234):
1. **`captureRosterIdentity` (L19-68):** one `external_identities` row per `(provider, student_id)`. Looks up by `(provider, student_id)`; if found, **hardens in place** — `last_seen_at = now()`, fills `external_user_id` only if currently null + googleId given, fills `email` (lowercased) only if currently null (never overwrites). If not found, inserts `{ school_id, student_id, provider, external_user_id: googleId||null, email(lowercased), last_seen_at }`. Insert error code `23505` (unique `(provider, external_user_id)` race) is swallowed; all errors are **non-blocking** (logged, never thrown).
2. **SIS anchor (L178-229):** GC sets `schoolStudentId: null`, so `decideAnchorAction` returns `'none'` and the anchor block is a no-op for GC. (Anchor logic exists for OneRoster/Clever; `capabilities.supportsSisId: false` for GC — see connector L147. Documented but inert for GC.)

#### "Open CORE" pinned course link (L149-158) — `ensureCourseLink`
After the student loop:
```ts
const courseLink = await ensureCourseLink({
  classId, courseExternalId: courseId, schoolId, publishedBy: user.id,
});
```
**`ensureCourseLink`** (`lib/integrations/lms/courseLink.ts` L37-92), returns `'created'|'exists'|'scope'|'failed'`, **never throws**:
- Idempotency check (L50-58): `lms_publications` row keyed `(provider='google_classroom', resource_type='course_link', resource_id=classId, course_external_id=courseId)` → if exists return `'exists'`.
- URL (L60): `${NEXT_PUBLIC_APP_URL || 'https://app.inteliflowai.com'}/launch/home?src=google_classroom`.
- Calls connector `createCourseLink({ courseExternalId, title: 'Open CORE', url })` (L61-65). `title: 'Open CORE'` is `[BARB-GATED]`.
- Inserts `lms_publications` (L67-78): `resource_type:'course_link'`, `resource_id: classId`, `external_assignment_id: externalMaterialId`, `launch_url`, `grade_passback_enabled: false`, `status:'published'`. Insert `23505` → `'exists'`.
- **Fail-soft scope handling (L87-91):** catches `LmsScopeError` → returns `'scope'` (so a teacher whose grant predates the `courseworkmaterials` write scope still completes the import; the import comment at route L149-152 confirms a missing scope must NOT fail roster import).

**Connector `createCourseLink`** (`google-classroom.ts` L178-204): `POST /courses/{courseId}/courseWorkMaterials` with body `{ title, state:'PUBLISHED', materials:[{ link:{ url } }] }`. Chosen over an announcement because a material is pinned/permanent. Returns `{ externalMaterialId: String(created.id) }`.

#### Exact order of operations
1. auth → 2. parse/validate body → 3. resolve teacher `school_id` → 4. class upsert by `google_course_id` → 5. **per student:** match-by-email → (link google_id | create auth user + profile) → enroll → `applyImportedStudentProfile` (external_identities + anchor no-op) → 6. `ensureCourseLink` (pinned "Open CORE") → 7. respond.

#### Idempotency
- Class: match-or-update on `google_course_id`. Student: match-by-email reuses existing. Enrollment: upsert `onConflict: 'student_id,class_id'`. external_identities: harden-in-place. course_link: existence check + `(provider, resource_type, resource_id, course_external_id)` unique. **Re-running is safe** (counts shift to `linked`).

#### Response (L160)
`{ created, linked, skipped, class_id: classId, course_link: courseLink }`.

### (4) Error handling / expired-token surfacing for reconnect
- **`/courses`:** the ONLY route with real reconnect surfacing — inline refresh, then `{ error: 'token_expired', message: 'Please reconnect Google Classroom' }` on 401/refresh-fail; `{ error: 'not_connected' }` when no token.
- **`/roster`:** NO token-expiry surface — failed GC calls silently yield empty lists; only `{ error: 'not_connected' }` when token absent. **Gap.**
- **`/import-roster`:** per-student auth/profile failures are caught → `skipped++` (loop continues); top-level catch → 500 `{ error: 'Import failed: ' + String(err) }` (**raw error leaked** — V2 should envelope). No GC token surfacing (it doesn't call GC for reads).
- **Connector `gcFetch` (L104-128):** the systematic scope→reconnect mechanism: a `403` whose body matches `/insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i` throws `LmsScopeError('google_classroom', …)`; other 403 → generic error. `getAccessTokenForCourse` (L55-102) does the connector-side refresh (resolves teacher grant via `classes.google_course_id`→`teacher_id`→user tokens) and throws on missing/failed refresh.

**Client wizard reconnect UX** (`teacher/import/google/page.tsx`): on load checks `sso_configs` for an enabled `google` provider (L48-55, gates the whole page) AND `users.google_access_token` (L57). On `/courses` returning `not_connected`/`token_expired` it flips `hasToken=false` → renders the "Connect" card with `<a href="/api/auth/google?mode=classroom&return=%2Fteacher%2Fimport%2Fgoogle">` (L150). Renders `<GoogleScopeBanner />` (one-time reconnect banner for pre-upgrade scopes) + `<OpenCoreLinkButton />` (backfill for already-linked courses). The 3-step wizard: select-course → preview (grade/subject + per-student checkboxes + existing/will-be-created pills) → importing → done (created/linked/skipped stats).

### V1 schema facts (migration 074, `supabase/migrations/074_lms_connector.sql`)
**`external_identities`** (L12-22): `id, school_id (FK schools, CASCADE), student_id (NOT NULL FK users CASCADE), provider, external_user_id (nullable), email, created_at, last_seen_at`, **`UNIQUE (provider, external_user_id)`**. Indexes: `(provider, lower(email))`, `(student_id)`. **RLS: deny-by-default, NO client policies** (L84-87) — reads only via the SECURITY DEFINER RPC + service role.

**`resolve_external_identity(p_provider, p_external_user_id, p_email)`** (L54-78): external_user_id match first, then **UNAMBIGUOUS** email match (`count(DISTINCT student_id)=1` else NULL). This is the launch-flow SSO entry; roster import is the sanctioned place rows are written.

**`lms_publications`** (L29-46): includes `resource_type CHECK IN ('quiz','homework','spark','course_link')`, `UNIQUE (provider, resource_type, resource_id, course_external_id)`.

### V1→V2 adaptation gaps flagged by Report A
- V1 stores Google tokens **plaintext on `users`** (`google_access_token/refresh/expiry`) and `google_id` on `users`. V2 Seg 1 already built the **encrypted `google_connections` vault** (`5b6f04e`, AES-256-GCM) + token-manager — V2 must read tokens from there, NOT `users`, and must NOT denormalize `google_id` onto `users` (use `external_identities`).
- V1's `external_identities` (migration 074) is essentially the table V2 plans to **adapt + add `last_seen_at` (V1 already has it) and a resolve helper** (V1 already has `resolve_external_identity`). V2's new migration should mirror this, including a resolve path and deny-by-default RLS. **Caveat: V1 and V2 use DIFFERENT column shapes** (see §2 — V2 keys on `(school_id, provider, external_id)` + `core_student_id`).
- **Pagination is absent** in V1 for both `/courses` (50 cap) and `/roster` (100 students / 30 teachers cap) — only the dead connector `importStudentProfiles` (L254-288) does proper `do…while (pageToken)` paging. V2 should page the live roster.
- V1 has **no STAFF role gate** on any of the three GC routes (only `getUser`) — V2's auth chain mandates a role gate.
- V1 `/import-roster` leaks the raw error string in the 500 body.
- The "Open CORE" pinned course-link material and the `lms_publications` `course_link` row are V1's idempotent front-door pin; per the V2 GC spec, decide if Seg 2 includes it or defers to a later segment.

**V1 files-of-record:** `app/api/teacher/google/courses/route.ts`, `.../roster/route.ts`, `.../import-roster/route.ts`; `lib/integrations/lms/{google-classroom.ts,courseLink.ts,rosterIdentity.ts,types.ts,registry.ts}`; `app/(dashboard)/teacher/import/google/page.tsx`; `supabase/migrations/074_lms_connector.sql` (+ `075_sis_anchor_roster_imports.sql` for the anchor/match-review tables). All under `C:/users/inteliflow/core`.

---

## 2. V2 current schema and patterns to build on

Repo: `C:/users/inteliflow/NEW-CORE`. All excerpts verbatim with file path + line numbers.

### (1) `external_identities` — full columns + constraints; CONFIRM no email/last_seen_at
**File:** `supabase/migrations/0008_platform.sql`, **lines 64–80**
```sql
-- ============================================================
-- 3. external_identities — LIFT/Spark student linking
-- ============================================================
-- Resolves create-vs-match for inbound handoffs: given (school_id, provider,
-- external_id) find the corresponding core_student_id.
CREATE TABLE IF NOT EXISTS public.external_identities (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  provider         text        NOT NULL,   -- e.g. 'lift', 'spark', 'google'
  external_id      text        NOT NULL,
  core_student_id  uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  created_at       timestamptz DEFAULT now(),
  UNIQUE (school_id, provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_external_identities_lookup
  ON public.external_identities (school_id, provider, external_id);
```
**Full column list (6 columns):** `id`, `school_id`, `provider`, `external_id`, `core_student_id`, `created_at`. **Constraints:** PK on `id`; `school_id` NOT NULL + FK→schools ON DELETE CASCADE; `provider` NOT NULL; `external_id` NOT NULL; `core_student_id` FK→users ON DELETE SET NULL; **`UNIQUE (school_id, provider, external_id)`**.

**CONFIRMED — there is NO `email` column and NO `last_seen_at` column yet.** The comment already lists `'google'` as an intended provider value, so the provider taxonomy is ready.

**RLS / grants (same file):**
- `lines 108, 122–124`: `ALTER TABLE public.external_identities ENABLE ROW LEVEL SECURITY;` then policy `external_identities_platform_all FOR ALL USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());` — **deny-by-default; platform-admin / service-role only** (the admin client is the only writer).
- `line 136`: `GRANT ALL ON public.external_identities TO authenticated, anon, service_role;`

**Existing usage in code:** Only `src/app/api/attempts/spark-attempt-complete/route.ts` references the name, and only in a comment to say it does NOT use it (line 3–4: `Identity: CORE-native (users.id + assignments.id) — no external_identities`). **There is no resolve helper, no `INSERT`, no `SELECT` against this table anywhere in `src/`** — Segment 2 will write the first real read/write path.

### (2) classes / enrollments / users — Google columns, seat key, trigger

#### `classes` — Google columns + others
**File:** `supabase/migrations/0002_classes_enrollments.sql`, **lines 11–25**
```sql
-- ── Classes ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.classes (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id                 uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  teacher_id                uuid        REFERENCES public.users(id) ON DELETE CASCADE,
  name                      text        NOT NULL,
  subject                   text,
  grade_level               text,
  period                    text,
  google_course_id          text,
  google_grade_sync_enabled boolean     DEFAULT false,
  google_feed_enabled       boolean     DEFAULT false,
  enrollment_count          int         DEFAULT 0,
  is_active                 boolean     DEFAULT true,
  created_at                timestamptz DEFAULT now()
);
```
Notes for Seg 2: `google_course_id text` already exists (the upsert key) but is **NOT** UNIQUE-constrained — there is no `UNIQUE (school_id, google_course_id)` index. Upsert-by-`google_course_id` will need either a new unique index or a pre-query find-then-insert pattern. `google_grade_sync_enabled` and `google_feed_enabled` both default `false` (Seg 3 grade passback / feed). `enrollment_count int DEFAULT 0` is a denormalized counter (NOT auto-maintained by any trigger seen here; `enrollments` rows are the SoT).

#### `enrollments` — seat key
**File:** `supabase/migrations/0002_classes_enrollments.sql`, **lines 27–35**
```sql
-- ── Enrollments ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.enrollments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id    uuid        NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id  uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  enrolled_at timestamptz DEFAULT now(),
  is_active   boolean     DEFAULT true,
  UNIQUE(class_id, student_id)
);
```
**Seat key = `UNIQUE(class_id, student_id)`** → idempotent enrollment via `.upsert(..., { onConflict: 'class_id,student_id' })` (exactly what the seed does — see below).

#### `enforce_enrollment_limit` trigger + `to_regclass` guard
**File:** `supabase/migrations/0002_classes_enrollments.sql`, **lines 37–96**
```sql
-- ── Seat-enforcement trigger (LIFT 049:169-222) ──────────────
-- Hard-stops enrollments past the school_licenses.student_limit.
-- Guarded by to_regclass so 0002 is inert until 0007 (school_licenses) exists.
CREATE OR REPLACE FUNCTION public.enforce_enrollment_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_school_id    uuid;
  v_current_count integer;
  v_limit        integer;
BEGIN
  -- to_regclass guard: school_licenses is created in 0007; until then, allow all.
  IF to_regclass('public.school_licenses') IS NULL THEN RETURN NEW; END IF;

  -- Resolve student's school
  SELECT school_id INTO v_school_id FROM public.users WHERE id = NEW.student_id;
  IF v_school_id IS NULL THEN
    RETURN NEW; -- no school = unprovisioned, let it through (e.g. demo seed)
  END IF;

  -- Resolve license limit (active licenses only — trial/pilot = no enforcement)
  SELECT student_limit INTO v_limit
    FROM public.school_licenses
   WHERE school_id = v_school_id
     AND status = 'active'
   LIMIT 1;
  IF v_limit IS NULL THEN
    RETURN NEW; -- no active license = trial / pilot, no enforcement
  END IF;

  -- Count distinct enrolled students at this school
  SELECT COUNT(DISTINCT u.id) INTO v_current_count
    FROM public.users u
    JOIN public.enrollments e ON e.student_id = u.id
   WHERE u.school_id = v_school_id
     AND u.role = 'student'
     AND u.is_active = true;

  -- Allow re-enrollments of existing students; only block new ones past limit
  IF v_current_count >= v_limit THEN
    -- Check if this student is already enrolled in any class at this school
    IF NOT EXISTS (
      SELECT 1 FROM public.enrollments e2
        JOIN public.users u2 ON u2.id = e2.student_id
       WHERE u2.school_id = v_school_id
         AND e2.student_id = NEW.student_id
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
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_enrollment_limit();
```
**Seg 2 implication:** The cap only fires for licenses with `status = 'active'`. Both trial and demo schools use `status = 'trialing'` (provisionTrial line 117; seedDemo line 142), so **roster import into a trial/pilot school is NOT seat-capped**. Real `'active'`-license schools WILL get a `check_violation` (ERRCODE) raised mid-import once over the limit — a bulk roster import must be prepared to surface/handle that exception per-student. The error is `Enrollment limit reached: school has % students, license allows %`.

#### `users` — relevant columns
**File:** `supabase/migrations/0001_identity_roles.sql`, **lines 40–60**
```sql
CREATE TABLE IF NOT EXISTS public.users (
  id              uuid        PRIMARY KEY REFERENCES auth.users(id),
  school_id       uuid        REFERENCES public.schools(id) ON DELETE CASCADE,
  role            text        NOT NULL CHECK (role IN ('teacher','student','parent','school_admin','school_sysadmin','platform_admin')),
  full_name       text        NOT NULL,
  email           text        NOT NULL,
  avatar_url      text,
  display_name    text,
  grade_levels    text,
  subjects        text,
  parent_id       uuid        REFERENCES public.users(id),
  grade_level     text,
  is_active       boolean     DEFAULT true,
  last_active_at  timestamptz,
  lift_candidate_id text,
  lift_data       jsonb,
  -- Trial columns (LIFT 035)
  is_trial_user   boolean     DEFAULT false,
  trial_school_id uuid        REFERENCES public.schools(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);
```
Key facts for roster import: `id` is **`REFERENCES auth.users(id)`** with **no DEFAULT** — every `public.users` row requires a pre-existing `auth.users` row (must go through `auth.admin.createUser` first; there is no DB trigger syncing auth→public). `email text NOT NULL` (email-match is keyed off this column). `role` CHECK includes `'student'`. No UNIQUE on `email` at the DB level (matching is done in code by lowercased compare). `school_id` FK→schools ON DELETE CASCADE.

`schools` table (`0001`, lines 13–37) has **`google_classroom_enabled boolean DEFAULT false`** (line 18) — per CLAUDE.md it is the per-school gate that is **NOT wired** in Seg 1.

### (3) Canonical student create + enroll pattern + account-takeover guard

#### The shared auth-user guard (the account-takeover backstop)
**File:** `src/lib/trial/ensureAuthUser.ts`

Security contract (header, lines 5–17):
```
 * SECURITY CONTRACT (the account-takeover guard — do not weaken):
 *  - Resolve the auth identity by AUTH ID, never trust email as a unique key
 *    (`auth.admin.getUserByEmail` does NOT exist — C13; paginate listUsers).
 *  - On an existing `public.users` row, update only NON-IDENTITY fields
 *    (`full_name`); NEVER overwrite `role` / `school_id`.
 *  - HARD-FAIL (throw) on a role/school_id mismatch — this prevents an attacker
 *    (or a cross-tenant re-provision) from rebinding an existing account.
 *
 * There is NO DB trigger syncing auth.users → public.users, so the caller must
 * INSERT the public.users row after every createUser (p4b-01-schema §Auth-sync).
```

`findAuthIdByEmail` (lines 22–37) — the email→auth-id resolver (getUserByEmail does NOT exist; paginate `listUsers`, 50 pages × 200, **case-insensitive `.toLowerCase()` compare**):
```ts
export async function findAuthIdByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<string | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u: { email?: string; id: string }) =>
      u.email?.toLowerCase() === email.toLowerCase()
    );
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}
```

`ensureAuthUser` signature + reconcile logic (lines 39–141). The exact flow:
- `createUser({ email, password, email_confirm: true, user_metadata: { full_name } })` first; if it errors with `/already|exist|registered/i`, fall back to `findAuthIdByEmail` (lines 61–76).
- Reconcile `public.users` **by `id` only** (lines 79–84).
- **Existing row:** strict match — `existing.school_id === school_id` (line 88, **null is NOT a match**) AND `existing.role === role` (line 89). On mismatch → audit `rebind_refused` via `logTrialEvent` then `throw new Error('Refusing to rebind existing user … (role/school mismatch) — not seed-owned')` (lines 91–109). On match → update **only `full_name`** (line 111).
- **New auth user, no existing public row:** INSERT `{ id, email, full_name, role, school_id }` (lines 113–117); on insert failure, best-effort `deleteUser(id)` rollback then rethrow (lines 118–128).
- **Orphan (auth user exists but no public row, NOT created by this call):** `throw … 'manual remediation required'` (lines 134–138) — **never silently rebinds a dangling identity**.

Returns the auth user id (`Promise<string>`).

Params (lines 39–46): `{ admin, email, password, full_name, role, school_id }` — note `password` is **required**. For Google roster import, a student created with no password set will need a generated one (cf. `src/lib/trial/generatePassword.ts`) or a different create path; Seg 2 must decide the student-credential story.

#### Class + enrollment upserts (as actually used — seedDemo)
**File:** `scripts/seedDemo.ts`

Student create loop (lines 199–217) — uses the shared guard with `role: 'student'`:
```ts
  for (const student of DEMO_STUDENTS) {
    try {
      const sid = await ensureAuthUser({
        admin,
        email: `${student.key}@demo.coreedtech.com`,
        password: DEMO_PASSWORD,
        full_name: student.full_name,
        role: 'student',
        school_id: schoolId,
      });
      studentIds[student.key] = sid;
```

Class find-or-insert (lines 234–262) — pre-query by `(name, teacher_id)`, else INSERT with `randomUUID()`:
```ts
    const { data: existingClass } = await admin
      .from('classes')
      .select('id')
      .eq('name', CLASS_NAME)
      .eq('teacher_id', teacherId)
      .maybeSingle();

    if (existingClass) {
      classId = existingClass.id;
    } else {
      classId = randomUUID();
      const { error } = await admin.from('classes').insert({
        id: classId,
        school_id: schoolId,
        teacher_id: teacherId,
        name: CLASS_NAME,
        subject: 'General',
        grade_level: '8',
        is_active: true,
      });
```

Enrollment upsert (lines 264–277) — **the canonical seat upsert keyed on the `(class_id, student_id)` UNIQUE**:
```ts
  if (classId) {
    for (const [key, sid] of Object.entries(studentIds)) {
      try {
        await admin.from('enrollments').upsert(
          { class_id: classId, student_id: sid, is_active: true },
          { onConflict: 'class_id,student_id' }
        );
```

#### provisionTrial — same guard, same order
**File:** `src/lib/trial/provisionTrial.ts`
- Teacher is HARD-FAIL-WITH-CLEANUP via `ensureAuthUser({ … role: 'teacher', school_id: schoolId })` (lines 133–145); cross-tenant rebind protection cited as **R2/C14** (lines 131–132).
- First student / parent are soft-fail via the same `ensureAuthUser` (lines 147–178).
- License is upserted with `status: 'trialing'` which **"bypasses the enrollment seat-cap trigger"** (line 117) — confirms the seat-cap trigger interaction.

### (4) Google token-manager + storeConnection
**File:** `src/lib/google/tokens.ts`

`GoogleNotConnectedError` (lines 56–58):
```ts
export class GoogleNotConnectedError extends Error {
  constructor() { super('google_not_connected'); this.name = 'GoogleNotConnectedError'; }
}
```

`getValidAccessTokenForTeacher` — **signature `(admin: SupabaseClient, teacherId: string): Promise<string>`** (returns a plaintext access token string, NOT the row). Throws `GoogleNotConnectedError` when no connection row OR no refresh token; lazy-refreshes with a 60s skew (lines 60–96):
```ts
const SKEW_MS = 60_000; // refresh a minute before expiry

export async function getValidAccessTokenForTeacher(admin: SupabaseClient, teacherId: string): Promise<string> {
  const { data: row } = await admin
    .from('google_connections')
    .select('access_token_enc, refresh_token_enc, token_expiry')
    .eq('user_id', teacherId)
    .maybeSingle();
  if (!row) throw new GoogleNotConnectedError();

  const notExpired = row.token_expiry && new Date(row.token_expiry).getTime() - Date.now() > SKEW_MS;
  if (notExpired && row.access_token_enc) return decryptToken(row.access_token_enc);

  if (!row.refresh_token_enc) throw new GoogleNotConnectedError();
  const refreshToken = decryptToken(row.refresh_token_enc);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!res.ok) throw new Error(`google token refresh failed: ${res.status}`);
  const fresh = (await res.json()) as GoogleTokenResponse;
  const { error: persistErr } = await admin.from('google_connections').update({
    access_token_enc: encryptToken(fresh.access_token),
    token_expiry: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
    last_refresh_at: new Date().toISOString(),
  }).eq('user_id', teacherId);
  if (persistErr) console.error('[gc] token persist after refresh failed (non-fatal):', persistErr.message);
  return fresh.access_token;
}
```
**Seg 2 calls this** to get the teacher's access token, then calls Google Classroom REST (`courses.list`, `courses.students.list`, etc.) with raw `fetch` + `Authorization: Bearer ${accessToken}` (the established zero-dep raw-fetch pattern). On `GoogleNotConnectedError`, the route returns connected:false / 401-ish (cf. scope-check route in §2 below).

`storeConnection` (lines 29–54) — upsert ON CONFLICT (user_id); **omits `refresh_token_enc` on re-consent** so a saved refresh token survives:
```ts
export interface StoreConnectionArgs {
  userId: string;
  schoolId: string | null;
  googleId: string;
  email: string;
  tokens: GoogleTokenResponse;
}

export async function storeConnection(admin: SupabaseClient, args: StoreConnectionArgs): Promise<void> {
  const { tokens } = args;
  const row: Record<string, unknown> = {
    user_id: args.userId,
    school_id: args.schoolId,
    google_id: args.googleId,
    email: args.email,
    access_token_enc: encryptToken(tokens.access_token),
    token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    granted_scopes: tokens.scope ? tokens.scope.split(' ') : [],
    last_refresh_at: new Date().toISOString(),
  };
  if (tokens.refresh_token) row.refresh_token_enc = encryptToken(tokens.refresh_token);
  const { error } = await admin.from('google_connections').upsert(row, { onConflict: 'user_id' });
  if (error) throw new Error(`storeConnection failed: ${error.message}`);
}
```

`GoogleTokenResponse` (lines 6–11): `{ access_token: string; refresh_token?: string; expires_in: number; scope?: string }`. `exchangeCodeForTokens(code)` also lives here (lines 13–27).

`google_connections` schema — **File:** `supabase/migrations/0022_google_connections.sql`, lines 7–18. PK `user_id` (FK→users ON DELETE CASCADE), `school_id`, `google_id`, `email`, `access_token_enc`, `refresh_token_enc`, `token_expiry`, `granted_scopes text[]`, `connected_at`, `last_refresh_at`. RLS deny-by-default, `google_connections_platform_all` policy; admin-client only.

**Config — File:** `src/lib/google/config.ts`. `GC_SCOPES` (lines 12–20) already requests `classroom.courses.readonly`, `classroom.rosters.readonly`, `classroom.profile.emails`, `classroom.coursework.students`, `classroom.courseworkmaterials`, `drive.readonly` — **all roster-import scopes are already granted at connect.** No code change to scopes needed for Seg 2. `GC_REQUIRED_SCOPES` (lines 24–30) is the reconnect-check set.

### (5) Teacher auth chain for an API route (the pattern to copy)
The pattern across both reference routes: `createServerSupabaseClient()` → `supabase.auth.getUser()` (401 on fail) → fetch `users.role` → role gate (403) → `createAdminSupabaseClient()` (synchronous, RLS-bypassing) for the actual work.

#### Inline pattern A — single-role `=== 'teacher'` (scope-check route)
**File:** `src/app/api/teacher/google/scope-check/route.ts`, **lines 8–19**
```ts
export async function GET(_req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  const role = profile?.role ?? null;
  if (role !== 'teacher') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createAdminSupabaseClient();
  let accessToken: string;
  try {
    accessToken = await getValidAccessTokenForTeacher(admin, user.id);
```
This is the **closest template for the Seg 2 GC routes** (it already pairs the auth chain with `getValidAccessTokenForTeacher` + `GoogleNotConnectedError`, lines 18–23). Note: Seg 1 GC routes deliberately gate on exact `role === 'teacher'` (not the broader STAFF_ROLES) — Google connection is per-teacher.

#### Inline pattern B — STAFF_ROLES set + per-role scoping (teacher classes route)
**File:** `src/app/api/teacher/classes/route.ts`, **lines 30–66**
```ts
export async function GET(_req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from('users').select('role, school_id').eq('id', user.id).single();
  const role = profile?.role ?? null;
  if (!role || !new Set(STAFF_ROLES).has(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const admin = createAdminSupabaseClient();
  let query = admin.from('classes').select('id, name, period, subject');
  if (role === 'teacher') {
    query = query.eq('teacher_id', user.id);
  } else if (role === 'school_admin' || role === 'school_sysadmin') {
    if (!profile?.school_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    query = query.eq('school_id', profile.school_id);
  }
  // platform_admin: no filter — sees all classes
```

#### Roles SoT — **File:** `src/lib/auth/roles.ts`
```ts
export const STAFF_ROLES = ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'] as const;
export const SCHOOL_ADMIN_ROLES = ['school_admin', 'school_sysadmin', 'platform_admin'] as const;
```

#### Object-level IDOR guards — **File:** `src/lib/auth/guards.ts`
The admin client BYPASSES RLS, so these are the only access control on cross-user admin reads (header lines 1–3). Relevant for Seg 2:
- `guardClassAccess(classId)` (lines 68–78): allows the owning teacher (`cls.teacher_id === caller.id`), a same-school admin, or platform admin; **returns 403 not 404 when the class is missing** (`don't leak existence`, line 74). Use this when importing-into / mutating an existing class by id.
- `guardStudentAccess(studentId)` (lines 86–106): teacher path checks enrollment in one of the caller's classes.
- `guardSchoolAdmin()` (lines 50–61): the discriminated-union return; `isPlatformAdmin → schoolId null` caveat (lines 38–48).

#### Client helpers — **File:** `src/lib/supabase/server.ts`
- `createServerSupabaseClient()` (lines 5–23): async (`await cookies()`), uses the **publishable** key, SSR cookie-bound (the session client).
- `createAdminSupabaseClient()` (lines 27–32): **synchronous**, reads `SUPABASE_SECRET_KEY`, **BYPASSES RLS — server-only, must pair with an object-level guard** (lines 25–26).

### What the planned migration (+ resolve helper) must add (per Report B)
1. **`external_identities.email text`** — to store the Google roster email per identity (currently absent; needed because Google rosters carry email and Seg 2 matches/creates students by it).
2. **`external_identities.last_seen_at timestamptz`** — to track re-sync recency (currently absent).
3. **A resolve helper** (e.g. `resolveExternalIdentity` / `linkOrCreateStudent`) in `src/lib/google/` — **none exists today** (the table has zero code readers/writers). It must implement: lookup by the existing `UNIQUE (school_id, provider='google', external_id=googleUserId)`; on hit → return `core_student_id`; on miss → match an existing `public.users` student by lowercased `email` within the school (mirroring `findAuthIdByEmail`'s case-insensitive compare) and create the `external_identities` link; on no email match → create the student via `ensureAuthUser({ role: 'student' })` (deciding the password/credential story) then insert the link — all by **AUTH ID, never trusting email as a unique key**, preserving the account-takeover contract.
4. **Likely also needed: a `UNIQUE (school_id, google_course_id)` index on `classes`** — `google_course_id` exists but is not unique, so a clean upsert-by-course needs it (or a documented pre-query find-then-insert as the seed does for classes).
5. **Optional gate:** `schools.google_classroom_enabled` (exists, default false, **currently NOT wired**) — decide whether Seg 2 honors it.

Migration discipline reminder (epic grounding §10): every new column gets a static-text assertion in `supabase/migrations/__tests__/migrations.test.ts`.

---

## 3. Google Classroom REST API facts

Base URL (pinned in V1, epic grounding §5): **`https://classroom.googleapis.com/v1`**. V2 uses **zero-dependency raw `fetch`** (no `googleapis`/`google-auth-library`) — confirmed: *"No `googleapis` / `google-auth-library` / `@googleapis` / `jsonwebtoken` dependency anywhere"*, and spec §2 default: *"Raw `fetch` over `classroom.googleapis.com/v1`, zero new deps."* All requests are Bearer-authed with the teacher's valid access token from the centralized token-manager.

All endpoints are version-pinned in V1 and flagged **unverified against the live Google API** (epic grounding §5 + spec §10): *"Sanity-check the live Google API versions/endpoints before Seg 1 build (`tokeninfo` deprecation, `userinfo` version)."* The facts below are V1's documented surface — the port target.

### Granted scopes Seg 2 needs
From the requested 7-scope set (spec §6 / Seg 1 `GC_SCOPES`), the three Seg 2 relies on:
- `https://www.googleapis.com/auth/classroom.courses.readonly` — for `courses.list`.
- `https://www.googleapis.com/auth/classroom.rosters.readonly` — for `courses.students.list` (and `courses.teachers.list`).
- `https://www.googleapis.com/auth/classroom.profile.emails` — **required to receive `profile.emailAddress`** on roster profiles. Without it, email comes back empty/absent and the email-match key fails (which would push every student to the no-email skip path).

These three are all in `GC_REQUIRED_SCOPES` (the reconnect-check list), so a Seg-2 `403 insufficient scope` should surface the reconnect CTA via the typed `GoogleScopeError` path from Seg 1.

### `courses.list` — `GET /courses`
- **Endpoint (V1):** `GET https://classroom.googleapis.com/v1/courses?teacherId=me&courseStates=ACTIVE&pageSize=50`, Bearer.
- **`teacherId=me` filter:** restricts to courses where the authenticated teacher is a teacher of the course — the per-teacher grain. `me` is the literal alias for the authenticated user.
- **`courseStates` filter:** V1 passes `courseStates=ACTIVE` to exclude `ARCHIVED`/`PROVISIONED`/`DECLARED`/`SUSPENDED` courses. (Repeatable enum; V1 uses only `ACTIVE`.)
- **Pagination:** the response carries `nextPageToken`; the caller passes it back as `?pageToken=<t>` to fetch the next page; loop until `nextPageToken` is absent. `pageSize` caps page length (V1 used `pageSize=50`). NOTE: V1's wizard course route had **no pagination loop**; **V2 must add the loop** (spec §2).
- **Course fields returned / read by V1:** `courses[].{ id, name, section, descriptionHeading }`. The duplicate (cached) V1 route additionally read **`enrollmentCode`**. Fields to capture per the Seg-2 prompt: **`id`, `name`, `section`, `enrollmentCode`** — `id` is the `google_course_id` anchor; `name`/`section` populate the class; `enrollmentCode` is available on the course resource for display. `studentCount` is **NOT** returned by the list endpoint (`studentCount: null` in V1).

### `courses.students.list` — `GET /courses/{courseId}/students`
- **Endpoint (V1):** `GET https://classroom.googleapis.com/v1/courses/{courseId}/students?pageSize=100`, Bearer.
- **Fields returned / read by V1:**
  - `students[].userId` — the Google user id → becomes `external_identities.external_id`.
  - `students[].profile.name.fullName` — the display name.
  - `students[].profile.emailAddress` — **only present when the `classroom.profile.emails` scope is granted.** This is the import match key; absent email → student is skipped.
  - `students[].profile.photoUrl` — read by V1's wizard route but **dropped at import** (not persisted).
- **Pagination:** uses `pageToken`/`nextPageToken` with `pageSize` (V1's adapter `importStudentProfiles` loops `nextPageToken` at `pageSize=100`). V1's wizard roster route was **un-paginated**; **V2 must use the paginated path** (spec §2).
- **Email normalization:** V1's paginated adapter **lowercases** `profile.emailAddress` before matching — V2 should do the same so the email-match key is case-insensitive.

### `courses.teachers.list` — `GET /courses/{courseId}/teachers` (fetched, unused)
V1 fetches `GET /courses/{courseId}/teachers?pageSize=30` in parallel with the student list (`Promise.allSettled`) and reads `teachers[].userId` + `profile.{name.fullName, emailAddress}`, but **only students are imported** (single teacher-of-record, co-teacher deferred). Included here only so the implementer knows V1 fetched it; it is not required for the Seg-2 import.

### `userProfiles.get` fallback for email
When `profile.emailAddress` is missing from a roster entry but the `classroom.profile.emails` scope is granted, Google's `GET /userProfiles/{userId}` can return the profile (including `emailAddress`) for a single user. Epic grounding §5 documents V1's actual email/profile fetch via the OAuth `userinfo` endpoint (`GET https://www.googleapis.com/oauth2/v2/userinfo` → `{id, email, name, verified_email}`) for the **connecting teacher's** own profile, not per-student. The `userProfiles.get` per-student fallback is the standard Classroom mechanism to recover an email when the embedded `students[].profile.emailAddress` is absent; the plan should treat it as the documented fallback path (and note that without `classroom.profile.emails` it still returns no email).

### Adapter / discipline reminders for Seg 2
- All of the above HTTP lives behind the one adapter module `src/lib/google/classroom.ts` (spec §3) — the single seam touching `classroom.googleapis.com`, mirroring V1's `lib/integrations/lms/google-classroom.ts`.
- Mid-call `403` matching `/insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i` maps to the typed scope error (V1's `LmsScopeError`; V2's `GoogleScopeError`) → reconnect CTA.
- Access tokens come from the Seg-1 token-manager (`getValidAccessTokenForTeacher` / `...ForCourse`), which decrypts, lazily refreshes on expiry, and re-persists — Seg 2 never touches token plaintext or the refresh flow directly.

**Files-of-record for Seg 2 (verbatim from epic grounding §10):** V1 — `lib/integrations/lms/google-classroom.ts` (adapter; paginated `importStudentProfiles` at `:254-285`), `app/api/teacher/google/courses/route.ts`, `app/api/teacher/google/roster/route.ts`, `app/api/teacher/google/import-roster/route.ts`, `app/(dashboard)/teacher/import/google/page.tsx` (wizard), `lib/integrations/lms/rosterIdentity.ts`, `lib/integrations/lms/courseLink.ts`, `supabase/migrations/074_lms_connector.sql`. V2 — `supabase/migrations/0008_platform.sql` (the `external_identities` shape to adapt), `0002_classes_enrollments.sql` (`classes.google_course_id`), `src/app/api/teacher/classes/route.ts` (canonical auth chain), `src/lib/auth/guards.ts`, `src/lib/google/*` from Seg 1 (`config`, `tokens`, `classroom`), `supabase/migrations/__tests__/migrations.test.ts` (every new column gets a static-text assertion). **Seg 1 used migration 0022; the next free migration number is the plan's call.**

---

## 4. The gap — what Segment 2 must build

Synthesizing across all three reports, Seg 2 is the first real read/write path against `external_identities` and the first Google-roster ingestion in V2. Concrete deliverables:

### 4.1 A paginated **courses** route — `GET /api/teacher/google/courses`
- Auth chain: `createServerSupabaseClient()` → `getUser()` → **`role === 'teacher'`** gate (per-teacher Google grain, matching the Seg 1 scope-check route) → `createAdminSupabaseClient()` → `getValidAccessTokenForTeacher(admin, user.id)`.
- Call `GET /v1/courses?teacherId=me&courseStates=ACTIVE&pageSize=…` via the `src/lib/google/classroom.ts` adapter, **looping `nextPageToken`** until exhausted (fix V1's 50-cap gap).
- Map each course to `{ id, name, section, enrollmentCode }` (+ optionally `descriptionHeading`); `studentCount` is not available from the list endpoint.
- On `GoogleNotConnectedError` → connected:false / reconnect signal; on `403 insufficient scope` → typed `GoogleScopeError` → reconnect CTA. **Do not** leak raw error strings (fix V1's gap).

### 4.2 A paginated **roster** route — `GET /api/teacher/google/roster?courseId=…`
- Same auth chain + `role === 'teacher'` gate; `courseId` required (400 if missing). Use `guardClassAccess` only if/when reading into an existing CORE class by id; for a not-yet-imported GC course there is no CORE class row yet, so the access boundary is "is this a course the teacher teaches" (the `teacherId=me` GC filter + their own token).
- Call `GET /v1/courses/{courseId}/students?pageSize=…` via the adapter, **looping `nextPageToken`** (fix V1's 100-cap gap). Read `userId`, `profile.name.fullName`, `profile.emailAddress` (lowercased), `profile.photoUrl`.
- Annotate `existsInCore` (pre-existence by lowercased email within the school) for the preview.
- Surface token-expiry/scope errors here too (V1's roster route silently swallowed them — fix that).

### 4.3 The **import wizard UI** (`select course → preview → import → done`)
- Steps mirror V1: select-course → preview (per-student checkboxes, existing/will-be-created pills, grade/subject inputs) → importing → done (Created / Linked / Skipped tiles, **including a "skipped — no email" count**).
- Lives under the teacher app (e.g. an entry in the teacher sidebar / Content-Studio-adjacent surface — exact placement is a plan decision).

### 4.4 The **import-roster** route — `POST /api/teacher/google/import-roster`
The transactional core. Auth chain + `role === 'teacher'` gate. Order of operations (port V1's, adapted to V2):
1. Resolve teacher `school_id`.
2. **Class upsert by `google_course_id`** — pre-query `classes` by `google_course_id` (`.maybeSingle()`), update `name/grade_level/subject` if found, else insert `{ name, grade_level, subject, teacher_id, school_id, google_course_id, is_active:true }`. (If a `UNIQUE (school_id, google_course_id)` index is added in the migration, an `.upsert(onConflict:'school_id,google_course_id')` is cleaner — plan decision.)
3. **Per student** (counters created/linked/skipped): resolve identity via the new **`resolveExternalIdentity` / link-or-create helper** — `external_id`(googleUserId)-first; then match an existing `public.users` student by lowercased `email` within the school; **on no match, create** via `ensureAuthUser({ role:'student', school_id, email, full_name, password: <generated> })` reusing the account-takeover guard; on no-email → skip (`skipped++`). Then **write/harden the `external_identities` google-id row** (`provider='google'`, `external_id=`googleUserId, `core_student_id`, `email`, `last_seen_at=now()`).
4. **Enroll** — `enrollments.upsert({ class_id, student_id, is_active:true }, { onConflict:'class_id,student_id' })`. Be ready to catch the `check_violation` seat-cap exception on `'active'`-license schools (trial/demo are uncapped).
5. **Pin the "Open CORE" course-link material — fail-soft** (a missing `courseworkmaterials` scope must NOT fail the import). Because V2 has **no publications table until Seg 3**, decide how Seg 2 idempotents the pin (or defer the pin to Seg 3 — plan decision; the binding requirement is only fail-soft).
6. Respond `{ created, linked, skipped, class_id, course_link }` — enveloped errors, no raw error leak.

### 4.5 Migration (the prompt calls it **0024**; next free number is the plan's call) + resolve helper
- Add **`external_identities.email text`** and **`external_identities.last_seen_at timestamptz`** (keep the existing `(school_id, provider, external_id)` shape + `UNIQUE(school_id, provider, external_id)` + `core_student_id`). Mirror V1's intent (email lowercased; last_seen_at hardened in place) but on V2's column shape — **do NOT copy V1's column names**.
- Likely add **`UNIQUE (school_id, google_course_id)` on `classes`** for a clean course upsert (or document the find-then-insert fallback).
- Add the **`resolveExternalIdentity({ schoolId, provider, externalId, email })`** TS service-role helper in `src/lib/google/`: external_id-first, then **unambiguous** verified-email (exactly one match, else null), **never auto-creates** (auto-create is roster-import-only — Seg 2 writes the rows so Seg 4's launch can resolve by id). Static-text migration assertions in `supabase/migrations/__tests__/migrations.test.ts` for every new column.

### 4.6 The fail-soft Open-CORE-link pin
Idempotent pin of an "Open CORE" link material (`POST /courses/{courseId}/courseWorkMaterials`, body `{ title:'Open CORE', state:'PUBLISHED', materials:[{ link:{ url } }] }`, `[BARB-GATED]` title). **Must never fail the import** if the `courseworkmaterials` write scope is missing or the call errors. Idempotency mechanism is a plan decision (no `lms_publications`/`google_publications` table exists until Seg 3 — either add a minimal record, defer to Seg 3, or rely on a fresh fetch-then-skip). The launch URL is the V2 equivalent of V1's `/launch/home?src=google_classroom`.

---

## 5. Open decisions for the plan

- **Migration number.** Prompt says "migration 0024"; Seg 1 used 0022, and the GC-epic grounding named the roster migration "0023/0024". Confirm the next free number on disk and pin it.
- **Existing-CORE-student-matched-by-email vs create-new.** When a Google roster email matches an existing `public.users` student in the school: reuse + link (V1 parity) — but confirm the strict-match contract from `ensureAuthUser` (role/school must match, null is NOT a match) is satisfied, and decide what happens if the matched user is the same email but a different role or a different school (V1 just reused by email; V2's guard would hard-fail a mismatch on the create path — the resolve helper must short-circuit before `ensureAuthUser` for the existing-student case).
- **Unmatched / duplicate emails.** Decide handling for: a roster email that matches MORE than one CORE student (V1's resolve helper returns NULL on ambiguity — so create-new? skip? flag?); two roster rows with the same email in one import; an email already used by a non-student role.
- **Students with no email.** V1 silently skips (`skipped++`). Confirm V2 surfaces a "skipped — no email" count on the done screen (recommended) and decide whether to attempt the `userProfiles.get` fallback to recover a missing email, or whether a resolution queue is needed (recommended: not for the pilot).
- **Student credential story.** `ensureAuthUser` requires a `password`. Decide: generated temp password (V1 used `CORE-${uuid.slice(0,8)}`) via `src/lib/trial/generatePassword.ts`, `email_confirm:true`, and how (if at all) the student first signs in — given Seg 4 is silent-SSO launch, a never-used password may be acceptable. Pin it.
- **Default class subject / grade on import.** What populates `classes.subject` and `classes.grade_level` — teacher-entered in the preview step (V1 took `gradeLevel`/`subject` from the wizard), a default, or derived from the GC course? Decide the defaults and whether re-import overwrites them.
- **Auto-enroll vs stage for teacher confirm.** V1 auto-enrolls every (checkbox-selected) roster student on import. Decide whether V2 auto-enrolls or stages for an explicit teacher confirm, and whether the per-student checkboxes from V1's preview are kept.
- **Class upsert mechanism.** Add `UNIQUE (school_id, google_course_id)` on `classes` (clean `.upsert`) vs documented pre-query find-then-insert. Decide, and define the upsert scope (per-school 1:1 with the GC course id).
- **Course/roster pagination page sizes.** Confirm `pageSize` values and that the `nextPageToken` loop is implemented for BOTH routes (fixing V1's 50/100 caps).
- **Seat-cap handling.** Trial/demo (`status='trialing'`) are uncapped; `'active'`-license schools raise `check_violation` mid-import once over `student_limit`. Decide per-student handling: skip-with-count, abort-whole-import, or surface a partial-import message.
- **`schools.google_classroom_enabled` gate.** Currently NOT wired. Decide whether Seg 2 honors it (gate the wizard/routes) or leaves it pilot-wide as Seg 1 did.
- **Open-CORE-link pin: include in Seg 2 or defer to Seg 3.** There is no publications table until Seg 3. Decide whether to pin now (and how to idempotent it without that table) or defer the pin to Seg 3. Binding requirement either way: **fail-soft**.
- **Co-teacher handling.** Confirm single-teacher-of-record for the pilot (fetch GC teachers if useful for display, but only the importing user is `class.teacher_id`); co-teacher deferred.
- **Unify the read path.** Confirm V2 uses ONE paginated course-list route + ONE paginated roster route (V1 had duplicates) and that the import-roster route re-validates / re-fetches as needed rather than trusting a client-supplied student list blindly (V1 trusted the body — decide whether V2 re-fetches the roster server-side at import for integrity).
- **Identity write timing.** Confirm `external_identities` google-id rows are written at IMPORT (so Seg 4 launch resolves by id), and that `resolveExternalIdentity` is write-free / never-auto-creates (consumption is Seg 4).
- **Error envelope.** Confirm a shared error envelope (no raw error-string leak like V1's import-roster 500) and the reconnect-CTA surfacing for `GoogleNotConnectedError` / `GoogleScopeError` across all three routes (V1's roster route swallowed token errors — must be fixed).
