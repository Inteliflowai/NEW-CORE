# Grounding — CORE V2 Epic 2: the non-SPARK Assignment Player

> **Status:** verbatim-facts grounding only. NO solution design — this consolidates
> the 10 reader fragments under
> `docs/superpowers/plans/grounding/2026-06-21-assignment-player/` for the spec author.
> Each fragment is the cited source; identifiers are quoted exactly.
>
> **What the epic is.** V2's teacher signal layer + weekly-snapshot cron + parent
> narrative already SELECT `homework_attempts` columns, but **no runtime route writes
> `homework_attempts` today** — the only writers are the demo/trial seeders. The
> Assignment Player is **the missing producer**: it lights up the whole signals
> pipeline (Today/roster/student-drill/growth/parent all starve without it). The
> flagship V1 reference is `C:/users/inteliflow/core/app/(dashboard)/student/homework/page.tsx`
> (~1557 lines). **V1 user-facing term = "Homework"; V2 renames the UI to
> "Assignments" but keeps DB identifiers (`homework_attempts`, `/api/attempts/homework-*`).**
>
> **Fragment index** (all under the dated subfolder): `v1-player-page.md`,
> `v1-teli-tutor.md`, `v1-api-contract.md`, `v1-data-model.md`, `v1-voice-tts.md`,
> `v1-components.md`, `v2-quiz-plumbing.md`, `v2-assignments-surface.md`,
> `v2-data-consumers.md`, `v2-copy-discipline.md`.

---

## What V1 Does

The player is a single ~1557-line `'use client'` component (`HomeworkPage`, wrapped in
`<Suspense>` for `useSearchParams`). All styling is **inline `style={{}}` with hardcoded
hex** (no token system) — a load-bearing V2 re-skin cost, not a portable asset.
[`v1-player-page.md` §intro; `v1-components.md` cross-cutting]

### Top-level state machine (sequential `if`-chain; FIRST match wins)
[`v1-player-page.md` §1a, page.tsx ~786–832]
1. `loading` → `LoadingScreen`
2. `showList` → `HomeworkListView` (when no `assignmentId` param or assignment missing)
3. `!assignment` → `NoHomeworkScreen`
4. `homeworkStatus==='submitted'` → `SubmittedScreen`
5. `homeworkStatus==='graded' && !allowRedo && !done` → `GradedLockedScreen`
6. `done` → `DoneScreen` (confetti)
7. `submitting` → `SubmittingScreen`
8. else → the **main two-phase player** (`read` phase, then `tasks` phase)

State vars: `loading, showList, assignment, homeworkStatus ('none'|'submitted'|'graded'),
done, submitting, allowRedo, phase ('read'|'tasks'), sessionId, currentTaskIndex,
completedTasks:Set, taskResponses:Record<number,string>, taskImages:Record<number,string>,
tutorMessages:Record<number,TutorMessage[]>, hintsRemaining (init 3), scaffoldDepth (init 0),
teliState`, plus drawing-canvas, diagram, TTS, and signal-ref state.

### The two-phase flow (the core UX)
[`v1-player-page.md` §1d, §1c]
- **Phase `read`**: reading passage (or lesson-summary fallback) + diagram + YouTube link +
  centered **"Ready to start?"** CTA. `setPhase('tasks')` enters tasks.
- **Phase `tasks`**: "Back to passage" link; progress dot-rail (`Task X of Y`, clickable
  `handleTaskStart(i)`); a **268px sidebar / 1fr task-area grid**; the task card; the inline
  Teli panel; the submit panel.
- Auto-resume effect forces `read → tasks` on mount if any work exists.
- **There is NO "I got this" control on this page** — the closest is per-task "Mark Complete"
  (`handleTaskComplete`) and the "Start Tasks" phase transition. (`IGotThisOffer` is a separate
  modal component, not wired into the core player loop.)

### Question/task types — ONE answer primitive
[`v1-player-page.md` §2; `v1-components.md` §helpers]
- **Exactly one capture primitive per task: a free-text `<textarea>`** bound to
  `taskResponses[idx]`. **NO MCQ / numeric / choice inputs exist** anywhere in the player.
- `task.type` is free-form; known values from `TASK_TYPE`: **`read, write, draw, discuss,
  create, analyze`**. Type only changes the placeholder, the pill, and which visual/voice
  panels show.
- `isVisualTask(t)` = `type==='draw'||'create'` OR description includes
  `diagram|drawing|draw|visual|sketch|label` → shows the drawing/image panel.
- "explain aloud"/`discuss` tasks add a `<TeliVoiceButton size=48>` whose transcript **appends**
  into the textarea.
- `canComplete = (!!taskImages[i] || !!taskResponses[i]?.trim()) && !completedTasks.has(i)`.

### Hint ladder UX (client side)
[`v1-player-page.md` §3; `v1-teli-tutor.md` §6]
- **3 hints per task** (`hintsRemaining` init 3; reset to 3 on every task switch via
  `handleTaskStart`/`handleTaskComplete`). `scaffoldDepth` resets to 0 per task.
- **Hard client gate:** both `handleAskTutor()` and `handleVoiceTranscript()` `return` early if
  `hintsRemaining <= 0` (comment: guards a known server/client off-by-one).
- **Every message is a help request** — `isHelpRequest` hardcoded `true`; there is no separate
  "give me a hint" button. Typing OR speaking to Teli consumes a hint.
- After **≥2 hint requests** on a task, the page auto-calls `adaptTask(idx)` (see API §3).

### Drawing canvas (hand-rolled, no library)
[`v1-player-page.md` §4]
- Raw `<canvas width=560 height=320>`, shown when `imageMode==='draw'`.
- **8 tools:** `pen, pencil, eraser, line, text, rect, circle, arrow`; stroke width `[1,2,4,7]`;
  8 preset colors + custom color; fill (rect/circle); grid toggle; **undo/redo** (ImageData
  stacks cap 20, Ctrl/Cmd+Z/Y); mouse AND touch input.
- Save: `canvas.toBlob('image/png')` → **Supabase Storage bucket `student-work`**, path
  `${user.id}/task-${idx}-drawing-${ts}.png` → `getPublicUrl` → `taskImages[idx]`. **Flattened
  PNG only — no stroke/vector data persisted.**
- Other image modes (`upload`, `url`) write the same `taskImages[idx]` slot.

