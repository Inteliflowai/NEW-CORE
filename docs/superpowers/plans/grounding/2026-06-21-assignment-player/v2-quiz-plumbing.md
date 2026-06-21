# Grounding — V2 Quiz-Runner Plumbing (reuse surface for the Assignment Player)

Verbatim current-code facts captured 2026-06-21 for **Epic 2 — the non-SPARK Assignment Player**.
Scope of this fragment: the **already-shipped V2 quiz-runner plumbing** the Assignment Player should
reuse, plus an explicit **reuse-as-is vs must-extend vs net-new** map against the V1 homework flagship.
No opinions, no proposed changes — only what exists.

Files read in full (V2 unless noted V1):
- `src/app/(student)/student/quiz/_components/QuizRunner.tsx`
- `src/app/(student)/student/quiz/_components/QuestionCard.tsx`, `ResultScreen.tsx`, `QuizTimer.tsx`, `RecoveryBanner.tsx`
- `src/app/(student)/student/quiz/page.tsx`
- `src/app/api/attempts/start/route.ts`, `[attemptId]/signal/route.ts`, `[attemptId]/submit/route.ts`, `[attemptId]/adapt/route.ts`
- `src/app/api/attempts/study-guide/route.ts`, `student-quiz/route.ts`, `quiz-history/route.ts`
- `src/lib/quiz/studentResultBundle.ts`, `scoreMessage.ts`, `gradeTextToTier.ts`, `forfeitAttempt.ts`
- `src/lib/utils/masteryLabel.ts`, `src/lib/student/quizAttemptState.ts`
- `src/lib/signals/behavioralTypes.ts`, `computeSignals.ts`, `behavioralModel.ts`
- `src/lib/engine/grading.ts`, `src/lib/ai/models.ts`
- `supabase/migrations/0004_assignments_homework.sql`, `0013_quiz_runner.sql`, `0014_quiz_session_aggregates.sql`
- V1 reference: `app/api/attempts/homework-draft/route.ts`, `homework-submit/route.ts`,
  `app/api/attempts/[attemptId]/hint/route.ts`, `app/api/attempts/tutor/route.ts`,
  `app/api/attempts/tts/route.ts`, `app/api/tutor-start/route.ts`,
  `app/(dashboard)/student/homework/page.tsx` (112 KB / ~1557 lines — NOT read line-by-line; structure inferred from its API contracts)

---

## 1. The attempt lifecycle (start → heartbeat/signal → submit)

The runner is a **state machine** in `QuizRunner.tsx`:
`type RunnerState = 'loading' | 'no-quiz' | 'ready' | 'taking' | 'submitting' | 'grading-pending' | 'done' | 'forfeit'`.

Sequence (client side):
1. **Mount** → `GET /api/attempts/student-quiz` → resolves the quiz + most-recent attempt. Sets `ready`/`no-quiz`/`done` (replay) and may raise the recovery banner.
2. **Begin** → `POST /api/attempts/start` `{ quiz_id }` → stamps `started_at`, returns `attempt_id`. → state `taking`.
3. **Wall-clock timer**: recomputed every 1 s from server `started_at` via `quizTimeRemainingSeconds(startedAt, new Date())` (NEVER a client countdown — honest across reloads). `QUIZ_DURATION_MINUTES = 10`, `TOTAL_SECONDS = 600`.
4. **15 s heartbeat** (`HEARTBEAT_INTERVAL_MS = 15_000`): `POST /api/attempts/{id}/signal` with `{ responses: [], sessionAggregates: undefined, heartbeat: true }` — bumps `last_active_at` only.
5. **Per-question advance** (`handleNext`): posts one `snapshotPerQuestion(...)` to `/signal` (upserts `quiz_responses`), then `resetPerQuestionRefs()`.
6. **Adaptive Q4/Q5** after Q3 (`currentIndex === 3`, once, via `adaptCalledRef`): `POST /api/attempts/{id}/adapt {}` → replaces Q4/Q5 with open-response questions.
7. **Submit** (`handleSubmit`, also auto-fires at `timeLeft === 0`): posts ALL snapshots + `buildSessionAggregates()` to `/signal` FIRST (the grader reads `quiz_responses.response_text`), THEN `POST /api/attempts/{id}/submit`.
8. **Lazy-forfeit**: `POST /start` returns **HTTP 410** when the existing attempt classifies as `closure_forfeit`/`time_up_forfeit` → state `forfeit` (no raw score shown).

