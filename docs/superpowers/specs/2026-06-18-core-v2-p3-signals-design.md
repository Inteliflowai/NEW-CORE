# CORE v2 — Plan 3: Signals & Per-Skill Mastery — Design Spec

_Brainstormed 2026-06-18. Consumes the Plan-2 engine outputs. Faithful lift of V1's proven, Barb-tuned logic into the V2 data layer. UI is Plan 4._

## Goal

Build the **signals & per-skill mastery data layer**: the per-skill comprehension-level engine (`computeSkillState`), the full signals math library (divergence, effort, risk ×2, reteach-effectiveness, consistency/trajectory, recurring-error/diagnosis), a first-class **misconception taxonomy**, the **weekly-snapshot** rollup, and the **read-only APIs** that serve all of it to the (Plan-4) screens. Every formula and threshold is lifted verbatim from V1 unless this spec explicitly says otherwise.

## Scope decisions (locked 2026-06-18)

1. **Read APIs: IN.** Plan 3 ships the read endpoints (pure data, no UI) so the layer is end-to-end testable and Plan 4 is pure rendering.
2. **Both risk functions.** Ship the longitudinal **Roster Risk Index** (0–100) AND the **Session Cognitive Risk** ensemble (0–1). The session ensemble computes from `quiz_responses`' existing behavioral-telemetry columns; the client capture that fills them is Plan-4 quiz UI.
3. **Full misconception taxonomy table — Barb approved.** Build a first-class taxonomy (reference vocabulary + per-skill observations), not a deferred matcher. The 8 `error_type` + 6 `reasoning_pattern` values are ratified.

Barb-pending items are now **ratified** (taxonomy vocabulary, CL verb mapping Reinforce/On Track/Enrich, effort thresholds 75/2). Lift V1's values verbatim; no "pending" flags.

## Architecture (units & boundaries)

```
src/lib/skills/
  skillSlug.ts            slugifySkillTag / skillDisplayName / normalizeSubject (pure)
  resolveSkills.ts        resolveSkillIds(admin, {schoolId,subject,tags,createdBy}) → Map<rawTag,skillId> (race-safe)
  computeSkillState.ts    computeSkillState(input): SkillStateResult (pure, 6-state machine, SKILL_STATE_WEIGHTS)
  recomputeSkillStates.ts recomputeSkillStatesForStudent(admin, studentId, classId?) — gathers inputs, calls computeSkillState, upserts skill_learning_state
src/lib/signals/
  computeHwQuizDivergence.ts   (pure)
  computeEffortLabel.ts        (pure)
  computeRosterRiskIndex.ts    longitudinal 0–100 (pure)  [V1 computeRiskIndex.ts]
  computeSessionRisk.ts        session ensemble 0–1 (pure) [V1 signalComputer.ts computeRisk + sub-signal derivation from telemetry]
  computeReteachEffectiveness.ts  (pure)
  consistency.ts               consistency_score/label + trajectory/direction (pure)  [V1 studentModel.ts:259-277 + computeTrend]
  diagnosis.ts                 findRecurringError / diagnose / suggestedAction (pure)  [V1 lib/reports/diagnosis.ts]
  conceptGapDetector.ts        class-wide gap (≥40% of ≥5 students) (pure)
src/lib/misconceptions/
  taxonomy.ts                  the ratified 8+6 vocabulary + display labels + MISCONCEPTION_TYPES seed
  recordMisconceptions.ts      writes misconception_observations at grade time (OEQ only)
src/app/api/
  cron/weekly-snapshot/route.ts   trajectory rollup → student_model_snapshots (replaces 501 stub)
  teacher/signals/...             read APIs (one-student, roster) — pure data
  student/growth/route.ts         student-facing growth read (from snapshots only — RLS)
supabase/migrations/
  0011_signals.sql            effort_label + redo flags on homework_attempts; misconception tables; consistency_score on snapshots; aggregation index; grading_status CHECK
```

**Two-instrument invariant (hard):** `computeMasteryBand` (quiz-score band, per attempt, scoring.ts) and `computeSkillState` (per-skill verdict) are **separate instruments**. Plan 3 NEVER derives per-skill CL from `computeMasteryBand`, and NEVER overwrites `quiz_attempts.mastery_band` (Plan 2 owns it). They answer different questions and need not agree.

