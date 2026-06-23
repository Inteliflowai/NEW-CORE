# Content Studio — Library categorization + lesson-plan viewer (Seg 1 refinement)

> **For agentic workers:** TDD per task (superpowers:test-driven-development). Steps use `- [ ]`.
> This EXTENDS the in-flight `feat/content-studio-seg1` branch (libraries already exist); it is a
> live-feedback refinement, not a new epic. Ground truth: the existing Lesson/Quiz Library code.

**Goal:** Let a teacher (1) read a lesson's actual plan from the Lesson Library, and (2) slice both
libraries by **Class** (one at a time) + **Subject · Grade**, grouped into section headers — on top
of the existing search + date-bucket filter.

**Architecture:** Three pure/shared additions consumed by both libraries —
`src/lib/content/category.ts` (group + distinct), a shared `ClassSelect` (navigates `?class=`,
renders only when the teacher has >1 class), and a shared `CategoryFilterBar` (Class · Subject ·
Grade · Added/When · Search). The Lesson Library gains a read-only `LessonViewPanel` (side dialog
mirroring `QuizEditPanel` chrome) showing `lessons.parsed_content`. Loaders gain the fields the new
UI reads (`parsed_content` on lesson rows; `subject`/`grade_level` on quiz rows, joined from the
lesson). Pages resolve the teacher's class list server-side and pass it down.

**Tech Stack:** Next.js 16 App Router (async searchParams), React 19, Tailwind v4 token-only,
Vitest 4 (component tests: `// @vitest-environment jsdom` then `import '@/test/setup-dom';`).

## Global Constraints (verbatim, bind every task)

- **Class selector = "one class at a time"** (Marvin, 2026-06-23): it IS the sidebar's active class
  surfaced in the filter bar; changing it navigates `?class=<id>` (server reload). Render it ONLY
  when the teacher has >1 class. No cross-class / "all classes" view (deferred).
- **Categorize by Subject · Grade** into section headers; Subject + Grade are independent dropdown
  filters whose options derive from the loaded class's content. Null subject groups under **"Other"**.
- **Coach posture / four-audience:** these are TEACHER-only surfaces — digits/question-counts allowed
  at their render sites; surrounding PROSE stays banned-word-free (`leakGuard.hasBannedWord` === false).
  `misconception_risks` is teacher-appropriate (CL/misconceptions are teacher-only). Never a band enum
  or risk number. "Assignments", never "Homework".
- **Token-only Tailwind v4** — no hardcoded hex / arbitrary `[var(--..)]`; content text deep-ink
  (`text-fg`). Reuse pop-art chrome (`border-2 border-sidebar-edge`, `shadow-sticker`/`-lg`,
  `SectionLabel`). Ask before inventing a token (none expected here).
