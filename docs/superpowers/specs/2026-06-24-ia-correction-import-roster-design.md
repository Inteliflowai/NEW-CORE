# Item 1 — IA correction + roster import (design)

**Date:** 2026-06-24
**Status:** DRAFT — awaiting Marvin sign-off → then `writing-plans` → subagent-driven-development.
**Origin:** Marvin's IA observation (2026-06-24): "V1's Upload = roster CSV/Excel import, not lesson authoring; lesson features belong in the Lesson Library." Confirmed against V1 (`/import` = "Import Roster", 5-sheet `.xlsx`; lesson authoring lives in "Lesson Library") and V2 (lesson authoring wrongly on the `/upload` "Upload" nav; no CSV/Excel roster import; Google import hidden). See [[v2-pilot-feedback-and-reprioritized-queue]].

## Goal

Make V2's teacher information architecture match V1's mental model and close the no-Google roster gap:
1. **Lesson authoring moves into the Lesson Library** (create lives where you browse).
2. **"Upload" nav → "Import Roster"**, a single page holding both file import and the (currently hidden) Google import.
3. **A V1-parity file roster importer** (option 3, our implementation): full 5-sheet `.xlsx` for admins; a lean students-into-my-class file for teachers.

## Non-goals (deferred, recorded)

- The full **audit-log table** (who-changed-what across the app) — separate "production ops" item. This epic logs only a lightweight per-import summary (counts + actor) via `console`/return value, no new table.
- **SIS student-ID anchor** (vendor-portable identity) — future GC/identity work.
- Reworking the Google importer's internals (unchanged; only relocated in the nav).

## Part A — Lesson authoring → Lesson Library

**Current:** `/upload` renders `ContentStudioTabs` (Upload a file / From a URL / Generate with AI). `/library/lessons` is browse-only. Nav has "Upload" under INSIGHTS & TOOLS and "Lesson Library" under LIBRARY.

**Target:**
- `/library/lessons` gains a **browse vs. create** toggle (or a "＋ Create" button revealing the authoring panel). The existing `ContentStudioTabs` + `UploadStudio` / `UrlImportStudio` / `GenerateLessonStudio` / `LessonReviewEditor` components are **moved/mounted here unchanged** (lift the page composition, keep the components).
- `/upload` route **retires** → server redirect to `/library/lessons` (so any bookmarks/deferred CTAs still resolve).
- Nav (`src/app/(teacher)/_components/navConfig.ts`): remove the `Upload` entry from INSIGHTS & TOOLS. (Insights stays.)

**Open nit (plan-level):** whether "Create" is a tab within the library page or a routed sub-view (`/library/lessons/new`). Recommendation: a client toggle on the same route (no new route), preserving the class-selector + filters context.

## Part B — "Import Roster" page

