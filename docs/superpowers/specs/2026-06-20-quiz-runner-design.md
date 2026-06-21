# Student Quiz Runner + Behavioral-Signal Spine — Design Spec

**Date:** 2026-06-20
**Status:** Design — for user review before `writing-plans`
**Epic:** #1 of the V1-parity "meat and potatoes" program (see `MEMORY.md` → parity program).
**Grounding (verbatim, cited):** `docs/superpowers/plans/grounding/2026-06-20-quiz-runner.md` (+ V1 `lib/signals/signalComputer.ts`/`types.ts` read for the signal section).

---

## 0. North star — the moat

CORE V2's moat is that **it acts like a coach over the shoulder** (memory `v2-moat-coach-over-the-shoulder`). Differentiated learning is a commodity; the coaching behavior is the difference. For this epic that means two things are non-negotiable:

1. **The behavioral-signal computation is the spine, not a side-feature.** The behavioral signals are *the coach's eyes* — how CORE notices a student rushing, hesitating, struggling, disengaging. Building the capture **and the computation that turns it into diagnostic signals** is the point of this epic, equal in weight to the runner UI.
2. **The runner must feel coached, not assessed.** Encouraging post-quiz Teli voice, gentle forfeit framing, adaptive difficulty, and Option-D (no raw scores to students) are the coaching register — not a cold timed test.

## 1. Goal

Ship the full V1-parity **student quiz-taking loop** on top of V2's already-built grader, **and** build the behavioral-signal computation V2 is currently missing — so that real student work flows in, produces the diagnostic signals every already-built teacher/student/parent surface is waiting to render, and does it in a coaching voice.

## 2. The binding context (why this is epic #1)

