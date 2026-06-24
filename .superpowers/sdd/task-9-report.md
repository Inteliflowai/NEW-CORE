# Task 9 Report — Import Roster page (file + Google tabs) + nav + Google wizard relocation

**Status:** DONE

**Commit:** (see below after commit)

**Test summary:** vitest 2564/2564 · tsc --noEmit 0 · npm run build 0 (tokens in sync, 49/49 a11y WCAG-AA)

---

## Files created

- `src/app/(teacher)/import/page.tsx` — server page; resolves role (STAFF_ROLES); computes `mode='full'|'lean'`; teacher path mirrors `/upload` classId resolution exactly (searchParams.class → firstClassIdForTeacher → redirect → guardClassAccess); renders PageHeader + RosterImportTabs.
- `src/app/(teacher)/import/_components/RosterImportTabs.tsx` — client ARIA tablist (ContentStudioTabs pattern verbatim: roving arrow keys, role=tab/tabpanel, aria-selected/controls). Tabs: "From a file" → `<RosterFileImport>`, "From Google Classroom" → `<ImportWizard>`.
- `src/app/(teacher)/import/_components/RosterFileImport.tsx` — client file-import component; labeled file input (`.xlsx,.csv`); lean path: Upload → POST `/api/teacher/roster/import` → summary; full path: Download template link + Preview → POST `/api/admin/roster/import?mode=preview` → per-sheet counts → Commit → POST `mode=commit` → summary. Loading/error/empty states throughout. Token classes only; deep-ink.
- `src/app/(teacher)/import/_components/__tests__/RosterFileImport.test.tsx` — 13 jsdom tests covering both modes.

## Files modified

- `src/app/(teacher)/_components/navConfig.ts` — replaced `{ label:'Upload', href:'/upload', icon:'upload' }` with `{ label:'Import Roster', href:'/import', icon:'upload' }` in INSIGHTS & TOOLS group.
- `src/app/(teacher)/import/google/page.tsx` — body replaced with `redirect('/import')` (wizard now in /import Google tab).
- `src/app/(teacher)/_components/TeacherTopbar.tsx` — added `/import` → `'Import Roster'` to TITLE_MAP; updated `/upload` → `'Content Studio'`.
- `src/app/(teacher)/_components/__tests__/SidebarNav.test.tsx` — updated 'Upload' → 'Import Roster'.
- `src/app/(teacher)/_components/__tests__/navConfig.test.ts` — updated 'Upload' → 'Import Roster'.
- `src/app/(teacher)/_components/__tests__/SidebarNav.classparam.test.tsx` — changed `/Roster/i` regex to exact `'Roster'` to avoid matching 'Import Roster'.
- `STRINGS-FOR-BARB.md` — added `## Import Roster` section with all user-facing string drafts.

## Gates

- `npx tsc --noEmit` → 0 errors
- `npx vitest run` → 2564/2564 passed (13 new; 3 existing nav/sidebar tests updated for label rename)
- `npm run build` → exit 0; tokens in sync; 49/49 WCAG-AA; TypeScript clean

## Concerns

None. Visual sign-off is deferred to Playwright preview per the propose-only rule. The `/api/admin/roster/import` and `/api/teacher/roster/import` routes already exist in the build (confirmed in the route listing) — the UI is wired to them.

---

## Fix wave — review findings (commit `924efb9`)

**Files:** `src/app/(teacher)/import/_components/RosterFileImport.tsx` + `__tests__/RosterFileImport.test.tsx`