### Voice / TTS (supplemental, never on the critical path)
[`v1-voice-tts.md`; `v1-player-page.md` §5]
- Provider = **100% OpenAI**. TTS = `tts-1`, voice `nova`, speed `0.9`, MP3. STT = `whisper-1`,
  `language=getBrand().locale`.
- **Read-aloud:** auto-`generateAudio(content.audio_script || content.reading_passage)` → `POST
  /api/attempts/tts` → audio blob → `<audio ref>` + Listen/Pause pill.
- **Teli replies spoken** via `teliSpeak()` (browser/identity path, gated by `localStorage
  'teli_muted'`, 500-char client truncation, fails silently).
- **Voice input:** `TeliVoiceButton` → MediaRecorder (webm→mp4, min 500ms / max 30s) → multipart
  `POST /api/attempts/teli-voice` field `audio` → `{ transcript }`.
- **Voice is optional**: TTS fails silently, mic degrades to typing, passage always renders as
  text. Tier caps return graceful 429 `cap_reached`.

### Draft autosave (two layers)
[`v1-player-page.md` §6; `v1-api-contract.md` §4]
- **localStorage** (immediate): `hw-progress-${assignment.id}` = the draft blob, on every change.
- **Server draft** (durable, cross-device): 3s-debounced `PUT /api/attempts/homework-draft`.
- **Restore on mount**: `GET /api/attempts/homework-draft` first, localStorage fallback.
- `draft_state` shape: `{ completedTasks:number[], taskResponses, taskImages, currentTaskIndex,
  phase:'read'|'tasks' }`. localStorage cleared + server draft DELETEd on successful submit.

### Submit + redo
[`v1-player-page.md` §7; `v1-api-contract.md` §2; `v1-data-model.md` §1.4]
- Submit fires `submitHomework()` server action (writes `tutor_sessions` completion +
  `signal_events`) + `flushAndCompute()`, THEN awaits `POST /api/attempts/homework-submit`.
- **Submit body:** `{ assignment_id, class_id, diagram_url, response_text (legacy flat "Task N:"
  blob), responses (per-task keyed by String(task.step), {text, image_url?}) }`.
- **Graded view NEVER shows raw % to the student** (Option-D reversal, Barb 2026-05-11): renders
  `hwGradePill(grade)` qualitative pill only, plus `ai_feedback` ("CORE Feedback") and
  `teacher_notes` ("Teacher Feedback"). NOTE: HW grades remain visible to students as a *band/pill*
  (`HomeworkAttemptState.grade` IS passed to Done/Graded screens) — only quiz scores are stripped
  entirely. [`v1-components.md` §6]
- **Redo:** `allow_redo` (teacher-set) unlocks editing; no `is_redo` in the submit payload — the
  server distinguishes by the existing attempt row; resubmit sets `allow_redo:false`.
- **SPARK submit gate:** if `spark_attempt_id` set and not `spark_sync_failed`, requires
  all-tasks-done AND `sparkStatus==='completed'`. The SPARK card renders once at top,
  parallel/additive — never a homework task.
- `trackQuestionAttempt` **hardcodes `isCorrect:true`** — there is no per-task correctness in the
  runner; grading is fully server-side. Homework is blocked during an active quiz via
  `sessionStorage 'quiz_in_progress'`.

### State screens & presentational components (port structure, re-skin styling)
[`v1-components.md`]
- `StateScreens.tsx`: `LoadingScreen, NoHomeworkScreen, SubmittedScreen, GradedLockedScreen,
  DoneScreen, SubmittingScreen` — full-screen centered shells. `DoneScreen` fires
  `ConfettiCelebration` with **hardcoded `xpEarned=150`**.
- `HomeworkListView.tsx`: the launch list, with a parallel **SPARK Challenges** section above
  standard rows; per-status pills (graded/submitted/pending); graded rows show `hwGradePill(score)`
  (qualitative, no %).
- `Btn.tsx`: shared button (props `color/disabled/fullWidth/outline/small`, `shadeColor` hover).
- Peripheral / likely-out-of-scope: `ChoiceBlock` (choice architecture → `student_choices`),
  `IGotThisOffer` (mastery-shortcut/go-deeper modal), `HugInlineNotification` (virtual-hug toast).

---

## V1 Data & API Contract

### Routes (every fetch the player makes)
[`v1-player-page.md` §8; `v1-api-contract.md` §§1–6]

- **`GET /api/attempts/student-homework?assignmentId=<id>`** → `{ assignment, lessonContent
  (=lessons.parsed_content), existing:{ id, status, grade, teacher_notes, ai_feedback, allow_redo } }`.
  Auth: `getUser()`→401, admin client, scoped `.eq('student_id', user.id)`. No role gate. No write.
- **`GET /api/attempts/homework-list[?class_id=]`** → `{ classes:[{id,name,grade_level,teacher_name}],
  homework:[{assignment_id, title, class_id, class_name, teacher_name, created_at, status,
  score(=grade), feedback, assignment_mode, spark_*}] }`.
- **`PUT /api/attempts/homework-draft`** body `{ assignment_id, draft_state:{completedTasks,
  taskResponses, taskImages, currentTaskIndex, phase} }`; **GET ?assignment_id** → `{ draft:{
  draft_state, last_active_at} }`; **DELETE ?assignment_id**. Upsert `onConflict:'assignment_id'`.
- **`POST /api/attempts/homework-submit`** (the core, ~937 lines) — see below.
- **`POST /api/attempts/homework-adapt`** body `{ task_description, task_type, mastery_band,
  learning_style, hint_count, assignment_title }` → `{ adapted_description, scaffold_note,
  difficulty, encouragement }`. `mode = hint_count>=3 ? 'simplified' : 'scaffolded'`. `gpt-4o`
  temp 0.6. **NO DB write** (client holds `adaptedTasks[idx]`). [`v1-api-contract.md` §3]
- **`POST /api/attempts/tts`** body `{ text }` → raw MP3 (`audio/mpeg`, `Cache-Control: public,
  max-age=3600`). OpenAI `tts-1`/`nova`/0.9, input `slice(0,4096)`. Cap `tts_characters`,
  429 `cap_reached`.