`classifyAttemptState` (`quizAttemptState.ts`) is the single source of truth. Constants: `QUIZ_DURATION_MINUTES = 10`, `CLOSURE_FORFEIT_MINUTES = 5`, `RESUME_BANNER_THRESHOLD_SECONDS = 30`. States: `completed_normal | closure_forfeit | time_up_forfeit | fresh | active | resuming_after_gap`. Gap > 30 s → banner; gap ≥ 5 min → closure forfeit; elapsed ≥ 10 min → time-up forfeit.

---

## 2. Exact wire shapes

### `POST /api/attempts/start`
- **Request**: `{ quiz_id: string }`
- **Responses**:
  - `401` `{ error:'Unauthorized' }`; `400` `{ error:'Missing quiz_id' }`; `404` not published; `403` `{ error:'Student not enrolled in this class' }`; `400` `{ error:'Quiz already completed' }`
  - `410` (lazy-forfeit): `{ attempt_id, forfeited:true, forfeit_reason:'closure'|'time_up', score_pct, mastery_band }` — **NOTE: this 410 path DOES carry `score_pct`/`mastery_band`** (the only over-the-wire leak in the quiz plumbing; the client never reads them — it only reads `forfeit_reason`).
  - `200` resume/fresh: `{ attempt_id, started_at, state, resumed_after_seconds, closure_forfeit_minutes, resume_banner_threshold_seconds }`
  - `200` new insert: `{ attempt_id, started_at, state:'active' }`
- **Auth chain**: `createServerSupabaseClient()` → `auth.getUser()` → `createAdminSupabaseClient()`; IDOR backstop = `enrollments.eq('student_id', user.id).eq('is_active', true)`. Most-recent attempt picked via `.order('created_at',{ascending:false}).limit(1).maybeSingle()`.

### `POST /api/attempts/[attemptId]/signal`
- **Request body**: `{ responses?: ResponseSignal[], sessionAggregates?: Record<string,unknown>, heartbeat?: boolean }`
- **`ResponseSignal`** (per-question, snake_case): `question_id, position, response_text?, response_time_ms?, hesitation_ms?, answer_changes?, navigation_backs?, pause_count?, total_pause_ms?, word_count?, focus_loss_count?, paste_count?, hints_used?, question_type_scored?`
- **`sessionAggregates`** (camelCase `SessionAggregates`): `focusLossCount, pasteCount, pauseCount, totalPauseMs, totalFocusLossMs, backspaceCount, keypressCount, ttsPlayCount, canvasUsed, stuckEraseCount`
- **Behaviour**: always bumps `quiz_attempts.last_active_at`; folds `sessionAggregates` into `quiz_attempts.session_aggregates` jsonb (single update); empty `responses` → `{ ok:true, heartbeat_only:true }` (no `quiz_responses` write); non-empty → upsert into `quiz_responses` with `onConflict:'attempt_id,question_id'` → `{ ok:true }`.
- **Responses**: `401`, `404` not owned, `400` already complete, `500` upsert fail.

### `POST /api/attempts/[attemptId]/submit`
- **Request**: client sends `{ quiz_attempt_id }` but the route ignores the body — it reads `attemptId` from the **URL param** only (`_req` is unused).
- **Grading model**: positions 1–3 deterministic (`scoreMCQ` / `checkNumericAnswer`); positions 4–5 OEQ via `gradeOpenResponse` (Claude `CLAUDE_GRADING_MODEL` = `claude-sonnet-4-6` → GPT `OPENAI_GEN_MODEL` = `gpt-4o` fallback, temp 0.2, 600 tok), run concurrently with `Promise.all`.
- **Never-half-grade (C22)**: ANY OEQ failure OR any `.update()` write error → marks `grading_status:'pending'`, `grading_failed:true`, `is_complete:true`, `submitted_at` and returns `{ attempt_id, grading_delayed:true, message:'…Grading is temporarily delayed…' }`. Band/`score_pct` written ONLY on the all-clean path.
- **All-clean response**: `{ attempt_id, grades: Array<{ position, score }>, result: StudentResultBundle }`. `grades[]` is **OEQ-only (positions 4–5)** — NOT a per-position correctness source (the client deliberately re-derives per-question correctness from `quiz-history` instead).
- Cognitive-taxonomy fields (`error_type, reasoning_pattern, misinterpretation_detected, vocabulary_difficulty, cognitive_notes`) are written into `quiz_responses.grading_output` jsonb (NOT top-level columns). Per-OEQ row also gets `ai_score, ai_score_explanation, confidence, grader_source, question_type_scored:'open', rubric_version:'v1'`.
- Outer catch → `respondEngineError(err)` (no bare 500).

