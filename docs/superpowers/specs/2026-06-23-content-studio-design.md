# Teacher Authoring / Content Studio — Design Spec

**Date:** 2026-06-23
**Status:** Draft → awaiting Marvin sign-off → per-segment `writing-plans` → SDD
**Epic:** Content Studio (the teacher authoring UI over the already-built engine). Lead epic of the
authoring-platform program ([[v2-authoring-platform-program]]); precedes Profile → Support →
Google Classroom. Relates to [[v2-content-engine-and-authoring-gap]].

> **The engine already exists; this epic is its hands.** V2 has `parseLesson`, `generateQuiz`,
> `generateAssignment`, `inferLearningStyle` (`src/lib/engine/`), the student quiz runner +
> assignment player, and the gradebook. The teacher authoring surface is three EmptyState stubs.
> This epic builds the authoring UI + the missing endpoints (file upload, AI lesson generation,
> voice transcription, quiz publish) so a teacher can actually get content in, shape it, and
> publish it to students.

---

## 1. Decisions locked (Marvin, 2026-06-23)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Library layout | **Flat searchable list** per library + filters that include **month / week / day (and time)** date-granularity. NOT V1's collapsible calendar tree. |
| D2 | Upload flow depth | **Fully automatic**: upload → auto-parse → auto-generate quiz → teacher reviews/edits/publishes. |
| D3 | AI Lesson Generator | **Yes — "with the works"**: typed description → AI writes the lesson → review/edit → quiz, PLUS **multi-day unit splitting** (one prompt → N day-plans grouped under a chapter) AND **voice dictation** (speak the idea). |
| D4 (program) | Sequence | Content Studio → Profile → Support → Google Classroom. |
| D5 | Lesson duplicate warning | **IN** (Marvin, 2026-06-23: "don't leave it out") — port V1's similar-lesson detector + 3-option dedup modal; needs `lessons.file_hash` + a keyword detector. |
| D6 | Review submitted work + drawing canvas | **IN — pulled forward** (Marvin, 2026-06-23): add a teacher **review-of-submitted-work** panel (gradebook drill-in shows the student's actual answers + drawings) AND **un-defer the student drawing canvas** → drawings rendered to a **storage bucket** (`image_url` in the responses contract; `canvas_data` holds strokes). |

## 2. Grounding facts (verbatim, 2026-06-23 sweep)

**V2 already has (engine + consumption):**
- `src/lib/engine/`: `parseLesson(lessonText) → ParsedLesson`; `generateQuiz(parsedLessonJson, subject) → GeneratedQuiz` (5 Q: 3 mcq/numeric + 2 open); `generateAssignment(input)`; `inferLearningStyle(signals)`; `parseUpload.ts` extracts text via **`unpdf`** (PDF) + **`mammoth`** (DOCX) — both installed.
- Routes: `POST /api/teacher/lessons/parse` (lesson_id → downloads `file_url` from the `lesson-uploads` bucket → parseLesson → persists `parsed_content` + title/grade/subject, status→`pending_review`); `POST /api/teacher/quizzes/generate` (lesson_id → quiz draft + quiz_questions, atomic); `POST /api/teacher/assignments/generate` (auto on quiz completion). Auth chain on all: `getUser → TEACHER_ROLES gate → createAdminSupabaseClient → guardClassAccess`.
- Student visibility gate: **a quiz is student-visible only when `quizzes.status='published'`** (`api/attempts/student-quiz` filters `.eq('status','published')`, ordered by `published_at`). Assignments are visible on insert (auto-gen sets `status='draft'`; no status gate in the student list).
- Schema (migrations 0003 + 0010): `lessons`(id, class_id NOT NULL, teacher_id NOT NULL, title, file_name, file_url, file_type, parsed_content jsonb, grade_level, subject, status[draft|pending_review|approved|published|archived], version, created_at — **no file_hash, no archived_at, no source, no chapter**); `quizzes`(…, lesson_id nullable, status, published_at, is_math, generation_model); `quiz_questions`(quiz_id, position, question_type[mcq|open|numeric], question_text, choices, correct_answer, rubric, concept_tag, numeric_spec, skill_id). Latest migration **0018**.
- Shared UI: `EmptyState`, `Card`(tone), `PageHeader`, `SectionLabel`, `SidebarNav` (+`navConfig.ts`, `?class=` convention), the gradebook grid pattern, `src/components/core/icons/` (incl. `IconLessons`/`IconQuizzes`/`IconUpload`).
- **Storage: NEW CORE has ZERO buckets** (confirmed). The `lesson-uploads` bucket referenced by the parse route **does not exist** — must be created (bucket + RLS) before upload works.

**V2 is missing (this epic builds):** the file-**upload** endpoint (no multipart handler), the `lesson-uploads` bucket, the **AI lesson generator** (no `generateLesson` engine fn, no `/lessons/generate` route, no describe/review UI), **voice transcription** (deferred with the player's voice segment — no endpoint), the **quiz publish/edit** actions UI, both **library** UIs (stubs), and the **upload** UI (stub).

**V1 reference (the parity target):** `/teacher/lessons/new` = "AI Lesson Generator — teacher writes one sentence, CORE writes the lesson" (typed or **voice**); generates {title, learning_objectives, reading_passage, key_concepts, vocabulary, discussion_question, suggested_quiz_focus, misconception_risks}; **multi-day** (`num_days` → N day-plans under an optional chapter); review/edit → save → approve fires quiz gen; `source='ai_generated'` distinguishes generated lessons; dedup-warning modal (deferred for V2). Upload path: `lessons/upload` multipart → `lesson-uploads` bucket → parse → auto-quiz. Libraries: month/week/day tree (V2 → flat per D1).

## 3. Four-audience / coach posture

- Authoring is **teacher-facing** → low leak risk; teacher prose can be plain. **But generated content reaches students**, so generated lessons/quizzes must stay within the student-facing rules the engine already enforces (the engine produces student-safe content; no new leak surface introduced by authoring).
- The **publish** action is the student-visibility gate (`status='published'`) — nothing reaches students until the teacher publishes. "Generation ≠ publish."
- All teacher-facing authoring strings are DRAFTS → `STRINGS-FOR-BARB.md §Content Studio`; Barb gates copy.
- Token-only Tailwind v4 (pop-art: sticker labels, tone cards, deep-ink); never hardcode hex/spacing/type/motion; ask before inventing a token ([[v2-design-token-discipline]]). UI work is propose-only + Playwright-previewed before merge ([[v2-frontend-review-workflow]]).
- "Assignments", never "Homework".

## 4. Design — three segments (each its own plan + SDD + merge)

### Segment 1 — Upload + Libraries + Publish (the foundation; makes the stubs real)
**Goal:** a teacher can upload a document, it auto-becomes a parsed lesson + generated quiz, they manage both in libraries, and publish the quiz to students.
- **Migration 0019:** create the **`lesson-uploads`** Storage bucket (private) + RLS on `storage.objects` (teacher writes/reads own `{teacher_id}/…` path; admin client reads for parse). Add `lessons.source text default 'upload'` (upload|ai_generated|manual) — needed by Seg 2's review flow. Add **`lessons.file_hash text`** (D5 dedup; sha256 of the uploaded file, scoped per teacher). (Use `status='archived'` for soft-delete; no `archived_at`.)
- **Lesson duplicate warning (D5):** on upload (and on AI-save in Seg 2), run a similar-lesson check — exact `file_hash` match → hard "already uploaded" 409; fuzzy title/key-concept match → a **3-option modal** ("Use that one" / "Create anyway" / "Cancel"). Port V1's `lib/lessons/duplicateDetect.ts` keyword detector.
- **`POST /api/teacher/lessons/upload`** (NEW): multipart FormData (file + class_id) → validate type/size (PDF/DOCX/TXT, ≤ ~15 MB) → upload to `lesson-uploads/{teacher_id}/{ts}_{name}` → insert `lessons` row (file_url/file_name/file_type, status='draft', source='upload') → **auto-chain** (D2): call parse → on success call quiz-generate → return lesson_id + quiz_id. Auth chain + guardClassAccess. Reuses `parseUpload.ts` + the existing parse/quiz-generate logic (extract into a shared lib so the route and the existing endpoints share one path).
- **Upload UI** (`(teacher)/upload/page.tsx`): drag-drop + class context (`?class=`), progress states (uploading → parsing → generating quiz → done → link to the lesson in the library), error states.
- **Lesson Library** (`(teacher)/library/lessons/page.tsx`): flat list of the class's lessons; columns = title, subject/grade, status, quiz state; **filters** = search + status + **date granularity (month/week/day, optional time)** (D1); row actions = open/edit lesson, (re)generate quiz, archive. Loader `loadLessonLibrary(classId)`.
- **Quiz Library** (`(teacher)/library/quizzes/page.tsx`): flat list; columns = title, linked lesson, status, # questions, published date; filters as above; row → **Quiz detail/edit** (edit title + per-question text/choices/rubric — straight Supabase update, no engine re-run) + **Publish** (`status='published'`, `published_at=now()`) + Archive.
- **Routes:** `POST /api/teacher/quizzes/manage` (publish|edit|archive|republish), `PATCH /api/teacher/lessons/[id]` (edit) + archive. Reuse existing `quizzes/generate`.

### Segment 2 — AI Lesson Generator + multi-day units (D3)
- **Engine:** new `generateLesson(input: { description; subject?; gradeLevel?; numDays? }) → GeneratedLesson | GeneratedLesson[]` in `src/lib/engine/lessonGen.ts` (+ a `LESSON_GENERATE` prompt). Returns the V1 GeneratedLesson shape (title, learning_objectives, reading_passage, key_concepts[{term,definition}], vocabulary, discussion_question, suggested_quiz_focus, misconception_risks). `numDays>1` → array of day-plans.
- **Routes:** `POST /api/teacher/lessons/generate` (description/class_id/num_days → GeneratedLesson(s)); `POST /api/teacher/lessons/generate/save` (persist as `lessons` row(s), source='ai_generated', optional `chapter_title` grouping for multi-day); `POST /api/teacher/lessons/[id]/approve` (lock + fire quiz-generate). Add **`lessons.chapter_title text`** (nullable) for multi-day grouping (lightweight — no chapters table).
- **UI** (`(teacher)/lessons/new/page.tsx` or a Studio "Create" surface): **describe** → **generating** → **review/edit** (single) / **review-unit** (N day-plans + unit name) → save → auto-quiz. Re-edit an AI lesson (hydrate by `?lesson_id=`). Pop-art styled (V1's was inline-CSS; V2 rebuilds on tokens).
- Library shows generated lessons grouped by `chapter_title` when present; a "Needs review (AI)" state for un-approved generated lessons.

### Segment 3 — Voice dictation (D3)
- **`POST /api/teacher/lessons/transcribe`** (NEW): audio blob → OpenAI Whisper (matches V2's existing OpenAI engine usage) → text. (Also the foundation for the deferred **player voice segment**.)
- **Mic UI** on the describe screen (`MediaRecorder`/`getUserMedia`, `'use client'`, `ssr:false`): record → transcribe → append to the description textbox. `prefers-reduced-motion`/permission/error states.

### Segment 4 — Student drawing canvas (D6; un-defers player Segment 4)
- **`drawings` Storage bucket** (private) + RLS (migration). On submit, the canvas is rendered to a PNG saved at `drawings/{student_id}/{attempt_id}_{step}.png`; the URL goes into the responses contract's `image_url` (already reserved), and stroke data into `homework_attempts.canvas_data` for fidelity/replay.
- **Canvas UI** in `TaskCard.tsx` for `type:'draw'` tasks (currently every task is a typed textarea — `TaskCard.tsx:7-9` notes the canvas slot): pointer/touch drawing, undo/clear, `'use client'`. Autosave strokes via the existing `homework-draft` route; final PNG on submit via `homework-submit`. Reduced-motion / no-pointer fallbacks.

### Segment 5 — Teacher review of submitted work (D6)
- Extend the **gradebook drill-in** (`GradebookDrillIn.tsx`) with a **"Submitted work"** panel: the student's actual typed answers per task (from `homework_attempts.responses`) + any drawing images (from `image_url`/the `drawings` bucket, once Seg 4 lands). Read-only; teacher-only surface (grades/answers allowed). Loader extends to fetch the attempt's `responses`/`canvas_data` for the opened cell (a small targeted fetch, not in the grid matrix). Closes the V1-parity gap (V1's cell drill-in showed responses).

## 5. Data-model + infra changes (summary)
| Change | Where | Segment |
|--------|-------|---------|
| `lesson-uploads` Storage bucket (private) + RLS | migration 0019 | 1 |
| `lessons.source text default 'upload'` | migration 0019 | 1 |
| `lessons.chapter_title text` (nullable) | migration (0020) | 2 |
| New `generateLesson` engine fn + prompt | `src/lib/engine/lessonGen.ts` | 2 |
| Voice transcription endpoint (OpenAI Whisper) | `api/teacher/lessons/transcribe` | 3 |
| (Deferred) `lessons.file_hash` dedup; `avatars` bucket (Profile epic) | — | later |

## 6. Out of scope / deferred
- **Trial lesson-plan template picker** (V1 `LessonPlanPicker`) — defer to the trial-onboarding epic.
- **BNCC/EduFlux** habilidade grounding — Brazil-deferred ([[v2-future-scope-eduflux-and-support]]).
- **Chapters as a first-class table / unit analytics** — V2 uses a lightweight `chapter_title` label only.
- **Google-Classroom-import-as-lesson** — that's the Google Classroom epic.
- **URL import / paste-text lesson** — defer (upload + AI-generate cover the paths).
- Teacher assignment *management* UI (assign/set-due) — covered by the gradebook (override/reteach) + auto-gen on quiz completion + quiz publish; not rebuilt here.
- *(No longer deferred — now IN per D5/D6: lesson duplicate warning, teacher review-of-submitted-work, student drawing canvas.)*
- **Voice on the student player** (player Segment 5) — the Seg 3 transcription endpoint unblocks it, but the student voice-answer UI stays deferred.

## 7. Gates (per segment)
`npx tsc --noEmit` 0 · `npm test` green (new tests) · `npm run build` 0 · `npm run a11y` (WCAG-AA) pass · migration(s) applied live to **NEW CORE only** (`pmdzxwppdlnddtnkoarc`) with explicit authorization · whole-branch adversarial review + Playwright preview of every new surface before merge.

## 8. Recommended build order
Five segments, each its own `writing-plans` → SDD → review → merge cycle:
1. **Seg 1** — Upload + Libraries + Publish + **dedup warning** (turns the dead stubs into a working authoring loop; teacher gets content to students immediately).
2. **Seg 5** — Teacher review-of-submitted-work (small; complements Seg 1; typed answers now, drawings once Seg 4 lands).
3. **Seg 2** — AI Lesson Generator + multi-day (flagship "describe it, CORE writes it"; dedup applies).
4. **Seg 4** — Student drawing canvas → `drawings` bucket (un-defers player Seg 4; extends the Seg 5 review panel with drawings).
5. **Seg 3** — Voice dictation (transcription endpoint + mic UI; also unblocks the deferred player voice).
**Building Seg 1 now.**