## Prerequisite (Plan-2 gap — Plan 3 closes it first)

Plan 2's quiz-gen route writes `quiz_questions.concept_tag` but **not** `quiz_questions.skill_id`. Without `skill_id`, `computeSkillState` has no input. **Task 1 of Plan 3** wires `resolveSkillIds` into `src/app/api/teacher/quizzes/generate/route.ts` (slug-match → auto-create `skills` row with `status='unreviewed'`, fail-soft so a registry hiccup never fails quiz generation), populating `skill_id` on each question. Assignments' `skill_ids[]` are derived from the lesson's quiz questions at assignment time.

## Components

### 1. Skill resolution (`src/lib/skills/skillSlug.ts`, `resolveSkills.ts`)
Lift V1 verbatim:
- `slugifySkillTag(raw)`: `NFD` → strip combining accents `/[̀-ͯ]/g` → lowercase → strip apostrophes → `/[^a-z0-9]+/g → '_'` → trim `_` → `slice(0,80)`. `skillDisplayName(raw)`: trim, collapse whitespace, `slice(0,120)`. `normalizeSubject`: trim, null if empty.
- `resolveSkillIds`: slug-match against `skills` (unique `(school_id, COALESCE(subject,''), slug)`), else insert `status='unreviewed'`, `created_by` default `'ai'`; on `23505` re-select. Tags that slugify to empty are dropped.

### 2. `computeSkillState` (`src/lib/skills/computeSkillState.ts`) — pure, 6-state
- **States:** `needs_different_instruction | needs_more_time | on_track | ready_to_extend | insufficient_data | not_attempted` (matches `skill_learning_state` CHECK exactly).
- **Input** `SkillStateInput = { quiz: SkillQuizObservation[]; homework: {gradePct,submitted,effortLabel}[]; sessionErrorPatterns: string[]; reteach?: {type:'more_practice'|'different_approach', completedAt}|null; spark?: {transferScore,contentQuality,completed}[] }`. `spark` optional — cold-start with `spark=[]` must work and never fabricate a transfer read.
- **`SKILL_STATE_WEIGHTS` (lift verbatim; verify against `$V1/lib/skills/computeSkillState.ts` before commit):** `MIN_OBSERVATIONS=3, ON_TRACK_COLD_ACCURACY=0.8, EXTEND_COLD_ACCURACY=0.95, EXTEND_MIN_COLD_OBSERVATIONS=4, COLD_FLOOR=0.5, IMPROVING_DELTA=0.15, CONCEPTUAL_DOMINANCE=0.5, SLIP_DOMINANCE=0.5, DIVERGENCE_GAP_PTS=25, STRUGGLING_SHARE=0.4, NON_SUBMISSION_SHARE=0.5, NDI_MIN_OBSERVATIONS=4, SPARK_STRONG_TRANSFER=70, SPARK_WEAK_TRANSFER=50, SPARK_TREND_DELTA=15, CONFIDENCE_PER_OBSERVATION=8 (cap 40), CONFIDENCE_PER_DRIVER=15, CONFIDENCE_RETEACH_BONUS=15, CONFIDENCE_CAP=95, CONFIDENCE_SPARK_DISCOUNT=10, CONFIDENCE_FLOOR=10`.
- **Decision order (first-match-wins):** `not_attempted` → `insufficient_data` (obs<3) → engagement guard (`nonSubmissionShare≥0.5 AND quiz<3`) → `ready_to_extend` (coldAcc≥0.95, quiz≥4) → `on_track` (coldAcc≥0.8) → NDI tests → `needs_more_time` → ambiguous fallback (`needs_more_time` @ conf 25). NDI test 1: `conceptualShare≥0.5 AND coldAcc<0.8 AND (trendDelta==null OR <0.15)`. NDI test 2: `divergencePts≥25 AND coldAcc<0.5 AND (strugglingShare==null OR ≥0.4)`.
- **Confidence:** `min(min(obs*8,40) + driverCount*15 + (reteachConfirmed?15:0), 95)`; spark discount/floor as above.
- **`evidence` jsonb shape (this spec defines it):** `{ drivers: string[], metrics: { cold_accuracy, hw_avg, divergence_pts, trend_delta, conceptual_share, struggling_share, non_submission_share, observation_count, spark_transfer? } }`. A Zod schema (`SkillStateEvidenceSchema`) validates it.
- **`last_reteach_outcome`** via `reteachOutcomeFor` (cold-accuracy before vs after `reteach.completedAt`): `{type}_improved | {type}_no_improvement | {type}_pending_cold_check`. Stored as free text (no DB CHECK, matches V1).
- **`recomputeSkillStates.ts`** orchestrator: event-driven — invoked from the submit route (after grading) and the (future) homework-grade route and reteach completion. Gathers per-skill observations across the student's skill-tagged attempts, calls `computeSkillState` per skill, upserts `skill_learning_state` (service-role; `ON CONFLICT (student_id,skill_id) DO UPDATE`). Import-safe.