- **`POST /api/attempts/teli-voice`** multipart field `audio` → `{ transcript, duration_ms }`
  (200) or `{ transcript:'', error:'too_short'|'cap_reached'|'transcription_failed' }`.
  `whisper-1`, `language=getBrand().locale`, guard `size<1000`. Cap `whisper_seconds`.
  (`/api/attempts/transcribe` is a byte-for-byte twin with a different analytics label.)
- **`POST /api/attempts/diagram[?video=true]`** body `{ prompt, title, image_prompt, mode }` →
  `{ svg?, image_url?, video_url?, mermaid?, excalidraw?, engine? }`. Supplemental; non-200 ignored.
- **`POST /api/attempts/homework-choices`** body `{ attempt_id, choices }` → `{ ok:true }` (choice
  architecture; 403/409/422 guards). Optional V1 feature.
- **Server actions** (RPC-style, not fetches): `sendTutorMessage(...)` and `submitHomework(...)`.

### `POST /api/attempts/homework-submit` — the core contract
[`v1-api-contract.md` §2; `v1-data-model.md` §1.4]
- **Body:** `{ assignment_id (req), class_id (req), diagram_url, response_text, responses }`.
- **Gate 1 — completeness:** every `content.tasks` task needs text OR image → else
  **400** `{ error:'incomplete_homework', missing_count, total_tasks }`.
- **Gate 2 — SPARK:** if `spark_attempt_id` set and `spark_sync_failed !== true`, requires
  `content.spark_completed_at` or `status==='completed'` → else **400** `spark_not_completed`.
- **Redo lock:** `graded && !allow_redo` → **409** `'Already graded'`; redo sets `allow_redo:false`.
- **Grading = 100% LLM via Claude** (`claudeChat`, `CLAUDE_GRADING_MODEL='claude-sonnet-4-6'`,
  temp 0.3, maxTokens 800). **NO MCQ/deterministic auto-grade path** — assignments are
  open-response/draw/written only. `GradingResult = { grade:0-100, feedback (student 2-3 sentences),
  teacher_summary (factual, forbidden-words-locked, RESPONSE-not-STUDENT), task_grades:[{step,
  description, grade, feedback}], cheating_flag, cheating_reason }`. Rubric: no work=5-15,
  off-topic=0-15, partial=20-50, complete=60-100.
- **Graded UPDATE `homework_attempts`:** `grade, ai_feedback (=feedback), teacher_notes
  (=teacher_summary), status:'graded', graded_at, updated_at, hours_to_submit (1dp),
  submitted_on_time (=hours<=48), teli_hint_count (= latest tutor_sessions.hint_count),
  effort_label (=computeEffortLabel)`. Separate non-blocking UPDATE for `task_grades`.
- **~16 side effects** (mostly non-blocking via `after()`). **MOAT-critical AWAITED ones:**
  `computeSignalsOnSubmit(user, school, 'homework', attemptId)` (→ `signal_aggregates`) and
  `recomputeSkillStatesForStudent(skillIds)`. Others: LMS passback, low-grade alert (`grade<60`),
  reteach-loop closure, student model, XP, Google Classroom, parent email, hugs, LS signals,
  BNCC, trial events, analytics.
- **Success:** `{ success:true, attempt:graded, grade, feedback, task_grades, reteach_completion }`.
- **Grading failure:** `status:'pending_grade', review_required:true`; if that write also fails →
  500 `grading_not_saved`.

### `computeEffortLabel` (the single classification rule)
[`v1-api-contract.md` §8; `v1-teli-tutor.md` §8]
```
SUCCESS_THRESHOLD=75; EFFORT_THRESHOLD=2;
isSuccess = score>=75; isEffortful = teliHintCount>=2;
success & effortful   → 'effortful_success'
!success & effortful  → 'struggling_trying'
success & !effortful  → 'independent_success'
else                  → 'independent_struggle'   (null if score==null)
```
The hint count affects ONLY this categorical label, NEVER the numeric grade. (Author flags
`teli_hint_count` as a "noisy proxy".)

### `homework_attempts` column set (V1 — union of migrations + reconcile scripts)
[`v1-data-model.md` §1] — **CRITICAL:** V1 schema is split across `000_full_schema.sql` + numbered
migrations + out-of-band reconcile scripts (NOT in `migrations/`). Many load-bearing columns are
**[reconcile-only]** and absent from a fresh migrations-only clone.

- **000 base:** `id, assignment_id (FK), student_id (FK), status (DEFAULT 'in_progress', NO CHECK),
  responses jsonb, canvas_data jsonb, score_pct numeric, ai_feedback jsonb, teacher_notes,
  teacher_score, teli_hint_count int DEFAULT 0, submitted_on_time, submitted_at, graded_at,
  created_at`.
- **Migration-added:** `grading_status (027), review_required (030), teli_transcript_visibility /
  self_unblock_flag / articulation_used (042), effort_label (043, nullable enum, NOT backfilled),
  hours_to_submit + score (045), student_choices + i_got_this_* + mastery_shortcut_* +
  extension_* (047), bncc_codes_addressed / bncc_competencias_addressed (069)`.
- **[reconcile-only]** (never in `migrations/`): **`allow_redo, is_redo, content, response_text,
  diagram_url, flagged_by, max_score, teacher_summary, school_id`** (eduflux-06-04b);
  **`updated_at, task_grades`** (2026-04-23); **`class_id uuid FK classes(id)`** (brazil-pilot —
  the single most load-bearing drift column: set on INSERT, used by the 030 index + signals select).
- **`score → grade` rename (055/055b):** homework grade column is `grade` (numeric 0-100).
  `score_pct` (quiz-era name from 000) still physically exists but unused by homework. Signals
  code reads `grade` aliased as `score:grade`. (Decision: quizzes produce SCORES, homework
  produces GRADES.)
- **`mastery_band` is NOT on `homework_attempts`** — it lives on `assignments` + `student_model`.
- `status` values seen (no CHECK): `in_progress, submitted, graded, pending_grade`.
- **One row per (student, assignment)** — redo overwrites the SAME row in the live submit path.
- RLS: student read-own + teacher-read-for-own-classes; writes via service-role admin client
  (bypasses RLS).

### `homework_drafts` (V1, migration 064)
[`v1-data-model.md` §2]
```sql
homework_drafts (
  assignment_id  uuid PRIMARY KEY REFERENCES assignments(id) ON DELETE CASCADE,
  student_id     uuid NOT NULL,
  draft_state    jsonb NOT NULL,     -- { responses, completed_tasks, current_task_index, phase }
  last_active_at timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
)
```
PK is `assignment_id` ALONE (assignments are per-student, so 1:1). Index `(student_id,
last_active_at DESC)`. Deleted on successful submit. RLS: students-manage-own +
teachers-read + platform-admin.

