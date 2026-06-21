# Grounding — CORE V2 Student Quiz Runner epic

**Date:** 2026-06-20
**Scope:** Verbatim, code-grounded reference for building the V2 Student Quiz Runner. The epic = build the start / heartbeat / forfeit / resume / study-guide / quiz-history / signal-emit routes + the timed runner UI + behavioral event emitters **on top of the existing V2 grader + adapt routes**, wiring into V2's already-ported signals/skills engine.

Conventions: V1 = `C:/users/inteliflow/core` (top-level `app/` + `lib/`, **no** `src/`). V2 = `C:/users/inteliflow/NEW-CORE` (Next.js 16, code under `src/`). All citations are `file:line`. This doc is read-only research; nothing here changes source.

---

## PART A — V1 QUIZ RUNNER (the behavior to port)

### A.0 Surfaces inventory (verified to exist)

- Runner page: `app/(dashboard)/student/quiz/page.tsx` (1762 lines). Canonical runner with states `loading | already-done | no-quiz | taking | submitting | done | grading-pending | forfeit` (`quiz/page.tsx:28`).
- Dashboard variant: `app/(dashboard)/student/page.tsx` — has an extra `'ready'` state (notification→start) — `QuizState = 'loading' | 'already-done' | 'no-quiz' | 'ready' | 'taking' | 'submitting' | 'done'` (`student/page.tsx:20`), plus a `quizNotification` banner (`student/page.tsx:270`) and a `sessionStorage.setItem('quiz_in_progress','true')` nav-block (`student/page.tsx:331`).
- API routes (all confirmed present under `app/api/attempts/`): `student-quiz/route.ts`, `start/route.ts`, `[attemptId]/signal/route.ts`, `[attemptId]/submit/route.ts`, `[attemptId]/adapt/route.ts`, `[attemptId]/hint/route.ts`, `study-guide/route.ts`, `quiz-history/route.ts`.
- Pure state helper: `lib/student/quizAttemptState.ts`. Forfeit pipeline: `lib/quiz/forfeitAttempt.ts`. Behavioral hook: `lib/signals/useEventTracker.ts`.

### A.1 The wall-clock + closure classifier — `lib/student/quizAttemptState.ts`

Single source of truth for "what state is this attempt in right now." Pure (Date injected, no DB/React). The three tunables:

```ts
// lib/student/quizAttemptState.ts:33-35
export const QUIZ_DURATION_MINUTES = 10;
export const CLOSURE_FORFEIT_MINUTES = 5;
export const RESUME_BANNER_THRESHOLD_SECONDS = 30;
```

States: `completed_normal | closure_forfeit | time_up_forfeit | fresh | active | resuming_after_gap` (`quizAttemptState.ts:37-43`).

```ts
// lib/student/quizAttemptState.ts:60-103
export function classifyAttemptState(input: AttemptStateInput): AttemptState {
  const { isComplete, forfeitReason, startedAt, lastActiveAt, now,
    quizDurationMinutes = QUIZ_DURATION_MINUTES,
    closureForfeitMinutes = CLOSURE_FORFEIT_MINUTES } = input;
  if (isComplete) {
    if (forfeitReason === 'closure') return 'closure_forfeit';
    if (forfeitReason === 'time_up') return 'time_up_forfeit';
    return 'completed_normal';
  }
  if (!startedAt) return 'fresh';                     // teacher-granted row, clock not begun
  const startedMs = new Date(startedAt).getTime();
  const elapsedSec = (now.getTime() - startedMs) / 1000;
  const durationSec = quizDurationMinutes * 60;
  if (elapsedSec >= durationSec) return 'time_up_forfeit';
  const lastSeenMs = lastActiveAt ? new Date(lastActiveAt).getTime() : startedMs;
  const gapSec = (now.getTime() - lastSeenMs) / 1000;
  const closureSec = closureForfeitMinutes * 60;
  if (gapSec >= closureSec) return 'closure_forfeit';            // >=5min idle
  if (gapSec >= RESUME_BANNER_THRESHOLD_SECONDS) return 'resuming_after_gap'; // 30s..5min
  return 'active';
}
```

Wall-clock remaining (drives ring + auto-submit; recomputed every tick from `started_at`, NOT a decrementing counter — survives reload/navigation):

```ts
// lib/student/quizAttemptState.ts:111-120
export function quizTimeRemainingSeconds(startedAt, now, quizDurationMinutes = QUIZ_DURATION_MINUTES): number {
  if (!startedAt) return quizDurationMinutes * 60;
  const elapsedSec = (now.getTime() - new Date(startedAt).getTime()) / 1000;
  const durationSec = quizDurationMinutes * 60;
  return Math.max(0, Math.floor(durationSec - elapsedSec));
}
```

Also `closureSecondsRemaining(lastActiveAt, now, closureForfeitMinutes=5)` (`quizAttemptState.ts:128-137`) → seconds left to return before forfeit (drives recovery-banner countdown).