### 3. Signals library (`src/lib/signals/`) — all pure, import-safe lifts
- **`computeHwQuizDivergence`** — `ALIGNMENT_THRESHOLD=10`; `gap=hw_avg−quiz_avg`; `divergence_score=round(min(100,|gap|/50*100))`; direction aligned/hw_higher/quiz_higher; trend stable/widening/narrowing (needs ≥3 each); `MIN_HW_SAMPLES=2, MIN_QUIZ_SAMPLES=1`. **Surfacing floor 20** (SCOPE-locked) and **escalation floor `DIVERGENCE_THRESHOLD=25`** (diagnosis) both preserved as distinct tiers (documented divergence, not collapsed).
- **`computeEffortLabel`** — 2×2: `isSuccess=score≥SUCCESS_THRESHOLD(75)`, `isEffortful=hints≥EFFORT_THRESHOLD(2)` → `effortful_success | struggling_trying | independent_success | independent_struggle`. Returns `null` when score unavailable (never fabricated).
- **`computeRosterRiskIndex`** (0–100, longitudinal, Pro) — weights `avgHwScore 25 / avgQuizScore 25 / completionRate 20 / scoreTrend 15 / redoRate 10 / recency 5`; bands `<25 low / 25–49 medium / 50–74 high / ≥75 critical`; `scalePenalty` + linear-regression trend exactly per `$V1/lib/signals/computeRiskIndex.ts`. → `student_model_snapshots.risk_score`.
- **`computeSessionRisk`** (0–1, session ensemble) — ensemble weights lifted verbatim from `$V1/lib/signals/signalComputer.ts:312` (`frustration .30 + (1−attention) .20 + velocityRisk .20 + (errorRisk×errorFrequency) .15 + (1−confidence.accuracy) .10 + (1−engagement) .05`; velocity decel .8/stable .3/accel .05; error conceptual .9/procedural .6/careless .4/other .2; clamp [0,1]). **V2 input adaptation (the one non-verbatim part):** the sub-scores (frustration, attention, velocity, confidence, engagement) derive from `quiz_responses`' per-response telemetry (`response_time_ms`, `hesitation_ms`, `answer_changes`, `navigation_backs`, `pause_count`, `total_pause_ms`, `word_count`) aggregated per attempt, NOT a raw real-time `StudentEvent` stream (which doesn't exist in V2). The **ensemble weights stay verbatim**; only the sub-score derivation is the adaptation. Both this and frustration/attention are flagged pilot-recalibration targets (spec §4.10). Where the quiz UI hasn't captured telemetry yet, the sub-scores degrade to neutral defaults (no fabricated risk). A richer real-time event stream is a documented later enhancement.
- **`computeReteachEffectiveness`** — `detectCompletedReteachCycles` (allow_redo+scored original paired to any later graded attempt; `improvement=post−pre`; dedup by `originalId:redoId`) + term rollup; feeds reteach UI + `last_reteach_outcome`.
- **`consistency.ts`** — `consistency_score` from std-dev of last 5 quiz `score_pct` (`≤5→95+ / ≤15→70+ / ≤25→40+ / else<40`; labels consistent≥70 / variable≥40 / erratic<40); trajectory `computeTrend` (≥4 history points, last-3 vs prior-3, 10% delta); `bandIsVolatile` already in `scoring.ts` (reuse). Cold-start: consistency needs ≥3 quizzes; trajectory `'stable'` until ≥4 weekly snapshots.
- **`diagnosis.ts`** — `findRecurringError` (re-keyed to skill, see §4), `diagnose` (first-match pattern table; `DIVERGENCE_THRESHOLD=25, LOW_HW=50, OK_QUIZ=60, LOW_QUIZ=50`; `suggestedAction` practice/reteach/verbal_check/profile; returns null when fine → suppress).
- **`conceptGapDetector.ts`** — class-wide: `THRESHOLD_PCT=40, MIN_STUDENTS=5`.
- **`learning_pattern_flags`** (6 derived flags) + `dominant_effort_pattern` rollup lifted verbatim (exact flag strings preserved — they key LLM prompt behavior downstream).

