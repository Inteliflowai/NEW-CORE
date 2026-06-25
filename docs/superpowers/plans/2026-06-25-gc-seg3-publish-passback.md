# GC Segment 3 — Publish + Draft Grade Passback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Publish CORE quizzes & assignments into the Google Classroom stream (each a DRAFT courseWork linking back into CORE), pin an "Open CORE" course material, and push teacher-controlled DRAFT grades for assignments back to Classroom — never auto-returned.

**Architecture:** Extend the existing zero-dep `classroom.ts` raw-fetch seam with POST/PATCH writers; two thin engines (`publishToClassroom`, `gradePassback`) called by two teacher routes that reuse the shipped GC auth chain + token vault + `resolveExternalIdentity` + `logAudit`. A new `google_publications` table maps CORE units ↔ GC courseWork.

**Tech Stack:** Next.js 16 route handlers, TypeScript strict, Vitest 4 (node for libs/routes; jsdom for the UI components), Supabase admin client (service-role).

> ### ⚠️ C1 — CORE has NO class-wide `assignments.id`. The assignment UNIT is the LESSON.
> Confirmed against `supabase/migrations/0004_assignments_homework.sql` (`assignments.student_id NOT NULL`, ON DELETE CASCADE → users) and `src/lib/gradebook/loadGradebook.ts` (the gradebook column key is `lesson:<lesson_id>:<assigned-day>`, lines 58–62, collapsing the per-student fan-out). `public.assignments` rows are a **PER-STUDENT fan-out** (one row per student per mastery band) — there is no single class-wide assignment id. Therefore **publish + passback for assignments are keyed on `lesson_id`**, never on an `assignmentId`:
> - **Publish** stores `google_publications.resource_id = lesson_id` for `resource_type='assignment'`.
> - **Passback** selects `assignments.id WHERE class_id=? AND lesson_id=?`, then `homework_attempts.in('assignment_id', thoseIds).eq('status','graded')`, building grade-by-student across the whole column (latest graded attempt per student, override-wins `teacher_score ?? score_pct`).
> - **Routes** take `{ classId, lessonId }`, never `{ assignmentId }`.
> - **Quizzes** are keyed on `quizzes.id` (the quiz IS a single class-wide row) — `resource_id = quiz_id`.