### `StudentResultBundle` (the Option-D result shape — `studentResultBundle.ts`)
```
interface StudentResultBundle {
  scoreMessage: { message: string; teliMsg: string; teliState: 'celebrating'|'idle'|'speaking' };
  masteryLabel: string;      // soft word via masteryDisplayLabel(): 'Building'|'On Track'|'Strong'|'Not yet assessed'
  needsStudyGuide: boolean;  // scorePct < 80
}
```
Built by `studentResultBundle({ scorePct, masteryBand, tier, firstName, attemptId, locale='en' })`. **This is the ONLY place a raw `score_pct`/`mastery_band` is converted into student copy** — it runs server-side; the runner never receives the number/enum. `scoreMessage` comes from `getScoreMessage(pct, attemptId/*seed*/, locale, tier, firstName)` over tier-aware EN pools (`SCORE_VARIANTS_EN_BY_TIER`) banded `celebrating ≥90 / strong ≥75 / effort ≥60 / tough <60`. `tier` derived from `gradeTextToTier(grade_level)` (K-5 elementary / 6-8 middle / 9-12 high; default middle).

### `GET /api/attempts/student-quiz`
- **Response**: `{ quiz: { id, title, class_id, quiz_questions:[...] } | null, existing_attempt | null, teacher_name, class_name, reason? }`
- `existing_attempt` is built **field-by-field, Option-D** (never spreads the row): `{ id, is_complete, adapted_questions, started_at, last_active_at, forfeit_reason, result? }`. `score_pct`/`mastery_band` are fetched internally for ownership but NEVER copied out; a completed attempt with a real score gets `result` = the same `StudentResultBundle`.
- UUID-guarded optional `?quizId=`; selection via active enrollments + `isQuizAvailableForStudent`.

### `POST /api/attempts/quiz-history` (per-question review)
- **Request**: `{ attempt_id }` → **Response**: `{ review: QuizHistoryReviewRow[] }` where each row = `{ position, question_type, question_text, correct_answer, choices, rubric, student_answer, is_correct, ai_score, explanation }`.
- This is the **authoritative per-position correctness source** the runner uses to build `ResultScreen` review (because `submit.grades[]` is OEQ-only). Option-D: no overall `score_pct`/`mastery_band` key. `GET` variant returns the completed-quiz list (`{ classes, quizzes }`, field-by-field, no score).

### `POST /api/attempts/study-guide`
- **Request**: `{ quiz_attempt_id }` → **Response**: `{ study_guide, cached:true }` (cache hit on `quiz_attempts.study_guide`) / `{ study_guide, cached:false }` (LLM-generated, written back) / `{ study_guide:null, cached:false, unavailable:true }` (graceful degrade). Model = `OPENAI_VOICE_MODEL` (gpt-4o), temp 0.5, max 400 tok, via `resilientChatCompletion`. Wrong-answer rule: MCQ `is_correct===false`; non-MCQ `is_correct===false OR ai_score < 0.7`. System prompt: no scores/percentages/grades, 2-3 **bold** sections, ≤250 words.

### `POST /api/attempts/[attemptId]/adapt`
- **Request**: `{}` → **Response**: `{ adapted: AdaptedQuestions }` where `AdaptedQuestions.questions[] = { position, question_text, rubric, scaffold_hint?, difficulty_label? }` (open-response only). Caches into `quiz_attempts.adapted_questions` (col added migration 0010). Never blocks: any LLM failure returns original Q4/Q5.

---

## 3. The behavioral-signals hook (the MOAT) — what `computeSignals` consumes

`submit` fires **three `after()` post-grade hooks** (all fail-isolated, all on the all-clean path only):

