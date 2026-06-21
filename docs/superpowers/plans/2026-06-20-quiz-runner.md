# Student Quiz Runner — Implementation Plan (Phase 1: Foundation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the migration + all pure, unit-testable foundation logic for the Student Quiz Runner (the wall-clock/forfeit/resume classifier, forfeit scorer, quiz-availability gate, post-quiz Teli message pools, the `computeSignals` behavioral computer, and the dedicated `behavioral_signals` EMA model helper) — the critical path the routes and runner UI (later phases) build on.

**Architecture:** Pure functions (Date/data injected, no DB/React) ported from V1 with V2 disciplines (token-only is N/A here — no UI; leak-guard IS in scope for the Teli pools), plus one additive SQL migration and one DB helper for the dedicated per-student behavioral model. Everything here is testable with Vitest `node` + mocked admin client; no live Supabase/LLM needed.

**Tech Stack:** TypeScript, Next.js 16 (App Router, `src/`), Vitest 4, Supabase (Postgres migrations under `supabase/migrations/`), `@supabase/supabase-js`.

**Spec:** `docs/superpowers/specs/2026-06-20-quiz-runner-design.md`. **Grounding (verbatim V1 code + V2 backend, cite freely):** `docs/superpowers/plans/grounding/2026-06-20-quiz-runner.md`. **V1 source to port from:** `C:/users/inteliflow/core` (top-level `app/`+`lib/`, no `src/`).

## Global Constraints

- **Vitest:** default env `node`. Route/component tests follow each file's header; these Phase-1 tests are pure-logic `node` tests — NO jsdom header needed. Run a single file: `npx vitest run <path>`. Full suite: `npx vitest run`.
- **No live deps:** all Phase-1 code is pure or mocks the admin client. Do NOT call real Supabase/Anthropic/OpenAI in tests.
- **Leak-guard (Option-D):** any student-facing string (the Teli pools) must pass `assertNoLeak` from `src/lib/copy/leakGuard.ts` — no bare digits, `%`, "score N", etc. Tests assert every pool variant is leak-free.
- **Single source for the mastery band:** use `computeMasteryBand` from `src/lib/utils/scoring.ts` (`<=50 reteach / <=79 grade_level / else advanced`). Do NOT re-inline V1's off-by-one `>=51` cut.
- **Admin client:** `createAdminSupabaseClient()` from `src/lib/supabase/server.ts` (sync, reads `SUPABASE_SECRET_KEY`, bypasses RLS). Migrations are plain SQL in `supabase/migrations/NNNN_*.sql`; the established test pattern asserts on the SQL text in `supabase/migrations/__tests__/migrations.test.ts`.
- **TS:** `npx tsc --noEmit` must stay clean. Prettier/ESLint per repo.
- **Commit** after each task passes its tests.

---

### Task 1: Migration `0013_quiz_runner.sql`

**Files:**
- Create: `supabase/migrations/0013_quiz_runner.sql`
- Modify (add assertions): `supabase/migrations/__tests__/migrations.test.ts`

**Interfaces:**
- Produces: the DB shape later tasks/phases rely on — `quiz_attempts.last_active_at timestamptz`, `quiz_attempts.forfeit_reason text CHECK IN ('closure','time_up')`, `quiz_attempts.study_guide text`; `quiz_responses` new cols `focus_loss_count int`, `paste_count int`, `hints_used int`; `quiz_responses UNIQUE(attempt_id, question_id)`; and a new table `behavioral_signals(student_id uuid PK → users(id) ON DELETE CASCADE, school_id uuid → schools(id) ON DELETE CASCADE, computed jsonb NOT NULL DEFAULT '{}'::jsonb, observation_count int NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now())`.

- [ ] **Step 1: Write the failing test** — append to `supabase/migrations/__tests__/migrations.test.ts` a describe block that reads the new file and asserts its contents:

```ts
import * as fs from 'fs';
import * as path from 'path';
// ... (follow the file's existing helper for reading a migration; mirror the homework_attempts test at line ~227)
describe('0013_quiz_runner.sql', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', '0013_quiz_runner.sql'), 'utf8',
  );
  it('adds quiz_attempts runner columns', () => {
    expect(sql).toMatch(/ALTER TABLE\s+(public\.)?quiz_attempts\s+ADD COLUMN.*last_active_at/i);
    expect(sql).toMatch(/forfeit_reason[\s\S]*CHECK[\s\S]*'closure'[\s\S]*'time_up'/i);
    expect(sql).toMatch(/ADD COLUMN.*study_guide/i);
  });
  it('adds quiz_responses behavioral columns + unique constraint', () => {
    expect(sql).toMatch(/quiz_responses[\s\S]*focus_loss_count/i);
    expect(sql).toMatch(/quiz_responses[\s\S]*paste_count/i);
    expect(sql).toMatch(/quiz_responses[\s\S]*hints_used/i);
    expect(sql).toMatch(/UNIQUE\s*\(\s*attempt_id\s*,\s*question_id\s*\)/i);
  });
  it('creates the behavioral_signals per-student model table', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.behavioral_signals/i);
    expect(sql).toMatch(/student_id[\s\S]*PRIMARY KEY|PRIMARY KEY[\s\S]*student_id/i);
    expect(sql).toMatch(/computed\s+jsonb/i);
    expect(sql).toMatch(/observation_count\s+int/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run supabase/migrations/__tests__/migrations.test.ts` → FAIL (file not found / patterns missing).

- [ ] **Step 3: Write the migration** `supabase/migrations/0013_quiz_runner.sql`:

```sql
-- 0013_quiz_runner.sql
-- Student Quiz Runner foundation: forfeit/resume liveness + study-guide cache on
-- quiz_attempts; behavioral-aggregate completeness + heartbeat-upsert constraint on
-- quiz_responses; and the dedicated per-student behavioral_signals EMA model
-- (the coach's evolving understanding — replaces V1's cognitive_signals/student_model
-- /signal_aggregates/signal_history sprawl with one model).
-- Additive only. FKs only to users/schools (exist by 0001).

ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz,
  ADD COLUMN IF NOT EXISTS forfeit_reason text
    CHECK (forfeit_reason IS NULL OR forfeit_reason IN ('closure','time_up')),
  ADD COLUMN IF NOT EXISTS study_guide text;

ALTER TABLE public.quiz_responses
  ADD COLUMN IF NOT EXISTS focus_loss_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paste_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hints_used integer NOT NULL DEFAULT 0;

-- Required for the heartbeat upsert onConflict(attempt_id, question_id).
-- Guarded so re-runs don't error if it already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quiz_responses_attempt_question_unique'
  ) THEN
    ALTER TABLE public.quiz_responses
      ADD CONSTRAINT quiz_responses_attempt_question_unique UNIQUE (attempt_id, question_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.behavioral_signals (
  student_id        uuid        PRIMARY KEY REFERENCES public.users(id)   ON DELETE CASCADE,
  school_id         uuid        REFERENCES public.schools(id)             ON DELETE CASCADE,
  computed          jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- latest EMA-smoothed ComputedSignals
  observation_count integer     NOT NULL DEFAULT 0,             -- # of submits folded into the model
  updated_at        timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: Run tests to verify pass** — `npx vitest run supabase/migrations/__tests__/migrations.test.ts` → PASS. Also `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit** — `git add supabase/migrations/0013_quiz_runner.sql supabase/migrations/__tests__/migrations.test.ts && git commit -m "feat(quiz): 0013 migration — runner columns + behavioral_signals model"`

---

### Task 2: `quizAttemptState.ts` (port the wall-clock/closure classifier)

**Files:**
- Create: `src/lib/student/quizAttemptState.ts`
- Test: `src/lib/student/__tests__/quizAttemptState.test.ts`