- **Auth chain unchanged:** page resolves `?class=` → `requireRole(['teacher'])` → first-class
  redirect → `guardClassAccess(classId)` (the ONLY IDOR backstop) → `createAdminSupabaseClient()`.
  Class-list query is scoped to `teacher_id = userId` (only ever surfaces the teacher's own classes).
- **All new user-facing strings are DRAFTS → Barb** (`STRINGS-FOR-BARB.md §Content Studio`).
- **Keep existing tests green:** Lesson lib test uses label `Added` + `searchbox`; Quiz lib test uses
  label `When` + `searchbox` + whole-row `button` opening the dialog. New selects use distinct labels
  (`Class`, `Subject`, `Grade`) so `getByLabelText(/added|when/i)` stays unique. `classes` prop is
  OPTIONAL (absent → no Class select), so current renders (no `classes`) still pass.

---

### Task 1: category util (pure)
**Files:** Create `src/lib/content/category.ts`; Test `src/lib/content/__tests__/category.test.ts`
**Produces:** `interface Categorizable { subject: string|null; grade_level: string|null }`;
`categoryLabel(subject, grade): string` (UPPERCASE header — `"SCIENCE · GRADE 7"`; grade gets a
`Grade ` prefix unless the text already contains "grade"; both null → `"OTHER"`);
`distinctValues<T>(items, pick): string[]` (trimmed, non-empty, de-duped, alpha-sorted — for
dropdown options); `groupByCategory<T extends Categorizable>(items): CategoryGroup<T>[]`
(`{ key, label, subject, grade_level, items }`; groups sorted subject A→Z then grade A→Z, **Other
last**; item order within a group preserved — caller pre-sorts).
- [ ] tests first (label variants incl. null/“7”/“7th grade”; distinct sort+dedup; group order + Other-last + item order preserved) → fail → implement → pass.

### Task 2: class-label extraction + teacher class options
**Files:** Create `src/lib/teacher/classLabel.ts` (move `formatClassLabel`); Modify
`src/app/api/teacher/classes/route.ts` (import + `export { formatClassLabel }` re-export so its two
existing tests keep importing from the route); Create `src/lib/teacher/teacherClasses.ts`
(`teacherClassOptions(admin, teacherId): Promise<{id;label}[]>` — `classes` where `teacher_id=teacherId`,
ordered by name, mapped via `formatClassLabel`); Test `src/lib/teacher/__tests__/teacherClasses.test.ts`.
- [ ] confirm `classes.helpers.test.ts` + `classes-label.test.ts` still import+pass; new helper test (maps + orders + label).

### Task 3: loadLessonLibrary → parsed_content
**Files:** Modify `src/lib/lessons/loadLessonLibrary.ts` (+ select `parsed_content`; validate with
`ParsedLessonSchema.safeParse` → `ParsedLesson | null` on each row; add `parsed_content` to
`LessonLibRow`); Test `src/lib/lessons/__tests__/loadLessonLibrary.test.ts`.
- [ ] new test: a row exposes a parsed `parsed_content`; malformed/absent → `null`. Existing field-level asserts stay green (additive).

### Task 4: loadQuizLibrary → subject + grade
**Files:** Modify `src/lib/quizzes/loadQuizLibrary.ts` (lesson select → `id, title, subject,
grade_level`; add `subject`/`grade_level` to `QuizLibRow`, from the linked lesson; null lesson →
null/null); Test `src/lib/quizzes/__tests__/loadQuizLibrary.test.ts`.
- [ ] new test: quiz inherits its lesson's subject/grade; standalone quiz → null/null. Existing asserts additive-safe.

### Task 5: ClassSelect (shared client nav)
**Files:** Create `src/app/(teacher)/library/_components/ClassSelect.tsx`
(`{ classes:{id;label}[]; currentClassId:string; basePath:string }` → returns `null` when
`classes.length <= 1`; `<select aria-label="Class">` → `router.push(\`${basePath}?class=${id}\`)`);
Test `src/app/(teacher)/library/_components/__tests__/ClassSelect.test.tsx` (mock next/navigation).
- [ ] tests: hidden at ≤1 class; renders options + current selected at >1; change → push with `?class=`.

### Task 6: CategoryFilterBar (shared client)
**Files:** Create `src/app/(teacher)/library/_components/CategoryFilterBar.tsx` — props: the
ClassSelect inputs + `{ search,onSearch, subjects,subject,onSubject, grades,grade,onGrade,
bucket,onBucket, dateLabel, searchPlaceholder }`. Renders Class (via ClassSelect) · Subject (label
"Subject", `all`+options) · Grade (label "Grade") · date select (label = `dateLabel`) · search
(role searchbox). Test `.../__tests__/CategoryFilterBar.test.tsx`.
- [ ] tests: subject/grade options render; onChange fires; `dateLabel` honored ("Added"/"When"); search wired.

### Task 7: LessonViewPanel (read-only lesson plan)
**Files:** Create `src/app/(teacher)/library/lessons/_components/LessonViewPanel.tsx` — `{ lesson:
LessonLibRow; onClose }`; side `role="dialog"` (focus trap + Escape + scrim-click + focus-restore,
mirroring `QuizEditPanel`). Sections from `parsed_content`: Summary, Objectives, Key concepts,
Vocabulary (term — definition), "Watch for these mix-ups" (misconception_risks). `parsed_content
== null` → a dignified "not processed yet" note. DRAFT strings → Barb. Test
`.../__tests__/LessonViewPanel.test.tsx`.
- [ ] tests: renders objectives/vocab/misconceptions from parsed_content; null → not-processed note; Escape calls onClose; banned-word-free.

### Task 8: LessonLibrary integration
**Files:** Modify `src/app/(teacher)/library/lessons/_components/LessonLibrary.tsx` (+ optional
`classes` prop; subject/grade state; CategoryFilterBar; group filtered rows via `groupByCategory`
with UPPERCASE `SectionLabel`-less header text; per-row **"View lesson"** button → opens
`LessonViewPanel`; keep "Open quiz"/"Make a quiz" link). Extend
`.../__tests__/LessonLibrary.test.tsx`.
- [ ] new tests: subject filter narrows; grade filter narrows; section headers present; View lesson opens dialog. Existing 5 tests stay green.

### Task 9: QuizLibrary integration
**Files:** Modify `src/app/(teacher)/library/quizzes/_components/QuizLibrary.tsx` (+ optional
`classes` prop; subject/grade state; CategoryFilterBar with `dateLabel="When"`; group filtered rows
via `groupByCategory`). Extend `.../__tests__/QuizLibrary.test.tsx`.
- [ ] new tests: subject/grade filter + headers. Existing 8 tests stay green (row-button dialog, Publish/Save/Unpublish, empty state).

### Task 10: pages wiring
**Files:** Modify `src/app/(teacher)/library/lessons/page.tsx` + `.../quizzes/page.tsx` — call
`requireRole(['teacher'])` once at top for `userId`; after the guard, `teacherClassOptions(admin,
userId)`; pass `classes` to the component. (Lesson page already gets `parsed_content` via the loader.)
- [ ] `npx tsc --noEmit` clean; full `npm test`; targeted Playwright preview.

## Gates (end): `npx tsc --noEmit` · `npm test` · `npm run build` (a11y + tokens) · adversarial review · Playwright preview → Marvin merge call.
