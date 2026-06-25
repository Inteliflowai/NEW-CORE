# Google Classroom — Segment 3: Publish + Draft Grade Passback (Design Spec)

**Status:** DECISIONS LOCKED (Marvin, 2026-06-25) — ready for writing-plans.
**Grounding:** `docs/superpowers/specs/grounding/2026-06-25-gc-seg3/grounding-synthesis.md` (V2 foundation + V1 reference, file:line-cited).
**Memory:** [[v2-google-classroom-epic]], [[v2-authoring-platform-program]], [[v2-assignments-graded-vs-quizzes-coached]] (the four-audience line this honors).

## 1. Why / what
The "GC controls the flow" segment: publish CORE quizzes & assignments into the Google Classroom stream (each as a link back into CORE), and push **draft** grades for assignments back to Classroom — teacher-controlled, never auto-returned. Builds on shipped Seg 1 (connect + encrypted token vault) and Seg 2 (roster import + two-way sync).

**Gating fact (confirmed):** the OAuth scopes teachers granted in Seg 1 ALREADY include `classroom.coursework.students` + `classroom.courseworkmaterials` (write coursework + draft grades). **No re-consent required.** The existing `gcErrorResponse → needsReconnect` path is the only fallback if Google ever returns a scope error.

## 2. Locked decisions (Marvin, 2026-06-25)
- **What flows:** **Both** quizzes & assignments appear in the Classroom stream as **GC `courseWork` (workType ASSIGNMENT) whose material is a link back into CORE** — NOT native GC quizzes (CORE owns the experience: Teli, signals, drawing/voice). **Only ASSIGNMENT grades push back; quizzes NEVER push a grade** (they're diagnostic — four-audience: students never see a quiz score). [[v2-assignments-graded-vs-quizzes-coached]]
- **Publish state: DRAFT** — CORE creates the courseWork as `state:'DRAFT'`; the teacher reviews and Posts it inside Classroom. (Overrides V1's PUBLISHED.) No surprise assignments for students.
- **Open-CORE link: pin NOW** — publish an idempotent "Open CORE" `courseWorkMaterials` link per connected course, pointing at a stable CORE URL that requires normal login until Seg 4's silent SSO upgrades the behavior (not the pin).
- **Grade passback model (your prior binding decision, re-confirmed):** PATCH `studentSubmissions` with `updateMask=draftGrade` **only** (omit `assignedGrade`, **no `:return`**) — a student never sees a CORE-pushed grade until the teacher releases it in Classroom. Grade sent = `teacher_score ?? score_pct` (override-wins, 0–100). Scale: `(grade/100) * maxPoints`, maxPoints default **100** (teacher-overridable at publish). **Fail-soft:** `after()` + `[1s,3s]` retry, record `last_sync_error` on the publication; a Google outage must NEVER block CORE grading. **Gated** on: the class has `google_course_id`, the courseWork was published, and the student has a resolvable Google `external_identity`. Students with no Google link (file-roster `source≠google`) are **skipped with a clear "not linked to Classroom" reason — never a hard batch failure.**
- **Trigger surface:** **Publish** = an action on the Quiz Library row + the assignment (shown only when the class has `google_course_id`). **Send grades** = an explicit **batch action on the gradebook** ("Send grades to Classroom" for a published assignment) — teacher-triggered, NOT auto-pushed on every override (teacher-controlled, fewer surprises; auto-push is a possible later enhancement).
- **Audit (yes):** `logAudit` on publish (`gc.publish`) and each passback batch (`gc.grade_passback`) — actor = teacher (or null/system for any background push), `school_id` stamped, metadata with the courseWork id + counts.

## 3. Scope of THIS epic
- **Migration 0027** — `google_publications` table mapping a CORE unit ↔ its GC courseWork: `(id, school_id, class_id, resource_type ['quiz'|'assignment'|'course_link'], resource_id, google_course_id, google_coursework_id, grade_passback_enabled bool, max_points int, last_sync_error text, created_by uuid, created_at, updated_at)`, `UNIQUE(resource_type, resource_id, google_course_id)`, deny-by-default RLS (admin-client only; mirror 0022/0024/0026). Per-student passback state can live in metadata/`last_sync_error` (no per-submission table this segment).
- **Classroom write helpers** (extend `src/lib/google/classroom.ts`, same raw-fetch pattern): `createCourseWork(token, courseId, body)` (POST, state DRAFT, link material), `createCourseWorkMaterial(token, courseId, body)` (the Open-CORE pin), `patchStudentSubmissionGrade(token, courseId, courseWorkId, submissionId, draftGrade)` (PATCH `?updateMask=draftGrade`), `listStudentSubmissions(token, courseId, courseWorkId)` (to map GC userId → submission id).
- **Publish engine** (`src/lib/google/publishToClassroom.ts`) — given a CORE quiz/assignment + class, create the DRAFT courseWork with an Open-CORE link material, upsert `google_publications`. Idempotent (re-publish updates, doesn't duplicate).
- **Grade-passback engine** (`src/lib/google/gradePassback.ts`, port V1's shape) — for a published assignment courseWork: resolve each graded student → GC userId (`resolveExternalIdentity`) → submission id (`listStudentSubmissions`) → PATCH draftGrade; fail-soft + per-student skip reasons; returns a summary {pushed, skipped_no_link, errors}.
- **Open-CORE pin** (`src/lib/google/courseLink.ts`, port) — idempotent per course `courseWorkMaterials` link.
- **Routes** (teacher-only, auth chain + `guardClassAccess`): `POST /api/teacher/google/publish` (publish a unit), `POST /api/teacher/google/grade-passback` (batch send for a published assignment). Both `logAudit`.
- **UI:** a "Publish to Classroom" action on the Quiz Library row + assignment (gated on `google_course_id`); a "Send grades to Classroom" batch button on the gradebook for a published assignment, with a quiet per-student skip summary. (Clean token UI, no gold-plating — redesign on hold.)

## 4. Out of scope (deferred)
Silent-SSO launch (Seg 4 — the pinned link needs normal login until then); Drive import (Seg 5); native GC quizzes; `assignedGrade`/`:return` (never — draftGrade only); auto-push on every grade change (explicit batch this segment); a per-submission passback table (state via `last_sync_error`).

## 5. Constraints (binding)
- **Teacher-controlled, never auto-return** — `draftGrade` only, no `:return`; binding posture, not a default.
- **Four-audience** — quizzes never push a grade (diagnostic); only assignment earned-grades pass back.
- **Fail-soft passback** — `after()` + retry + `last_sync_error`; a Google error never blocks CORE grading/submission, never hard-fails the batch (per-student skip reasons instead).
- **Auth chain unchanged** — `getUser → STAFF_ROLES → guardClassAccess → getValidAccessTokenForTeacher → admin client`; reuse `gcErrorResponse` for connect/scope errors. RLS is not the IDOR backstop.
- **No new scopes** — the two write scopes are already granted; do not broaden.
- **`google_publications` deny-by-default RLS**; admin-client only; gated on `google_course_id`.
- **Audit every publish + passback** via `logAudit` (the 0026 table).
- **V1 = reference only** — port the shape of `gradePassback.ts`/`courseLink.ts`/`google-classroom.ts`/`074_lms_connector.sql`; V2 differs on DRAFT state + draftGrade-only.
- **Pilot-friendly** — small surface (publish + send-grades + pin), fail-soft everywhere, GC controls hidden unless `google_course_id` set.
- Process: writing-plans → pre-code adversarial review → subagent TDD + per-task review → whole-branch review → apply 0027 to NEW CORE + functional/Playwright verify (there IS a small UI here — publish + send-grades buttons) → Marvin merge. Gates: tsc 0, vitest green, build 0.
