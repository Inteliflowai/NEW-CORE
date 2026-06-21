# Student Quiz Runner — Implementation Plan (Phase 2: API Routes)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the API routes that drive the quiz loop on top of Phase 1's foundation — quiz selection, attempt lifecycle (start/resume/lazy-forfeit), the heartbeat/behavioral-capture route, study-guide, quiz-history — and wire `computeSignals` → the `behavioral_signals` EMA model into the existing grader on submit. This is the layer that makes real student work flow in and produce the diagnostic signals (the coach's eyes).

**Architecture:** Thin Next.js 16 `route.ts` handlers under `src/app/api/attempts/`, each `getUser()` → ownership-gated → admin client; they orchestrate the Phase-1 pure helpers + the existing grader. Tests are Vitest `node` with a mocked admin client (no live Supabase/LLM).

**Tech Stack:** TypeScript, Next.js 16 App Router (`route.ts`, async `params`), Vitest 4, Supabase admin client.

**Spec:** `docs/superpowers/specs/2026-06-20-quiz-runner-design.md` §8. **Grounding (verbatim V1 route shapes):** `docs/superpowers/plans/grounding/2026-06-20-quiz-runner.md` §A.2–A.5. **Phase-1 ledger (interfaces + carried notes):** `.git/sdd/progress.md`. **V1 source:** `C:/users/inteliflow/core/app/api/attempts/`.

## Global Constraints

- **Auth chain (every route):** `const supabase = await createServerSupabaseClient(); const { data: { user } } = await supabase.auth.getUser();` → 401 if no user; then `const admin = createAdminSupabaseClient();` and **object-level ownership** on every attempt query (`.eq('student_id', user.id)`) → 404/403 on mismatch. RLS is NOT the backstop. (`src/lib/supabase/server.ts`.)
- **Option-D:** student-facing route responses NEVER include `score_pct`/`mastery_band` raw numbers where the runner shows them to the student. `quiz-history` returns NO score (band/score omitted from the client payload). The post-quiz band pill + Teli copy carry the result; the score flows server-side only.
- **Phase-1 helpers to USE (already on the branch):** `classifyAttemptState`/`quizTimeRemainingSeconds`/`closureSecondsRemaining` + constants (`src/lib/student/quizAttemptState.ts`); `forfeitAttempt` (`src/lib/quiz/forfeitAttempt.ts`); `isQuizAvailableForStudent` (`src/lib/quiz/isQuizAvailableForStudent.ts`); `computeSignals` + `RawSessionData`/`SessionAggregates`/`QuestionAttemptData` (`src/lib/signals/computeSignals.ts` + `behavioralTypes.ts`); `upsertBehavioralSignals` (`src/lib/signals/behavioralModel.ts`); `getScoreMessage` (`src/lib/quiz/scoreMessage.ts`).
- **Reuse, do NOT modify** `src/app/api/attempts/[attemptId]/submit/route.ts` grader logic except the additive signal-store hook in Task 7; `[attemptId]/adapt/route.ts` unchanged.
- **Tests:** Vitest `node` env (route tests — NO jsdom header); mock `@/lib/supabase/server` (both clients) + any LLM module; assert auth/ownership gates + the happy path + Option-D shapes. Follow the existing route-test pattern in `src/app/api/**/__tests__/`.
- **No live deps in tests**; `npx tsc --noEmit` clean; commit after each task.

---

### Task 1: Migration `0014` — `quiz_attempts.session_aggregates jsonb`

**Files:** Create `supabase/migrations/0014_quiz_session_aggregates.sql`; modify `supabase/migrations/__tests__/migrations.test.ts`.

**Interfaces:** Produces `quiz_attempts.session_aggregates jsonb NOT NULL DEFAULT '{}'::jsonb` — the running session-level behavioral aggregate (the 6 session-only `SessionAggregates` fields + any cumulative counts) the heartbeat route writes and the submit hook reads to build `SessionAggregates`.