1. **Skill-state recompute** — `recomputeSkillStatesForStudent(admin, { studentId, schoolId:null })` (resolves school internally).
2. **Misconception observations** — dynamic-imports `recordMisconceptions`; resolves `school_id` from `users.school_id` (NOT quizzes); re-queries the REAL `quiz_responses.id` per OEQ position; passes `{ responseId, studentId, skillId, error_type, reasoning_pattern, questionTypeScored:'open' }`.
3. **Behavioral-signal store** — the moat. Dynamic-imports `computeSignals` + `upsertBehavioralSignals`. Builds:
   - `correctByPosition` map (positions 1-3 from `mcqScores[i]===1`; positions 4-5 from `r.grade.score >= 0.5`).
   - `QuestionAttemptData[]` from graded `quiz_responses` rows: `{ questionId, questionIndex:position, isCorrect, timeTakenMs:response_time_ms, changeCount:answer_changes, hintsUsed:hints_used }`.
   - `SessionAggregates` rebuilt from `quiz_attempts.session_aggregates` jsonb (each field type-guarded, defaults to 0/false).
   - `sessionStartMs`/`sessionEndMs` from `started_at`/`submitted_at` ISO timestamps.
   - `RawSessionData = { studentId, sessionId:attemptId, context:'quiz', schoolId, questionAttempts, aggregates, sessionStartMs, sessionEndMs }`.
   - `const next = computeSignals(rawSession); await upsertBehavioralSignals(admin, { studentId, schoolId, next })`.

**`RawSessionData.context`** type is `'quiz' | 'homework' | 'tutor'` — i.e. the signals pipeline is ALREADY typed to accept a `'homework'` context. The Assignment Player can call this exact pipeline with `context:'homework'`.

**`computeSignals` output (`ComputedSignals`)**: `learningVelocity, velocityTrend, frustrationScore, frustrationIndicators[], attentionScore, attentionGaps, errorPatternType, errorFrequency, confidenceScore, confidenceAccuracy, engagementScore, engagementStyle, predictiveRiskScore, riskFactors[], sessionDurationMs`. Pure function (no DB/Date/random), all 0-1 clamped. `computeFrustration` uses `backspaceCount/keypressCount`, `changeCount`, `focusLossCount`, `stuckEraseCount`, `hintsUsed`. `computeEngagement` uses `canvasUsed`, `ttsPlayCount`, `hintsUsed`, `backspaceRate`, `focusLossCount` — **i.e. canvas + TTS + hints are first-class engagement signals already wired**.

**`upsertBehavioralSignals` (`behavioralModel.ts`)**: reads existing `behavioral_signals` row, applies pure `emaMerge(prev, next, alpha=0.4)` (numeric fields EMA-blended; categorical + array fields take latest), upserts `{ student_id, school_id, computed, observation_count+1, updated_at }` with `onConflict:'student_id'`. One row per student (PK = student_id).

---

## 4. Behavioral capture in the runner (client) — the `useEventTracker`-equivalent

`QuizRunner.tsx` hand-rolls capture with `useRef` counters + global `addEventListener` (no library). Wired only while `runnerState === 'taking'`:
- **Session-level refs** → `buildSessionAggregates()`: `sessFocusLossCount, sessPasteCount, sessPauseCount, sessTotalPauseMs, sessTotalFocusLossMs, sessBackspaceCount, sessKeypressCount, sessTtsPlayCount (always 0 in quiz), stuckEraseCount`. **`canvasUsed` is hardcoded `false`** in the quiz runner (no canvas).
- **Per-question refs** → `snapshotPerQuestion(q, responseText)`: `question_id, position, response_text, response_time_ms, hesitation_ms (firstInput-start), answer_changes, navigation_backs, pause_count, total_pause_ms, word_count, focus_loss_count, paste_count, hints_used:0 (hardcoded), question_type_scored`.
- Listeners: `visibilitychange`, window `blur`/`focus`, `paste`, `keydown`. Pause detection = `PAUSE_THRESHOLD = 3000` ms gap between keypresses; `stuckEraseCount` = pause>3s immediately followed by Backspace/Delete.
- `postSignal(id, responseItems, sessionAggregates?, heartbeat=false)` is best-effort (swallows errors).

