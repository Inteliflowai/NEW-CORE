# Grounding — IA correction + roster import (verbatim current-code facts, 2026-06-24)

Source for the plan `docs/superpowers/plans/2026-06-24-ia-correction-import-roster.md` and spec `docs/superpowers/specs/2026-06-24-ia-correction-import-roster-design.md`. All facts gathered read-only from V2 (`C:/users/inteliflow/NEW-CORE`) and V1 (`C:/users/inteliflow/core`).

## A. V2 account / identity primitives to REUSE

- **`ensureAuthUser`** — `src/lib/trial/ensureAuthUser.ts:52`. Signature:
  `ensureAuthUser({ admin, email, password, full_name, role, school_id }): Promise<string>` (returns auth user id).
  Account-takeover safe: resolves by auth id; on existing `public.users` row it NEVER overwrites `role`/`school_id` and THROWS on mismatch; updates only `full_name`; inserts the `public.users` row only when it created a new auth user. Orphan auth user (no public.users row) → throws.
- **`linkOrCreateStudent`** — `src/lib/google/linkOrCreateStudent.ts:32`. `(admin, { schoolId, googleId, email, name }) => LinkResult` where `LinkResult = { outcome:'created'|'linked'; studentId } | { outcome:'skipped'; reason:'no_email'|'ambiguous'|'rebind_refused'|'error' }`. Match by **lowercased email** (`.eq`, not `.ilike`); **rebind-refusal**: if the email maps to ANY non-student role → skip `rebind_refused`; ambiguous (>1 student) → skip; writes `external_identities` (provider='google'). The roster importer should mirror the rebind-refusal + dedup discipline (but is provider-agnostic — no google identity).
- **`resolveExternalIdentity`** — `src/lib/google/resolveExternalIdentity.ts:15`. Write-free: external_id-first, then unambiguous lowercased email.
- **`reconcileCourseRoster`** — `src/lib/google/reconcileCourseRoster.ts:119`. Enroll upsert stamps `source='google'`; soft-unenroll. Reference for enrollment writes (the file importer stamps `source='file'`).

## B. Roles + auth guards (the REAL model — no plain 'admin')

- `src/lib/auth/roles.ts`: `ROLES = ['teacher','student','parent','school_admin','school_sysadmin','platform_admin']`; `STAFF_ROLES = ['teacher','school_admin','school_sysadmin','platform_admin']`; `SCHOOL_ADMIN_ROLES = ['school_admin','school_sysadmin','platform_admin']`. `users.role` CHECK enforces this set (`supabase/migrations/0001_identity_roles.sql:40`). PLATFORM_ROLE='platform_admin' (`src/lib/auth/guards.ts:8`).
- `src/lib/auth/guards.ts`:
  - `guardPlatformAdmin(): Promise<NextResponse|null>` (401/403/null).
  - `guardSchoolAdmin(): Promise<{ error: NextResponse } | { schoolId: string|null; role: string; userId: string; isPlatformAdmin: boolean }>` — covers school_admin/school_sysadmin/platform_admin. **When isPlatformAdmin, schoolId is null** (must require an explicit target school).
  - `guardClassAccess(classId): Promise<NextResponse|null>` — teacher-of-record OR same-school admin OR platform_admin; 403 (not 404) on missing class.
- Auth-chain helpers `src/lib/supabase/server.ts`: `createServerSupabaseClient()` (async, session), `createAdminSupabaseClient()` (sync, SECRET key, bypasses RLS).
- Route template (full IDOR + 23505 race recovery): `src/app/api/teacher/google/import-roster/route.ts:9-71`.
- Error shape: `NextResponse.json({ error: '…' }, { status })` (401 Unauthorized / 403 Forbidden / 400 Bad Request / 500 Internal Server Error). supabase-js returns `{ error }` (does NOT throw) — always check it.

## C. DB columns (existing — NO migration needed)