- [ ] **Step 1: Failing test** — append a `describe('0014_quiz_session_aggregates.sql', …)` block asserting `sql` matches `/ALTER TABLE\s+(public\.)?quiz_attempts\s+ADD COLUMN.*session_aggregates\s+jsonb/i` and the `DEFAULT '{}'::jsonb`. (Mirror the 0013 test block.)
- [ ] **Step 2: Run → FAIL** (`npx vitest run supabase/migrations/__tests__/migrations.test.ts`).
- [ ] **Step 3: Write** `0014_quiz_session_aggregates.sql`: `ALTER TABLE public.quiz_attempts ADD COLUMN IF NOT EXISTS session_aggregates jsonb NOT NULL DEFAULT '{}'::jsonb;`
- [ ] **Step 4: Run → PASS**; `tsc` clean.
- [ ] **Step 5: Commit** `feat(quiz): 0014 migration — quiz_attempts.session_aggregates`

---

### Task 2: `GET /api/attempts/student-quiz`

**Files:** Create `src/app/api/attempts/student-quiz/route.ts`, `src/app/api/attempts/student-quiz/__tests__/route.test.ts`.

**Interfaces:** Produces `GET` returning `{ quiz: {…, quiz_questions:[…]} | null, existing_attempt: {id,is_complete,score_pct,mastery_band,adapted_questions,started_at,last_active_at,forfeit_reason} | null, teacher_name, class_name }`. Optional `?quizId=` (UUID-guarded against literal `"undefined"`). Consumes `isQuizAvailableForStudent`.

**Port from:** V1 `app/api/attempts/student-quiz/route.ts` (grounding §A.2 Step 1) — adapt to V2 auth (`createServerSupabaseClient().auth.getUser()` + admin client) and V2 table/column names (verify `quizzes`/`quiz_questions`/`enrollments` columns against `supabase/migrations/0003`).

- [ ] **Step 1: Failing test** — mock `@/lib/supabase/server` (server client `auth.getUser` + admin client query chains) + `isQuizAvailableForStudent`. Cover: 401 when no user; returns the eligible quiz + existing attempt for a happy path; `?quizId=undefined` is ignored (treated as no quizId); falls back to most-recent completed when none active (returns it as the review landing). Use the established route-test mock pattern.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the route (auth → admin → select latest eligible quiz via enrollments + `isQuizAvailableForStudent` → surface most-recent attempt → shape the response).
- [ ] **Step 4: Run → PASS**; `tsc` clean.
- [ ] **Step 5: Commit** `feat(quiz): GET student-quiz route (active-quiz selection)`

---

### Task 3: `POST /api/attempts/start`

**Files:** Create `src/app/api/attempts/start/route.ts` + `__tests__/route.test.ts`.

**Interfaces:** `POST { quiz_id }`. Consumes `classifyAttemptState` + `forfeitAttempt`. Returns by state: forfeit (closure/time_up) → **HTTP 410** `{ attempt_id, forfeited:true, forfeit_reason, score_pct, mastery_band }`; fresh → stamp `started_at`, return `{attempt_id, started_at, state:'active'}`; active/resuming → `{attempt_id, started_at, state, resumed_after_seconds, closure_forfeit_minutes, resume_banner_threshold_seconds}`; new attempt → insert + return `{attempt_id, started_at, state:'active'}`. 400 missing quiz_id; 404 quiz not published; 403 not enrolled; 400 already-complete.

**Port from:** V1 `app/api/attempts/start/route.ts` (grounding §A.2 Step 2). **NOTE (from Phase-1 ledger):** V2's `forfeitAttempt` signature is `{admin, attemptId, reason}` and does NOT accept a `submittedAt` param — call it as such; it defaults `submitted_at` to `last_active_at`.

