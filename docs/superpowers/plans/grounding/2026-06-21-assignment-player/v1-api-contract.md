# V1 Assignment Player — API Data Contract (grounding)

**Scope:** Verbatim current-code facts from V1 (`C:/users/inteliflow/core`) for CORE V2 Epic 2 (the non-SPARK student "Assignment Player": Teli tutor, 3-step hint ladder, drawing canvas, voice/TTS, draft autosave, graded submit+redo). This is a FACTS-ONLY capture — no critique, no proposed changes. Identifiers are quoted exactly.

**V1 user-facing term is still "Homework"** (the page lives at `/student/homework`); V2 renames the UI to "Assignments" but the DB identifiers stay (`homework_attempts`, `homework_drafts`, `assignments`, etc.).

**Files read in full:**
- `app/api/attempts/student-homework/route.ts` (loads assignment + attempt for the player)
- `app/api/attempts/homework-submit/route.ts` (937 lines — grades + writes the attempt + ALL signal side effects)
- `app/api/attempts/homework-adapt/route.ts` (per-task adaptive rewrite)
- `app/api/attempts/homework-draft/route.ts` (cross-device autosave)
- `app/api/attempts/homework-choices/route.ts` (choice-architecture persist)
- `app/api/attempts/homework-list/route.ts` (assignment list for the picker)
- `app/api/attempts/tutor/route.ts` (one of TWO hint-ladder implementations)
- `app/api/attempts/[attemptId]/hint/route.ts` (quiz hint — NOT homework; included for contrast)
- `app/api/attempts/[attemptId]/adapt/route.ts` (quiz Q4/Q5 adapt — NOT homework)
- `app/api/attempts/teli-chat/route.ts` (free-chat Teli, not assignment-tied)
- `app/api/attempts/tutor/route.ts` + `app/(dashboard)/student/homework/actions.ts` (the `sendTutorMessage` / `submitHomework` server actions actually used by the player)
- `app/api/tutor-start/route.ts` (creates a `tutor_session`)
- `app/(dashboard)/student/homework/page.tsx` (1556 lines — the player UI wiring)
- `lib/signals/computeEffortLabel.ts`, `lib/signals/useEventTracker.ts`
- `lib/ai/models.ts`, `lib/teli/prompts.ts`, `lib/openai/prompts.ts` (`tutorSystemPrompt`)

---

## 0. Architecture at a glance (what calls what)