- **I-1 (Important):** Added null-classId guard in lean mode — Upload button disabled and `role="alert"` message "No class selected — open a class first." rendered when `classId` is null. `handleLeanUpload` guard tightened (`!classId` early return; `fd.append('classId', classId)` is now unconditional since guard ensures it is non-null).
- **I-2 (Important):** Extended the "POSTs to /api/teacher/roster/import" test to capture the FormData from the first `fetch` call and assert `body.get('classId') === 'cl1'` and `body.get('file') !== null`.
- **I-3 (Important):** Added "I-3: full commit path" test (full mode) — mocks two sequential fetches (preview → commit), clicks Preview, awaits Commit button, clicks Commit, then asserts (a) second fetch body `mode === 'commit'` and (b) `role=status` element renders with "Import complete".
- **M-1 (Minor):** After a successful lean upload, `fileInputRef.current.value = ''` and `setFile(null)` now execute to reset the input, enabling re-upload.
- **M-3 (Minor):** Issues list key changed from `key={i}` to `` key={`${i}-${issue}`} `` for stability.

**Gates:** `npx tsc --noEmit` → 0 errors · `npx vitest run RosterFileImport` → 16/16 passed (2 new tests added)

---

## Whole-branch fix wave 3 (commit `7bacd7d`)

**STATUS:** DONE

**Commit:** `7bacd7d`

**Test + build summary:** vitest 2606/2606 · tsc --noEmit 0 · npm run build 0 (tokens in sync, 49/49 a11y WCAG-AA)

### What changed

- **Fix 1 — page.tsx:** Dropped the `full`/`lean` role-based split. All STAFF_ROLES users resolve a `classId` (same pattern as `/upload`) and always get `canFull=true` + `canLean=true`. No-classes shows an empty state (full still accessible without a class in theory, but the wizard needs a class — the server redirects if none exist to surface the empty state). The `RosterImportTabs` props changed from `mode: 'full'|'lean'` to `canFull: boolean, canLean: boolean, classId: string | null`.

- **Fix 2 — RosterFileImport.tsx:** Replaced the single `mode` prop with `canFull` / `canLean` / `classId`. Added a `role=group` / `role=radio` sub-selector (shown only when both are available and classId present) to pick "Whole roster (5-sheet .xlsx)" vs "Just this class (.csv or .xlsx)". Fixed three API shape bugs: (a) full preview now reads `data.counts` (the five entity numbers) + `data.issues`, rendered as a joined count line; (b) full commit now reads `data.summary` (NESTED objects with created/linked/skipped/errors per entity, not flat numbers); (c) lean now renders `studentsExisting` ("already in CORE") and `alreadyEnrolled` in place of the phantom `skipped` key.

- **Fix 3 — LessonLibraryWithCreate.tsx:** Removed `aria-pressed={false}` from the "＋ Create a lesson" view-switch button. (The `Back to library` button never had it.)

- **Fix 4 — LessonLibrary.tsx:** Added optional `onCreate?: () => void` prop. When present, the cold-start CTA becomes `<button onClick={onCreate}>Create a lesson</button>` instead of the `/upload` link that caused a redirect loop. Cold-start body copy updated to "Create a lesson and we'll draft a quiz you can review." `LessonLibraryWithCreate` now passes `onCreate={() => setView('create')}` into `LessonLibrary`.

- **Fix 5 — STRINGS-FOR-BARB.md:** Drafted all new user-facing strings under `## Import Roster` (sub-selector labels, no-class alert, per-entity count row format, nested commit-summary format, `studentsExisting`/`alreadyEnrolled` lean rows) and under a new `## Lesson Library — cold-start CTA + LessonLibraryWithCreate toggle` section (toggle buttons + cold-start CTA).

- **Tests:** `RosterFileImport.test.tsx` rewritten to use the new props (`canLean`/`canFull`) and assert correct shapes — adds tests for `studentsExisting`/`alreadyEnrolled`, asserts no `skipped` row, tests sub-selector switches between full/lean, tests that sub-selector is hidden when only one mode available. `LessonLibraryWithCreate.test.tsx` extended with aria-pressed assertions (x2) and a cold-start `onCreate` test. `LessonLibrary.test.tsx` gains a cold-start `onCreate` test (button vs link).

**Concerns:** None. The `ClassSwitcherPill` test showed a single intermittent failure in one full run (0 failures in a follow-up run) — it is a pre-existing environmental fluke unrelated to these changes.
