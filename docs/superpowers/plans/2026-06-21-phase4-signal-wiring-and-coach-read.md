# Phase 4 — Signal Wiring + Coach-Read Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the orphaned EMA behavioral model as a plain-language, exceptions-first "Worth a look?" coach-read on the teacher drill-in, wire two producer→reader signal gaps the quiz runner already feeds, and document the session-risk decision.

**Architecture:** A new pure copy helper (`coachObservation`) turns the per-student EMA model (`behavioral_signals.computed`) into exactly one plain observation; `loadStudentSignals` computes it **server-side** (raw numbers never cross the wire) and `WholeChildRail` renders it in the existing "At risk?" card slot. Two small loader/page wires (`loadRosterSignals` diagnosis input; Today `concept_gaps` render) light up signals already produced. `leakGuard` gains a banned-*words* check. No schema changes, no net-new producers.

**Tech Stack:** Next.js 16 App Router (React 19 Server Components), TypeScript, Tailwind v4 (token-only), Vitest (+ jsdom for components), Supabase admin client.

**Spec:** `docs/superpowers/specs/2026-06-21-phase4-signal-wiring-and-coach-read.md`. **Grounding:** `.git/sdd/progress.md` → "PHASE 4 GROUNDING COMPLETE".

## Global Constraints

Every task's requirements implicitly include these:

- **Four-audience + Option-D:** this surface is **teacher-only** (staff-RLS). Raw numbers from the EMA model must **never cross to the client** — `loadStudentSignals` translates the model to words server-side; only the word-level `CoachObservation` is added to `StudentSignals`. No digit, `%`, or raw score reaches any client payload or the DOM.
- **COACH-POSTURE language standard:** all user-facing copy is plain human language. **Banned words in front of users:** `score, percentile, index, divergence, threshold, signal, model, algorithm, flag` (note: "risk" is **not** banned). Every emitted phrase passes both `assertNoLeak` (numbers) and the new `assertNoBannedWord`.
- **Copy is Barb's to gate:** every new user-facing string is a **DRAFT** appended to `STRINGS-FOR-BARB.md`. Nothing here ships final copy.
- **Token-only styling, WCAG-AA:** no hardcoded hex, no arbitrary `[var(--..)]`; Tier-2 token classes only; content text `text-fg`. The a11y gate (`npm run a11y`, 49/49) must stay green.
- **Loaders assume a guarded caller:** `loadStudentSignals`/`loadRosterSignals` perform no auth; the caller already ran the IDOR guard. Do not add auth inside them.
- **Gates (every task ends green):** the task's tests pass; `npx tsc --noEmit` is clean; the full suite stays green. Final task runs a11y + build + lint.

## File Structure

- **Create** `src/lib/copy/coachObservation.ts` — pure: EMA `ComputedSignals` + roster-risk → one `CoachObservation`. (Task 2)
- **Create** `src/lib/copy/__tests__/coachObservation.test.ts`. (Task 2)
- **Modify** `src/lib/copy/leakGuard.ts` — add `BANNED_WORDS`, `hasBannedWord`, `assertNoBannedWord`. (Task 1)
- **Modify** `src/lib/copy/__tests__/leakGuard.test.ts` — banned-word cases. (Task 1)
- **Modify** `src/lib/signals/loadStudentSignals.ts` — read `behavioral_signals` + `users.full_name`; add `coach_read: CoachObservation` to `StudentSignals`. (Task 3)
- **Modify** `src/lib/signals/__tests__/loadStudentSignals.test.ts` — `maybeSingle` in mock chain + coach_read cases. (Task 3)
- **Modify** `src/app/(teacher)/students/[studentId]/_components/WholeChildRail.tsx` — render `signals.coach_read` in the `#at-risk` card. (Task 4)
- **Create** `src/app/(teacher)/students/[studentId]/_components/__tests__/WholeChildRail.test.tsx`. (Task 4)
- **Modify** `src/app/(teacher)/students/[studentId]/__tests__/page.test.tsx` — add `coach_read` to `baseSignals()` (Task 3); update the "Nothing flagged" assertion (Task 4). **These existing fixtures build full `StudentSignals` literals — they MUST gain `coach_read` or tsc/runtime go red.**
- **Modify** `src/app/(teacher)/students/[studentId]/__tests__/student.leak.test.tsx` — add `coach_read` to `LEAK_FIXTURE` (Task 3); update the "high" risk-band assertion (Task 4).
- **Modify** `src/lib/signals/loadRosterSignals.ts` — thread per-student `error_types` into `diagnose()`. (Task 5)
- **Modify** `src/lib/signals/__tests__/loadRosterSignals.test.ts` — assert error_types threaded. (Task 5)
- **Modify** `src/app/(teacher)/today/page.tsx` — render `data.concept_gaps`. (Task 6)
- **Modify** `src/app/(teacher)/today/__tests__/today.test.tsx` — concept-gaps render case. (Task 6)
- **Create** `docs/superpowers/specs/decisions/2026-06-21-session-risk-internal.md` + comment in `loadStudentSignals.ts`. (Task 7)
- **Append** `STRINGS-FOR-BARB.md` — coach-read drafts. (Task 2)

---

### Task 1: Extend `leakGuard` with a banned-words check