The player (`page.tsx`) wires together:
1. **Load:** `GET /api/attempts/student-homework?assignmentId=…` → `{ assignment, lessonContent, existing }`.
2. **Tutor session:** created client-side via direct `supabase.from('tutor_sessions').insert(...)` in `setupAssignment` (NOT via `/api/tutor-start` — that route exists but the page rolls its own insert). `sessionId` held in React state.
3. **Hint/tutor turn:** `sendTutorMessage(...)` **server action** in `actions.ts` (NOT the `/api/attempts/tutor` route — that's a parallel duplicate). This drives the 3-step hint ladder + writes `tutor_messages` + bumps `tutor_sessions.hint_count`.
4. **Adapt task after 2 hints:** `POST /api/attempts/homework-adapt`.
5. **Autosave draft (3s debounce):** `PUT /api/attempts/homework-draft` + localStorage mirror.
6. **TTS:** `POST /api/attempts/tts`. **Diagram:** `POST /api/attempts/diagram`.
7. **Submit:** `submitHomework(...)` server action (writes `tutor_sessions` completion + `signal_events`) THEN `POST /api/attempts/homework-submit` (grades + everything).

**TWO parallel hint-ladder implementations exist** with identical ladders but different persistence — `app/api/attempts/tutor/route.ts` (the API route) and `actions.ts::sendTutorMessage` (the server action the player actually calls). V2 should consolidate.

---

## 1. `GET /api/attempts/student-homework` — load the player

- **Method:** `GET`. **Query param:** `assignmentId` (optional).
- **Auth:** `createServerSupabaseClient()` → `auth.getUser()` → 401 if no user. Then `createAdminSupabaseClient()` (bypasses RLS). **No role gate, no STAFF_ROLES** — only that the queried rows are scoped `.eq('student_id', user.id)` (object-level IDOR scope).
- **Reads:**
  - `assignments` `select('*')` where `id = assignmentId AND student_id = user.id` (`.single()`). If no `assignmentId` or not found, falls back to most-recent: `assignments` where `student_id = user.id` `order created_at desc limit 1`.
  - If `assignment.lesson_id`: `lessons` `select('parsed_content, title')` where `id = lesson_id`. Sets `lessonContent = lesson.parsed_content`.
  - `homework_attempts` `select('id, status, grade, teacher_notes, ai_feedback, allow_redo')` where `student_id = user.id AND assignment_id = assignment.id` `.maybeSingle()` → `existing`.
- **Writes:** none.
- **Response:** `{ assignment, lessonContent, existing }` (or `{ assignment: null }` when none).
- **NOTE (migration 055 / "1c-1"):** the column is canonically `grade` now; an older PostgREST alias `score:grade` was removed. The client (`setupAssignment`) still reads `existing.grade ?? existing.score` defensively.

---

## 2. `POST /api/attempts/homework-submit` — grade + write the attempt (THE core contract)

This is the largest and most load-bearing route (937 lines). A `GET` variant also exists (below).

### 2.1 Method, auth, request payload
- **Method:** `POST`. **Auth:** `createServerSupabaseClient()` → `auth.getUser()` → 401; then `createAdminSupabaseClient()`. No role gate; ownership enforced by `.eq('student_id', user.id)` on the gate read.
- **Request body (`await req.json()`):**
  - `assignment_id` (required)
  - `class_id` (required) — 400 `Missing assignment_id or class_id` if either absent
  - `diagram_url` (string | null) — a student-work image URL
  - `response_text` (string | null) — legacy flat blob, "Task N: …" joined
  - `responses` (object | null) — **per-task** map. Keys are `String(task.step)` (canonical) OR array index (legacy fallback). Each value is `{ text?: string; image_url?: string }` OR a bare string. Stored verbatim into `homework_attempts.responses`.

### 2.2 Submission gates (server-side, defense-in-depth)
- **Gate read:** `assignments` `select('id, content, spark_attempt_id, spark_sync_failed, status')` where `id = assignment_id AND student_id = user.id` `.maybeSingle()`. 404 `Assignment not found` if missing.
- **Gate 1 — HW completeness:** every task in `content.tasks` must have a non-empty response (text OR image_url). `taskIsAnswered(taskIdx, taskStep)` checks `responses[String(step)] ?? responses[String(idx)]`; legacy single-textarea path accepts `response_text` as covering all. If `missingCount > 0` → **400** `{ error: 'incomplete_homework', message, missing_count, total_tasks }`.
- **Gate 2 — SPARK completion** (only when `spark_attempt_id` set AND `spark_sync_failed !== true`): requires `content.spark_completed_at` set OR `assignment.status === 'completed'`. Else → **400** `{ error: 'spark_not_completed', message }`.

### 2.3 Resubmit / redo lock
- Reads existing `homework_attempts` `select('id, status, diagram_url')`.
- If `existing.status === 'graded'`: re-reads `allow_redo`; if `!allow_redo` → **409** `{ error: 'Already graded' }`.
- **Redo path:** when `allow_redo === true` (teacher unlocked), resubmit is allowed; the update sets `allow_redo: false` again (one redo per unlock).

### 2.4 Persist attempt as `submitted` (before grading)
- If `existing`: UPDATE `homework_attempts` set `diagram_url` (or keep existing), `response_text` (or null), `responses` (the per-task object), `status: 'submitted'`, `submitted_at: now`, `updated_at: now`, `allow_redo: false`.
- Else INSERT `homework_attempts`: `student_id`, `assignment_id`, `class_id`, `diagram_url`, `response_text`, `responses`, `status: 'submitted'`, `submitted_at: now`.
- **Side effect — clear draft:** DELETE `homework_drafts` where `assignment_id = … AND student_id = user.id` (non-blocking, logged on failure).

### 2.5 Grading logic (LLM, via Claude) — `gradeWithAI(...)`
- Grading is done by **Claude** (`claudeChat` from `@/lib/claude/client`), NOT OpenAI, despite a stale "with OpenAI" comment. Model = `CLAUDE_GRADING_MODEL = 'claude-sonnet-4-6'` (calibration-locked). Params: `temperature: 0.3, maxTokens: 800, timeoutMs: 30000`.
- System msg: `"You are CORE, an educational AI grading a student's homework. Return ONLY valid JSON. No markdown code fences."` (wrapped in `withLocaleInstruction`).
- **Prompt inputs:** `assignment_title`, `instructions`, `tasks[]` (`step`, `description`, `type`), `response_text`, `diagram_url` (Yes/No only), `mastery_band` (`reteach | grade_level | advanced`), `learning_style`, `response_time_signals` (a string: `"Written response length: N characters"` or `"No written response"`).
- **Output shape (`GradingResult`):**
  ```
  {
    grade: number,            // 0-100 OVERALL homework grade
    feedback: string,         // 2-3 student-facing sentences (warm)
    teacher_summary: string,  // factual teacher-facing assessment
    task_grades: [ { step, description, grade (0-100), feedback } ],
    cheating_flag: boolean,
    cheating_reason: string | null
  }
  ```
- **Defensive coercion:** if Claude returns `score`/`task_scores` instead of `grade`/`task_grades`, code coerces either shape into canonical `grade`/`task_grades`.
- **Grading rubric (verbatim from prompt):**
  - No written response AND no diagram → grade **5-15** (incomplete).
  - Diagram-only (draw task) → full credit for diagram, partial for missing notes.
  - Grade the CONTENT not effort: one-word answer to multi-step → **5-10**; irrelevant/nonsensical → **0-10**.
  - Off-topic → **0-15** regardless of length. Partial-but-relevant → **20-50**. Complete+correct → **60-100**.
  - Encouraging tone but never inflate. Reteach students: encouraging WORDS, still accurate grade. Advanced: higher standards.
  - Cheating flag if response_time < 5s for long responses, or writing style dramatically exceeds band.
- **Language locks (Barb):** `teacher_summary` describes the RESPONSE not the STUDENT; a forbidden-words list (disengaged, lazy, careless, unmotivated, apathetic, gave up, didn't try, didn't bother); no claimed trends. Inteliflow Strategy/Power vocabulary is additive (12 strategies: Goal First · Knowledge Bridge · Quick Look · Text Detective · Question Quest · Explain It · Note Builder · Idea Mapping · Idea Exchange · Think-Talk-Share · Comprehension Crew · Pause & Reflect; 5 Powers: Monitor · Think · Research · Communicate · Collaborate) — naming is observational, never changes the grade.
- **NO MCQ auto-grade in homework.** Homework is open-response/draw/written only — there is no deterministic auto-grade branch. (Deterministic grading is a QUIZ concept: `lib/math/checkNumericAnswer.ts` for numeric quiz items; the quiz grader is a separate route. Homework grading is 100% LLM.)
- **Grading failure recovery:** on `gradeWithAI` throw → UPDATE `homework_attempts` `status: 'pending_grade', review_required: true`. If THAT write fails → **500** `{ success: false, error: 'grading_not_saved', detail }` (H-2 fix: don't claim success on lost work). If the pending write succeeds → **200** `{ success: true, attempt: { id, status: 'pending_grade' }, message: 'Homework submitted! Grading will complete shortly.' }`.

### 2.6 Timeliness, hint count, effort label
- **Timeliness:** reads `assignments.created_at`. `hoursToSubmit = (now - created_at)/3600000`. `submittedOnTime = hoursToSubmit <= 48`.
- **Teli hint count (THE score-relevant signal):** reads `tutor_sessions` `select('hint_count')` where `student_id = user.id AND assignment_id = assignment_id` `order created_at desc limit 1`. `teliHintCount = hintSession?.hint_count ?? 0`.
- **Effort label:** `computeEffortLabel({ score: grading.grade, teliHintCount })` — see §7. The hint count does **NOT** change the numeric grade; it only feeds the categorical `effort_label`.

### 2.7 The graded UPDATE (`homework_attempts`)
Sets: `grade = grading.grade`, `ai_feedback = grading.feedback`, `teacher_notes = grading.teacher_summary || null`, `status: 'graded'`, `graded_at: now`, `updated_at: now`, `hours_to_submit` (rounded 1dp), `submitted_on_time`, `teli_hint_count`, `effort_label`.
- **Separate non-blocking UPDATE:** `task_grades = grading.task_grades` (separate because the column ships via a reconcile script and may not exist on every env → would PGRST204 the whole write).

### 2.8 Side effects (the MOAT — many, mostly non-blocking)
In order, after the graded write:
1. **LMS grade passback** — `after(async () => pushGradeForResource({ resourceType:'homework', resourceId: lesson_id, classId, studentId, scorePct: grade }))`. Only if `assignment.lesson_id`. Homework keys on the **lesson id**.
2. **Targeted-practice alert auto-resolve** — if `content.kind === 'targeted_practice'`: UPDATE `alerts` set `status:'resolved', resolved_at, resolution_note` where `student_id, class_id, status='open', trigger_reason='teacher_targeted_practice'`.
3. **Reteach loop closure** — if `assignment.reteach_needed && !reteach_completed_at`: set `assignments.reteach_completed_at = now`; resolve open `trigger_reason='teacher_reteach_flag'` alerts; INSERT a new `alerts` row `{ school_id: null, class_id, student_id, severity:'high', trigger_reason:'reteach_completed_pending_review', status:'open', urgent:true }`. Sets `isReteachCompletion = true`.
4. **`review_required` recompute** (non-blocking UPDATE): true if (a) grade in 58-62, OR (b) grade differs >25pts from avg of last ≤3 graded HW (`recentHw` from `homework_attempts.grade`), OR (c) `cheating_flag`.
5. **Persistent student model** — `updateStudentModel(user.id, schoolId, { type:'homework', grade, masteryBand, learningStyle, scaffoldDependency, helpRequestCount }, class_id)`. `scaffoldDependency`/`helpRequestCount` pulled from `tutor_sessions.scaffold_dependency_score` / `help_request_count`.
6. **BNCC mastery roll-up** (pt-BR/EduFlux only; no-ops on en-US/CORE) — `rollUpBnccMastery(...)` per-task attribution; persists `bncc_codes_addressed` / `bncc_competencias_addressed` (migration 069) only when locale is pt-BR.
7. **Cognitive signals (AWAITED, the core pipeline hook):** `await computeSignalsOnSubmit(user.id, schoolId, 'homework', attemptId)` — updates `signal_aggregates`. `attemptId` pins it to THIS attempt. Awaited because Vercel kills unawaited post-LLM work (Bug #36).
8. **Per-skill state recompute (AWAITED):** reads `assignments.skill_ids`; if any → `recomputeSkillStatesForStudent(admin, { studentId, schoolId, skillIds })` (Can't-vs-Time states).
9. **Virtual Hug effort eval** — `after(() => tryHomeworkEffortHug({ admin, studentId, schoolId, homeworkAttemptId: attemptId }))`.
10. **Learning-Support signals** — `after(...)` if `schools.ls_intelligence_enabled` → `computeLSSignals(user.id, schoolId, attemptId, 'homework', admin)`.
11. **Low-grade teacher alert** — if `grade < RETEACH_GRADE_THRESHOLD` (=`60`): if no open alert exists for (student, class), INSERT `alerts` `{ school_id, class_id, student_id, severity: grade<40?'high':'medium', trigger_reason:'homework_low_score', status:'open', urgent: grade<40 }`. (`'homework_low_score'` is the persisted enum key; UI copy says "low grade".)
12. **Parent email** — fire-and-forget `POST {APP_URL}/api/teacher/email/graded` with header `x-internal-secret: INTERNAL_API_SECRET`, body `{ student_id, assignment_title, grade, score (dup), feedback, class_name }`.
13. **XP awards** (non-blocking): `XP.HOMEWORK_ON_TIME` if on time; `XP.HOMEWORK_SCORE_ABOVE_80` if grade≥80; `XP.EFFORTFUL_SUCCESS` if `effort_label === 'effortful_success'`. Increments `student_gamification.total_homework_completed`.
14. **Google Classroom grade sync** — fire-and-forget `POST {APP_URL}/api/teacher/google/grades` with `x-internal-secret`, body `{ studentId, classId, score: grade, attemptType:'homework', attemptId, title }`.
15. **Trial event** — if `schools.is_trial`: `logTrialEvent(admin, schoolId, user.id, 'homework_submitted', { score: grade })`.
16. **Product analytics** — `track('homework_submitted', user.id, { service:'core', school_id, user_role:'student', assignment_id, homework_attempt_id, class_id, task_count, on_time })`. PII contract: opaque IDs + task count + on_time only — NO grade %, no response content.

### 2.9 Success response shape
```
{
  success: true,
  attempt: graded,            // the full graded homework_attempts row
  grade: grading.grade,       // 0-100
  feedback: grading.feedback, // student-facing
  task_grades: grading.task_grades,
  reteach_completion: isReteachCompletion  // boolean
}
```
(Migration 055 / "1c-1": legacy `score` alias removed from response; client reads `grade`.)

### 2.10 `GET /api/attempts/homework-submit`
- Query `assignment_id` (required, else 400). Auth as above. Reads `homework_attempts.select('*')` for (student, assignment) `.maybeSingle()` → `{ attempt }`. Used to re-hydrate an attempt.

---

## 3. `POST /api/attempts/homework-adapt` — per-task adaptive rewrite (NOT next-question)

- **Method:** `POST`. **Auth:** `createServerSupabaseClient()` → `auth.getUser()` → 401. (No admin client, no ownership check — it only rewrites task text the caller supplies.)
- **Request body:** `task_description` (required, else 400), `task_type`, `mastery_band`, `learning_style`, `hint_count`, `assignment_title`.
- **Logic:** `mode = hint_count >= 3 ? 'simplified' : 'scaffolded'`. Two `modeInstructions`: `simplified` (3+ hints, "simplify significantly — smaller steps, simpler language, sentence starters / fill-in-the-blank, keep objective lower barrier"); `scaffolded` (2 hints, "add scaffolding — partial example, sentence starter, step-by-step framework, same task more approachable").
- **Model:** OpenAI `OPENAI_GEN_MODEL = 'gpt-4o'`, `temperature: 0.6, max_tokens: 600, response_format: json_object`. System prompt wrapped in `withCurriculumInstruction(withLocaleInstruction(...))`.
- **Response:** `{ adapted_description, scaffold_note, difficulty, encouragement }` (each with a fallback default). NO DB write — purely transforms text; the client holds `adaptedTasks[idx]` in state.
- **Player trigger:** `adaptTask(idx)` is called from `handleAskTutor`/`handleVoiceTranscript` when `taskHelpRequests.current[idx] >= 2` AND not already adapted. Passes `hint_count: taskHelpRequests.current[idx] || 0`.

> NOTE: `app/api/attempts/[attemptId]/adapt/route.ts` is a DIFFERENT route — it adapts QUIZ Q4/Q5 (operates on `quiz_attempts` / `quiz_questions` / `quiz_responses`, caches into `quiz_attempts.adapted_questions`). It is NOT part of the homework/assignment player. Included only to disambiguate the name collision.

---

## 4. `/api/attempts/homework-draft` — cross-device autosave (migration 064)

- **Self-scoped**, defense-in-depth (route checks `student_id` AND RLS policy). All ops use `createAdminSupabaseClient()`. Table: `homework_drafts` (columns: `assignment_id`, `student_id`, `draft_state` jsonb, `last_active_at`).
- **`GET ?assignment_id=X`** → reads `homework_drafts.select('draft_state, last_active_at')` for (assignment, student) `.maybeSingle()` → `{ draft: { draft_state, last_active_at } }` or `{ draft: null }`.
- **`PUT { assignment_id, draft_state }`** → validates `draft_state` is an object (400 otherwise); verifies `assignments.student_id === user.id` (404/403); UPSERT `homework_drafts` `{ assignment_id, student_id, draft_state, last_active_at: now }` `onConflict: 'assignment_id'` → `{ ok: true }`.
- **`DELETE ?assignment_id=X`** → DELETE where (assignment, student) → `{ ok: true }`. (Also called from homework-submit §2.4.)
- **`draft_state` shape** (from `page.tsx`): `{ completedTasks: number[], taskResponses: Record<number,string>, taskImages: Record<number,string>, currentTaskIndex: number, phase: 'read'|'tasks' }`.
- **Player autosave:** 3s debounced `PUT` on any change to `completedTasks / taskResponses / taskImages / currentTaskIndex / phase`; mirrored synchronously to `localStorage['hw-progress-{assignmentId}']`. On mount, restores from server first, falls back to localStorage. `localStorage` cleared after successful submit.

---

## 5. `POST /api/attempts/homework-choices` — choice-architecture persist (V6 Prompt 6 Part B)

- **Method:** `POST`. **Auth:** `auth.getUser()` → 401; `createAdminSupabaseClient()`.
- **Request:** `{ attempt_id, choices }` (both required, else 400). `choices` is a `StudentChoices` object (from `lib/student/choiceArchitecture`).
- **Reads:** `homework_attempts` joined to `assignments(content, choice_settings, lesson_id, lessons(subject))` by `id = attempt_id`.
- **Guards:** 404 if not found; **403** `'Not your attempt'` if `student_id !== user.id`; **409** if `status` is `'submitted'` or `'graded'` (choices locked after submit).
- **Validation:** `normalizeChoiceSettings(choice_settings, ctx)` (re-applies reading-comp lock server-side), then `validateStudentChoices(choices, settings, availableProblems)` where `availableProblems = content.tasks[].id`. On failure → **422** `{ error: 'Choice rejected', reason }`.
- **Write:** UPDATE `homework_attempts` set `student_choices = choices`. → `{ ok: true }`.
- (Choice architecture is an optional V1 feature — task selection per teacher `choice_settings`. May be out-of-scope for V2 Epic 2 MVP but documented for completeness.)

---

## 6. `GET /api/attempts/homework-list` — assignment picker

- **Method:** `GET`. **Query:** `class_id` (optional). **Auth:** `auth.getUser()` → 401; `createAdminSupabaseClient()`.
- **Reads:** active `enrollments.class_id` for student → `classes(id, name, grade_level, teacher_id)` → `users(id, full_name)` for teacher names → `assignments` `select('id, content, class_id, created_at, mastery_band, learning_style, assignment_mode, spark_experiment_id, spark_attempt_id, status')` for student in target classes `order created_at desc` → `homework_attempts` `select('assignment_id, status, grade, ai_feedback')`.
- **Response:** `{ classes: [{id, name, grade_level, teacher_name}], homework: [...] }`. Each `homework` item:
  - `assignment_id, title (content.title), class_id, class_name, teacher_name, created_at`
  - `status`: `spark_experiment` mode → `assignment.status || 'assigned'`; else → `attempt.status || 'pending'`.
  - `score`: spark → `content.spark_score`; else → `attempt.grade ?? null`. (Response key kept as `score` for client compat; value sourced from `grade` column.)
  - `feedback (attempt.ai_feedback), assignment_mode, spark_experiment_id, spark_attempt_id, effort_label, spark_rubric_dimensions, spark_ai_layer, spark_completed_at, spark_content_quality` (spark fields null for standard).
- **Player:** `loadHomeworkList(classId?)` populates the `HomeworkListView` picker.

---

## 7. The hint ladder (Teli tutor) — the pedagogical core

**TWO implementations, identical ladder, different persistence.** The player calls the SERVER ACTION, not the route.

### 7.1 The ladder (verbatim, in both)
```js
const HINT_LADDER = ['nudge', 'cue', 'step', 'answer_blocked'];  // 4 rungs
getHintType(d) = HINT_LADDER[Math.min(d, 3)]
```
Hint instructions (verbatim, route version):
- `nudge`: "Ask a thought-provoking question pointing the right direction. Do NOT give any part of the answer."
- `cue`: "Narrow the focus with a key concept or vocabulary term. Do not give the answer."
- `step`: "Give step-by-step scaffold. Walk through the approach. Do not give the final answer."
- `answer_blocked`: "Student used all hints. Encourage effort. Summarize key concept for next time. No direct answer."

`TELI_HINT_LABELS` (UI, `lib/teli/prompts.ts`): `nudge`→"💭 Teli Nudge", `cue`→"🔑 Teli Cue", `step`→"📋 Teli Walkthrough", `answer_blocked`→"🚫 Hints exhausted".

### 7.2 Scaffold counter mechanics (per `tutor_session`)
On each `is_help_request`:
```
helpRequestCount += 1
hintType = HINT_LADDER[Math.min(newScaffoldDepth, 3)]
newScaffoldDepth = Math.min(newScaffoldDepth + 1, 3)
hintCount += 1
```
Returns `{ response, hint_type, scaffold_depth, hints_remaining: Math.max(0, 3 - newScaffoldDepth), help_request_count }`. **3 hints per task**; client also hard-caps `if (hintsRemaining <= 0) return`. `scaffold_depth` resets to 0 client-side per task (`handleTaskStart` / `handleTaskComplete` set `setScaffoldDepth(0); setHintsRemaining(3)`), but `tutor_sessions.hint_count` is **cumulative across the whole session** (this is what feeds `teli_hint_count` at submit).

### 7.3 `actions.ts::sendTutorMessage` (the one the player uses)
- Args: `(sessionId, message, taskIndex, taskDescription, isHelpRequest, messageHistory[])`.
- Reads `tutor_sessions` + `assignments(*)`; same ladder math.
- Personalization: reads `student_model.select('dominant_style, struggle_topics, preferred_scaffold_level')` → `buildTeliPrompt(teliOpts)`.
- System prompt = `withLocaleInstruction(buildTeliPrompt(...) + '\n\n' + tutorSystemPrompt(content, '') + hintInstruction)`. `hintInstruction` includes `CURRENT TASK: {taskDescription}`, a `DIAGRAM SHOWN TO STUDENT: …` clause if `content.diagram_description`, and the rung's `HINTS[hintType]`.
- Model: **`OPENAI_GEN_MODEL = 'gpt-4o'`**, `temperature: 0.7, max_tokens: 500`. (The `/api/attempts/tutor` ROUTE uses `OPENAI_VOICE_MODEL` instead — divergence between the two.)
- **Writes:** INSERT 2 `tutor_messages` (user + assistant) with `{ session_id, student_id, role, content, message_index, task_index, is_help_request, hint_type, scaffold_level }`; UPDATE `tutor_sessions` set `scaffold_depth, help_request_count, hint_count, last_activity_at`.

### 7.4 `tutor_sessions` lifecycle
- **Created** (player `setupAssignment` OR `/api/tutor-start`): INSERT `{ assignment_id, student_id, class_id, lesson_id, mastery_band, learning_style, status:'active', started_at, scaffold_depth:0, help_request_count:0, hint_count:0 }`. `/api/tutor-start` also writes an `audit_logs` row.
- **Completed** (`actions.ts::submitHomework`, called BEFORE `homework-submit`): UPDATE `tutor_sessions` set `status:'completed', completed_at, tasks_completed, tasks_total, scaffold_dependency_score`. `scaffoldDependency = min(1, totalHelpRequests / (totalTasks * 3))`. Then INSERT one `signal_events` row per task `{ user_id, session_id, class_id, signal_family:'behavioral', event_type:'homework_task', payload: task, source_module:'homework', schema_version:'v1' }`.

### 7.5 Teli prompts (`lib/teli/prompts.ts`)
- `TELI_SYSTEM_PROMPT`: "You are Teli, a warm and encouraging Socratic AI tutor for K-12 students… NEVER reveal answers directly — always guide with questions. Keep responses under 3 sentences. … offer a DIFFERENT approach (analogy/visual/simpler example) when stuck twice. … name the THINKING move when the student unblocks themselves."
- `buildTeliPrompt({ dominantStyle, struggleTopics, scaffoldLevel })` appends style hint + struggle topics + scaffold-depth guidance.
- `TELI_INTRO_MESSAGE`, `TELI_CATCHPHRASES` exist.
- `tutorSystemPrompt(assignmentContent, lessonSummary)` (`lib/openai/prompts.ts:1098`): "You are a helpful AI tutor for a K-12 student using the Inteliflow Learning Strategy approach. … NEVER state the direct answer. 8 Socratic rules. Reference the learning strategy when helpful (e.g., 'Let's try the Knowledge Bridge strategy…')."

---

## 8. `computeEffortLabel` (`lib/signals/computeEffortLabel.ts`) — THE single classification rule

```ts
type EffortLabel = 'effortful_success' | 'struggling_trying'
                 | 'independent_success' | 'independent_struggle';
SUCCESS_THRESHOLD = 75;   // score >= 75 = "success"
EFFORT_THRESHOLD  = 2;    // hints >= 2 = "effortful"

computeEffortLabel({ score, teliHintCount }):
  if (score == null) return null;        // ungraded → unclassifiable
  hints = teliHintCount ?? 0;
  isSuccess = score >= 75; isEffortful = hints >= 2;
  success & effortful   → 'effortful_success'
  !success & effortful  → 'struggling_trying'
  success & !effortful  → 'independent_success'
  else                  → 'independent_struggle'
```
The function signature uses `score` (it's the homework `grade` value passed in). `STRUGGLING_LABELS = ['struggling_trying','independent_struggle']`. The hint count affects ONLY this label, never the numeric grade.

---

## 9. Signal tracking (`lib/signals/useEventTracker.ts`)

- Hook config: `{ studentId, context: 'homework', contextId: assignment.id, schoolId, enabled }`. Generates a client `sessionId` (uuidv4).
- **Batching:** buffers events, flushes every `15_000ms` to `POST /api/teacher/events-v5` body `{ sessionId, studentId, context, contextId, schoolId, events }`. Re-queues on failure. Flushes on `beforeunload`.
- **Auto-tracked events:** `session_start`, `session_end`, `keypress`, `backspace`, `pause_start`/`pause_end` (gap ≥ `3_000ms`), `focus_loss`/`focus_gain`.
- **Returns:** `trackEvent(type, payload)`, `trackQuestionAttempt(data)`, `flushAndCompute()` (`flushAndCompute` only flushes now — the old client-side `signals-v5` compute was removed; signals compute server-side at submit via `computeSignalsOnSubmit`).
- **Player emits** (manual): `homework_resume`, `diagram_view`, `tts_play`/`tts_replay`, `hint_request` (`{ taskIndex, taskDescription, input_method? }`), `question_next`, plus `trackQuestionAttempt({ questionId, questionIndex, isCorrect, timeTakenMs, changeCount, hintsUsed })` per completed task.

---

## 10. The player UI (`page.tsx`, 1556 lines) — features to port

- **Two-phase progressive disclosure:** `phase: 'read' | 'tasks'`. Read phase shows reading passage / lesson summary / diagram / YouTube link; tasks phase shows the per-task carousel.
- **Per-task carousel state:** `currentTaskIndex`, `completedTasks: Set<number>`, `taskResponses: Record<number,string>`, `taskImages: Record<number,string>`, `tutorMessages: Record<number, TutorMessage[]>`.
- **Drawing canvas (`<canvas>`):** tools `pen | pencil | eraser | line | text | rect | circle | arrow`; `strokeColor`, `strokeWidth`, `fillColor`, `showGrid`; full undo/redo stacks (`ImageData`, cap 20), Ctrl/Cmd+Z / +Y keyboard shortcuts; touch handlers; saves canvas via `canvas.toBlob('image/png')` → `supabase.storage.from('student-work').upload(...)` → public URL into `taskImages[idx]`. Image input modes: `upload | url | draw`.
- **Image upload:** `supabase.storage.from('student-work')`, path `{userId}/task-{idx}-{ts}.{ext}`.
- **TTS:** `generateAudio(text)` → `POST /api/attempts/tts` (returns audio blob). Uses `content.audio_script || content.reading_passage`. `<audio>` element + play/pause. Also `TeliVoiceButton` + `teliSpeak(...)` (browser TTS) for Teli responses. Voice INPUT via `handleVoiceTranscript` (speech-to-text → `sendTutorMessage(..., true, ...)`).
- **Diagram:** `generateDiagram(prompt, title, withVideo)` → `POST /api/attempts/diagram` (returns `{ svg, image_url, video_url, mermaid, excalidraw, engine }`). Video requested for `visual|kinesthetic|tactile` learners. Fullscreen overlay.
- **Adapt-after-2-hints:** `adaptTask(idx)` rewrites the task in place (see §3).
- **Submit gates (client mirror of server §2.2):** `canSubmit = allTasksDone && !sparkBlocking`. SPARK blocks when `spark_attempt_id && spark_sync_failed !== true && sparkStatus !== 'completed'`.
- **State screens** (`components/student/homework/StateScreens`): `LoadingScreen`, `NoHomeworkScreen`, `SubmittedScreen`, `GradedLockedScreen`, `SubmittingScreen`, `DoneScreen` (confetti). `HomeworkListView` is the picker.
- **Redo banner:** shown when `allowRedo` (teacher unlocked). "Option D" (Barb 2026-05-11): redo banner shows only the qualitative pill label (`hwGradePill(grade)`), NEVER the raw % — four-audience discipline. Student surfaces never show the raw grade number on redo.
- **Submit response handling:** on `hwRes.ok && hwData.success` → sets graded state from `hwData.grade ?? hwData.attempt?.grade`, `hwData.feedback`; if `hwData.reteach_completion` → reteach confirmation message. Else → red `submitError`.

---

## 11. Model IDs (`lib/ai/models.ts`) — exact

- `CLAUDE_GRADING_MODEL = 'claude-sonnet-4-6'` — homework + quiz grading + HW differentiation. Calibration-LOCKED. (Used by `homework-submit` via `claudeChat`.)
- `OPENAI_GEN_MODEL = 'gpt-4o'` — generation/diagnostic: lesson/quiz/homework generation, learning-style, **homework-adapt**, and the **`sendTutorMessage` server action**.
- `OPENAI_VOICE_MODEL = process.env.OPENAI_VOICE_MODEL || 'gpt-4o'` — voice/tone surfaces: Teli chat, the `/api/attempts/tutor` ROUTE (not the action), hugs, parent narrative, study guide. Pilot-overridable.
- `tokenLimitParams(model, n)` / `usesLegacyTokenParam(model)` helpers handle `max_tokens` vs `max_completion_tokens`.

---

## 12. DB tables + columns the player touches (consolidated)

- **`assignments`**: `id, student_id, class_id, lesson_id, content (jsonb), mastery_band, learning_style, assignment_mode, status, reteach_needed, reteach_completed_at, scaffold_level, skill_ids, choice_settings, spark_attempt_id, spark_experiment_id, spark_sync_failed, created_at`. `content` jsonb fields used: `title, instructions, tasks[] ({step, description, type, id?, bncc_codes?, bncc_competencias_gerais?}), reading_passage, audio_script, diagram_svg_prompt, diagram_image_prompt, diagram_description, diagram_mode, youtube_search_query, kind, spark_completed_at, spark_score, spark_effort_label, spark_rubric_dimensions, spark_ai_layer, spark_content_quality`.
- **`homework_attempts`**: `id, student_id, assignment_id, class_id, diagram_url, response_text, responses (jsonb per-task), student_choices (jsonb), status ('submitted'|'graded'|'pending_grade'), submitted_at, graded_at, updated_at, grade (0-100, was 'score' pre-055), ai_feedback, teacher_notes, task_grades (jsonb), allow_redo, review_required, hours_to_submit, submitted_on_time, teli_hint_count, effort_label, bncc_codes_addressed, bncc_competencias_addressed`.
- **`homework_drafts`** (migration 064): `assignment_id (unique), student_id, draft_state (jsonb), last_active_at`.
- **`tutor_sessions`**: `id, assignment_id, student_id, class_id, lesson_id, mastery_band, learning_style, status ('active'|'completed'), started_at, completed_at, last_activity_at, scaffold_depth, help_request_count, hint_count, tasks_completed, tasks_total, scaffold_dependency_score`.
- **`tutor_messages`**: `session_id, student_id, role, content, message_index, task_index, is_help_request, hint_type, scaffold_level`.
- **`signal_events`**: `user_id, session_id, class_id, signal_family, event_type, payload (jsonb), source_module, schema_version`.
- **`alerts`**: `school_id, class_id, student_id, severity, trigger_reason, status, urgent, resolved_at, resolution_note`. Trigger reasons seen: `homework_low_score`, `reteach_completed_pending_review`, `teacher_reteach_flag`, `teacher_targeted_practice`, `teacher_light_checkin`.
- **`lessons`**: `id, parsed_content (jsonb), title, subject`.
- Also touched: `classes (school_id, name, teacher_id, grade_level)`, `users (school_id, full_name, role)`, `enrollments (class_id, is_active)`, `student_model`, `student_gamification`, `schools (is_trial, ls_intelligence_enabled)`, `audit_logs`.

---

## 13. Open questions for the V2 spec author

1. **Two hint-ladder implementations** — `/api/attempts/tutor/route.ts` (uses `OPENAI_VOICE_MODEL`, persists `tutor_messages` with no `message_index`) vs `actions.ts::sendTutorMessage` (uses `OPENAI_GEN_MODEL`, includes `message_index`). The player uses the ACTION. V2 must pick ONE. Which model/persistence is canonical?
2. **`teli_hint_count` source is the LATEST `tutor_session` for (student, assignment)** ordered by `created_at desc`. If a student starts multiple sessions, only the newest counts. Is that intended in V2?
3. **Homework grading is 100% LLM (Claude), no MCQ/deterministic path** — unlike the quiz runner which has numeric auto-grade. V2 Assignment Player should confirm it inherits the LLM-only model (assignments are open-response/draw/written, not MCQ).
4. **`task_grades` column ships via a reconcile script** and may not exist on a fresh env — V2's schema should include it natively (no separate non-blocking update needed).
5. **`responses` (per-task) vs `response_text` (flat blob) dual-write** — V1 keeps both for backward compat; grading still reads only `response_text`. V2 can collapse to per-task only if the grader is updated to consume `responses`.
6. **Choice architecture** (`homework-choices`, `student_choices`, `choice_settings`) — is this in scope for V2 Epic 2, or deferred?
7. **`student-work` Supabase Storage bucket** must exist in V2 for canvas/image uploads (public URLs).
8. **Many side effects assume sibling systems exist** (LMS passback, Google Classroom, parent-email route, hugs, LS signals, BNCC, XP, trial events). V2 must decide which are wired at Epic-2 time vs stubbed. The MOAT-critical one is `computeSignalsOnSubmit` (awaited) + `recomputeSkillStatesForStudent` (awaited) — these light up the signals pipeline.
9. **Confirm `homework_drafts` cross-device autosave + localStorage fallback** is in scope (it's the "draft autosave" requirement).