- New nav entry **"Import Roster"** (replacing the freed "Upload" slot; under a TOOLS/CLASS group — plan decides exact group).
- New route `/import` with an ARIA tablist, two tabs:
  - **"From a file"** — the new importer (Part C).
  - **"From Google Classroom"** — the existing `/import/google` wizard, **moved/mounted here** (it's currently reachable only via Settings/deep link). Keep `/import/google` working or redirect it into the tab.
- Tab visibility follows the actor's role (see Part C auth): a teacher sees the lean file tab + Google tab; an admin sees the full-import file tab + Google tab.

## Part C — The file importer

### C1. Full 5-sheet `.xlsx` — **school admin + super-admin only**

Mirrors V1's capability (Teachers / Classes / Students / Enrollments / Parents), built the V2 way.

- **Parser:** add **SheetJS `xlsx`** (V1 uses `xlsx@0.20.3` from the SheetJS CDN tarball; xlsx parsing genuinely needs a library). Parsing lives in a **pure, import-safe lib** (`src/lib/roster/parseWorkbook.ts`) — no Next/Supabase imports — so it's unit-testable.
- **Sheets & columns (V1 parity):**
  - Teachers: Full Name, Email, Password(optional)
  - Classes: Class Name, Subject, Grade Level, Period, Teacher Email
  - Students: Full Name, Email, Password(optional), Grade Level
  - Enrollments: Student Email, Class Name, Period, Teacher Email
  - Parents: Parent Full Name, Parent Email, Password(optional), Student Email
- **Downloadable template:** a `GET` route returns a generated `.xlsx` template with the 5 sheets + an instructions sheet (mirrors V1's `/api/import/template`).
- **Flow:** upload → server parses + **dry-run validates** → preview (counts per sheet: new vs. already-exists, plus row-level errors) → confirm → execute.
- **Account creation:** reuse V2's `ensureAuthUser` (the same primitive the Google importer uses). **Dedup by lowercased email** — existing accounts are matched, never overwritten. Default passwords when blank (decision: keep V1's `Core2026!` / `Student2026!`, or set V2 defaults — plan to confirm; recommend V1's for familiarity).
- **Tenancy/IDOR:** everything scoped to the actor's `school_id`. The admin can only create within their own school (super-admin may target a chosen school via the existing provisioning pattern). Class identity = find-or-create by `(school_id, name, period)` at the app layer (no unique index → same non-Google dup caveat as V1; note for the plan).
- **Account-takeover safety:** an incoming email that already maps to a **non-student** role is never silently re-bound (mirror the Google importer's `rebind_refused` guard).

### C2. Lean students file — **teachers (own class)**

- A teacher uploads a simple **`.csv` or single-sheet `.xlsx`**: Student Full Name, Email, optional Grade Level.
- Flow: upload → preview (new vs. already-in-CORE) → confirm → create student accounts (dedup by email) + **enroll into the teacher's currently-selected class** (`guardClassAccess`). No teacher/parent/class creation.
- Reuses the same `parseWorkbook` + `ensureAuthUser` + enrollment primitives.

### C3. Auth model (locked — option 1)

| Capability | student create | teacher/parent/class create | who |
|---|---|---|---|
| Full 5-sheet import | yes | yes | **admin + super-admin** |
| Lean students import | yes | no | **teacher** (own class) |
| Google import | yes | no | teacher (own class) — unchanged |

Routes follow the V2 auth chain: `createServerSupabaseClient` → `getUser` (401) → role gate (403) → object/tenant guard → `createAdminSupabaseClient`. Full-import routes assert admin/super-admin; lean-import asserts teacher + `guardClassAccess` on the target class.

## Testing

- Pure parser (`parseWorkbook`) — TDD unit tests: well-formed workbook, missing/extra columns, blank rows, duplicate emails within a file, bad email, empty sheet.
- Account/enrollment reconcile — unit tests on the create/dedup/rebind-refusal logic (mirror the Google `linkOrCreateStudent` tests).
- Route auth tests — 401/403 for wrong role; admin-only full import; teacher lean scoped to own class.
- No DB migration (existing tables). Gates as usual: tsc 0 / vitest / tokens / a11y / build.

## Dependency note

Adds **`xlsx` (SheetJS)** — first xlsx dependency in V2. Justified: xlsx parsing/writing can't be reasonably hand-rolled; V1 uses the same library. (The GC epic's "zero new deps" ethos was about avoiding an SDK where raw `fetch` sufficed; that doesn't apply to binary spreadsheet parsing.)

## Open decisions for sign-off

1. **Default passwords:** keep V1's `Core2026!`/`Student2026!`, or set V2 values? (Rec: keep V1's for familiarity; force-reset-on-first-login already exists via `/set-password`.)
2. **"Create" surface (Part A):** toggle on `/library/lessons` vs. a `/library/lessons/new` route. (Rec: toggle.)
3. **Import Roster nav group:** under CLASS or a TOOLS group? (Rec: a TOOLS group alongside the relocated items.)
