# Phase 4 — Signal Wiring + Coach-Read Surface (Design Spec)

> **Status:** design spec, awaiting plan. Part of the Quiz Runner epic (branch
> `feat/quiz-runner`). Process: this spec → `writing-plans` → pre-flight opus
> review of the plan → subagent-driven-development (per-task review + in-house
> adversarial Workflow "committee" + whole-branch opus review + `/code-review`;
> codex-review attempted, non-blocking) → merge the epic → deploy.
>
> **Grounding:** read-only writer-vs-reader gap map (workflow `w1czhqnu2`,
> 12 agents) + controller cross-checks. Recorded in `.git/sdd/progress.md`
> under "PHASE 4 GROUNDING COMPLETE".

## Goal

Light up the teacher surfaces from the real signals the quiz runner now
produces, and **surface the orphaned EMA behavioral model** — "the coach's
eyes" — as a plain-language, exceptions-first **"Worth a look?"** coach-read on
the teacher per-student drill-in. Plus two pure producer→reader wiring fixes and
one documented decision. No schema changes; no net-new producers.

## Why (the gap, in one paragraph)

After a student finishes one quiz, the drill-in Skill Map, mastery band, and
roster band-counts already light up (quiz_attempts / skill_learning_state /
misconception_observations are **connected** end-to-end). But three things are
wrong: (1) the richest artifact the runner produces — the per-student EMA
behavioral model in `behavioral_signals` (frustration, attention, engagement
style, confidence, error pattern, predictive read) — is **computed every submit
and read by nobody** (referenced in exactly one file: its own writer); (2) the
runner writes `misconception_observations`, and `loadRosterSignals` even
*fetches* them, but feeds `diagnose()` `error_types: []`, so the only quiz-only
path to the "Needs you today" triage is dead; (3) `loadRosterSignals` computes
`concept_gaps` that the Today page never renders. Everything else that looks
empty (growth, divergence, effort, reteach) is starved by writers that belong to
**later epics** (the Assignment Player's `homework_attempts`; the weekly-snapshot
cron's `student_model_snapshots`) — explicitly **out of scope** here.

## Scope

**In:**
1. **EMA coach-read surface** (the centerpiece) — `behavioral_signals` → a
   plain-language "Worth a look?" card on the drill-in.
2. **Wiring fix A** — thread per-student misconception `error_types` into
   `loadRosterSignals.diagnose()`.
3. **Wiring fix B** — render the already-computed `concept_gaps` on the Today page.
4. **session_risk decision** — short ADR; the EMA cross-session read is canonical,
   single-session `computeSessionRisk` stays internal/unrendered (documented).
5. **`leakGuard` banned-words extension** — catch banned *words*, not just numbers
   (closes a standing backlog item exactly where the first word-translation happens).

**Out (deferred — document, do not wire):**
- `homework_attempts`-derived signals (divergence, dominant_effort_pattern,
  reteach history, hw risk arm) → owned by the unbuilt non-SPARK **Assignment
  Player (Epic 2)**. Wiring around the absent writer = net-new feature work.
- `student_model_snapshots` real-time growth/trajectory → fed by the **weekly
  cron** by design; quiz data reaches it transitively next run. Not a wiring gap.
- Student/parent dashboards (10-line stubs) → **Epic 4**.
- Barb's broader copy pass on previously-flagged strings (separate, in `STRINGS-FOR-BARB.md`).
- The 2 pre-existing lint errors (branch debt; route to coach-posture remediation).

---

## Part 1 — the EMA coach-read (centerpiece)

### 1.1 Data source (exists; no migration)

`behavioral_signals` (migration 0013): `student_id`, `school_id`,
`computed` (jsonb = `ComputedSignals`), `observation_count`, `updated_at`.
Written by the submit `after()`-hook via `upsertBehavioralSignals`
(EMA α=0.4; categorical/array fields take latest, numeric fields smoothed).
Staff-only RLS. `ComputedSignals` shape is in
`src/lib/signals/behavioralTypes.ts` (learningVelocity/velocityTrend,
frustrationScore/Indicators, attentionScore/Gaps, errorPatternType/Frequency,
confidenceScore/Accuracy, engagementScore/Style, predictiveRiskScore/riskFactors,
sessionDurationMs).

### 1.2 Server-side translation (Option-D pattern — words, never numbers, over the wire)

Following the Phase-3 server-side score→message pattern, **the raw numeric model
never crosses to the client.** `loadStudentSignals` translates it server-side
into a word-level result.

**New pure helper** — `src/lib/copy/coachObservation.ts`:

```ts
export interface CoachObservation {
  state: 'watch' | 'calm' | 'quiet';
  eyebrow: string;          // SectionLabel text, e.g. "Worth a look"
  line: string;             // the one plain observation
  suggestion: string | null; // soft suggestion — only on 'watch'
  tone: 'risk' | 'warn' | 'ok';
}

export function coachObservation(input: {
  computed: ComputedSignals | null;
  observationCount: number;
  firstName: string | null;
  rosterRisk: { risk_level: 'low' | 'medium' | 'high' | string; risk_factors: string[] };
}): CoachObservation;
```

**Pure, framework-agnostic, leak-safe.** It is the *single* place the EMA model
becomes words and the *single* place the EMA read reconciles with the existing
score-based roster-risk. Fully unit-tested.

**Selection priority (exceptions-first, one-thing-at-a-time):**

1. **Not enough yet** — `computed == null` OR `observationCount < 2` OR
   `errorPatternType === 'insufficient_data'` → **quiet**:
   eyebrow "Getting to know {first}", line "Still getting to know how {first}
   works — a few more quizzes will tell.", suggestion null, tone 'ok'.
2. **A sustained behavioral pattern** (only when `observationCount >= 2`), first
   match wins → **watch** (tone 'risk' for frustration/attention, 'warn' otherwise):
   - frustration: `frustrationScore >= 0.6` → "{first}'s been rushing and
     second-guessing answers the last few quizzes." / "A quick check-in might help."
   - attention/drift: `attentionScore <= 0.4` → "{first} keeps drifting off
     mid-quiz." / "Shorter sessions may land better."
   - disengaged: `engagementStyle === 'passive' && engagementScore <= 0.4` →
     "{first}'s been coasting through quizzes lately." / "Might be worth
     re-engaging them."
   - impulsive/careless: `engagementStyle === 'impulsive' || errorPatternType
     === 'careless'` → "{first}'s racing through and slipping on careless
     mistakes." / "Worth nudging them to slow down."
   - predictive catch-all: `predictiveRiskScore >= 0.6` → "Something's been off
     in how {first}'s been working lately." / "Worth a closer look."
3. **Else, the existing score-based concern** — `rosterRisk.risk_level !== 'low'`
   → **watch** (tone 'risk'), line `riskFactorPhrase(rosterRisk.risk_factors[0])`,
   suggestion null. (Preserves today's behavior; gets richer when Epic 2 lands.)
4. **Else → calm**: eyebrow "Settling in", line "{first}'s working at a steady,
   focused pace — nothing to flag.", suggestion null, tone 'ok'.

Thresholds above are **conservative first proposals** (speak rarely). They are
tunable in the plan; Barb/Marvin may adjust. `observationCount >= 2` is the floor
to speak any behavioral note, so the voice is honestly "the last few quizzes,"
never "rushed once today."

### 1.3 `loadStudentSignals` change

Add one read + one field:

```ts
const { data: bsRow } = await admin
  .from('behavioral_signals')
  .select('computed, observation_count')
  .eq('student_id', studentId)
  .maybeSingle();

// ... after roster_risk is computed:
const coach_read = coachObservation({
  computed: (bsRow?.computed ?? null) as ComputedSignals | null,
  observationCount: bsRow?.observation_count ?? 0,
  firstName,           // derived from loadStudentIdentity or passed in
  rosterRisk: roster_risk,
});
```

`StudentSignals` gains `coach_read: CoachObservation`. **No raw `ComputedSignals`
is added to `StudentSignals`** — only the word-level result crosses the wire.
(`firstName`: simplest is to thread it in from the page, which already has
`fullName`; if that complicates the loader signature, resolve `users.full_name`
inside the loader. Plan decides — keep the loader's public signature minimal.)

### 1.4 Component change — `WholeChildRail`

The **"At risk?"** card becomes **"Worth a look?"**, rendering `signals.coach_read`:

- `state === 'watch'` → `Eyebrow tone={tone}` "{eyebrow}", line `text-fg`,
  and `suggestion` on its own line `text-fg` when present.
- `state === 'quiet'` → calm cold-start line.
- `state === 'calm'` → calm "nothing to flag" line.

Drop the direct `signals.risk.roster` read from the component (the reconciliation
now lives in `coachObservation`). **Keep the `id="at-risk"` anchor** (the priority
CTA scroll target referenced by `priorityCta.ts`) to minimize blast radius — the
plan verifies and, only if trivial, renames to `#worth-a-look` on both sides.
Token-only styling; content `text-fg`; eyebrow via `SectionLabel`.

### 1.5 Copy + leak discipline

- All `coachObservation` strings are **DRAFTS** → appended to
  `STRINGS-FOR-BARB.md` (Barb gates; nothing ships from this build). `{first}` is
  the only interpolation.
- **Extend `leakGuard`** (`src/lib/copy/leakGuard.ts`) with a banned-*words*
  check — the 9 COACH-POSTURE terms: `score, percentile, index, divergence,
  threshold, signal, model, algorithm, flag` (word-boundary, case-insensitive).
  Note "risk" is **not** banned (it appears in `riskFactorPhrase` and historically
  in "At risk?"). Export e.g. `hasBannedWord` / `assertNoBannedWord`.
- Tests drive **real** `ComputedSignals` values through `coachObservation` and
  assert every emitted `eyebrow`/`line`/`suggestion` passes `assertNoLeak`
  (numbers) **and** `assertNoBannedWord` — non-vacuous (a planted banned word must
  fail the test).

---

## Part 2 — wiring fixes

### Fix A — misconception `error_types` → `loadRosterSignals.diagnose()`

Today the per-student loop builds `diagnoseInput` with `error_types: []`
(`loadRosterSignals.ts:156`), and the class-wide misconception fetch happens
*after* the loop (line ~198). Restructure so the misconception query runs **once
up front**, grouped by `student_id` into `Map<string, string[]>` (error types),
feeding **both** the per-student `diagnose()` **and** the existing `concept_gaps`
detection (no double query). Pass each student's `error_types` into
`diagnoseInput`.

**Effect:** a student who logs a recurring same-`error_type` from quizzes — with
zero homework — now yields a non-null `diagnose()`, so they appear in
`focus_group`. The Roster "Needs you today" triage + Today "needs a closer look"
count light up from quiz data alone.

**Test:** roster fixture with a student having ≥2 same-`error_type` misconceptions
and no homework → that student is in `focus_group` (was empty before).

### Fix B — render `concept_gaps` on Today

`loadRosterSignals` already returns `concept_gaps`; Today's `page.tsx` never reads
it. Render `data.concept_gaps` on Today by **reusing the existing
`ConceptGapsRail`** component (Roster already uses it; it carries its own
empty-state). Placement: a compact section below the existing cards. Respect the
detector floor (`MIN_STUDENTS = 5` distinct attempts per skill) — below the floor
the component shows its empty state. Keep minimal; no layout redesign. (Lowest
priority of the five items; if it forces a Today layout rework, the plan flags it
rather than gold-plating.)

**Test:** Today renders concept-gap rows when the loader returns them.

---

## Part 3 — session_risk decision (ADR)

`computeSessionRisk` (single-session, from `quiz_responses` behavioral columns) is
computed in `loadStudentSignals` but rendered nowhere. **Decision:** the EMA
cross-session coach-read (Part 1) is the canonical behavioral read on the
drill-in; single-session `session_risk` stays **computed-but-internal** —
surfacing both would double-state the same concern, and one session is noisier
than the smoothed EMA. Record this as a short ADR
(`docs/superpowers/specs/decisions/2026-06-21-session-risk-internal.md` or a
clearly-marked section) and leave a code comment at the `session_risk` site
pointing to it, so a future audit doesn't re-flag it as a bug. No behavioral code
change.

---

## Testing strategy

- `coachObservation` — pure unit tests: every state, every pattern, priority
  order, cold-start floor, threshold boundaries, roster-risk fallback; leak +
  banned-word audits on every output (non-vacuous).
- `leakGuard` — tests for the new banned-words function (each banned term trips it;
  "risk" does not).
- `loadStudentSignals` — asserts it selects `behavioral_signals` and sets
  `coach_read`; cold-start when the row is absent (mock admin).
- `loadRosterSignals` — asserts `error_types` are threaded → `diagnose()` non-null
  for a recurring-error, no-homework student.
- `WholeChildRail` — jsdom render tests for watch / calm / quiet, plus a DOM leak
  audit (no digits, no banned words reach the DOM).
- Today — renders `concept_gaps`.
- **Gates:** vitest, `tsc --noEmit` (0), a11y 49/49, `build` (0), lint
  (Phase-4 files clean; the 2 pre-existing branch-debt errors excepted).

## Files (anticipated)

- Create: `src/lib/copy/coachObservation.ts` (+ test)
- Modify: `src/lib/copy/leakGuard.ts` (+ banned-words test)
- Modify: `src/lib/signals/loadStudentSignals.ts` (read + `coach_read` field; type export)
- Modify: `src/app/(teacher)/students/[studentId]/_components/WholeChildRail.tsx` (+ test)
- Modify: `src/lib/signals/loadRosterSignals.ts` (error_types threading; + test)
- Modify: `src/app/(teacher)/today/page.tsx` (render concept_gaps; + test)
- Append: `STRINGS-FOR-BARB.md` (coach-read draft strings)
- Create: the session-risk ADR + a one-line comment at the `session_risk` site

## Non-goals / guardrails

No schema changes. No net-new data producers. No student/parent surface work.
No homework-derived wiring. No real-time growth. Coach-posture is the standing
review lens on every string and every layout decision; final user-facing copy is
Barb's to gate.