**Interfaces:**
- Produces: `classifyAttemptState(input: AttemptStateInput): AttemptState`, `quizTimeRemainingSeconds(startedAt: string|null, now: Date, quizDurationMinutes?: number): number`, `closureSecondsRemaining(lastActiveAt: string|null, now: Date, closureForfeitMinutes?: number): number`, and constants `QUIZ_DURATION_MINUTES=10`, `CLOSURE_FORFEIT_MINUTES=5`, `RESUME_BANNER_THRESHOLD_SECONDS=30`. `AttemptState = 'completed_normal'|'closure_forfeit'|'time_up_forfeit'|'fresh'|'active'|'resuming_after_gap'`. `AttemptStateInput = { isComplete: boolean; forfeitReason: 'closure'|'time_up'|null; startedAt: string|null; lastActiveAt: string|null; now: Date; quizDurationMinutes?: number; closureForfeitMinutes?: number }`.

**Source to port:** V1 `lib/student/quizAttemptState.ts` (verbatim logic — see grounding §A.1 for the exact code). Pure; Date injected. No V2 changes needed beyond TS strictness.

- [ ] **Step 1: Write the failing tests** `src/lib/student/__tests__/quizAttemptState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  classifyAttemptState, quizTimeRemainingSeconds, closureSecondsRemaining,
  QUIZ_DURATION_MINUTES, CLOSURE_FORFEIT_MINUTES, RESUME_BANNER_THRESHOLD_SECONDS,
} from '../quizAttemptState';

const base = { isComplete: false, forfeitReason: null as null, startedAt: '2026-06-20T00:00:00.000Z', lastActiveAt: '2026-06-20T00:00:00.000Z' };
const at = (s: string) => new Date(s);

describe('classifyAttemptState', () => {
  it('completed → completed_normal / closure_forfeit / time_up_forfeit by forfeitReason', () => {
    expect(classifyAttemptState({ ...base, isComplete: true, now: at('2026-06-20T00:01:00Z') })).toBe('completed_normal');
    expect(classifyAttemptState({ ...base, isComplete: true, forfeitReason: 'closure', now: at('2026-06-20T00:01:00Z') })).toBe('closure_forfeit');
    expect(classifyAttemptState({ ...base, isComplete: true, forfeitReason: 'time_up', now: at('2026-06-20T00:01:00Z') })).toBe('time_up_forfeit');
  });
  it('null startedAt → fresh', () => {
    expect(classifyAttemptState({ ...base, startedAt: null, lastActiveAt: null, now: at('2026-06-20T00:00:10Z') })).toBe('fresh');
  });
  it('elapsed >= 10min → time_up_forfeit', () => {
    expect(classifyAttemptState({ ...base, now: at('2026-06-20T00:10:00Z') })).toBe('time_up_forfeit');
  });
  it('idle gap >= 5min → closure_forfeit', () => {
    expect(classifyAttemptState({ ...base, lastActiveAt: '2026-06-20T00:00:00Z', now: at('2026-06-20T00:05:00Z') })).toBe('closure_forfeit');
  });
  it('gap 30s..5min → resuming_after_gap; gap < 30s → active', () => {
    expect(classifyAttemptState({ ...base, lastActiveAt: '2026-06-20T00:00:00Z', now: at('2026-06-20T00:00:45Z') })).toBe('resuming_after_gap');
    expect(classifyAttemptState({ ...base, lastActiveAt: '2026-06-20T00:00:00Z', now: at('2026-06-20T00:00:10Z') })).toBe('active');
  });
});

describe('quizTimeRemainingSeconds', () => {
  it('null start → full duration; counts down; floors at 0', () => {
    expect(quizTimeRemainingSeconds(null, at('2026-06-20T00:00:00Z'))).toBe(600);
    expect(quizTimeRemainingSeconds('2026-06-20T00:00:00Z', at('2026-06-20T00:01:00Z'))).toBe(540);
    expect(quizTimeRemainingSeconds('2026-06-20T00:00:00Z', at('2026-06-20T00:20:00Z'))).toBe(0);
  });
});

describe('constants', () => {
  it('match V1 tunables', () => {
    expect(QUIZ_DURATION_MINUTES).toBe(10);
    expect(CLOSURE_FORFEIT_MINUTES).toBe(5);
    expect(RESUME_BANNER_THRESHOLD_SECONDS).toBe(30);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/lib/student/__tests__/quizAttemptState.test.ts` → FAIL (module not found).