Component contracts to reuse:
- `QuestionCard` props: `{ question:QuizQuestion, currentResponse, onResponse, onFirstInput }`. `QuizQuestion = { id, position, question_type:'mcq'|'numeric'|'open', question_text, choices:MCQChoice[]|null, correct_answer, rubric, concept_tag, skill_id }`. MCQ stores the label string; numeric uses `inputMode="decimal"` (allows fractions); open = `<textarea rows=6>`. `MathText` wraps all text. `correct_answer`/`rubric` never rendered.
- `QuizTimer` props `{ timeLeft, totalSeconds }`; SVG ring; thresholds warn ≤180s, danger ≤60s, pulse ≤30s.
- `RecoveryBanner` props `{ gapSec, closureSecondsLeft, onDismiss }`.
- `ResultScreen` props `{ variant:'done'|'forfeit'|'grading-pending', scoreMessage, masteryLabel, needsStudyGuide, reviewItems, studyGuide, studyGuideLoading, forfeitReason, onBack, onStartAssignment? }`. Renders Teli quote from `scoreMessage.teliMsg` (TTS call site deferred — `TODO(tts)`). Every rendered string passes `assertNoLeak`.
- Server wrapper `page.tsx`: `requireRole(['student'])` → `{ userId, schoolId, fullName }`; identity is `public.users` (NO `students` table); `grade_level` is text.

---

## 5. Option-D discipline (the four-audience boundary)

- **No raw `score_pct`, `mastery_band` enum, or `%` crosses the wire to the student** — EXCEPT the `start` 410 forfeit payload (which the client ignores).
- The student bundle DOES carry: a qualitative `scoreMessage.message` + `scoreMessage.teliMsg` (Teli coaching), a **soft** `masteryLabel` word, and `needsStudyGuide` boolean.
- Per-question review (`quiz-history`) carries `is_correct` (✓/✗) and `ai_score` (a raw per-question number, included for Barb/UI to present qualitatively) but **no overall score**.
- `masteryDisplayLabel`: `reteach→'Building'`, `grade_level→'On Track'`, `advanced→'Strong'`, null→'Not yet assessed'.
- Every student route builds responses **field-by-field** (never spreads a `quiz_attempts` row).

---

## 6. Reuse map — quiz plumbing vs the Assignment Player

### Reuse AS-IS
- **`computeSignals` + `behavioralTypes` + `behavioralModel.emaMerge`/`upsertBehavioralSignals`** — pipeline already typed for `context:'homework'`; canvas/TTS/hints already first-class signals. Net-new: feed real `canvasUsed`, `ttsPlayCount`, and `hintsUsed` (the quiz hardcodes `false`/`0`).
- **Behavioral-capture pattern** (refs + global listeners, `buildSessionAggregates`, `snapshotPerQuestion`, pause/focus/paste/backspace detection) — lift wholesale; ADD canvas-open + TTS-play + per-task hint counters.
- **`gradeOpenResponse`** (`engine/grading.ts`) — Claude→GPT OEQ grader is the same engine the assignment grader needs.
- **`studentResultBundle` / `scoreMessage` / `masteryLabel` / `gradeTextToTier` / `leakGuard` / `MathText` / `EmptyState` / `Card`** — Option-D copy + render primitives reuse directly.
- **`after()` fail-isolated hook pattern** + the three post-grade hooks (skill recompute, misconceptions, behavioral signals) — copy the structure.
- **Wall-clock + liveness/forfeit/resume machinery** (`quizAttemptState`, `forfeitAttempt`, signal heartbeat) — reusable IF the assignment is timed; V1 homework is NOT timed (see §7), so this is OPTIONAL.

### Must EXTEND
- **Submit route**: the quiz submit writes `quiz_attempts` only. The Assignment Player submit must instead/also write **`homework_attempts`** (status `submitted`→`graded`, `score_pct`, `ai_feedback`, `teacher_notes`, `teli_hint_count`, `responses` jsonb, `canvas_data`, `submitted_on_time`, `graded_at`) and clear the draft. V2 `homework_attempts` (migration 0004) already has: `id, assignment_id, student_id, status, responses, canvas_data, score_pct, ai_feedback, teacher_notes, teacher_score, teli_hint_count, submitted_on_time, submitted_at, graded_at, created_at`. **Missing vs V1**: `grade` (V1 renamed score→grade in mig 055), `task_grades`, `effort_label`, `hours_to_submit`, `allow_redo`, `review_required`, `diagram_url`, `reteach_*`, BNCC columns — decide which to add.
- **Grader prompt**: V1 `homework-submit` uses a bespoke multi-task GRADE prompt (returns `{ grade, feedback, teacher_summary, task_grades[], cheating_flag, cheating_reason }`, "grade" not "score" vocabulary, Inteliflow Strategies/Powers language, RESPONSE-not-STUDENT teacher_summary rules) — net-new vs the quiz OEQ grader.
- **Signal context** flips to `'homework'`; `sessionId` = the homework attempt id.