### `assignments` (V1, the homework DEFINITION table)
[`v1-data-model.md` §3]
Per-student (`student_id NOT NULL`), one row per student per lesson. The "items" are NOT a
separate questions table — they live as `content` jsonb:
```
content = { title, instructions,
  tasks: [{ step, description, type, strategy?, atl_skill?, ib_attribute?, bloom_level? }],
  reading_passage?, audio_script?, diagram_*?, youtube_search_query?, support_note?,
  extension_prompt?, atl_summary?[], ib_attributes?[], spark_completed_at? }
```
Top-level cols: `mastery_band CHECK(reteach|grade_level|advanced), assignment_mode, learning_style,
status, reteach_needed, scaffold_level, skill_ids, choice_settings, spark_*`.

### Tutor persistence (V1)
[`v1-teli-tutor.md` §7; `v1-api-contract.md` §7.4]
- **`tutor_sessions`** — base 000 has few cols; runtime reads/writes ~10 **drift** cols: `status,
  hint_count, help_request_count, last_activity_at, completed_at, lesson_id, mastery_band,
  learning_style, tasks_completed, tasks_total, scaffold_dependency_score`. V2 must define
  explicitly. `scaffold_dependency_score = min(1, totalHelpRequests/(totalTasks*3))`.
- **`tutor_messages`** — base: `session_id (FK CASCADE), role, content, created_at`. Runtime
  drift cols: `student_id, task_index, is_help_request, hint_type, scaffold_level, message_index,
  response_time_ms, prompt/completion_tokens`. **Role mismatch:** code inserts `role:'user'` but
  the 000 CHECK only allows `student|assistant|system` (live constraint differs). Writes are
  fire-and-forget.
- **`signal_events`** — `submitHomework` inserts one row per task `{ signal_family:'behavioral',
  event_type:'homework_task', source_module:'homework', schema_version:'v1', payload:TaskSignal }`.

---

## Teli Tutor (the pedagogical leap)

> **CRITICAL ARCHITECTURE FACT:** V1 has **FIVE overlapping tutor paths** that each duplicate the
> ladder by hand. **The Assignment Player uses the server-action path A**, NOT the API routes.
> V2 must pick ONE canonical contract. [`v1-teli-tutor.md` §0]

| Path | File | Model | Persists signal_events? |
|---|---|---|---|
| **A. `sendTutorMessage` server action** (THE player) | `homework/actions.ts` | `OPENAI_GEN_MODEL='gpt-4o'`, temp 0.7, max_tokens 500, direct call (no resilient wrapper) | NO |
| B. `POST /api/attempts/tutor` | `attempts/tutor/route.ts` | `OPENAI_VOICE_MODEL` | NO |
| C. `POST /api/tutor-message` | `tutor-message/route.ts` | `OPENAI_VOICE_MODEL` | YES (`tutor_interaction`) |
| D. `POST /api/tutor-start` | `tutor-start/route.ts` | — (creates session) | NO |
| E. `POST /api/attempts/teli-chat` | `TeliChat.tsx` (standalone revision chat, NOT the player) | `OPENAI_VOICE_MODEL`, max_tokens 200, USES resilient wrapper | NO |

### Hint ladder (verbatim, identical in all paths)
[`v1-teli-tutor.md` §1; `v1-api-contract.md` §7; `v1-copy-discipline.md` §6a]
```ts
const HINT_LADDER = ['nudge', 'cue', 'step', 'answer_blocked'] as const;  // 4 rungs
// on each is_help_request:
hintType = HINT_LADDER[Math.min(scaffold_depth, 3)];   // pick BEFORE incrementing
scaffold_depth = Math.min(scaffold_depth + 1, 3);      // then advance, capped 3
hint_count++; help_request_count++;
// returned: hints_remaining = Math.max(0, 3 - scaffold_depth)
```
- Sequence per task: 1st→`nudge` (depth→1), 2nd→`cue` (→2), 3rd→`step` (→3),
  4th→`answer_blocked` (stays 3). `hints_remaining` = 2,1,0,0.
- `hint_type` set ONLY when `is_help_request === true`. **The player forces
  `is_help_request=true` on EVERY message** (clarifying questions also burn a hint).
- `scaffold_depth` resets to 0 client-side per task, but `tutor_sessions.hint_count` is
  **cumulative across the whole session** — this is what feeds `teli_hint_count` at submit.

### Per-level instructions (the player's terse `HINTS`, verbatim)
[`v1-copy-discipline.md` §6a]
```
nudge:          'Ask a thought-provoking question pointing right direction. Do NOT give any part of the answer.'
cue:            'Narrow focus with a key concept. Do not give the answer.'
step:           'Give step-by-step scaffold. Do not give the final answer.'
answer_blocked: 'Student used all hints. Encourage effort. No direct answer.'
```
(Three different copies of these strings exist across paths A/B/C — all captured in the fragment.
`answer_blocked` still refuses the answer and summarizes the concept.)
UI labels: `💭 Teli Nudge / 🔑 Teli Cue / 📋 Teli Walkthrough / 🚫 Hints exhausted`.
HINT_COLOR `{nudge:#eef2ff, cue:#fffbeb, step:#faf5ff, answer_blocked:#fef2f2}`.

### System prompts (verbatim)
[`v1-teli-tutor.md` §2; `v1-copy-discipline.md` §6b]
- **`TELI_SYSTEM_PROMPT`** (`lib/teli/prompts.ts`) — only the player path prepends this:
  "You are Teli, a warm and encouraging Socratic AI tutor for K-12 students on the CORE learning
  platform." Rules: NEVER reveal answers directly, ≤3 sentences, adapt to frustration, always end
  encouraging, celebrate effort over correctness, the **i-Ready "one-way teaching is the failure
  mode"** rule (offer a DIFFERENT approach when stuck twice), and **name the THINKING move** on
  self-unblock.
- **`buildTeliPrompt({dominantStyle, struggleTopics, scaffoldLevel})`** appends per-student
  personalization from `student_model` (`dominant_style, struggle_topics, preferred_scaffold_level`)
  — `STYLE_HINTS` (visual/auditory/kinesthetic/text/emerging), up to 5 struggle topics, scaffold
  depth.