V2 has the engines (grader, skills, snapshots, leak-guard copy) and the teacher screens, but **no student work produces signals** — every downstream surface renders against empty data. The quiz runner is the cheapest producer (the 383-line grader + adapt route already exist) and it builds the attempt-submit + behavioral-capture plumbing the Assignment Player (epic #2) reuses.

## 3. Scope

**IN:**
- **A. Schema migration** — additive columns + one constraint (§6).
- **B. Ported pure logic** — wall-clock/closure classifier, forfeit pipeline, quiz-availability, post-quiz Teli message pools (restyled/leak-guarded; logic verbatim).
- **C. New API routes** — `student-quiz`, `start`, `[attemptId]/signal`, `study-guide`, `quiz-history` (reuse existing `submit` + `adapt`).
- **D. The timed runner UI** — `(student)/student/quiz` client page: ring timer, heartbeat, honest wall-clock, auto-submit, recovery banner, forfeit/results/review/study-guide screens; coaching register; Option-D; token-only.
- **E. The behavioral-signal spine (the moat)** — lightweight client capture of per-question + session behavioral aggregates → persisted via `signal` → V1's `computeSignals` ported as a pure function → output stored in V2's **existing** signal store and surfaced through V2's existing `loadStudentSignals` consumers. **No parallel `student_events`/`cognitive_signals` pipeline; no re-plumbing of live teacher code.**

**OUT (explicit):**
- The raw per-keystroke `student_events` event-log table (pure archive; the signals are computed from aggregates). Can be added later as a non-blocking capture sink if event-level ML is ever wanted.
- Per-question live `hint` route (V1 has it; defer to v1.1 — but capture `hints_used` aggregate now so the frustration signal is complete).
- The non-SPARK Assignment Player, chapter-test, extension-challenge (separate epics).
- pt-BR/EduFlux (deferred globally) — but the Teli pools are structured `EN_BY_TIER` + `PT` so the seam stays clean.

## 4. Global constraints (binding)

- **Option-D (locked):** students **never** see the numeric score/percentage. Band pill + qualitative coaching copy only; score flows server-side. Every student-facing string routes through `src/lib/copy` and is checked with `assertNoLeak(...)`.
- **Four-audience:** behavioral signals are teacher-facing as diagnostics; the student sees only coaching language (no frustration *score*, no risk *number*).
- **Token-only / WCAG-AA:** rebuild the runner with Tier-2 token classes + deep-ink `text-fg` content — NOT a copy of V1's ~1762 lines of inline hex. The un-bypassable a11y gate stays green.
- **Auth chain:** runner is a `'use client'` page calling API routes; each route does `getUser()` → ownership (`.eq('student_id', user.id)`) → `createAdminSupabaseClient()` (RLS bypassed; ownership is the backstop) — mirrors the existing `submit`/`adapt` routes.
- **Next.js 16:** `redirect()` outside try/catch; async `params`/`searchParams`/`cookies`.
- **Server-truth timer:** remaining time recomputed every tick from server-stamped `started_at` (honest across reloads) — never a client countdown.

## 5. Architecture — capture → compute → surface (the spine)

```
[runner client] --per-question + session behavioral aggregates-->  POST /signal (15s heartbeat + on advance/submit)
                                                                       |
                                                              upsert quiz_responses (behavioral cols)
                                                              + session aggregate (focus/paste/pause counts)
                                                                       |
POST /submit (existing grader) --grades--> quiz_responses.is_correct/ai_score + quiz_attempts band
                                                                       |
                                          computeSignals(questionAttempts, sessionAggregates)  [ported pure fn]
                                                                       |
                                  store ComputedSignals into V2's signal store (student_model_snapshots
                                  or new behavioral_signals row keyed by student/attempt)
                                                                       |
              loadStudentSignals() (EXISTING) reads it --> teacher student-drill (Effort/At-risk/etc.),
                                                            roster risk, parent narrative, student growth
```

The **only** new computation surface is `computeSignals` + its store; everything downstream already exists and already reads `loadStudentSignals`.

## 6. Schema migration (`supabase/migrations/0013_quiz_runner.sql`) — lands FIRST

Additive only (the core `quizzes`/`quiz_questions`/`quiz_attempts`/`quiz_responses` schema already exists, `0003`+`0010`):
1. `ALTER TABLE quiz_attempts ADD COLUMN last_active_at timestamptz;` — liveness for closure detection.
2. `ALTER TABLE quiz_attempts ADD COLUMN forfeit_reason text CHECK (forfeit_reason IN ('closure','time_up'));`
3. `ALTER TABLE quiz_attempts ADD COLUMN study_guide text;` — cached guide.
4. `ALTER TABLE quiz_responses ADD CONSTRAINT quiz_responses_attempt_question_unique UNIQUE (attempt_id, question_id);` — required for the heartbeat `onConflict` upsert (silently no-ops without it).
5. **Behavioral-aggregate completeness** (for the coach's eyes): `quiz_responses` already has `response_time_ms, hesitation_ms, answer_changes, navigation_backs, pause_count, total_pause_ms, word_count`. ADD `focus_loss_count int`, `paste_count int`, `hints_used int` (the inputs `computeFrustration`/`computeAttention` need that aren't present). 
6. The **signal store** for `ComputedSignals`: prefer extending `student_model_snapshots` with a `behavioral jsonb` column (so `loadStudentSignals` reads it with no new join), OR a slim `behavioral_signals (student_id, attempt_id, computed jsonb, created_at)` table. (Decision in the plan; `student_model_snapshots` extension is the lighter-touch default.)

The migration ships with a row in `supabase/migrations/__tests__/migrations.test.ts` asserting the columns/constraint (the established pattern).

## 7. Ported pure logic (logic verbatim; restyle/leak-guard only)

- `src/lib/student/quizAttemptState.ts` — `classifyAttemptState`, `quizTimeRemainingSeconds`, `closureSecondsRemaining`, constants `QUIZ_DURATION_MINUTES=10 / CLOSURE_FORFEIT_MINUTES=5 / RESUME_BANNER_THRESHOLD_SECONDS=30`. Pure (Date injected). Unit-tested.
- `src/lib/quiz/forfeitAttempt.ts` — synchronous MCQ+numeric-only forfeit scoring (no LLM), writes `is_complete/submitted_at/score_pct/mastery_band/forfeit_reason`, backfills response rows. Reconcile the one-point band cut to `computeMasteryBand` (single source).
- `src/lib/quiz/isQuizAvailableForStudent.ts` — availability gate.
- `src/lib/quiz/scoreMessage.ts` — `getScoreMessage` + `SCORE_VARIANTS_EN_BY_TIER` + `SCORE_VARIANTS_PT` + `pickVariantStable` + `applyName`. The coaching voice. Every variant `assertNoLeak`-checked at module load in tests.
- `src/lib/signals/computeSignals.ts` — **port V1's `signalComputer.ts` pure function**: velocity / frustration / attention / error-pattern / confidence / engagement / predictive-risk from `QuestionAttemptData[]` + session aggregates. Fully unit-tested (it's pure). This is the moat's heart.

## 8. New API routes (mirror V1 shapes; V2 auth chain)

- `GET /api/attempts/student-quiz` — select latest published, in-class-eligible, not-completed quiz (+ surface existing attempt with `started_at/last_active_at/forfeit_reason`); fall back to most-recent completed for a review landing.
- `POST /api/attempts/start` `{ quiz_id }` — verify published + enrolled; classify; **forfeit branch** → `forfeitAttempt` + HTTP **410**; **fresh** → stamp `started_at`; **active/resuming** → return state + countdown fields; **new** → insert attempt.
- `POST /api/attempts/[attemptId]/signal` `{ responses, signals, heartbeat? }` — always bump `last_active_at`; heartbeat-only returns early; else upsert `quiz_responses` behavioral cols on `(attempt_id, question_id)` + update the session aggregate. (No `signal_events` insert — the aggregates are the input to `computeSignals`.)
- `POST /api/attempts/study-guide` `{ quiz_attempt_id }` — cached `quiz_attempts.study_guide`; else build wrong-answer summary + IEP accommodations + `resilientChatCompletion` → cache.
- `GET/POST /api/attempts/quiz-history` — completed attempts list + per-question review, **Option-D: no score_pct/band to the client.**
- **Reuse unchanged:** `POST /api/attempts/[attemptId]/submit` (grader), `POST /api/attempts/[attemptId]/adapt` (after Q3). Extend `submit` with a fail-isolated hook that calls `computeSignals` + stores the result (mirrors how it already calls `recomputeSkillStatesForStudent`).