### NET-NEW (no V2 plumbing exists)
- **Draft autosave**: V1 `homework-draft` route (GET/PUT/DELETE on `homework_drafts` table, `onConflict:'assignment_id'`, `{ assignment_id, student_id, draft_state, last_active_at }`). **`homework_drafts` table does NOT exist in V2** — net-new migration. (V2's per-question quiz autosave is via `quiz_responses` upsert, a different model.)
- **Teli tutor + 3-step hint ladder**: V1 `HINT_LADDER = ['nudge','cue','step','answer_blocked']` (`tutor/route.ts`) with per-rung `hintInstructions`, `scaffold_depth` (0→3), `help_request_count`, `hint_count`; tutor session created via `tutor-start` (`tutor_sessions` table: `scaffold_depth, help_request_count, hint_count, mastery_band, learning_style, status, …`); turns logged to `tutor_messages`. The simpler V1 `[attemptId]/hint` route (Socratic single-hint, `buildTeliPrompt`, logs `signal_events`) is an alternative. **`tutor_sessions`, `tutor_messages`, `signal_events` tables do NOT exist in V2** — net-new. `teli_hint_count` on `homework_attempts` is read at submit (`computeEffortLabel`).
- **Drawing canvas**: `homework_attempts.canvas_data` jsonb column exists in V2 but no capture UI/route; `canvasUsed` is a live engagement signal awaiting a real producer.
- **Voice/TTS**: V1 `tts/route.ts` (OpenAI `tts-1`, voice `nova`, speed 0.9, ≤4096 chars, tier usage caps, returns audio/mpeg). V2 has the `ttsPlayCount` signal field but **no TTS route**. `ResultScreen` has a `TODO(tts)` deferred call site.
- **The Assignment Player UI itself**: V2 `(student)/student/assignments/page.tsx` is SPARK-only (lists titles + "Spark Challenge" badge, deep-links to `assignments/[id]`); the `[id]` route + `_components` exist but are SPARK-focused. The non-SPARK timed/tutored player is net-new (V1 reference: `app/(dashboard)/student/homework/page.tsx`, ~1557 lines, not read in full here).

---

## 7. Key cross-cutting facts / gotchas

- **Quiz uses `quiz_attempts` keyed on `quiz_id`; homework uses `assignments` (one row per student) + `homework_attempts` keyed on `assignment_id`.** Different identity model — the assignment is per-student, not per-class.
- V1 homework is **NOT timed** (no wall-clock/forfeit); it is **completeness-gated** (every task must have a text-or-image response) and **SPARK-gated** (if a SPARK challenge is injected, no submit until SPARK done). Both gates are server-enforced in `homework-submit` with `incomplete_homework` / `spark_not_completed` 400 errors.
- V1 homework submit has a **redo** path: `homework_attempts.allow_redo`; resubmit blocked with `409 'Already graded'` unless `allow_redo`. V2 `homework_attempts` lacks the `allow_redo` column.
- Model registry (`ai/models.ts`): `CLAUDE_GRADING_MODEL='claude-sonnet-4-6'` (calibration-locked), `OPENAI_GEN_MODEL='gpt-4o'`, `OPENAI_VOICE_MODEL='gpt-4o'` (Teli/hint/study-guide). `tokenLimitParams()` handles `max_tokens` vs `max_completion_tokens`.
- Auth chain on every protected route: `await createServerSupabaseClient()` → `auth.getUser()` (401) → admin client (`createAdminSupabaseClient()`, bypasses RLS) → object-level ownership guard (`.eq('student_id', user.id)`) — RLS is NOT the IDOR backstop.
- All migrations are additive-only; latest is `0014`. Net-new tables (`homework_drafts`, `tutor_sessions`, `tutor_messages`) + missing `homework_attempts` columns would land in `0015+`.
