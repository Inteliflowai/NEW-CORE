# Google Classroom — Segment 2: Roster Import + Two-Way Sync + Nightly Cron — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a connected teacher mirror a Google Classroom course roster into a CORE class — creating/linking students, enrolling them, and writing the Google identity rows — through ONE shared reconcile engine fired by THREE triggers (initial import, on-demand "Sync now", nightly Vercel Cron). The reconcile is **two-way**: students added in GC are added/reactivated in CORE; GC-sourced students dropped from the GC roster are **soft un-enrolled** (never deleted, never their history, never touching manually-added students or other classes). This is V2's first real read/write path against `external_identities` and the foundation Seg 4 (silent SSO launch) resolves identity against.

**Architecture:** Per-teacher OAuth (Seg 1). All `classroom.googleapis.com` HTTP lives behind ONE adapter (`src/lib/google/classroom.ts`, paginated `nextPageToken` loops, typed `GoogleScopeError`). Access tokens come ONLY from the Seg-1 encrypted vault via `getValidAccessTokenForTeacher` — never from `users` columns. A migration (0024) adds `external_identities.email`/`last_seen_at` + `enrollments.source` (per-class GC provenance) + `UNIQUE(school_id, google_course_id)` on `classes`. A write-free `resolveExternalIdentity` helper (Seg 4 consumes) and a `linkOrCreateStudent` helper (reuses `ensureAuthUser` + the account-takeover guard) sit under the reconcile engine `reconcileCourseRoster(admin, {teacherId, schoolId, googleCourseId, classId})` — a SINGLE-course signature so a FUTURE Pub/Sub push can call it per-course with no rework (push is DEFERRED — NOT built here). Three routes (`courses`, `roster`, `import-roster`) + a `sync` route + a cron route, all on V2's auth chain with an exact `role === 'teacher'` gate. Spec: `docs/superpowers/specs/2026-06-23-google-classroom-design.md`; grounding: `docs/superpowers/plans/grounding/2026-06-24-gc-seg2-roster/2026-06-24-gc-seg2-roster-current-code.md`.

**Tech Stack:** Next.js 16 App Router (async `cookies()`), TypeScript, raw `fetch` (no `googleapis`/`google-auth-library`), `node:crypto` (`randomUUID`), Supabase (server + admin clients), Vitest 4 (+ jsdom for the UI task), Tailwind v4 token-only, Vercel Cron (`vercel.json` `crons` array).

## Global Constraints