- **`tutorSystemPrompt(assignmentContent, lessonSummary)`** (`lib/openai/prompts.ts:1098`) — the
  assignment-context base; 8 numbered MUST rules; rule 1 "NEVER state the direct answer"; rule 5
  redirect "just tell me the answer"; rule 8 reference Inteliflow strategy (e.g. "Knowledge
  Bridge"). In the player path it is called with `lessonSummary` passed **empty `''`**.
- Player final system message = `withLocaleInstruction(teliPrompt + '\n\n' + tutorSystemPrompt(...)
  + hintInstruction)`. `hintInstruction` includes `CURRENT TASK: {desc}`, a diagram-honesty clause
  if `content.diagram_description`, and the rung's `HINTS[hintType]`.

### Anti-answer guardrails
[`v1-teli-tutor.md` §9]
Layered: `tutorSystemPrompt` "NEVER state the direct answer"; `TELI_SYSTEM_PROMPT` "NEVER reveal
answers directly"; every per-level HINT ends "Do NOT give … the answer" (even `answer_blocked`);
hard 3-hint/task client cap; diagram-honesty clause. **V1 tutor output was NOT leak-guarded** —
V2 must add `assertNoLeak` + `assertNoBannedWord` at the render boundary.

### Models
[`v1-teli-tutor.md` §3; `v2-copy-discipline.md` §5b]
`CLAUDE_GRADING_MODEL='claude-sonnet-4-6'` (grading, calibration-locked); `OPENAI_GEN_MODEL='gpt-4o'`
(player tutor action + generation + homework-adapt); `OPENAI_VOICE_MODEL=env||'gpt-4o'` (routes B/C/E
+ all voice/tone surfaces, env-overridable "pilot lever"). `tokenLimitParams(model,n)` handles
`max_tokens` vs `max_completion_tokens`.

---

## What V2 Already Has (reuse)

### Quiz-runner plumbing (Epic 1, shipped under `src/app/(student)/student/quiz/`)
[`v2-quiz-plumbing.md` §§1–6; `v2-assignments-surface.md` §11]

**Reuse AS-IS:**
- **The MOAT pipeline** — `computeSignals` + `behavioralTypes` + `behavioralModel.emaMerge` /
  `upsertBehavioralSignals`. `RawSessionData.context` is typed **`'quiz'|'homework'|'tutor'`** — it
  **already accepts `context:'homework'`**. `behavioral_signals` = one row per student (PK
  `student_id`), EMA `alpha=0.4`. `computeSignals` already treats **`canvasUsed`, `ttsPlayCount`,
  `hintsUsed`** as first-class engagement/frustration signals — but the quiz runner HARDCODES
  `canvasUsed:false`, `ttsPlayCount`/`hints_used:0`. **The Assignment Player must feed real values.**
- **`gradeOpenResponse`** (`engine/grading.ts`) — Claude (`claude-sonnet-4-6`) → GPT (`gpt-4o`)
  fallback, temp 0.2, 600 tok. Same OEQ grader the assignment grader needs.
- **Behavioral capture pattern** — `QuizRunner.tsx` hand-rolls `useRef` counters + global
  `addEventListener` (no library); `buildSessionAggregates()` (camelCase) + `snapshotPerQuestion()`
  (snake_case); `PAUSE_THRESHOLD=3000ms`; pause/focus/paste/backspace/stuck-erase detection. Lift
  wholesale; ADD canvas-open + TTS-play + per-task hint counters.
- **Option-D copy/render primitives** — `studentResultBundle`, `scoreMessage` (tier-aware EN pools,
  banded 90/75/60), `masteryDisplayLabel`, `gradeTextToTier`, `leakGuard.assertNoLeak`, `MathText`,
  `EmptyState`, `Card`.
- **`after()` fail-isolated 3-hook pattern** (skill recompute, misconceptions, behavioral signals).
- **Wall-clock + forfeit/resume machinery** (`quizAttemptState`, `forfeitAttempt`, signal heartbeat)
  — reusable ONLY IF the assignment is timed (V1 homework is NOT timed — see Gap Map).

**Must EXTEND:** the quiz submit writes `quiz_attempts` only — the Assignment Player submit must
write `homework_attempts` + clear the draft + use a bespoke multi-task GRADE prompt + flip signal
context to `'homework'`.

**Quiz attempt lifecycle** (the reuse template): `GET /student-quiz` → `POST /start` (stamps
`started_at`, 410 lazy-forfeit) → 15s `POST /signal` heartbeat + per-question upsert → `POST
/submit`. `RunnerState = loading|no-quiz|ready|taking|submitting|grading-pending|done|forfeit`.
Consts: `QUIZ_DURATION_MINUTES=10, CLOSURE_FORFEIT_MINUTES=5, RESUME_BANNER_THRESHOLD_SECONDS=30`.

### The SPARK assignments surface (where the player slots in)
[`v2-assignments-surface.md` §§0–3, 8, 13]
- **The student assignments surface is SPARK-launch-ONLY today.** List + detail render only
  `content.title` / `content.instructions`, and (when spark) a `SparkLaunchCard`. **There is NO
  in-app player and NO else-branch for a non-SPARK assignment** — this is exactly the gap Epic 2 fills.
- **Discriminator = `assignments.spark_status` (text, DEFAULT `'none'`), NOT a boolean.** Code
  branches on `spark_status !== 'none'`. Enum: `none|notified|created|in_progress|completed|
  notify_failed` (CHECK `assignments_spark_status_check`, migration 0012). No `is_spark` or
  `assignment_type` column.
- **Suggested player route:** `src/app/(student)/student/assignments/[id]/play/page.tsx` →
  `/student/assignments/[id]/play` (sibling of detail, mirroring `quiz/`). Not decided in code.
- **Auth guard chain (`requireRole`):** `createServerSupabaseClient()` → `auth.getUser()` (→
  `/login?expired`) → `users.role/.school_id/.full_name` (→ `/login`) → `schools.trial_status==='expired'`
  (→ `/trial-expired`) → role allow-list (→ `homeForRole`). Applied in `(student)/layout.tsx` AND
  re-called per page. **Admin client bypasses RLS → object-level ownership guard (`row.student_id !==
  userId` → existence-hiding EmptyState; or 403) is MANDATORY.**
- `assignments.content` has TWO live shapes: rich `AssignmentSchema` (from `POST
  /api/teacher/assignments/generate` — `title, reading_passage, audio_script, diagram_*, tasks[],
  instructions, support_note, extension_prompt, atl/ib`) vs the lean seed shape `{bandLabel,
  instructions, tasks}` (may lack `title` → list fallback `'Assignment'`). **The player must render
  defensively against missing fields.**
- **Teacher-side "Open Assignments" CTA** is a deliberately-deferred no-op (disabled button in
  `IdentityHeader.tsx`; `priorityCta.ts` precedence-4 fallback with no href). TEACHER-side, distinct
  from the student player — out of scope.

### Copy/leak-guard discipline
[`v2-copy-discipline.md` §§1–7]
- **`BANNED_WORDS`** (`leakGuard.ts`, whole-word CI) = `score, percentile, index, divergence,
  threshold, signal, model, algorithm, flag`. `'risk'` intentionally NOT banned.
- **`LEAK_PATTERNS`** = `[/\d/, /%/, /\bavg\b/i, /\bscore\s+\d/i, /\d+(?:st|nd|rd|th)\b/i,
  /\bpercentile\b/i, /\brank(?:ed)?\b/i]`. API: `hasLeak/assertNoLeak`, `hasBannedWord/
  assertNoBannedWord`. Pure, no Next/Supabase. NO copy barrel `index.ts` — import from
  `@/lib/copy/leakGuard`.
- **Option-D LOCKED:** students/parents NEVER see raw `score_pct`, raw `mastery_band` enum, or `%`.
  `studentResultBundle()` is the ONLY server-side score+band→words translator; routes ship the
  pre-built bundle field-by-field (never row-spread); the client holds no number.
- `masteryDisplayLabel`: `reteach→'Building', grade_level→'On Track', advanced→'Strong',
  null→'Not yet assessed'`. `getScoreMessage` band cuts: `>=90 celebrating, >=75 strong, >=60
  effort, else tough`. `needsStudyGuide = scorePct<80`.
- **The Teli TUTOR (hint-ladder + system prompt) DOES NOT EXIST in V2** — no `src/lib/teli/`, no
  `tutorSystemPrompt` in V2 `prompts.ts`, no tutor route. Only the post-quiz `scoreMessage` pools
  exist (leak-audited GREEN). Must be ported from V1 + leak-guarded at the render boundary.
  `OPENAI_VOICE_MODEL` slot is reserved (comment "Teli chat, tutor/hint"). Post-quiz `teliState =
  celebrating|idle|speaking`; the V1 tutor adds a 4th `thinking`.
- Render-boundary belt-and-suspenders precedent: `ResultScreen.tsx` re-runs `assertNoLeak` on every
  string; `QuizRunner.leak.test.tsx` renders the real server bundle→DOM. All new strings are DRAFTS
  in `STRINGS-FOR-BARB.md`; Barb gates all copy. COACH-POSTURE Rule 6 "Not a chatbot" applies to the
  conversational tutor surface.

### V2 `homework_attempts` schema state
[`v2-data-consumers.md` §1; `v2-assignments-surface.md` §9]
- **The table EXISTS** (created 0004, extended 0011) but `homework_drafts` does **NOT** (zero
  matches anywhere in the repo).
- **Full 19-column set:** `id, assignment_id (FK CASCADE), student_id (FK CASCADE), status (DEFAULT
  'in_progress', NO CHECK), responses jsonb, canvas_data jsonb, score_pct numeric, ai_feedback jsonb,
  teacher_notes, teacher_score, teli_hint_count int DEFAULT 0, submitted_on_time, submitted_at,
  graded_at, created_at` (all 0004); `effort_label (named CHECK homework_attempts_effort_label_check
  — 4-value enum), allow_redo (DEFAULT false), is_redo (DEFAULT false), flagged_by` (all 0011).
- **NO `class_id` column** (intentional "C10"/"C18"; class scoping is via `assignments.class_id`).
  The player must NOT write `class_id`.
- **Missing vs V1:** `grade` (V1 renamed score→grade), `task_grades`, `hours_to_submit`,
  `review_required`, `diagram_url`, `content`, `reteach_*`, BNCC cols. (V2 uses `score_pct`, not
  `grade`.)
- **NO API route reads/writes it at runtime** — only the demo/trial seeders. RLS = owner SELECT
  only (no student INSERT/UPDATE policy); a player writing via admin client bypasses RLS but needs
  the manual object guard.
- **NET-NEW tables (do NOT exist in V2):** `homework_drafts`, `tutor_sessions`, `tutor_messages`,
  `signal_events` (the moat replaced `signal_events`). Would land in migration `0015+`.

---

## The Write-Contract (KEYSTONE)

> This is why the epic matters: V2's teacher/parent surfaces already SELECT these columns, but
> **nothing writes them at runtime** — so every Today/roster/student-drill/snapshot renders against
> empty or default data. The player is the missing producer. [`v2-data-consumers.md` §§2–5]

| `homework_attempts` column | V2 consumer(s) | Player MUST write? | Exists in V2? |
|---|---|---|---|
| `id` | reteach-cycle detection | auto (PK) | yes (0004) |
| `assignment_id` | reteach grouping; FK | **YES** — the assignment | yes (0004) |
| `student_id` | EVERY consumer (`.eq('student_id')`) | **YES** | yes (0004) |
| `status` | seed gradebook-state test; Epic-3 gradebook | **YES** — `in_progress`→`submitted`→`graded` | yes (0004, no CHECK) |
| `responses` (jsonb) | grader reads answers; seeders write | **YES** — student answers (shape TBD: V2 seed uses `{response_text}`; V1 uses per-task keyed by `task.step`) | yes (0004) |
| `canvas_data` (jsonb) | **no reader yet** | YES (canvas feature) — intended home, no consumer constrains shape | yes (0004) |
| `score_pct` (numeric) | **divergence, risk, hw_avg, reteach pre/post, snapshot agg** — most-consumed column | **YES** at grade time | yes (0004) |
| `ai_feedback` (jsonb) | migration test only; no runtime reader | YES (grader feedback) | yes (0004) |
| `teacher_notes` (text) | none yet (Epic-3 gradebook) | NO (teacher write) | yes (0004) |
| `teacher_score` (numeric) | none yet (Epic-3 override) | NO (teacher write) | yes (0004) |
| `teli_hint_count` (int) | **weekly-snapshot `recent_effort_labels` + `avg_hints_per_attempt`** — the headline "consumed but UNPRODUCED" column (always 0 today) | **YES** — count of hints pulled from the ladder | yes (0004, DEFAULT 0) |
| `submitted_on_time` (boolean) | migration test only; no runtime reader | optional (vs `due_at`) | yes (0004) |
| `submitted_at` (timestamptz) | **ORDER key in all 3 signal libs + cron; recency/lateness in risk; reteach completed_at** | **YES** at submit | yes (0004) |
| `graded_at` (timestamptz) | seeders write; gradebook cell-state test | **YES** at grade | yes (0004) |
| `created_at` (timestamptz) | reteach chronological sort | auto | yes (0004) |
| `effort_label` (text, 4-enum) | **loadStudentSignals dominant-effort; weekly-snapshot dominant + recent_effort_labels** | **YES** — but **HOW the player derives it at runtime is an OPEN QUESTION** (V2 has no derivation logic; seeders set it directly; V1 = `computeEffortLabel`) | yes (0011) |
| `allow_redo` (boolean) | **risk index + reteach-cycle detection** | YES — reteach/redo eligibility | yes (0011, DEFAULT false) |
| `is_redo` (boolean) | **risk index + reteach-cycle detection** | YES — true when this attempt is a redo | yes (0011, DEFAULT false) |
| `flagged_by` (text) | reteach `flagged_by` (`'auto'|'teacher'`) | conditionally — `'auto'` on auto-reteach, else teacher | yes (0011) |

**`homework_drafts`** — does NOT exist in V2. Autosave target is an open design question: reuse the
`homework_attempts` row with `status='in_progress'` + `responses`/`canvas_data` (both columns already
exist), OR add a new `homework_drafts` table (V1 model). Nothing is built either way.

**Snapshot/effort enums consumed:** `effort_label CHECK` = `{effortful_success, struggling_trying,
independent_success, independent_struggle}`. `computeHwQuizDivergence` consts: `MIN_HW_SAMPLES=2,
MIN_QUIZ_SAMPLES=1, ALIGNMENT_THRESHOLD=10`. `detectCompletedReteachCycles` needs `allow_redo`+score
then a later graded+submitted attempt on the same `assignment_id`.

---

## V1 → V2 Gap Map

| Feature | Reuse-as-is / Extend / Net-new | V2 host file / target |
|---|---|---|
| Behavioral-signals moat (`computeSignals`, `emaMerge`, `upsertBehavioralSignals`) | **Reuse-as-is** (already typed `context:'homework'`) | `src/lib/signals/computeSignals.ts`, `behavioralModel.ts`, `behavioralTypes.ts` |
| Behavioral capture (refs + global listeners, aggregates, snapshots) | **Reuse-as-is** + add canvas/TTS/hint counters | lift from `quiz/_components/QuizRunner.tsx` |
| OEQ grader | **Reuse-as-is** engine; **Extend** with bespoke multi-task GRADE prompt | `src/lib/engine/grading.ts` (`gradeOpenResponse`) + net-new prompt |
| Option-D copy primitives (`studentResultBundle`, `scoreMessage`, `masteryDisplayLabel`, `leakGuard`) | **Reuse-as-is** | `src/lib/quiz/*`, `src/lib/copy/leakGuard.ts`, `src/lib/utils/masteryLabel.ts` |
| Auth guard chain + object-ownership pattern | **Reuse-as-is** | `src/lib/auth/requireRole.ts` |
| `homework_attempts` table | **Extend** (add `grade`-or-keep-`score_pct`, `task_grades`, `hours_to_submit`, maybe `diagram_url`/`review_required`) | migration `0015+` |
| Submit route (write `homework_attempts` + clear draft + side effects) | **Net-new** (quiz submit only writes `quiz_attempts`) | net-new `src/app/api/attempts/homework-submit/route.ts` (or new name) |
| The Assignment Player UI (two-phase, task carousel, state screens) | **Net-new** (re-skinned to tokens) | net-new `src/app/(student)/student/assignments/[id]/play/` |
| Teli tutor + 3-step hint ladder | **Net-new** (port from V1; pick ONE canonical path; leak-guard output) | net-new `src/lib/teli/`, tutor route/action, `OPENAI_VOICE_MODEL` slot |
| `tutor_sessions` + `tutor_messages` | **Net-new** tables (define clean — V1 schema is drift-laden) | migration `0015+` |
| Drawing canvas | **Net-new** (V1 hand-rolled 8-tool canvas; `canvas_data` column exists, no producer) | net-new component; writes `homework_attempts.canvas_data` |
| TTS route + voice | **Net-new** (V1 `tts-1`/`nova`/0.9; V2 has `ttsPlayCount` signal but NO route; `ResultScreen` has `TODO(tts)`) | net-new `src/app/api/attempts/tts/route.ts`; `TeliVoiceButton` port |
| Draft autosave | **Net-new** (`homework_drafts` table absent; or reuse in-progress row) | migration + route, OR reuse `homework_attempts` |
| `homework-adapt` (per-task mid-assignment rewrite after 2 hints) | **Net-new** (V1 `gpt-4o` temp 0.6, no DB write) | net-new route |
| `effort_label` runtime derivation | **Net-new** logic (port `computeEffortLabel` 75/2) | net-new `src/lib/signals/` |
| Choice architecture (`ChoiceBlock`, `student_choices`) | Likely **deferred** (optional V1 feature) | — |
| "I Got This" / mastery-shortcut / extension | Likely **deferred** | — |
| SPARK gating in submit | **Out of scope** (epic is explicitly non-SPARK; SPARK already integrated separately) | — |
| BNCC / pt-BR locale | **Deferred** (CLAUDE.md: BR/EduFlux deferred) | — |

---

## Open Questions for the Spec

**Assignment definition & authoring**
1. **Does V2 need a non-SPARK assignment-definition schema, or does one exist?** V2 `assignments`
   exists with `content` jsonb in TWO live shapes (rich `AssignmentSchema` from
   `POST /api/teacher/assignments/generate` vs the lean seed `{bandLabel, instructions, tasks}`).
   The detail page reads only `title`+`instructions`. Confirm the player renders the full
   `AssignmentSchema` body (reading_passage, audio_script, tasks, diagram_*) defensively.
2. **How do non-SPARK assignments get authored/seeded for pilots?** The generate route exists but
   the only non-SPARK assignments in V2 today are seeded. Is teacher-authored assignment generation
   wired, or does the player only consume existing rows?
3. **Question types:** V1 is purely open-response (text/draw/voice) — NO MCQ/numeric/choice in the
   player. Does V2 Epic-2 stay open-response (LLM-graded, like V1), or add structured types? (Epic-1
   Quiz Runner already covers MCQ/numeric auto-grade — assignments and quizzes are different
   identity models.)

**Timing / lifecycle**
4. **Will the Assignment Player be TIMED?** V1 homework has NO wall-clock/forfeit/heartbeat — it is
   completeness-gated + SPARK-gated. If untimed, the quiz `start/signal/forfeit/RecoveryBanner/
   QuizTimer` machinery is OPTIONAL; if timed, it ports directly.
5. **Redo model:** V1 live behavior is one-row-overwrite (`allow_redo` consumed, prior responses
   overwritten) while `is_redo` + redo-count risk signal imply multi-attempt history. Overwrite-in-place
   vs append-a-new-row (to preserve original-vs-redo grades)? `detectCompletedReteachCycles` expects
   two attempt rows on the same `assignment_id`.
6. **Should `homework_attempts.status` become a constrained enum** (V1 + V2 both have NO CHECK)?

**Persistence & schema**
7. **Grade column:** keep V2's `score_pct` or rename to `grade` (V1's live name, per the
   score-vs-grade lock)? V2 signal consumers SELECT `score_pct`.