- [ ] **Step 1: Failing test** — mock the clients + `classifyAttemptState` + `forfeitAttempt`. Cover: 401; 400 no quiz_id; 404 unpublished; 403 not enrolled; **410 forfeit branch** (classify→closure_forfeit → `forfeitAttempt` called → 410 body shape); fresh branch stamps `started_at`; active branch returns state fields; new-attempt insert path; 400 already-complete.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run → PASS**; `tsc` clean.
- [ ] **Step 5: Commit** `feat(quiz): POST start route (create/resume/lazy-forfeit 410)`

---

### Task 4: `POST /api/attempts/[attemptId]/signal` (heartbeat + behavioral capture)

**Files:** Create `src/app/api/attempts/[attemptId]/signal/route.ts` + `__tests__/route.test.ts`.

**Interfaces:** `POST` (async `params: Promise<{attemptId}>`), body `{ responses?, signals?, sessionAggregates?, heartbeat? }`. Always bumps `quiz_attempts.last_active_at = now` (best-effort). If `sessionAggregates` present, writes `quiz_attempts.session_aggregates = sessionAggregates` (the running session-level behavioral aggregate from Task 1's column). Heartbeat-only (empty `responses`) returns `{ ok:true, heartbeat_only:true }` after the liveness bump. Else **upserts** each answered position into `quiz_responses` on `onConflict:'attempt_id,question_id'` with the behavioral columns (`response_time_ms, hesitation_ms, answer_changes, navigation_backs, pause_count, total_pause_ms, word_count, focus_loss_count, paste_count, hints_used, question_type_scored`). Ownership: load attempt `.eq('student_id', user.id)` → 404; 400 if complete.

**Port from:** V1 `app/api/attempts/[attemptId]/signal/route.ts` (grounding §A.2 Step 3) — V2 drops the V1 `signal_events` insert (no event-log table; the session aggregate + per-question cols are the signal inputs).

- [ ] **Step 1: Failing test** — mock clients. Cover: 401; ownership 404; 400 if complete; heartbeat-only path (liveness bumped, `heartbeat_only:true`, NO quiz_responses upsert); full path upserts quiz_responses on `onConflict:'attempt_id,question_id'` with behavioral cols; `sessionAggregates` written to `quiz_attempts.session_aggregates`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run → PASS**; `tsc` clean.
- [ ] **Step 5: Commit** `feat(quiz): POST signal route (heartbeat + behavioral upsert)`

---

### Task 5: `POST /api/attempts/study-guide`

**Files:** Create `src/app/api/attempts/study-guide/route.ts` + `__tests__/route.test.ts`.

**Interfaces:** `POST { quiz_attempt_id }`. Ownership (`attempt.student_id !== user.id` → 403). Returns cached `quiz_attempts.study_guide` if present (`{study_guide, cached:true}`); else builds a wrong-answer summary (`is_correct===false` OR non-mcq `ai_score < 0.7`), calls `resilientChatCompletion` (`src/lib/ai/openai.ts`, model `OPENAI_VOICE_MODEL`, temp 0.5, max_tokens 400), caches into `quiz_attempts.study_guide`, returns `{study_guide, cached:false}`. If no OpenAI key / LLM error → return a graceful `{study_guide:null, cached:false, unavailable:true}` (do NOT 500 — study guide is optional).

**Port from:** V1 `app/api/attempts/study-guide/route.ts` (grounding §A.4).

- [ ] **Step 1: Failing test** — mock clients + `resilientChatCompletion`. Cover: 401; ownership 403; cached-return path (no LLM call); generate path (LLM called, cached write, `{study_guide, cached:false}`); LLM-error/no-key → graceful `unavailable:true` (no 500).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run → PASS**; `tsc` clean.
- [ ] **Step 5: Commit** `feat(quiz): POST study-guide route (cached, graceful-degrade)`

---

### Task 6: `GET/POST /api/attempts/quiz-history` (Option-D)

**Files:** Create `src/app/api/attempts/quiz-history/route.ts` + `__tests__/route.test.ts`.

**Interfaces:** `GET` (optional `?class_id=`) → `{ classes, quizzes:[{attempt_id, quiz_id, quiz_title, class_id, class_name, submitted_at}] }` for completed attempts — **Option-D: score_pct/mastery_band DELIBERATELY OMITTED from the client payload.** `POST { attempt_id }` → per-question review `{ review:[{position, question_type, question_text, correct_answer, choices, rubric, student_answer, is_correct, ai_score, explanation}] }` — **no overall score returned.** Ownership on both.

**Port from:** V1 `app/api/attempts/quiz-history/route.ts` (grounding §A.5).

- [ ] **Step 1: Failing test** — mock clients. Cover: 401; GET returns completed attempts WITHOUT score_pct/mastery_band (assert those keys are absent); POST returns per-question review for an owned attempt; ownership gate.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run → PASS**; `tsc` clean.
- [ ] **Step 5: Commit** `feat(quiz): quiz-history route (Option-D, no score to client)`

---

### Task 7: `submit` route — behavioral-signal store hook (the moat wiring)

**Files:** Modify `src/app/api/attempts/[attemptId]/submit/route.ts` (additive hook only); Test `src/app/api/attempts/[attemptId]/__tests__/submit-signals.test.ts`.

**Interfaces:** On the **all-clean** grading path (right where it already calls `recomputeSkillStatesForStudent`), add a **fail-isolated** hook: build `QuestionAttemptData[]` from the graded `quiz_responses` (`questionId`, `questionIndex` from position, `isCorrect`, `timeTakenMs` from `response_time_ms`, `changeCount` from `answer_changes`, `hintsUsed` from `hints_used`) + `SessionAggregates` from `quiz_attempts.session_aggregates` (default each field to 0/false), assemble `RawSessionData` (`sessionStartMs`/`sessionEndMs` from `started_at`/`submitted_at`), call `computeSignals(...)`, then `upsertBehavioralSignals(admin, { studentId, schoolId, next })`. Wrap in try/catch — a signal failure must NEVER block the submit response (mirror the existing `recomputeSkillStatesForStudent` fail-isolation).

- [ ] **Step 1: Failing test** — a focused test mocking `computeSignals` + `upsertBehavioralSignals` (or the admin client) that asserts: on an all-clean submit, the hook builds the session data and calls `upsertBehavioralSignals` once with the student/school + a `ComputedSignals`; and that a throw inside the hook does NOT change the route's success response (fail-isolated). Reuse the existing submit-route test fixtures/mocks as the base.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the additive hook (do not alter grading/band logic).
- [ ] **Step 4: Run → PASS**; full suite + `tsc` clean.
- [ ] **Step 5: Commit** `feat(quiz): wire computeSignals -> behavioral_signals on submit (fail-isolated)`

---

## Phase 2 exit criteria
- Tasks 1–7 committed; `npx vitest run` green; `tsc` clean; `npm run a11y` unaffected; `npm run build` clean. Whole-branch (Phase 1+2) review before continuing.
- **Then:** Phase 3 (the coached runner UI consuming these routes) → Phase 4 (verify the teacher surfaces light up from real submits) → epic review → merge.

## Self-review notes
- **Spec coverage (§8):** student-quiz→T2, start→T3, signal→T4, study-guide→T5, quiz-history→T6, submit hook→T7, session-aggregate storage→T1.
- **Carried-forward:** the 6 SessionAggregates session fields land in `quiz_attempts.session_aggregates` (T1) written by `signal` (T4) and read by the submit hook (T7); the Phase-1 `forfeitAttempt` no-`submittedAt`-param note is called out in T3.
- **Type consistency:** the submit hook (T7) builds `QuestionAttemptData`/`SessionAggregates`/`RawSessionData` exactly as defined in `src/lib/signals/behavioralTypes.ts` and calls `computeSignals`/`upsertBehavioralSignals` with their Phase-1 signatures.
