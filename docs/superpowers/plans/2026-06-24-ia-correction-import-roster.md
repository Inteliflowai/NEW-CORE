# IA correction + roster import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Match V2's teacher IA to V1 — move lesson authoring into the Lesson Library, repurpose the "Upload" nav as "Import Roster", and add a V1-parity file roster importer (full 5-sheet `.xlsx` for school admins; lean students-into-my-class for teachers).

**Architecture:** A pure, import-safe `src/lib/roster/` (parser + two import engines + template builder) reusing V2's takeover-safe `ensureAuthUser`. Three API routes (admin full import, admin template, teacher lean import). UI: a new `/import` tablist page (file + the relocated Google wizard); the Content Studio tabs move into `/library/lessons` behind a "＋ Create" toggle; `/upload` retires via redirect.

**Tech Stack:** Next.js 16 App Router (async params, server components, `redirect` from `next/navigation`), React 19, TypeScript strict, Tailwind v4 tokens, Vitest 4 (+ jsdom for components), SheetJS `xlsx`.

**Grounding (read first):** `docs/superpowers/plans/grounding/2026-06-24-ia-correction/current-code.md` — exact signatures, paths, role model, and V1 behavior. **Spec:** `docs/superpowers/specs/2026-06-24-ia-correction-import-roster-design.md`.

## Global Constraints