- `users` (`0001:40`): id (=auth.users.id), school_id, role (CHECK set above), full_name, email, parent_id, grade_level, is_active, …
- `classes` (`0002:11`): id, school_id, teacher_id, name, subject, grade_level, period, google_course_id, is_active, enrollment_count, …
- `enrollments` (`0002:28` + `0024:27`): id, class_id, student_id, is_active, **source** (text; 'google' for GC, will use 'file'), UNIQUE(class_id, student_id).
- `external_identities` (`0008:69` + `0024`): school_id, provider, external_id, core_student_id, email, last_seen_at, UNIQUE(school_id, provider, external_id). (Roster file import does NOT write external_identities — it's not an external-provider sync.)

## D. V2 IA surfaces to MOVE

- **Nav** `src/app/(teacher)/_components/navConfig.ts`: `NAV_ENTRIES` groups — top-level Today, Spark Challenges; CLASS (Roster/Gradebook/Alerts/High Fives); LIBRARY (Lesson Library `/library/lessons`, Quiz Library); **INSIGHTS & TOOLS (Insights, `Upload` → `/upload`)**; SETTINGS (Google Classroom). `NavIconKey` union + icon registry `ICON` in `src/app/(teacher)/_components/SidebarNav.tsx:11`; icon components in `src/components/core/icons.tsx` (IconUpload exists; reuse for Import Roster or add one).
- **`/upload/page.tsx`**: resolves `classId` via `searchParams.class` → `requireRole(['teacher'])` + `firstClassIdForTeacher(userId)` → `redirect('/upload?class=…')`; `guardClassAccess(classId)`; loads `existingLessons` (lessons-lite) + `schoolState`; renders `<PageHeader title="Content Studio" kicker="Create a lesson" accent="brand"/>` + `<ContentStudioTabs classId={} existingLessons={} schoolState={}/>`.
- **`ContentStudioTabs`** `src/app/(teacher)/upload/_components/ContentStudioTabs.tsx`: props `{ classId, existingLessons, schoolState }`; ARIA tablist; mounts `<UploadStudio classId existingLessons/>`, `<UrlImportStudio classId existingLessons/>`, `<GenerateLessonStudio classId schoolState/>`.
- **`/library/lessons/page.tsx`**: same classId-resolution + `guardClassAccess`; `loadLessonLibrary(admin,{classId})` + `teacherClassOptions(admin,userId)`; renders `<PageHeader title="Lesson Library" kicker="Your lessons" accent="brand"/>` + `<LessonLibrary data classes/>`. (This page must gain the authoring "Create" view — it already loads class context; will ALSO need existingLessons + schoolState for ContentStudioTabs, same as /upload computes.)
- **`/import/google/page.tsx`**: `<div className="mx-auto max-w-2xl px-4 py-8"><ImportWizard/></div>`. `ImportWizard` (`./_components/ImportWizard.tsx`) is **self-contained (no props)**; steps select→preview→importing→done; calls `/api/teacher/google/courses` etc.
- **`PageHeader`** `src/app/(teacher)/_components/PageHeader.tsx`: `{ title; kicker?; accent?: 'brand'|'lime'|'ok'|'warn'|'risk'; action?: ReactNode }`.
- **Server redirect**: `import { redirect } from 'next/navigation'` then `redirect('/path?class=…')` (used in upload/library/alerts pages).
- Helpers: `requireRole(['teacher'])` → `{ userId }`; `firstClassIdForTeacher(userId)`; `teacherClassOptions(admin, userId)` (for the ClassSelect).

## E. V1 importer behavior to MIRROR (`C:/users/inteliflow/core`)

- Parser `app/(dashboard)/import/actions.ts`: `const XLSX = await import('xlsx'); const wb = XLSX.read(bytes,{type:'array'}); XLSX.utils.sheet_to_json<string[]>(sheet,{header:1})`. Each sheet parsed from **row index 3** onward. `cell(row,i)=String(row[i]||'').trim()`. **Placeholder-skip:** skip rows whose email `includes('email') || includes('@example')`. Emails lowercased.
- **Sheets + columns (exact):**
  - `Teachers`: Full Name, Email, Password (default **`Core2026!`**)
  - `Classes`: Class Name, Subject, Grade Level, Period, Teacher Email
  - `Students`: Full Name, Email, Password (default **`Student2026!`**), Grade Level
  - `Enrollments`: Student Email, Class Name, Period, Teacher Email
  - `Parents`: Parent Full Name, Parent Email, Password (default **`Core2026!`**), Student Email
- **Dedup:** users by (email, school_id) skip-if-exists; classes find-or-create by (name, teacher_id, period, school_id); enrollments by (student_id, class_id). Parent: reuse existing by (email, school_id) updating only full_name, else create; link `users.parent_id = parentId` on the student. Class lookup for enrollments falls back: (name,teacher,period)→(name,period)→(name).
- Template `app/api/import/template/route.ts`: `XLSX.utils.book_new()`, `aoa_to_sheet(rows)`, `book_append_sheet(wb,ws,name)`, `XLSX.write(wb,{type:'buffer',bookType:'xlsx'})`. Sheets: Instructions + the 5 above, each with a header row + 2-5 example rows. Filename `CORE_Roster_Template.xlsx`.
- Dependency: `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"` (SheetJS CDN tarball, NOT the stale npm `xlsx`).

## F. Reconciliation note for the plan

V1's importer used `admin.auth.admin.createUser` directly + manual rollback. V2 should instead reuse **`ensureAuthUser`** (already rollback/takeover-safe) for ALL account types (teacher/student/parent), passing the appropriate `role` — do NOT re-implement createUser. The lean teacher import reuses the same student-create + enrollment path scoped to one class.