**Files:**
- Modify: `src/lib/copy/leakGuard.ts`
- Test: `src/lib/copy/__tests__/leakGuard.test.ts`

**Interfaces:**
- Produces: `BANNED_WORDS: readonly string[]`, `hasBannedWord(text: string): boolean`, `assertNoBannedWord(text: string, ctx?: string): void`. (Task 2 consumes these.)

- [ ] **Step 1: Write the failing test** — append to `src/lib/copy/__tests__/leakGuard.test.ts`:

```ts
import { hasBannedWord, assertNoBannedWord } from '../leakGuard';

describe('leakGuard — banned words (COACH-POSTURE)', () => {
  it('flags each banned word, case-insensitive, on word boundaries', () => {
    [
      'their score went up',
      'in the 90th percentile',
      'an engagement index',
      'high divergence here',
      'crossed the threshold',
      'a strong signal',
      'the model thinks',
      'the algorithm picked',
      'we flag this',
    ].forEach((t) => expect(hasBannedWord(t)).toBe(true));
  });

  it('does NOT flag "risk" (allowed) or substrings inside other words', () => {
    ['worth a look', 'at risk of falling behind', 'flagship lesson', 'indexed earlier'].forEach(
      (t) => expect(hasBannedWord(t)).toBe(false),
    );
  });

  it('assertNoBannedWord throws on a banned word, silent on clean text', () => {
    expect(() => assertNoBannedWord('a clear signal')).toThrow();
    expect(() => assertNoBannedWord('been rushing lately')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/lib/copy/__tests__/leakGuard.test.ts`
Expected: FAIL — `hasBannedWord` is not exported.

- [ ] **Step 3: Implement** — append to `src/lib/copy/leakGuard.ts`:

```ts
/**
 * COACH-POSTURE banned words — metric/engineering jargon never shown to users.
 * "risk" is intentionally NOT here (it appears in established teacher copy).
 */
export const BANNED_WORDS: readonly string[] = [
  'score', 'percentile', 'index', 'divergence', 'threshold',
  'signal', 'model', 'algorithm', 'flag',
];

const BANNED_WORD_RE = new RegExp(`\\b(?:${BANNED_WORDS.join('|')})\\b`, 'i');

/** True if the text contains a COACH-POSTURE banned word (whole-word, case-insensitive). */
export function hasBannedWord(text: string): boolean {
  return BANNED_WORD_RE.test(text);
}

/** Throws if the text contains a banned word. Optional `ctx` for clearer errors. */
export function assertNoBannedWord(text: string, ctx?: string): void {
  if (hasBannedWord(text)) {
    const prefix = ctx ? `[${ctx}] ` : '';
    throw new Error(`${prefix}Banned coach-posture word detected in: "${text}"`);
  }
}
```

Note: `\b` boundaries mean "flagship" and "indexed" do **not** match (no boundary after the banned stem) — verified by the test.

- [ ] **Step 4: Run tests to confirm pass**

Run: `npx vitest run src/lib/copy/__tests__/leakGuard.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/copy/leakGuard.ts src/lib/copy/__tests__/leakGuard.test.ts
git commit -m "feat(copy): leakGuard banned-words check (COACH-POSTURE register)"
```

---

### Task 2: `coachObservation` helper + Barb drafts

**Files:**
- Create: `src/lib/copy/coachObservation.ts`
- Test: `src/lib/copy/__tests__/coachObservation.test.ts`
- Append: `STRINGS-FOR-BARB.md`

**Interfaces:**
- Consumes: `hasBannedWord`/`assertNoBannedWord` (Task 1); `ComputedSignals` from `@/lib/signals/behavioralTypes`.
- Produces: `CoachObservation` (interface) and `coachObservation(input)` (function). Task 3 imports both; Task 4 renders `CoachObservation`.

```ts
export interface CoachObservation {
  state: 'watch' | 'calm' | 'quiet';
  eyebrow: string;
  line: string;
  suggestion: string | null;   // present only on 'watch'
  tone: 'risk' | 'warn' | 'ok';
}
export function coachObservation(input: {
  computed: import('@/lib/signals/behavioralTypes').ComputedSignals | null;
  observationCount: number;
  firstName: string | null;
  rosterRisk: { risk_level: string; risk_factors: string[] };
}): CoachObservation;
```