- **No DB migration.** Uses existing tables (`users`, `classes`, `enrollments`). Enrollments created by file import stamp **`source = 'file'`** (mirrors GC's `'google'`).
- **Account creation = `ensureAuthUser` ONLY** (`src/lib/trial/ensureAuthUser.ts`), for teacher/student/parent roles. Never call `admin.auth.admin.createUser` directly. It is takeover-safe (throws on role/school mismatch; never overwrites role/school). Mirror `linkOrCreateStudent`'s **rebind-refusal**: never reuse/rebind an email that maps to a different intended role.
- **Auth chain on every route:** `createServerSupabaseClient()` → `auth.getUser()` (401) → role gate → object/tenant guard → `createAdminSupabaseClient()` (bypasses RLS; RLS is NOT the IDOR backstop). Full import = `guardSchoolAdmin()` (school_admin/school_sysadmin/platform_admin); lean import = `role==='teacher'` + `guardClassAccess(classId)`.
- **Tenancy:** scope ALL reads/writes to the caller's `school_id`. For `guardSchoolAdmin` with `isPlatformAdmin===true`, `schoolId` is null → require an explicit `schoolId` in the request (else 400).
- **supabase-js returns `{ error }` (does NOT throw)** — check `error` on every call.
- **Roles (exact):** `teacher | student | parent | school_admin | school_sysadmin | platform_admin`. `SCHOOL_ADMIN_ROLES`/`STAFF_ROLES` in `src/lib/auth/roles.ts`.
- **Default passwords:** `Core2026!` (teacher/parent), `Student2026!` (student) — when the sheet's password cell is blank (V1 parity). First login forces a reset via `/set-password`.
- **Styling:** Tier-2 token classes only; no hardcoded hex/spacing; content text deep-ink `text-fg`; WCAG-AA. New user-facing strings → drafts in `STRINGS-FOR-BARB.md`.
- **Copy:** "Assignments" never "Homework"; "Reinforce" never "Reteach" (n/a here).
- **Tests:** Vitest. Pure libs default node env. Component/`.tsx` tests start with `// @vitest-environment jsdom` then `import '@/test/setup-dom';`. TDD: failing test first.

---

## File Structure

- Create: `src/lib/roster/types.ts` — parsed-row + summary types.
- Create: `src/lib/roster/parseWorkbook.ts` — pure parser (5-sheet + single-sheet students).
- Create: `src/lib/roster/importRoster.ts` — full 5-sheet import engine.
- Create: `src/lib/roster/importStudentsToClass.ts` — lean students→class engine.
- Create: `src/lib/roster/template.ts` — build the `.xlsx` template buffer.
- Create: `src/app/api/admin/roster/import/route.ts` — POST full (guardSchoolAdmin).
- Create: `src/app/api/admin/roster/template/route.ts` — GET template (guardSchoolAdmin).
- Create: `src/app/api/teacher/roster/import/route.ts` — POST lean (teacher + guardClassAccess).
- Create: `src/app/(teacher)/import/page.tsx` — tablist page (file + Google).
- Create: `src/app/(teacher)/import/_components/RosterImportTabs.tsx` — ARIA tablist.
- Create: `src/app/(teacher)/import/_components/RosterFileImport.tsx` — file upload + preview/commit (full|lean by prop).
- Modify: `src/app/(teacher)/_components/navConfig.ts` — Upload→Import Roster.
- Modify: `src/app/(teacher)/library/lessons/page.tsx` — add authoring context + Create toggle.
- Create: `src/app/(teacher)/library/lessons/_components/LessonLibraryWithCreate.tsx` — browse/create toggle wrapper.
- Modify: `src/app/(teacher)/upload/page.tsx` — replace with a redirect to `/library/lessons`.
- Modify: `src/app/(teacher)/import/google/page.tsx` — redirect to `/import` (wizard now hosted in the tab).
- Modify: `package.json` — add `xlsx`.

---

## Task 1: Add the SheetJS `xlsx` dependency

**Files:** Modify `package.json`.

- [ ] **Step 1:** Add to `dependencies` (match V1's SheetJS CDN pin, NOT the stale npm `xlsx`):
```json
"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
```
- [ ] **Step 2:** `npm install` — confirm it resolves and `node -e "require('xlsx')"` works (or `npx tsx -e "import('xlsx').then(()=>console.log('ok'))"`).
- [ ] **Step 3:** Commit `package.json` + `package-lock.json`. Message: `chore(roster): add SheetJS xlsx (V1 parity) for roster import`.

**Interfaces — Produces:** the `xlsx` module (`import * as XLSX from 'xlsx'`; `XLSX.read`, `XLSX.utils.sheet_to_json`, `XLSX.utils.book_new`, `XLSX.utils.aoa_to_sheet`, `XLSX.utils.book_append_sheet`, `XLSX.write`).

---

## Task 2: `parseWorkbook` pure parser + types

**Files:** Create `src/lib/roster/types.ts`, `src/lib/roster/parseWorkbook.ts`, Test `src/lib/roster/__tests__/parseWorkbook.test.ts`.

**Interfaces — Produces:**
```ts
// types.ts
export interface TeacherRow { fullName: string; email: string; password: string }
export interface ClassRow { name: string; subject: string; gradeLevel: string; period: string; teacherEmail: string }
export interface StudentRow { fullName: string; email: string; password: string; gradeLevel: string }
export interface EnrollmentRow { studentEmail: string; className: string; period: string; teacherEmail: string }
export interface ParentRow { fullName: string; email: string; password: string; studentEmail: string }
export interface ParsedRoster { teachers: TeacherRow[]; classes: ClassRow[]; students: StudentRow[]; enrollments: EnrollmentRow[]; parents: ParentRow[] }
export interface RowIssue { sheet: string; row: number; message: string }
export interface ParseResult { roster: ParsedRoster; issues: RowIssue[] }
```
`export function parseRosterWorkbook(bytes: ArrayBuffer | Uint8Array): ParseResult` and `export function parseStudentSheet(bytes: ArrayBuffer | Uint8Array): { students: StudentRow[]; issues: RowIssue[] }`.

**Behavior (mirror V1 grounding §E):** `XLSX.read(bytes, { type: 'array' })`; per sheet `XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })`; parse from **row index 3**; `cell(row,i)=String(row[i]??'').trim()`; lowercase emails; **skip placeholder rows** where the email cell `includes('email') || includes('@example')` and skip rows missing required cells (record a `RowIssue` only for malformed-but-non-placeholder rows). Missing sheet → empty array (record an issue). `parseStudentSheet` parses the first sheet (or a sheet named `Students`) with the Students columns; also accepts a CSV (XLSX.read handles csv) — for csv the first row is the header, so still start at the first data row (detect a header row: if row 0 looks like headers, start at 1; document the simple rule: skip a leading row whose cells include 'email'/'name').

- [ ] **Step 1:** Write failing tests `parseWorkbook.test.ts` (node env):
  - well-formed 5-sheet workbook → correct counts + values, emails lowercased.
  - placeholder/example rows (email contains 'email' or '@example') skipped.
  - missing required cell (e.g., student with no email) → not imported + a RowIssue.
  - missing sheet (e.g., no Parents) → `parents: []` + an issue, others parse.
  - `parseStudentSheet` on a single-sheet students workbook AND a CSV → students parsed, header row skipped.
  (Build test fixtures in-memory with `XLSX.utils.aoa_to_sheet` + `book_append_sheet` + `XLSX.write({type:'array'})`.)
- [ ] **Step 2:** Run → FAIL (module missing).
- [ ] **Step 3:** Implement `types.ts` + `parseWorkbook.ts`.
- [ ] **Step 4:** Run → PASS. `npx tsc --noEmit`.
- [ ] **Step 5:** Commit: `feat(roster): pure workbook parser (5-sheet + students) + types`.

---

## Task 3: `importRoster` — full 5-sheet engine

**Files:** Create `src/lib/roster/importRoster.ts`, Test `src/lib/roster/__tests__/importRoster.test.ts`.

**Interfaces — Consumes:** `ParsedRoster` (Task 2), `ensureAuthUser` (`src/lib/trial/ensureAuthUser.ts`). **Produces:**
```ts
export interface ImportSummary {
  teachers: { created: number; skipped: number; errors: number };
  classes:  { created: number; skipped: number; errors: number };
  students: { created: number; skipped: number; errors: number };
  enrollments: { created: number; skipped: number; errors: number };
  parents:  { created: number; linked: number; skipped: number; errors: number };
  issues: string[]; // human-readable per-row problems (e.g. "Enrollment: class 'Math 8A' not found")
}
export async function importRoster(
  admin: SupabaseClient,
  args: { schoolId: string; roster: ParsedRoster },
): Promise<ImportSummary>;
```

**Behavior (mirror V1 §E, but via `ensureAuthUser`):** Process sheets in order Teachers → Classes → Students → Enrollments → Parents (so later sheets can resolve emails/classes).
- Teachers/Students: for each row, look up existing `users` by `(lowercased email, school_id)`. If exists → `skipped` (and DON'T change role — if existing role differs from intended, count `skipped` not error). Else `ensureAuthUser({ admin, email, password: password||DEFAULT, full_name: fullName, role, school_id: schoolId })` → `created`. Wrap each row in try/catch; a thrown takeover-mismatch → `skipped` (record an issue), other throws → `errors`.
- Classes: find existing by `(name, teacher_id, period, school_id)` where `teacher_id` resolved from `teacherEmail` (lookup user with role teacher in school). If teacher not found → `errors` + issue. Else insert if absent → `created`, else `skipped`.
- Enrollments: resolve student by `(studentEmail, school_id)`; resolve class by the V1 fallback chain `(name,teacher,period)→(name,period)→(name)` within school. Missing student/class → `errors` + issue. Else upsert `enrollments` with **`source:'file'`** if no existing seat; existing seat → `skipped`.
- Parents: reuse-or-create parent via `ensureAuthUser({role:'parent'})` (existing by email → update full_name only, count `linked` when they're then linked); link `users.parent_id = parentId` on the resolved student (by studentEmail). Student not found → `errors` + issue.
- Use **lowercased** emails for every lookup. Check `{ error }` on every supabase call.

**Default password constants** (export from this file or a sibling `src/lib/roster/defaults.ts`): `DEFAULT_STAFF_PW='Core2026!'`, `DEFAULT_STUDENT_PW='Student2026!'`.

- [ ] **Step 1:** Write failing tests with a faked `admin` (mirror the style of `linkOrCreateStudent`/reconcile tests — a chainable supabase fake + a stubbed `ensureAuthUser`):
  - new teacher + new student + new class → created counts; enrollment links them.
  - existing email (student) → skipped, not re-created.
  - enrollment whose class is missing → errors + issue (no crash).
  - parent reused when email exists (update name only) + linked to student via parent_id.
  - takeover mismatch from ensureAuthUser (it throws) → counted skipped + issue, loop continues.
  - enrollment seat stamped `source: 'file'`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS. `npx tsc --noEmit`.
- [ ] **Step 5:** Commit: `feat(roster): full 5-sheet import engine via ensureAuthUser`.

---

## Task 4: `importStudentsToClass` — lean engine

**Files:** Create `src/lib/roster/importStudentsToClass.ts`, Test `src/lib/roster/__tests__/importStudentsToClass.test.ts`.

**Interfaces — Consumes:** `StudentRow[]` (Task 2), `ensureAuthUser`. **Produces:**
```ts
export interface LeanImportSummary { studentsCreated: number; studentsExisting: number; enrolled: number; alreadyEnrolled: number; errors: number; issues: string[] }
export async function importStudentsToClass(
  admin: SupabaseClient,
  args: { schoolId: string; classId: string; students: StudentRow[] },
): Promise<LeanImportSummary>;
```
**Behavior:** for each student row (skip no-email): find by `(email,school_id)`; if a non-student role owns the email → skip + issue (rebind-refusal); else create via `ensureAuthUser({role:'student'})` (studentsCreated) or reuse (studentsExisting); upsert enrollment into `classId` with `source:'file'` (enrolled vs alreadyEnrolled). Caller has already verified the class belongs to the school + teacher (route does `guardClassAccess`). Check `{ error }` everywhere.

- [ ] **Step 1:** Failing tests: new student created+enrolled; existing student reused+enrolled; already-enrolled → alreadyEnrolled; non-student email → skipped+issue; no-email → skipped.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS + tsc 0.
- [ ] **Step 5:** Commit: `feat(roster): lean students-to-class import engine`.

---

## Task 5: `template.ts` — build the 5-sheet `.xlsx` template

**Files:** Create `src/lib/roster/template.ts`, Test `src/lib/roster/__tests__/template.test.ts`.

**Interfaces — Produces:** `export function buildRosterTemplate(): Uint8Array` — Instructions + Teachers/Classes/Students/Enrollments/Parents sheets with header rows + example rows (verbatim columns from grounding §E). Uses `book_new`/`aoa_to_sheet`/`book_append_sheet`/`XLSX.write({type:'array',bookType:'xlsx'})`.

- [ ] **Step 1:** Failing test: `buildRosterTemplate()` returns bytes that `XLSX.read` parses back into 6 sheets with the exact sheet names + the expected header row on each (round-trip).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + tsc 0.
- [ ] **Step 5:** Commit: `feat(roster): downloadable 5-sheet xlsx template builder`.

---

## Task 6: `POST /api/admin/roster/import` (full, guardSchoolAdmin)

**Files:** Create `src/app/api/admin/roster/import/route.ts`, Test `src/app/api/admin/roster/__tests__/import.route.test.ts`.

**Interfaces — Consumes:** `parseRosterWorkbook`, `importRoster`, `guardSchoolAdmin`. **Behavior:**
- `const g = await guardSchoolAdmin(); if ('error' in g) return g.error;`
- Resolve `schoolId`: if `g.isPlatformAdmin` and `g.schoolId` is null → read `schoolId` from a form field; if still missing → 400.
- `runtime='nodejs'` (xlsx parsing needs Node). Read `multipart/form-data`: `file` (Blob) + `mode` ('preview'|'commit', default 'preview'). Validate Blob present + size ≤ a cap (e.g. 5MB) → else 400/413.
- `const { roster, issues } = parseRosterWorkbook(await file.arrayBuffer());`
- `mode==='preview'` → return `{ mode:'preview', counts: {teachers: roster.teachers.length, …}, issues }` (NO writes).
- `mode==='commit'` → `const summary = await importRoster(admin, { schoolId, roster });` return `{ mode:'commit', summary }`. Also `console.info('[roster-import] actor=%s school=%s summary=%o', g.userId, schoolId, summary)` (the lightweight per-import audit log; full audit table is the deferred ops item).
- Errors: 401/403 via guard; 400 bad upload; 500 on unexpected (generic `{ error:'Internal Server Error' }`, log server-side; never echo raw).

- [ ] **Step 1:** Failing tests (mock the guards + engines): 403 for a teacher (guardSchoolAdmin error); preview returns counts without calling importRoster; commit calls importRoster + returns summary; platform-admin with null school + no schoolId field → 400; missing file → 400.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + tsc 0.
- [ ] **Step 5:** Commit: `feat(roster): admin full-import route (preview + commit, school-scoped)`.

---

## Task 7: `GET /api/admin/roster/template` (guardSchoolAdmin)

**Files:** Create `src/app/api/admin/roster/template/route.ts`, Test `src/app/api/admin/roster/__tests__/template.route.test.ts`.

**Behavior:** `const g = await guardSchoolAdmin(); if ('error' in g) return g.error;` → `return new NextResponse(new Uint8Array(buildRosterTemplate()), { status:200, headers:{ 'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition':'attachment; filename="CORE_Roster_Template.xlsx"' }});`. `runtime='nodejs'`.

- [ ] **Step 1:** Failing tests: 403 for teacher; 200 + attachment headers + non-empty body for an admin. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + tsc 0.
- [ ] **Step 5:** Commit: `feat(roster): admin template download route`.

---

## Task 8: `POST /api/teacher/roster/import` (lean, teacher + guardClassAccess)

**Files:** Create `src/app/api/teacher/roster/import/route.ts`, Test `src/app/api/teacher/roster/__tests__/import.route.test.ts`.

**Behavior:** auth chain → `role==='teacher'` (403 else) → read multipart `file` + `classId` (400 if missing) → `const denied = await guardClassAccess(classId); if (denied) return denied;` → resolve `schoolId` from the caller's profile → `const { students } = parseStudentSheet(await file.arrayBuffer());` → `const summary = await importStudentsToClass(admin, { schoolId, classId, students });` → return `{ summary }` + `console.info` audit line. `runtime='nodejs'`.

- [ ] **Step 1:** Failing tests: 401 unauth; 403 non-teacher; 403 when guardClassAccess denies (engine NOT called); missing file/classId → 400; happy path calls importStudentsToClass + returns summary.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + tsc 0.
- [ ] **Step 5:** Commit: `feat(roster): teacher lean students-to-class import route`.

---

## Task 9: `/import` page + tablist + file-import UI + nav + Google relocation

**Files:** Create `src/app/(teacher)/import/page.tsx`, `src/app/(teacher)/import/_components/RosterImportTabs.tsx`, `src/app/(teacher)/import/_components/RosterFileImport.tsx`; Modify `src/app/(teacher)/_components/navConfig.ts`, `src/app/(teacher)/import/google/page.tsx`; Tests `src/app/(teacher)/import/_components/__tests__/RosterFileImport.test.tsx` (jsdom).

**page.tsx (server):** resolve caller role + `school_id` (via `createServerSupabaseClient`+profile read) and, for teachers, the current `classId` (`searchParams.class` → `firstClassIdForTeacher` → `guardClassAccess`, mirroring `/upload`). Compute `mode: 'full' | 'lean'` = school-admin-tier → 'full', teacher → 'lean'. Render `<PageHeader title="Import Roster" kicker="Add students" accent="brand"/>` + `<RosterImportTabs mode={mode} classId={classId}/>`.

**RosterImportTabs (client):** ARIA tablist (mirror `ContentStudioTabs` pattern verbatim — roving keys, `role=tab/tabpanel`): tabs `From a file` → `<RosterFileImport mode classId/>`; `From Google Classroom` → the existing `<ImportWizard/>` (import from `../../import/google/_components/ImportWizard`).

**RosterFileImport (client):** file `<input type=file accept=".xlsx,.csv">`; for `mode==='full'` show a **Download template** button (GET `/api/admin/roster/template`) + Preview (POST `mode=preview`) showing per-sheet counts + issues, then a Commit button (POST `mode=commit`) showing the summary; for `mode==='lean'` upload → preview (new vs existing) → confirm (POST `/api/teacher/roster/import` with `classId`) → summary. Loading/error/empty states (mirror the Google wizard's `639b014` states). Token classes only; deep-ink text. User-facing strings drafted into `STRINGS-FOR-BARB.md §Import Roster`.

**navConfig.ts:** in the INSIGHTS & TOOLS group, replace `{ label:'Upload', href:'/upload', icon:'upload' }` with `{ label:'Import Roster', href:'/import', icon:'upload' }` (reuse the `upload` icon key). (Authoring is reachable from Lesson Library now — Task 10.)

**import/google/page.tsx:** replace body with `import { redirect } from 'next/navigation'; export default function(){ redirect('/import'); }` (the wizard is hosted in the `/import` Google tab).

- [ ] **Step 1:** Failing jsdom test for `RosterFileImport` (lean mode): renders a file input + on a mocked successful POST shows the summary counts; (full mode): renders Download template + Preview controls. (Mock `fetch`.)
- [ ] **Step 2:** FAIL. **Step 3:** Implement page + components + nav + redirect.
- [ ] **Step 4:** PASS + tsc 0 + `npm run build` (route compiles).
- [ ] **Step 5:** Commit: `feat(roster): Import Roster page (file + Google tabs) + nav; relocate Google wizard`.

---

## Task 10: Relocate authoring into Lesson Library; retire `/upload`

**Files:** Modify `src/app/(teacher)/library/lessons/page.tsx`; Create `src/app/(teacher)/library/lessons/_components/LessonLibraryWithCreate.tsx`; Modify `src/app/(teacher)/upload/page.tsx`.

**library/lessons/page.tsx:** in addition to the current `loadLessonLibrary` + `teacherClassOptions`, compute the same `existingLessons` (lessons-lite) + `schoolState` that `/upload` computes (lift that code), and render `<LessonLibraryWithCreate data classes existingLessons schoolState classId/>` instead of `<LessonLibrary>` directly. Keep `<PageHeader title="Lesson Library" kicker="Your lessons" accent="brand"/>`.

**LessonLibraryWithCreate (client):** a `view: 'browse' | 'create'` toggle (a "＋ Create" button in the header area, and a "Back to library" affordance). `browse` → `<LessonLibrary data classes/>` (unchanged). `create` → `<ContentStudioTabs classId existingLessons schoolState/>` (import from `../../upload/_components/ContentStudioTabs`). Token classes; accessible toggle (buttons, aria-pressed).

**upload/page.tsx:** replace the whole component with a redirect preserving the class param:
```tsx
import { redirect } from 'next/navigation';
export default async function UploadPage({ searchParams }: { searchParams: Promise<{ class?: string }> }) {
  const { class: classId } = await searchParams;
  redirect(classId ? `/library/lessons?class=${classId}` : '/library/lessons');
}
```

- [ ] **Step 1:** Failing jsdom test for `LessonLibraryWithCreate`: defaults to browse (LessonLibrary visible); clicking "＋ Create" shows the ContentStudioTabs region (mock the heavy studio children if needed, or assert the tablist label "Create a lesson" appears).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + tsc 0 + `npm run build`.
- [ ] **Step 5:** Commit: `feat(roster): authoring moves into Lesson Library; /upload redirects`.

---

## Final (after all tasks)

- Whole-branch adversarial review (security lens on the import routes + engines: tenancy/IDOR, rebind-refusal, dedup, `{error}` checks, upload size/type bounds; a11y lens on the new UI; conventions lens). Fix Critical/Important.
- Gates: `npx tsc --noEmit` 0 · `npx vitest run` green · `npm run build` 0 (tokens + a11y).
- Playwright preview (Marvin's propose-only rule): the `/import` page (both tabs), the Lesson Library Create toggle, and the retired `/upload` redirect. Marvin approves visuals + makes the merge call.
- STRINGS-FOR-BARB.md `§Import Roster` drafts for Barb.