- [ ] **Step 3: Port the implementation** into `src/lib/student/quizAttemptState.ts` verbatim from V1 `lib/student/quizAttemptState.ts` (grounding §A.1 has the exact code: the constants, `classifyAttemptState`, `quizTimeRemainingSeconds`, `closureSecondsRemaining`). Keep it pure; export the named symbols above.
- [ ] **Step 4: Run to verify pass** — same command → PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(quiz): port quizAttemptState wall-clock/closure classifier"`

---

### Task 3: `computeSignals.ts` (port V1's behavioral computer — the coach's eyes)

**Files:**
- Create: `src/lib/signals/computeSignals.ts`, `src/lib/signals/behavioralTypes.ts`
- Test: `src/lib/signals/__tests__/computeSignals.test.ts`

**Interfaces:**
- Produces: `computeSignals(session: RawSessionData): ComputedSignals` (pure). Types in `behavioralTypes.ts`: `QuestionAttemptData = { questionId: string; questionIndex: number; isCorrect: boolean; timeTakenMs: number; changeCount: number; hintsUsed: number }`; `SessionAggregates = { focusLossCount: number; pasteCount: number; pauseCount: number; totalPauseMs: number }`; `RawSessionData = { studentId: string; sessionId: string; context: 'quiz'|'homework'|'tutor'; schoolId: string|null; questionAttempts: QuestionAttemptData[]; aggregates: SessionAggregates; sessionStartMs: number; sessionEndMs: number }`; `ComputedSignals = { learningVelocity: number; velocityTrend: 'accelerating'|'stable'|'decelerating'; frustrationScore: number; frustrationIndicators: string[]; attentionScore: number; attentionGaps: number; errorPatternType: 'careless'|'conceptual'|'procedural'|'random'|'insufficient_data'; errorFrequency: number; confidenceScore: number; confidenceAccuracy: number; engagementScore: number; engagementStyle: 'methodical'|'impulsive'|'exploratory'|'passive'; predictiveRiskScore: number; riskFactors: string[]; sessionDurationMs: number }`.

**Source to port:** V1 `lib/signals/signalComputer.ts` + `lib/signals/types.ts` (grounding §A.7 + the read in the spec). **V2 ADAPTATION (important):** V1's `computeFrustration`/`computeAttention`/`computeEngagement` read a raw `events: StudentEvent[]` array; V2 replaces those event reads with the equivalent **counts** from `SessionAggregates` (focusLossCount, pasteCount, pauseCount, totalPauseMs). **Task 3, Step 0 (the verification gate from the spec §13):** open V1's `signalComputer.ts` and, for EACH of the six computed signals, confirm the event usage reduces to a count/aggregate already in `SessionAggregates` or `QuestionAttemptData`; if any signal needs a sequence we don't have, ADD the needed aggregate to `SessionAggregates` (and note it for the Task 1 migration follow-up) rather than reintroducing a raw event log. Document the per-signal mapping in a comment block at the top of `computeSignals.ts`.

- [ ] **Step 1: Write the failing tests** `computeSignals.test.ts` — cover: velocity (correct/min + trend), errorPattern from attempts, confidence from speed, frustration uses `aggregates`, attention `attentionGaps === aggregates.focusLossCount`, engagement style, predictiveRisk, and the **insufficient-data** path (empty attempts → `errorPatternType: 'insufficient_data'`, scores defined/clamped 0–1). Use small deterministic fixtures; assert exact values for the pure arithmetic (velocity) and bounded ranges for the heuristics.
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Port + adapt** the implementation per the mapping above; keep it a pure function; clamp all 0–1 scores.
- [ ] **Step 4: Run to verify pass.** `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(signals): port computeSignals behavioral computer (aggregate inputs)"`

---

### Task 4: `behavioralModel.ts` (the dedicated EMA model helper)