- [ ] **Step 1: Write the failing test** — `src/lib/copy/__tests__/coachObservation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { coachObservation } from '../coachObservation';
import { assertNoLeak, assertNoBannedWord } from '../leakGuard';
import type { ComputedSignals } from '@/lib/signals/behavioralTypes';

// A neutral, clean baseline model — all thresholds in the calm zone.
function baseModel(over: Partial<ComputedSignals> = {}): ComputedSignals {
  return {
    learningVelocity: 1, velocityTrend: 'stable',
    frustrationScore: 0.1, frustrationIndicators: [],
    attentionScore: 0.9, attentionGaps: 0,
    errorPatternType: 'procedural', errorFrequency: 0.2,
    confidenceScore: 0.6, confidenceAccuracy: 0.6,
    engagementScore: 0.8, engagementStyle: 'methodical',
    predictiveRiskScore: 0.1, riskFactors: [],
    sessionDurationMs: 600000,
    ...over,
  };
}
const lowRisk = { risk_level: 'low', risk_factors: [] as string[] };

describe('coachObservation', () => {
  it('quiet cold-start: no model', () => {
    const o = coachObservation({ computed: null, observationCount: 0, firstName: 'Maya', rosterRisk: lowRisk });
    expect(o.state).toBe('quiet');
  });

  it('quiet cold-start: fewer than 2 observations even with a hot model', () => {
    const o = coachObservation({ computed: baseModel({ frustrationScore: 0.9 }), observationCount: 1, firstName: 'Maya', rosterRisk: lowRisk });
    expect(o.state).toBe('quiet');
  });

  it('quiet cold-start: insufficient_data error pattern', () => {
    const o = coachObservation({ computed: baseModel({ errorPatternType: 'insufficient_data' }), observationCount: 5, firstName: 'Maya', rosterRisk: lowRisk });
    expect(o.state).toBe('quiet');
  });

  it('watch: high frustration wins first', () => {
    const o = coachObservation({ computed: baseModel({ frustrationScore: 0.7, attentionScore: 0.2 }), observationCount: 3, firstName: 'Maya', rosterRisk: lowRisk });
    expect(o.state).toBe('watch');
    expect(o.line).toContain('Maya');
    expect(o.suggestion).toBeTruthy();
  });

  it('watch: low attention when frustration is calm', () => {
    const o = coachObservation({ computed: baseModel({ attentionScore: 0.3 }), observationCount: 3, firstName: 'Maya', rosterRisk: lowRisk });
    expect(o.state).toBe('watch');
  });

  it('falls back to score-based concern when the model is calm but roster risk is not low', () => {
    const o = coachObservation({ computed: baseModel(), observationCount: 3, firstName: 'Maya', rosterRisk: { risk_level: 'high', risk_factors: ['x'] } });
    expect(o.state).toBe('watch');
  });

  it('calm when model and roster risk are both clean', () => {
    const o = coachObservation({ computed: baseModel(), observationCount: 3, firstName: 'Maya', rosterRisk: lowRisk });
    expect(o.state).toBe('calm');
    expect(o.suggestion).toBeNull();
  });

  it('handles a null firstName without breaking grammar', () => {
    const o = coachObservation({ computed: baseModel({ frustrationScore: 0.8 }), observationCount: 3, firstName: null, rosterRisk: lowRisk });
    expect(o.line.length).toBeGreaterThan(0);
  });

  it('EVERY output passes assertNoLeak AND assertNoBannedWord (non-vacuous)', () => {
    const models: ComputedSignals[] = [
      baseModel({ frustrationScore: 0.8 }),
      baseModel({ attentionScore: 0.2 }),
      baseModel({ engagementStyle: 'passive', engagementScore: 0.2 }),
      baseModel({ engagementStyle: 'impulsive' }),
      baseModel({ errorPatternType: 'careless' }),
      baseModel({ predictiveRiskScore: 0.8 }),
      baseModel(),
      baseModel({ errorPatternType: 'insufficient_data' }),
    ];
    for (const m of models) {
      for (const oc of [0, 1, 3]) {
        for (const fn of ['Maya', null]) {
          for (const rl of ['low', 'high']) {
            const o = coachObservation({ computed: m, observationCount: oc, firstName: fn, rosterRisk: { risk_level: rl, risk_factors: ['a'] } });
            [o.eyebrow, o.line, o.suggestion ?? ''].forEach((s) => {
              expect(() => assertNoLeak(s)).not.toThrow();
              expect(() => assertNoBannedWord(s)).not.toThrow();
            });
          }
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/lib/copy/__tests__/coachObservation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/lib/copy/coachObservation.ts`:

```ts
// src/lib/copy/coachObservation.ts
// TEACHER-ONLY. Turns the per-student EMA behavioral model (smoothed across the
// student's quiz sessions) into ONE plain-language observation, exceptions-first.
//
// The coach speaks ONLY when a real coach would (rushing, drifting, coasting,
// careless), and only once it has seen the student across >= 2 sessions, so the
// voice is honestly "the last few quizzes" — never one bad day. Otherwise it is
// calm/quiet. Numbers and COACH-POSTURE banned words never appear in the output.
//
// Pure: no React, no Next.js, no Supabase, no browser globals. All strings are
// DRAFTS (see STRINGS-FOR-BARB.md) — Barb gates final copy.

import type { ComputedSignals } from '@/lib/signals/behavioralTypes';

export interface CoachObservation {
  state: 'watch' | 'calm' | 'quiet';
  eyebrow: string;
  line: string;
  suggestion: string | null;
  tone: 'risk' | 'warn' | 'ok';
}

export interface CoachObservationInput {
  computed: ComputedSignals | null;
  observationCount: number;
  firstName: string | null;
  rosterRisk: { risk_level: string; risk_factors: string[] };
}

// Conservative first-pass thresholds — speak rarely. Tunable; Barb/Marvin may adjust.
const MIN_OBSERVATIONS = 2;   // floor before any behavioral "watch" — a pattern, not one quiz
const FRUSTRATION_HOT = 0.6;
const ATTENTION_LOW = 0.4;
const ENGAGEMENT_LOW = 0.4;
const PREDICTIVE_HOT = 0.6;

export function coachObservation(input: CoachObservationInput): CoachObservation {
  const { computed, observationCount, firstName, rosterRisk } = input;
  const subject = (firstName ?? '').trim() || 'This student';

  // 1. Not enough yet → quiet (cold-start).
  if (
    computed == null ||
    observationCount < MIN_OBSERVATIONS ||
    computed.errorPatternType === 'insufficient_data'
  ) {
    return {
      state: 'quiet',
      eyebrow: 'Still settling in',
      line: `Still getting to know how ${subject} works — a few more quizzes will tell.`,
      suggestion: null,
      tone: 'ok',
    };
  }

  // 2. A sustained behavioral pattern worth mentioning (first match wins).
  const c = computed;
  if (c.frustrationScore >= FRUSTRATION_HOT) {
    return watch('risk', `${subject}'s been rushing and second-guessing answers the last few quizzes.`, 'A quick check-in might help.');
  }
  if (c.attentionScore <= ATTENTION_LOW) {
    return watch('risk', `${subject} keeps drifting off mid-quiz.`, 'Shorter sessions may land better.');
  }
  if (c.engagementStyle === 'passive' && c.engagementScore <= ENGAGEMENT_LOW) {
    return watch('warn', `${subject}'s been coasting through quizzes lately.`, 'Might be worth re-engaging them.');
  }
  if (c.engagementStyle === 'impulsive' || c.errorPatternType === 'careless') {
    return watch('warn', `${subject}'s racing through and slipping on careless mistakes.`, 'Worth nudging them to slow down.');
  }
  if (c.predictiveRiskScore >= PREDICTIVE_HOT) {
    return watch('warn', `Something's been off in how ${subject}'s been working lately.`, 'Worth a closer look.');
  }

  // 3. Else, the existing score-based concern (plain words — never reuse riskFactorPhrase, which says "score").
  if (rosterRisk.risk_level !== 'low') {
    return watch('risk', `${subject}'s recent quizzes have dipped.`, 'Worth a closer look at what changed.');
  }

  // 4. Else → calm.
  return {
    state: 'calm',
    eyebrow: 'Settling in',
    line: `${subject}'s working at a steady, focused pace right now.`,
    suggestion: null,
    tone: 'ok',
  };
}