> NOTE: The runner page constant says `const QUIZ_TIME_LIMIT = 10 * 60` (`quiz/page.tsx:30`) and `HEARTBEAT_INTERVAL_MS = 15_000` (`quiz/page.tsx:31`). The header comment on line 30 mislabels it "QUIZ_DURATION_MINUTES" but the value is 10 min, matching the helper. (The runner's own `QuizTimer` warning thresholds are 180s/60s/30s — `quiz/page.tsx:40-42`.)

### A.2 Lifecycle: notification → start → run → close

**Step 1 — pick the active quiz: `GET /api/attempts/student-quiz`** (`student-quiz/route.ts`)
- Auth: `getUser()` → 401 (`student-quiz/route.ts:14-15`). Admin client to bypass RLS.
- Optional `?quizId=` (UUID-guarded against literal `"undefined"` — `student-quiz/route.ts:25-26`). Else selects the latest published, not-yet-completed, in-class-eligible quiz via `enrollments` (`is_active=true`, `enrolled_at`) + `isQuizAvailableForStudent(...)` (`student-quiz/route.ts:33-97`). Falls back to most-recent COMPLETED eligible so the student lands on a review state, not an empty page (`student-quiz/route.ts:89-96`).
- Surfaces the most-recent attempt with the fields the wall-clock + forfeit routing need:
```ts
// student-quiz/route.ts:109-117
.from('quiz_attempts')
.select('id, is_complete, score_pct, mastery_band, adapted_questions, started_at, last_active_at, forfeit_reason')
.eq('quiz_id', resolvedQuizId).eq('student_id', user.id)
.order('started_at', { ascending: false, nullsFirst: false }).limit(1);
```
- Returns `{ quiz (with quiz_questions(*)), existing_attempt, assignment (learning_style by quiz_attempt_id), teacher_name, class_name }` (`student-quiz/route.ts:120-161`).

**Step 2 — start / resume / lazy-forfeit: `POST /api/attempts/start`** (`start/route.ts`), body `{ quiz_id }`.
- Auth `getUser()` 401; `400` missing quiz_id (`start/route.ts:19-23`).
- Verify quiz `status='published'` → 404 (`start/route.ts:28-35`). Verify `enrollments.is_active` → 403 (`start/route.ts:38-46`).
- Loads existing attempt `select('id, is_complete, started_at, last_active_at, forfeit_reason, score_pct, mastery_band')` (`start/route.ts:50-55`). If `is_complete` → `400 Quiz already completed` (`start/route.ts:57-59`).
- Classifies via `classifyAttemptState` (`start/route.ts:67-73`). **Forfeit branch** (closure/time_up): calls `forfeitAttempt(...)`, returns **HTTP 410** with `{ attempt_id, forfeited:true, forfeit_reason, score_pct, mastery_band }`:
```ts
// start/route.ts:75-92
if (state === 'closure_forfeit' || state === 'time_up_forfeit') {
  const reason = state === 'closure_forfeit' ? 'closure' : 'time_up';
  const result = await forfeitAttempt({ admin, attemptId: existing.id, reason });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ attempt_id: existing.id, forfeited: true,
    forfeit_reason: reason, score_pct: result.scorePct, mastery_band: result.masteryBand }, { status: 410 });
}
```
- **fresh** branch (started_at NULL, teacher grant): stamps `started_at=now` so the clock begins on first interaction (`start/route.ts:100-111`).
- **active / resuming_after_gap** branch: returns `{ attempt_id, started_at, state, resumed_after_seconds, closure_forfeit_minutes, resume_banner_threshold_seconds }` (`start/route.ts:116-131`).
- **New attempt** path: inserts `{ quiz_id, student_id, started_at, last_active_at, is_complete:false }`, writes an `audit_logs` row `event_type:'quiz_attempt_start'`, returns `{ attempt_id, started_at, state:'active' }` (`start/route.ts:135-163`).

**Step 3 — heartbeat + save: `POST /api/attempts/[attemptId]/signal`** (`signal/route.ts`).
- Auth + ownership (`.eq('student_id', user.id)`) → 404; `400` if `is_complete` (`signal/route.ts:22-30`).
- **Always** bumps liveness `quiz_attempts.last_active_at = now` (best-effort) — this is what the classifier reads (`signal/route.ts:37-44`).
- Body `{ responses, signals, heartbeat? }`. Empty `responses` (heartbeat-only) returns early `{ ok:true, heartbeat_only:true }` after the liveness bump (`signal/route.ts:58-64`).
- For each answered position, **upserts** to `quiz_responses` on `onConflict:'attempt_id,question_id'` with the behavioral columns `response_time_ms, hesitation_ms, answer_changes, navigation_backs, pause_count, total_pause_ms, word_count, question_type_scored` (`signal/route.ts:85-99`).
- The `heartbeat:true` gate **skips** the per-question `signal_events` insert (heartbeat metrics are noise; only submit-time has real per-question timings). On non-heartbeat it inserts `signal_events { user_id, session_id: attempt.id, signal_family:'behavioral', event_type:'question_behavioral', payload:{...}, source_module:'quiz', schema_version:'v1' }` (`signal/route.ts:107-127`).

Client heartbeat timer (15s while `state==='taking'`) posts `{ responses, signals:{}, heartbeat:true }` (`quiz/page.tsx:629-644`).

**Step 4 — forfeit scoring: `lib/quiz/forfeitAttempt.ts`.** Synchronous, MCQ+numeric only, **no LLM** (open responses left at NULL `ai_score`). Score model: `score_pct = round(correctDeterministic / totalQuestions * 100)`; open + unanswered count 0 (`forfeitAttempt.ts:128-174`). Band inlined `>=80 advanced / >=51 grade_level / else reteach` (`forfeitAttempt.ts:63-67`). Writes `quiz_attempts { is_complete:true, submitted_at, score_pct, mastery_band, forfeit_reason }` (`forfeitAttempt.ts:177-186`); `submitted_at` defaults to `last_active_at` to keep the gradebook timestamp honest (`forfeitAttempt.ts:42-48,87-90`). Backfills `is_correct/ai_score/grader_source` on the deterministic response rows so the post-forfeit review reads like a normal attempt (`forfeitAttempt.ts:153-169`).

**Step 5 — adaptive injection after Q3.** Client-side in the runner, not a separate trigger column. (V2's `adapt` route is the equivalent — see Part B.) V1's submit grades positions 1–3 deterministically and 4–5 via OEQ; adapted Q4/Q5 text is read from `quiz_attempts.adapted_questions`.

**Step 6 — submit + post-quiz UI.** `POST /api/attempts/[attemptId]/submit` (V1 has its own; V2's is the ported grader — Part B). The runner then:
- Shows non-numeric "You finished the quiz!" + band pill + Teli message (`quiz/page.tsx:1185-1233`). **Option D (Marv/Barb-locked):** students never see the quiz percentage; the qualitative message + band pill carry the result; the score still flows server-side (`quiz/page.tsx:1053-1056`).
- Per-question ✓/✗ review (no per-question numeric scores; open uses a 0.5 threshold for ✓/✗) (`quiz/page.tsx:1109-1121`, `1273-1325`).
- Study guide for `score_pct < 80` (`quiz/page.tsx:681-701, 1363-1398`).
- Forfeit screen: honest copy, **raw forfeit score % intentionally NOT shown** (`quiz/page.tsx:1467-1509`).
- `grading-pending` screen when submit returns `grading_delayed` (`quiz/page.tsx:960-964, 1019-1031`).

### A.3 Post-quiz Teli message — tier/locale-aware variant pools

`getScoreMessage(pct, seed, locale, tier, firstName)` (`quiz/page.tsx:379-395`). Band cut: `>=90 celebrating / >=75 strong / >=60 effort / else tough` (`quiz/page.tsx:386`). Pools:
- EN by tier `SCORE_VARIANTS_EN_BY_TIER[tier][band]` — `tier ∈ elementary|middle|high`, each band has 4 `{message, teliMsg, teliState}` variants (`quiz/page.tsx:162-241`).
- PT-BR `SCORE_VARIANTS_PT[band]` — 10 variants/band, "você" informal, dignity register (`quiz/page.tsx:298-347`).
- `pickVariantStable(...)` hashes the seed (`attemptId + ':' + round(pct)`) and dedupes against the last-shown index in `localStorage` per `tier-band` (`quiz/page.tsx:349-367`).
- `applyName(...)` substitutes `{name}` or drops it cleanly (`quiz/page.tsx:369-377`). TTS via `teliSpeak(teliMsg)` on results (`quiz/page.tsx:671-678`).

### A.4 Study guide — `POST /api/attempts/study-guide`

Body `{ quiz_attempt_id }`. Trigger is **client-side `score_pct < 80`** (`quiz/page.tsx:682`). Route: ownership via `attempt.student_id !== user.id` → 403 (`study-guide/route.ts:32`); returns cached `quiz_attempts.study_guide` if present (`study-guide/route.ts:35-37`). Builds a wrong-answer summary (`is_correct===false` OR non-mcq `ai_score < 0.7`) (`study-guide/route.ts:57-70`), threads optional IEP accommodations silently (`study-guide/route.ts:81-103`), calls `resilientChatCompletion(model: OPENAI_VOICE_MODEL, temp 0.5, max_tokens 400)` (`study-guide/route.ts:106-120`), caches into `quiz_attempts.study_guide`, returns `{ study_guide, cached }`.

### A.5 Quiz history — `/api/attempts/quiz-history`

- `GET` (optional `?class_id=`): returns `{ classes, quizzes:[{ attempt_id, quiz_id, quiz_title, class_id, class_name, submitted_at }] }` for completed attempts — **Option D: score_pct/mastery_band deliberately omitted** from the student client (`quiz-history/route.ts:75-86`).
- `POST { attempt_id }`: per-question review `{ review:[{ position, question_type, question_text, correct_answer, choices, rubric, student_answer, is_correct, ai_score, explanation }] }` — again no overall score returned (`quiz-history/route.ts:117-150`).

### A.6 Hint — `/api/attempts/[attemptId]/hint`

Present in V1 (`app/api/attempts/[attemptId]/hint/route.ts`). Client fires `trackEvent('hint_request')`. (Lower priority for the V2 epic; the runner can ship without per-question hints, but the event type feeds frustration scoring.)

### A.7 `useEventTracker` — behavioral telemetry — `lib/signals/useEventTracker.ts`

Config `{ studentId, context:'quiz'|'homework'|'tutor', contextId?, schoolId, enabled? }` (`useEventTracker.ts:15-21`). Returns `{ sessionId, trackEvent, trackQuestionAttempt, flushAndCompute }` (`useEventTracker.ts:23-28`).

**Event types** (`lib/signals/types.ts:7-30`): `session_start, session_end, keypress, backspace, paste, pause_start, pause_end, focus_loss, focus_gain, answer_draft, answer_change, answer_submit, question_next, question_prev, hint_request, tts_play, tts_replay, diagram_view, canvas_start, scroll, quiz_question_start, quiz_question_end, homework_resume`. Pause threshold 3s; focus tracked via window blur/focus.

**Where the runner fires them:** `quiz_question_start` on load + advance (`quiz/page.tsx:851,917`); `answer_change` / `answer_draft` in `handleResponse` (`quiz/page.tsx:879,881`); `quiz_question_end` + `question_next` + `trackQuestionAttempt` in `saveSignalAndAdvance` (`quiz/page.tsx:900-918`) and at submit (`quiz/page.tsx:939-947`); `flushAndCompute()` after a successful submit (`quiz/page.tsx:973`). Per-question legacy `signals.current[pos] = { response_time_ms, hesitation_ms, answer_changes, word_count }` posted to `/signal` at submit (`quiz/page.tsx:949-953`).

**Flush:** buffer flushes every 15s + on `beforeunload` to `POST /api/teacher/events-v5`, payload `{ sessionId, studentId, context, contextId, schoolId, events:[{eventType, occurredAt, payload}] }` → rows in **`student_events`** table. (`useEventTracker.ts` flush + `app/api/teacher/events-v5/route.ts`.)

**Server compute:** `computeSignalsOnSubmit(...)` (`lib/signals/computeSignalsOnSubmit.ts`) hydrates `QuestionAttemptData` from `quiz_responses` (`is_correct, response_time_ms, answer_changes`), pulls the session's `student_events`, runs pure `computeSignals(...)` (`lib/signals/signalComputer.ts`) → upserts **`cognitive_signals`**, EMA-updates **`student_model`**, refreshes **`signal_aggregates`**, snapshots **`signal_history`**.

### A.8 V1 DB tables a quiz attempt touches (columns as used)

- `quiz_attempts`: `id, quiz_id, student_id, session_id, started_at, **last_active_at**, submitted_at, is_complete, raw_score, score_pct, mastery_band, learning_style, **forfeit_reason**, adapted_questions, **study_guide**, created_at`.
- `quiz_responses`: `id, attempt_id, question_id, position, response_text, is_correct, ai_score, ai_score_explanation, cognitive_notes, question_type_scored, rubric_version, grader_source, confidence, response_time_ms, hesitation_ms, answer_changes, navigation_backs, pause_count, total_pause_ms, word_count`.
- `quiz_questions`: `id, quiz_id, position, question_type(mcq|open|numeric), question_text, choices(jsonb), correct_answer, rubric, concept_tag, numeric_spec, skill_id`.
- `quizzes`: `id, lesson_id, class_id, teacher_id, title, status, published_at, ...`.
- `enrollments`: `class_id, student_id, is_active, enrolled_at`.
- `assignments`: linked by `quiz_attempt_id`, read for `learning_style`.
- `signal_events`, `student_events`, `audit_logs`, `cognitive_signals`, `student_model`, `signal_aggregates`, `signal_history` — telemetry/audit tables.

---

## PART B — V2 EXISTING BACKEND (what's reusable)

### B.1 The grader — `src/app/api/attempts/[attemptId]/submit/route.ts` (383 lines)

`POST`. Auth `getUser()`→401 (`submit/route.ts:37-41`); ownership via admin client `.eq('student_id', user.id).single()`→404 (`submit/route.ts:44-54`). RLS is NOT the backstop.

Reads attempt + `quizzes(quiz_questions(*))` + `adapted_questions` (`submit/route.ts:46-47`), sorts questions by position, reads `quiz_responses(position, response_text, is_correct)` (`submit/route.ts:71-74`).

**Scoring (the "what an attempt must look like" contract):**
- Positions 1–3 deterministic: `mcq` via `scoreMCQ`, `numeric` via `checkNumericAnswer(responseText, q.numeric_spec)`; persists `is_correct`. Unknown front type → pending path (`submit/route.ts:79-122`).
- Positions ≥4 OEQ: builds tasks (uses `adapted_questions.questions[pos].question_text` when present), runs `gradeOpenResponse({ questionText, rubric, response })` **concurrently** via `Promise.all` capturing failures (`submit/route.ts:141-183`).
- **Never-half-grade (C22):** any OEQ grade failure, any per-response write error, or the final update error → write `{ submitted_at, is_complete:true, grading_failed:true, grading_status:'pending' }` and return `{ attempt_id, grading_delayed:true, message }`. Band is written ONLY on the all-clean path (`submit/route.ts:124-138, 185-250, 271-287`).
- Cognitive taxonomy (`error_type, reasoning_pattern, misinterpretation_detected, vocabulary_difficulty, cognitive_notes`) goes into `quiz_responses.grading_output` jsonb, not top-level columns (`submit/route.ts:208-227`).
- All-clean: `computeFinalScore(mcqScores, openScores)` + `computeMasteryBand(scorePct)` → writes `{ submitted_at, is_complete:true, grading_status:'complete', grading_failed:false, raw_score, score_pct, mastery_band }` (`submit/route.ts:252-269`).
- **Hooks fired on all-clean (fail-isolated, never block the response):** `recomputeSkillStatesForStudent(admin, { studentId, schoolId:null })` (`submit/route.ts:294-303`) and `recordMisconceptions(admin, { schoolId, perResponse })` using REAL `quiz_responses.id` (`submit/route.ts:310-363`).
- Response: `{ attempt_id, raw_score, score_pct, mastery_band, grades:[{position, score}] }` (`submit/route.ts:365-374`). Outer catch → `respondEngineError(err)` (`submit/route.ts:375-378`). `GET` → 501.

**Contract the grader assumes:** the attempt already exists and is owned by the caller; `quiz_responses` rows already carry `response_text` per position; `quiz_questions` carry `question_type/correct_answer/rubric/numeric_spec/skill_id`; `quiz_attempts.adapted_questions` may hold adapted Q4/Q5. **The grader does NOT create the attempt or save responses** — that is exactly the net-new start/heartbeat work.

### B.2 Adapt — `src/app/api/attempts/[attemptId]/adapt/route.ts` (77 lines)

`POST`, called after Q3. Auth+ownership `.eq('student_id', user.id)` (`adapt/route.ts:23-30`); 400 if complete; returns cached `adapted_questions` if present (`adapt/route.ts:34-36`). Loads `quiz_responses` positions ≤3 for `correctCount` (`adapt/route.ts:43-49`), calls `adaptQuestions({ correctCount, lessonContext: JSON.stringify(quiz.lessons.parsed_content).slice(0,2000), originalQ4, originalQ5 })` — **never throws**, returns original on failure (`adapt/route.ts:51-57`). Persists to `quiz_attempts.adapted_questions`, returns `{ adapted }` (`adapt/route.ts:63-72`).

### B.3 Engine libs — `src/lib/engine/`

- `gradeOpenResponse(input: { questionText, rubric, response, rubricVersion? }): Promise<GradingResult>` (`grading.ts:38-82`). Claude (`CLAUDE_GRADING_MODEL`, default `claude-sonnet-4-6`, temp 0.2) → GPT fallback (`OPENAI_GEN_MODEL`, default `gpt-4o`); exhaustion → `LlmExhaustedError`. Output Zod schema: `score ∈ {0,0.5,1.0}`, `explanation, confidence, grader_source, error_type(enum), reasoning_pattern(enum), misinterpretation_detected, vocabulary_difficulty, cognitive_notes` (`engine/types.ts:99-116`).
- `adaptQuestions(input: { correctCount, lessonContext, originalQ4, originalQ5, extraSystemContext? }): Promise<AdaptedQuestions>` (`adapt.ts:32-101`). Band map 0–50 `scaffolded` / 51–79 `grade_level` / 80+ `advanced`. OpenAI gpt-4o, temp 0.7. **Never throws** — returns original Q4/Q5 on any failure.

### B.4 Skills engine — `src/lib/skills/`

```ts
// src/lib/skills/recomputeSkillStates.ts:88-96
export async function recomputeSkillStatesForStudent(
  admin: SupabaseClient,
  args: { studentId: string; schoolId: string | null; skillIds?: string[] },
): Promise<SkillStateRecomputeSummary>
```
Reads `quiz_responses` (join `quiz_questions!inner(skill_id)`, `quiz_attempts!inner(student_id,is_complete,submitted_at)`; cols `is_correct, ai_score, question_type_scored, grading_output`; filter `is_complete=true`, `skill_id NOT NULL`) (`recomputeSkillStates.ts:116-127`), plus `assignments`, `homework_attempts`, `spark_completions`. Writes **`skill_learning_state`** upsert on `(student_id, skill_id)` `{ state, confidence, observation_count, evidence, last_reteach_outcome, updated_at }` (`recomputeSkillStates.ts:370-385`). Pure fusion in `computeSkillState(...)` (`computeSkillState.ts:217-530`). C20: OEQ correctness = `ai_score >= 0.5`, MCQ = `is_correct===true`. **Inputs it needs from the runner:** graded `quiz_responses` with `skill_id` linkage on the questions — already produced by the grader. No client events required.

### B.5 Signals engine — `src/lib/signals/`

`loadStudentSignals(admin, studentId): Promise<StudentSignals>` (`loadStudentSignals.ts:87-289`) reads `quiz_attempts` (band + scores), `skill_learning_state`, `misconception_observations`, `homework_attempts`, `student_model_snapshots`. Pure helpers: `diagnose`, `findRecurringError` (`diagnosis.ts`), `computeConsistency/computeTrajectory` (`consistency.ts`), `computeHwQuizDivergence`, `computeRosterRiskIndex`, `computeSessionRisk`, `detectCompletedReteachCycles`.

**CRITICAL FINDING:** V2 has **NO** client-side `useEventTracker`, **NO** `trackEvent`, and **NO** `student_events / cognitive_signals / signal_events / signal_aggregates / student_model` tables. A grep of `supabase/` + `src/` for `last_active_at|forfeit_reason|signal_events|audit_logs|student_events|study_guide` returns a single hit — `users.last_active_at` (`0001_identity_roles.sql:53`), unrelated to quizzes. V2 computes signals server-side from DB snapshots (`quiz_attempts`, `quiz_responses`, `homework_attempts`), NOT from a streamed event log.

### B.6 LLM clients — `src/lib/ai/` (+ prompts in `src/lib/openai/prompts.ts`)

- Claude: `claudeChat(system, user, opts)` (`ai/claude.ts:116-129`), lazy `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })` (`ai/claude.ts:9-10`).
- OpenAI: `resilientChatCompletion(params, opts)` (`ai/openai.ts:40-79`), lazy `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })` (`ai/openai.ts:9-10`).
- Model registry `src/lib/ai/models.ts`: `CLAUDE_GRADING_MODEL='claude-sonnet-4-6'`, `OPENAI_GEN_MODEL='gpt-4o'`, `OPENAI_VOICE_MODEL='gpt-4o'`. `GRADING_SYSTEM` + `gradingPrompt` live in `src/lib/openai/prompts.ts:522-649`. **No Teli post-quiz message pool exists in V2** (V1's lives in the runner page).

### B.7 Scoring — `src/lib/utils/scoring.ts`

```ts
// scoring.ts:10-14
export function computeMasteryBand(scorePct: number): MasteryBand {
  if (scorePct <= 50) return 'reteach';
  if (scorePct <= 79) return 'grade_level';
  return 'advanced';
}
```
`scoreMCQ(a,b)` trim+lowercase exact = 1|0 (`scoring.ts:101-...`). `computeFinalScore(mcq[],open[])` → `{ rawScore, scorePct: (raw/5)*100 }` UNROUNDED float (`scoring.ts`). `currentMasteryBand(attempts)` = band of most-recent complete attempt (`scoring.ts:41-57`). NOTE: V1 forfeit band cut (`>=51 grade_level`) differs by one point from `computeMasteryBand` (`<=50 reteach`); they're effectively aligned.

### B.8 Copy / leak-guard — `src/lib/copy/`

`leakGuard.ts`: `LEAK_PATTERNS` blocks bare digit, `%`, `avg`, `score N`, ordinals, `percentile`, `rank` (`leakGuard.ts:10-21`); `hasLeak(text)`, `assertNoLeak(text, ctx?)` throws on leak (`leakGuard.ts:23-38`). Helpers: `effortPhrase`, `reteachWorkingPhrase`, `topicFrame`, `riskBandLabel`, `confidenceSoftLabel` — all return audience-safe strings, no numbers. These are the boundary that keeps raw scores off student surfaces.

### B.9 Misconceptions — `src/lib/misconceptions/recordMisconceptions.ts`

`recordMisconceptions(admin, { schoolId, perResponse:[{ responseId, studentId, skillId, error_type, reasoning_pattern, questionTypeScored }] })` (`recordMisconceptions.ts:29-62`). Only `questionTypeScored==='open'`, excludes `error_type ∈ {'none',''}`. Writes `misconception_observations`. Already invoked by the grader.

### B.10 Student surface + auth — `src/app/(student)/`

- `(student)/layout.tsx:13` → `await requireRole(['student'])`.
- `requireRole(allowed)` (`src/lib/auth/requireRole.ts:18-37`): `createServerSupabaseClient()` → `getUser()` → `users.select('role,school_id,full_name')` → trial-expiry gate on `schools.trial_status` → role allow-list → returns `{ userId, role, schoolId, fullName }`.
- IDOR guards `src/lib/auth/guards.ts`: `guardStudentAccess(studentId)` (`guards.ts:86-106`) — own data / platform_admin / same-school admin / parent / teacher-of-class. `STAFF_ROLES` (`src/lib/auth/roles.ts:13`).
- Server client `src/lib/supabase/server.ts`: `createServerSupabaseClient()` (SSR, cookies, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`); `createAdminSupabaseClient()` reads `SUPABASE_SECRET_KEY`, **bypasses RLS** (`server.ts:25-32`).
- Existing student pages (`assignments/page.tsx`, `assignments/[id]/page.tsx`) are **server components** that `requireRole` then read via admin client + `.eq('student_id', userId)` ownership, and render **only** title/instructions/soft status — no scores. The runner UI is a `'use client'` page (V1 pattern) calling the API routes; auth on those routes is `getUser()` + ownership, mirroring V1.

### B.11 V2 quiz schema (migrations) — what EXISTS vs what's MISSING

`quiz_attempts` (`0003_lessons_quizzes.sql:53-66` + `0010_engine_columns.sql:50-65` + `0011:186`): **HAS** `id, quiz_id, student_id, session_id, started_at, submitted_at, is_complete, raw_score, score_pct, mastery_band, learning_style, created_at, adapted_questions, grading_status('pending'|'complete'|NULL), grading_failed`. **MISSING** (vs V1): `last_active_at`, `forfeit_reason`, `study_guide`.

`quiz_responses` (`0003:68-93` + `0010:68`): HAS all behavioral cols (`response_time_ms, hesitation_ms, answer_changes, navigation_backs, pause_count, total_pause_ms, word_count`) + `grading_output jsonb`. **No `(attempt_id, question_id)` unique constraint is declared in the migration** — V1's `/signal` upsert uses `onConflict:'attempt_id,question_id'`, so V2 needs that constraint (or upsert on a different key) before a heartbeat upsert will work.

`quiz_questions` (`0003:39-50` + `0005:35` + `0010:16-48`): `question_type ∈ mcq|open|numeric`, `choices jsonb, correct_answer, rubric, concept_tag, numeric_spec jsonb, rubric_version, skill_id`. `quizzes`, `enrollments(is_active, enrolled_at)`, `assignments(quiz_attempt_id, learning_style)`, `skill_learning_state`, `student_model_snapshots`, `misconception_observations` all exist.

**Tables that DO NOT exist in V2:** `student_events`, `cognitive_signals`, `signal_events`, `signal_aggregates`, `student_model`, `audit_logs`.

---

## PART C — GAP ANALYSIS (REUSE / ADAPT / NET-NEW)

| V1 piece | Status | V2 location / what to build |
| --- | --- | --- |
| MCQ + numeric + OEQ grading, never-half-grade, band write | **REUSE** | `src/app/api/attempts/[attemptId]/submit/route.ts` |
| Adaptive Q4/Q5 after Q3 | **REUSE** | `src/app/api/attempts/[attemptId]/adapt/route.ts` |
| Skill-state recompute on submit | **REUSE** | `recomputeSkillStatesForStudent` (already hooked in submit) |
| Misconception recording on submit | **REUSE** | `recordMisconceptions` (already hooked) |
| `computeMasteryBand`, `scoreMCQ`, `computeFinalScore`, `checkNumericAnswer` | **REUSE** | `src/lib/utils/scoring.ts`, `src/lib/math/checkNumericAnswer` |
| OEQ grader / adapt LLM + clients | **REUSE** | `src/lib/engine/*`, `src/lib/ai/*` |
| Pure wall-clock/closure classifier (`classifyAttemptState`, `quizTimeRemainingSeconds`, constants) | **NET-NEW (port verbatim)** | new `src/lib/student/quizAttemptState.ts` (no V2 equivalent) |
| `forfeitAttempt` pipeline | **NET-NEW (port)** | new `src/lib/quiz/forfeitAttempt.ts` |
| `GET /api/attempts/student-quiz` (active-quiz selection + existing-attempt surface) | **NET-NEW** | new route; needs `isQuizAvailableForStudent` helper (port) |
| `POST /api/attempts/start` (create/resume/lazy-forfeit, 410) | **NET-NEW** | new route |
| `POST /api/attempts/[attemptId]/signal` (heartbeat + response upsert + liveness) | **NET-NEW** | new route; **requires** `quiz_responses` unique `(attempt_id, question_id)` + new `quiz_attempts.last_active_at` |
| `POST /api/attempts/study-guide` | **NET-NEW** | new route; **requires** new `quiz_attempts.study_guide` column |
| `GET/POST /api/attempts/quiz-history` | **NET-NEW** | new route (keep Option-D no-score shape) |
| `POST /api/attempts/[attemptId]/hint` | **NET-NEW (optional v1.1)** | feeds `hint_request` frustration signal |
| Timed runner UI (`taking` state, ring timer, heartbeat effect, wall-clock tick, auto-submit, recovery banner, forfeit screen, results, review, study-guide accordion) | **NET-NEW** | new `src/app/(student)/student/quiz/page.tsx` (`'use client'`); strip V1 inline hex → token classes; route the post-quiz copy through `src/lib/copy` / Teli pool |
| Post-quiz Teli message pools (tier/locale) | **NET-NEW** | port `SCORE_VARIANTS_*` + `getScoreMessage` (no V2 equivalent) |
| `useEventTracker` behavioral hook + `events-v5` ingest + `student_events`/`cognitive_signals`/`signal_aggregates`/`student_model` pipeline | **NET-NEW or DEFER** | V2 has none of this. Decision point — see Part D. |
| `audit_logs` write on start | **ADAPT/DEFER** | no `audit_logs` table in V2; use `platform_events` (0008) or drop |

**New DB columns/tables required (minimum to reach V1 forfeit/resume parity):**
1. `ALTER TABLE quiz_attempts ADD COLUMN last_active_at timestamptz;` — liveness for closure detection.
2. `ALTER TABLE quiz_attempts ADD COLUMN forfeit_reason text CHECK (forfeit_reason IN ('closure','time_up'));`
3. `ALTER TABLE quiz_attempts ADD COLUMN study_guide text;` — cached guide.
4. `ALTER TABLE quiz_responses ADD CONSTRAINT quiz_responses_attempt_question_unique UNIQUE (attempt_id, question_id);` — required for the heartbeat upsert `onConflict`.
5. *(Only if porting full V1 telemetry)* `student_events`, and the `cognitive_signals` + `signal_aggregates` + `student_model` compute pipeline — large surface; almost certainly DEFER for the runner epic.

**Binding question answered:** YES — V2 already has the `quiz_attempts` / `quiz_responses` / `quiz_questions` / `quizzes` schema the grader reads (the grader is live and tested against it). The runner does NOT need to create that core schema. It needs three additive `quiz_attempts` columns + one unique constraint, and the new routes/UI listed above.

---

## PART D — V2 IMPROVEMENTS + RISKS

### Improvements (four-audience / Barb discipline)
- **No raw scores to students, enforced in code.** V1 already hides the percentage (Option D) but does it ad-hoc inline. V2 should route every student-facing string through `src/lib/copy` helpers and run `assertNoLeak(...)` on the post-quiz message/Teli copy so the band, the "you finished" line, the study-guide, and quiz-history are leak-guarded at the boundary (V1's pools contain no digits today, but the guard makes it durable).
- **No hardcoded hex.** V1's runner is ~1762 lines of inline `style={{ background:'#fff', color:'#6366f1' }}`. V2 forbids hardcoded hex / arbitrary `[var(--..)]`; rebuild the runner with Tier-2 token classes + `text-fg` content (per CLAUDE.md), not a copy-paste of V1 styles.
- **Server-truth timer.** Keep V1's wall-clock-from-`started_at` recompute (honest across reloads); do not regress to a client countdown.
- **Telemetry, leaner.** V2 deliberately dropped the `student_events`→`cognitive_signals` streaming pipeline in favour of computing from graded DB rows. The runner can satisfy the signals/skills engine **without** any client event stream — `recomputeSkillStatesForStudent` + `loadStudentSignals` read `quiz_responses`/`quiz_attempts` only. Porting `useEventTracker` should be an explicit, separate decision, not assumed.

### Risks / unknowns for the spec
- **BIGGEST OPEN QUESTION — telemetry scope.** V1's frustration/attention/velocity signals come from `useEventTracker` → `student_events` → `cognitive_signals`, none of which exist in V2. The spec must decide: (a) ship the runner with **DB-derived signals only** (no client event stream — current V2 design, minimal build), or (b) port the full event pipeline (new table + ingest route + compute + EMA student_model — a large net-new surface). The `quiz_responses` behavioral columns (`response_time_ms` etc.) exist and the `/signal` route already captures them, so a middle path (persist per-question behavioral metrics, skip the streamed event log) is available. **This is the single biggest scoping risk.**
- **Schema migration must land first.** The heartbeat upsert silently no-ops without the `(attempt_id, question_id)` unique constraint, and closure/forfeit/resume + study-guide are impossible without `last_active_at` / `forfeit_reason` / `study_guide`. Sequence the migration ahead of the routes.
- **Forfeit band off-by-one.** `forfeitAttempt` inlines `>=51 grade_level`; `computeMasteryBand` uses `<=50 reteach`. Equivalent at integer scores but reconcile to a single source when porting.
- **`audit_logs` absent.** V1 `/start` writes an audit row; V2 has no `audit_logs` table — drop it or retarget `platform_events` (0008).
- **Auth pattern split.** Existing V2 student pages are server components using `requireRole`; the runner is a client page that calls API routes guarded only by `getUser()` + ownership (V1 pattern). Confirm that's acceptable (it matches the grader/adapt routes already in V2) rather than forcing a server-component rewrite.
- **Timezone/wall-clock.** All timing is UTC ISO via `Date.now()` / `new Date(startedAt).getTime()` — server and client both compute from the same ISO `started_at`, so DST/timezone is not a factor; the only requirement is that `started_at` is server-stamped (it is, in `/start`).
- **LLM env.** `gradeOpenResponse`/`adaptQuestions`/study-guide need `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` in `.env.local`; live grading is unverified locally (no Supabase/keys per CLAUDE.md). Study-guide uses `OPENAI_VOICE_MODEL` (gpt-4o).

---

## Appendix — fastest reuse map for the implementer
- Grade: call existing `POST /api/attempts/[attemptId]/submit`. Adapt after Q3: existing `POST /api/attempts/[attemptId]/adapt`.
- Port verbatim (logic, restyle UI): `lib/student/quizAttemptState.ts`, `lib/quiz/forfeitAttempt.ts`, `getScoreMessage` + `SCORE_VARIANTS_*`, `isQuizAvailableForStudent`.
- Build new routes mirroring V1 shapes in Part A: `student-quiz`, `start`, `[attemptId]/signal`, `study-guide`, `quiz-history` (+ optional `hint`).
- Migration first: `quiz_attempts.last_active_at`, `quiz_attempts.forfeit_reason`, `quiz_attempts.study_guide`, `quiz_responses UNIQUE(attempt_id, question_id)`.