**Files:**
- Create: `src/lib/signals/behavioralModel.ts`
- Test: `src/lib/signals/__tests__/behavioralModel.test.ts`

**Interfaces:**
- Consumes: `ComputedSignals` (Task 3), `createAdminSupabaseClient` shape.
- Produces: pure `emaMerge(prev: ComputedSignals|null, next: ComputedSignals, alpha?: number): ComputedSignals` (default `alpha=0.4`; numeric fields EMA-blended, categorical fields = `next`, arrays = `next`); and `upsertBehavioralSignals(admin, { studentId: string; schoolId: string|null; next: ComputedSignals }): Promise<void>` which reads `behavioral_signals` by `student_id`, computes `emaMerge(prev?.computed ?? null, next)`, and upserts `{ student_id, school_id, computed, observation_count: (prev?.observation_count ?? 0) + 1, updated_at: now }`. Reads via the injected admin client; **NO `Date.now()` inside pure `emaMerge`** (inject timestamps at the call site if needed for tests — `updatedAt` is set by the DB default / passed in `upsert`).

- [ ] **Step 1: Write failing tests** — `emaMerge`: null prev → returns next; numeric blend `0.4*next + 0.6*prev` on `learningVelocity`/`frustrationScore`/etc.; categorical (`velocityTrend`, `engagementStyle`) take `next`. `upsertBehavioralSignals`: mock the admin client chain (`from('behavioral_signals').select().eq().maybeSingle()` returns a prev row; `.upsert(...)` captures the payload) and assert the merged `computed` + `observation_count` increment + `onConflict: 'student_id'`. (Follow the existing admin-mock pattern in `src/lib/teacher/__tests__/firstClassIdForTeacher.test.ts`.)
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement** `emaMerge` (pure) + `upsertBehavioralSignals`.
- [ ] **Step 4: Run to verify pass.** `tsc` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(signals): behavioral_signals EMA model helper (the coach's evolving model)"`

---

### Task 5: `scoreMessage.ts` (port post-quiz Teli pools — the coaching voice) + leak audit

**Files:**
- Create: `src/lib/quiz/scoreMessage.ts`
- Test: `src/lib/quiz/__tests__/scoreMessage.test.ts`

**Interfaces:**
- Consumes: `assertNoLeak`/`hasLeak` from `src/lib/copy/leakGuard.ts`.
- Produces: `getScoreMessage(pct: number, seed: string, locale: 'en'|'pt', tier: 'elementary'|'middle'|'high', firstName: string|null): { message: string; teliMsg: string; teliState: string }`, plus the pools `SCORE_VARIANTS_EN_BY_TIER`, `SCORE_VARIANTS_PT`, and helpers `pickVariantStable`, `applyName`.

**Source to port:** V1 `app/(dashboard)/student/quiz/page.tsx:162-395` (grounding §A.3). Port the pools + functions verbatim into this module (extracted from the page). Band cut `>=90 celebrating / >=75 strong / >=60 effort / else tough`.

- [ ] **Step 1: Write failing tests** — `getScoreMessage` returns a `{message,teliMsg,teliState}` for representative pcts/tiers/locales; `applyName` substitutes/drops `{name}` cleanly; `pickVariantStable` is deterministic for a fixed seed. **Leak audit:** iterate EVERY variant in both pools and assert `hasLeak(message) === false && hasLeak(teliMsg) === false` (Option-D — the coaching voice must carry no numbers).
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Port the pools + functions** into `src/lib/quiz/scoreMessage.ts`.
- [ ] **Step 4: Run to verify pass** (incl. the leak audit). `tsc` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(quiz): port post-quiz Teli message pools (leak-guarded, Option-D)"`

---

### Task 6: `forfeitAttempt.ts` (port the synchronous forfeit scorer)

**Files:**
- Create: `src/lib/quiz/forfeitAttempt.ts`
- Test: `src/lib/quiz/__tests__/forfeitAttempt.test.ts`

**Interfaces:**
- Consumes: `createAdminSupabaseClient` shape, `computeMasteryBand` (`src/lib/utils/scoring.ts`), `checkNumericAnswer` (`src/lib/math/checkNumericAnswer`), `scoreMCQ` (`src/lib/utils/scoring.ts`).
- Produces: `forfeitAttempt(args: { admin; attemptId: string; reason: 'closure'|'time_up' }): Promise<{ ok: true; scorePct: number; masteryBand: string } | { ok: false; error: string }>`. MCQ+numeric only (no LLM); open/unanswered count 0; `score_pct = round(correctDeterministic / totalQuestions * 100)`; band via `computeMasteryBand` (NOT V1's inline `>=51`); writes `quiz_attempts {is_complete:true, submitted_at (default last_active_at), score_pct, mastery_band, forfeit_reason}`; backfills `is_correct/grader_source` on deterministic response rows.

**Source to port:** V1 `lib/quiz/forfeitAttempt.ts` (grounding §A.2 Step 4). Reconcile the band cut to `computeMasteryBand`.

- [ ] **Step 1: Write failing tests** — mock the admin client (attempt + quiz_questions + quiz_responses reads, then the update/backfill writes). Cover: all-correct → high band; mixed → correct `score_pct` rounding; open/unanswered count 0; `forfeit_reason` written; `submitted_at` falls back to `last_active_at`; band via `computeMasteryBand` at the 50/79 boundaries; error path returns `{ok:false}`.
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Port + reconcile** the implementation.
- [ ] **Step 4: Run to verify pass.** `tsc` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(quiz): port forfeitAttempt (deterministic, single band source)"`

---

### Task 7: `isQuizAvailableForStudent.ts` (port the availability gate)

**Files:**
- Create: `src/lib/quiz/isQuizAvailableForStudent.ts`
- Test: `src/lib/quiz/__tests__/isQuizAvailableForStudent.test.ts`

**Interfaces:**
- Produces: `isQuizAvailableForStudent(args): boolean` — exact signature/logic ported from V1's helper used in `app/api/attempts/student-quiz/route.ts` (grounding §A.2 Step 1). It gates published + in-class-eligible (enrollment active + `enrolled_at` vs quiz `published_at`) + not-yet-completed.

- [ ] **Step 1: Write failing tests** for the eligibility branches (published vs not; enrolled-before-publish vs after; completed already). Pure inputs (no DB) — pass the rows in.
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Port the implementation.**
- [ ] **Step 4: Run to verify pass.** `tsc` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(quiz): port isQuizAvailableForStudent gate"`

---

## Phase 1 exit criteria

- All of Tasks 1–7 committed; `npx vitest run` green (the new pure-logic + migration tests), `npx tsc --noEmit` clean, `npm run a11y` unaffected (no UI), `npm run build` clean.
- The `computeSignals` per-signal aggregate-coverage mapping (Task 3 Step 0) is documented and confirms no raw event log is needed (or lists the exact extra aggregate captured instead).
- **Then:** plan Phase 2 (the API routes: `student-quiz`, `start`, `[attemptId]/signal`, `study-guide`, `quiz-history` + the `submit` signal-store hook) → Phase 3 (runner UI) → Phase 4 (surface wiring + verify), each via writing-plans → subagent-driven-development with adversarial review before the epic merges.

## Self-review notes

- **Spec coverage (Phase 1 subset):** migration §6 → Task 1; ported logic §7 → Tasks 2,5,6,7; `computeSignals` (the moat) §5/§7 → Task 3; dedicated `behavioral_signals` model §6.6 → Tasks 1+4. Routes/UI/wiring (§8–9) are explicitly Phase 2–4.
- **Type consistency:** `ComputedSignals`/`QuestionAttemptData`/`SessionAggregates` defined in Task 3 `behavioralTypes.ts` and consumed by Task 4; `computeMasteryBand` is the single band source in Tasks 1/6.
- **No placeholders:** each task has the test code (or precise test obligations for the verbatim ports, which cite the exact V1 source + grounding section) and the implementation contract.