function watch(tone: 'risk' | 'warn', line: string, suggestion: string): CoachObservation {
  return { state: 'watch', eyebrow: 'Worth a look', line, suggestion, tone };
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `npx vitest run src/lib/copy/__tests__/coachObservation.test.ts`
Expected: PASS.

- [ ] **Step 5: Append the drafts to `STRINGS-FOR-BARB.md`** — add this section at the end:

```markdown
## Coach-Read ("Worth a look?") — drafts (Barb sign-off required)

Teacher-only, drill-in. The EMA behavioral model → ONE plain observation. `{name}`
= student first name (falls back to "This student"). Passes assertNoLeak + assertNoBannedWord.

| State / trigger | Eyebrow | Line | Suggestion |
|---|---|---|---|
| Quiet (cold-start) | Still settling in | "Still getting to know how {name} works — a few more quizzes will tell." | — |
| Watch · rushing/frustrated | Worth a look | "{name}'s been rushing and second-guessing answers the last few quizzes." | "A quick check-in might help." |
| Watch · drifting | Worth a look | "{name} keeps drifting off mid-quiz." | "Shorter sessions may land better." |
| Watch · coasting | Worth a look | "{name}'s been coasting through quizzes lately." | "Might be worth re-engaging them." |
| Watch · careless/impulsive | Worth a look | "{name}'s racing through and slipping on careless mistakes." | "Worth nudging them to slow down." |
| Watch · general concern | Worth a look | "Something's been off in how {name}'s been working lately." | "Worth a closer look." |
| Watch · scores dipped | Worth a look | "{name}'s recent quizzes have dipped." | "Worth a closer look at what changed." |
| Calm | Settling in | "{name}'s working at a steady, focused pace right now." | — |
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/copy/coachObservation.ts src/lib/copy/__tests__/coachObservation.test.ts STRINGS-FOR-BARB.md
git commit -m "feat(copy): coachObservation — EMA behavioral model to one plain observation"
```

---

### Task 3: Wire `loadStudentSignals` to compute `coach_read`

**Files:**
- Modify: `src/lib/signals/loadStudentSignals.ts`
- Test: `src/lib/signals/__tests__/loadStudentSignals.test.ts`
- Test (fix required): `src/app/(teacher)/students/[studentId]/__tests__/page.test.tsx` — add `coach_read` to `baseSignals()`.
- Test (fix required): `src/app/(teacher)/students/[studentId]/__tests__/student.leak.test.tsx` — add `coach_read` to `LEAK_FIXTURE`.

**Interfaces:**
- Consumes: `coachObservation`, `CoachObservation` (Task 2).
- Produces: `StudentSignals.coach_read: CoachObservation` (Task 4 renders it).

> **CRITICAL (pre-flight finding):** making `coach_read` a **required** field on
> `StudentSignals` breaks two existing test files that build full `StudentSignals`
> literals without it (`page.test.tsx:31` `baseSignals()`, `student.leak.test.tsx:45`
> `LEAK_FIXTURE`) — `npx tsc --noEmit` fails with TS2741. They MUST gain `coach_read`
> in this task (Step 3b). The render-assertion updates those files also need come in
> **Task 4** (when the card rendering changes), not here.

- [ ] **Step 1: Write the failing tests** — in `loadStudentSignals.test.ts`, (a) add `maybeSingle` to the mock chain, (b) add coach_read cases. Update the `chain` object in `makeAdmin` to include:

```ts
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
```

Then add:

```ts
  it('exposes coach_read and stays quiet with no behavioral row', async () => {
    const admin = makeAdmin({});
    const out = await loadStudentSignals(admin, 'stu-1');
    expect(out).toHaveProperty('coach_read');
    expect(out.coach_read.state).toBe('quiet');
  });

  it('coach_read goes to watch from a hot EMA model, uses the student first name, leaks nothing', async () => {
    const admin = makeAdmin({
      behavioral_signals: [{
        computed: {
          learningVelocity: 1, velocityTrend: 'stable',
          frustrationScore: 0.8, frustrationIndicators: [],
          attentionScore: 0.9, attentionGaps: 0,
          errorPatternType: 'procedural', errorFrequency: 0.2,
          confidenceScore: 0.5, confidenceAccuracy: 0.5,
          engagementScore: 0.8, engagementStyle: 'methodical',
          predictiveRiskScore: 0.1, riskFactors: [],
          sessionDurationMs: 600000,
        },
        observation_count: 3,
      }],
      users: [{ full_name: 'Maya Lopez' }],
    });
    const out = await loadStudentSignals(admin, 'stu-1');
    expect(out.coach_read.state).toBe('watch');
    expect(out.coach_read.line).toContain('Maya');
    expect(out.coach_read.line).not.toMatch(/\d/);
  });
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/signals/__tests__/loadStudentSignals.test.ts`
Expected: FAIL — `coach_read` undefined.

- [ ] **Step 3: Implement** — in `loadStudentSignals.ts`:

(a) Add imports near the top:

```ts
import { coachObservation, type CoachObservation } from '@/lib/copy/coachObservation';
import type { ComputedSignals } from '@/lib/signals/behavioralTypes';
```

(b) Add to the `StudentSignals` interface (after `growth_history`):

```ts
  coach_read: CoachObservation;
```

(c) After `roster_risk` is computed (the `computeRosterRiskIndex(...)` block) and before the `return`, add:

```ts
  // ── Coach read: the EMA behavioral model → ONE plain observation ──────────────
  // Server-side (Option-D): the raw model is translated to words here; only the
  // word-level CoachObservation crosses to the client.
  const { data: bsRow } = await admin
    .from('behavioral_signals')
    .select('computed, observation_count')
    .eq('student_id', studentId)
    .maybeSingle();

  const { data: nameRow } = await admin
    .from('users')
    .select('full_name')
    .eq('id', studentId)
    .maybeSingle();
  const firstName =
    ((nameRow as { full_name?: string | null } | null)?.full_name ?? '')
      .trim()
      .split(/\s+/)[0] || null;

  const coach_read = coachObservation({
    computed: (bsRow as { computed?: ComputedSignals | null } | null)?.computed ?? null,
    observationCount: (bsRow as { observation_count?: number } | null)?.observation_count ?? 0,
    firstName,
    rosterRisk: { risk_level: roster_risk.risk_level, risk_factors: roster_risk.risk_factors },
  });
```

(d) Add `coach_read,` to the returned object.

- [ ] **Step 3b: Add `coach_read` to the two existing `StudentSignals` fixtures** (keeps tsc green; the render-rendering they assert is still the OLD card until Task 4, so DON'T touch their assertions here).

In `src/app/(teacher)/students/[studentId]/__tests__/page.test.tsx`, inside `baseSignals()` — add before the closing `...overrides,`:

```ts
    coach_read: { state: 'quiet', eyebrow: 'Still settling in', line: 'Still getting to know how Sam works.', suggestion: null, tone: 'ok' },
```

In `src/app/(teacher)/students/[studentId]/__tests__/student.leak.test.tsx`, inside `LEAK_FIXTURE` — add after `growth_history: [11, 22, 33, 44],` (strings carry NO digits / banned words so the leak audit holds):

```ts
  coach_read: { state: 'watch', eyebrow: 'Worth a look', line: "Jordan's recent quizzes have dipped.", suggestion: 'Worth a closer look at what changed.', tone: 'risk' },
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/signals/__tests__/loadStudentSignals.test.ts "src/app/(teacher)/students/[studentId]/__tests__/page.test.tsx" "src/app/(teacher)/students/[studentId]/__tests__/student.leak.test.tsx" && npx tsc --noEmit`
Expected: PASS (all three — the two existing files still pass because the card rendering is unchanged this task), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/signals/loadStudentSignals.ts src/lib/signals/__tests__/loadStudentSignals.test.ts "src/app/(teacher)/students/[studentId]/__tests__/page.test.tsx" "src/app/(teacher)/students/[studentId]/__tests__/student.leak.test.tsx"
git commit -m "feat(signals): loadStudentSignals computes coach_read from the EMA model (server-side)"
```

---

### Task 4: Render `coach_read` in `WholeChildRail` ("Worth a look?")

**Files:**
- Modify: `src/app/(teacher)/students/[studentId]/_components/WholeChildRail.tsx`
- Test (create): `src/app/(teacher)/students/[studentId]/_components/__tests__/WholeChildRail.test.tsx`
- Test (fix required): `src/app/(teacher)/students/[studentId]/__tests__/student.leak.test.tsx` — update the "high" risk-band assertion.
- Test (fix required): `src/app/(teacher)/students/[studentId]/__tests__/page.test.tsx` — update the "Nothing flagged" assertion.

**Interfaces:**
- Consumes: `StudentSignals.coach_read` (Task 3).

> **CRITICAL (pre-flight finding):** this task removes `RiskBadge` and the
> "Nothing flagged." low-risk branch from `WholeChildRail`. Two existing tests
> assert exactly those deleted strings — `student.leak.test.tsx` asserts the band
> word "high" (rendered only by the now-deleted `RiskBadge`), and `page.test.tsx`
> asserts "Nothing flagged". Both crash at runtime after this task unless updated
> in Step 3b. (`coach_read` was already added to both fixtures in Task 3.)

- [ ] **Step 1: Write the failing test** — `__tests__/WholeChildRail.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WholeChildRail } from '../WholeChildRail';
import type { StudentSignals } from '@/lib/signals/loadStudentSignals';
import type { CoachObservation } from '@/lib/copy/coachObservation';

function signalsWith(coach_read: CoachObservation): StudentSignals {
  return {
    student_id: 'stu-1', current_band: 'grade_level',
    per_skill_cl: [], recurring_misconceptions: [],
    divergence: { divergence_score: 0, divergence_direction: 'aligned', divergence_trend: null, hw_avg: null, quiz_avg: null, divergence_flagged: false } as StudentSignals['divergence'],
    effort: { dominant_effort_pattern: null },
    risk: { roster: { risk_score: 0, risk_level: 'low', risk_factors: [] }, session: { score: 0, factors: [] } },
    reteach_outcomes: [], trajectory: { consistency_score: 0, consistency_label: 'consistent', trajectory: 'steady' } as StudentSignals['trajectory'],
    growth_history: [], coach_read,
  };
}
const cta = { kind: 'open-assignments', label: 'Open Assignments' } as const;

describe('WholeChildRail — Worth a look? (coach_read)', () => {
  it('renders a watch observation with its suggestion', () => {
    render(<WholeChildRail signals={signalsWith({ state: 'watch', eyebrow: 'Worth a look', line: "Maya's been rushing lately.", suggestion: 'A quick check-in might help.', tone: 'risk' })} storyLine="x" cta={cta} />);
    expect(screen.getByText('Worth a look')).toBeInTheDocument();
    expect(screen.getByText("Maya's been rushing lately.")).toBeInTheDocument();
    expect(screen.getByText('A quick check-in might help.')).toBeInTheDocument();
  });

  it('renders a calm state without a suggestion and leaks no digit', () => {
    const { container } = render(<WholeChildRail signals={signalsWith({ state: 'calm', eyebrow: 'Settling in', line: "Maya's working at a steady pace right now.", suggestion: null, tone: 'ok' })} storyLine="x" cta={cta} />);
    expect(screen.getByText('Settling in')).toBeInTheDocument();
    expect(container.textContent ?? '').not.toMatch(/\d/);
  });

  it('keeps the #at-risk anchor (priority CTA scroll target)', () => {
    const { container } = render(<WholeChildRail signals={signalsWith({ state: 'quiet', eyebrow: 'Still settling in', line: 'Still getting to know how Maya works.', suggestion: null, tone: 'ok' })} storyLine="x" cta={cta} />);
    expect(container.querySelector('#at-risk')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run "src/app/(teacher)/students/[studentId]/_components/__tests__/WholeChildRail.test.tsx"`
Expected: FAIL — component still renders the old "At risk?" card.

- [ ] **Step 3: Implement** — in `WholeChildRail.tsx`:

(a) Remove the now-unused imports `RiskBadge` and `riskFactorPhrase`.
(b) Remove the `riskLevel` / `topFactor` / `atRiskTone` locals.
(c) Replace the entire `{/* At risk? ... */}` `<div id="at-risk">...</div>` block with:

```tsx
      {/* Worth a look? — EMA coach-read; #at-risk anchor stays (priority CTA target) */}
      <div id="at-risk">
        <Card tone={signals.coach_read.tone}>
          <Eyebrow tone={signals.coach_read.tone}>{signals.coach_read.eyebrow}</Eyebrow>
          <div className="flex flex-col gap-1.5">
            <p className="text-fg text-[13px]">{signals.coach_read.line}</p>
            {signals.coach_read.suggestion && (
              <p className="text-fg text-[13px]">{signals.coach_read.suggestion}</p>
            )}
          </div>
        </Card>
      </div>
```

Note: `Card`/`Eyebrow` already accept `'risk' | 'warn' | 'ok'` tones (the `EyebrowTone` union and Card `tone` prop). No new tone values are introduced.

- [ ] **Step 3b: Update the two stale assertions in the existing surface tests** (the card no longer renders `RiskBadge`'s band word or "Nothing flagged."). The fixtures already carry `coach_read` from Task 3.

In `student.leak.test.tsx`, replace the test that asserts the band word "high":

```tsx
  it('renders the risk BAND word (high), not the number', async () => {
    const { container } = await renderPage();
    expect(container.innerHTML.toLowerCase()).toContain('high');
  });
```

with one that asserts the coach-read observation renders (the `LEAK_FIXTURE.coach_read.line` is "Jordan's recent quizzes have dipped."):

```tsx
  it('renders the coach-read observation (teacher-facing words)', async () => {
    const { container } = await renderPage();
    expect(container.innerHTML).toContain('dipped');
  });
```

(All the other no-number leak assertions in this file are unaffected — `coach_read`'s strings carry no digits, and `risk_factors` is no longer rendered at all.)

In `page.test.tsx`, replace:

```tsx
  it('shows "Nothing flagged." in the At-risk card when risk is low', async () => {
    const { container } = await renderPage();
    expect(container.innerHTML).toContain('Nothing flagged');
  });
```

with (the `baseSignals().coach_read` is the quiet state, eyebrow "Still settling in"):

```tsx
  it('shows the coach-read in the Worth-a-look card when nothing is notable', async () => {
    const { container } = await renderPage();
    expect(container.innerHTML).toContain('Still settling in');
  });
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run "src/app/(teacher)/students/[studentId]/_components/__tests__/WholeChildRail.test.tsx" "src/app/(teacher)/students/[studentId]/__tests__/student.leak.test.tsx" "src/app/(teacher)/students/[studentId]/__tests__/page.test.tsx" && npx tsc --noEmit`
Expected: PASS (all three), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(teacher)/students/[studentId]/_components/WholeChildRail.tsx" "src/app/(teacher)/students/[studentId]/_components/__tests__/WholeChildRail.test.tsx" "src/app/(teacher)/students/[studentId]/__tests__/student.leak.test.tsx" "src/app/(teacher)/students/[studentId]/__tests__/page.test.tsx"
git commit -m "feat(teacher): drill-in 'Worth a look?' card renders the EMA coach-read"
```

---

### Task 5: Thread misconception `error_types` into `loadRosterSignals.diagnose()`

**Files:**
- Modify: `src/lib/signals/loadRosterSignals.ts`
- Test: `src/lib/signals/__tests__/loadRosterSignals.test.ts`

- [ ] **Step 1: Write the failing test** — add to `loadRosterSignals.test.ts` (the mock already returns 5 `misconception_observations` rows for `stu1` with `error_type: 'wrong_op'`):

```ts
import { diagnose } from '@/lib/signals/diagnosis';

it('threads each student\'s misconception error_types into diagnose() (was hardcoded [])', async () => {
  const admin = makeMockAdmin();
  await loadRosterSignals(admin, 'class-1');
  const calls = vi.mocked(diagnose).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const stuCall = calls.find((c) => (c[0].error_types?.length ?? 0) > 0);
  expect(stuCall).toBeDefined();
  expect(stuCall![0].error_types).toContain('wrong_op');
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/signals/__tests__/loadRosterSignals.test.ts`
Expected: FAIL — `diagnose` is called with `error_types: []`.

- [ ] **Step 3: Implement** — in `loadRosterSignals.ts`:

(a) Move the class-wide misconception fetch to **before** the `Promise.all` per-student loop. Immediately after `students` is built, insert:

```ts
  // Fetch class misconceptions ONCE, up front — feeds BOTH per-student diagnosis
  // and the concept-gaps rail (no double query).
  const studentIds = students.map((s) => s.student_id);
  const { data: misconceptions } = await admin
    .from('misconception_observations')
    .select('student_id, skill_id, error_type')
    .in('student_id', studentIds.length > 0 ? studentIds : ['__none__']);

  const errorTypesByStudent = new Map<string, string[]>();
  for (const m of misconceptions ?? []) {
    const row = m as { student_id: string; error_type: string };
    const list = errorTypesByStudent.get(row.student_id) ?? [];
    list.push(row.error_type);
    errorTypesByStudent.set(row.student_id, list);
  }
```

(b) In the per-student `diagnoseInput`, replace `error_types: []` with:

```ts
        error_types: errorTypesByStudent.get(student_id) ?? [],
```

(c) **Delete** the now-duplicate later block that re-declared `const studentIds = ...` and re-fetched `misconception_observations` (the concept-gaps section keeps using the `misconceptions` variable now defined above — leave the rest of that section unchanged).

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/signals/__tests__/loadRosterSignals.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean. (Recurring-error diagnosis surfaces once a student logs ≥ 3 same-`error_type` misconceptions — `RECURRING_ERROR_THRESHOLD = 3`; with no homework, this is now the only quiz-only path to the focus group.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/signals/loadRosterSignals.ts src/lib/signals/__tests__/loadRosterSignals.test.ts
git commit -m "fix(signals): thread misconception error_types into roster diagnosis (was dropped)"
```

---

### Task 6: Render `concept_gaps` on the Today page

**Files:**
- Modify: `src/app/(teacher)/today/page.tsx`
- Test: `src/app/(teacher)/today/__tests__/today.test.tsx`

- [ ] **Step 1: Write the failing test** — the existing `today.test.tsx` FIXTURE already carries `concept_gaps: [{ skill_name: 'Adding fractions', pct_incorrect: 65, ... }]` (no fixture edit needed), and the file asserts via `container.innerHTML` (it does **not** import `screen`). Add a test that renders the populated-class case and asserts the concept-gap skill label now appears (it does not today — Today never reads `concept_gaps`). Match the file's existing render/await pattern (render with `?class=c1`), then:

```ts
    expect(container.innerHTML).toContain('Adding fractions');
```

(Do **not** add a second `concept_gaps` key or import `screen` — both would diverge from the file's pattern.)

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run "src/app/(teacher)/today/__tests__/today.test.tsx"`
Expected: FAIL — the label is not rendered (Today never read `concept_gaps`).

- [ ] **Step 3: Implement** — in `today/page.tsx`:

(a) Add the import:

```ts
import { ConceptGapsRail } from '../roster/_components/ConceptGapsRail';
```

(b) After the closing `</div>` of the `grid` block (and before the outer `</div>`), add:

```tsx
        <ConceptGapsRail gaps={data.concept_gaps} />
```

(`ConceptGapsRail` carries its own on-track empty state, so below the detector's 5-student floor it shows "No class-wide gaps" — no extra guard needed.)

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run "src/app/(teacher)/today/__tests__/today.test.tsx" && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(teacher)/today/page.tsx" "src/app/(teacher)/today/__tests__/today.test.tsx"
git commit -m "fix(teacher): render class concept_gaps on Today (was computed then dropped)"
```

---

### Task 7: Document the session-risk decision (ADR)

**Files:**
- Create: `docs/superpowers/specs/decisions/2026-06-21-session-risk-internal.md`
- Modify: `src/lib/signals/loadStudentSignals.ts` (one comment)

- [ ] **Step 1: Write the ADR** — `docs/superpowers/specs/decisions/2026-06-21-session-risk-internal.md`:

```markdown
# ADR — session_risk stays internal (2026-06-21)

**Decision:** On the teacher drill-in, the EMA cross-session **coach-read**
(`coach_read`, from `behavioral_signals`) is the canonical behavioral read.
The single-session `computeSessionRisk` value (`StudentSignals.risk.session`,
from the latest attempt's `quiz_responses`) is **computed but intentionally not
rendered**.

**Why:** Surfacing both would double-state the same concern (violates
one-thing-at-a-time). A single session is noisier than the smoothed EMA; the
coach-read waits for a pattern across ≥ 2 sessions before it speaks.

**Status of `sessionRiskPhrase`:** `src/lib/copy/sessionRiskPhrase.ts` is a
built + tested render helper with **no production caller**. It is retained as
latent infrastructure (e.g. a future "this session specifically" detail), not a
missing wire. Do not treat its absence from the UI as a bug.

**Revisit when:** the Assignment Player (Epic 2) adds richer single-session
behavioral data (hints, canvas, TTS) where a per-session read may earn its own slot.
```

- [ ] **Step 2: Add the pointer comment** — in `loadStudentSignals.ts`, immediately above the `session_risk` computation (the `let session_risk ...` / `computeSessionRisk` block), add:

```ts
  // session_risk is computed but intentionally NOT rendered — the EMA coach_read
  // supersedes the single-session read on the drill-in. See
  // docs/superpowers/specs/decisions/2026-06-21-session-risk-internal.md
```

- [ ] **Step 3: Verify nothing broke**

Run: `npx tsc --noEmit`
Expected: clean (doc + comment only).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/decisions/2026-06-21-session-risk-internal.md src/lib/signals/loadStudentSignals.ts
git commit -m "docs(adr): session_risk stays internal; EMA coach_read is canonical on the drill-in"
```

---

### Task 8: Full gate pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full suite + type + a11y + build**

Run (from repo root):
```bash
npx vitest run
npx tsc --noEmit
npm run a11y
npm run build
```
Expected: vitest all green; tsc 0; a11y 49/49; build exit 0.

- [ ] **Step 2: Lint the Phase-4 files**

Run: `npm run lint`
Expected: the Phase-4 files are clean. The 2 pre-existing branch-debt lint errors (`TeacherShell.tsx:20`, `(student)/layout.tsx:19`) are known and out of scope — confirm no *new* errors were introduced.

- [ ] **Step 3: Record completion** in `.git/sdd/progress.md` (controller does this between tasks anyway).

---

## Self-Review (author)

- **Spec coverage:** EMA coach-read (Tasks 1–4) ✓; wiring fix A (Task 5) ✓; wiring fix B (Task 6) ✓; session-risk decision (Task 7) ✓; leakGuard banned-words (Task 1) ✓; out-of-scope items untouched ✓.
- **Type consistency:** `CoachObservation` defined in Task 2 is imported by Tasks 3 & 4 with the same shape; `coach_read` added to `StudentSignals` in Task 3 is consumed in Task 4; `coachObservation` input matches its callers.
- **Placeholders:** none — every code step shows complete code.
- **Known sharp edges flagged for the implementer/reviewer:** `riskFactorPhrase` contains "score" (so the coach-read fallback emits its own phrase, never reuses it); `RECURRING_ERROR_THRESHOLD = 3` (recurring-error diagnosis needs ≥3 same-type, so fix A lights up after a pattern accumulates, not after one quiz); the Today→roster `ConceptGapsRail` cross-route import is intentional and minimal (a reviewer may relocate to a shared dir, but that is not required).