### 4. Misconception taxonomy (`src/lib/misconceptions/`, migration 0011)
First-class, Barb-ratified:
- **`misconception_types`** (reference): `(code text PK, kind text CHECK('error_type'|'reasoning_pattern'), display_label text, sort_order int, active boolean)`. Seeded with the 8 `error_type` + 6 `reasoning_pattern` codes + human display labels (e.g. `reasoning_gap → "Incomplete reasoning"`). Extensible.
- **`misconception_observations`** (per occurrence): `(id, student_id FK, skill_id FK, quiz_response_id FK, error_type text, reasoning_pattern text, observed_at timestamptz, school_id FK)`. Written by `recordMisconceptions.ts` at submit time from each graded **OEQ** response (one row per OEQ with a non-`none` error_type). Indexed `(student_id, skill_id, error_type)`.
- **MCQ exclusion (decision):** synthetic MCQ/numeric `error_type='factual_error'` is **excluded** from observations (filter `question_type_scored='open'`) so it doesn't dilute the OEQ misconception signal.
- **`findRecurringError` re-keyed to skill:** queries `misconception_observations` grouped by `skill_id` for the student; most-frequent `error_type` with count `≥ RECURRING_ERROR_THRESHOLD (3)` → drives `check_concepts` suggested action, now naming the skill (e.g. "Recurring reasoning_gap on Fractions"). No `grading_output` jsonb scan needed (the observations table is the index).
- `ParsedLesson.misconception_risks` (anticipated, from lesson parse) stays a **separate** signal — not wired into observed taxonomy (explicit non-goal).

### 5. Weekly-snapshot cron (`src/app/api/cron/weekly-snapshot/route.ts`)
Replaces the 501 stub. Verifies `CRON_SECRET`. Per active student, **ordered**: (1) `recomputeSkillStatesForStudent` (fresh skill states), (2) aggregate `strength_topics`/`struggle_topics` from skill states (`ready_to_extend|on_track`→strength; `needs_*`→struggle, names from `skills.name`), (3) compute all trajectory columns via the signals lib, (4) **upsert** `student_model_snapshots` on `(student_id, snapshot_date)` with `snapshot_schema_version='v2'`. `snapshot_date` = the **ISO-week Monday in UTC** (canonical; passed explicitly, not `CURRENT_DATE`). `improvement_4w` = compare to the row at `snapshot_date − 28d`; **null** if absent (never 0). The redundant `/cron/snapshot` stub is removed (one logical job). Parent-narrative LLM prose + Resend delivery stay **Plan 4** (this cron only produces the snapshot data the narrative reads).

### 6. Read APIs (pure data, no UI)
- `GET /api/teacher/student/[studentId]/signals` — one-student bundle: current band (`currentMasteryBand`), per-skill CL (state→`CL_VERB_BY_STATE` verb; null→"Not yet assessed"; confidence as soft words only), recurring misconceptions per skill, divergence, effort pattern, both risk reads, reteach outcomes, trajectory. Object-level guard (`guardStudentAccess`); RLS not the backstop.
- `GET /api/teacher/class/[classId]/roster-signals` — roster: per-student current band + volatility marker + risk + a `diagnose`-driven focus group + class-wide concept gaps. `guardClassAccess`.
- `GET /api/student/growth` — student-facing growth, read **only** from `student_model_snapshots` (students CANNOT read `skill_learning_state` per RLS). Returns trajectory/"getting better at X" framed from snapshots; cold-start → "just getting started".
All read endpoints are thin aggregators over the lib + tables; no signal math inline.