8. **Autosave target:** reuse the `homework_attempts` in-progress row (`status='in_progress'` +
   `responses`/`canvas_data`, both columns exist) OR add `homework_drafts` (V1 model)? Nothing built
   either way; no existing consumer constrains the choice.
9. **`responses` jsonb shape:** V2 seeders write `{response_text}` (single blob); V1 writes per-task
   keyed by `String(task.step)`. The grader contract must align with whichever the player writes.
10. **Net-new table shapes:** `tutor_sessions` + `tutor_messages` (V1 schemas are drift-laden and
    self-contradictory — the `role` CHECK forbids the `'user'` value the code inserts). Where do
    per-hint behavioral events get recorded (V2 has no `signal_events`)?
11. **`effort_label` derivation:** port `computeEffortLabel` (75/2 thresholds, hint-count-as-effort)?
    Or wait for richer `articulation_used`/`self_unblock_flag` signals (the author calls hint count a
    "noisy proxy")?
12. **`task_grades`:** V2 schema should include it natively (V1 shipped it via a reconcile script and
    guards a non-blocking update around its possible absence).

**Teli tutor**
13. **Which tutor path does V2 standardize on?** V1 has 5 overlapping implementations with diverging
    models (gpt-4o gen vs voice), prompts, `max_tokens` (500 vs 200), persistence, and resilience
    (only teli-chat uses the retry wrapper). V2 needs ONE canonical contract — and a decision: server
    Action (V1 player) vs route.ts (V2 quiz pattern).