- **Zero new npm dependencies.** Google HTTP is raw `fetch`; all of it lives behind `src/lib/google/classroom.ts` (the single seam touching `classroom.googleapis.com/v1`).
- **Tokens come ONLY from the Seg-1 vault.** Use `getValidAccessTokenForTeacher(admin, teacherId)` (decrypts, lazy-refreshes, re-persists). NEVER read `users.google_*` columns (V2 has none). Plaintext tokens are NEVER logged or returned to the client.
- **Auth chain on every protected route:** `await createServerSupabaseClient()` → `auth.getUser()` (401) → fetch `users.role, school_id` → **`role === 'teacher'` (403 otherwise — teacher-only, NOT the broader `STAFF_ROLES`; per-teacher Google grain, matching the Seg-1 scope-check route)** → `createAdminSupabaseClient()` (synchronous; bypasses RLS) for the RLS-locked `google_connections`/`external_identities` reads/writes. RLS is NOT the IDOR backstop. When MUTATING an existing CORE class **by id**, add the object-level `guardClassAccess(classId)` guard (returns 403 not 404 on missing — don't leak existence).
- **`import-roster` RE-FETCHES the GC roster server-side.** NEVER trust a client-supplied student list (V1's bug). The client sends only `{ courseId, name, subject, gradeLevel }`; the route re-pulls the roster via the adapter.
- **Node runtime default:** do NOT add `export const runtime` (these routes use `node:crypto` `randomUUID` and Supabase; matches the existing cron/spark routes).
- **Two-way sync safety rules (binding — the heart of the segment, decision #2):**
  - Reconcile scope is STRICTLY one class (the `classId` for one `googleCourseId`). Never touch enrollments in any OTHER class.
  - GC students → match by `external_id`(googleUserId) first, then unambiguous lowercased email within the school, else create. Enroll `is_active=true` with `source='google'`, **reactivating** a previously soft-removed seat.
  - The REMOVE side is scoped by the **per-class provenance column `enrollments.source`** (migration 0024, decision item A): the removal-candidate set = THIS class's ACTIVE enrollments WHERE `source='google'` (i.e. only Google-sourced seats in THIS class), minus those present in the current GC roster. A Google-sourced student who is no longer in the current GC roster → **soft un-enroll** (`enrollments.is_active=false`). NEVER delete the `users` row, the `external_identities` row, or any history. Filtering by `source='google'` on THIS `class_id` makes the remove side **per-class-correct**: a manually-added seat (or any `source<>'google'` seat) is NEVER touched, and a student who is Google-sourced via ANOTHER class is scoped out because we filter by THIS `class_id`. (This supersedes the earlier school-wide `external_identities` heuristic, which could wrongly soft-remove a cross-class-GC-sourced student — see decision item A.)
  - Students with NO google identity / a non-`google` enrollment source (manually-added) are NEVER touched — neither enrolled nor un-enrolled by the reconcile.
  - **Trustworthy-roster guard (binding — the catastrophic case the spec forbids):** an empty/partial GC roster must NOT trigger a mass soft-un-enroll. `listCourseStudents` returns a discriminated `{ students, complete }`; if `presentGoogleIds` is empty OR `complete===false` while the class has ≥1 Google-sourced active enrollment → SKIP the entire remove side, `softRemoved=0`, set `removeSkippedSuspectEmpty:true`. "Absent from the CURRENT roster" must mean a *trustworthy* current roster.
  - Idempotent: re-running over an unchanged roster is a no-op (counts shift to `linked`).
- **supabase-js returns `{ error }`, it does NOT throw on a DB error (binding):** every `.upsert()`/`.update()` in the engine MUST branch on the RETURNED `error` (not a `try/catch`). The seat-cap `enforce_enrollment_limit` trigger surfaces as a returned `{ error: { code: '23514' } }` (a `check_violation`), NOT a JS throw. Increment success counters ONLY on a no-error result; on an error, increment `errors` (a `ReconcileResult` field) + log, never abort.
- **Account-takeover guard honored (decision #7):** student create goes through `ensureAuthUser({ role:'student', ... })` which HARD-FAILS (throws) on a role/school mismatch. The reconcile CATCHES that throw per-student → `skipped++` + flag (never aborts the whole import, never rebinds). Match by LOWERCASED email. No-email → skip + count. Ambiguous email (>1 CORE student) OR a duplicate email within one import OR an email already used by a non-student role → skip + flag.
- **Class upsert by `google_course_id`** (decision #8), now `UNIQUE(school_id, google_course_id)`. `teacher_id` = the connecting teacher (single teacher-of-record; co-teacher deferred). `subject`/`grade_level` are teacher-confirmed in the preview (prefill from GC `name`/`section`); **re-import/auto-sync must NOT overwrite a teacher-edited subject/grade** — only INSERT sets them; UPDATE on re-sync leaves them alone.
- **NOT in Seg 2 (YAGNI — do NOT build):** Pub/Sub push webhook / registrations (engine signature is push-ready, that's all); the Open-CORE link pin (DEFERRED to Seg 3); the `schools.google_classroom_enabled` school gate (PILOT-WIDE, matches Seg 1); co-teacher multi-teacher-of-record; a no-email resolution queue; `resolveExternalIdentity` *consumption* (Seg 4 — Seg 2 only WRITES the rows + ships the write-free helper).
- **Shared error envelope** (no raw error-string leak like V1's import-roster 500). On `GoogleNotConnectedError` / `GoogleScopeError`, routes return a typed reconnect signal so the UI shows the reconnect CTA.
- **Read routes are PAGINATED** (`nextPageToken` loops; fix V1's 50/100 caps).
- **CRON_SECRET guard** on the nightly route, **timing-safe + dual-accept** (decision item B): accept BOTH `Authorization: Bearer <CRON_SECRET>` (Vercel Cron's default mechanism) AND the repo's existing `x-cron-secret` header, compared with `node:crypto` `timingSafeEqual` (length-checked), else 401. This is robust regardless of which header the platform actually sends. PER-TEACHER failure isolation: one revoked/bad token must not abort the run (catch, log, flag-for-reconnect, continue). Schedule lives in `vercel.json`'s `crons` array.
- **Migrations are static-text-asserted** in `supabase/migrations/__tests__/migrations.test.ts` — every new column/index gets an assertion (`external_identities.email`, `external_identities.last_seen_at`, `enrollments.source`, the `uq_classes_school_google_course` index, the email lookup index). Next free migration number on disk is **`0024`** (0023 = behavioral_signals_rls).
- **Token-only styling**, deep-ink (`text-fg` not `text-fg-muted` for content), WCAG-AA; strings are DRAFT → `STRINGS-FOR-BARB.md`.
- **Gates (before each commit / at task end):** `npx tsc --noEmit` (0), `npx vitest run <touched files>` (green); at segment end `npm run build` (0, incl. a11y + tokens). React component tests start with `// @vitest-environment jsdom` then `import '@/test/setup-dom';`.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0024_gc_roster.sql` | `external_identities.email`/`last_seen_at` columns + `enrollments.source` column + `UNIQUE(school_id, google_course_id)` on `classes` (additive + idempotent) |
| `src/lib/google/classroom.ts` | the single GC HTTP seam: `listCourses`, `listCourseStudents` (paginated `nextPageToken` loops) + `GoogleScopeError` |
| `src/lib/google/resolveExternalIdentity.ts` | write-free service-role identity resolver (external_id-first → unambiguous email → null); Seg 4 consumes |
| `src/lib/google/linkOrCreateStudent.ts` | per-student match-or-create (reuses `ensureAuthUser`) + writes/hardens the `external_identities` google-id row; typed skip outcomes |
| `src/lib/google/reconcileCourseRoster.ts` | the shared two-way reconcile engine (single course → class); add/link/enroll/reactivate + soft un-enroll absent GC-sourced students |
| `src/app/api/teacher/google/courses/route.ts` | GET — paginated GC course list for the wizard |
| `src/app/api/teacher/google/roster/route.ts` | GET — paginated GC roster (per course) + `existsInCore` annotation for the review-only preview |
| `src/app/api/teacher/google/import-roster/route.ts` | POST — class upsert + server-side re-fetch + call the engine |
| `src/app/api/teacher/google/sync/route.ts` | POST — "Sync now" for one already-imported class (re-fetch + engine) |
| `src/app/api/cron/gc-roster-sync/route.ts` | nightly cron: CRON_SECRET guard, iterate all connections → their GC-mirrored classes, per-teacher isolation |
| `vercel.json` | add the nightly cron schedule entry |
| `src/app/(teacher)/import/google/page.tsx` + `_components/ImportWizard.tsx` (+ `SyncNowButton.tsx`) | import wizard UI (select → review-only preview → import → done) + a Sync-now control |
| `src/lib/google/__tests__/*`, route `__tests__/*` | tests beside each module (repo convention) |
| `STRINGS-FOR-BARB.md` | append `## Google Classroom — Seg 2 (roster import)` drafts |

Test files live beside each module under `__tests__/` (repo convention).

---

### Task 1: Migration 0024 — `external_identities` columns + `classes` course-uniqueness

**Files:**
- Create: `supabase/migrations/0024_gc_roster.sql`
- Modify: `supabase/migrations/__tests__/migrations.test.ts` (append a `describe('0024 gc_roster', …)` block)

**Interfaces:**
- Produces: `external_identities.email text` + `external_identities.last_seen_at timestamptz` (additive; keeps the existing `(school_id, provider, external_id)` shape + `UNIQUE(school_id, provider, external_id)` + `core_student_id`). `enrollments.source text` (per-class GC provenance — decision item A; set `'google'` on Google-imported seats so the remove side is per-class-correct). A unique index `uq_classes_school_google_course` on `classes (school_id, google_course_id)` (guarded so it is idempotent). A plain lookup index on `external_identities (school_id, provider, email)` (the equality-match key — written lowercased, queried with `.eq()`, so a `lower(email)` functional index would not match the query — MIN-3).

- [ ] **Step 1: Write the failing test** — append to `supabase/migrations/__tests__/migrations.test.ts`

```typescript
describe('0024 gc_roster', () => {
  const s = () => sql('0024_gc_roster.sql');
  it('adds email + last_seen_at to external_identities (idempotent ADD COLUMN IF NOT EXISTS)', () => {
    expect(s()).toMatch(/ALTER TABLE public\.external_identities\s+ADD COLUMN IF NOT EXISTS email\s+text/);
    expect(s()).toMatch(/ALTER TABLE public\.external_identities\s+ADD COLUMN IF NOT EXISTS last_seen_at\s+timestamptz/);
  });
  it('adds enrollments.source for per-class GC provenance (idempotent ADD COLUMN IF NOT EXISTS)', () => {
    expect(s()).toMatch(/ALTER TABLE public\.enrollments\s+ADD COLUMN IF NOT EXISTS source\s+text/);
  });
  it('does NOT recreate or rename the existing (school_id, provider, external_id) shape', () => {
    expect(s()).not.toMatch(/CREATE TABLE[^;]*external_identities/);
    expect(s()).not.toMatch(/external_user_id/);   // never copy V1 column names
    // NOTE: the 0008 block (lines ~530) holds the positive "UNIQUE(school_id, provider,
    // external_id) preserved" assertion; 0024 only asserts it does not recreate/rename the
    // table (MIN-8 cross-reference — do not duplicate the positive assertion here).
  });
  it('adds a UNIQUE index on classes(school_id, google_course_id) for a clean course upsert', () => {
    expect(s()).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_classes_school_google_course\s+ON public\.classes\s*\(\s*school_id\s*,\s*google_course_id\s*\)/);
    // guarded so it cannot fail if pre-existing dup data exists (WHERE google_course_id IS NOT NULL)
    expect(s()).toMatch(/WHERE google_course_id IS NOT NULL/);
  });
  it('adds a plain (school_id, provider, email) email lookup index on external_identities', () => {
    expect(s()).toMatch(/CREATE INDEX IF NOT EXISTS idx_external_identities_email\s+ON public\.external_identities\s*\(\s*school_id\s*,\s*provider\s*,\s*email\s*\)/);
  });
});
```

> NOTE (MIN-8): do NOT remove or duplicate the `external_identities` shape-preserved positive assertion that already lives in the `0008` `describe` block (it asserts `UNIQUE (school_id, provider, external_id)`). The 0024 block above only adds the negative "does-not-recreate/rename" assertions plus the new-column/new-index positives.

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run supabase/migrations/__tests__/migrations.test.ts` → FAIL (file not found / regex no match).

- [ ] **Step 3: Implement** — `supabase/migrations/0024_gc_roster.sql`

```sql
-- 0024_gc_roster.sql
-- Google Classroom epic, Segment 2: roster import.
-- ADDITIVE + IDEMPOTENT. Adapts the existing external_identities (0008) — adds email +
-- last_seen_at WITHOUT touching its (school_id, provider, external_id) + core_student_id shape
-- or its UNIQUE(school_id, provider, external_id) / deny-by-default RLS. Do NOT copy V1's column
-- names (external_user_id/student_id). Adds enrollments.source so the two-way reconcile can scope
-- soft-removal to Google-sourced seats IN THIS CLASS (per-class provenance, decision item A). Also
-- makes classes.google_course_id uniquely upsertable per school so roster import can
-- match-or-create a class by GC course id 1:1.

-- 1. external_identities: email (lowercased at write) + last_seen_at (hardened on each sync).
ALTER TABLE public.external_identities ADD COLUMN IF NOT EXISTS email        text;
ALTER TABLE public.external_identities ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- Email lookup within a school+provider (the match key for roster import). PLAIN column index:
-- emails are written lowercased and queried with .eq('email', lower(value)), so a lower(email)
-- functional index would NOT be used by the equality query (MIN-3).
CREATE INDEX IF NOT EXISTS idx_external_identities_email
  ON public.external_identities (school_id, provider, email);

-- 2. enrollments.source: per-class GC provenance. 'google' = this seat was created by a GC roster
-- import; the reconcile REMOVE side ONLY considers source='google' seats in THIS class, so a
-- manually-added seat (NULL/other source) is never touched and a student GC-sourced via another
-- class is scoped out by class_id (decision item A). Nullable + additive — existing seats stay NULL.
ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS source text;

-- 3. classes: a clean per-school upsert key on the GC course id. Partial unique index so it is
-- safe to apply even if some rows have NULL google_course_id (manually-created classes).
CREATE UNIQUE INDEX IF NOT EXISTS uq_classes_school_google_course
  ON public.classes (school_id, google_course_id)
  WHERE google_course_id IS NOT NULL;
```

- [ ] **Step 4: Run tests** — `npx vitest run supabase/migrations/__tests__/migrations.test.ts` → PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit** — `git add supabase/migrations/0024_gc_roster.sql supabase/migrations/__tests__/migrations.test.ts && git commit -m "feat(gc): migration 0024 external_identities email/last_seen_at + classes course-uniqueness"`

> **NOTE (controller):** do NOT apply 0024 to the live DB during the build. Migration application is a separate, explicitly-authorized step at segment merge.
>
> **APPLY-GATE PRE-CHECK (IMP-12 — required before authorizing the apply):** the new partial `uq_classes_school_google_course` UNIQUE index will FAIL to create (aborting the migration mid-apply) if any pre-existing rows already share a non-null `(school_id, google_course_id)`. `IF NOT EXISTS` does NOT save it — the uniqueness check still runs. Before applying, run this against the live DB and confirm it returns ZERO rows:
> ```sql
> SELECT school_id, google_course_id, count(*)
>   FROM public.classes
>  WHERE google_course_id IS NOT NULL
>  GROUP BY 1, 2
> HAVING count(*) > 1;
> ```
> If it returns rows, BLOCK the apply pending a de-dup of the duplicate GC-mirrored classes.

---

### Task 2: GC adapter — paginated `listCourses` + `listCourseStudents` + `GoogleScopeError`

**Files:**
- Create: `src/lib/google/classroom.ts`
- Create: `src/lib/google/__tests__/classroom.test.ts`

**Interfaces:**
- Produces:
  - `class GoogleScopeError extends Error` (`name='GoogleScopeError'`).
  - `interface GcCourse { id: string; name: string; section: string | null; enrollmentCode: string | null }`
  - `interface GcStudent { googleId: string; name: string; email: string; photoUrl: string | null }` (`email` is **lowercased**; `googleId` is always non-empty — see the blank-userId skip below).
  - `interface GcRoster { students: GcStudent[]; complete: boolean }` — the discriminated roster result (CRIT-2). `complete=false` signals an UNTRUSTWORTHY roster: a page AFTER the first resolved with no `students` key AND no `nextPageToken` (a partial/transient result). The engine MUST refuse to soft-remove on `complete===false`.
  - `listCourses(accessToken: string): Promise<GcCourse[]>` — loops `nextPageToken` on `GET /v1/courses?teacherId=me&courseStates=ACTIVE&pageSize=100`.
  - `listCourseStudents(accessToken: string, courseId: string): Promise<GcRoster>` — loops `nextPageToken` on `GET /v1/courses/{courseId}/students?pageSize=100`; returns `{ students, complete }`. **Skips any record with a blank/missing `userId`** (suspended/transitional GC accounts) — never emits a `GcStudent` with an empty `googleId` (IMP-11), so a blank id can never shrink the present-set nor write a blank `external_id`.
  - A 403 whose body matches `/insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i` → throw `GoogleScopeError`; any other non-2xx → throw a generic `Error` (status only, no body leak).

- [ ] **Step 1: Write the failing test** — `src/lib/google/__tests__/classroom.test.ts`

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; vi.restoreAllMocks(); });

function jsonRes(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('classroom adapter — listCourses', () => {
  it('loops nextPageToken and maps id/name/section/enrollmentCode', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonRes({ courses: [{ id: 'c1', name: 'Math', section: 'A', enrollmentCode: 'abc' }], nextPageToken: 'p2' }))
      .mockResolvedValueOnce(jsonRes({ courses: [{ id: 'c2', name: 'Sci' }] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { listCourses } = await import('@/lib/google/classroom');
    const out = await listCourses('AT');
    expect(out).toEqual([
      { id: 'c1', name: 'Math', section: 'A', enrollmentCode: 'abc' },
      { id: 'c2', name: 'Sci', section: null, enrollmentCode: null },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('teacherId=me');
    expect(String(fetchMock.mock.calls[0][0])).toContain('courseStates=ACTIVE');
    expect(String(fetchMock.mock.calls[1][0])).toContain('pageToken=p2');
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer AT' });
  });
  it('throws GoogleScopeError on a 403 insufficient-scope body', async () => {
    globalThis.fetch = vi.fn(async () => new Response('ACCESS_TOKEN_SCOPE_INSUFFICIENT', { status: 403 })) as unknown as typeof fetch;
    const { listCourses, GoogleScopeError } = await import('@/lib/google/classroom');
    await expect(listCourses('AT')).rejects.toBeInstanceOf(GoogleScopeError);
  });
  it('throws a generic error (no body leak) on other non-2xx', async () => {
    globalThis.fetch = vi.fn(async () => new Response('secret internal detail', { status: 500 })) as unknown as typeof fetch;
    const { listCourses } = await import('@/lib/google/classroom');
    await expect(listCourses('AT')).rejects.toThrow(/google courses list failed: 500/);
    await expect(listCourses('AT')).rejects.not.toThrow(/secret internal detail/);
  });
});

describe('classroom adapter — listCourseStudents', () => {
  it('loops nextPageToken, maps + lowercases email, and reports complete:true', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonRes({ students: [{ userId: 'g1', profile: { name: { fullName: 'Ann' }, emailAddress: 'ANN@b.EDU', photoUrl: 'u' } }], nextPageToken: 'p2' }))
      .mockResolvedValueOnce(jsonRes({ students: [{ userId: 'g2', profile: { name: { fullName: 'Bo' } } }] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { listCourseStudents } = await import('@/lib/google/classroom');
    const out = await listCourseStudents('AT', 'c1');
    expect(out).toEqual({
      complete: true,
      students: [
        { googleId: 'g1', name: 'Ann', email: 'ann@b.edu', photoUrl: 'u' },
        { googleId: 'g2', name: 'Bo', email: '', photoUrl: null },
      ],
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/courses/c1/students');
    expect(String(fetchMock.mock.calls[1][0])).toContain('pageToken=p2');
  });
  it('skips a roster record with a blank/missing userId (IMP-11)', async () => {
    globalThis.fetch = vi.fn(async () => jsonRes({ students: [
      { userId: 'g1', profile: { name: { fullName: 'Ann' }, emailAddress: 'a@b.edu' } },
      { userId: '', profile: { name: { fullName: 'Ghost' }, emailAddress: 'ghost@b.edu' } },
      { profile: { name: { fullName: 'NoId' }, emailAddress: 'noid@b.edu' } },
    ] })) as unknown as typeof fetch;
    const { listCourseStudents } = await import('@/lib/google/classroom');
    const out = await listCourseStudents('AT', 'c1');
    expect(out.students).toEqual([{ googleId: 'g1', name: 'Ann', email: 'a@b.edu', photoUrl: null }]);
    expect(out.complete).toBe(true);
  });
  it('reports complete:false when a non-first page is empty (no students key, no nextPageToken)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonRes({ students: [{ userId: 'g1', profile: { name: { fullName: 'Ann' }, emailAddress: 'a@b.edu' } }], nextPageToken: 'p2' }))
      .mockResolvedValueOnce(jsonRes({}));   // partial/transient: empty page terminates the loop
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { listCourseStudents } = await import('@/lib/google/classroom');
    const out = await listCourseStudents('AT', 'c1');
    expect(out.students).toHaveLength(1);
    expect(out.complete).toBe(false);   // the engine must NOT soft-remove on this
  });
  it('a single empty first page is complete:true (a genuinely empty class is trustworthy)', async () => {
    globalThis.fetch = vi.fn(async () => jsonRes({})) as unknown as typeof fetch;
    const { listCourseStudents } = await import('@/lib/google/classroom');
    const out = await listCourseStudents('AT', 'c1');
    expect(out).toEqual({ students: [], complete: true });
  });
  it('throws GoogleScopeError on a 403 insufficient-scope body', async () => {
    globalThis.fetch = vi.fn(async () => new Response('insufficient authentication scopes', { status: 403 })) as unknown as typeof fetch;
    const { listCourseStudents, GoogleScopeError } = await import('@/lib/google/classroom');
    await expect(listCourseStudents('AT', 'c1')).rejects.toBeInstanceOf(GoogleScopeError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/lib/google/__tests__/classroom.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `src/lib/google/classroom.ts`

```typescript
// src/lib/google/classroom.ts
// The single seam that touches classroom.googleapis.com (mirrors V1's google-classroom.ts).
// Zero-dep raw fetch, Bearer-authed with the teacher's valid access token (from the Seg-1
// token-manager). All reads loop nextPageToken (fixing V1's 50/100 caps). A 403 insufficient-scope
// maps to a typed GoogleScopeError so routes can surface the reconnect CTA; other failures throw a
// generic status-only error (never leak the Google response body).
const BASE = 'https://classroom.googleapis.com/v1';

export class GoogleScopeError extends Error {
  constructor() { super('google_scope_insufficient'); this.name = 'GoogleScopeError'; }
}

export interface GcCourse { id: string; name: string; section: string | null; enrollmentCode: string | null }
export interface GcStudent { googleId: string; name: string; email: string; photoUrl: string | null }
// The discriminated roster result: `complete=false` means the roster could not be trusted as the
// FULL current membership (a non-first page resolved with no `students` key AND no nextPageToken —
// a partial/transient result). The reconcile engine refuses to soft-remove on complete===false.
export interface GcRoster { students: GcStudent[]; complete: boolean }

async function gcGet(accessToken: string, url: string, label: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 403 && /insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(body)) {
      throw new GoogleScopeError();
    }
    throw new Error(`${label} failed: ${res.status}`); // status only — never leak the body
  }
  return (await res.json()) as Record<string, unknown>;
}

export async function listCourses(accessToken: string): Promise<GcCourse[]> {
  const out: GcCourse[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ teacherId: 'me', courseStates: 'ACTIVE', pageSize: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await gcGet(accessToken, `${BASE}/courses?${params.toString()}`, 'google courses list');
    for (const c of (data.courses as Array<Record<string, unknown>> | undefined) ?? []) {
      out.push({
        id: String(c.id),
        name: String(c.name ?? ''),
        section: (c.section as string | undefined) ?? null,
        enrollmentCode: (c.enrollmentCode as string | undefined) ?? null,
      });
    }
    pageToken = data.nextPageToken as string | undefined;
  } while (pageToken);
  return out;
}

export async function listCourseStudents(accessToken: string, courseId: string): Promise<GcRoster> {
  const out: GcStudent[] = [];
  let pageToken: string | undefined;
  let pageIndex = 0;
  let complete = true;   // becomes false if a NON-first page is empty with no nextPageToken
  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await gcGet(accessToken, `${BASE}/courses/${courseId}/students?${params.toString()}`, 'google students list');
    const students = data.students as Array<Record<string, unknown>> | undefined;
    const next = data.nextPageToken as string | undefined;
    // CRIT-2: a non-first page that returns no `students` key AND no nextPageToken is a partial/
    // transient result, NOT a true end-of-roster — mark the roster untrustworthy so the engine
    // refuses to soft-remove. (A single empty FIRST page = a genuinely empty class = trustworthy.)
    if (pageIndex > 0 && students === undefined && !next) complete = false;
    for (const s of students ?? []) {
      const googleId = String(s.userId ?? '');
      if (!googleId) continue;   // IMP-11: skip blank/missing userId (suspended/transitional account)
      const profile = (s.profile as Record<string, unknown> | undefined) ?? {};
      const nameObj = (profile.name as Record<string, unknown> | undefined) ?? {};
      const email = (profile.emailAddress as string | undefined) ?? '';
      out.push({
        googleId,
        name: String(nameObj.fullName ?? ''),
        email: email.toLowerCase(),
        photoUrl: (profile.photoUrl as string | undefined) ?? null,
      });
    }
    pageToken = next;
    pageIndex++;
  } while (pageToken);
  return { students: out, complete };
}
```

- [ ] **Step 4: Run tests** — PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit** — `git add src/lib/google/classroom.ts src/lib/google/__tests__/classroom.test.ts && git commit -m "feat(gc): classroom adapter — paginated listCourses/listCourseStudents + GoogleScopeError"`

---

### Task 3: `resolveExternalIdentity` — write-free service-role resolver

**Files:**
- Create: `src/lib/google/resolveExternalIdentity.ts`
- Create: `src/lib/google/__tests__/resolveExternalIdentity.test.ts`

**Interfaces:**
- Produces: `resolveExternalIdentity(admin, { schoolId, provider, externalId, email }): Promise<string | null>` where args is `{ schoolId: string; provider: string; externalId: string | null; email: string | null }`. **Write-free** (no INSERT/UPDATE). Resolution order: (1) `external_id` match within `(school_id, provider, external_id)` → return its `core_student_id`; (2) else, if email given, an UNAMBIGUOUS lowercased-email match against existing `external_identities` rows for this `(school_id, provider)` (exactly one distinct `core_student_id` else `null`); (3) else `null`. **NEVER auto-creates.** Seg 4 consumes this; Seg 2 does NOT call it (Seg 2 writes rows via Task 4).

- [ ] **Step 1: Write the failing test** — `src/lib/google/__tests__/resolveExternalIdentity.test.ts`

```typescript
import { describe, it, expect } from 'vitest';

// A tiny query-recording fake admin. external_id path uses .eq(...).eq(...).eq(...).maybeSingle();
// the email path uses .eq(school).eq(provider).eq(lower? ) — we model it as a filtered select that
// returns rows the test supplies.
function fakeAdmin(opts: {
  byExternalId?: { core_student_id: string } | null;
  byEmailRows?: Array<{ core_student_id: string }>;
}) {
  return {
    from() {
      return {
        select() {
          const chain = {
            _eqs: [] as Array<[string, unknown]>,
            eq(col: string, val: unknown) { this._eqs.push([col, val]); return chain; },
            maybeSingle: async () => ({ data: opts.byExternalId ?? null, error: null }),
            // the email path: chained .eq() filters (incl. .eq('email', lower)) then a plain await
            then(resolve: (v: { data: unknown; error: null }) => unknown) {
              return resolve({ data: opts.byEmailRows ?? [], error: null });
            },
          };
          return chain;
        },
      };
    },
  };
}

describe('resolveExternalIdentity', () => {
  it('returns core_student_id on an external_id hit (write-free)', async () => {
    const { resolveExternalIdentity } = await import('@/lib/google/resolveExternalIdentity');
    const out = await resolveExternalIdentity(fakeAdmin({ byExternalId: { core_student_id: 'stu1' } }) as never, {
      schoolId: 's1', provider: 'google', externalId: 'g1', email: 'a@b.edu',
    });
    expect(out).toBe('stu1');
  });
  it('falls back to an unambiguous email match when no external_id row', async () => {
    const { resolveExternalIdentity } = await import('@/lib/google/resolveExternalIdentity');
    const out = await resolveExternalIdentity(fakeAdmin({ byExternalId: null, byEmailRows: [{ core_student_id: 'stu9' }] }) as never, {
      schoolId: 's1', provider: 'google', externalId: 'gX', email: 'A@B.edu',
    });
    expect(out).toBe('stu9');
  });
  it('returns null when email matches more than one distinct student (ambiguous)', async () => {
    const { resolveExternalIdentity } = await import('@/lib/google/resolveExternalIdentity');
    const out = await resolveExternalIdentity(fakeAdmin({ byExternalId: null, byEmailRows: [{ core_student_id: 'a' }, { core_student_id: 'b' }] }) as never, {
      schoolId: 's1', provider: 'google', externalId: 'gX', email: 'dup@b.edu',
    });
    expect(out).toBeNull();
  });
  it('returns null when neither id nor email resolves', async () => {
    const { resolveExternalIdentity } = await import('@/lib/google/resolveExternalIdentity');
    const out = await resolveExternalIdentity(fakeAdmin({ byExternalId: null, byEmailRows: [] }) as never, {
      schoolId: 's1', provider: 'google', externalId: 'gX', email: null,
    });
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** — `src/lib/google/resolveExternalIdentity.ts`

```typescript
// src/lib/google/resolveExternalIdentity.ts
// WRITE-FREE service-role identity resolver against external_identities. Order: external_id-first,
// then UNAMBIGUOUS lowercased-email (exactly one distinct core_student_id, else null). NEVER
// auto-creates — auto-create is the roster-import path only (linkOrCreateStudent). Seg 4 (silent
// SSO launch) is the consumer; Seg 2 ships it but does not call it.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ResolveArgs {
  schoolId: string;
  provider: string;
  externalId: string | null;
  email: string | null;
}

export async function resolveExternalIdentity(admin: SupabaseClient, args: ResolveArgs): Promise<string | null> {
  // 1. external_id-first (the canonical link, unique per school+provider).
  if (args.externalId) {
    const { data } = await admin
      .from('external_identities')
      .select('core_student_id')
      .eq('school_id', args.schoolId)
      .eq('provider', args.provider)
      .eq('external_id', args.externalId)
      .maybeSingle();
    if (data?.core_student_id) return data.core_student_id as string;
  }
  // 2. Unambiguous lowercased-email match within (school, provider). Exact .eq() on the
  //    lowercased value (rows are written lowercased per Task 4) — NOT .ilike, which would treat
  //    %/_ as LIKE metacharacters on an identity key (IMP-5) and would not use the plain index.
  if (args.email) {
    const { data } = await admin
      .from('external_identities')
      .select('core_student_id')
      .eq('school_id', args.schoolId)
      .eq('provider', args.provider)
      .eq('email', args.email.toLowerCase());
    const ids = new Set(
      ((data as Array<{ core_student_id: string | null }> | null) ?? [])
        .map((r) => r.core_student_id)
        .filter((v): v is string => !!v),
    );
    if (ids.size === 1) return [...ids][0];
  }
  return null;
}
```

- [ ] **Step 4: Run tests** — PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit** — `git add src/lib/google/resolveExternalIdentity.ts src/lib/google/__tests__/resolveExternalIdentity.test.ts && git commit -m "feat(gc): write-free resolveExternalIdentity (external_id-first, unambiguous email, never creates)"`

---

### Task 4: `linkOrCreateStudent` — match-or-create + identity-row write

**Files:**
- Create: `src/lib/google/linkOrCreateStudent.ts`
- Create: `src/lib/google/__tests__/linkOrCreateStudent.test.ts`

**Interfaces:**
- Consumes: `ensureAuthUser` + `findAuthIdByEmail` (`src/lib/trial/ensureAuthUser.ts`), `generateTrialPassword` (`src/lib/trial/generatePassword.ts`), admin client.
- Produces: `linkOrCreateStudent(admin, { schoolId, googleId, email, name }): Promise<LinkResult>`
  - `type LinkResult = { outcome: 'created' | 'linked'; studentId: string } | { outcome: 'skipped'; reason: 'no_email' | 'ambiguous' | 'rebind_refused' | 'error' }`
  - Logic: no email → `{skipped:'no_email'}`. Else look up existing `external_identities` google row by `(schoolId, 'google', googleId)`; if hit → harden + return `{linked, studentId}`. Else resolve `public.users` rows by **lowercased exact-`.eq()`** email within the school (NOT `.ilike` — an identity key must not be a LIKE pattern; IMP-5). Role-collision guard FIRST (IMP-5): if ANY matched row has `role !== 'student'` → `{skipped:'rebind_refused'}` (an email used by a teacher/admin/parent must never be rebound to a student, even if a student row ALSO matches). Then on the student rows: >1 → `{skipped:'ambiguous'}`; exactly 1 → reuse (`{linked}`); 0 → create via `ensureAuthUser({ role:'student', school_id, email, full_name:name, password: generateTrialPassword() })` (`{created}`). After create/link, **upsert/harden the `external_identities` row** (`provider='google'`, `external_id=googleId`, `core_student_id`, `email` lowercased, `last_seen_at=now()`). A thrown `ensureAuthUser` rebind-refusal is CAUGHT → `{skipped:'rebind_refused'}`; any other throw → `{skipped:'error'}`.

- [ ] **Step 1: Write the failing test** — `src/lib/google/__tests__/linkOrCreateStudent.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ensureAuthUser = vi.fn();
vi.mock('@/lib/trial/ensureAuthUser', () => ({
  ensureAuthUser: (...a: unknown[]) => ensureAuthUser(...a),
}));
vi.mock('@/lib/trial/generatePassword', () => ({ generateTrialPassword: () => 'TestPass#0001' }));

// fake admin: external_identities google-row lookup + users email lookup + identity upsert capture.
function fakeAdmin(opts: {
  idRow?: { core_student_id: string } | null;       // existing google identity row
  userRows?: Array<{ id: string; role: string }>;   // public.users email matches
}) {
  const upserts: Array<Record<string, unknown>> = [];
  let call = 0;
  return {
    upserts,
    from(table: string) {
      if (table === 'external_identities') {
        return {
          select() {
            return { eq() { return this; }, maybeSingle: async () => ({ data: opts.idRow ?? null, error: null }) };
          },
          upsert(row: Record<string, unknown>, o?: { onConflict?: string }) {
            upserts.push({ ...row, __onConflict: o?.onConflict }); return Promise.resolve({ error: null });
          },
        };
      }
      // users email lookup: select().eq(school).eq('email', lower) -> rows
      return {
        select() {
          const chain = {
            eq() { return chain; },
            then(resolve: (v: { data: unknown; error: null }) => unknown) {
              return resolve({ data: opts.userRows ?? [], error: null });
            },
          };
          return chain;
        },
      };
    },
  };
}

beforeEach(() => { ensureAuthUser.mockReset(); });

describe('linkOrCreateStudent', () => {
  it('skips a student with no email', async () => {
    const { linkOrCreateStudent } = await import('@/lib/google/linkOrCreateStudent');
    const r = await linkOrCreateStudent(fakeAdmin({}) as never, { schoolId: 's1', googleId: 'g1', email: '', name: 'X' });
    expect(r).toEqual({ outcome: 'skipped', reason: 'no_email' });
  });
  it('links via an existing google identity row (no create)', async () => {
    const { linkOrCreateStudent } = await import('@/lib/google/linkOrCreateStudent');
    const r = await linkOrCreateStudent(fakeAdmin({ idRow: { core_student_id: 'stu7' } }) as never, { schoolId: 's1', googleId: 'g1', email: 'a@b.edu', name: 'A' });
    expect(r).toEqual({ outcome: 'linked', studentId: 'stu7' });
    expect(ensureAuthUser).not.toHaveBeenCalled();
  });
  it('reuses exactly one existing student matched by email and writes the identity row', async () => {
    const admin = fakeAdmin({ idRow: null, userRows: [{ id: 'stu3', role: 'student' }] });
    const { linkOrCreateStudent } = await import('@/lib/google/linkOrCreateStudent');
    const r = await linkOrCreateStudent(admin as never, { schoolId: 's1', googleId: 'g1', email: 'A@B.edu', name: 'A' });
    expect(r).toEqual({ outcome: 'linked', studentId: 'stu3' });
    const row = admin.upserts[0];
    expect(row.provider).toBe('google');
    expect(row.external_id).toBe('g1');
    expect(row.core_student_id).toBe('stu3');
    expect(row.email).toBe('a@b.edu');            // lowercased
    expect(typeof row.last_seen_at).toBe('string');
    expect(row.__onConflict).toBe('school_id,provider,external_id');
  });
  it('creates a new student via ensureAuthUser when no match', async () => {
    ensureAuthUser.mockResolvedValue('newStu');
    const admin = fakeAdmin({ idRow: null, userRows: [] });
    const { linkOrCreateStudent } = await import('@/lib/google/linkOrCreateStudent');
    const r = await linkOrCreateStudent(admin as never, { schoolId: 's1', googleId: 'g1', email: 'new@b.edu', name: 'New' });
    expect(r).toEqual({ outcome: 'created', studentId: 'newStu' });
    expect(ensureAuthUser).toHaveBeenCalledWith(expect.objectContaining({ role: 'student', email: 'new@b.edu', school_id: 's1', password: 'TestPass#0001' }));
    expect(admin.upserts[0].core_student_id).toBe('newStu');
  });
  it('skips ambiguous when more than one student matches the email', async () => {
    const { linkOrCreateStudent } = await import('@/lib/google/linkOrCreateStudent');
    const r = await linkOrCreateStudent(fakeAdmin({ idRow: null, userRows: [{ id: 'a', role: 'student' }, { id: 'b', role: 'student' }] }) as never, { schoolId: 's1', googleId: 'g1', email: 'dup@b.edu', name: 'D' });
    expect(r).toEqual({ outcome: 'skipped', reason: 'ambiguous' });
    expect(ensureAuthUser).not.toHaveBeenCalled();
  });
  it('skips rebind_refused when the matched email belongs to a non-student role', async () => {
    const { linkOrCreateStudent } = await import('@/lib/google/linkOrCreateStudent');
    const r = await linkOrCreateStudent(fakeAdmin({ idRow: null, userRows: [{ id: 't1', role: 'teacher' }] }) as never, { schoolId: 's1', googleId: 'g1', email: 'teach@b.edu', name: 'T' });
    expect(r).toEqual({ outcome: 'skipped', reason: 'rebind_refused' });
  });
  it('skips rebind_refused when the email matches BOTH a student AND a non-student (IMP-5 collision)', async () => {
    const { linkOrCreateStudent } = await import('@/lib/google/linkOrCreateStudent');
    // one student + one teacher share the email — the non-student collision must win (skip+flag),
    // never reuse the student row.
    const r = await linkOrCreateStudent(fakeAdmin({ idRow: null, userRows: [{ id: 's3', role: 'student' }, { id: 't1', role: 'teacher' }] }) as never, { schoolId: 's1', googleId: 'g1', email: 'shared@b.edu', name: 'S' });
    expect(r).toEqual({ outcome: 'skipped', reason: 'rebind_refused' });
    expect(ensureAuthUser).not.toHaveBeenCalled();
  });
  it('catches an ensureAuthUser rebind throw and skips rebind_refused (never aborts)', async () => {
    ensureAuthUser.mockRejectedValue(new Error('Refusing to rebind existing user (role/school mismatch) — not seed-owned'));
    const { linkOrCreateStudent } = await import('@/lib/google/linkOrCreateStudent');
    const r = await linkOrCreateStudent(fakeAdmin({ idRow: null, userRows: [] }) as never, { schoolId: 's1', googleId: 'g1', email: 'x@b.edu', name: 'X' });
    expect(r).toEqual({ outcome: 'skipped', reason: 'rebind_refused' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** — `src/lib/google/linkOrCreateStudent.ts`

```typescript
// src/lib/google/linkOrCreateStudent.ts
// The roster-import per-student path: match-or-create a student, then write/harden the
// external_identities google-id row (provider='google', external_id=googleUserId). Match by
// LOWERCASED email; create via the shared ensureAuthUser guard (honors the account-takeover
// contract — a role/school mismatch HARD-FAILS and is caught here as rebind_refused, never rebinds,
// never aborts the import). No-email / ambiguous / non-student-role → skipped with a reason.
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureAuthUser } from '@/lib/trial/ensureAuthUser';
import { generateTrialPassword } from '@/lib/trial/generatePassword';

export type LinkResult =
  | { outcome: 'created' | 'linked'; studentId: string }
  | { outcome: 'skipped'; reason: 'no_email' | 'ambiguous' | 'rebind_refused' | 'error' };

export interface LinkArgs { schoolId: string; googleId: string; email: string; name: string }

async function writeIdentity(admin: SupabaseClient, args: { schoolId: string; googleId: string; email: string; studentId: string }) {
  await admin.from('external_identities').upsert(
    {
      school_id: args.schoolId,
      provider: 'google',
      external_id: args.googleId,
      core_student_id: args.studentId,
      email: args.email.toLowerCase(),
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'school_id,provider,external_id' },
  );
}

export async function linkOrCreateStudent(admin: SupabaseClient, args: LinkArgs): Promise<LinkResult> {
  const email = (args.email ?? '').trim().toLowerCase();
  if (!email) return { outcome: 'skipped', reason: 'no_email' };

  try {
    // 1. Existing google identity row → link (harden last_seen below).
    const { data: idRow } = await admin
      .from('external_identities')
      .select('core_student_id')
      .eq('school_id', args.schoolId)
      .eq('provider', 'google')
      .eq('external_id', args.googleId)
      .maybeSingle();
    if (idRow?.core_student_id) {
      const studentId = idRow.core_student_id as string;
      await writeIdentity(admin, { schoolId: args.schoolId, googleId: args.googleId, email, studentId });
      return { outcome: 'linked', studentId };
    }

    // 2. Match existing public.users rows by lowercased email within the school. Exact .eq() on
    //    the lowercased value (NOT .ilike — an identity key must not be a LIKE pattern; IMP-5).
    const { data: userRows } = await admin
      .from('users')
      .select('id, role')
      .eq('school_id', args.schoolId)
      .eq('email', email);
    const rows = (userRows as Array<{ id: string; role: string }> | null) ?? [];
    // Role-collision guard FIRST: if the email is used by ANY non-student role (teacher/admin/
    // parent), refuse — even if a student row also matches (never rebind a staff email; IMP-5).
    if (rows.some((r) => r.role !== 'student')) return { outcome: 'skipped', reason: 'rebind_refused' };
    const students = rows.filter((r) => r.role === 'student');
    if (students.length > 1) return { outcome: 'skipped', reason: 'ambiguous' };

    let studentId: string;
    let outcome: 'created' | 'linked';
    if (students.length === 1) {
      studentId = students[0].id;
      outcome = 'linked';
    } else {
      // 3. No match → create via the account-takeover guard (throws on a role/school mismatch).
      studentId = await ensureAuthUser({
        admin,
        email,
        password: generateTrialPassword(),
        full_name: args.name || email,
        role: 'student',
        school_id: args.schoolId,
      });
      outcome = 'created';
    }
    await writeIdentity(admin, { schoolId: args.schoolId, googleId: args.googleId, email, studentId });
    return { outcome, studentId };
  } catch (err) {
    if (err instanceof Error && /refus|rebind|mismatch/i.test(err.message)) {
      return { outcome: 'skipped', reason: 'rebind_refused' };
    }
    console.error('[gc] linkOrCreateStudent failed (skipped):', err instanceof Error ? err.message : 'unknown');
    return { outcome: 'skipped', reason: 'error' };
  }
}
```

> Note: `ensureAuthUser`'s signature is `{ admin, email, password, full_name, role, school_id }` (grounding §2.3). Email matching uses exact `.eq('email', email.toLowerCase())` (IMP-5) — `external_identities`/`users` emails are written lowercased, so an equality compare is both injection-safe and index-matched (the new plain `(school_id, provider, email)` index). `findAuthIdByEmail` separately does its own case-insensitive `listUsers` scan inside `ensureAuthUser`.

- [ ] **Step 4: Run tests** — PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit** — `git add src/lib/google/linkOrCreateStudent.ts src/lib/google/__tests__/linkOrCreateStudent.test.ts && git commit -m "feat(gc): linkOrCreateStudent (match-or-create + identity-row write, account-takeover-safe)"`

---

### Task 5: `reconcileCourseRoster` — the shared two-way reconcile engine

**Files:**
- Create: `src/lib/google/reconcileCourseRoster.ts`
- Create: `src/lib/google/__tests__/reconcileCourseRoster.test.ts`

**Interfaces:**
- Consumes: `getValidAccessTokenForTeacher` (Seg 1), `listCourseStudents` (Task 2, now returns `GcRoster {students, complete}`), `linkOrCreateStudent` (Task 4), admin client.
- Produces: `reconcileCourseRoster(admin, { teacherId, schoolId, googleCourseId, classId }): Promise<ReconcileResult>`
  - `interface ReconcileResult { created: number; linked: number; skippedNoEmail: number; skippedOther: number; enrolled: number; reactivated: number; softRemoved: number; errors: number; removeSkippedSuspectEmpty: boolean }`
  - **Single course** signature (push-ready). Flow:
    1. `accessToken = getValidAccessTokenForTeacher(admin, teacherId)` (throws `GoogleNotConnectedError` — propagates to the caller, which surfaces reconnect).
    2. `{ students, complete } = listCourseStudents(accessToken, googleCourseId)` (throws `GoogleScopeError` — propagates).
    3. Build `presentGoogleIds = Set<googleId>` from the current GC roster (already non-blank — Task 2 skips blank ids).
    4. **Add side:** dedupe within the import with a lowercased `seenEmails` Set (IMP-4) — a second row with the same email → `skippedOther++` + `continue` (never double-enroll). For each remaining GC student → `linkOrCreateStudent` → tally created/linked/skipped. On a resolved `studentId`, enroll: first read the prior seat (`enrollments.select('is_active').eq(class_id).eq(student_id).maybeSingle()`) to split the count, then `enrollments.upsert({ class_id, student_id, is_active:true, source:'google' }, { onConflict:'class_id,student_id' })`. **supabase-js returns `{ error }` (does NOT throw):** on `error` (incl. the seat-cap `check_violation`/`23514`) → `errors++` (or count as `skippedOther` for the seat-cap; see impl) + log + `continue`; do NOT increment success counters. On no-error: no prior row → `enrolled++`; prior row `is_active=false` → `reactivated++`; prior row `is_active=true` → no-op (idempotent). `source:'google'` stamps the seat's GC provenance (ITEM A).
    5. **Remove side (two-way), GUARDED:** the removal-candidate set is THIS class's ACTIVE enrollments WHERE `source='google'` (ITEM A — per-class provenance; load FIRST so the fetch is class-scoped, IMP-9). **Trustworthy-roster guard (CRIT-2):** if (`complete===false` OR `presentGoogleIds.size===0`) AND that candidate set is non-empty → SKIP the entire remove side, `softRemoved=0`, set `removeSkippedSuspectEmpty=true`, return. Otherwise, for each candidate seat whose `external_id` (its `provider='google'` identity) is NOT in `presentGoogleIds` → `enrollments.update({ is_active:false })` for `(class_id, student_id)`. **Branch on the returned `{ error }`:** `softRemoved++` only on no-error; on error → `errors++` + log, do NOT abort (IMP-2). NEVER delete the user/identity/history. A `source<>'google'`/manually-added seat is never in the candidate set, so it is untouched (ITEM A — a `source<>'google'` active seat absent from the roster is NEVER soft-removed); a student GC-sourced via another class is scoped out because we filter by THIS `class_id`.
  - Idempotent: an unchanged roster yields all-`linked`, zero `created/softRemoved`.
- **Concurrency & overlap (MIN-1):** the engine is idempotent in steady state but NOT concurrency-safe — an overlapping cron vs "Sync now" could interleave a stale `is_active:false` after a fresh `is_active:true`. Take a per-class advisory lock at engine entry: `SELECT pg_try_advisory_xact_lock(hashtext(<classId>))` (via an admin `rpc`/`select`); on a miss return early with `skipped:'locked'` (a `ReconcileResult` with all-zero counts + the skip noted — do NOT block). No migration column needed (transaction-scoped advisory lock). The lock is best-effort safety; the idempotent convergence on the next run is the backstop.
- **Non-transactional convergence (MIN-9):** the add and remove sides are intentionally NOT wrapped in a single transaction — a partial failure self-heals on the next idempotent run. Documented, not a defect.

- [ ] **Step 1: Write the failing test** — `src/lib/google/__tests__/reconcileCourseRoster.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getValid = vi.fn();
const listCourseStudents = vi.fn();
const linkOrCreateStudent = vi.fn();
vi.mock('@/lib/google/tokens', () => ({ getValidAccessTokenForTeacher: (...a: unknown[]) => getValid(...a) }));
vi.mock('@/lib/google/classroom', () => ({ listCourseStudents: (...a: unknown[]) => listCourseStudents(...a) }));
vi.mock('@/lib/google/linkOrCreateStudent', () => ({ linkOrCreateStudent: (...a: unknown[]) => linkOrCreateStudent(...a) }));

// fake admin. Models, per (class_id) scope:
//  - the prior-seat read:  enrollments.select('is_active').eq(class_id).eq(student_id).maybeSingle()
//  - the enroll upsert:     enrollments.upsert(row, {onConflict}) -> { error }
//  - the source='google' active-seat set: enrollments.select('student_id, external_id?…')
//       .eq(class_id).eq(is_active,true).eq(source,'google') joined to its google external_id
//  - the soft-un-enroll:    enrollments.update({is_active:false}).eq(class_id).eq(student_id) -> { error }
// To keep the fake simple, the candidate set is supplied directly as googleSeats:
//   [{ student_id, external_id }] = THIS class's active source='google' seats (already class-scoped).
// `advisoryLock` lets a test simulate the pg_try_advisory_xact_lock miss.
function fakeAdmin(opts: {
  googleSeats?: Array<{ student_id: string; external_id: string }>;   // this class's active source='google' seats
  priorSeat?: Record<string, { is_active: boolean }>;                 // prior seat state by student_id (for the count split)
  enrollError?: unknown;                                              // returned by the enroll upsert
  updateError?: unknown;                                             // returned by the soft-un-enroll update
  advisoryLock?: boolean;                                            // pg_try_advisory_xact_lock result (default true)
}) {
  const enrollUpserts: Array<{ student_id: string; is_active: boolean; source?: string }> = [];
  const softRemovals: string[] = [];
  const priorSeat = opts.priorSeat ?? {};
  return {
    enrollUpserts, softRemovals,
    // pg_try_advisory_xact_lock(hashtext(classId)) — modeled via .rpc
    rpc: async () => ({ data: opts.advisoryLock ?? true, error: null }),
    from(table: string) {
      if (table !== 'enrollments') return { select() { return { eq() { return this; }, then(r: (v: { data: unknown; error: null }) => unknown) { return r({ data: [], error: null }); } }; } };
      return {
        upsert(row: { class_id: string; student_id: string; is_active: boolean; source?: string }) {
          if (!opts.enrollError) enrollUpserts.push({ student_id: row.student_id, is_active: row.is_active, source: row.source });
          return Promise.resolve({ error: opts.enrollError ?? null });
        },
        // Two select shapes are distinguished by the selected columns string:
        //  'is_active' (single)        -> the prior-seat read .eq(class_id).eq(student_id).maybeSingle()
        //  'student_id' (candidate set) -> THIS class's active source='google' seats
        select(cols: string) {
          if (cols.includes('is_active') && !cols.includes('student_id')) {
            let sawStudent: string | undefined;
            const chain = {
              eq(col: string, val: string) { if (col === 'student_id') sawStudent = val; return chain; },
              maybeSingle: async () => ({ data: sawStudent && priorSeat[sawStudent] ? priorSeat[sawStudent] : null, error: null }),
            };
            return chain;
          }
          return { eq() { return this; }, then(r: (v: { data: unknown; error: null }) => unknown) {
            return r({ data: opts.googleSeats ?? [], error: null }); } };
        },
        update(_vals: { is_active: boolean }) {
          return { eq(col: string, val: string) {
            if (col === 'student_id' && !opts.updateError) softRemovals.push(val);
            return { eq: () => Promise.resolve({ error: opts.updateError ?? null }) };
          } };
        },
      };
    },
  } as never as { enrollUpserts: typeof enrollUpserts; softRemovals: typeof softRemovals };
}
// NOTE FOR THE IMPLEMENTER: this fake mirrors the SHAPES the engine touches — the advisory-lock rpc,
// the per-student prior-seat .eq(class_id).eq(student_id).maybeSingle() read (resolved from priorSeat),
// the {error}-returning enroll upsert + soft-un-enroll update, and the class-scoped source='google'
// candidate select. Keep each as a discrete call that branches on the RETURNED { error } (never a
// try/catch around supabase-js); you may simplify/rewrite the fake as long as every assertion holds.

beforeEach(() => {
  getValid.mockReset(); listCourseStudents.mockReset(); linkOrCreateStudent.mockReset();
  getValid.mockResolvedValue('AT');
});

describe('reconcileCourseRoster — add side', () => {
  it('creates/links + enrolls each GC student (source=google) and tallies', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [
      { googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null },
      { googleId: 'g2', name: 'B', email: 'b@b.edu', photoUrl: null },
    ] });
    linkOrCreateStudent
      .mockResolvedValueOnce({ outcome: 'created', studentId: 's1' })
      .mockResolvedValueOnce({ outcome: 'linked', studentId: 's2' });
    const admin = fakeAdmin({ googleSeats: [], priorSeat: {} });   // no prior seats → both fresh enrolls
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(r.created).toBe(1); expect(r.linked).toBe(1);
    expect(r.enrolled).toBe(2); expect(r.reactivated).toBe(0); expect(r.errors).toBe(0);
    expect(admin.enrollUpserts.every((e) => e.source === 'google')).toBe(true);
    expect(r.softRemoved).toBe(0);
  });
  it('counts skippedNoEmail and never enrolls a no-email skip', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [
      { googleId: 'g3', name: '', email: '', photoUrl: null },
    ] });
    linkOrCreateStudent.mockResolvedValueOnce({ outcome: 'skipped', reason: 'no_email' });
    const admin = fakeAdmin({ googleSeats: [], priorSeat: {} });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(r.skippedNoEmail).toBe(1); expect(r.enrolled).toBe(0);
  });
  it('reactivates a previously soft-removed seat (IMP-3 — counts reactivated, not enrolled)', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [
      { googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null },
    ] });
    linkOrCreateStudent.mockResolvedValue({ outcome: 'linked', studentId: 's1' });
    // prior seat for s1 exists with is_active=false → the upsert reactivates it.
    const admin = fakeAdmin({ googleSeats: [], priorSeat: { s1: { is_active: false } } });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(r.reactivated).toBe(1); expect(r.enrolled).toBe(0);
  });
  it('dedupes a duplicate email within one import (IMP-4 — second row skippedOther, not double-enrolled)', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [
      { googleId: 'g1', name: 'A', email: 'dup@b.edu', photoUrl: null },
      { googleId: 'g2', name: 'A2', email: 'DUP@b.edu', photoUrl: null },   // same email (case-insensitive)
    ] });
    linkOrCreateStudent.mockResolvedValueOnce({ outcome: 'created', studentId: 's1' });
    const admin = fakeAdmin({ googleSeats: [], priorSeat: {} });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(linkOrCreateStudent).toHaveBeenCalledTimes(1);   // second never reaches link/create
    expect(r.skippedOther).toBe(1); expect(r.enrolled).toBe(1);
  });
  it('seat-cap / DB error on the enroll upsert is counted, not silently enrolled (IMP-1)', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [
      { googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null },
    ] });
    linkOrCreateStudent.mockResolvedValue({ outcome: 'created', studentId: 's1' });
    const admin = fakeAdmin({ googleSeats: [], priorSeat: {}, enrollError: { code: '23514' } });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(r.enrolled).toBe(0);
    expect(r.errors + r.skippedOther).toBeGreaterThanOrEqual(1);   // accounted, not lost
    expect(admin.enrollUpserts).toHaveLength(0);                   // the upsert did not "succeed"
  });
});

describe('reconcileCourseRoster — two-way remove side', () => {
  it('soft un-enrolls a source=google seat no longer in the GC roster', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [{ googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null }] });
    linkOrCreateStudent.mockResolvedValue({ outcome: 'linked', studentId: 's1' });
    // s2 (external_id g2) is an active source='google' seat in THIS class but g2 is no longer present.
    const admin = fakeAdmin({ googleSeats: [{ student_id: 's1', external_id: 'g1' }, { student_id: 's2', external_id: 'g2' }], priorSeat: { s1: { is_active: true } } });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(admin.softRemovals).toEqual(['s2']);
    expect(r.softRemoved).toBe(1);
  });
  it('NEVER soft-removes a source<>google (manually-added) active seat absent from the roster (ITEM A)', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [{ googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null }] });
    linkOrCreateStudent.mockResolvedValue({ outcome: 'linked', studentId: 's1' });
    // sManual is active in the class but NOT in the source='google' candidate set → left alone.
    const admin = fakeAdmin({ googleSeats: [{ student_id: 's1', external_id: 'g1' }], priorSeat: { s1: { is_active: true } } });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(admin.softRemovals).toEqual([]);   // sManual (source<>'google') untouched
    expect(r.softRemoved).toBe(0);
  });
  it('a failed soft-un-enroll update does NOT increment softRemoved (IMP-2)', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [{ googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null }] });
    linkOrCreateStudent.mockResolvedValue({ outcome: 'linked', studentId: 's1' });
    const admin = fakeAdmin({ googleSeats: [{ student_id: 's1', external_id: 'g1' }, { student_id: 's2', external_id: 'g2' }], priorSeat: { s1: { is_active: true } }, updateError: { message: 'boom' } });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(r.softRemoved).toBe(0);
    expect(r.errors).toBeGreaterThanOrEqual(1);
  });
  it('CRIT-2: an INCOMPLETE roster skips the remove side and flags removeSkippedSuspectEmpty', async () => {
    listCourseStudents.mockResolvedValue({ complete: false, students: [{ googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null }] });
    linkOrCreateStudent.mockResolvedValue({ outcome: 'linked', studentId: 's1' });
    // g2 would look "absent" but the roster is untrustworthy (complete:false) → never remove.
    const admin = fakeAdmin({ googleSeats: [{ student_id: 's1', external_id: 'g1' }, { student_id: 's2', external_id: 'g2' }], priorSeat: { s1: { is_active: true } } });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(admin.softRemovals).toEqual([]);
    expect(r.softRemoved).toBe(0);
    expect(r.removeSkippedSuspectEmpty).toBe(true);
  });
  it('CRIT-2: an EMPTY roster with existing source=google seats skips the remove side (no mass un-enroll)', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [] });   // empty but "complete" (transient-200 vector)
    const admin = fakeAdmin({ googleSeats: [{ student_id: 's1', external_id: 'g1' }, { student_id: 's2', external_id: 'g2' }], priorSeat: {} });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(admin.softRemovals).toEqual([]);
    expect(r.softRemoved).toBe(0);
    expect(r.removeSkippedSuspectEmpty).toBe(true);
  });
  it('a genuinely empty class (empty roster, no source=google seats) is a clean no-op, not flagged', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [] });
    const admin = fakeAdmin({ googleSeats: [], priorSeat: {} });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(r.softRemoved).toBe(0);
    expect(r.removeSkippedSuspectEmpty).toBe(false);
  });
  it('returns early (all-zero) when the advisory lock is not acquired (MIN-1)', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [{ googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null }] });
    const admin = fakeAdmin({ googleSeats: [], priorSeat: {}, advisoryLock: false });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(r.created).toBe(0); expect(r.enrolled).toBe(0); expect(r.softRemoved).toBe(0);
    expect(listCourseStudents).not.toHaveBeenCalled();   // bailed before any Google fetch
  });
  it('propagates GoogleNotConnectedError from the token manager', async () => {
    class GoogleNotConnectedError extends Error {}
    getValid.mockRejectedValue(new GoogleNotConnectedError());
    const admin = fakeAdmin({});
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    await expect(reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' }))
      .rejects.toBeInstanceOf(GoogleNotConnectedError);
  });
});
```

> The fake admin above is illustrative — it shows the DB call SHAPES the engine touches (the advisory-lock `rpc`, the per-student prior-seat `maybeSingle` read, the `{error}`-returning upsert/update, and the class-scoped `source='google'` candidate select). The implementer should write the engine so each of those is a discrete call that branches on the RETURNED `{ error }` (never a try/catch around supabase-js), and may simplify/rewrite the fake as long as every assertion above holds.

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** — `src/lib/google/reconcileCourseRoster.ts`

```typescript
// src/lib/google/reconcileCourseRoster.ts
// THE shared two-way reconcile engine. ONE course → ONE class. Three triggers call it: initial
// import, on-demand "Sync now", and the nightly cron. The single-course signature is push-ready
// (a future Pub/Sub webhook can call it per-course) — push itself is NOT built in Seg 2.
//
// SAFETY (binding): scope is STRICTLY the one classId. ADD side: every GC student is matched/
// created (linkOrCreateStudent, account-takeover-safe) then enrolled with source='google'
// (reactivating a soft-removed seat). REMOVE side (two-way): an active source='google' seat in
// THIS class whose google id is ABSENT from a TRUSTWORTHY current GC roster is SOFT un-enrolled
// (is_active=false) — never deleted, never their history. A source<>'google'/manually-added seat
// is NEVER touched (per-class provenance — ITEM A). An empty/incomplete roster NEVER mass-removes
// (CRIT-2). supabase-js returns { error } (does NOT throw) — every upsert/update branches on it.
import type { SupabaseClient } from '@supabase/supabase-js';
import { getValidAccessTokenForTeacher } from '@/lib/google/tokens';
import { listCourseStudents } from '@/lib/google/classroom';
import { linkOrCreateStudent } from '@/lib/google/linkOrCreateStudent';

export interface ReconcileArgs { teacherId: string; schoolId: string; googleCourseId: string; classId: string }
export interface ReconcileResult {
  created: number; linked: number; skippedNoEmail: number; skippedOther: number;
  enrolled: number; reactivated: number; softRemoved: number;
  errors: number; removeSkippedSuspectEmpty: boolean;
}

function emptyResult(): ReconcileResult {
  return { created: 0, linked: 0, skippedNoEmail: 0, skippedOther: 0, enrolled: 0, reactivated: 0, softRemoved: 0, errors: 0, removeSkippedSuspectEmpty: false };
}

export async function reconcileCourseRoster(admin: SupabaseClient, args: ReconcileArgs): Promise<ReconcileResult> {
  const r = emptyResult();

  // 0. Concurrency guard (MIN-1): a transaction-scoped per-class advisory lock. On a miss, another
  //    reconcile for this class is in flight — bail with an all-zero no-op (the in-flight run + the
  //    next idempotent run converge). hashtext(classId) maps the uuid to the int the lock needs.
  const { data: gotLock } = await admin.rpc('pg_try_advisory_xact_lock', { key: hashClassId(args.classId) }).catch(() => ({ data: true }));
  // NOTE: pg_try_advisory_xact_lock is a built-in; expose it via a thin SECURITY DEFINER wrapper
  //   RPC (or a one-line `select pg_try_advisory_xact_lock($1)` helper) so the admin client can
  //   call it. If the wrapper is not yet present, treat a null/absent result as acquired (true).
  if (gotLock === false) return r;

  // 1-2. Token + current GC roster (errors propagate so the caller surfaces reconnect).
  const accessToken = await getValidAccessTokenForTeacher(admin, args.teacherId);
  const { students: gcStudents, complete } = await listCourseStudents(accessToken, args.googleCourseId);
  const presentGoogleIds = new Set(gcStudents.map((s) => s.googleId));   // already non-blank (Task 2)

  // 4. ADD side (with within-import duplicate-email dedupe — IMP-4).
  const seenEmails = new Set<string>();
  for (const s of gcStudents) {
    const email = (s.email ?? '').trim().toLowerCase();
    if (email && seenEmails.has(email)) { r.skippedOther++; continue; }   // dup within this import → skip, never double-enroll
    if (email) seenEmails.add(email);

    const res = await linkOrCreateStudent(admin, { schoolId: args.schoolId, googleId: s.googleId, email: s.email, name: s.name });
    if (res.outcome === 'skipped') {
      if (res.reason === 'no_email') r.skippedNoEmail++; else r.skippedOther++;
      continue;
    }
    if (res.outcome === 'created') r.created++; else r.linked++;

    // Read the prior seat to split enrolled vs reactivated (IMP-3).
    const { data: prior } = await admin
      .from('enrollments').select('is_active')
      .eq('class_id', args.classId).eq('student_id', res.studentId).maybeSingle();

    // Enroll (source='google' stamps per-class GC provenance — ITEM A). supabase-js returns
    // { error } — including the seat-cap check_violation (23514). Branch on it; never try/catch.
    const { error: enrollErr } = await admin.from('enrollments').upsert(
      { class_id: args.classId, student_id: res.studentId, is_active: true, source: 'google' },
      { onConflict: 'class_id,student_id' },
    );
    if (enrollErr) {
      // Seat-cap on an 'active'-license school is the expected case; count it as a skip, not a
      // crash, and keep going. Do NOT decrement created/linked (the user row exists — documented
      // acceptable for the pilot; IMP-1).
      const code = (enrollErr as { code?: string }).code;
      if (code === '23514') r.skippedOther++; else r.errors++;
      console.error('[gc] enroll failed (skipped):', (enrollErr as { message?: string }).message ?? code ?? 'unknown');
      continue;
    }
    if (!prior) r.enrolled++;
    else if (prior.is_active === false) r.reactivated++;
    // prior.is_active === true → idempotent no-op (neither counter).
  }

  // 5. REMOVE side (two-way), per-class-scoped by source='google' (ITEM A) + class-scoped fetch
  //    (IMP-9). Load THIS class's ACTIVE source='google' seats joined to their google external_id.
  //    NOTE: implementer may either (a) select active source='google' enrollments then fetch those
  //    students' provider='google' external_ids via .in('core_student_id', ids) (chunk ≤200), or
  //    (b) a join view. Either way the candidate set is class-scoped — never the school-wide set.
  const candidates = await loadActiveGoogleSeats(admin, args.classId, args.schoolId);  // [{ student_id, external_id }]

  // Trustworthy-roster guard (CRIT-2): an empty OR incomplete roster must NOT mass-un-enroll. If
  // the roster is untrustworthy AND there are google seats to protect, skip the whole remove side.
  if ((complete === false || presentGoogleIds.size === 0) && candidates.length > 0) {
    r.removeSkippedSuspectEmpty = true;
    return r;
  }

  for (const seat of candidates) {
    if (presentGoogleIds.has(seat.external_id)) continue;   // still in the trustworthy roster → keep
    const { error: updErr } = await admin.from('enrollments')
      .update({ is_active: false })
      .eq('class_id', args.classId).eq('student_id', seat.student_id);
    if (updErr) { r.errors++; console.error('[gc] soft un-enroll failed:', (updErr as { message?: string }).message ?? 'unknown'); continue; }
    r.softRemoved++;
  }

  return r;
}

// hashClassId — fold the uuid into a bigint key for pg_try_advisory_xact_lock. Implementer may use
// the DB's own hashtext() inside the wrapper RPC instead and pass the uuid text directly; either is
// fine as long as the key is stable per classId.
function hashClassId(classId: string): number {
  let h = 0;
  for (let i = 0; i < classId.length; i++) { h = (h * 31 + classId.charCodeAt(i)) | 0; }
  return h;
}

// loadActiveGoogleSeats — THIS class's active source='google' seats with their provider='google'
// external_id. Class-scoped (IMP-9): never load the school-wide identity set.
async function loadActiveGoogleSeats(admin: SupabaseClient, classId: string, schoolId: string): Promise<Array<{ student_id: string; external_id: string }>> {
  const { data: seats } = await admin.from('enrollments')
    .select('student_id')
    .eq('class_id', classId).eq('is_active', true).eq('source', 'google');
  const studentIds = ((seats as Array<{ student_id: string }> | null) ?? []).map((s) => s.student_id);
  if (studentIds.length === 0) return [];
  const out: Array<{ student_id: string; external_id: string }> = [];
  for (let i = 0; i < studentIds.length; i += 200) {   // chunk .in() to ≤200 (pilot never hits it)
    const chunk = studentIds.slice(i, i + 200);
    const { data: ids } = await admin.from('external_identities')
      .select('core_student_id, external_id')
      .eq('school_id', schoolId).eq('provider', 'google')
      .in('core_student_id', chunk);
    for (const row of (ids as Array<{ core_student_id: string | null; external_id: string }> | null) ?? []) {
      if (row.core_student_id) out.push({ student_id: row.core_student_id, external_id: row.external_id });
    }
  }
  return out;
}
```

> Note on `reactivated` (IMP-3): the count is now real — a prior `is_active=false` seat that the upsert flips back on counts as `reactivated`, a brand-new seat counts as `enrolled`, an already-active seat is a silent no-op. The UI no longer shows a permanently-zero "re-added" stat.
> Note on the seat-cap (IMP-1): a created-then-enroll-failed student leaves a `users` row with no seat in this class — documented acceptable for the pilot (the create is idempotent; a later successful import enrolls them). We do NOT decrement `created`/`linked`.

- [ ] **Step 4: Run tests** — PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit** — `git add src/lib/google/reconcileCourseRoster.ts src/lib/google/__tests__/reconcileCourseRoster.test.ts && git commit -m "feat(gc): reconcileCourseRoster — shared two-way reconcile engine (add/link/enroll + soft un-enroll)"`

---

### Task 6: Courses route — `GET /api/teacher/google/courses`

**Files:**
- Create: `src/app/api/teacher/google/courses/route.ts`
- Create: `src/app/api/teacher/google/courses/__tests__/route.test.ts`

**Interfaces:**
- Consumes: auth chain, `getValidAccessTokenForTeacher` + `GoogleNotConnectedError`, `listCourses` + `GoogleScopeError`.
- Produces: `GET` → 401 (no user), 403 (non-teacher); `{ connected:false }` (HTTP 200) on `GoogleNotConnectedError`; `{ needsReconnect:true }` (HTTP 200) on `GoogleScopeError`; else `{ courses: GcCourse[] }`. No raw error leak.

- [ ] **Step 1: Write the failing test** — `src/app/api/teacher/google/courses/__tests__/route.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const single = vi.fn();
const getValid = vi.fn();
const listCourses = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }),
  createAdminSupabaseClient: () => ({}),
}));
vi.mock('@/lib/google/tokens', async () => {
  class GoogleNotConnectedError extends Error {}
  return { getValidAccessTokenForTeacher: (...a: unknown[]) => getValid(...a), GoogleNotConnectedError };
});
vi.mock('@/lib/google/classroom', async () => {
  class GoogleScopeError extends Error {}
  return { listCourses: (...a: unknown[]) => listCourses(...a), GoogleScopeError };
});
beforeEach(() => {
  for (const m of [getUser, single, getValid, listCourses]) m.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  single.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' }, error: null });
});
const req = () => new NextRequest('http://x/api/teacher/google/courses');

describe('GET /api/teacher/google/courses', () => {
  it('401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import('@/app/api/teacher/google/courses/route');
    expect((await GET(req())).status).toBe(401);
  });
  it('403 for a non-teacher', async () => {
    single.mockResolvedValue({ data: { role: 'student', school_id: 's1' }, error: null });
    const { GET } = await import('@/app/api/teacher/google/courses/route');
    expect((await GET(req())).status).toBe(403);
  });
  it('returns the paginated course list', async () => {
    getValid.mockResolvedValue('AT');
    listCourses.mockResolvedValue([{ id: 'c1', name: 'Math', section: 'A', enrollmentCode: 'z' }]);
    const { GET } = await import('@/app/api/teacher/google/courses/route');
    const body = await (await GET(req())).json();
    expect(body.courses).toHaveLength(1);
    expect(body.courses[0].id).toBe('c1');
  });
  it('connected:false on GoogleNotConnectedError', async () => {
    const { GoogleNotConnectedError } = await import('@/lib/google/tokens');
    getValid.mockRejectedValue(new GoogleNotConnectedError());
    const { GET } = await import('@/app/api/teacher/google/courses/route');
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: false });
  });
  it('needsReconnect:true on GoogleScopeError', async () => {
    getValid.mockResolvedValue('AT');
    const { GoogleScopeError } = await import('@/lib/google/classroom');
    listCourses.mockRejectedValue(new GoogleScopeError());
    const { GET } = await import('@/app/api/teacher/google/courses/route');
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: true, needsReconnect: true });
  });
  it('500 enveloped (no raw leak) on an unexpected error', async () => {
    getValid.mockResolvedValue('AT');
    listCourses.mockRejectedValue(new Error('internal google detail'));
    const { GET } = await import('@/app/api/teacher/google/courses/route');
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('internal google detail');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** — `src/app/api/teacher/google/courses/route.ts`

```typescript
// GET /api/teacher/google/courses — the connected teacher's active GC courses (paginated).
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { getValidAccessTokenForTeacher, GoogleNotConnectedError } from '@/lib/google/tokens';
import { listCourses, GoogleScopeError } from '@/lib/google/classroom';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  if ((profile?.role ?? null) !== 'teacher') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createAdminSupabaseClient();
  try {
    const accessToken = await getValidAccessTokenForTeacher(admin, user.id);
    const courses = await listCourses(accessToken);
    return NextResponse.json({ courses });
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) return NextResponse.json({ connected: false });
    if (err instanceof GoogleScopeError) return NextResponse.json({ connected: true, needsReconnect: true });
    console.error('[gc] courses list failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests** — PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit** — `git add src/app/api/teacher/google/courses && git commit -m "feat(gc): courses route (paginated list + reconnect surfacing)"`

---

### Task 7: Roster route — `GET /api/teacher/google/roster?courseId=…`

**Files:**
- Create: `src/app/api/teacher/google/roster/route.ts`
- Create: `src/app/api/teacher/google/roster/__tests__/route.test.ts`

**Interfaces:**
- Consumes: auth chain, `getValidAccessTokenForTeacher`/`GoogleNotConnectedError`, `listCourseStudents`/`GoogleScopeError`, admin client.
- Produces: `GET` → 400 if `courseId` missing; 401/403 gated; `{ connected:false }` / `{ connected:true, needsReconnect:true }` on the typed errors; else `{ students: Array<GcStudent & { existsInCore: boolean }> }`. `existsInCore` = the lowercased email is already a `student` in the teacher's school (the review-only preview annotation). No raw error leak.

- [ ] **Step 1: Write the failing test** — `src/app/api/teacher/google/roster/__tests__/route.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const single = vi.fn();
const getValid = vi.fn();
const listCourseStudents = vi.fn();
const existing = vi.fn();   // admin users select for existsInCore
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }),
  createAdminSupabaseClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ in: existing }) }) }) }),
  }),
}));
vi.mock('@/lib/google/tokens', async () => {
  class GoogleNotConnectedError extends Error {}
  return { getValidAccessTokenForTeacher: (...a: unknown[]) => getValid(...a), GoogleNotConnectedError };
});
vi.mock('@/lib/google/classroom', async () => {
  class GoogleScopeError extends Error {}
  return { listCourseStudents: (...a: unknown[]) => listCourseStudents(...a), GoogleScopeError };
});
beforeEach(() => {
  for (const m of [getUser, single, getValid, listCourseStudents, existing]) m.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  single.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' }, error: null });
  existing.mockResolvedValue({ data: [{ email: 'a@b.edu' }], error: null });
});
const req = (qs = '?courseId=c1') => new NextRequest(`http://x/api/teacher/google/roster${qs}`);

describe('GET /api/teacher/google/roster', () => {
  it('400 without courseId', async () => {
    const { GET } = await import('@/app/api/teacher/google/roster/route');
    expect((await GET(req(''))).status).toBe(400);
  });
  it('403 for a non-teacher', async () => {
    single.mockResolvedValue({ data: { role: 'student', school_id: 's1' }, error: null });
    const { GET } = await import('@/app/api/teacher/google/roster/route');
    expect((await GET(req())).status).toBe(403);
  });
  it('annotates existsInCore by lowercased email', async () => {
    getValid.mockResolvedValue('AT');
    listCourseStudents.mockResolvedValue({ complete: true, students: [
      { googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null },
      { googleId: 'g2', name: 'B', email: 'b@b.edu', photoUrl: null },
    ] });
    const { GET } = await import('@/app/api/teacher/google/roster/route');
    const body = await (await GET(req())).json();
    expect(body.students[0]).toMatchObject({ googleId: 'g1', existsInCore: true });
    expect(body.students[1]).toMatchObject({ googleId: 'g2', existsInCore: false });
  });
  it('connected:false on GoogleNotConnectedError', async () => {
    const { GoogleNotConnectedError } = await import('@/lib/google/tokens');
    getValid.mockRejectedValue(new GoogleNotConnectedError());
    const { GET } = await import('@/app/api/teacher/google/roster/route');
    expect(await (await GET(req())).json()).toEqual({ connected: false });
  });
  it('needsReconnect on GoogleScopeError', async () => {
    getValid.mockResolvedValue('AT');
    const { GoogleScopeError } = await import('@/lib/google/classroom');
    listCourseStudents.mockRejectedValue(new GoogleScopeError());
    const { GET } = await import('@/app/api/teacher/google/roster/route');
    expect(await (await GET(req())).json()).toEqual({ connected: true, needsReconnect: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** — `src/app/api/teacher/google/roster/route.ts`

```typescript
// GET /api/teacher/google/roster?courseId=… — the GC roster for a course (paginated) annotated
// with existsInCore for the review-only preview. The teacherId=me GC filter + the teacher's own
// token IS the access boundary (no CORE class row exists yet for a not-yet-imported course).
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { getValidAccessTokenForTeacher, GoogleNotConnectedError } from '@/lib/google/tokens';
import { listCourseStudents, GoogleScopeError } from '@/lib/google/classroom';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  if ((profile?.role ?? null) !== 'teacher') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const courseId = new URL(req.url).searchParams.get('courseId');
  if (!courseId) return NextResponse.json({ error: 'courseId required' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  try {
    const accessToken = await getValidAccessTokenForTeacher(admin, user.id);
    const { students } = await listCourseStudents(accessToken, courseId);   // {students, complete}; preview ignores `complete`

    const emails = students.map((s) => s.email).filter(Boolean);
    const existing = new Set<string>();
    if (emails.length && profile?.school_id) {
      const { data } = await admin.from('users').select('email').eq('school_id', profile.school_id).eq('role', 'student').in('email', emails);
      for (const row of (data as Array<{ email: string }> | null) ?? []) existing.add(row.email.toLowerCase());
    }
    return NextResponse.json({ students: students.map((s) => ({ ...s, existsInCore: existing.has(s.email) })) });
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) return NextResponse.json({ connected: false });
    if (err instanceof GoogleScopeError) return NextResponse.json({ connected: true, needsReconnect: true });
    console.error('[gc] roster fetch failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
```

> Note: the `existsInCore` email match uses `.in('email', emails)` (the GC emails are already lowercased by the adapter) then a lowercased `Set` — case-insensitivity is preserved on the CORE side via the `Set` lowercasing.

- [ ] **Step 4: Run tests** — PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit** — `git add src/app/api/teacher/google/roster && git commit -m "feat(gc): roster route (paginated + existsInCore preview annotation)"`

---

### Task 8: Import-roster route — `POST /api/teacher/google/import-roster`

**Files:**
- Create: `src/app/api/teacher/google/import-roster/route.ts`
- Create: `src/app/api/teacher/google/import-roster/__tests__/route.test.ts`

**Interfaces:**
- Consumes: auth chain, admin client, `reconcileCourseRoster` (Task 5), `GoogleNotConnectedError`/`GoogleScopeError`.
- Produces: `POST` body `{ courseId: string; name: string; subject?: string; gradeLevel?: string }`. NEVER trusts a client student list — the engine RE-FETCHES the roster. Flow: 401/403 gate → resolve `school_id` → **class upsert by `(school_id, google_course_id)`** (pre-query `.maybeSingle()` selecting `id, teacher_id`; if found → **require `existing.teacher_id === user.id`** (IMP-6 — else a generic 403, engine NOT called: with the new `UNIQUE(school_id, google_course_id)`, a same-school teacher B must not re-point teacher A's class to B's token), then UPDATE `name` only, **never `subject`/`grade_level` on re-import** so a teacher edit survives; if new → INSERT `{ name, subject, grade_level, teacher_id, school_id, google_course_id, is_active:true }`) → `reconcileCourseRoster(admin, { teacherId:user.id, schoolId, googleCourseId:courseId, classId })` → respond `{ classId, ...result }`. Typed errors → reconnect signal. No raw error leak.

- [ ] **Step 1: Write the failing test** — `src/app/api/teacher/google/import-roster/__tests__/route.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const single = vi.fn();
const reconcile = vi.fn();
const existingClass = vi.fn();   // classes.maybeSingle()
const classUpdate = vi.fn();
const classInsert = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'classes') return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: existingClass }) }) }),
        update: (v: unknown) => { classUpdate(v); return { eq: () => ({ eq: async () => ({ error: null }) }) }; },
        insert: (v: unknown) => { classInsert(v); return { select: () => ({ single: async () => ({ data: { id: 'newCls' }, error: null }) }) }; },
      };
      return {};
    },
  }),
}));
vi.mock('@/lib/google/reconcileCourseRoster', () => ({ reconcileCourseRoster: (...a: unknown[]) => reconcile(...a) }));
vi.mock('@/lib/google/tokens', async () => { class GoogleNotConnectedError extends Error {} return { GoogleNotConnectedError }; });
vi.mock('@/lib/google/classroom', async () => { class GoogleScopeError extends Error {} return { GoogleScopeError }; });

beforeEach(() => {
  for (const m of [getUser, single, reconcile, existingClass, classUpdate, classInsert]) m.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  single.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' }, error: null });
  existingClass.mockResolvedValue({ data: null, error: null });
  reconcile.mockResolvedValue({ created: 2, linked: 1, skippedNoEmail: 1, skippedOther: 0, enrolled: 3, reactivated: 0, softRemoved: 0, errors: 0, removeSkippedSuspectEmpty: false });
});
function req(body: object) {
  return new NextRequest('http://x/api/teacher/google/import-roster', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}

describe('POST /api/teacher/google/import-roster', () => {
  it('403 for a non-teacher', async () => {
    single.mockResolvedValue({ data: { role: 'student', school_id: 's1' }, error: null });
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    expect((await POST(req({ courseId: 'c1', name: 'Math' }))).status).toBe(403);
  });
  it('400 without courseId/name', async () => {
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    expect((await POST(req({ courseId: 'c1' }))).status).toBe(400);
  });
  it('inserts a new class with teacher-confirmed subject/grade then reconciles', async () => {
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    const body = await (await POST(req({ courseId: 'c1', name: 'Math', subject: 'Math', gradeLevel: '8' }))).json();
    expect(classInsert).toHaveBeenCalledWith(expect.objectContaining({ google_course_id: 'c1', teacher_id: 'u1', school_id: 's1', subject: 'Math', grade_level: '8', name: 'Math' }));
    expect(reconcile).toHaveBeenCalledWith(expect.anything(), { teacherId: 'u1', schoolId: 's1', googleCourseId: 'c1', classId: 'newCls' });
    expect(body).toMatchObject({ classId: 'newCls', created: 2, linked: 1, skippedNoEmail: 1 });
  });
  it('on re-import (by the OWNING teacher) updates name only — NEVER overwrites teacher-edited subject/grade', async () => {
    existingClass.mockResolvedValue({ data: { id: 'oldCls', teacher_id: 'u1' }, error: null });   // u1 owns it
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    await POST(req({ courseId: 'c1', name: 'Math 2', subject: 'Science', gradeLevel: '9' }));
    const updateArg = classUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect('subject' in updateArg).toBe(false);
    expect('grade_level' in updateArg).toBe(false);
    expect(updateArg.name).toBe('Math 2');
    expect(reconcile).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ classId: 'oldCls' }));
  });
  it('IMP-6: a different same-school teacher re-importing an already-imported course → 403, engine NOT called', async () => {
    existingClass.mockResolvedValue({ data: { id: 'oldCls', teacher_id: 'otherTeacher' }, error: null });   // owned by someone else
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    const res = await POST(req({ courseId: 'c1', name: 'Math', subject: 'Math', gradeLevel: '8' }));
    expect(res.status).toBe(403);
    expect(reconcile).not.toHaveBeenCalled();
    expect(classUpdate).not.toHaveBeenCalled();
  });
  it('connected:false on GoogleNotConnectedError from the engine', async () => {
    const { GoogleNotConnectedError } = await import('@/lib/google/tokens');
    reconcile.mockRejectedValue(new GoogleNotConnectedError());
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    expect(await (await POST(req({ courseId: 'c1', name: 'Math' }))).json()).toEqual({ connected: false });
  });
  it('500 enveloped (no raw leak) on an unexpected engine error', async () => {
    reconcile.mockRejectedValue(new Error('secret db detail'));
    const { POST } = await import('@/app/api/teacher/google/import-roster/route');
    const res = await POST(req({ courseId: 'c1', name: 'Math' }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret db detail');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** — `src/app/api/teacher/google/import-roster/route.ts`

```typescript
// POST /api/teacher/google/import-roster — class upsert by (school_id, google_course_id) then the
// shared reconcile engine. RE-FETCHES the GC roster server-side (never trusts a client student
// list). Re-import updates the class NAME only — a teacher-edited subject/grade is preserved.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { reconcileCourseRoster } from '@/lib/google/reconcileCourseRoster';
import { GoogleNotConnectedError } from '@/lib/google/tokens';
import { GoogleScopeError } from '@/lib/google/classroom';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  if ((profile?.role ?? null) !== 'teacher') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const schoolId = profile?.school_id ?? null;
  if (!schoolId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { courseId?: string; name?: string; subject?: string; gradeLevel?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad Request' }, { status: 400 }); }
  const courseId = (body.courseId ?? '').trim();
  const name = (body.name ?? '').trim();
  if (!courseId || !name) return NextResponse.json({ error: 'courseId and name required' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  try {
    // Class upsert by (school_id, google_course_id). Re-import: update NAME only (preserve a
    // teacher-edited subject/grade). New: set subject/grade from the teacher-confirmed preview.
    const { data: existing } = await admin.from('classes').select('id, teacher_id').eq('school_id', schoolId).eq('google_course_id', courseId).maybeSingle();
    let classId: string;
    if (existing) {
      // IMP-6: this course is already imported. ONLY its teacher-of-record may re-import it — else
      // teacher B could re-point teacher A's class to B's Google token. Generic 403; engine not called.
      if (existing.teacher_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      classId = existing.id as string;
      await admin.from('classes').update({ name }).eq('school_id', schoolId).eq('google_course_id', courseId);
    } else {
      const { data: created, error: insErr } = await admin.from('classes').insert({
        name, subject: body.subject ?? null, grade_level: body.gradeLevel ?? null,
        teacher_id: user.id, school_id: schoolId, google_course_id: courseId, is_active: true,
      }).select('id').single();
      if (insErr || !created) return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
      classId = created.id as string;
    }

    const result = await reconcileCourseRoster(admin, { teacherId: user.id, schoolId, googleCourseId: courseId, classId });
    return NextResponse.json({ classId, ...result });
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) return NextResponse.json({ connected: false });
    if (err instanceof GoogleScopeError) return NextResponse.json({ connected: true, needsReconnect: true });
    console.error('[gc] import-roster failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests** — PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit** — `git add src/app/api/teacher/google/import-roster && git commit -m "feat(gc): import-roster route (class upsert + server-side re-fetch + reconcile)"`

---

### Task 9: Sync-now route — `POST /api/teacher/google/sync`

**Files:**
- Create: `src/app/api/teacher/google/sync/route.ts`
- Create: `src/app/api/teacher/google/sync/__tests__/route.test.ts`

**Interfaces:**
- Consumes: auth chain, `guardClassAccess` (`src/lib/auth/guards.ts`), admin client, `reconcileCourseRoster`, typed errors.
- Produces: `POST` body `{ classId: string }`. 401/403 gate → **`guardClassAccess(classId)`** — the REAL contract (confirmed in `src/lib/auth/guards.ts:68`): `Promise<NextResponse | null>`, **`null` = proceed, a returned `NextResponse` = deny (already a 401/403; return it as-is — it returns 403 not 404 on a missing class so existence is not leaked).** Use `const denied = await guardClassAccess(classId); if (denied) return denied;`. Then load the class (`id, teacher_id, school_id, google_course_id`) → 400 if no `google_course_id` (not a GC-mirrored class) → `reconcileCourseRoster(admin, { teacherId:class.teacher_id, schoolId:class.school_id, googleCourseId:class.google_course_id, classId })` → `{ classId, ...result }`. Typed errors → reconnect signal; no raw leak.

> Note: the engine runs as `class.teacher_id` (the teacher-of-record whose Google grant owns the course) even when a same-school admin triggers the sync — the token vault is per-teacher.

- [ ] **Step 1: Write the failing test** — `src/app/api/teacher/google/sync/__tests__/route.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const getUser = vi.fn();
const single = vi.fn();
const classRow = vi.fn();    // classes.maybeSingle()
const guard = vi.fn();
const reconcile = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }),
  createAdminSupabaseClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: classRow }) }) }) }),
}));
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess: (...a: unknown[]) => guard(...a) }));
vi.mock('@/lib/google/reconcileCourseRoster', () => ({ reconcileCourseRoster: (...a: unknown[]) => reconcile(...a) }));
vi.mock('@/lib/google/tokens', async () => { class GoogleNotConnectedError extends Error {} return { GoogleNotConnectedError }; });
vi.mock('@/lib/google/classroom', async () => { class GoogleScopeError extends Error {} return { GoogleScopeError }; });

beforeEach(() => {
  for (const m of [getUser, single, classRow, guard, reconcile]) m.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  single.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' }, error: null });
  classRow.mockResolvedValue({ data: { id: 'cl1', teacher_id: 't1', school_id: 's1', google_course_id: 'c1' }, error: null });
  // REAL guardClassAccess contract: null = proceed; a NextResponse = deny. Default: allow.
  guard.mockResolvedValue(null);
  reconcile.mockResolvedValue({ created: 0, linked: 3, skippedNoEmail: 0, skippedOther: 0, enrolled: 0, reactivated: 1, softRemoved: 1, errors: 0, removeSkippedSuspectEmpty: false });
});
const req = (body: object) => new NextRequest('http://x/api/teacher/google/sync', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe('POST /api/teacher/google/sync', () => {
  it('400 without classId', async () => {
    const { POST } = await import('@/app/api/teacher/google/sync/route');
    expect((await POST(req({}))).status).toBe(400);
  });
  it('returns the guard NextResponse as-is when guardClassAccess denies (403), engine NOT called', async () => {
    guard.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const { POST } = await import('@/app/api/teacher/google/sync/route');
    expect((await POST(req({ classId: 'cl1' }))).status).toBe(403);
    expect(reconcile).not.toHaveBeenCalled();
  });
  it('400 when the class is not GC-mirrored (no google_course_id)', async () => {
    classRow.mockResolvedValue({ data: { id: 'cl1', teacher_id: 't1', school_id: 's1', google_course_id: null }, error: null });
    const { POST } = await import('@/app/api/teacher/google/sync/route');
    expect((await POST(req({ classId: 'cl1' }))).status).toBe(400);
  });
  it('reconciles as the teacher-of-record and returns the result', async () => {
    const { POST } = await import('@/app/api/teacher/google/sync/route');
    const body = await (await POST(req({ classId: 'cl1' }))).json();
    expect(reconcile).toHaveBeenCalledWith(expect.anything(), { teacherId: 't1', schoolId: 's1', googleCourseId: 'c1', classId: 'cl1' });
    expect(body).toMatchObject({ classId: 'cl1', linked: 3, softRemoved: 1, reactivated: 1 });
  });
  it('connected:false on GoogleNotConnectedError', async () => {
    const { GoogleNotConnectedError } = await import('@/lib/google/tokens');
    reconcile.mockRejectedValue(new GoogleNotConnectedError());
    const { POST } = await import('@/app/api/teacher/google/sync/route');
    expect(await (await POST(req({ classId: 'cl1' }))).json()).toEqual({ connected: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** — `src/app/api/teacher/google/sync/route.ts`

```typescript
// POST /api/teacher/google/sync — on-demand "Sync now" for one already-imported GC-mirrored class.
// guardClassAccess gates the class by id; the reconcile runs as the class's teacher-of-record
// (the per-teacher Google grant owns the course), even if a same-school admin triggers it.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardClassAccess } from '@/lib/auth/guards';
import { reconcileCourseRoster } from '@/lib/google/reconcileCourseRoster';
import { GoogleNotConnectedError } from '@/lib/google/tokens';
import { GoogleScopeError } from '@/lib/google/classroom';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  if ((profile?.role ?? null) !== 'teacher') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { classId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad Request' }, { status: 400 }); }
  const classId = (body.classId ?? '').trim();
  if (!classId) return NextResponse.json({ error: 'classId required' }, { status: 400 });

  // REAL guardClassAccess contract (src/lib/auth/guards.ts:68): Promise<NextResponse | null> —
  // null = proceed, a NextResponse = deny (already 401/403; 403-not-404 on a missing class).
  const denied = await guardClassAccess(classId);
  if (denied) return denied;

  const admin = createAdminSupabaseClient();
  const { data: cls } = await admin.from('classes').select('id, teacher_id, school_id, google_course_id').eq('id', classId).maybeSingle();
  if (!cls) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!cls.google_course_id) return NextResponse.json({ error: 'Not a Google-mirrored class' }, { status: 400 });

  try {
    const result = await reconcileCourseRoster(admin, {
      teacherId: cls.teacher_id as string, schoolId: cls.school_id as string,
      googleCourseId: cls.google_course_id as string, classId,
    });
    return NextResponse.json({ classId, ...result });
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) return NextResponse.json({ connected: false });
    if (err instanceof GoogleScopeError) return NextResponse.json({ connected: true, needsReconnect: true });
    console.error('[gc] sync failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
```

> Note: `guardClassAccess` is mocked as a unit in the test (`null` allow / `NextResponse` deny — the real contract). The route's own `admin.from('classes').select('id, teacher_id, school_id, google_course_id')…maybeSingle()` is the only admin DB read the test fakes; the IDOR decision is `guardClassAccess`'s, returned verbatim.

- [ ] **Step 4: Run tests** — PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit** — `git add src/app/api/teacher/google/sync && git commit -m "feat(gc): sync-now route (guardClassAccess + reconcile as teacher-of-record)"`

---

### Task 10: Nightly cron — `POST /api/cron/gc-roster-sync` + Vercel schedule

**Files:**
- Create: `src/app/api/cron/gc-roster-sync/route.ts`
- Create: `src/app/api/cron/gc-roster-sync/__tests__/route.test.ts`
- Modify: `vercel.json` (add the cron entry)

**Interfaces:**
- Consumes: `CRON_SECRET` (timing-safe, dual-accept: `Authorization: Bearer <secret>` OR `x-cron-secret`), `node:crypto` `timingSafeEqual`, admin client, `reconcileCourseRoster`.
- Produces: `POST` → 401 unless the presented secret matches `process.env.CRON_SECRET` via a length-checked `timingSafeEqual` (IMP-8). Iterates ALL `google_connections` (`user_id, school_id`), **ordered stably by `connected_at`** (MIN-2 — so coverage rotates and the tail is not always the one truncated). For each, loads that teacher's GC-mirrored classes (`classes` where `teacher_id=user_id` AND `google_course_id IS NOT NULL`), **selecting the class's own `school_id`** and passing the **CLASS's** `school_id` into the engine (IMP-7 — the class is the authority for the enrollment's tenant; do NOT pass the connection's `school_id`). For each class calls `reconcileCourseRoster`. **PER-TEACHER (per-class) isolation:** a grant-level failure — `GoogleNotConnectedError`, `GoogleScopeError`, **OR a plain `Error` whose message matches `/token refresh failed/i`** (IMP-10) — flags the teacher for reconnect (one entry) and `break`s out of that teacher's remaining classes; any OTHER throw → `errors++`, log, CONTINUE. **Wall-clock budget (MIN-2):** track elapsed against a budget under `maxDuration`; on overrun stop cleanly, `console.warn`, and return `truncated:true` + a remaining-connection count. `export const maxDuration = 300;` (the warranted exception to the global "don't add runtime" rule — voice routes already use `maxDuration=60`). Returns `{ ok:true, teachers:n, classes:n, reconciled:n, flaggedReconnect: Array<{ teacherId, reason }>, errors:n, truncated:boolean, remaining:n }` (MIN-5 — carry the reason; `connected:false` vs scope vs refresh-fail). `GET` delegates to `POST` (matches the repo cron pattern).

- [ ] **Step 1: Write the failing test** — `src/app/api/cron/gc-roster-sync/__tests__/route.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const reconcile = vi.fn();
const connectionsList = vi.fn();   // google_connections select (ordered)
const classesFor = vi.fn();        // classes select by teacher

vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'google_connections') {
        // select('user_id, school_id').order('connected_at') -> rows
        return { select: () => ({ order: () => ({ then: (r: (v: { data: unknown; error: null }) => unknown) => r({ data: connectionsList(), error: null }) }) }) };
      }
      // classes: select('id, google_course_id, school_id').eq(teacher).not(google_course_id) -> rows
      return { select: () => ({ eq: () => ({ not: () => ({ then: (r: (v: { data: unknown; error: null }) => unknown) => r({ data: classesFor(), error: null }) }) }) }) };
    },
  }),
}));
vi.mock('@/lib/google/reconcileCourseRoster', () => ({ reconcileCourseRoster: (...a: unknown[]) => reconcile(...a) }));
vi.mock('@/lib/google/tokens', async () => { class GoogleNotConnectedError extends Error {} return { GoogleNotConnectedError }; });
vi.mock('@/lib/google/classroom', async () => { class GoogleScopeError extends Error {} return { GoogleScopeError }; });

const RESULT = { created: 0, linked: 1, skippedNoEmail: 0, skippedOther: 0, enrolled: 0, reactivated: 0, softRemoved: 0, errors: 0, removeSkippedSuspectEmpty: false };

beforeEach(() => {
  process.env.CRON_SECRET = 'sek';
  reconcile.mockReset(); connectionsList.mockReset(); classesFor.mockReset();
  reconcile.mockResolvedValue(RESULT);
});
function req(opts: { bearer?: string; xheader?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  if (opts.xheader) headers['x-cron-secret'] = opts.xheader;
  return new NextRequest('http://x/api/cron/gc-roster-sync', { method: 'POST', headers });
}

describe('POST /api/cron/gc-roster-sync', () => {
  it('401 without the cron secret', async () => {
    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    expect((await POST(req())).status).toBe(401);
  });
  it('401 with a wrong secret', async () => {
    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    expect((await POST(req({ xheader: 'nope' }))).status).toBe(401);
  });
  it('accepts the x-cron-secret header', async () => {
    connectionsList.mockReturnValue([]);
    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    expect((await POST(req({ xheader: 'sek' }))).status).toBe(200);
  });
  it('accepts the Authorization: Bearer header (Vercel Cron mechanism — IMP-8)', async () => {
    connectionsList.mockReturnValue([]);
    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    expect((await POST(req({ bearer: 'sek' }))).status).toBe(200);
  });
  it('reconciles every GC-mirrored class, passing the CLASS school_id (IMP-7)', async () => {
    connectionsList.mockReturnValue([{ user_id: 't1', school_id: 'connSchool' }, { user_id: 't2', school_id: 's2' }]);
    classesFor
      .mockReturnValueOnce([{ id: 'cl1', google_course_id: 'c1', school_id: 'classSchool' }])   // t1 — class school DIFFERS from conn
      .mockReturnValueOnce([{ id: 'cl2', google_course_id: 'c2', school_id: 's2' }]);            // t2
    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    const body = await (await POST(req({ xheader: 'sek' }))).json();
    expect(reconcile).toHaveBeenCalledTimes(2);
    // the CLASS's school_id is passed, NOT the connection's:
    expect(reconcile).toHaveBeenCalledWith(expect.anything(), { teacherId: 't1', schoolId: 'classSchool', googleCourseId: 'c1', classId: 'cl1' });
    expect(body).toMatchObject({ ok: true, teachers: 2, classes: 2, reconciled: 2, errors: 0, truncated: false });
  });
  it('isolates a bad/revoked connection: flags reconnect (with reason), does NOT abort the run', async () => {
    connectionsList.mockReturnValue([{ user_id: 't1', school_id: 's1' }, { user_id: 't2', school_id: 's2' }]);
    classesFor
      .mockReturnValueOnce([{ id: 'cl1', google_course_id: 'c1', school_id: 's1' }])
      .mockReturnValueOnce([{ id: 'cl2', google_course_id: 'c2', school_id: 's2' }]);
    const { GoogleNotConnectedError } = await import('@/lib/google/tokens');
    reconcile
      .mockRejectedValueOnce(new GoogleNotConnectedError())   // t1 revoked
      .mockResolvedValueOnce(RESULT);                         // t2 ok
    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    const body = await (await POST(req({ xheader: 'sek' }))).json();
    expect(reconcile).toHaveBeenCalledTimes(2);    // did NOT abort after t1 threw
    expect(body.ok).toBe(true);
    expect(body.reconciled).toBe(1);
    expect(body.flaggedReconnect).toContainEqual({ teacherId: 't1', reason: 'not_connected' });
    expect(body.errors).toBe(0);   // a not-connected is a flag, not a hard error
  });
  it('treats a token-refresh failure as grant-level: flags reconnect + breaks (IMP-10), one entry not N', async () => {
    connectionsList.mockReturnValue([{ user_id: 't1', school_id: 's1' }]);
    classesFor.mockReturnValueOnce([
      { id: 'cl1', google_course_id: 'c1', school_id: 's1' },
      { id: 'cl2', google_course_id: 'c2', school_id: 's1' },   // a second class for the same teacher
    ]);
    reconcile.mockRejectedValue(new Error('google token refresh failed: 400'));  // plain Error, not typed
    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    const body = await (await POST(req({ xheader: 'sek' }))).json();
    expect(reconcile).toHaveBeenCalledTimes(1);   // broke after the first class — did NOT re-hammer the refresh
    expect(body.flaggedReconnect).toContainEqual({ teacherId: 't1', reason: 'refresh_failed' });
    expect(body.errors).toBe(0);
  });
  it('a non-grant error increments errors and CONTINUES to the next class', async () => {
    connectionsList.mockReturnValue([{ user_id: 't1', school_id: 's1' }]);
    classesFor.mockReturnValueOnce([
      { id: 'cl1', google_course_id: 'c1', school_id: 's1' },
      { id: 'cl2', google_course_id: 'c2', school_id: 's1' },
    ]);
    reconcile.mockRejectedValueOnce(new Error('transient db blip')).mockResolvedValueOnce(RESULT);
    const { POST } = await import('@/app/api/cron/gc-roster-sync/route');
    const body = await (await POST(req({ xheader: 'sek' }))).json();
    expect(reconcile).toHaveBeenCalledTimes(2);   // did NOT break — continued to cl2
    expect(body.errors).toBe(1);
    expect(body.reconciled).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** — `src/app/api/cron/gc-roster-sync/route.ts`

```typescript
// POST /api/cron/gc-roster-sync — nightly Vercel Cron (vercel.json). Iterates every google_connection
// (stably ordered by connected_at so coverage rotates) and reconciles each teacher's GC-mirrored
// classes via the shared engine. CRON_SECRET-gated, TIMING-SAFE + DUAL-ACCEPT (Authorization: Bearer
// OR x-cron-secret — robust to whichever header the platform sends). PER-TEACHER & per-class
// isolation: a revoked/scope-missing/refresh-failed grant is flagged for reconnect (with a reason)
// and that teacher's remaining classes are skipped (break); any other error increments `errors` and
// CONTINUES — one bad token never aborts the sweep. Bounded by a wall-clock budget under maxDuration.
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { reconcileCourseRoster } from '@/lib/google/reconcileCourseRoster';
import { GoogleNotConnectedError } from '@/lib/google/tokens';
import { GoogleScopeError } from '@/lib/google/classroom';

// Vercel allows up to 300s; this is the warranted exception to the global "don't add runtime" rule
// (the voice routes already set maxDuration). Bounds a large multi-school nightly sweep (MIN-2).
export const maxDuration = 300;
const BUDGET_MS = 270_000;   // stop cleanly before the platform hard-kills at maxDuration

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

type ReconnectReason = 'not_connected' | 'scope' | 'refresh_failed';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  // Dual-accept: Authorization: Bearer <secret> (Vercel Cron default) OR x-cron-secret (repo pattern).
  const presented = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? req.headers.get('x-cron-secret') ?? '';
  if (!secret || !safeEq(presented, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminSupabaseClient();
  const { data: conns } = await admin.from('google_connections').select('user_id, school_id').order('connected_at', { ascending: true });
  const connections = (conns as Array<{ user_id: string; school_id: string | null }> | null) ?? [];

  let classesSeen = 0;
  let reconciled = 0;
  let errors = 0;
  let truncated = false;
  let processed = 0;   // connections fully processed (for the remaining count)
  const flaggedReconnect: Array<{ teacherId: string; reason: ReconnectReason }> = [];
  const startedAt = Date.now();

  for (const conn of connections) {
    if (Date.now() - startedAt > BUDGET_MS) {
      truncated = true;
      console.warn('[gc-cron] wall-clock budget reached — truncating; remaining connections:', connections.length - processed);
      break;
    }
    processed++;
    if (!conn.school_id) continue;   // a connection with no school cannot mint/scope students
    // Select the class's OWN school_id and pass IT to the engine (IMP-7 — the class is the tenant
    // authority, not the connection).
    const { data: cls } = await admin
      .from('classes')
      .select('id, google_course_id, school_id')
      .eq('teacher_id', conn.user_id)
      .not('google_course_id', 'is', null);
    const classes = (cls as Array<{ id: string; google_course_id: string; school_id: string | null }> | null) ?? [];
    for (const c of classes) {
      if (!c.school_id) continue;
      classesSeen++;
      try {
        await reconcileCourseRoster(admin, {
          teacherId: conn.user_id, schoolId: c.school_id,
          googleCourseId: c.google_course_id, classId: c.id,
        });
        reconciled++;
      } catch (err) {
        const reason = reconnectReason(err);
        if (reason) {
          flaggedReconnect.push({ teacherId: conn.user_id, reason });
          console.warn('[gc-cron] connection needs reconnect (skipped):', conn.user_id, reason);
          break;   // skip the rest of THIS teacher's classes — their grant is the problem
        }
        errors++;
        console.error('[gc-cron] class reconcile failed (continuing):', c.id, err instanceof Error ? err.message : 'unknown');
      }
    }
  }

  return NextResponse.json({
    ok: true, teachers: connections.length, classes: classesSeen, reconciled,
    flaggedReconnect, errors, truncated, remaining: connections.length - processed,
  });
}

// Classify a grant-level failure (flag-for-reconnect + break) vs a transient error (count + continue).
// A token-refresh HTTP failure throws a PLAIN Error('google token refresh failed: <status>') from the
// Seg-1 token manager — it is grant-level too (IMP-10), not a generic error.
function reconnectReason(err: unknown): ReconnectReason | null {
  if (err instanceof GoogleNotConnectedError) return 'not_connected';
  if (err instanceof GoogleScopeError) return 'scope';
  if (err instanceof Error && /token refresh failed/i.test(err.message)) return 'refresh_failed';
  return null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return POST(req);
}
```

- [ ] **Step 4: Add the Vercel cron schedule** — in `vercel.json`, append to the `crons` array a new entry (nightly at 04:00 UTC, off-peak from the existing 03:00 sweep):

```json
{ "path": "/api/cron/gc-roster-sync", "schedule": "0 4 * * *" }
```

> The route's dual-accept auth (IMP-8) accepts BOTH `Authorization: Bearer <CRON_SECRET>` (Vercel Cron's default) AND the repo's existing `x-cron-secret` header, so it authenticates regardless of which the platform sends. Setting `CRON_SECRET` in Vercel is an ops item — note it in the segment-end checklist.
>
> **NOTE (controller, ITEM B):** separately from Seg 2, the controller will verify that the existing repo crons (`idempotency-sweep`, `weekly-snapshot`) actually authenticate on schedule — those routes are `x-cron-secret`-only, and if Vercel sends `Authorization: Bearer` they may be silently failing their nightly auth. That verification is OUT OF SCOPE for Seg 2 (this route's dual-accept already makes it robust either way); it is flagged here as a follow-up, not a Seg-2 task.

- [ ] **Step 5: Run tests** — `npx vitest run src/app/api/cron/gc-roster-sync/__tests__/route.test.ts` → PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 6: Commit** — `git add src/app/api/cron/gc-roster-sync vercel.json && git commit -m "feat(gc): nightly roster-sync cron (CRON_SECRET + per-teacher isolation) + vercel schedule"`

---

### Task 11: Import wizard UI (select → review-only preview → import → done) + Sync-now control

**Files:**
- Create: `src/app/(teacher)/import/google/page.tsx` (server)
- Create: `src/app/(teacher)/import/google/_components/ImportWizard.tsx` (client)
- Create: `src/app/(teacher)/import/google/_components/SyncNowButton.tsx` (client)
- Create: `src/app/(teacher)/import/google/_components/__tests__/ImportWizard.test.tsx`
- Create: `src/app/(teacher)/import/google/_components/__tests__/SyncNowButton.test.tsx`

**Interfaces:**
- Consumes: `GET /api/teacher/google/courses`, `GET /api/teacher/google/roster?courseId=…`, `POST /api/teacher/google/import-roster`, `POST /api/teacher/google/sync`.
- Produces: `ImportWizard` — 4 steps: **select** (course list; `connected:false`/`needsReconnect` → a Reconnect CTA linking `/api/teacher/google/connect`), **preview** (REVIEW-ONLY: subject + grade inputs prefilled from course `name`/`section`, and three read-only tiles — new / already in CORE / skipped no-email — **no per-student pick-list**, no checkboxes; an Import button), **importing** (busy), **done** (Created / Linked / Skipped-no-email tiles + a "Sync now" control). `SyncNowButton` — POSTs `/api/teacher/google/sync` for a `classId`, shows the result counts. Token-only, deep-ink, `role="status"`.

- [ ] **Step 1: Write the failing tests**

`src/app/(teacher)/import/google/_components/__tests__/ImportWizard.test.tsx`:
```typescript
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImportWizard from '../ImportWizard';

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; vi.restoreAllMocks(); });

function route(map: Record<string, object>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(map).find((k) => url.includes(k))!;
    return new Response(JSON.stringify(map[key]), { status: 200 });
  }) as unknown as typeof fetch;
}

describe('ImportWizard', () => {
  it('shows a Reconnect CTA when not connected', async () => {
    route({ '/courses': { connected: false } });
    render(<ImportWizard />);
    await waitFor(() => expect(screen.getByRole('link', { name: /connect|reconnect/i })).toHaveAttribute('href', '/api/teacher/google/connect'));
  });
  it('lists courses and advances to a REVIEW-ONLY preview (no per-student checkboxes)', async () => {
    route({
      '/courses': { courses: [{ id: 'c1', name: 'Math', section: '1st', enrollmentCode: 'z' }] },
      '/roster': { students: [
        { googleId: 'g1', name: 'A', email: 'a@b.edu', existsInCore: true },
        { googleId: 'g2', name: 'B', email: 'b@b.edu', existsInCore: false },
        { googleId: 'g3', name: 'C', email: '', existsInCore: false },
      ] },
    });
    render(<ImportWizard />);
    await waitFor(() => screen.getByText('Math'));
    fireEvent.click(screen.getByRole('button', { name: /math/i }));
    await waitFor(() => expect(screen.getByText(/review/i)).toBeInTheDocument());
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);        // review-only — no pick-list
    expect(screen.getByText(/1.*already in core/i)).toBeInTheDocument();
    expect(screen.getByText(/1.*new/i)).toBeInTheDocument();
    expect(screen.getByText(/1.*no email/i)).toBeInTheDocument();
  });
  it('imports and shows the done tiles', async () => {
    route({
      '/courses': { courses: [{ id: 'c1', name: 'Math', section: '1st', enrollmentCode: 'z' }] },
      '/roster': { students: [{ googleId: 'g1', name: 'A', email: 'a@b.edu', existsInCore: false }] },
      '/import-roster': { classId: 'cl1', created: 1, linked: 0, skippedNoEmail: 0, skippedOther: 0, enrolled: 1, reactivated: 0, softRemoved: 0, errors: 0, removeSkippedSuspectEmpty: false },
    });
    render(<ImportWizard />);
    await waitFor(() => screen.getByText('Math'));
    fireEvent.click(screen.getByRole('button', { name: /math/i }));
    await waitFor(() => screen.getByRole('button', { name: /^import/i }));
    fireEvent.click(screen.getByRole('button', { name: /^import/i }));
    await waitFor(() => expect(screen.getByText(/created/i)).toBeInTheDocument());
    expect(screen.getByText(/1/)).toBeInTheDocument();
  });
});
```

`src/app/(teacher)/import/google/_components/__tests__/SyncNowButton.test.tsx`:
```typescript
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SyncNowButton from '../SyncNowButton';

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; vi.restoreAllMocks(); });

describe('SyncNowButton', () => {
  it('POSTs sync and reports the result counts', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ classId: 'cl1', created: 0, linked: 3, skippedNoEmail: 0, skippedOther: 0, enrolled: 0, reactivated: 1, softRemoved: 2 }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    render(<SyncNowButton classId="cl1" />);
    fireEvent.click(screen.getByRole('button', { name: /sync now/i }));
    await waitFor(() => expect(screen.getByText(/2.*no longer in this class/i)).toBeInTheDocument());
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).method).toBe('POST');
    expect(String((init as RequestInit).body)).toContain('cl1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — FAIL.

- [ ] **Step 3: Implement** — `SyncNowButton.tsx`, `ImportWizard.tsx`, then the page

```tsx
// src/app/(teacher)/import/google/_components/SyncNowButton.tsx
'use client';
// "Sync now" — re-runs the two-way reconcile for an already-imported GC class. Strings DRAFT → Barb.
import React, { useState } from 'react';

type Result = { created: number; linked: number; skippedNoEmail: number; reactivated: number; softRemoved: number } | null;

export default function SyncNowButton({ classId }: { classId: string }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  async function sync() {
    setBusy(true);
    try {
      const res = await fetch('/api/teacher/google/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ classId }) });
      setResult(await res.json());
    } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={sync} disabled={busy} className="inline-flex items-center rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
        {busy ? 'Syncing…' : 'Sync now'}
      </button>
      {result && (
        // DRAFT copy → Barb. Coach-posture: a roster change is an OBSERVATION, not an alarm — phrase
        // the soft-un-enroll as "no longer in this class", never "removed" (ITEM C / MIN-7).
        <p role="status" className="text-fg text-sm">
          {result.linked} kept · {result.created} new · {result.reactivated} re-added · {result.softRemoved} no longer in this class
        </p>
      )}
    </div>
  );
}
```

```tsx
// src/app/(teacher)/import/google/_components/ImportWizard.tsx
'use client';
// Google Classroom roster import wizard: select → REVIEW-ONLY preview → import → done.
// The preview is review-only (new / already-in-CORE / no-email tiles) — NOT a per-student pick-list.
// Every importable student is imported (the engine mirrors the full roster). Strings DRAFT → Barb.
import React, { useEffect, useState } from 'react';
import SyncNowButton from './SyncNowButton';

interface Course { id: string; name: string; section: string | null; enrollmentCode: string | null }
interface PreviewStudent { googleId: string; name: string; email: string; existsInCore: boolean }
interface ImportResult { classId: string; created: number; linked: number; skippedNoEmail: number; reactivated: number; softRemoved: number }

const linkCls = 'inline-flex items-center rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
const btnCls = 'inline-flex items-center rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

export default function ImportWizard(): React.JSX.Element {
  const [step, setStep] = useState<'select' | 'preview' | 'importing' | 'done'>('select');
  const [courses, setCourses] = useState<Course[]>([]);
  const [reconnect, setReconnect] = useState(false);
  const [course, setCourse] = useState<Course | null>(null);
  const [students, setStudents] = useState<PreviewStudent[]>([]);
  const [subject, setSubject] = useState('');
  const [grade, setGrade] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/teacher/google/courses').then((r) => r.json()).then((d) => {
      if (!alive) return;
      if (d.connected === false || d.needsReconnect) { setReconnect(true); return; }
      setCourses(d.courses ?? []);
    }).catch(() => { if (alive) setReconnect(true); });
    return () => { alive = false; };
  }, []);

  async function pickCourse(c: Course) {
    setCourse(c); setSubject(''); setGrade('');
    const d = await fetch(`/api/teacher/google/roster?courseId=${encodeURIComponent(c.id)}`).then((r) => r.json());
    if (d.connected === false || d.needsReconnect) { setReconnect(true); return; }
    setStudents(d.students ?? []);
    setStep('preview');
  }

  async function doImport() {
    if (!course) return;
    setStep('importing');
    const d: ImportResult = await fetch('/api/teacher/google/import-roster', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ courseId: course.id, name: course.name, subject, gradeLevel: grade }),
    }).then((r) => r.json());
    setResult(d); setStep('done');
  }

  if (reconnect) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border-2 border-sidebar-edge bg-surface p-5 shadow-sticker">
        <p role="status" className="text-fg text-sm">Connect Google Classroom to import a roster.</p>
        <a href="/api/teacher/google/connect" className={linkCls}>Connect Google Classroom</a>
      </div>
    );
  }

  const existing = students.filter((s) => s.email && s.existsInCore).length;
  const fresh = students.filter((s) => s.email && !s.existsInCore).length;
  const noEmail = students.filter((s) => !s.email).length;

  return (
    <div className="flex flex-col gap-4">
      {step === 'select' && (
        <div className="flex flex-col gap-2">
          <h2 className="font-display text-lg font-extrabold text-fg">Choose a class to import</h2>
          {courses.map((c) => (
            <button key={c.id} type="button" onClick={() => pickCourse(c)} className={btnCls + ' justify-start'}>
              {c.name}{c.section ? ` · ${c.section}` : ''}
            </button>
          ))}
        </div>
      )}
      {step === 'preview' && course && (
        <div className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-extrabold text-fg">Review {course.name}</h2>
          <label className="text-fg text-sm">Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 block w-full rounded-md border-2 border-sidebar-edge bg-surface px-3 py-2 text-fg" /></label>
          <label className="text-fg text-sm">Grade<input value={grade} onChange={(e) => setGrade(e.target.value)} className="mt-1 block w-full rounded-md border-2 border-sidebar-edge bg-surface px-3 py-2 text-fg" /></label>
          <ul className="text-fg text-sm">
            <li>{fresh} new</li>
            <li>{existing} already in CORE</li>
            <li>{noEmail} skipped — no email</li>
          </ul>
          <button type="button" onClick={doImport} className={linkCls}>Import roster</button>
        </div>
      )}
      {step === 'importing' && <p role="status" className="text-fg text-sm">Importing…</p>}
      {step === 'done' && result && (
        // ITEM C (intentional for the pilot): only the no-email skip is surfaced. The other skip
        // buckets (ambiguous / rebind / duplicate / seat-cap) and `errors` are deliberately NOT
        // shown to the teacher here — they are coach-posture noise for the pilot; revisit with Barb.
        <div className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-extrabold text-fg">Done</h2>
          <ul className="text-fg text-sm">
            <li>{result.created} created</li>
            <li>{result.linked} linked</li>
            <li>{result.skippedNoEmail} skipped — no email</li>
          </ul>
          <SyncNowButton classId={result.classId} />
        </div>
      )}
    </div>
  );
}
```

```tsx
// src/app/(teacher)/import/google/page.tsx
import ImportWizard from './_components/ImportWizard';

export default function GoogleImportPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <ImportWizard />
    </div>
  );
}
```

- [ ] **Step 4: Run tests** — `npx vitest run "src/app/(teacher)/import/google/_components/__tests__"` → PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Wire a nav/entry to the wizard** — add an "Import from Google" link on the existing `/settings/google` connect card (Seg 1's `GoogleConnectCard`) pointing to `/import/google`, shown when connected (no new sidebar group needed — the wizard is reached from the connect surface). Add the link text to the STRINGS section in Task 12. (If the card is awkward to extend, instead add a sidebar item under the existing SETTINGS group — plan decision at implementation; either path keeps the page reachable.)

- [ ] **Step 6: Commit** — `git add "src/app/(teacher)/import/google" && git commit -m "feat(gc): roster import wizard (review-only preview) + sync-now control"`

---

### Task 12: Shared error envelope + reconnect-CTA wiring + STRINGS drafts

**Files:**
- Create: `src/lib/google/errorEnvelope.ts`
- Create: `src/lib/google/__tests__/errorEnvelope.test.ts`
- Modify: the four routes from Tasks 6–9 to use the shared envelope helper (refactor the inline `catch` blocks)
- Modify: `STRINGS-FOR-BARB.md` (append `## Google Classroom — Seg 2 (roster import)`)

**Interfaces:**
- Produces: `gcErrorResponse(err: unknown): NextResponse` — `GoogleNotConnectedError` → `{ connected:false }` (200); `GoogleScopeError` → `{ connected:true, needsReconnect:true }` (200); anything else → `{ error:'Internal Server Error' }` (500) after a `console.error` of `err.message` only (NEVER the response body / NEVER returned to the client).

> Rationale: Tasks 6–9 each hand-rolled the same three-branch catch. This task extracts it to ONE helper so the envelope (and the no-raw-leak guarantee) is consistent and single-sourced. The route refactor must keep every existing route test green (the externally-observable responses are unchanged).

- [ ] **Step 1: Write the failing test** — `src/lib/google/__tests__/errorEnvelope.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { GoogleNotConnectedError } from '@/lib/google/tokens';
import { GoogleScopeError } from '@/lib/google/classroom';
import { gcErrorResponse } from '@/lib/google/errorEnvelope';

describe('gcErrorResponse', () => {
  it('maps GoogleNotConnectedError → 200 { connected:false }', async () => {
    const res = gcErrorResponse(new GoogleNotConnectedError());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: false });
  });
  it('maps GoogleScopeError → 200 { connected:true, needsReconnect:true }', async () => {
    const res = gcErrorResponse(new GoogleScopeError());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: true, needsReconnect: true });
  });
  it('maps anything else → 500 with NO raw error leak', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = gcErrorResponse(new Error('secret internal detail'));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret internal detail');
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** — `src/lib/google/errorEnvelope.ts`

```typescript
// src/lib/google/errorEnvelope.ts
// Single-sourced GC route error envelope. The two typed Google errors become connected/reconnect
// signals (HTTP 200, so the UI can branch on the body); anything else is a generic 500 with the
// raw message logged but NEVER returned (no raw-error-string leak — the V1 import-roster bug).
import { NextResponse } from 'next/server';
import { GoogleNotConnectedError } from '@/lib/google/tokens';
import { GoogleScopeError } from '@/lib/google/classroom';

export function gcErrorResponse(err: unknown): NextResponse {
  if (err instanceof GoogleNotConnectedError) return NextResponse.json({ connected: false });
  if (err instanceof GoogleScopeError) return NextResponse.json({ connected: true, needsReconnect: true });
  console.error('[gc] route error:', err instanceof Error ? err.message : 'unknown');
  return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
}
```

- [ ] **Step 4: Refactor Tasks 6–9 routes** — in `courses`, `roster`, `import-roster`, and `sync` routes, replace the inline three-branch `catch` body with `return gcErrorResponse(err);` (and `import { gcErrorResponse } from '@/lib/google/errorEnvelope';`). Re-run each route's test file — all stay green (responses unchanged).

- [ ] **Step 5: Append STRINGS** — to `STRINGS-FOR-BARB.md`, append a `## Google Classroom — Seg 2 (roster import)` section, clearly headed **DRAFT — Barb gates all copy**, listing: "Choose a class to import", "Review {course}", "Subject", "Grade", "{n} new", "{n} already in CORE", "{n} skipped — no email", "Import roster", "Importing…", "Done", "{n} created", "{n} linked", "Connect Google Classroom to import a roster.", "Connect Google Classroom", "Sync now", "Syncing…", "{n} kept · {n} new · {n} re-added · {n} no longer in this class". Flag the soft-un-enroll line specifically: the draft uses **"{n} no longer in this class"** NOT "{n} removed" (coach-posture: a roster change is an observation, not an alarm — ITEM C / MIN-7), and Barb to confirm the final phrasing. Note that the other skip buckets (ambiguous/rebind/duplicate/seat-cap) are intentionally NOT surfaced on the done screen for the pilot.

- [ ] **Step 6: Run tests + gates** — `npx vitest run src/lib/google src/app/api/teacher/google src/app/api/cron/gc-roster-sync` → all green. `npx tsc --noEmit` → 0.

- [ ] **Step 7: Commit** — `git add src/lib/google/errorEnvelope.ts src/lib/google/__tests__/errorEnvelope.test.ts src/app/api/teacher/google STRINGS-FOR-BARB.md && git commit -m "feat(gc): shared GC route error envelope (no raw leak) + STRINGS drafts"`

---

## Segment-end verification

- [ ] `npx tsc --noEmit` → 0
- [ ] `npx vitest run` → all green (record the count)
- [ ] `npm run build` → 0 (a11y + token gates pass)
- [ ] Whole-segment adversarial review (5-lens Workflow): (1) two-way reconcile safety (scope-to-one-class, manually-added students never touched, soft-not-hard removal, idempotency); (2) account-takeover/identity-write correctness (lowercased email, ambiguous/rebind skips, no-email count); (3) auth chain + IDOR (`role==='teacher'`, `guardClassAccess` on sync, server-side re-fetch, no client-trusted student list); (4) cron isolation (CRON_SECRET, per-teacher continue-on-error, no-abort); (5) error envelope / reconnect surfacing (no raw leak, typed-error → CTA on all routes). Fix confirmed Critical/Important, re-verify.
- [ ] Playwright preview of the wizard states (not-connected / select / review-only preview / done) + a Sync-now run for Marvin.
- [ ] Marvin merge call → merge → **then** apply migration 0024 with explicit authorization (FIRST run the Task 1 apply-gate duplicate-check; block if it returns rows — IMP-12) → deploy verify.
- [ ] **Ops (not Claude):** confirm `CRON_SECRET` is set in Vercel (the route's dual-accept handles either `Authorization: Bearer` or `x-cron-secret`); confirm the GC OAuth client + `GOOGLE_*` env from Seg 1 are live (Seg 2 cannot fetch GC without them). Separately (out of Seg 2, ITEM B): verify the existing `idempotency-sweep`/`weekly-snapshot` crons actually authenticate on schedule.

---

## Self-Review (vs the locked decisions §1–§12)

1. **Decision coverage:** mirror-full-roster review-only preview (#1) → Task 11 ✓; two-way sync add+soft-remove + per-class `source='google'` provenance + trustworthy-roster guard (#2 + item A + CRIT-2) → Task 5 ✓; ONE engine, THREE triggers, single-course push-ready signature (#3) → Tasks 5/8/9/10 ✓; nightly Vercel Cron + timing-safe dual-accept CRON_SECRET + per-teacher isolation (#4 + item B) → Task 10 ✓; migration 0024 additive/idempotent + email/last_seen_at + `enrollments.source` + classes uniqueness + static-text asserts (#5 + item A) → Task 1 ✓; write-free `resolveExternalIdentity` (#6) → Task 3 ✓; `ensureAuthUser` + generated password + account-takeover guard + skip/flag rules (incl. non-student-role collision + within-import dedupe) (#7) → Tasks 4/5 ✓; class upsert by google_course_id + teacher-of-record ownership check + no-overwrite of teacher-edited subject/grade (#8 + IMP-6) → Task 8 ✓; Open-CORE pin DEFERRED (#9) → not built ✓; pilot-wide no school gate (#10) → not wired ✓; auth chain + role==='teacher' + REAL guardClassAccess contract + server-side re-fetch + error envelope + reconnect CTA (#11 + CRIT-1) → Tasks 6–9, 12 ✓; paginated reads behind one adapter + discriminated `{students,complete}` + blank-userId skip + tokens only from the vault (#12 + CRIT-2 + IMP-11) → Task 2 ✓.
2. **YAGNI scan:** NO Pub/Sub/registrations (engine signature is push-ready, that is all); NO Open-CORE pin; NO `schools.google_classroom_enabled` school-gate wiring. ✓
3. **Placeholder scan:** no TBD / "handle errors" / "similar to Task N" — every step has complete test + impl code. ✓
4. **Type consistency:** `GcCourse`/`GcStudent`/`GcRoster {students,complete}` (Task 2) reused in Tasks 5/6/7/11; `LinkResult` (Task 4) consumed by Task 5; `ReconcileResult` (now `{created, linked, skippedNoEmail, skippedOther, enrolled, reactivated, softRemoved, errors, removeSkippedSuspectEmpty}`; Task 5) returned by Tasks 8/9/10 and rendered in Task 11; `GoogleScopeError`/`GoogleNotConnectedError` thrown in Tasks 2/Seg-1, caught in Tasks 6–10 + the Task 12 envelope. supabase-js `{error}` (not throw) branched in Task 5's enroll/un-enroll. ✓

## Notes for the controller — possible decision/grounding conflicts to resolve

(Returned in the agent's final message; see below.)