### 7. Migration `0011_signals.sql`
- `homework_attempts`: `effort_label text CHECK (...4 values...)`, `allow_redo boolean DEFAULT false`, `is_redo boolean DEFAULT false`, `flagged_by text` (for reteach-cycle detection). (`teli_hint_count` already exists.)
- `misconception_types` + `misconception_observations` tables (+ index + RLS: service-role write; teacher/admin read by school; students/parents no read).
- `student_model_snapshots`: add `consistency_score numeric` (label exists, score doesn't).
- `quiz_attempts`: add `grading_status` CHECK `('pending','complete')` (integrity; was unconstrained).
- Idempotent (`ADD COLUMN IF NOT EXISTS`, DO-block CHECK swaps). Applied live after writing (MCP), like 0010.

## Data flow
```
Quiz submit (Plan 2) → grade OEQ/MCQ/numeric → [Plan 3] recordMisconceptions(OEQ) +
  recomputeSkillStatesForStudent(student) → skill_learning_state upsert
Homework grade (later) → recompute (same)
Weekly cron (Mon 06:00 UTC) → per student: recompute skill states → roll up → snapshot upsert
Read APIs ← skill_learning_state + misconception_observations + snapshots + live signal lib
```

## Error handling
- Signal/skill libs are **pure** — no throws on bad input; missing observations → `insufficient_data`/`null`, never fabricated verdicts.
- Skill resolution is **fail-soft** (a registry hiccup must never fail quiz generation).
- `recomputeSkillStates` failures are logged and isolated per student (one student's failure never aborts the weekly cron); the cron returns a per-student success/fail summary.
- Read APIs return typed empty/cold-start states, never 500 on missing signals.

## Testing
- Unit (pure fns): each signal + `computeSkillState` against V1-parity fixtures — exact threshold boundaries (e.g. coldAcc 0.8/0.95, gap 10/20/25, effort 75/2, risk band cutoffs, std-dev 5/15/25). Include cold-start (obs<3 → insufficient_data), engagement-guard, NDI test 1/2, and `*_pending_cold_check`.
- `skillSlug` parity (accents, apostrophes, 80-cap, collisions).
- `recomputeSkillStates` + `recordMisconceptions` with mocked admin client (MCQ-exclusion asserted).
- Weekly-snapshot cron: ordering (skill states before rollup), idempotent upsert, `improvement_4w` null-on-cold, `snapshot_schema_version='v2'`, CRON_SECRET gate.
- Read APIs: auth + object-level guard rejections; student-growth reads snapshots not skill_learning_state.
- Full suite green; `tsc --noEmit` clean; `npm run build` green. Two risk fns named distinctly (no ambiguity regression).

## Out of scope (later plans)
- **Plan 4:** all screens (Teacher Today/One Student, Student Home), the `CLBadge` component, the LLM "why" copy (`regenerateSignalWhy`), parent-narrative prose + Resend email, the in-quiz client telemetry capture that populates the behavioral columns.
- **Plan 6:** the `spark-attempt-complete` webhook (feeds `spark[]` into `computeSkillState`); `computeSkillState` already handles `spark=[]`.
- Per-task (vs assignment-level) SPARK skill attribution.

## Open items flagged for review
- **Session-risk input adaptation** (§3 computeSessionRisk): sub-scores derived from aggregate per-response telemetry, not a raw event stream — ensemble weights verbatim, derivation adapted. Acceptable since these are pilot-recalibration targets, but it is the one place Plan 3 is not a byte-verbatim V1 lift. Confirm.
- **Recurring-error threshold at skill grain:** `RECURRING_ERROR_THRESHOLD=3` was tuned for a flat per-student count; per-skill, 3 may accrue slowly. Kept at 3 (Barb-ratified vocabulary; threshold tuning is a pilot-recalibration lever, not a redesign).
- **`CL_VERB_BY_STATE`** currently lives in `src/lib/auth/roles.ts`; Plan 3 moves it to `src/lib/skills/clVerbs.ts` (cleaner home) and updates importers.