14. **Hint counting:** keep the 3-hints-per-task cap and the "every ask is a help request" behavior
    (clarifying questions burn a hint), or decouple plain questions from explicit help requests?
    Specify a single authoritative hint counter (V1 has a known off-by-one the client hard-caps).
15. **Auto-adapt:** retain the after-2-hints `homework-adapt` task rewrite (silently changes the task
    mid-attempt, coupled to the hint counter)?
16. **Model choice:** V1 uses OpenAI `gpt-4o` for the tutor voice; CLAUDE.md/claude-api guidance
    favors Anthropic for LLM surfaces. Move Teli onto Claude, or keep `OPENAI_VOICE_MODEL='gpt-4o'`?
17. **Prompt reconciliation:** V1 prompts name "i-Ready", "Inteliflow Learning Strategy", "Knowledge
    Bridge", and surface raw hint labels/emoji — reconcile with COACH-POSTURE.md + the token-only
    design system, and **leak-guard the live tutor reply at the render boundary** (V1 had no guard).

**Voice / TTS**
18. **Is voice in-scope for the Beta?** V1 voice is supplemental (degrades to typing). Confirm OpenAI
    SDK + `OPENAI_API_KEY` are wired in V2 (this may be the first OpenAI voice dependency), and whether
    the licensing `usageCaps` + `system_events` cost-logging infra exists or is out of scope. Brand
    locale collapses to constant `'en'` (pt-BR deferred) — keep the seam or hardcode the Whisper
    `language`?