## Global Constraints
- **Teacher-controlled, never auto-return** — grade passback PATCHes `updateMask=draftGrade` ONLY (no `assignedGrade`, no `:return`). Binding posture.
- **Four-audience** — quizzes publish as a link but NEVER push a grade (diagnostic); only ASSIGNMENT earned-grades (`teacher_score ?? score_pct`, 0–100) pass back. [[v2-assignments-graded-vs-quizzes-coached]]
- **Publish state = DRAFT (LOCKED, Marvin 2026-06-25)** — `courseWork.state='DRAFT'` (the teacher reviews and Posts it inside Classroom; no surprise assignments). The Open-CORE course-material link is `'PUBLISHED'` (it's a course resource, not graded work). **Because DRAFT courseWork may yield no gradeable studentSubmissions until the teacher Posts it** (see C4 / the Task-0 spike), `gradePassback` MUST distinguish **"zero submissions exist for this courseWork yet"** (`not_posted_in_classroom`, surfaced as *"Post this assignment in Classroom first, then send grades"*) from per-student `skipped_not_linked`. We keep DRAFT and **guide the teacher**.
- **Fail-soft passback** — per-student try/catch; one student's failure never aborts the batch; record `last_sync_error`; return a `{ pushed, skipped_not_linked, not_posted_in_classroom, errors }` summary. A Google error never blocks CORE grading. **Per the spec (§2/§5 D4) the retry is honored:** each per-student PATCH is wrapped in a `[1s, 3s]` retry (two delays, three attempts), which **does NOT retry on `GoogleScopeError`** (a scope/auth failure is not transient → surfaces as reconnect). The batch stays **synchronous** (the route awaits it and returns the summary) — re-clicking "Send grades" is the idempotent retry for a whole-batch outage; the per-student `[1s,3s]` retry handles transient 5xx within the batch. (This reconciles I1: spec retry kept, `after()` not used — the summary must be returned to the teacher.)
- **Gated** — all GC publish/send controls hidden + routes 400 unless the class has `google_course_id`; passback skips students with no resolvable Google `external_identity` (reason `skipped_not_linked`), never hard-fails.
- **No new OAuth scopes** — `classroom.coursework.students` + `classroom.courseworkmaterials` already granted (Seg 1, confirmed in `config.ts`). Reuse `gcErrorResponse → needsReconnect` only as a rare-error fallback.
- **Auth chain unchanged** — `getUser → STAFF_ROLES → guardClassAccess → getValidAccessTokenForTeacher → admin client`; RLS is not the IDOR backstop (`guardClassAccess` is). The token fetch sits **inside** each route's try/catch so `GoogleNotConnectedError` → `gcErrorResponse({connected:false})`, not a 500 (M5).
- **`schoolId`/`teacherId` resolution** — both routes resolve the class row exactly as `google/sync/route.ts:32` (`admin.from('classes').select('id, teacher_id, school_id, google_course_id').eq('id', classId).maybeSingle()`) and use `cls.school_id` / `cls.teacher_id` (M6).
- **Audit** — `logAudit` on publish (`gc.publish`) + each passback batch (`gc.grade_passback`); actor = teacher, `school_id` stamped. `created_by: user.id` is threaded into the publish insert (M4).
- **No raw Google body leak** — writers throw status-only errors (mirror `gcGet`).
- **App base URL (C5)** — `src/lib/google/config.ts` exposes `APP_BASE_URL` = `(process.env.NEXT_PUBLIC_APP_URL || '').trim() || 'https://newcore.inteliflowai.com'`. The CORE links point at the **real, existing, login-gated app root** (`/`) — `${APP_BASE_URL}/?gc=<resourceType>&id=<resourceId>` for the unit link and `${APP_BASE_URL}/` for the Open-CORE pin. We do NOT invent a `/launch` route (that's a V1/Seg-4 concept). Seg 4 upgrades the *behavior* (silent SSO) at the same path, not the path.
- **Token-only UI**, no gold-plating (redesign on hold). **Gates:** tsc 0, vitest green, build 0.

**Spec:** `docs/superpowers/specs/2026-06-25-gc-seg3-publish-passback-design.md`. **Grounding:** `docs/superpowers/specs/grounding/2026-06-25-gc-seg3/grounding-synthesis.md`.

## File Structure
- **Create** `supabase/migrations/0027_google_publications.sql`.
- **Modify** `src/lib/google/config.ts` — add `APP_BASE_URL`.
- **Modify** `src/lib/google/classroom.ts` — add `gcWrite` + `createCourseWork`, `createCourseWorkMaterial`, `listStudentSubmissions`, `patchStudentSubmissionDraftGrade`.
- **Create** `src/lib/google/publishToClassroom.ts` — publish engine (+ Open-CORE pin).
- **Create** `src/lib/google/gradePassback.ts` — passback engine (lesson-keyed, multi-student).
- **Create** `src/app/api/teacher/google/publish/route.ts` + `src/app/api/teacher/google/grade-passback/route.ts`.
- **Modify (UI surfaces + their server pages — all gating reads are admin-client, C3):**
  - `src/app/(teacher)/library/quizzes/page.tsx` + `.../quizzes/_components/QuizLibrary.tsx` (quiz publish; `resource_id = quiz_id`).
  - `src/app/(teacher)/library/lessons/page.tsx` + `.../lessons/_components/LessonLibrary.tsx` (assignment publish on the **Lesson Library row**, C2; `resource_id = lesson_id`).
  - `src/app/(teacher)/gradebook/page.tsx` + `.../gradebook/_components/GradebookGrid.tsx` (send-grades batch per published assignment column).
  - `src/lib/gradebook/loadGradebook.ts` — expose `lesson_id` on `GradebookAssignmentCol` (already in `colMeta`; just surface it).
- Tests alongside each.

**Dependency order:** **T0** (spike, informational) → T1, T2 → T3, T4 (need T2 + T1) → T5, T6 (need T3/T4) → T7, T8 (UI, need T5/T6 + the loadGradebook change).

---

### Task 0: Verification spike — does a DRAFT courseWork yield gradeable studentSubmissions?

**Why:** Publish state is locked DRAFT (Marvin). The whole passback happy-path depends on `listStudentSubmissions` returning per-student rows we can PATCH. DRAFT courseWork is teacher-only and in practice frequently returns an **empty** `studentSubmissions` list until the teacher Posts it. This spike confirms the real behavior so the engine's empty-case handling (`not_posted_in_classroom`) is grounded, not guessed. **The engine handles the empty case regardless of the spike result** — the spike only tells us how *often* the empty case fires in practice and whether DRAFT ever auto-populates.

**Files:** none committed — this is a throwaway investigation against the demo's connected Google course. Record the finding in `.superpowers/sdd/gc-seg3-rework-report.md` and in the Task-4 test rationale.

- [ ] **Step 1:** Against the demo school's connected Google course (a teacher with a live `google_connections` row + a class with `google_course_id`), get a valid access token and `POST /v1/courses/{courseId}/courseWork` with `{ title:'GC Seg3 spike', workType:'ASSIGNMENT', state:'DRAFT', materials:[{link:{url:'https://newcore.inteliflowai.com/'}}] }`.
- [ ] **Step 2:** `GET /v1/courses/{courseId}/courseWork/{id}/studentSubmissions` and record: was the list empty? Did any submission have a `userId`? Then optionally PATCH `?updateMask=draftGrade` on one submission (if any) to confirm draftGrade is accepted on a DRAFT courseWork. **Delete the spike courseWork afterward.**
- [ ] **Step 3:** Record the verdict in the report: (a) DRAFT yields empty submissions → the `not_posted_in_classroom` path is the *common* first-publish case (expected); guide the teacher to Post first. (b) DRAFT yields per-student submissions → passback works pre-Post too; the `not_posted_in_classroom` path is the safety net for genuinely-empty courses. **Either way, do NOT change the locked DRAFT decision** — only the report's framing of how often guidance shows. **No commit** (investigation only).

---

### Task 1: Migration 0027 — `google_publications`

DDL only. Deny-by-default RLS mirroring 0026 (service_role FOR ALL; no authenticated policy → admin-client-only).

**Files:** Create `supabase/migrations/0027_google_publications.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0027_google_publications.sql
-- GC Segment 3: maps a CORE unit (quiz / assignment-by-LESSON) or the per-course Open-CORE link to
-- its Google Classroom courseWork/material. Written ONLY via the admin client (service_role) by the
-- publish engine; NO authenticated read path this segment (the UI gating flag is also an admin-client
-- read, server-side). Mirrors the 0026 audit_logs deny-by-default RLS pattern.
CREATE TABLE IF NOT EXISTS public.google_publications (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id              uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id               uuid        NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  resource_type          text        NOT NULL CHECK (resource_type IN ('quiz','assignment','course_link')),
  -- resource_id: quizzes.id (quiz) | lessons.id (assignment unit — there is NO class-wide
  -- assignments.id; the lesson IS the assignment column, see C1) | class_id sentinel (course_link).
  resource_id            text,
  google_course_id       text        NOT NULL,
  google_coursework_id   text        NOT NULL,   -- the GC courseWork id (or courseWorkMaterials id for course_link)
  grade_passback_enabled boolean     NOT NULL DEFAULT false,  -- true only for assignments
  max_points             integer     NOT NULL DEFAULT 100,    -- null/unused semantics for quizzes (never push)
  last_sync_error        text,
  created_by             uuid,                   -- the teacher; no FK (trail durability)
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_type, resource_id, google_course_id)
);

CREATE INDEX IF NOT EXISTS idx_gpub_class    ON public.google_publications (class_id);
CREATE INDEX IF NOT EXISTS idx_gpub_resource ON public.google_publications (resource_type, resource_id);

-- M2: the UNIQUE above does NOT constrain the per-course Open-CORE link (we now store
-- resource_id = class_id sentinel, so it's distinct per class). Belt-and-braces, enforce ONE
-- course_link per google_course_id at the DB level so two concurrent first-publishes can't
-- double-pin "Open CORE" (mirrors 0024's partial-unique idiom); the engine tolerates 23505.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gpub_course_link
  ON public.google_publications (google_course_id) WHERE resource_type = 'course_link';

ALTER TABLE public.google_publications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gpub_service_role_all" ON public.google_publications;
CREATE POLICY "gpub_service_role_all" ON public.google_publications
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- M3: RLS DENIES all authenticated rows (there is NO authenticated SELECT policy). The read path
-- — both the engine's idempotency SELECTs AND the UI gating flag — is the service-role admin client
-- ONLY. The table-level GRANT below mirrors the 0026 house pattern (authenticated gets the grant but
-- every row is still denied by RLS); NO anon grant.
GRANT SELECT ON public.google_publications TO authenticated;
GRANT ALL    ON public.google_publications TO service_role;
```

- [ ] **Step 2: Verify** idempotency + that the `UNIQUE(resource_type, resource_id, google_course_id)` matches the engine's upsert `onConflict` (Task 3) for quiz/assignment rows, AND that the partial unique `uq_gpub_course_link` enforces one course_link per course (the engine stores `resource_id = class_id` so the 3-col UNIQUE no longer treats course_link rows as all-distinct-via-null). **Do NOT apply to any live DB.** Next number after 0026 = 0027.
- [ ] **Step 3: Commit** `feat(gc-seg3): migration 0027 google_publications`

---

### Task 2: `APP_BASE_URL` + Classroom write helpers

**Files:** Modify `src/lib/google/config.ts`; Modify `src/lib/google/classroom.ts`; Test `src/lib/google/__tests__/classroomWrite.test.ts`
**Interfaces produced:** `APP_BASE_URL: string`; `createCourseWork(token, courseId, {title, description?, linkUrl, maxPoints?}): Promise<{id}>`; `createCourseWorkMaterial(token, courseId, {title, linkUrl}): Promise<{id}>`; `listStudentSubmissions(token, courseId, courseWorkId): Promise<{id, userId}[]>`; `patchStudentSubmissionDraftGrade(token, courseId, courseWorkId, submissionId, draftGrade): Promise<void>`.

- [ ] **Step 1: Add `APP_BASE_URL` to `config.ts`** (C5):

```ts
// src/lib/google/config.ts — append after GOOGLE_REDIRECT_URI:
// The canonical public origin for CORE links embedded in Google Classroom (the unit link material +
// the Open-CORE pin). Prefer NEXT_PUBLIC_APP_URL when set; fall back to the live prod origin. The
// links target the REAL login-gated app root (/) — NO invented /launch route (Seg 4 upgrades the
// behavior, not the path).
export const APP_BASE_URL = ((process.env.NEXT_PUBLIC_APP_URL || '').trim() || 'https://newcore.inteliflowai.com').replace(/\/+$/, '');
```

- [ ] **Step 2: Write the failing test** (mock `global.fetch`)

```ts
// src/lib/google/__tests__/classroomWrite.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCourseWork, createCourseWorkMaterial, listStudentSubmissions, patchStudentSubmissionDraftGrade, GoogleScopeError } from '@/lib/google/classroom';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

describe('createCourseWork', () => {
  it('POSTs a DRAFT ASSIGNMENT courseWork with a link material + maxPoints, returns the id', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 'cw1' }));
    const r = await createCourseWork('tok', 'course1', { title: 'Quiz 1', linkUrl: 'https://core/x', maxPoints: 100 });
    expect(r.id).toBe('cw1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://classroom.googleapis.com/v1/courses/course1/courseWork');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ title: 'Quiz 1', workType: 'ASSIGNMENT', state: 'DRAFT', maxPoints: 100 });
    expect(body.materials[0].link.url).toBe('https://core/x');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });
  // I3: a 200 with NO id must THROW (never store String(undefined) === 'undefined').
  it('throws when the response has no id (never stores "undefined")', async () => {
    fetchMock.mockResolvedValueOnce(ok({})); // empty body, no id
    await expect(createCourseWork('tok', 'c1', { title: 't', linkUrl: 'u' })).rejects.toThrow(/no id/i);
  });
});

describe('createCourseWorkMaterial', () => {
  it('POSTs a PUBLISHED material with a link, returns the id', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 'mat1' }));
    const r = await createCourseWorkMaterial('tok', 'c1', { title: 'Open in CORE', linkUrl: 'https://core/' });
    expect(r.id).toBe('mat1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://classroom.googleapis.com/v1/courses/c1/courseWorkMaterials');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ title: 'Open in CORE', state: 'PUBLISHED' });
    expect(body.materials[0].link.url).toBe('https://core/');
  });
  it('throws when the response has no id (I3)', async () => {
    fetchMock.mockResolvedValueOnce(ok({}));
    await expect(createCourseWorkMaterial('tok', 'c1', { title: 't', linkUrl: 'u' })).rejects.toThrow(/no id/i);
  });
});

describe('patchStudentSubmissionDraftGrade', () => {
  it('PATCHes draftGrade ONLY (no assignedGrade, no :return)', async () => {
    fetchMock.mockResolvedValueOnce(ok({}));
    await patchStudentSubmissionDraftGrade('tok', 'c1', 'cw1', 'sub1', 88);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://classroom.googleapis.com/v1/courses/c1/courseWork/cw1/studentSubmissions/sub1?updateMask=draftGrade');
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ draftGrade: 88 }); // draftGrade ONLY
    expect(url).not.toContain(':return');
  });
});

describe('listStudentSubmissions', () => {
  // M7: assert the wire — path, pageSize=100, and the 2nd call's pageToken.
  it('paginates (pageSize=100, carries pageToken) and returns {id,userId}', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ studentSubmissions: [{ id: 's1', userId: 'u1' }], nextPageToken: 'p2' }))
      .mockResolvedValueOnce(ok({ studentSubmissions: [{ id: 's2', userId: 'u2' }] }));
    const r = await listStudentSubmissions('tok', 'c1', 'cw1');
    expect(r).toEqual([{ id: 's1', userId: 'u1' }, { id: 's2', userId: 'u2' }]);
    const url1 = fetchMock.mock.calls[0][0] as string;
    expect(url1).toContain('/courses/c1/courseWork/cw1/studentSubmissions');
    expect(url1).toContain('pageSize=100');
    expect(url1).not.toContain('pageToken');
    const url2 = fetchMock.mock.calls[1][0] as string;
    expect(url2).toContain('pageToken=p2');
  });
  // C4 path: an empty list (DRAFT courseWork with no submissions) returns [] without throwing.
  it('returns [] when the courseWork has no submissions yet (DRAFT)', async () => {
    fetchMock.mockResolvedValueOnce(ok({})); // no studentSubmissions key
    const r = await listStudentSubmissions('tok', 'c1', 'cw1');
    expect(r).toEqual([]);
  });
});

describe('write scope error', () => {
  it('maps a 403 insufficient-scope to GoogleScopeError', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' });
    await expect(createCourseWork('tok', 'c1', { title: 't', linkUrl: 'u' })).rejects.toBeInstanceOf(GoogleScopeError);
  });
  it('throws a status-only error on other failures (no body leak)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'secret google internals' });
    await expect(createCourseWorkMaterial('tok', 'c1', { title: 't', linkUrl: 'u' })).rejects.toThrow(/failed: 500/);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'secret google internals' });
    await expect(createCourseWorkMaterial('tok', 'c1', { title: 't', linkUrl: 'u' })).rejects.not.toThrow(/secret/);
  });
});
```

- [ ] **Step 3: Run → FAIL** (`npx vitest run src/lib/google/__tests__/classroomWrite.test.ts`).
- [ ] **Step 4: Implement** — add to `src/lib/google/classroom.ts` (reuse the existing `BASE`, `GoogleScopeError`, `gcGet`):

```ts
// ── Write seam (POST/PATCH) — same Bearer + 403-scope + status-only-error contract as gcGet ──
async function gcWrite(accessToken: string, method: 'POST' | 'PATCH', url: string, body: unknown, label: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 403 && /insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(text)) throw new GoogleScopeError();
    throw new Error(`${label} failed: ${res.status}`); // status only — never leak the body
  }
  // PATCH/empty responses may have no JSON body
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export interface CreateCourseWorkArgs { title: string; description?: string; linkUrl: string; maxPoints?: number | null }
export async function createCourseWork(accessToken: string, courseId: string, args: CreateCourseWorkArgs): Promise<{ id: string }> {
  const body: Record<string, unknown> = {
    title: args.title, workType: 'ASSIGNMENT', state: 'DRAFT',
    materials: [{ link: { url: args.linkUrl } }],
  };
  if (args.description) body.description = args.description;
  if (args.maxPoints != null) body.maxPoints = args.maxPoints;
  const data = await gcWrite(accessToken, 'POST', `${BASE}/courses/${courseId}/courseWork`, body, 'google courseWork create');
  if (!data.id) throw new Error('google courseWork create: no id returned'); // I3 — never String(undefined)
  return { id: String(data.id) };
}

export async function createCourseWorkMaterial(accessToken: string, courseId: string, args: { title: string; linkUrl: string }): Promise<{ id: string }> {
  const body = { title: args.title, state: 'PUBLISHED', materials: [{ link: { url: args.linkUrl } }] };
  const data = await gcWrite(accessToken, 'POST', `${BASE}/courses/${courseId}/courseWorkMaterials`, body, 'google courseWorkMaterial create');
  if (!data.id) throw new Error('google courseWorkMaterial create: no id returned'); // I3
  return { id: String(data.id) };
}

export interface GcSubmission { id: string; userId: string }
export async function listStudentSubmissions(accessToken: string, courseId: string, courseWorkId: string): Promise<GcSubmission[]> {
  const out: GcSubmission[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await gcGet(accessToken, `${BASE}/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions?${params.toString()}`, 'google submissions list');
    for (const s of (data.studentSubmissions as Array<Record<string, unknown>> | undefined) ?? []) {
      out.push({ id: String(s.id), userId: String(s.userId ?? '') });
    }
    pageToken = data.nextPageToken as string | undefined;
  } while (pageToken);
  return out;
}

export async function patchStudentSubmissionDraftGrade(accessToken: string, courseId: string, courseWorkId: string, submissionId: string, draftGrade: number): Promise<void> {
  await gcWrite(accessToken, 'PATCH',
    `${BASE}/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions/${submissionId}?updateMask=draftGrade`,
    { draftGrade }, 'google draftGrade patch');
}
```

- [ ] **Step 5: Run → PASS** + tsc 0.
- [ ] **Step 6: Commit** `feat(gc-seg3): APP_BASE_URL + Classroom write helpers (courseWork/material/submissions/draftGrade)`

---

### Task 3: `publishToClassroom` engine (+ Open-CORE pin)

**Files:** Create `src/lib/google/publishToClassroom.ts`; Test `__tests__/publishToClassroom.test.ts`
**Interfaces:** `publishToClassroom(admin, args): Promise<PublishResult>`.

```ts
export interface PublishArgs {
  token: string; schoolId: string; classId: string; googleCourseId: string;
  resourceType: 'quiz' | 'assignment';
  resourceId: string;            // quizzes.id for a quiz; lessons.id (the assignment column) for an assignment (C1)
  title: string; linkUrl: string; courseLinkUrl: string;
  maxPoints?: number | null;     // assignments only; null/unused for quizzes (never push) — M9
  createdBy: string;             // teacher user id (M4)
}
export interface PublishResult { google_coursework_id: string; alreadyPublished: boolean; courseLinkPinned: boolean }
```

- [ ] **Step 1: Write the failing test** — mock the classroom writers + a table-dispatching admin (`google_publications`). Cases: (a) first publish of an assignment → creates DRAFT courseWork (`grade_passback_enabled=true`, `max_points` from args), pins the Open-CORE material once (with `resource_id = classId` sentinel), upserts a `google_publications` row carrying `created_by`, returns `alreadyPublished:false`; (b) re-publish (existing row) → does NOT create a duplicate courseWork (`alreadyPublished:true`); (c) a quiz → `grade_passback_enabled=false`; (d) the course_link material is created only once per course (idempotent via a school-scoped SELECT on the existing `course_link` row, M9); (e) a 23505 on the course_link insert (concurrent first-publish) is tolerated → `courseLinkPinned:false`, no throw (M2).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**

```ts
// src/lib/google/publishToClassroom.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { createCourseWork, createCourseWorkMaterial } from '@/lib/google/classroom';

export interface PublishArgs {
  token: string; schoolId: string; classId: string; googleCourseId: string;
  resourceType: 'quiz' | 'assignment'; resourceId: string;
  title: string; linkUrl: string; courseLinkUrl: string;
  maxPoints?: number | null; createdBy: string;
}
export interface PublishResult { google_coursework_id: string; alreadyPublished: boolean; courseLinkPinned: boolean }

export async function publishToClassroom(admin: SupabaseClient, args: PublishArgs): Promise<PublishResult> {
  // Idempotent: if this resource is already published to this course, return it (no duplicate).
  const { data: existing } = await admin.from('google_publications')
    .select('google_coursework_id')
    .eq('resource_type', args.resourceType).eq('resource_id', args.resourceId).eq('google_course_id', args.googleCourseId)
    .maybeSingle();
  let alreadyPublished = false;
  let courseworkId: string;
  if (existing?.google_coursework_id) {
    alreadyPublished = true;
    courseworkId = existing.google_coursework_id as string;
  } else {
    const cw = await createCourseWork(args.token, args.googleCourseId, {
      title: args.title, linkUrl: args.linkUrl,
      // Quizzes never push a grade → maxPoints irrelevant; assignments default 100 (M9).
      maxPoints: args.resourceType === 'assignment' ? (args.maxPoints ?? 100) : null,
    });
    courseworkId = cw.id;
    await admin.from('google_publications').upsert({
      school_id: args.schoolId, class_id: args.classId,
      resource_type: args.resourceType, resource_id: args.resourceId,
      google_course_id: args.googleCourseId, google_coursework_id: courseworkId,
      grade_passback_enabled: args.resourceType === 'assignment',
      max_points: args.maxPoints ?? 100,
      created_by: args.createdBy,                    // M4
      updated_at: new Date().toISOString(),
    }, { onConflict: 'resource_type,resource_id,google_course_id' });
  }

  // Pin the Open-CORE course-link material once per course. resource_id = class_id sentinel (M2)
  // makes the 3-col UNIQUE bind; the partial unique uq_gpub_course_link is the concurrency backstop.
  // SELECT is school-scoped (M9).
  let courseLinkPinned = false;
  const { data: link } = await admin.from('google_publications')
    .select('id')
    .eq('resource_type', 'course_link').eq('google_course_id', args.googleCourseId).eq('school_id', args.schoolId)
    .maybeSingle();
  if (!link) {
    const mat = await createCourseWorkMaterial(args.token, args.googleCourseId, { title: 'Open in CORE', linkUrl: args.courseLinkUrl });
    const { error: insErr } = await admin.from('google_publications').insert({
      school_id: args.schoolId, class_id: args.classId, resource_type: 'course_link',
      resource_id: args.classId,                     // sentinel so the 3-col UNIQUE applies (M2)
      google_course_id: args.googleCourseId, google_coursework_id: mat.id,
      grade_passback_enabled: false, created_by: args.createdBy,
    });
    // 23505 = a concurrent first-publish already pinned it; tolerate (M2). Any other error is logged
    // non-fatally — the courseWork is already published; a missing pin is recoverable on re-publish.
    if (insErr && (insErr as { code?: string }).code !== '23505') {
      console.error('[gc] course_link pin insert failed (non-fatal):', insErr.message);
    } else if (!insErr) {
      courseLinkPinned = true;
    }
  }
  return { google_coursework_id: courseworkId, alreadyPublished, courseLinkPinned };
}
```

- [ ] **Step 4: Run → PASS** + tsc 0.
- [ ] **Step 5: Commit** `feat(gc-seg3): publishToClassroom engine + idempotent Open-CORE pin (lesson-keyed assignments)`

---

### Task 4: `gradePassback` engine (lesson-keyed, multi-student)

**Files:** Create `src/lib/google/gradePassback.ts`; Test `__tests__/gradePassback.test.ts`
**Interfaces:** `gradePassback(admin, args): Promise<PassbackResult>`.

```ts
export interface PassbackArgs {
  token: string; schoolId: string; classId: string;
  lessonId: string;              // C1 — the assignment unit is the LESSON, not a single assignment row
  googleCourseId: string; courseWorkId: string; maxPoints: number;
}
export interface PassbackResult {
  pushed: number;
  skipped_not_linked: number;       // a graded CORE student with NO resolvable GC submission
  not_posted_in_classroom: boolean; // C4 — the courseWork has ZERO studentSubmissions (still DRAFT / unposted)
  errors: number;
}
```

> **I2 — `resolveExternalIdentity(email:null)` is correct here.** Confirmed against `src/lib/google/linkOrCreateStudent.ts:17-30` (`writeIdentity`): every GC-sourced `external_identities` row is written with a non-null `external_id` = the Google `userId`, on conflict `(school_id, provider, external_id)`. Since passback resolves a GC submission's `userId` (always present) directly via `external_id`, the email fallback is never needed → pass `email: null`.
>
> **Note (perf):** one `resolveExternalIdentity` DB call per GC submission (await-in-loop) is acceptable at pilot scale (~30 students). No batching this segment.

- [ ] **Step 1: Write the failing test** — mock the classroom helpers (`listStudentSubmissions`, `patchStudentSubmissionDraftGrade`), `resolveExternalIdentity`, and a table-dispatching admin that, for `assignments` filtered by `class_id`+`lesson_id`, returns **multiple per-student `assignments.id`s**, and for `homework_attempts.in(assignment_id, ids).eq(status,'graded')` returns graded rows for **more than one student** (C1 — assert >1 grade pushed from ONE call). Cases:
  - **(a) multi-student happy path:** 2 graded students, both with resolvable GC submissions → 2× PATCH `draftGrade = clamp(grade)/100*maxPoints` (M1 rounding), `pushed===2`, `skipped_not_linked===0`, `not_posted_in_classroom===false`.
  - **(b1) graded-but-no-submission (I4):** a graded student who resolves to a CORE id but has NO GC submission in the list → `skipped_not_linked===1` (NOT an error). Assert `resolveExternalIdentity` returns null for the *unlinked* submission and the graded student simply has no entry in `submissionByStudent`.
  - **(b2) submission-but-no-grade (I4):** a GC submission resolves to a CORE student who has NO graded attempt → neither pushed nor skipped (not in `gradeByStudent`); assert exact counts unaffected.
  - **(c) PATCH throws (transient):** the first PATCH attempt throws a generic error → the `[1s,3s]` retry re-attempts and succeeds → `pushed`, no `errors` (use fake timers / inject a no-delay sleep seam; see Step 3). A PATCH that throws on ALL three attempts → `errors++`, batch continues to the next student.
  - **(c2) PATCH throws `GoogleScopeError`:** NOT retried (assert exactly ONE call), rethrown so the route surfaces reconnect.
  - **(d) override-wins:** a student with `teacher_score` uses it over `score_pct`.
  - **(e) empty submissions (C4):** `listStudentSubmissions` returns `[]` while graded students exist → `not_posted_in_classroom===true`, `pushed===0`, `skipped_not_linked===0` (do NOT mis-bucket everyone as "not linked"); no PATCH calls.
  - **(f) M1 clamp:** a `teacher_score` of 120 → `draftGrade = maxPoints` (clamped to 100% before scaling); a >100 test asserts the clamp.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**

```ts
// src/lib/google/gradePassback.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { listStudentSubmissions, patchStudentSubmissionDraftGrade, GoogleScopeError } from '@/lib/google/classroom';
import { resolveExternalIdentity } from '@/lib/google/resolveExternalIdentity';

export interface PassbackArgs {
  token: string; schoolId: string; classId: string; lessonId: string;
  googleCourseId: string; courseWorkId: string; maxPoints: number;
}
export interface PassbackResult { pushed: number; skipped_not_linked: number; not_posted_in_classroom: boolean; errors: number }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const RETRY_DELAYS_MS = [1000, 3000]; // spec §2/§5 D4: [1s,3s] — three attempts total. Skips GoogleScopeError.

/** Fail-soft per-student PATCH with [1s,3s] retry; a GoogleScopeError is NOT transient → rethrow. */
async function patchWithRetry(token: string, courseId: string, courseWorkId: string, submissionId: string, draftGrade: number): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await patchStudentSubmissionDraftGrade(token, courseId, courseWorkId, submissionId, draftGrade);
      return;
    } catch (err) {
      if (err instanceof GoogleScopeError) throw err;            // reconnect, not a retry
      if (attempt >= RETRY_DELAYS_MS.length) throw err;          // exhausted [1s,3s]
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

export async function gradePassback(admin: SupabaseClient, args: PassbackArgs): Promise<PassbackResult> {
  const r: PassbackResult = { pushed: 0, skipped_not_linked: 0, not_posted_in_classroom: false, errors: 0 };

  // 1. The lesson's per-student assignment rows for this class (C1 — the lesson IS the column).
  const { data: asg } = await admin.from('assignments')
    .select('id')
    .eq('class_id', args.classId).eq('lesson_id', args.lessonId);
  const assignmentIds = ((asg ?? []) as Array<{ id: string }>).map((a) => a.id);
  if (assignmentIds.length === 0) return r; // nothing assigned for this lesson/class

  // 2. Graded attempts across all those rows → latest graded grade per student (override-wins).
  const { data: attempts } = await admin.from('homework_attempts')
    .select('student_id, score_pct, teacher_score, status, graded_at, attempt_no')
    .in('assignment_id', assignmentIds).eq('status', 'graded');
  // latest graded attempt per student (attempt_no desc, then graded_at desc) — mirrors loadGradebook.latest().
  const bestByStudent = new Map<string, { grade: number }>();
  const seen = new Map<string, { attempt_no: number; graded_at: string }>();
  for (const a of (attempts ?? []) as Array<{ student_id: string; score_pct: number | null; teacher_score: number | null; graded_at: string | null; attempt_no: number | null }>) {
    const g = typeof a.teacher_score === 'number' ? a.teacher_score : a.score_pct;
    if (g == null) continue;
    const cur = seen.get(a.student_id);
    const cand = { attempt_no: a.attempt_no ?? 0, graded_at: a.graded_at ?? '' };
    const wins = !cur || cand.attempt_no > cur.attempt_no || (cand.attempt_no === cur.attempt_no && cand.graded_at.localeCompare(cur.graded_at) > 0);
    if (wins) { seen.set(a.student_id, cand); bestByStudent.set(a.student_id, { grade: g }); }
  }

  // 3. GC submissions for the courseWork. EMPTY ⇒ the courseWork has no gradeable submissions yet
  //    (still DRAFT / not posted in Classroom). Surface a DISTINCT reason (C4) — do NOT mis-bucket
  //    every graded student as "not linked".
  const submissions = await listStudentSubmissions(args.token, args.googleCourseId, args.courseWorkId);
  if (submissions.length === 0) {
    r.not_posted_in_classroom = true;
    return r;
  }

  // 4. Resolve each GC userId → CORE student (external_id-first; email:null is correct — I2).
  const submissionByStudent = new Map<string, string>(); // coreStudentId → submissionId
  for (const sub of submissions) {
    if (!sub.userId) continue;
    const coreId = await resolveExternalIdentity(admin, { schoolId: args.schoolId, provider: 'google', externalId: sub.userId, email: null });
    if (coreId) submissionByStudent.set(coreId, sub.id);
  }

  // 5. For each graded CORE student: PATCH draftGrade if they have a GC submission; else skip "not linked".
  for (const [studentId, { grade }] of bestByStudent) {
    const submissionId = submissionByStudent.get(studentId);
    if (!submissionId) { r.skipped_not_linked++; continue; }
    // M1: teacher_score is a free override (can exceed 100 / be negative). Clamp 0..100, scale, round to 0.1.
    const clamped = Math.min(100, Math.max(0, grade));
    const draftGrade = Math.round((clamped / 100) * args.maxPoints * 10) / 10;
    try {
      await patchWithRetry(args.token, args.googleCourseId, args.courseWorkId, submissionId, draftGrade);
      r.pushed++;
    } catch (err) {
      if (err instanceof GoogleScopeError) throw err; // surface reconnect to the route (gcErrorResponse)
      r.errors++;
      console.error('[gc] draftGrade patch failed (non-fatal):', err instanceof Error ? err.message : 'unknown');
    }
  }
  return r;
}
```

> **Test seam for the retry (Step 1 case c):** the `[1s,3s]` `sleep` would make tests slow. The implementer uses `vi.useFakeTimers()` + advancing timers, OR (preferred, simplest) keeps `sleep` as a module-local const and the test drives retries by having the PATCH mock reject-then-resolve while running under fake timers. Either way the test must assert the retry happened (>1 PATCH call) and that `GoogleScopeError` produced exactly ONE call.

- [ ] **Step 4: Run → PASS** + tsc 0.
- [ ] **Step 5: Commit** `feat(gc-seg3): gradePassback engine (lesson-keyed, multi-student, draftGrade-only, [1s,3s] retry, not_posted vs not_linked)`

---

### Task 5: `POST /api/teacher/google/publish` route

**Files:** Create `src/app/api/teacher/google/publish/route.ts`; Test `__tests__/route.test.ts`
Mirrors `google/sync/route.ts` auth chain exactly.

- [ ] **Step 1: Write the failing test** — 401 no user; 403 non-staff; 403 `guardClassAccess` denies; 400 missing `classId`/`resourceType`/`resourceId`; 400 when the class has no `google_course_id`; 200 success (quiz) → calls `publishToClassroom` with `resourceId = quizId` + `logAudit('gc.publish')`; 200 success (assignment) → `resourceId = lessonId`, `maxPoints` resolved; `gcErrorResponse` on a thrown scope error → `{connected:true, needsReconnect:true}`; `GoogleNotConnectedError` (token fetch) → `{connected:false}` (NOT a 500 — token fetch is INSIDE try, M5).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — body `{ classId, resourceType:'quiz'|'assignment', resourceId }` where `resourceId` = the **quiz id** (quiz) or the **lesson id** (assignment, C1). Resolve the class row as `sync/route.ts:32` (`id, teacher_id, school_id, google_course_id`); 400 if no `google_course_id` (M6). Resolve the unit's title: a quiz → `quizzes.title`; an assignment → `lessons.title` (the lesson IS the column). Build `linkUrl = ${APP_BASE_URL}/?gc=${resourceType}&id=${resourceId}` and `courseLinkUrl = ${APP_BASE_URL}/` (C5). **Open the try/catch BEFORE the token fetch** (M5): `try { const token = await getValidAccessTokenForTeacher(admin, cls.teacher_id); … } catch (err) { return gcErrorResponse(err); }`. Call `publishToClassroom(admin, { token, schoolId: cls.school_id, classId, googleCourseId: cls.google_course_id, resourceType, resourceId, title, linkUrl, courseLinkUrl, maxPoints: resourceType==='assignment' ? 100 : null, createdBy: user.id })`. `logAudit(admin, { actorId:user.id, schoolId:cls.school_id, action:'gc.publish', resourceType:'google_publication', resourceId: result.google_coursework_id, metadata:{ resource_type, resource_id, alreadyPublished, courseLinkPinned } })`. Return `{ ok:true, ...result }`. (READ `google/sync/route.ts` and copy its exact auth-chain prologue.)
- [ ] **Step 4: Run → PASS** + tsc 0.
- [ ] **Step 5: Commit** `feat(gc-seg3): POST /api/teacher/google/publish (quiz=quizId, assignment=lessonId)`

---

### Task 6: `POST /api/teacher/google/grade-passback` route

**Files:** Create `src/app/api/teacher/google/grade-passback/route.ts`; Test `__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test** — same auth gates as Task 5; body `{ classId, lessonId }` (C1); 400 `not_published` if no `google_publications` row `(resource_type:'assignment', resource_id:lessonId, google_course_id)` OR `grade_passback_enabled` false; 200 success → calls `gradePassback({ …, lessonId, courseWorkId: pub.google_coursework_id, maxPoints: pub.max_points })` + `logAudit('gc.grade_passback')` + returns `{ ok:true, pushed, skipped_not_linked, not_posted_in_classroom, errors }`; records `last_sync_error` on the publication when `errors>0`; `GoogleNotConnectedError`/scope error inside the try → `gcErrorResponse` (M5).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — resolve the class row as `sync/route.ts:32` (`google_course_id`, `teacher_id`, `school_id`); 400 if no `google_course_id`. Look up the publication for `(resource_type:'assignment', resource_id:lessonId, google_course_id:cls.google_course_id)` via the admin client → 400 `{ error:'not_published' }` if absent or `grade_passback_enabled` false (defense-in-depth — the engine also refuses, M8). **Open the try/catch BEFORE the token fetch** (M5). Call `gradePassback(admin, { token, schoolId: cls.school_id, classId, lessonId, googleCourseId: cls.google_course_id, courseWorkId: pub.google_coursework_id, maxPoints: pub.max_points })`. On `result.errors>0`: `admin.from('google_publications').update({ last_sync_error: '<n> grade(s) failed', updated_at: new Date().toISOString() }).eq('id', pub.id)`. `logAudit(admin, { actorId:user.id, schoolId:cls.school_id, action:'gc.grade_passback', resourceType:'google_publication', resourceId: pub.google_coursework_id, metadata: result })`. `try/catch → gcErrorResponse`. Return `{ ok:true, ...result }`.
- [ ] **Step 4: Run → PASS** + tsc 0.
- [ ] **Step 5: Commit** `feat(gc-seg3): POST /api/teacher/google/grade-passback (lesson-keyed)`

---

### Task 7: Publish UI (Quiz Library row + Lesson Library row)

**Files:**
- Modify `src/app/(teacher)/library/quizzes/page.tsx` (fetch + pass `googleCourseId`) + `.../quizzes/_components/QuizLibrary.tsx`.
- Modify `src/app/(teacher)/library/lessons/page.tsx` (fetch + pass `googleCourseId`) + `.../lessons/_components/LessonLibrary.tsx` (C2 — assignment publish lives on the **Lesson Library row**, not an "assignment manage" surface, which does not exist).
- Tests alongside.

> **C3 — gating prop threading + admin-client read.** `google_publications` is admin-client-only (RLS denies all authenticated rows). The class's `google_course_id` MUST be fetched **server-side via the admin client** in each page and passed in as `googleCourseId: string | null`. Both pages already create `const admin = createAdminSupabaseClient()`; add `const { data: cls } = await admin.from('classes').select('google_course_id').eq('id', classId).maybeSingle();` → pass `googleCourseId: (cls?.google_course_id as string | null) ?? null`. Add `googleCourseId?: string | null` to `QuizLibraryProps` and `LessonLibraryProps`.

- [ ] **Step 1: Write the failing tests (jsdom)** —
  - QuizLibrary: render a quiz row for a class WITH `googleCourseId` → a "Publish to Classroom" action is present; WITHOUT it → the action is absent. Clicking POSTs `/api/teacher/google/publish` with `{classId, resourceType:'quiz', resourceId: quizId}` and shows a quiet success / `needsReconnect` state.
  - LessonLibrary: render a lesson row for a class WITH `googleCourseId` → a "Publish to Classroom" action is present; clicking POSTs `{classId, resourceType:'assignment', resourceId: lessonId}`.
  - **Assert the gating reads from the threaded `googleCourseId` prop** (not a hardcoded boolean) — render once with it set and once null and assert presence/absence.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** READ `QuizLibrary.tsx` + `LessonLibrary.tsx` for how each row is rendered and where it gets `classId`. Add a small token-only "Publish to Classroom" button per row (rendered only when `googleCourseId` truthy), a client handler that POSTs the route, and quiet success / `needsReconnect` (link to `/settings/google`) states. No gold-plating. Thread the prop from the server pages (above).
- [ ] **Step 4: Run → PASS** + tsc 0.
- [ ] **Step 5: Commit** `feat(gc-seg3): Publish-to-Classroom on quiz + lesson rows (gated on google_course_id, admin-client read)`

---

### Task 8: Send-grades UI (gradebook)

**Files:**
- Modify `src/lib/gradebook/loadGradebook.ts` — expose `lesson_id` on `GradebookAssignmentCol` (it's already computed in `colMeta`; just add the field and populate from `c.lesson_id`).
- Modify `src/app/(teacher)/gradebook/page.tsx` — after `loadGradebook`, fetch the gating data via the admin client (C3) and pass two new props into `GradebookGrid`: `googleCourseId: string|null` and `publishedLessonIds: string[]`.
- Modify `src/app/(teacher)/gradebook/_components/GradebookGrid.tsx` — a "Send grades to Classroom" batch action per published assignment column.
- Tests alongside.

> **C3/C8 — admin-client gating reads.** In `gradebook/page.tsx` (already has `const admin = createAdminSupabaseClient()`):
> - `const { data: cls } = await admin.from('classes').select('google_course_id').eq('id', classId).maybeSingle();` → `googleCourseId`.
> - `const { data: pubs } = await admin.from('google_publications').select('resource_id').eq('class_id', classId).eq('resource_type', 'assignment');` → `publishedLessonIds = (pubs ?? []).map(p => p.resource_id).filter(Boolean)`.
> Pass both into `GradebookGrid`. The "Send grades" button shows for a column **iff** its `lesson_id` (from the new `GradebookAssignmentCol.lesson_id`) is in `publishedLessonIds` **AND** `googleCourseId` is set. Columns with `lesson_id === null` (the `due:`/`id:` fallback keys) can never be published → never show the button.

- [ ] **Step 1: Write the failing tests (jsdom)** —
  - For a published assignment column (its `lesson_id` ∈ `publishedLessonIds`) with `googleCourseId` set → a "Send grades to Classroom" button is present; clicking POSTs `/api/teacher/google/grade-passback` `{classId, lessonId}` and renders the quiet summary ("N sent · M not linked to Classroom"; and the `not_posted_in_classroom` case renders "Post this assignment in Classroom first, then send grades").
  - Absent when the column's `lesson_id` ∉ `publishedLessonIds`, or `googleCourseId` is null, or `lesson_id` is null.
  - **A test asserting the published-flag derives from the `publishedLessonIds` prop** (C3): same grid, toggle the lesson in/out of the prop → button appears/disappears.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** READ `GradebookGrid.tsx` + `loadGradebook.ts`. Add `lesson_id: string | null` to `GradebookAssignmentCol` (populate from `c.lesson_id`). Add `googleCourseId?: string|null` + `publishedLessonIds?: string[]` to the grid props. Render the gated per-column batch button + the result summary (`pushed` / `skipped_not_linked` / `not_posted_in_classroom` / `errors`), `needsReconnect` link to `/settings/google`. Token-only. Thread the props from the page (above).
- [ ] **Step 4: Run → PASS** + tsc 0.
- [ ] **Step 5: Commit** `feat(gc-seg3): Send-grades-to-Classroom batch on the gradebook (lesson-keyed, admin-client published flag)`

---

## Final verification
- [ ] tsc 0; `npm test` green; `npm run build` 0.
- [ ] Whole-branch adversarial review — focus: **assignment keyed on `lesson_id`, never a single `assignmentId`** (C1: a passback call grades >1 student); draftGrade-ONLY (no assignedGrade/:return anywhere); DRAFT courseWork state; **`not_posted_in_classroom` distinct from `skipped_not_linked`** (C4); fail-soft passback with `[1s,3s]` retry that skips `GoogleScopeError` (I1); quizzes never push a grade (`grade_passback_enabled` false); idempotent publish + single course-link pin (M2 partial unique + 23505 tolerance); gated on `google_course_id` via **admin-client** reads with the prop threaded (C3); CORE links use `APP_BASE_URL` → real `/` route, no `/launch` (C5); no raw Google body leak; auth chain + `guardClassAccess` + token-fetch-inside-try on both routes (M5/M6); `created_by` populated (M4); audit on publish + passback; RLS deny-by-default on 0027 with the M3 comment.
- [ ] **Task-0 spike finding recorded** in the report (DRAFT submissions populated or empty?), and the engine's empty-case behavior matches it.
- [ ] Apply 0027 to NEW CORE (separately authorized) + verify (advisors all-WARN). Playwright preview of the Publish (quiz + lesson rows) + Send-grades buttons on a GC-mapped class (or a throwaway); confirm the buttons are correctly hidden on a class with no `google_course_id`.

## Self-Review
**Spec coverage:** publish both as link-back courseWork (T2/T3/T5), DRAFT state (T2) + the verification spike (T0), Open-CORE pin once per course (T3, M2), draftGrade-only passback **keyed on the lesson, multi-student** (T2/T4/T6, C1), quizzes never push (T3 `grade_passback_enabled`), gated on `google_course_id` via admin-client prop threading (T5/T6/T7/T8, C3), fail-soft + `[1s,3s]` retry + `skipped_not_linked` + the distinct `not_posted_in_classroom` reason (T4, I1/C4), real CORE link base (T2 `APP_BASE_URL`, C5), audit (T5/T6), `created_by` (M4), new table (T1). Deferred items (SSO launch, Drive, `assignedGrade`, auto-push, per-submission table) absent. ✓
**Placeholders:** T1–T6 complete code; T7/T8 give the gated action + the POST contract + the explicit admin-client prop-threading + the bounded "read the real component/loader" touchpoint. ✓
**Type consistency:** `PublishArgs` (incl. `createdBy`, lesson-keyed `resourceId`)/`PublishResult` (T3), `PassbackArgs` (lesson-keyed)/`PassbackResult` (with `not_posted_in_classroom`) (T4), the Task-2 writer signatures all consumed unchanged by T5/T6; `google_publications` columns (T1) match the engine upserts (incl. `created_by`, course_link `resource_id` sentinel); `resolveExternalIdentity` call shape (`email:null`) justified against `linkOrCreateStudent.ts` (I2); `GradebookAssignmentCol.lesson_id` added in T8 and consumed by the grid + page. ✓
**Findings ledger:** C1 (lesson re-key) ✓ · C2 (lesson-library host) ✓ · C3 (admin-client prop threading) ✓ · C4 (`not_posted_in_classroom`, DRAFT kept) ✓ · C5 (`APP_BASE_URL`→`/`) ✓ · I1 (`[1s,3s]` retry, synchronous, skip scope) ✓ · I2 (`email:null` justified) ✓ · I3 (no-id throw) ✓ · I4 (split skip tests) ✓ · M1 (clamp) ✓ · M2 (course_link unique + 23505) ✓ · M3 (RLS comment) ✓ · M4 (`created_by`) ✓ · M5/M6 (token-in-try, class-row resolution) ✓ · M7 (list wire asserts) ✓ · M8 (engine refuses non-assignment / asserts enabled) ✓ · M9 (school-scoped course_link SELECT, quiz max_points unused) ✓.