## 9. The runner UI — `src/app/(student)/student/quiz/page.tsx` (`'use client'`)

States: `loading | no-quiz | ready (notification) | taking | submitting | grading-pending | done | forfeit | review`. Elements:
- **Ring timer** from `quizTimeRemainingSeconds` (server-truth), warning thresholds 180/60/30s, **auto-submit at 0**.
- **15s heartbeat** posting `{ heartbeat:true }`; **recovery banner** with `closureSecondsRemaining` countdown after a 30s–5min gap; **lazy-forfeit** handling on the 410.
- **Lightweight behavioral capture** (the coach's eyes, client side): per-question `response_time_ms`, `answer_changes`, `hesitation_ms`, `navigation_backs`, `pause_count`/`total_pause_ms` (visibilitychange/blur), `focus_loss_count`, `paste_count` (paste listener), `word_count`, `hints_used` — posted via `/signal`. Cheap, no library.
- **Adaptive** Q4/Q5 via `/adapt` after Q3.
- **Submit** → coached results: "You finished!" + band pill + **Teli message (TTS)** + ✓/✗ review (no per-question numbers) + study-guide accordion when `score_pct < 80` — all leak-guarded. **Forfeit screen:** honest, gentle, no raw score.
- Token-only styling; reuse the V2 component kit + the Pop-Art/coaching tone already shipped.

## 10. V2 improvements over V1 (the deliberate "better")

1. **The coach's eyes, cleanly wired** — behavioral signals computed from aggregates into V2's existing signal store, surfaced through the live `loadStudentSignals` consumers; no parallel `cognitive_signals` system, no re-plumb of shipped teacher code.
2. **Leak-guard at the boundary** — Option-D enforced via `assertNoLeak` on every student string (V1 did it ad-hoc inline).
3. **Token-only, accessible runner** (V1: ~1762 lines of inline hex).
4. **Single source for band cut** (reconcile the V1 forfeit off-by-one).
5. **Coaching register** as an explicit design rule, not incidental.

## 11. Sub-project decomposition / build phases

This is one epic with a natural internal order (each phase independently testable):
- **Phase 1 — Foundation:** migration (§6) + ported pure logic (§7, incl. `computeSignals`, all unit-tested with no DB).
- **Phase 2 — Routes:** `student-quiz`/`start`/`signal`/`study-guide`/`quiz-history` + the `submit` signal-store hook (route tests with mocked admin client).
- **Phase 3 — Runner UI:** the client page + behavioral capture + coached results (jsdom component tests + a leak-audit test).
- **Phase 4 — Surface wiring + verify:** confirm `loadStudentSignals`/teacher student-drill render the new behavioral signals; end-to-end smoke against seeded demo data; adversarial whole-branch review before merge.

(If the plan prefers, Phase 1's `computeSignals` + store can be split into its own sub-plan since the Assignment Player reuses it — but it ships within this epic.)

## 12. Testing

- Pure logic: exhaustive unit tests for `quizAttemptState` (each state + boundaries), `forfeitAttempt`, `computeSignals` (each signal + insufficient-data paths), `getScoreMessage` (+ `assertNoLeak` over every variant).
- Routes: vitest `node` — auth/ownership gates, the 410 forfeit branch, heartbeat upsert + liveness, study-guide cache, Option-D no-score shapes.
- Runner: jsdom — timer math, auto-submit, recovery banner, results render, **leak-audit** (no digits/% on any student screen).
- Migration test (columns/constraint).
- Gates: full suite + `tsc` + `npm run a11y` + build; adversarial review before merge.

## 13. Risks / open items

- **`computeSignals` fidelity:** confirm during the plan that each ported signal's event inputs are fully covered by the captured aggregates (focus/paste/pause counts + per-question metrics). If any signal needs a sequence we don't aggregate, capture that aggregate — don't add the raw log.
- **Signal store choice** (`student_model_snapshots.behavioral jsonb` vs a `behavioral_signals` table) — decide in the plan; verify `loadStudentSignals` surfacing.
- **Live LLM unverified locally** (no `.env.local` keys per CLAUDE.md): grader/adapt/study-guide/Teli need `ANTHROPIC_API_KEY`+`OPENAI_API_KEY`; gate code paths so a missing key degrades gracefully (study-guide optional, Teli pool is static text so it always works).
- **`audit_logs` absent in V2** — drop the V1 start audit row or retarget `platform_events`.
- **Two student-quiz attempts colliding** — `start` is idempotent per `(quiz_id, student_id)` via the classifier; verify the unique/ordering assumptions.

## 14. Open question for you before `writing-plans`

Only one, and it's small: the **signal store** — extend `student_model_snapshots` with a `behavioral jsonb` column (lightest; `loadStudentSignals` already reads that table) vs a dedicated `behavioral_signals` table (cleaner separation). I lean toward extending the snapshot. I'll pick the snapshot extension unless you prefer otherwise — everything else above is ready to turn into a task-by-task plan.