**Side effects & MOAT**
19. **Which `homework-submit` side effects are wired at Epic-2 time vs stubbed** (LMS passback, Google
    Classroom, parent-email, hugs, LS signals, BNCC, XP, trial events)? The MOAT-critical AWAITED ones
    are `computeSignalsOnSubmit` + `recomputeSkillStatesForStudent` — these light up the pipeline.
20. **Real per-task correctness signals:** V1 `trackQuestionAttempt` hardcodes `isCorrect:true`. The
    V2 moat (`computeSignals`) consumes per-question `isCorrect` — confirm what behavioral signals the
    player must emit (and whether canvas/TTS/hint signal producers replace the quiz's hardcoded
    `false`/`0`).

**Infrastructure**
21. **Player route shape:** `assignments/[id]/play` vs inline-mode on the detail page vs
    `/student/play/[id]` (not decided in code). Should a non-SPARK list row link straight to the player
    or to the detail page (which then offers a Start CTA)?
22. **The `student-work` Supabase Storage bucket** (public) must exist in V2 for canvas/image uploads
    — confirm provisioning.
23. **RLS:** no student INSERT/UPDATE policy exists on `homework_attempts` or `assignments` — writing
    via the admin client sidesteps RLS but mandates the manual object guard; confirm that's the chosen
    path (consistent with V2's "RLS is NOT the IDOR backstop").
24. **Grade visibility:** V1 shows the HW grade to students as a qualitative `hwGradePill`, but the
    Done/Graded screens DO pass `HomeworkAttemptState.grade` (0-100). Confirm V2's four-audience
    discipline keeps the HW band-pill (no %) AND whether `ai_feedback`/`teacher_notes` student-facing
    copy passes COACH-POSTURE + `assertNoLeak`.
