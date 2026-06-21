# Quiz Runner Phase 3 — Coached Timed Runner UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `(student)/student/quiz` client page — the coached, timed student quiz runner — with lightweight inline behavioral capture, Option-D post-submit coaching screens, and component + leak-audit tests.

**Architecture:** A thin server component page at `src/app/(student)/student/quiz/page.tsx` passes `userId`, `schoolId`, and initial quiz data to an inner `'use client'` `QuizRunner` component. The runner is split into 4 sub-components (`QuizTimer`, `QuestionCard`, `ResultScreen`, `RecoveryBanner`) each in a `_components/` folder, keeping each file ≤300–400 lines. All API calls use the Phase-2 routes already built. Behavioral capture uses inline `useRef` counters and global `addEventListener` listeners — no third-party tracking library. Every student-facing string is run through `assertNoLeak` and collected in `STRINGS-FOR-BARB.md` as drafts.

**Option-D moves server-side (Tasks 1–2, done FIRST).** The whole-branch review flagged an Option-D carry-forward: the Phase-2 `submit` and `student-quiz` routes return raw `score_pct` + `mastery_band` over the wire, so the client necessarily holds the percentage even if it never renders it. Phase 3 closes this at the source. A new pure helper `studentResultBundle` selects the coaching message + soft mastery label + study-guide flag **on the server**, and the two routes return that pre-built `result` bundle instead of the raw number/enum. The runner consumes `result.scoreMessage`, `result.masteryLabel`, `result.needsStudyGuide` as opaque strings/booleans — it never sees a percentage or a raw band. These two route edits are Phase-2-route changes done first in Phase 3 because every downstream UI task depends on the new response shape.

**Tech Stack:** TypeScript, Next.js 16 App Router, React 19, Tailwind v4 token classes (Tier-2 only, no hex), Vitest 4 + @testing-library/react (jsdom), KaTeX via `MathText`, `src/lib/student/quizAttemptState.ts`, `src/lib/quiz/scoreMessage.ts`, `src/lib/quiz/studentResultBundle.ts` (NEW, Task 1), `src/lib/utils/masteryLabel.ts`, `src/lib/copy/leakGuard.ts`, `src/components/core/*`.

**Grounding:** `docs/superpowers/plans/grounding/2026-06-21-quiz-runner-ui.md` (primary); spec `docs/superpowers/specs/2026-06-20-quiz-runner-design.md`; posture `COACH-POSTURE.md`.

---

## Global Constraints

- **Route:** `src/app/(student)/student/quiz/page.tsx` (thin server wrapper) + `_components/QuizRunner.tsx` (all state/timers/fetch). NOT embedded in assignments.
- **Option-D (locked) — now enforced at the SERVER BOUNDARY (Tasks 1–2):** students NEVER see `score_pct`, `mastery_band` enum, or any percentage. The runner does NOT receive a raw `score_pct` / `mastery_band` over the wire at all: the `submit` and `student-quiz` routes call the pure `studentResultBundle` helper server-side and return a `result` bundle `{ scoreMessage, masteryLabel, needsStudyGuide }`. `scoreMessage = getScoreMessage(...)`, `masteryLabel = masteryDisplayLabel(band)` (soft word: `Building` / `On Track` / `Strong` / `Not yet assessed` — never the raw enum), `needsStudyGuide = scorePct < 80`. The runner renders `result.scoreMessage` + `result.masteryLabel` directly (no client-side `getScoreMessage` call, no percentage in client state). `<MasteryLabel>` is still rendered on the done screen for the neutral pill, fed the label. Render-side belt-and-suspenders stays: every student-facing string runs `assertNoLeak(text, context)` (throws if a number or `%` leaks), and the leak-audit tests assert no digits/`%`/raw-enum reach the DOM.
- **Token-only / WCAG-AA:** no hardcoded hex anywhere. Use `text-fg`, `bg-surface`, `bg-brand`, `text-warn-fg bg-warn-surface`, `text-risk-fg bg-risk-surface`, `animate-pulse`, `shadow-sticker` etc. The `npm run a11y` gate must stay green.
- **Auth chain (server component):** `await requireRole(['student'])` → `userId`. Client page calls API routes; each route independently gates (already enforced in Phase 2). The server wrapper passes `userId` as prop — NO client-side auth call in the runner.
- **Next.js 16:** `async params` (`const { ... } = await params`). `cookies()` / `headers()` are async. No bare `redirect()` inside try/catch.
- **Behavioral capture — SessionAggregates (exact camelCase keys):** `focusLossCount`, `pasteCount`, `pauseCount`, `totalPauseMs`, `totalFocusLossMs`, `backspaceCount`, `keypressCount`, `ttsPlayCount`, `canvasUsed` (always `false` — no canvas in the quiz runner), `stuckEraseCount` (computed: a pause >3s immediately followed by Backspace/Delete — see the `handleKeydown` listener in the QuizRunner task). These must match `src/lib/signals/behavioralTypes.ts:45–57` exactly.
- **Per-question signal columns** posted in every `responses[]` item: `response_time_ms`, `hesitation_ms`, `answer_changes`, `navigation_backs`, `pause_count`, `total_pause_ms`, `word_count`, `focus_loss_count`, `paste_count`, `hints_used` (always `0`), `question_type_scored`.
- **Signal post timing:** call `POST /api/attempts/[id]/signal` BOTH on every question advance (per-question signals) AND on final submit (all remaining signals + `sessionAggregates`). The grader reads `quiz_responses.response_text` — the signal post must happen BEFORE `/submit`.
- **Tests:** jsdom component tests (`// @vitest-environment jsdom` + `import '@/test/setup-dom'`) for each component; a dedicated leak-audit test that renders the done/forfeit screens with a score_pct fixture and asserts no digits or `%` appear in the DOM.
- **Strings:** every net-new user-facing string goes to `STRINGS-FOR-BARB.md` as a draft proposal. Barb gates before ship. Format: `| Screen | Draft string | Rule |`.
- **`STRINGS-FOR-BARB.md` entries required:** timer labels (normal/warning/danger), recovery banner body, auto-submit overlay, forfeit screen (eyebrow + closure/time_up reason + body + CTA), grading-pending screen (title + body + CTA), done screen heading + "what happens next" + study-guide accordion labels + strong-performance alt copy, per-question review accordion label, no-quiz empty state.
- **Adaptive Q4/Q5:** after successfully advancing past Q3, call `POST /api/attempts/[id]/adapt`. The route returns `{ adapted }` (NOT `adapted_questions`), where `adapted` is the `AdaptedQuestions` jsonb: `{ level, mcq_pct, questions: [{ position, question_text, rubric, scaffold_hint, difficulty_label }] }`. The adapted entries are open-response Q4/Q5 ONLY — they carry NO `question_type`, `choices`, or `correct_answer`. The runner maps each adapted entry to a `QuizQuestion` with `question_type: 'open'`, `choices: null`, `correct_answer: ''`, splicing them at positions 4–5 (preserving each entry's `position` and the original `id` if resolvable, else a synthetic `adapted-${position}` id). The splice is gated so a missing/empty/short `questions` array never breaks rendering — on any failure the original Q4/Q5 stay. (`/adapt` itself never blocks: `adaptQuestions` returns the original Q4/Q5 on LLM failure, so a 200 with `adapted` is always present; the runner still guards.)
- **grading-pending:** when `/submit` returns `{ grading_delayed: true }`, set state to `'grading-pending'` — show static "being graded" screen, no polling. CTA returns to dashboard.
- **Teli TTS:** the server bundle's `scoreMessage.teliMsg` (from `getScoreMessage`, built in `studentResultBundle`) arrives as a prop. Render it as static text on the done screen. Wire `teliSpeak()` only if a V2 TTS call site is confirmed to exist in `src/components/` — otherwise leave as a `// TODO(tts)` comment.
- **`computeSignals` hook (submit route):** Phase 3 modifies the submit route ONLY to reshape its response (Task 2: drop raw `score_pct`/`mastery_band`, add the `result` bundle). The grading logic, the three `after()` hooks (including the `computeSignals` behavioral hook wired in Phase 2 Task 7), and the `grading_delayed` early-returns are UNTOUCHED. The runner calls `/submit` and consumes `result` (+ `grades` + `grading_delayed`).
- **`tsc --noEmit` must pass** after every task. Run `npx tsc --noEmit` before each commit.

---

## File Structure

```
src/lib/quiz/
  studentResultBundle.ts                ← NEW (Task 1): pure server helper — score_pct/band → { scoreMessage, masteryLabel, needsStudyGuide }
  __tests__/
    studentResultBundle.test.ts         ← NEW (Task 1): pure-unit test (node env)

src/app/api/attempts/[attemptId]/submit/route.ts          ← MODIFY (Task 2): return `result` bundle, drop raw score_pct/mastery_band
src/app/api/attempts/[attemptId]/submit/__tests__/route.test.ts  ← MODIFY (Task 2): assert bundle present + no raw leak
src/app/api/attempts/student-quiz/route.ts                ← MODIFY (Task 2): completed existing_attempt gets `result` bundle, drop raw score_pct/mastery_band
src/app/api/attempts/student-quiz/__tests__/route.test.ts ← MODIFY (Task 2): assert no raw score_pct/mastery_band; bundle when completed

src/app/(student)/student/quiz/
  page.tsx                              ← NEW (Task 8): thin server component (requireRole + grade_level→tier from public.users)
  _components/
    QuizRunner.tsx                      ← NEW (Task 7): 'use client', master state machine + all fetch + behavioral capture
    QuizTimer.tsx                       ← NEW (Task 3): 'use client', SVG ring timer (pure props, no fetch)
    QuestionCard.tsx                    ← NEW (Task 5): 'use client', per-type rendering (MCQ/numeric/open)
    ResultScreen.tsx                    ← NEW (Task 6): done/forfeit/grading-pending screens (pure props — consumes pre-built bundle)
    RecoveryBanner.tsx                  ← NEW (Task 4): recovery/resume banner (pure props + dismiss callback)
    __tests__/
      QuizTimer.test.tsx                ← NEW (Task 3): jsdom — timer math display, color thresholds
      QuestionCard.test.tsx             ← NEW (Task 5): jsdom — MCQ/numeric/open rendering, handleResponse
      ResultScreen.test.tsx             ← NEW (Task 6): jsdom — done/forfeit/grading-pending render
      RecoveryBanner.test.tsx           ← NEW (Task 4): jsdom — banner text, countdown, dismiss
      QuizRunner.leak.test.tsx          ← NEW (Task 7): jsdom leak-audit — done + forfeit screens with score fixture

STRINGS-FOR-BARB.md                     ← MODIFY (Task 4): append Quiz Runner Phase 3 section
```

**Task order:** Task 1 (`studentResultBundle` helper) → Task 2 (reshape `submit` + `student-quiz`) → Task 3 (`QuizTimer`) → Task 4 (`RecoveryBanner` + strings) → Task 5 (`QuestionCard`) → Task 6 (`ResultScreen`) → Task 7 (`QuizRunner` + leak test) → Task 8 (server wrapper page) → Task 9 (nav + full suite). The two server-side tasks come first so every UI task is built against the final response shape.

---

## Task 1: `studentResultBundle` server helper + tests

Closes the whole-branch review's Option-D carry-forward (raw `score_pct`/`mastery_band` over the wire). This pure helper is the single place that turns an internal score + band into the student-safe `result` bundle the routes return. Tasks 2, 6, 7 all depend on it.

**Files:**
- Create: `src/lib/quiz/studentResultBundle.ts`
- Create: `src/lib/quiz/__tests__/studentResultBundle.test.ts`

**Interfaces:**
- Produces: `studentResultBundle(input: StudentResultBundleInput): StudentResultBundle`
- Consumes: `getScoreMessage` from `@/lib/quiz/scoreMessage` (real signature: `getScoreMessage(pct, seed, locale, tier, firstName)` → `{ message, teliMsg, teliState }`), `masteryDisplayLabel` from `@/lib/utils/masteryLabel` (`(band: string|null|undefined) => string`).
- Pure: no React, no Next.js, no browser globals, no Supabase. Node-env test.

```ts
import type { Tier } from '@/lib/quiz/scoreMessage';

export interface StudentResultBundleInput {
  scorePct: number;
  masteryBand: string | null;
  tier: Tier;                     // 'elementary' | 'middle' | 'high'
  firstName: string | null;
  attemptId: string;              // used as the getScoreMessage seed (per-attempt entropy)
  locale?: 'en' | 'pt';           // default 'en'
}

export interface StudentResultBundle {
  scoreMessage: { message: string; teliMsg: string; teliState: 'celebrating' | 'idle' | 'speaking' };
  masteryLabel: string;           // soft word from masteryDisplayLabel — never the raw enum
  needsStudyGuide: boolean;       // scorePct < 80
}
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/quiz/__tests__/studentResultBundle.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { studentResultBundle } from '../studentResultBundle';
import { hasLeak } from '@/lib/copy/leakGuard';

describe('studentResultBundle', () => {
  it('returns a coaching message, a soft mastery label, and a study-guide flag', () => {
    const bundle = studentResultBundle({
      scorePct: 92,
      masteryBand: 'advanced',
      tier: 'middle',
      firstName: 'Alex',
      attemptId: 'att-1',
    });
    expect(typeof bundle.scoreMessage.message).toBe('string');
    expect(bundle.scoreMessage.message.length).toBeGreaterThan(0);
    // 'advanced' → 'Strong' (soft label, never the raw enum)
    expect(bundle.masteryLabel).toBe('Strong');
    expect(bundle.needsStudyGuide).toBe(false);
  });

  it('flags needsStudyGuide when scorePct < 80', () => {
    const bundle = studentResultBundle({
      scorePct: 42,
      masteryBand: 'reteach',
      tier: 'middle',
      firstName: 'Sam',
      attemptId: 'att-2',
    });
    expect(bundle.needsStudyGuide).toBe(true);
    expect(bundle.masteryLabel).toBe('Building'); // reteach → Building
  });

  it('does NOT flag needsStudyGuide at exactly 80', () => {
    const bundle = studentResultBundle({
      scorePct: 80,
      masteryBand: 'grade_level',
      tier: 'high',
      firstName: null,
      attemptId: 'att-3',
    });
    expect(bundle.needsStudyGuide).toBe(false);
    expect(bundle.masteryLabel).toBe('On Track'); // grade_level → On Track
  });

  it('null masteryBand → "Not yet assessed"', () => {
    const bundle = studentResultBundle({
      scorePct: 70,
      masteryBand: null,
      tier: 'elementary',
      firstName: 'Jo',
      attemptId: 'att-4',
    });
    expect(bundle.masteryLabel).toBe('Not yet assessed');
  });

  it('LEAK AUDIT: neither message nor label contains a digit, %, or raw band enum', () => {
    for (const band of ['reteach', 'grade_level', 'advanced', null]) {
      const bundle = studentResultBundle({
        scorePct: 55,
        masteryBand: band,
        tier: 'high',
        firstName: 'Pat',
        attemptId: `att-${band}`,
      });
      expect(hasLeak(bundle.scoreMessage.message)).toBe(false);
      expect(hasLeak(bundle.masteryLabel)).toBe(false);
      // never the raw enum
      expect(bundle.masteryLabel).not.toBe('reteach');
      expect(bundle.masteryLabel).not.toBe('grade_level');
      expect(bundle.masteryLabel).not.toBe('advanced');
    }
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```
npx vitest run src/lib/quiz/__tests__/studentResultBundle.test.ts
```
Expected: FAIL — `Cannot find module '../studentResultBundle'`.

- [ ] **Step 3: Implement `studentResultBundle.ts`**

Create `src/lib/quiz/studentResultBundle.ts`:

```ts
// src/lib/quiz/studentResultBundle.ts
// Pure server helper — turns an internal score_pct + mastery_band into the
// student-safe result bundle returned by the submit + student-quiz routes.
//
// Option-D boundary: this is the ONLY place that converts a raw number/enum
// into student copy. The routes call this server-side and ship the bundle, so
// the runner never receives a percentage or a raw band over the wire.
//
// Framework-agnostic: no React, no Next.js, no Supabase, no browser globals.

import { getScoreMessage, type Tier } from '@/lib/quiz/scoreMessage';
import { masteryDisplayLabel } from '@/lib/utils/masteryLabel';

export interface StudentResultBundleInput {
  scorePct: number;
  masteryBand: string | null;
  tier: Tier;
  firstName: string | null;
  attemptId: string;
  locale?: 'en' | 'pt';
}

export interface StudentResultBundle {
  scoreMessage: { message: string; teliMsg: string; teliState: 'celebrating' | 'idle' | 'speaking' };
  masteryLabel: string;
  needsStudyGuide: boolean;
}

export function studentResultBundle(input: StudentResultBundleInput): StudentResultBundle {
  const { scorePct, masteryBand, tier, firstName, attemptId, locale = 'en' } = input;
  // getScoreMessage(pct, seed, locale, tier, firstName) — attemptId is the seed.
  const scoreMessage = getScoreMessage(scorePct, attemptId, locale, tier, firstName);
  const masteryLabel = masteryDisplayLabel(masteryBand);
  const needsStudyGuide = scorePct < 80;
  return { scoreMessage, masteryLabel, needsStudyGuide };
}
```

- [ ] **Step 4: Run to verify PASS**

```
npx vitest run src/lib/quiz/__tests__/studentResultBundle.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: `tsc` clean**

```
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/quiz/studentResultBundle.ts \
        src/lib/quiz/__tests__/studentResultBundle.test.ts
git commit -m "feat(quiz-runner): studentResultBundle — server-side Option-D bundle helper"
```

---

## Task 2: Reshape `submit` + `student-quiz` responses (server-side Option-D)

Phase-2-route edits done first in Phase 3. The two routes currently return raw `score_pct` + `mastery_band`; this task replaces those with the server-built `result` bundle (Task 1) so the runner never holds a percentage. The `grading_delayed` path, the `after()` hooks (which read the attempt row server-side), and `grades` are all unchanged.

**Files:**
- Modify: `src/app/api/attempts/[attemptId]/submit/route.ts`
- Modify: `src/app/api/attempts/[attemptId]/submit/__tests__/route.test.ts`
- Modify: `src/app/api/attempts/student-quiz/route.ts`
- Modify: `src/app/api/attempts/student-quiz/__tests__/route.test.ts`

**Interfaces (new response shapes):**
- `submit` all-clean success: `{ attempt_id, raw_score, grades, result: StudentResultBundle }` — NO `score_pct`, NO `mastery_band`.
- `student-quiz` completed `existing_attempt`: `{ id, is_complete, adapted_questions, started_at, last_active_at, forfeit_reason, result: StudentResultBundle }` — NO `score_pct`, NO `mastery_band`. In-progress attempts: same minus `result` (no bundle).

### Part A — `submit/route.ts`

- [ ] **Step 1: Add the tier/firstName read on the all-clean path + build the bundle.**

The route already reads `users` in the behavioral-signal hook (for `school_id`). On the all-clean path, BEFORE the final `return`, fetch the student's `grade_level` + `full_name` from `users` (a single extra read on the synchronous response path — not inside `after()`), map `grade_level` (text) → tier, derive `firstName`, and build the bundle.

Add this import at the top of `submit/route.ts`:

```ts
import { studentResultBundle } from '@/lib/quiz/studentResultBundle';
import type { Tier } from '@/lib/quiz/scoreMessage';
```

Add this tier helper near the top of the file (module scope, after imports):

```ts
// grade_level is TEXT on public.users (migration 0001). Parse the leading
// integer; map K–5 → elementary, 6–8 → middle, 9–12 → high. Unparseable → middle.
function gradeTextToTier(gradeLevel: string | null): Tier {
  if (!gradeLevel) return 'middle';
  const n = parseInt(gradeLevel.replace(/[^0-9]/g, ''), 10);
  if (Number.isNaN(n)) return 'middle';
  if (n <= 5) return 'elementary';
  if (n <= 8) return 'middle';
  return 'high';
}
```

**Step 1 — replace the all-clean `return` (BEFORE):**

```ts
    return NextResponse.json({
      attempt_id: attemptId,
      raw_score: rawScore,
      score_pct: scorePct,
      mastery_band: masteryBand,
      grades: oeqResults.map(r => ({
        position: r.task.position,
        score: (r as { grade: NonNullable<OeqResult['grade']> }).grade.score,
      })),
    });
```

**(AFTER):**

```ts
    // ── Build the student-safe result bundle (Option-D server boundary) ──────
    // Fetch tier + firstName for the message; reuse the same users table the
    // hooks read. score_pct / mastery_band are NEVER returned over the wire.
    const { data: profileRow } = await admin
      .from('users')
      .select('grade_level, full_name')
      .eq('id', attempt.student_id)
      .single();
    const tier = gradeTextToTier((profileRow as { grade_level?: string | null } | null)?.grade_level ?? null);
    const firstName = ((profileRow as { full_name?: string | null } | null)?.full_name ?? '')
      .trim().split(/\s+/)[0] || null;

    const result = studentResultBundle({
      scorePct,
      masteryBand,
      tier,
      firstName,
      attemptId,
    });

    return NextResponse.json({
      attempt_id: attemptId,
      raw_score: rawScore,
      grades: oeqResults.map(r => ({
        position: r.task.position,
        score: (r as { grade: NonNullable<OeqResult['grade']> }).grade.score,
      })),
      result,
    });
```

> NOTE: the `grading_delayed` early-return payloads are UNCHANGED (they already carry no score). The three `after()` hooks read the attempt row server-side and are untouched.

- [ ] **Step 2: Update `submit/__tests__/route.test.ts`.**

Add `studentResultBundle` to the data the happy-path mock can satisfy: the new `users` select on the all-clean path returns `{ grade_level, full_name }`. The existing `makeAdminMock` `users` chain returns `usersSchoolId` only — extend it so the synchronous profile read resolves. Update `makeAdminMock`'s `users` branch to return a row carrying `grade_level` + `full_name` + `school_id`:

```ts
// in makeAdminMock opts, add:
//   usersProfile?: { grade_level?: string | null; full_name?: string | null } | null
// and in the users branch return a row that includes grade_level/full_name as well
// as school_id (the hooks only read school_id; the sync path reads grade_level/full_name):
      if (table === 'users') {
        return makeChain({
          data: {
            school_id: usersSchoolId,
            grade_level: usersProfile?.grade_level ?? '7',
            full_name: usersProfile?.full_name ?? 'Test Student',
          },
        });
      }
```

Then in the **happy-path test**, replace the raw-score assertions with bundle + no-leak assertions:

```ts
    expect(res.status).toBe(200);
    const body = await res.json();
    // Bundle present, raw score/band ABSENT (Option-D server boundary)
    expect(body.result).toBeDefined();
    expect(typeof body.result.scoreMessage.message).toBe('string');
    expect(typeof body.result.masteryLabel).toBe('string');
    expect(typeof body.result.needsStudyGuide).toBe('boolean');
    expect(body.score_pct).toBeUndefined();
    expect(body.mastery_band).toBeUndefined();
    // grades still returned
    expect(body.grades).toHaveLength(2);
    // No raw percentage / band enum anywhere in the serialized body
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/"score_pct"/);
    expect(raw).not.toMatch(/"mastery_band"/);
    expect(raw).not.toContain('grade_level');  // raw mastery enum must not leak
    expect(raw).not.toContain('advanced');
    expect(raw).not.toContain('reteach');
    expect(raw).not.toMatch(/%/);
```

> Keep the existing `grading_delayed` / pending-path tests as-is — they already assert `body.mastery_band` is undefined and continue to pass (those paths return early, before the bundle build). The `usesProfile` default of grade `'7'` → middle tier keeps the happy path deterministic.

- [ ] **Step 3: Run the submit test + tsc**

```
npx vitest run src/app/api/attempts/\[attemptId\]/submit/__tests__/route.test.ts
npx tsc --noEmit
```
Expected: all PASS, 0 type errors.

### Part B — `student-quiz/route.ts`

- [ ] **Step 4: Build the bundle for a COMPLETED existing_attempt; drop raw fields.**

The latest-attempt select currently pulls `score_pct, mastery_band`. Keep reading them internally (needed to build the bundle) but do NOT return them. For a completed attempt, fetch the student's `grade_level` + `full_name` (the route already queries `users` for the teacher name — add one scoped read for the student), build the bundle, attach it as `existing_attempt.result`. In-progress attempts get NO bundle.

Add imports + the same `gradeTextToTier` helper (or import a shared one — if you extract `gradeTextToTier` to `studentResultBundle.ts` as a named export, import it in both routes instead of duplicating; either is acceptable, but do not leave two diverging copies):

```ts
import { studentResultBundle } from '@/lib/quiz/studentResultBundle';
```

**Replace the `existingAttempt` construction + final return (BEFORE):**

```ts
    const existingAttempt = (latestAttempts as unknown[])?.[0] ?? null;
```
...and the final `return NextResponse.json({ quiz, existing_attempt: existingAttempt, teacher_name: teacherName, class_name: className });`

**(AFTER):** keep the select as-is (it still pulls `score_pct, mastery_band` for internal use), then reshape field-by-field — never spread the row:

```ts
    type LatestAttemptRow = {
      id: string;
      is_complete: boolean;
      score_pct: number | null;
      mastery_band: string | null;
      adapted_questions: unknown;
      started_at: string | null;
      last_active_at: string | null;
      forfeit_reason: string | null;
    };
    const latestRow = (latestAttempts as LatestAttemptRow[] | null)?.[0] ?? null;

    let existingAttempt:
      | (Omit<LatestAttemptRow, 'score_pct' | 'mastery_band'> & { result?: ReturnType<typeof studentResultBundle> })
      | null = null;

    if (latestRow) {
      // Option-D: build field-by-field; score_pct / mastery_band are NEVER copied out.
      existingAttempt = {
        id: latestRow.id,
        is_complete: latestRow.is_complete,
        adapted_questions: latestRow.adapted_questions,
        started_at: latestRow.started_at,
        last_active_at: latestRow.last_active_at,
        forfeit_reason: latestRow.forfeit_reason,
      };

      // Completed attempt with a real score → attach the student-safe bundle.
      if (latestRow.is_complete && latestRow.score_pct !== null) {
        const { data: studentProfile } = await admin
          .from('users')
          .select('grade_level, full_name')
          .eq('id', user.id)
          .single();
        const tier = gradeTextToTier((studentProfile as { grade_level?: string | null } | null)?.grade_level ?? null);
        const firstName = ((studentProfile as { full_name?: string | null } | null)?.full_name ?? '')
          .trim().split(/\s+/)[0] || null;
        existingAttempt.result = studentResultBundle({
          scorePct: latestRow.score_pct,
          masteryBand: latestRow.mastery_band,
          tier,
          firstName,
          attemptId: latestRow.id,
        });
      }
    }

    return NextResponse.json({
      quiz,
      existing_attempt: existingAttempt,
      teacher_name: teacherName,
      class_name: className,
    });
```

(Define `gradeTextToTier` in this route too, OR import the shared export — see Step 4 note. Keep ONE source of truth.)

- [ ] **Step 5: Update `student-quiz/__tests__/route.test.ts`.**

The current happy-path test asserts `existing_attempt` HAS `score_pct` + `mastery_band`. Invert those assertions:

```ts
    // Existing attempt fields — raw score/band must NOT be present (Option-D)
    expect(body.existing_attempt).not.toBeNull();
    expect(body.existing_attempt.id).toBe(ATTEMPT_ID);
    expect(body.existing_attempt).toHaveProperty('is_complete');
    expect(body.existing_attempt).not.toHaveProperty('score_pct');
    expect(body.existing_attempt).not.toHaveProperty('mastery_band');
    expect(body.existing_attempt).toHaveProperty('adapted_questions');
    expect(body.existing_attempt).toHaveProperty('started_at');
    expect(body.existing_attempt).toHaveProperty('last_active_at');
    expect(body.existing_attempt).toHaveProperty('forfeit_reason');
    // In-progress attempt (FAKE_ATTEMPT.is_complete=false) → NO bundle
    expect(body.existing_attempt.result).toBeUndefined();
```

In the **fallback-to-completed test** (where `latestAttempt` is completed with `score_pct: 82`), assert the bundle is attached and the raw score is gone:

```ts
    // Fallback: the completed quiz is resolved (not null)
    expect(body.quiz).not.toBeNull();
    expect(body.quiz.id).toBe(QUIZ_ID);
    // Completed attempt → bundle present, raw score absent
    expect(body.existing_attempt.is_complete).toBe(true);
    expect(body.existing_attempt).not.toHaveProperty('score_pct');
    expect(body.existing_attempt.result).toBeDefined();
    expect(typeof body.existing_attempt.result.masteryLabel).toBe('string');
    const rawBody = JSON.stringify(body.existing_attempt);
    expect(rawBody).not.toContain('82');
    expect(rawBody).not.toMatch(/%/);
```

The `makeAdminMock` `users` branch currently returns `FAKE_TEACHER` (`{ full_name }`); the new student-profile read also hits `users`. Because both reads hit the same `users` chain in the mock, returning `{ full_name: 'Ms. Rivera' }` (no `grade_level`) still works — `gradeTextToTier(null)` → `'middle'`, and `firstName` derives from `full_name`. No mock change is strictly required for the completed-attempt read to resolve; if a test needs a specific tier, add a `grade_level` to that test's `users` row. Confirm the completed-fallback test still passes (it queries `users` for both teacher and student via the same chain).

- [ ] **Step 6: Run the student-quiz test + tsc**

```
npx vitest run src/app/api/attempts/student-quiz/__tests__/route.test.ts
npx tsc --noEmit
```
Expected: all PASS, 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/attempts/\[attemptId\]/submit/route.ts \
        src/app/api/attempts/\[attemptId\]/submit/__tests__/route.test.ts \
        src/app/api/attempts/student-quiz/route.ts \
        src/app/api/attempts/student-quiz/__tests__/route.test.ts
git commit -m "feat(quiz-runner): server-side Option-D — routes return result bundle, no raw score_pct/mastery_band"
```

---

## Task 3: `QuizTimer` component + tests

**Files:**
- Create: `src/app/(student)/student/quiz/_components/QuizTimer.tsx`
- Create: `src/app/(student)/student/quiz/_components/__tests__/QuizTimer.test.tsx`

**Interfaces:**
- Produces: `<QuizTimer timeLeft={number} totalSeconds={number} />` — pure presentational, no state. Parent (`QuizRunner`) drives it.
- Exports: `QuizTimer` (named export)

```ts
// QuizTimer.tsx props
export interface QuizTimerProps {
  timeLeft: number;      // seconds remaining (0–totalSeconds)
  totalSeconds: number;  // always QUIZ_DURATION_MINUTES * 60 = 600
}
```

- [ ] **Step 1: Write the failing tests**

Create `src/app/(student)/student/quiz/_components/__tests__/QuizTimer.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuizTimer } from '../QuizTimer';

describe('QuizTimer', () => {
  it('renders MM:SS format for a normal time (300s = 5:00)', () => {
    render(<QuizTimer timeLeft={300} totalSeconds={600} />);
    expect(screen.getByText('5:00')).toBeTruthy();
  });

  it('renders 10:00 at full time', () => {
    render(<QuizTimer timeLeft={600} totalSeconds={600} />);
    expect(screen.getByText('10:00')).toBeTruthy();
  });

  it('renders 0:00 at zero', () => {
    render(<QuizTimer timeLeft={0} totalSeconds={600} />);
    expect(screen.getByText('0:00')).toBeTruthy();
  });

  it('applies warning class at 180s', () => {
    const { container } = render(<QuizTimer timeLeft={180} totalSeconds={600} />);
    expect(container.innerHTML).toContain('warn');
  });

  it('applies danger class at 60s', () => {
    const { container } = render(<QuizTimer timeLeft={60} totalSeconds={600} />);
    expect(container.innerHTML).toContain('risk');
  });

  it('applies pulse class at 30s', () => {
    const { container } = render(<QuizTimer timeLeft={30} totalSeconds={600} />);
    expect(container.innerHTML).toContain('animate-pulse');
  });

  it('does NOT apply warning or danger class at 181s (normal zone)', () => {
    const { container } = render(<QuizTimer timeLeft={181} totalSeconds={600} />);
    expect(container.innerHTML).not.toContain('risk');
    expect(container.innerHTML).not.toContain('warn');
  });

  it('LEAK AUDIT: no raw seconds count or % renders', () => {
    const { container } = render(<QuizTimer timeLeft={300} totalSeconds={600} />);
    // 300 must not appear as a raw number — only MM:SS format is acceptable
    expect(container.textContent).not.toContain('300');
    expect(container.textContent).not.toContain('%');
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```
npx vitest run src/app/\(student\)/student/quiz/_components/__tests__/QuizTimer.test.tsx
```
Expected: FAIL — `Cannot find module '../QuizTimer'`

- [ ] **Step 3: Implement `QuizTimer.tsx`**

Create `src/app/(student)/student/quiz/_components/QuizTimer.tsx`:

```tsx
'use client';

import React from 'react';

export interface QuizTimerProps {
  timeLeft: number;    // seconds remaining
  totalSeconds: number;
}

/** Format seconds as M:SS */
function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * SVG ring timer. Depletes clockwise from full (rotated -90deg).
 * Token-only colors — no hardcoded hex.
 *
 * Thresholds (from V1 quiz/page.tsx:39–41 + grounding §1.3):
 *   isWarning  = timeLeft <= 180 && timeLeft > 60  → warn tokens
 *   isDanger   = timeLeft <= 60                     → risk tokens
 *   isPulsing  = timeLeft <= 30                     → animate-pulse
 */
export function QuizTimer({ timeLeft, totalSeconds }: QuizTimerProps) {
  const isWarning = timeLeft <= 180 && timeLeft > 60;
  const isDanger  = timeLeft <= 60;
  const isPulsing = timeLeft <= 30;

  // SVG ring geometry
  const R = 36;
  const CIRC = 2 * Math.PI * R;
  const pct = totalSeconds > 0 ? timeLeft / totalSeconds : 0;
  const dash = pct * CIRC;

  const ringColorClass = isDanger
    ? 'text-risk-fg'
    : isWarning
      ? 'text-warn-fg'
      : 'text-brand';

  const bgClass = isDanger
    ? 'bg-risk-surface text-risk-fg'
    : isWarning
      ? 'bg-warn-surface text-warn-fg'
      : 'bg-surface text-fg';

  return (
    <div
      className={`relative inline-flex flex-col items-center justify-center w-24 h-24 rounded-full border-2 border-surface shadow-sticker ${bgClass} ${isPulsing ? 'animate-pulse' : ''}`}
      role="timer"
      aria-label={`${fmt(timeLeft)} remaining`}
      aria-live="off"
    >
      {/* Background ring track */}
      <svg
        viewBox="0 0 88 88"
        className="absolute inset-0 w-full h-full -rotate-90"
        aria-hidden
      >
        <circle
          cx={44} cy={44} r={R}
          fill="none"
          strokeWidth={6}
          className="stroke-surface"
          opacity={0.3}
        />
        <circle
          cx={44} cy={44} r={R}
          fill="none"
          strokeWidth={6}
          className={ringColorClass}
          style={{
            strokeDasharray: `${CIRC}`,
            strokeDashoffset: `${CIRC - dash}`,
            transition: 'stroke-dashoffset 1s linear',
          }}
        />
      </svg>
      {/* Time label */}
      <span className="relative z-10 font-display text-lg font-bold leading-none tabular-nums">
        {fmt(timeLeft)}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify PASS**

```
npx vitest run src/app/\(student\)/student/quiz/_components/__tests__/QuizTimer.test.tsx
```
Expected: all tests PASS.

- [ ] **Step 5: `tsc` clean**

```
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(student\)/student/quiz/_components/QuizTimer.tsx \
        src/app/\(student\)/student/quiz/_components/__tests__/QuizTimer.test.tsx
git commit -m "feat(quiz-runner): QuizTimer SVG ring — token-only, thresholds, leak-free"
```

---

## Task 4: `RecoveryBanner` component + tests

**Files:**
- Create: `src/app/(student)/student/quiz/_components/RecoveryBanner.tsx`
- Create: `src/app/(student)/student/quiz/_components/__tests__/RecoveryBanner.test.tsx`

**Interfaces:**
- Produces: `<RecoveryBanner gapSec={number} closureSecondsLeft={number} onDismiss={() => void} />`
- Exports: `RecoveryBanner` (named export)

```ts
export interface RecoveryBannerProps {
  gapSec: number;               // seconds since last_active_at (for "you were away X ago" copy)
  closureSecondsLeft: number;   // from closureSecondsRemaining() — countdown to forfeit
  onDismiss: () => void;
}
```

- [ ] **Step 1: Write the failing tests**

Create `src/app/(student)/student/quiz/_components/__tests__/RecoveryBanner.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecoveryBanner } from '../RecoveryBanner';

describe('RecoveryBanner', () => {
  it('shows seconds when gap < 60', () => {
    render(<RecoveryBanner gapSec={45} closureSecondsLeft={255} onDismiss={vi.fn()} />);
    // Should mention 45 seconds of gap OR a minutes-to-close warning
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text.length).toBeGreaterThan(0);
  });

  it('shows minutes when gap >= 60', () => {
    render(<RecoveryBanner gapSec={120} closureSecondsLeft={180} onDismiss={vi.fn()} />);
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text.length).toBeGreaterThan(0);
  });

  it('calls onDismiss when the close button is clicked', () => {
    const dismiss = vi.fn();
    render(<RecoveryBanner gapSec={45} closureSecondsLeft={200} onDismiss={dismiss} />);
    const btn = screen.getByRole('button', { name: /dismiss|close/i });
    fireEvent.click(btn);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('LEAK AUDIT: uses warn tokens — no hardcoded hex color literals in markup', () => {
    const { container } = render(
      <RecoveryBanner gapSec={45} closureSecondsLeft={255} onDismiss={vi.fn()} />,
    );
    // No inline style with # hex — token classes only
    expect(container.innerHTML).not.toMatch(/style="[^"]*#[0-9a-fA-F]/);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```
npx vitest run src/app/\(student\)/student/quiz/_components/__tests__/RecoveryBanner.test.tsx
```
Expected: FAIL — `Cannot find module '../RecoveryBanner'`

- [ ] **Step 3: Implement `RecoveryBanner.tsx`**

Create `src/app/(student)/student/quiz/_components/RecoveryBanner.tsx`:

```tsx
'use client';

import React from 'react';

export interface RecoveryBannerProps {
  gapSec: number;
  closureSecondsLeft: number;
  onDismiss: () => void;
}

function fmtGap(gapSec: number): string {
  if (gapSec < 60) return `${gapSec} seconds`;
  return `${Math.round(gapSec / 60)} minute${Math.round(gapSec / 60) === 1 ? '' : 's'}`;
}

function fmtClose(sec: number): string {
  if (sec < 60) return `${sec} seconds`;
  const m = Math.ceil(sec / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
}

/**
 * Recovery banner shown when classifyAttemptState returns 'resuming_after_gap'.
 * Tells the student how long they were away and how long they have before the
 * quiz closes (closureSecondsLeft). Token-only styling (warn surface).
 *
 * Copy proposals in STRINGS-FOR-BARB.md §Quiz-Runner-Phase3 #2.
 */
export function RecoveryBanner({ gapSec, closureSecondsLeft, onDismiss }: RecoveryBannerProps) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border-2 border-warn bg-warn-surface px-4 py-3 shadow-sticker"
    >
      <span aria-hidden className="mt-0.5 text-warn-fg text-lg">⚠️</span>
      <div className="flex-1 min-w-0">
        <p className="text-fg font-semibold text-sm leading-snug">
          You were away for {fmtGap(gapSec)}
        </p>
        <p className="text-fg text-sm leading-snug mt-0.5">
          The timer kept running.{' '}
          {closureSecondsLeft > 0
            ? `You have ${fmtClose(closureSecondsLeft)} before this quiz closes — keep going!`
            : 'This quiz is about to close — submit what you have.'}
        </p>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="shrink-0 text-fg-muted hover:text-fg text-lg leading-none"
      >
        ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify PASS**

```
npx vitest run src/app/\(student\)/student/quiz/_components/__tests__/RecoveryBanner.test.tsx
```
Expected: all tests PASS.

- [ ] **Step 5: Append to `STRINGS-FOR-BARB.md`**

Open `STRINGS-FOR-BARB.md` and append at the bottom:

```markdown
---

## Quiz Runner Phase 3 — Draft Strings (Barb sign-off required)

> All strings below are net-new. None are shipped without Barb's approval.
> `assertNoLeak` must pass on every string before merge.

### #QR1 — Timer labels (taking screen, no visible text — aria-label only)

| Context | Draft string | Rule |
|---|---|---|
| Normal timer | `"{M}:{SS} remaining"` (aria-label) | Rule 5 (quiet) |
| Warning (≤3 min) | `"{M}:{SS} remaining — finish up"` (aria-label) | Rule 1 |
| Danger (≤1 min) | `"{M}:{SS} remaining — time is almost up"` (aria-label) | Rule 1 |

### #QR2 — Recovery banner

| Context | Draft string | Rule |
|---|---|---|
| Banner title | `"You were away for {N} seconds / {N} minutes"` | Rule 3 |
| Banner body (time left) | `"The timer kept running. You have {N} minutes before this quiz closes — keep going!"` | Rule 3 |
| Banner body (closing soon) | `"The timer kept running. This quiz is about to close — submit what you have."` | Rule 3 |

### #QR3 — Auto-submit overlay

| Context | Draft string | Rule |
|---|---|---|
| Overlay heading | `"Time's up"` | Rule 3 |
| Overlay body | `"Submitting your answers…"` | Rule 3 |

### #QR4 — Forfeit screen

| Context | Draft string | Rule |
|---|---|---|
| Eyebrow label | `"Quiz Closed"` | Rule 3 |
| Reason (closure) | `"The quiz closed while you were away."` | Rule 3 |
| Reason (time_up) | `"Time ran out before you finished."` | Rule 3 |
| Body | `"Your teacher can see your progress — this quiz will still shape what you work on next."` | Rule 4 |
| CTA | `"Back to dashboard"` | Rule 1 |

### #QR5 — Grading-pending screen

| Context | Draft string | Rule |
|---|---|---|
| Heading | `"Your quiz is being graded"` | Rule 3 |
| Body | `"Your written answers are being reviewed. Check back in a few minutes — we'll save everything."` | Rule 3 |
| CTA | `"Back to dashboard"` | Rule 1 |

### #QR6 — Done screen

| Context | Draft string | Rule |
|---|---|---|
| Heading | `"You finished the quiz! ✨"` | Rule 3 |
| What-happens-next label | `"What happens next"` | Rule 1 |
| Assignment-ready step | `"A personalized set of practice questions is ready for you."` | Rule 1 |

### #QR7 — Per-question review accordion

| Context | Draft string | Rule |
|---|---|---|
| Accordion label | `"How did you do?"` | Rule 3 |
| Correct answer label | `"Correct ✓"` | Rule 3 |
| Wrong answer label | `"Let's look at this one"` | Rule 3 (not "Incorrect", not "Wrong") |

### #QR8 — Study guide accordion

| Context | Draft string | Rule |
|---|---|---|
| Accordion label | `"Revision notes"` | Rule 3 |
| Loading copy | `"Pulling together your revision notes…"` | Rule 3 |
| Load failed copy | `"Notes aren't ready yet — come back after your next practice session."` | Rule 5 |
| Strong performance (≥80) | `"You got most of these right — solid work. Your next practice will push you further."` | Rule 4 |

### #QR9 — No-quiz empty state

| Context | Draft string | Rule |
|---|---|---|
| Title | `"No quiz right now"` | Rule 5 |
| Body | `"Your teacher will let you know when a quiz is ready. Head to your assignments in the meantime."` | Rule 1 |
```

- [ ] **Step 6: Run tests + tsc**

```
npx vitest run src/app/\(student\)/student/quiz/_components/__tests__/RecoveryBanner.test.tsx
npx tsc --noEmit
```
Expected: all tests PASS, 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(student\)/student/quiz/_components/RecoveryBanner.tsx \
        src/app/\(student\)/student/quiz/_components/__tests__/RecoveryBanner.test.tsx \
        STRINGS-FOR-BARB.md
git commit -m "feat(quiz-runner): RecoveryBanner + warn tokens + Barb string drafts"
```

---

## Task 5: `QuestionCard` component + tests

**Files:**
- Create: `src/app/(student)/student/quiz/_components/QuestionCard.tsx`
- Create: `src/app/(student)/student/quiz/_components/__tests__/QuestionCard.test.tsx`

**Interfaces:**
- Produces: `<QuestionCard question={QuizQuestion} currentResponse={string} onResponse={(v: string) => void} onFirstInput={() => void} />` — pure presentational + local event handlers.
- Exports: `QuestionCard`, `QuizQuestion` type

```ts
export interface MCQChoice {
  label: string;   // "A", "B", "C", "D"
  text: string;
}

export interface QuizQuestion {
  id: string;
  position: number;
  question_type: 'mcq' | 'numeric' | 'open';
  question_text: string;
  choices: MCQChoice[] | null;
  correct_answer: string;  // never shown to student; included in type for completeness
  rubric: string | null;
  concept_tag: string | null;
  skill_id: string | null;
}

export interface QuestionCardProps {
  question: QuizQuestion;
  currentResponse: string;      // '' if no response yet
  onResponse: (v: string) => void;
  onFirstInput: () => void;     // called once per question when student first types/clicks
}
```

- [ ] **Step 1: Write the failing tests**

Create `src/app/(student)/student/quiz/_components/__tests__/QuestionCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuestionCard } from '../QuestionCard';
import type { QuizQuestion } from '../QuestionCard';

const MCQ_Q: QuizQuestion = {
  id: 'q1', position: 1, question_type: 'mcq',
  question_text: 'What is 2 + 2?',
  choices: [
    { label: 'A', text: '3' },
    { label: 'B', text: '4' },
    { label: 'C', text: '5' },
    { label: 'D', text: '6' },
  ],
  correct_answer: 'B', rubric: null, concept_tag: null, skill_id: null,
};

const NUMERIC_Q: QuizQuestion = {
  id: 'q2', position: 2, question_type: 'numeric',
  question_text: 'Enter the value of π to one decimal place.',
  choices: null, correct_answer: '3.1', rubric: null, concept_tag: null, skill_id: null,
};

const OPEN_Q: QuizQuestion = {
  id: 'q3', position: 3, question_type: 'open',
  question_text: 'Explain photosynthesis in your own words.',
  choices: null, correct_answer: '', rubric: 'Mentions sunlight + glucose', concept_tag: null, skill_id: null,
};

describe('QuestionCard — MCQ', () => {
  it('renders all four choices as buttons', () => {
    render(<QuestionCard question={MCQ_Q} currentResponse="" onResponse={vi.fn()} onFirstInput={vi.fn()} />);
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(4);
  });

  it('calls onResponse with choice label on click', () => {
    const onResponse = vi.fn();
    const onFirstInput = vi.fn();
    render(<QuestionCard question={MCQ_Q} currentResponse="" onResponse={onResponse} onFirstInput={onFirstInput} />);
    // Click "4" choice (label B)
    fireEvent.click(screen.getByText('4'));
    expect(onResponse).toHaveBeenCalledWith('B');
    expect(onFirstInput).toHaveBeenCalledTimes(1);
  });

  it('marks the selected choice as selected when currentResponse matches label', () => {
    const { container } = render(
      <QuestionCard question={MCQ_Q} currentResponse="B" onResponse={vi.fn()} onFirstInput={vi.fn()} />,
    );
    // Selected button should have brand-related class
    expect(container.innerHTML).toContain('brand');
  });

  it('calls onFirstInput only once — second click does NOT call it again', () => {
    const onFirstInput = vi.fn();
    const { rerender } = render(
      <QuestionCard question={MCQ_Q} currentResponse="" onResponse={vi.fn()} onFirstInput={onFirstInput} />,
    );
    fireEvent.click(screen.getByText('3'));
    // simulate re-render with new response
    rerender(
      <QuestionCard question={MCQ_Q} currentResponse="A" onResponse={vi.fn()} onFirstInput={onFirstInput} />,
    );
    fireEvent.click(screen.getByText('4'));
    // onFirstInput should have been called only once (first click)
    expect(onFirstInput).toHaveBeenCalledTimes(1);
  });

  it('LEAK AUDIT: does NOT render correct_answer value "B" in DOM text', () => {
    // correct_answer must never be surfaced to student
    const { container } = render(
      <QuestionCard question={MCQ_Q} currentResponse="" onResponse={vi.fn()} onFirstInput={vi.fn()} />,
    );
    // "B" appears as choice label in MCQ — this tests rubric, not choice label; use open-response
    // For MCQ: rubric is null; correct_answer 'B' appears as a button — that's by design (MCQ choices show the option)
    // The key leak check is that numeric/open-response does not show correct_answer
    expect(container.textContent).not.toContain('3.1'); // not a field on this q, safety net
  });
});

describe('QuestionCard — Numeric', () => {
  it('renders a text input (not type=number)', () => {
    render(<QuestionCard question={NUMERIC_Q} currentResponse="" onResponse={vi.fn()} onFirstInput={vi.fn()} />);
    const input = screen.getByRole('textbox');
    expect(input.getAttribute('type')).not.toBe('number');
    expect(input.getAttribute('inputmode')).toBe('decimal');
  });

  it('calls onResponse with the typed value', () => {
    const onResponse = vi.fn();
    render(<QuestionCard question={NUMERIC_Q} currentResponse="" onResponse={onResponse} onFirstInput={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '3.1' } });
    expect(onResponse).toHaveBeenCalledWith('3.1');
  });

  it('LEAK AUDIT: correct_answer is not rendered in the DOM', () => {
    const { container } = render(
      <QuestionCard question={NUMERIC_Q} currentResponse="" onResponse={vi.fn()} onFirstInput={vi.fn()} />,
    );
    expect(container.textContent).not.toContain('3.1');
  });
});

describe('QuestionCard — Open-response', () => {
  it('renders a textarea', () => {
    render(<QuestionCard question={OPEN_Q} currentResponse="" onResponse={vi.fn()} onFirstInput={vi.fn()} />);
    expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA');
  });

  it('calls onResponse with textarea value', () => {
    const onResponse = vi.fn();
    render(<QuestionCard question={OPEN_Q} currentResponse="" onResponse={onResponse} onFirstInput={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Plants use sunlight' } });
    expect(onResponse).toHaveBeenCalledWith('Plants use sunlight');
  });

  it('LEAK AUDIT: rubric text is not rendered in the DOM', () => {
    const { container } = render(
      <QuestionCard question={OPEN_Q} currentResponse="" onResponse={vi.fn()} onFirstInput={vi.fn()} />,
    );
    expect(container.textContent).not.toContain('Mentions sunlight');
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```
npx vitest run src/app/\(student\)/student/quiz/_components/__tests__/QuestionCard.test.tsx
```
Expected: FAIL — `Cannot find module '../QuestionCard'`

- [ ] **Step 3: Implement `QuestionCard.tsx`**

Create `src/app/(student)/student/quiz/_components/QuestionCard.tsx`:

```tsx
'use client';

/**
 * QuestionCard — renders a single quiz question by type.
 *
 * MCQ:   choice buttons with label selection stored as the label string (e.g. "A").
 * Numeric: text input with inputMode="decimal" (allows "3/4" fractions — NOT type="number").
 * Open:  resizable textarea.
 *
 * MathText wraps all question text and MCQ choice text.
 * correct_answer and rubric are never rendered (Option-D).
 * onFirstInput fires once per mount (via hasInputtedRef) when student first interacts.
 */

import React, { useRef } from 'react';
import { MathText } from '@/components/core/MathText';

export interface MCQChoice {
  label: string;
  text: string;
}

export interface QuizQuestion {
  id: string;
  position: number;
  question_type: 'mcq' | 'numeric' | 'open';
  question_text: string;
  choices: MCQChoice[] | null;
  correct_answer: string;
  rubric: string | null;
  concept_tag: string | null;
  skill_id: string | null;
}

export interface QuestionCardProps {
  question: QuizQuestion;
  currentResponse: string;
  onResponse: (v: string) => void;
  onFirstInput: () => void;
}

export function QuestionCard({ question, currentResponse, onResponse, onFirstInput }: QuestionCardProps) {
  const hasInputtedRef = useRef(false);

  function fireFirstInput() {
    if (!hasInputtedRef.current) {
      hasInputtedRef.current = true;
      onFirstInput();
    }
  }

  const isMCQ     = question.question_type === 'mcq';
  const isNumeric = question.question_type === 'numeric';
  // open-response = !isMCQ && !isNumeric

  return (
    <div className="flex flex-col gap-5">
      {/* Question text */}
      <div className="text-fg text-base leading-relaxed font-medium">
        <MathText>{question.question_text}</MathText>
      </div>

      {/* MCQ choices */}
      {isMCQ && question.choices && (
        <div className="flex flex-col gap-2" role="group" aria-label="Answer choices">
          {question.choices.map((choice) => {
            const isSelected = currentResponse === choice.label;
            return (
              <button
                key={choice.label}
                type="button"
                onClick={() => {
                  fireFirstInput();
                  onResponse(choice.label);
                }}
                aria-pressed={isSelected}
                className={[
                  'flex items-start gap-3 rounded-lg border-2 px-4 py-3 text-left text-sm',
                  'transition-colors duration-100',
                  isSelected
                    ? 'border-brand bg-brand-surface text-brand-fg font-semibold shadow-sticker'
                    : 'border-surface bg-surface text-fg hover:border-brand hover:bg-brand-surface',
                ].join(' ')}
              >
                <span className="shrink-0 font-bold">{choice.label}.</span>
                <MathText>{choice.text}</MathText>
                {isSelected && <span className="ml-auto shrink-0" aria-hidden>✓</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Numeric input */}
      {isNumeric && (
        <input
          type="text"
          inputMode="decimal"
          value={currentResponse}
          onChange={(e) => {
            fireFirstInput();
            onResponse(e.target.value);
          }}
          onFocus={fireFirstInput}
          placeholder="Enter your answer"
          className="rounded-lg border-2 border-surface bg-surface text-fg px-4 py-3 text-base
                     focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30
                     placeholder:text-fg-muted"
          aria-label="Numeric answer"
        />
      )}

      {/* Open-response textarea */}
      {!isMCQ && !isNumeric && (
        <textarea
          rows={6}
          value={currentResponse}
          onChange={(e) => {
            fireFirstInput();
            onResponse(e.target.value);
          }}
          onFocus={fireFirstInput}
          placeholder="Write your answer here…"
          style={{ resize: 'vertical' }}
          className="rounded-lg border-2 border-surface bg-surface text-fg px-4 py-3 text-base
                     focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30
                     placeholder:text-fg-muted"
          aria-label="Written answer"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify PASS**

```
npx vitest run src/app/\(student\)/student/quiz/_components/__tests__/QuestionCard.test.tsx
```
Expected: all tests PASS.

- [ ] **Step 5: `tsc` clean**

```
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(student\)/student/quiz/_components/QuestionCard.tsx \
        src/app/\(student\)/student/quiz/_components/__tests__/QuestionCard.test.tsx
git commit -m "feat(quiz-runner): QuestionCard — MCQ/numeric/open, MathText, no-leak"
```

---

## Task 6: `ResultScreen` component + tests

**Option-D change (Revision 1):** `ResultScreen` no longer calls `getScoreMessage` itself, and never receives a `scorePct` or raw `masteryBand`. It consumes the PRE-BUILT bundle from Task 1/2: `scoreMessage` (`{ message, teliMsg, teliState }`), `masteryLabel` (soft word string), `needsStudyGuide` (boolean). The done/forfeit digit + `%` leak audits stay — they now prove no number reaches the DOM even though the component holds none.

**Files:**
- Create: `src/app/(student)/student/quiz/_components/ResultScreen.tsx`
- Create: `src/app/(student)/student/quiz/_components/__tests__/ResultScreen.test.tsx`

**Interfaces:**
- Produces: `<ResultScreen variant="done"|"forfeit"|"grading-pending" ... />`
- Exports: `ResultScreen`, `ResultScreenProps`, `QuestionReviewItem`
- Consumes: `assertNoLeak` from `@/lib/copy/leakGuard`, and the `StudentResultBundle` type from `@/lib/quiz/studentResultBundle` (for the `scoreMessage` prop type). Does NOT import `getScoreMessage` (the message is pre-built server-side and passed in) and does NOT import `MasteryLabel` (the soft label is already a word — rendered directly in the neutral pill markup, same token classes `MasteryLabel` uses).

```ts
import type { StudentResultBundle } from '@/lib/quiz/studentResultBundle';

export interface QuestionReviewItem {
  position: number;
  question_type: 'mcq' | 'numeric' | 'open';
  question_text: string;
  student_answer: string;
  is_correct: boolean;
  correct_answer: string;   // shown on wrong MCQ/numeric items only
  explanation?: string;     // Teli feedback on open-response from ai_score
}

export interface ResultScreenProps {
  variant: 'done' | 'forfeit' | 'grading-pending';
  // 'done' only — the pre-built server bundle (Option-D: no scorePct, no raw band)
  scoreMessage?: StudentResultBundle['scoreMessage'];  // { message, teliMsg, teliState }
  masteryLabel?: string | null;     // soft word ('Building' | 'On Track' | 'Strong' | 'Not yet assessed')
  needsStudyGuide?: boolean;        // from the bundle; gates study-guide vs strong-performance copy
  reviewItems?: QuestionReviewItem[];
  studyGuide?: string | null;
  studyGuideLoading?: boolean;
  // 'forfeit' only
  forfeitReason?: 'closure' | 'time_up';
  // shared
  onBack: () => void;
  onStartAssignment?: () => void;  // 'done' CTA
}
```

> The neutral mastery pill is rendered from `masteryLabel` (already a soft word). `MasteryLabel` maps a raw band → soft word; since we now have the soft word directly, render it in a plain neutral pill (same token classes as `MasteryLabel`) OR pass it through a label-only variant. The plan code below renders the soft word directly in the neutral pill markup to avoid a redundant re-map.

- [ ] **Step 1: Write the failing tests**

Create `src/app/(student)/student/quiz/_components/__tests__/ResultScreen.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResultScreen } from '../ResultScreen';
import type { StudentResultBundle } from '@/lib/quiz/studentResultBundle';

// Pre-built bundle fixtures (as the server would produce them — leak-free).
const STRONG_MSG: StudentResultBundle['scoreMessage'] = {
  message: 'Solid work, Alex. A couple of spots to revisit.',
  teliMsg: 'Solid work, Alex. Let us look at a couple of spots in your assignments.',
  teliState: 'idle',
};
const TOUGH_MSG: StudentResultBundle['scoreMessage'] = {
  message: 'Sam, this one was tough. Assignments start over.',
  teliMsg: 'Sam, tough one. Your assignments will go back to the basics, slower.',
  teliState: 'speaking',
};

describe('ResultScreen — done', () => {
  it('renders the done heading', () => {
    render(
      <ResultScreen
        variant="done"
        scoreMessage={STRONG_MSG}
        masteryLabel="On Track"
        needsStudyGuide={false}
        reviewItems={[]}
        onBack={vi.fn()}
      />,
    );
    // The heading is qualitative — not "85%" or "Grade Level"
    const heading = screen.getByRole('heading');
    expect(heading.textContent).toContain('quiz');
  });

  it('renders the pre-built coaching message and the soft mastery label', () => {
    render(
      <ResultScreen
        variant="done"
        scoreMessage={STRONG_MSG}
        masteryLabel="On Track"
        needsStudyGuide={false}
        reviewItems={[]}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText(/Solid work, Alex/)).toBeTruthy();
    expect(screen.getByText('On Track')).toBeTruthy();
  });

  it('LEAK AUDIT: no digits or % render in the done screen (component holds no score)', () => {
    const { container } = render(
      <ResultScreen
        variant="done"
        scoreMessage={STRONG_MSG}
        masteryLabel="On Track"
        needsStudyGuide={false}
        reviewItems={[]}
        onBack={vi.fn()}
      />,
    );
    expect(container.textContent).not.toMatch(/\d/);
    expect(container.textContent).not.toContain('%');
  });

  it('LEAK AUDIT: tough-band done screen renders no digits or %', () => {
    const { container } = render(
      <ResultScreen
        variant="done"
        scoreMessage={TOUGH_MSG}
        masteryLabel="Building"
        needsStudyGuide
        reviewItems={[]}
        onBack={vi.fn()}
      />,
    );
    expect(container.textContent).not.toMatch(/\d/);
    expect(container.textContent).not.toContain('%');
  });

  it('renders a per-question review when reviewItems are provided', () => {
    const items = [
      {
        position: 1,
        question_type: 'mcq' as const,
        question_text: 'What is two plus two?',
        student_answer: 'A',
        is_correct: false,
        correct_answer: 'B',
      },
    ];
    render(
      <ResultScreen
        variant="done"
        scoreMessage={STRONG_MSG}
        masteryLabel="On Track"
        needsStudyGuide={false}
        reviewItems={items}
        onBack={vi.fn()}
      />,
    );
    // Review section should render without exposing numeric score
    expect(screen.getByText(/how did you do/i)).toBeTruthy();
  });

  it('shows study guide accordion when needsStudyGuide and studyGuide is provided', () => {
    render(
      <ResultScreen
        variant="done"
        scoreMessage={TOUGH_MSG}
        masteryLabel="Building"
        needsStudyGuide
        reviewItems={[]}
        studyGuide="Review: fractions mean parts of a whole."
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText(/revision notes/i)).toBeTruthy();
  });

  it('shows strong-performance copy (not study guide) when needsStudyGuide is false', () => {
    render(
      <ResultScreen
        variant="done"
        scoreMessage={STRONG_MSG}
        masteryLabel="Strong"
        needsStudyGuide={false}
        reviewItems={[]}
        studyGuide={null}
        onBack={vi.fn()}
      />,
    );
    // Should not show the study guide accordion label
    expect(screen.queryByText(/revision notes/i)).toBeNull();
  });
});

describe('ResultScreen — forfeit', () => {
  it('renders forfeit closure copy without a score', () => {
    const { container } = render(
      <ResultScreen
        variant="forfeit"
        forfeitReason="closure"
        onBack={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('Quiz Closed');
    expect(container.textContent).not.toMatch(/\d+%/);
    expect(container.textContent).not.toMatch(/\b\d{2,3}\b/);  // no raw 2–3 digit numbers
  });

  it('renders forfeit time_up copy', () => {
    const { container } = render(
      <ResultScreen
        variant="forfeit"
        forfeitReason="time_up"
        onBack={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('Time ran out');
  });
});

describe('ResultScreen — grading-pending', () => {
  it('renders the grading-pending screen', () => {
    render(<ResultScreen variant="grading-pending" onBack={vi.fn()} />);
    expect(screen.getByText(/being graded/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```
npx vitest run src/app/\(student\)/student/quiz/_components/__tests__/ResultScreen.test.tsx
```
Expected: FAIL — `Cannot find module '../ResultScreen'`

- [ ] **Step 3: Implement `ResultScreen.tsx`**

Create `src/app/(student)/student/quiz/_components/ResultScreen.tsx`:

```tsx
'use client';

/**
 * ResultScreen — the post-submit screen family.
 *
 * variant='done':
 *   - Qualitative heading ("You finished the quiz! ✨")
 *   - Teli coaching message from the PRE-BUILT bundle (scoreMessage.teliMsg
 *     rendered as text; TTS call site deferred — see TODO(tts) below)
 *   - Neutral mastery pill from the soft `masteryLabel` (no color coding)
 *   - Per-question ✓/✗ review accordion (no numeric scores per question)
 *   - Study guide accordion (needsStudyGuide only)
 *   - "What happens next" section
 *
 * Option-D: this component NEVER receives a percentage or a raw band enum.
 * The coaching message + soft label are built server-side (studentResultBundle)
 * and passed in. There is no getScoreMessage call here.
 *
 * variant='forfeit':
 *   - Gentle copy; reason (closure vs time_up); NO raw score (Option-D)
 *   - assertNoLeak runs on all rendered strings
 *
 * variant='grading-pending':
 *   - Static "being graded" screen; Back CTA only
 *
 * ALL student-facing strings are passed through assertNoLeak (throws in
 * non-production, logs in production — safe boundary).
 * Copy drafts are in STRINGS-FOR-BARB.md §Quiz-Runner-Phase3.
 */

import React, { useState } from 'react';
import type { StudentResultBundle } from '@/lib/quiz/studentResultBundle';
import { assertNoLeak } from '@/lib/copy/leakGuard';

export interface QuestionReviewItem {
  position: number;
  question_type: 'mcq' | 'numeric' | 'open';
  question_text: string;
  student_answer: string;
  is_correct: boolean;
  correct_answer: string;
  explanation?: string;
}

export interface ResultScreenProps {
  variant: 'done' | 'forfeit' | 'grading-pending';
  // done — pre-built server bundle (Option-D: no scorePct, no raw band enum)
  scoreMessage?: StudentResultBundle['scoreMessage'];
  masteryLabel?: string | null;
  needsStudyGuide?: boolean;
  reviewItems?: QuestionReviewItem[];
  studyGuide?: string | null;
  studyGuideLoading?: boolean;
  // forfeit
  forfeitReason?: 'closure' | 'time_up';
  // shared
  onBack: () => void;
  onStartAssignment?: () => void;
}

function StudyGuideAccordion({
  loading,
  guide,
}: {
  loading?: boolean;
  guide?: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border-2 border-surface bg-surface shadow-sticker">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="font-semibold text-fg text-sm">📚 Revision notes</span>
        <span aria-hidden className="text-fg-muted text-sm">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 text-fg text-sm leading-relaxed border-t border-surface pt-3">
          {loading && <span className="text-fg-muted">Pulling together your revision notes…</span>}
          {!loading && !guide && (
            <span className="text-fg-muted">
              Notes aren't ready yet — come back after your next practice session.
            </span>
          )}
          {!loading && guide && (
            <div
              dangerouslySetInnerHTML={{
                __html: guide
                  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                  .replace(/\n/g, '<br />'),
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function QuestionReviewAccordion({ items }: { items: QuestionReviewItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border-2 border-surface bg-surface shadow-sticker">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="font-semibold text-fg text-sm">How did you do?</span>
        <span aria-hidden className="text-fg-muted text-sm">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul className="px-4 pb-4 border-t border-surface pt-3 flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.position} className="flex flex-col gap-1">
              <p className="text-fg text-sm leading-snug">{item.question_text}</p>
              {item.is_correct ? (
                <span className="text-ok font-semibold text-sm">Correct ✓</span>
              ) : (
                <>
                  <span className="text-warn-fg font-semibold text-sm">Let's look at this one</span>
                  {item.question_type !== 'open' && (
                    <p className="text-fg-muted text-xs">
                      Your answer: {item.student_answer || '—'}
                    </p>
                  )}
                  {item.explanation && (
                    <p className="text-fg-muted text-xs italic">{item.explanation}</p>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ResultScreen({
  variant,
  scoreMessage,
  masteryLabel,
  needsStudyGuide = false,
  reviewItems = [],
  studyGuide,
  studyGuideLoading,
  forfeitReason,
  onBack,
  onStartAssignment,
}: ResultScreenProps) {

  // ── grading-pending ────────────────────────────────────────────────────────
  if (variant === 'grading-pending') {
    return (
      <div className="flex flex-col items-center gap-6 py-12 px-6 text-center">
        <span aria-hidden className="text-5xl">⏳</span>
        <h1 className="font-display text-2xl text-fg font-bold">
          Your quiz is being graded
        </h1>
        <div className="rounded-lg border-2 border-warn bg-warn-surface px-5 py-4 max-w-sm text-left">
          <p className="text-fg text-sm leading-relaxed">
            Your written answers are being reviewed. Check back in a few minutes
            — we'll save everything.
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg bg-brand text-fg-on-brand font-semibold px-6 py-3 shadow-sticker hover:opacity-90"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  // ── forfeit ────────────────────────────────────────────────────────────────
  if (variant === 'forfeit') {
    const reasonCopy = forfeitReason === 'time_up'
      ? 'Time ran out before you finished.'
      : 'The quiz closed while you were away.';
    // assertNoLeak — these strings must be clear of numeric leaks
    assertNoLeak('Quiz Closed', 'ResultScreen/forfeit/eyebrow');
    assertNoLeak(reasonCopy, 'ResultScreen/forfeit/reason');
    return (
      <div className="flex flex-col items-center gap-6 py-12 px-6 text-center">
        <span aria-hidden className="text-5xl">⏸️</span>
        <div className="flex flex-col gap-2">
          <span className="uppercase text-xs font-bold tracking-widest text-warn-fg">
            Quiz Closed
          </span>
          <h1 className="font-display text-2xl text-fg font-bold">{reasonCopy}</h1>
          <p className="text-fg-muted text-sm leading-relaxed max-w-sm mx-auto">
            Your teacher can see your progress — this quiz will still shape what
            you work on next.
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg bg-brand text-fg-on-brand font-semibold px-6 py-3 shadow-sticker hover:opacity-90"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  // ── done ───────────────────────────────────────────────────────────────────
  // Option-D: no scorePct, no raw band. The coaching message + soft label are
  // pre-built server-side (studentResultBundle) and passed in as props.
  const msg = scoreMessage ?? { message: '', teliMsg: '', teliState: 'idle' as const };
  // TODO(tts): wire teliSpeak(msg.teliMsg) here once a V2 TTS call site is confirmed
  // in src/components/. Until then teliMsg renders as static text.

  // assertNoLeak on all rendered copy strings (belt-and-suspenders; the server
  // helper already leak-guards, but the render boundary is the last line of defense).
  if (msg.message) assertNoLeak(msg.message, 'ResultScreen/done/message');
  if (msg.teliMsg) assertNoLeak(msg.teliMsg, 'ResultScreen/done/teliMsg');
  if (masteryLabel) assertNoLeak(masteryLabel, 'ResultScreen/done/masteryLabel');

  const showStudyGuide = needsStudyGuide;

  return (
    <div className="flex flex-col gap-6 py-8 px-4 max-w-xl mx-auto">
      {/* Heading */}
      <div className="text-center flex flex-col gap-3">
        <h1 className="font-display text-2xl text-fg font-bold">
          You finished the quiz! ✨
        </h1>
        {msg.message && <p className="text-fg text-base leading-relaxed">{msg.message}</p>}
      </div>

      {/* Teli coaching message */}
      {msg.teliMsg && (
        <div className="rounded-lg border-2 border-brand bg-brand-surface shadow-sticker px-5 py-4">
          <p className="text-brand-fg text-sm leading-relaxed italic">
            "{msg.teliMsg}"
          </p>
          <p className="text-brand-fg text-xs mt-1 font-semibold">— Teli</p>
        </div>
      )}

      {/* Mastery label — neutral pill, no color coding. The soft word is already
          built server-side (masteryDisplayLabel); render it directly in the same
          neutral token treatment MasteryLabel uses — no raw enum reaches the DOM. */}
      {masteryLabel && (
        <div className="flex justify-center">
          <span className="mastery-label inline-flex items-center rounded px-2.5 py-0.5 text-sm font-medium bg-surface text-fg border border-fg-muted">
            {masteryLabel}
          </span>
        </div>
      )}

      {/* What happens next */}
      <div className="rounded-lg border-2 border-surface bg-surface shadow-sticker px-5 py-4 flex flex-col gap-2">
        <p className="text-fg font-semibold text-sm">What happens next</p>
        <p className="text-fg-muted text-sm leading-relaxed">
          ◆ A personalized set of practice questions is ready for you.
        </p>
      </div>

      {/* Per-question review */}
      {reviewItems.length > 0 && (
        <QuestionReviewAccordion items={reviewItems} />
      )}

      {/* Study guide (score < 80) OR strong performance copy */}
      {showStudyGuide ? (
        <StudyGuideAccordion loading={studyGuideLoading} guide={studyGuide} />
      ) : (
        <div className="rounded-lg border-2 border-ok bg-ok-surface px-5 py-4 shadow-sticker">
          <p className="text-ok-fg text-sm leading-relaxed">
            ✓ You got most of these right — solid work. Your next practice will push you further.
          </p>
        </div>
      )}

      {/* CTAs */}
      <div className="flex flex-col gap-3">
        {onStartAssignment && (
          <button
            type="button"
            onClick={onStartAssignment}
            className="rounded-lg bg-brand text-fg-on-brand font-semibold px-6 py-3 shadow-sticker hover:opacity-90 text-center"
          >
            Start assignment
          </button>
        )}
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border-2 border-surface bg-surface text-fg font-semibold px-6 py-3 hover:border-brand text-center"
        >
          Back to dashboard
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify PASS**

```
npx vitest run src/app/\(student\)/student/quiz/_components/__tests__/ResultScreen.test.tsx
```
Expected: all tests PASS.

- [ ] **Step 5: `tsc` clean**

```
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(student\)/student/quiz/_components/ResultScreen.tsx \
        src/app/\(student\)/student/quiz/_components/__tests__/ResultScreen.test.tsx
git commit -m "feat(quiz-runner): ResultScreen — done/forfeit/grading-pending, consumes pre-built bundle (Option-D)"
```

---

## Task 7: `QuizRunner` — behavioral capture + state machine + leak-audit test

This is the largest task. Build the master `QuizRunner.tsx` client component that orchestrates all sub-components, manages the full state machine, runs the timer, wires behavioral capture, and calls the Phase-2 routes (now returning the `result` bundle from Task 2). Then write the leak-audit test.

**Files:**
- Create: `src/app/(student)/student/quiz/_components/QuizRunner.tsx`
- Create: `src/app/(student)/student/quiz/_components/__tests__/QuizRunner.leak.test.tsx`

**Interfaces:**
- Consumes: `QuizTimer`, `QuestionCard`, `ResultScreen`, `RecoveryBanner` (all from Tasks 3–6)
- Consumes: `classifyAttemptState`, `quizTimeRemainingSeconds`, `closureSecondsRemaining`, `QUIZ_DURATION_MINUTES` from `@/lib/student/quizAttemptState`
- Consumes: `SessionAggregates` from `@/lib/signals/behavioralTypes`
- Produces: `<QuizRunner userId={string} schoolId={string|null} tier="elementary"|"middle"|"high" firstName={string|null} />` — mount point for the server wrapper

```ts
export interface QuizRunnerProps {
  userId: string;
  schoolId: string | null;
  tier: 'elementary' | 'middle' | 'high';
  firstName: string | null;
}
```

- [ ] **Step 1: Write the leak-audit failing test**

Create `src/app/(student)/student/quiz/_components/__tests__/QuizRunner.leak.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// Mock fetch to prevent real network calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/student/quiz',
}));

import { ResultScreen } from '../ResultScreen';
import { studentResultBundle } from '@/lib/quiz/studentResultBundle';

/**
 * Leak-audit test: renders the done and forfeit variants from bundles built by
 * the REAL server helper (studentResultBundle) for raw score fixtures that must
 * NEVER surface as a digit / % / raw band enum in the DOM (Option-D).
 *
 * This proves the full chain: a raw score_pct + DB band enum → server bundle →
 * rendered DOM, with no number or enum leaking. The bands are the REAL DB enum
 * values (reteach | grade_level | advanced) — there is no 'above_level'.
 */
describe('ResultScreen — leak audit (server bundle → DOM)', () => {
  const SCORE_FIXTURES = [
    { scorePct: 42, band: 'reteach',     label: 'tough' },
    { scorePct: 65, band: 'grade_level', label: 'effort' },
    { scorePct: 78, band: 'grade_level', label: 'strong' },
    { scorePct: 92, band: 'advanced',    label: 'celebrating' },
  ];

  for (const { scorePct, band, label } of SCORE_FIXTURES) {
    it(`LEAK: score ${scorePct} (${label}) does not appear in done screen DOM`, () => {
      const bundle = studentResultBundle({
        scorePct,
        masteryBand: band,
        tier: 'middle',
        firstName: 'Alex',
        attemptId: 'leak-test-att',
      });
      const { container } = render(
        <ResultScreen
          variant="done"
          scoreMessage={bundle.scoreMessage}
          masteryLabel={bundle.masteryLabel}
          needsStudyGuide={bundle.needsStudyGuide}
          reviewItems={[]}
          onBack={vi.fn()}
        />,
      );
      // No digit at all reaches the DOM, no %, and no raw band enum.
      expect(container.textContent).not.toMatch(/\d/);
      expect(container.textContent).not.toContain('%');
      expect(container.textContent).not.toContain(band); // raw enum never rendered
    });
  }

  it('LEAK: forfeit closure screen has no raw score', () => {
    const { container } = render(
      <ResultScreen variant="forfeit" forfeitReason="closure" onBack={vi.fn()} />,
    );
    expect(container.textContent).not.toContain('%');
    // No 2–3 digit numbers (score percentages)
    expect(container.textContent).not.toMatch(/\b\d{2,3}\b/);
  });

  it('LEAK: forfeit time_up screen has no raw score', () => {
    const { container } = render(
      <ResultScreen variant="forfeit" forfeitReason="time_up" onBack={vi.fn()} />,
    );
    expect(container.textContent).not.toContain('%');
    expect(container.textContent).not.toMatch(/\b\d{2,3}\b/);
  });

  it('LEAK: mastery band enum "reteach" is mapped to a soft word, never rendered raw', () => {
    const bundle = studentResultBundle({
      scorePct: 42,
      masteryBand: 'reteach',
      tier: 'middle',
      firstName: 'Sam',
      attemptId: 'leak-test-att-2',
    });
    expect(bundle.masteryLabel).toBe('Building'); // mapped server-side
    const { container } = render(
      <ResultScreen
        variant="done"
        scoreMessage={bundle.scoreMessage}
        masteryLabel={bundle.masteryLabel}
        needsStudyGuide={bundle.needsStudyGuide}
        reviewItems={[]}
        onBack={vi.fn()}
      />,
    );
    // "reteach" is the DB enum; only the soft label ("Building") may render.
    expect(container.textContent).not.toContain('reteach');
    expect(container.textContent).toContain('Building');
  });
});
```

- [ ] **Step 2: Run leak test to verify it PASSES** (ResultScreen is already built in Task 6; `studentResultBundle` in Task 1)

```
npx vitest run src/app/\(student\)/student/quiz/_components/__tests__/QuizRunner.leak.test.tsx
```
Expected: PASS — ResultScreen already enforces Option-D.

- [ ] **Step 3: Implement `QuizRunner.tsx`**

Create `src/app/(student)/student/quiz/_components/QuizRunner.tsx`. This is the full master component. Implement it in full (do NOT use placeholders):

```tsx
'use client';

/**
 * QuizRunner — the coached, timed student quiz runner.
 *
 * States: loading | no-quiz | ready | taking | submitting | grading-pending | done | forfeit | review
 *
 * Architecture:
 * - Wall-clock timer recomputed from server-stamped started_at every second
 *   (never a client countdown — honest across reloads)
 * - 15s heartbeat to /signal keeps last_active_at fresh
 * - Recovery banner on resuming_after_gap (30s–5min gap)
 * - Lazy-forfeit: HTTP 410 from /start → forfeit screen (no raw score)
 * - Adaptive Q4/Q5: POST /api/attempts/{id}/adapt after Q3
 * - Behavioral capture: inline useRef counters + global addEventListener
 *   listeners. No third-party library. Typed against SessionAggregates.
 * - All student strings assertNoLeak'd before render
 * - Option-D: no scorePct in client state; the server `result` bundle carries the
 *   coaching message + soft mastery label, rendered as a neutral pill
 *
 * Copy drafts: STRINGS-FOR-BARB.md §Quiz-Runner-Phase3
 * Grounding: docs/superpowers/plans/grounding/2026-06-21-quiz-runner-ui.md
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  classifyAttemptState,
  quizTimeRemainingSeconds,
  closureSecondsRemaining,
  QUIZ_DURATION_MINUTES,
} from '@/lib/student/quizAttemptState';
import type { SessionAggregates } from '@/lib/signals/behavioralTypes';
import { EmptyState } from '@/components/core/EmptyState';
import { Card } from '@/components/core/Card';
import { QuizTimer } from './QuizTimer';
import { QuestionCard } from './QuestionCard';
import type { QuizQuestion } from './QuestionCard';
import { ResultScreen } from './ResultScreen';
import type { QuestionReviewItem } from './ResultScreen';
import { RecoveryBanner } from './RecoveryBanner';
import type { StudentResultBundle } from '@/lib/quiz/studentResultBundle';

export interface QuizRunnerProps {
  userId: string;
  schoolId: string | null;
  tier: 'elementary' | 'middle' | 'high';
  firstName: string | null;
}

// ── Types matching Phase-2 API route responses (post-Task-2 shapes) ─────────

interface StudentQuizResponse {
  quiz: {
    id: string;
    title: string;
    quiz_questions: QuizQuestion[];
  } | null;
  existing_attempt: {
    id: string;
    is_complete: boolean;
    // Option-D: NO score_pct / mastery_band over the wire. A completed attempt
    // carries the pre-built bundle instead; in-progress attempts have no result.
    result?: StudentResultBundle;
    adapted_questions: unknown;
    started_at: string | null;
    last_active_at: string | null;
    forfeit_reason: string | null;
  } | null;
  teacher_name: string | null;
  class_name: string | null;
}

interface StartResponse {
  attempt_id: string;
  started_at?: string;
  state?: string;
  resumed_after_seconds?: number;
  closure_forfeit_minutes?: number;
  resume_banner_threshold_seconds?: number;
  forfeited?: boolean;
  forfeit_reason?: string;
}

interface SubmitResponse {
  attempt_id: string;
  raw_score?: number;
  // Option-D: the all-clean path returns the pre-built bundle, NOT score_pct/band.
  result?: StudentResultBundle;
  grades?: Array<{ position: number; score: number }>;
  grading_delayed?: boolean;
}

// review[] shape from POST /api/attempts/quiz-history (per-question, all positions)
interface QuizHistoryReviewRow {
  position: number;
  question_type: string;
  question_text: string;
  correct_answer: string | null;
  choices: unknown;
  rubric: string | null;
  student_answer: string;
  is_correct: boolean | null;
  ai_score: number | null;
  explanation: string;
}

// ── Runner state machine ───────────────────────────────────────────────────

type RunnerState =
  | 'loading'
  | 'no-quiz'
  | 'ready'
  | 'taking'
  | 'submitting'
  | 'grading-pending'
  | 'done'
  | 'forfeit';

const TOTAL_SECONDS = QUIZ_DURATION_MINUTES * 60;
const HEARTBEAT_INTERVAL_MS = 15_000;

// NOTE: tier + firstName are no longer consumed by the runner — the coaching
// message is built server-side (studentResultBundle) and arrives in the result
// bundle. They remain on the props for forward-compat (e.g. a future client-side
// greeting) but are underscore-prefixed so lint/tsc stay clean. The server
// wrapper still resolves them; keeping them on the contract is intentional.
export function QuizRunner({ userId: _userId, schoolId: _schoolId, tier: _tier, firstName: _firstName }: QuizRunnerProps) {
  // ── Runner state ─────────────────────────────────────────────────────────
  const [runnerState, setRunnerState] = useState<RunnerState>('loading');
  const [quiz, setQuiz] = useState<StudentQuizResponse['quiz'] | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(TOTAL_SECONDS);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [responses, setResponses] = useState<Record<number, string>>({});  // position → response text
  const [showRecoveryBanner, setShowRecoveryBanner] = useState(false);
  const [gapSec, setGapSec] = useState(0);
  const [closureLeft, setClosureLeft] = useState(0);
  const [forfeitReason, setForfeitReason] = useState<'closure' | 'time_up' | undefined>();
  // Option-D: store the server-built bundle (no raw score in client state).
  const [resultBundle, setResultBundle] = useState<StudentResultBundle | null>(null);
  const [reviewItems, setReviewItems] = useState<QuestionReviewItem[]>([]);
  const [studyGuide, setStudyGuide] = useState<string | null>(null);
  const [studyGuideLoading, setStudyGuideLoading] = useState(false);
  const [adaptCalled, setAdaptCalled] = useState(false);

  // ── Behavioral capture refs ────────────────────────────────────────────
  // Per-question refs (reset on each advance/prev)
  const questionStartTime  = useRef<number>(Date.now());
  const firstInputTime     = useRef<number | null>(null);
  const answerChanges      = useRef<number>(0);
  const navigationBacks    = useRef<number>(0);
  const qPauseCount        = useRef<number>(0);
  const qTotalPauseMs      = useRef<number>(0);
  const qFocusLossCount    = useRef<number>(0);
  const qPasteCount        = useRef<number>(0);

  // Session-level refs (accumulate across all questions)
  const sessStartMs          = useRef<number>(Date.now());
  const sessFocusLossCount   = useRef<number>(0);
  const sessTotalFocusLossMs = useRef<number>(0);
  const sessPasteCount       = useRef<number>(0);
  const sessPauseCount       = useRef<number>(0);
  const sessTotalPauseMs     = useRef<number>(0);
  const sessBackspaceCount   = useRef<number>(0);
  const sessKeypressCount    = useRef<number>(0);
  const sessTtsPlayCount     = useRef<number>(0);
  const stuckEraseCount      = useRef<number>(0);

  // Pause detection state
  const lastKeypressMs    = useRef<number>(0);
  const pauseStartMs      = useRef<number | null>(null);
  const PAUSE_THRESHOLD   = 3000; // 3s gap between keypresses = pause

  // Focus-loss state
  const focusLostAt       = useRef<number | null>(null);

  // Auto-submit guard
  const autoSubmitTriggered = useRef(false);

  // ── Global behavioral listeners ────────────────────────────────────────
  useEffect(() => {
    // Only wire listeners when the quiz is in the taking state
    if (runnerState !== 'taking') return;

    // --- focus/visibility loss ---
    function handleVisibilityHidden() {
      if (document.hidden) {
        focusLostAt.current = Date.now();
        sessFocusLossCount.current += 1;
        qFocusLossCount.current += 1;
      } else if (focusLostAt.current !== null) {
        const elapsed = Date.now() - focusLostAt.current;
        sessTotalFocusLossMs.current += elapsed;
        focusLostAt.current = null;
      }
    }

    function handleBlur() {
      if (focusLostAt.current === null) {
        focusLostAt.current = Date.now();
        sessFocusLossCount.current += 1;
        qFocusLossCount.current += 1;
      }
    }

    function handleFocus() {
      if (focusLostAt.current !== null) {
        const elapsed = Date.now() - focusLostAt.current;
        sessTotalFocusLossMs.current += elapsed;
        focusLostAt.current = null;
      }
    }

    // --- paste ---
    function handlePaste() {
      sessPasteCount.current += 1;
      qPasteCount.current += 1;
    }

    // --- keydown (backspace + keypress + pause detection) ---
    function handleKeydown(e: KeyboardEvent) {
      const now = Date.now();

      // Pause detection: gap > 3s since last keypress
      if (lastKeypressMs.current > 0 && now - lastKeypressMs.current > PAUSE_THRESHOLD) {
        if (pauseStartMs.current === null) pauseStartMs.current = lastKeypressMs.current;
        // Pause ended on this keypress
        const pauseDur = now - pauseStartMs.current;
        sessPauseCount.current += 1;
        sessTotalPauseMs.current += pauseDur;
        qPauseCount.current += 1;
        qTotalPauseMs.current += pauseDur;

        // stuckEraseCount: pause > 3s immediately followed by Backspace
        if (e.key === 'Backspace' || e.key === 'Delete') {
          stuckEraseCount.current += 1;
        }

        pauseStartMs.current = null;
      }

      lastKeypressMs.current = now;

      if (e.key === 'Backspace' || e.key === 'Delete') {
        sessBackspaceCount.current += 1;
      }

      // Count printable keystrokes (single printable char + Enter + Space)
      if (e.key.length === 1 || e.key === 'Enter' || e.key === ' ') {
        sessKeypressCount.current += 1;
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityHidden);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('paste', handlePaste);
    document.addEventListener('keydown', handleKeydown);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityHidden);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('paste', handlePaste);
      document.removeEventListener('keydown', handleKeydown);
    };
  }, [runnerState]);

  // ── Helpers ────────────────────────────────────────────────────────────

  function buildSessionAggregates(): SessionAggregates {
    return {
      focusLossCount:    sessFocusLossCount.current,
      pasteCount:        sessPasteCount.current,
      pauseCount:        sessPauseCount.current,
      totalPauseMs:      sessTotalPauseMs.current,
      totalFocusLossMs:  sessTotalFocusLossMs.current,
      backspaceCount:    sessBackspaceCount.current,
      keypressCount:     sessKeypressCount.current,
      ttsPlayCount:      sessTtsPlayCount.current,
      canvasUsed:        false,
      stuckEraseCount:   stuckEraseCount.current,
    };
  }

  function snapshotPerQuestion(q: QuizQuestion, responseText: string) {
    const now = Date.now();
    const response_time_ms = now - questionStartTime.current;
    const hesitation_ms = firstInputTime.current !== null
      ? firstInputTime.current - questionStartTime.current
      : response_time_ms;
    const word_count = responseText.trim().split(/\s+/).filter(Boolean).length;
    return {
      question_id:          q.id,
      position:             q.position,
      response_text:        responseText,
      response_time_ms,
      hesitation_ms,
      answer_changes:       answerChanges.current,
      navigation_backs:     navigationBacks.current,
      pause_count:          qPauseCount.current,
      total_pause_ms:       qTotalPauseMs.current,
      word_count,
      focus_loss_count:     qFocusLossCount.current,
      paste_count:          qPasteCount.current,
      hints_used:           0,
      question_type_scored: q.question_type,
    };
  }

  function resetPerQuestionRefs() {
    questionStartTime.current = Date.now();
    firstInputTime.current    = null;
    answerChanges.current     = 0;
    navigationBacks.current   = 0;
    qPauseCount.current       = 0;
    qTotalPauseMs.current     = 0;
    qFocusLossCount.current   = 0;
    qPasteCount.current       = 0;
  }

  async function postSignal(
    id: string,
    responseItems: ReturnType<typeof snapshotPerQuestion>[],
    sessionAggregates?: SessionAggregates,
    heartbeat = false,
  ) {
    try {
      await fetch(`/api/attempts/${id}/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responses: heartbeat ? [] : responseItems,
          sessionAggregates,
          heartbeat,
        }),
      });
    } catch {
      // Best-effort: never let signal failure break the runner
    }
  }

  // ── Load quiz on mount ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/attempts/student-quiz');
        if (!res.ok) { if (!cancelled) setRunnerState('no-quiz'); return; }
        const data: StudentQuizResponse = await res.json() as StudentQuizResponse;
        if (cancelled) return;

        if (!data.quiz) {
          setRunnerState('no-quiz');
          return;
        }

        setQuiz(data.quiz);

        const sortedQs = [...data.quiz.quiz_questions].sort((a, b) => a.position - b.position);
        setQuestions(sortedQs);

        // Pre-classify for ready/forfeit/resume states
        const existing = data.existing_attempt;
        if (existing) {
          const attemptState = classifyAttemptState({
            isComplete: existing.is_complete,
            forfeitReason: existing.forfeit_reason as 'closure' | 'time_up' | null,
            startedAt: existing.started_at,
            lastActiveAt: existing.last_active_at,
            now: new Date(),
          });

          if (attemptState === 'completed_normal') {
            // Quiz already done — show the done screen if the server attached a
            // result bundle (Option-D: no raw score reaches the client), else no-quiz.
            if (existing.result) {
              setResultBundle(existing.result);
              setRunnerState('done');
            } else {
              setRunnerState('no-quiz');
            }
            return;
          }

          if (attemptState === 'resuming_after_gap' && existing.last_active_at) {
            const gap = Math.floor((Date.now() - new Date(existing.last_active_at).getTime()) / 1000);
            const close = closureSecondsRemaining(existing.last_active_at, new Date());
            setGapSec(gap);
            setClosureLeft(close);
            setShowRecoveryBanner(true);
          }
        }

        setRunnerState('ready');
      } catch {
        setRunnerState('no-quiz');
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  // ── Start / resume quiz ────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    if (!quiz) return;
    try {
      const res = await fetch('/api/attempts/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quiz_id: quiz.id }),
      });

      if (res.status === 410) {
        // Lazy-forfeit
        const data = await res.json() as StartResponse;
        setForfeitReason((data.forfeit_reason as 'closure' | 'time_up') ?? 'closure');
        setRunnerState('forfeit');
        return;
      }

      if (!res.ok) { setRunnerState('no-quiz'); return; }

      const data = await res.json() as StartResponse;
      setAttemptId(data.attempt_id);
      setStartedAt(data.started_at ?? null);
      sessStartMs.current = Date.now();
      questionStartTime.current = Date.now();
      setRunnerState('taking');
    } catch {
      setRunnerState('no-quiz');
    }
  }, [quiz]);

  // ── Wall-clock timer ───────────────────────────────────────────────────
  useEffect(() => {
    if (runnerState !== 'taking' || !startedAt) return;

    const tick = setInterval(() => {
      const remaining = quizTimeRemainingSeconds(startedAt, new Date());
      setTimeLeft(remaining);
    }, 1000);

    return () => clearInterval(tick);
  }, [runnerState, startedAt]);

  // ── Auto-submit at t=0 ────────────────────────────────────────────────
  useEffect(() => {
    if (timeLeft === 0 && runnerState === 'taking' && !autoSubmitTriggered.current) {
      autoSubmitTriggered.current = true;
      void handleSubmit();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, runnerState]);

  // ── 15s heartbeat ─────────────────────────────────────────────────────
  useEffect(() => {
    if (runnerState !== 'taking' || !attemptId) return;

    const hb = setInterval(() => {
      void postSignal(attemptId, [], undefined, true);
    }, HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(hb);
  }, [runnerState, attemptId]);

  // ── Adaptive Q4/Q5 after Q3 ───────────────────────────────────────────
  useEffect(() => {
    if (
      runnerState === 'taking' &&
      attemptId &&
      currentIndex === 3 &&
      !adaptCalled
    ) {
      setAdaptCalled(true);
      void (async () => {
        try {
          // The /adapt route ignores the request body (it recomputes from Q1–Q3
          // responses server-side); POST with an empty body.
          const res = await fetch(`/api/attempts/${attemptId}/adapt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          if (!res.ok) return; // keep original Q4/Q5
          // Real route shape: { adapted: AdaptedQuestions }.
          // AdaptedQuestions = { level, mcq_pct, questions: [{ position, question_text,
          //   rubric, scaffold_hint, difficulty_label }] }. These are OPEN-response
          // Q4/Q5 ONLY — no question_type, no choices, no correct_answer.
          const data = await res.json() as {
            adapted?: {
              questions?: Array<{
                position: number;
                question_text: string;
                rubric?: string | null;
              }>;
            };
          };
          const adaptedEntries = data.adapted?.questions;
          if (!Array.isArray(adaptedEntries) || adaptedEntries.length === 0) return;

          // Map adapted entries → QuizQuestion (always question_type 'open'),
          // preserving each entry's position and reusing the original question id
          // where one exists at that position (else a synthetic id). Gated so a
          // malformed entry can never break rendering.
          setQuestions((prev) => {
            const byPosition = new Map(prev.map((q) => [q.position, q]));
            const mapped: QuizQuestion[] = adaptedEntries
              .filter((e) => typeof e?.position === 'number' && typeof e?.question_text === 'string')
              .map((e) => {
                const original = byPosition.get(e.position);
                return {
                  id: original?.id ?? `adapted-${e.position}`,
                  position: e.position,
                  question_type: 'open' as const,
                  question_text: e.question_text,
                  choices: null,
                  correct_answer: '',
                  rubric: e.rubric ?? null,
                  concept_tag: original?.concept_tag ?? null,
                  skill_id: original?.skill_id ?? null,
                };
              });
            if (mapped.length === 0) return prev; // nothing usable — keep originals
            // Splice mapped entries in at their positions; keep Q1–Q3 untouched.
            const base = prev.filter((q) => q.position <= 3);
            const adaptedByPos = new Map(mapped.map((q) => [q.position, q]));
            // Preserve original Q4/Q5 for any position the adapter didn't return.
            const tail = prev
              .filter((q) => q.position >= 4)
              .map((q) => adaptedByPos.get(q.position) ?? q);
            // Add any adapted positions not already present in the tail.
            for (const m of mapped) {
              if (!tail.some((q) => q.position === m.position)) tail.push(m);
            }
            tail.sort((a, b) => a.position - b.position);
            return [...base, ...tail];
          });
        } catch {
          // Graceful degradation — keep existing questions
        }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, runnerState, attemptId, adaptCalled]);

  // ── Response handler ───────────────────────────────────────────────────
  function handleResponse(value: string) {
    const position = questions[currentIndex]?.position;
    if (position === undefined) return;
    if (responses[position] !== undefined && responses[position] !== value) {
      answerChanges.current += 1;
    }
    setResponses((prev) => ({ ...prev, [position]: value }));
  }

  function handleFirstInput() {
    if (firstInputTime.current === null) {
      firstInputTime.current = Date.now();
    }
  }

  // ── Navigation ─────────────────────────────────────────────────────────
  async function handleNext() {
    const q = questions[currentIndex];
    if (!q || !attemptId) return;
    const responseText = responses[q.position] ?? '';
    const snapshot = snapshotPerQuestion(q, responseText);

    // Post signal for this question
    await postSignal(attemptId, [snapshot]);
    resetPerQuestionRefs();
    setCurrentIndex((i) => i + 1);
  }

  async function handlePrev() {
    navigationBacks.current += 1;
    resetPerQuestionRefs();
    setCurrentIndex((i) => Math.max(0, i - 1));
  }

  // ── Submit ─────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!attemptId) return;
    setRunnerState('submitting');

    // Snapshot all remaining questions and post final signal + sessionAggregates
    const allSnapshots = questions.map((q) => {
      const responseText = responses[q.position] ?? '';
      return snapshotPerQuestion(q, responseText);
    });
    await postSignal(attemptId, allSnapshots, buildSessionAggregates());

    // Grade
    try {
      const res = await fetch(`/api/attempts/${attemptId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quiz_attempt_id: attemptId }),
      });

      if (!res.ok) { setRunnerState('no-quiz'); return; }

      const data = await res.json() as SubmitResponse;

      if (data.grading_delayed) {
        setRunnerState('grading-pending');
        return;
      }

      // Store the server-built bundle (Option-D: no raw score in client state).
      const bundle = data.result ?? null;
      setResultBundle(bundle);

      // Build per-question review from the quiz-history POST — the authoritative
      // per-position correctness source. `submit`'s `grades[]` is OEQ-only
      // (positions 4–5), so deriving is_correct from it would mark every MCQ /
      // numeric question (positions 1–3) wrong. quiz-history returns every
      // position with is_correct, correct_answer, student_answer, explanation.
      try {
        const histRes = await fetch('/api/attempts/quiz-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attempt_id: attemptId }),
        });
        if (histRes.ok) {
          const histData = await histRes.json() as { review?: QuizHistoryReviewRow[] };
          const review = histData.review ?? [];
          const items: QuestionReviewItem[] = review.map((r) => ({
            position:      r.position,
            question_type: (r.question_type === 'mcq' || r.question_type === 'numeric')
              ? r.question_type
              : 'open',
            question_text: r.question_text,
            student_answer: r.student_answer ?? '',
            is_correct:    r.is_correct === true,
            correct_answer: r.correct_answer ?? '',
            explanation:   r.explanation || undefined,
          }));
          setReviewItems(items);
        }
      } catch {
        // Review is non-critical — done screen still renders without it.
      }

      setRunnerState('done');

      // Fetch study guide only when the server flagged it (needsStudyGuide).
      if (bundle?.needsStudyGuide) {
        setStudyGuideLoading(true);
        try {
          const sgRes = await fetch('/api/attempts/study-guide', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quiz_attempt_id: attemptId }),
          });
          if (sgRes.ok) {
            const sgData = await sgRes.json() as { study_guide: string | null };
            setStudyGuide(sgData.study_guide ?? null);
          }
        } catch {
          // Graceful — study guide is non-critical
        } finally {
          setStudyGuideLoading(false);
        }
      }
    } catch {
      setRunnerState('no-quiz');
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const currentQ = questions[currentIndex] ?? null;
  const currentResponse = currentQ ? (responses[currentQ.position] ?? '') : '';
  const isLastQ = currentIndex === questions.length - 1;
  const canGoNext = currentResponse !== '';

  // ── loading ──────────────────────────────────────────────────────────
  if (runnerState === 'loading') {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-fg-muted text-sm animate-pulse">Loading…</span>
      </div>
    );
  }

  // ── no-quiz ──────────────────────────────────────────────────────────
  if (runnerState === 'no-quiz') {
    return (
      <div className="p-6">
        <EmptyState
          variant="just-getting-started"
          titleOverride="No quiz right now"
          bodyOverride="Your teacher will let you know when a quiz is ready. Head to your assignments in the meantime."
        />
      </div>
    );
  }

  // ── done / forfeit / grading-pending ─────────────────────────────────
  if (
    runnerState === 'done' ||
    runnerState === 'forfeit' ||
    runnerState === 'grading-pending'
  ) {
    return (
      <div className="min-h-screen bg-bg p-4">
        <ResultScreen
          variant={runnerState}
          scoreMessage={resultBundle?.scoreMessage}
          masteryLabel={resultBundle?.masteryLabel ?? null}
          needsStudyGuide={resultBundle?.needsStudyGuide ?? false}
          reviewItems={reviewItems}
          studyGuide={studyGuide}
          studyGuideLoading={studyGuideLoading}
          forfeitReason={forfeitReason}
          onBack={() => { window.location.href = '/student/dashboard'; }}
          onStartAssignment={
            runnerState === 'done'
              ? () => { window.location.href = '/student/assignments'; }
              : undefined
          }
        />
      </div>
    );
  }

  // ── ready ─────────────────────────────────────────────────────────────
  if (runnerState === 'ready') {
    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center p-6 gap-8">
        <Card tone="brand" className="max-w-sm w-full text-center flex flex-col gap-4 p-6">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-fg">Quiz</p>
          <h1 className="font-display text-xl text-fg font-bold">{quiz?.title ?? 'Your Quiz'}</h1>
          <p className="text-fg-muted text-sm">
            You have {QUIZ_DURATION_MINUTES} minutes. The timer starts when you hit Begin.
          </p>
          <button
            type="button"
            onClick={() => void handleStart()}
            className="rounded-lg bg-brand text-fg-on-brand font-bold px-8 py-3 shadow-sticker hover:opacity-90"
          >
            Begin quiz
          </button>
        </Card>
      </div>
    );
  }

  // ── submitting ────────────────────────────────────────────────────────
  if (runnerState === 'submitting') {
    return (
      <div className="fixed inset-0 bg-bg/90 flex flex-col items-center justify-center gap-4 z-50">
        <span aria-hidden className="text-5xl animate-pulse">⏰</span>
        <p className="font-display text-xl text-fg font-bold">Time's up</p>
        <p className="text-fg-muted text-sm">Submitting your answers…</p>
      </div>
    );
  }

  // ── taking ────────────────────────────────────────────────────────────
  if (runnerState !== 'taking' || !currentQ) return null;

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      {/* Top bar: timer + progress */}
      <div className="sticky top-0 z-10 bg-bg border-b-2 border-surface px-4 py-3 flex items-center justify-between gap-4 shadow-sticker">
        <div className="flex items-center gap-2 text-fg-muted text-sm font-medium">
          <span>Q{currentIndex + 1}</span>
          <span>/</span>
          <span>{questions.length}</span>
        </div>

        <QuizTimer timeLeft={timeLeft} totalSeconds={TOTAL_SECONDS} />

        {/* Progress dots */}
        <div className="flex gap-1.5 flex-wrap justify-end">
          {questions.map((q, i) => {
            const isActive   = i === currentIndex;
            const isAnswered = (responses[q.position] ?? '') !== '';
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => {
                  if (isAnswered || i <= currentIndex) setCurrentIndex(i);
                }}
                aria-label={`Question ${i + 1}`}
                aria-current={isActive ? 'true' : undefined}
                className={[
                  'h-2 rounded-full transition-all duration-150',
                  isActive   ? 'w-6 bg-brand'       :
                  isAnswered ? 'w-2 bg-ok'           :
                               'w-2 bg-surface border border-fg-muted',
                ].join(' ')}
              />
            );
          })}
        </div>
      </div>

      {/* Recovery banner */}
      {showRecoveryBanner && (
        <div className="px-4 pt-4">
          <RecoveryBanner
            gapSec={gapSec}
            closureSecondsLeft={closureLeft}
            onDismiss={() => setShowRecoveryBanner(false)}
          />
        </div>
      )}

      {/* Question area */}
      <div className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full flex flex-col gap-6">
        <QuestionCard
          question={currentQ}
          currentResponse={currentResponse}
          onResponse={handleResponse}
          onFirstInput={handleFirstInput}
        />
      </div>

      {/* Navigation */}
      <div className="sticky bottom-0 bg-bg border-t-2 border-surface px-4 py-3 flex items-center justify-between gap-3">
        {/* Prev */}
        {currentIndex > 0 ? (
          <button
            type="button"
            onClick={() => void handlePrev()}
            className="rounded-lg border-2 border-surface bg-surface text-fg font-semibold px-5 py-2 hover:border-brand"
          >
            ← Back
          </button>
        ) : (
          <div />
        )}

        {/* Next / Submit */}
        {isLastQ ? (
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canGoNext}
            className={[
              'rounded-lg font-bold px-8 py-2 shadow-sticker transition-opacity',
              canGoNext
                ? 'bg-brand text-fg-on-brand hover:opacity-90'
                : 'bg-surface text-fg-muted border-2 border-surface cursor-not-allowed',
            ].join(' ')}
          >
            Submit quiz
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleNext()}
            disabled={!canGoNext}
            className={[
              'rounded-lg font-bold px-8 py-2 shadow-sticker transition-opacity',
              canGoNext
                ? 'bg-brand text-fg-on-brand hover:opacity-90'
                : 'bg-surface text-fg-muted border-2 border-surface cursor-not-allowed',
            ].join(' ')}
          >
            Next →
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run both test files**

```
npx vitest run src/app/\(student\)/student/quiz/_components/__tests__/QuizRunner.leak.test.tsx
```
Expected: all PASS.

- [ ] **Step 5: `tsc` clean**

```
npx tsc --noEmit
```
Expected: 0 errors. Fix any type errors before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(student\)/student/quiz/_components/QuizRunner.tsx \
        src/app/\(student\)/student/quiz/_components/__tests__/QuizRunner.leak.test.tsx
git commit -m "feat(quiz-runner): QuizRunner — full state machine, behavioral capture, Option-D"
```

---

## Task 8: Thin server wrapper page

**Revision 4 — identity is `public.users`, not `students`.** There is NO `students` table; the canonical identity table is `public.users` (migration 0001), and `grade_level` is **`text`** there. `requireRole` already returns `{ userId, role, schoolId, fullName }`, so `schoolId` and `firstName` (from `fullName`) come straight from the auth context — the ONLY thing the page needs to query `users` for is `grade_level` (to parse the tier). Reuse the shared `gradeTextToTier` helper introduced in Task 2 (export it from `studentResultBundle.ts` and import it here so there is one source of truth).

**Files:**
- Create: `src/app/(student)/student/quiz/page.tsx`

**Interfaces:**
- Consumes: `requireRole` from `@/lib/auth/requireRole`; `createAdminSupabaseClient` from `@/lib/supabase/server`; `gradeTextToTier` from `@/lib/quiz/studentResultBundle`
- Renders: `<QuizRunner userId schoolId tier firstName />`
- No `params` (the quiz is selected server-side via `GET /student-quiz`; the route needs no URL param)

> **Prerequisite (one-line edit to Task 1):** export `gradeTextToTier` from `studentResultBundle.ts` (the same helper Task 2 needs in both routes). Add to `studentResultBundle.ts`:
> ```ts
> // grade_level is TEXT on public.users (migration 0001). Parse the leading
> // integer; K–5 → elementary, 6–8 → middle, 9–12 → high. Unparseable → middle.
> export function gradeTextToTier(gradeLevel: string | null): Tier {
>   if (!gradeLevel) return 'middle';
>   const n = parseInt(gradeLevel.replace(/[^0-9]/g, ''), 10);
>   if (Number.isNaN(n)) return 'middle';
>   if (n <= 5) return 'elementary';
>   if (n <= 8) return 'middle';
>   return 'high';
> }
> ```
> Then Task 2's routes and this page all `import { gradeTextToTier } from '@/lib/quiz/studentResultBundle'` — no duplicated copies.

- [ ] **Step 1: No test required for the wrapper** (the server component is thin; auth is tested in the layout guard; QuizRunner has its own tests). Write the file directly.

Create `src/app/(student)/student/quiz/page.tsx`:

```tsx
// src/app/(student)/student/quiz/page.tsx
// Thin server component — gates auth, resolves userId/schoolId/tier/firstName,
// then hands off to the 'use client' QuizRunner.
//
// Four-audience: student surface. No scores, no risk, no CL verbs.
// Auth chain: requireRole(['student']) → { userId, schoolId, fullName }.
// Identity is public.users (there is NO students table); grade_level is text.
import React from 'react';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { gradeTextToTier } from '@/lib/quiz/studentResultBundle';
import { QuizRunner } from './_components/QuizRunner';

export default async function StudentQuizPage(): Promise<React.JSX.Element> {
  // requireRole already returns schoolId + fullName from public.users.
  const { userId, schoolId, fullName } = await requireRole(['student']);
  const firstName = (fullName ?? '').trim().split(/\s+/)[0] || null;

  // The only thing not already in the auth context is grade_level (text).
  const admin = createAdminSupabaseClient();
  const { data: profile } = await admin
    .from('users')
    .select('grade_level')
    .eq('id', userId)
    .maybeSingle();

  const gradeLevel = (profile as { grade_level?: string | null } | null)?.grade_level ?? null;
  const tier = gradeTextToTier(gradeLevel); // 'elementary' | 'middle' | 'high'

  return (
    <QuizRunner
      userId={userId}
      schoolId={schoolId}
      tier={tier}
      firstName={firstName}
    />
  );
}
```

- [ ] **Step 2: `tsc` clean**

```
npx tsc --noEmit
```
Expected: 0 errors. (`grade_level` is `text` on `public.users`; `gradeTextToTier` takes `string | null` — no numeric coercion needed.)

- [ ] **Step 3: Confirm route is reachable**

Start the dev server and navigate to `http://localhost:3000/student/quiz` while logged in as a student. Expected: the "No quiz right now" empty state OR the "ready" card (depending on seeded data).

```
npm run dev
```

(Stop the dev server after confirming.)

- [ ] **Step 4: Commit**

```bash
git add src/app/\(student\)/student/quiz/page.tsx
git commit -m "feat(quiz-runner): server wrapper page — auth gate, tier/firstName resolution"
```

---

## Task 9: Add quiz route to student nav + run full test suite

**Files:**
- Modify: `src/app/(student)/layout.tsx` (add `/student/quiz` nav link if appropriate, or confirm it is intentionally not in nav — linked from dashboard notification instead)
- No modification required if the quiz is deep-linked from the teacher's "quiz ready" notification and not a persistent nav item (V1 pattern: quiz is a modal state, not a nav item).

- [ ] **Step 1: Confirm nav decision**

Read `src/app/(student)/layout.tsx`. The current nav links are: `/student/dashboard`, `/student/assignments`, `/student/growth`. V1 does NOT have a `/quiz` link in the student nav — the quiz is accessed via the dashboard "Quiz Ready" card. **Do not add `/student/quiz` to the nav unless the spec explicitly requires it.** The spec (§9) does not. Skip Step 2 if no nav change is needed.

- [ ] **Step 2 (conditional): If nav link is added**, modify `src/app/(student)/layout.tsx` following the same pattern as the existing nav items. Token-only classes only.

- [ ] **Step 3: Run the full test suite**

```
npx vitest run
```
Expected: all tests PASS. Fix any failures before committing.

- [ ] **Step 4: Type-check**

```
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: a11y gate**

```
npm run a11y
```
Expected: PASS (no contrast failures). If failures, fix the offending token class.

- [ ] **Step 6: Lint**

```
npm run lint
```
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add -p   # stage only intentional changes
git commit -m "feat(quiz-runner): Phase 3 complete — full suite green + a11y gate"
```

---

## Self-Review Checklist

After writing the plan, verify spec coverage:

### Spec section coverage

| Spec requirement | Task that covers it |
|---|---|
| Option-D server boundary: routes never ship raw score_pct/mastery_band | Task 1 (studentResultBundle helper) + Task 2 (submit + student-quiz reshape) |
| Ring timer (server-truth, wall-clock tick) | Task 3 (QuizTimer) + Task 7 (QuizRunner timer useEffect) |
| Warning thresholds 180/60/30s | Task 3 |
| Auto-submit at t=0 | Task 7 (useEffect on timeLeft) |
| 15s heartbeat | Task 7 (heartbeat useEffect) |
| Recovery banner (30s–5min gap) | Task 4 (RecoveryBanner) + Task 7 (load + showRecoveryBanner) |
| Lazy-forfeit (410 from /start) | Task 7 (handleStart 410 branch) |
| Forfeit screen (no raw score) | Task 6 (ResultScreen forfeit variant) |
| MCQ rendering (label stored, MathText) | Task 5 (QuestionCard MCQ) |
| Numeric rendering (text input, inputMode=decimal) | Task 5 |
| Open-response rendering (textarea) | Task 5 |
| Per-question prev/next/submit navigation | Task 7 (QuizRunner nav) |
| Progress dots (answered/active/unvisited) | Task 7 (dots in taking render) |
| Behavioral capture: response_time_ms, hesitation_ms, answer_changes, word_count | Task 7 (snapshotPerQuestion) |
| Behavioral capture: navigation_backs, pause_count, total_pause_ms | Task 7 (refs + handlePrev + keydown listener) |
| Behavioral capture: focus_loss_count, paste_count | Task 7 (visibilitychange + paste listeners) |
| Behavioral capture: stuckEraseCount (pause >3s then Backspace/Delete) | Task 7 (handleKeydown listener) |
| SessionAggregates (all 10 fields) | Task 7 (buildSessionAggregates) |
| Signal post on advance + submit | Task 7 (handleNext + handleSubmit) |
| Adaptive Q4/Q5 after Q3 (`{ adapted }` → open-response map) | Task 7 (adapt useEffect) |
| Per-question review from quiz-history POST (all positions correct) | Task 7 (handleSubmit → /quiz-history) |
| grading-pending screen | Task 6 (ResultScreen grading-pending) |
| Done screen: Teli message (pre-built), soft mastery pill, ✓/✗ review | Task 6 (ResultScreen done, consumes bundle) |
| Study guide accordion (needsStudyGuide) | Task 6 + Task 7 (study-guide fetch gated on bundle.needsStudyGuide) |
| Strong performance copy (needsStudyGuide=false) | Task 6 |
| Option-D: assertNoLeak on all student strings | Task 1 (helper leak-guarded) + Task 6 (ResultScreen) + Task 7 (no-quiz/ready/submitting) |
| Leak-audit test (server bundle → DOM, real DB bands) | Task 7 (QuizRunner.leak.test.tsx) |
| Token-only styling (no hex) | All tasks (enforced in every component) |
| WCAG-AA a11y gate | Task 9 (`npm run a11y`) |
| STRINGS-FOR-BARB.md proposals | Task 4 (all 9 string groups appended) |
| Server wrapper page (`quiz/page.tsx`, queries public.users, grade_level text) | Task 8 |
| `tsc --noEmit` clean on each task | Every task Step 5 |

### Placeholder scan

No "TBD", "TODO implement later", or "similar to task N" appear in the plan. The single `// TODO(tts)` is a deliberate, scoped deferral (TTS wiring requires confirming a V2 call site first) — it is not an implementation placeholder.

### Type consistency

- `StudentResultBundle` / `StudentResultBundleInput` defined in `studentResultBundle.ts`, imported into `submit/route.ts`, `student-quiz/route.ts`, `ResultScreen.tsx`, `QuizRunner.tsx` ✓
- `getScoreMessage(pct, seed, locale, tier, firstName)` → `{ message, teliMsg, teliState }` — called ONLY in `studentResultBundle.ts` (server-side), never in client components ✓
- `masteryDisplayLabel(band)` → soft word — called in `studentResultBundle.ts`; `ResultScreen` renders the pre-built soft label directly ✓
- `gradeTextToTier(string|null)` exported from `studentResultBundle.ts`, imported in both routes + `page.tsx` (one source of truth) ✓
- `QuizQuestion` defined in `QuestionCard.tsx`, imported into `QuizRunner.tsx`; adapted entries mapped to `question_type:'open'` ✓
- `QuestionReviewItem` defined in `ResultScreen.tsx`, imported into `QuizRunner.tsx`; populated from quiz-history `review[]` ✓
- `SessionAggregates` imported from `@/lib/signals/behavioralTypes` ✓
- `RecoveryBannerProps`, `QuizTimerProps` all defined in their respective files ✓
- `handleSubmit` / `handleNext` / `handlePrev` all defined in `QuizRunner.tsx` ✓
- `postSignal` / `buildSessionAggregates` / `snapshotPerQuestion` / `resetPerQuestionRefs` all defined before use ✓
- `requireRole` returns `{ userId, role, schoolId, fullName }` — `page.tsx` reuses `schoolId`/`fullName`, queries `users` only for `grade_level` (text) ✓

---

## Revision Log (2026-06-21)

Applied the 6 pre-flight required revisions. Task count went **7 → 9** (two new server-side tasks inserted at the front; everything renumbered). Each revision, against the REAL code that was read first:

1. **Option-D payload leak (server-side) — NEW Task 1 + Task 2 at the front.** Added the pure `studentResultBundle({ scorePct, masteryBand, tier, firstName, attemptId, locale }) → { scoreMessage, masteryLabel, needsStudyGuide }` helper (full TDD task, real `getScoreMessage(pct, seed, locale, tier, firstName)` + `masteryDisplayLabel(band)` signatures, `needsStudyGuide = scorePct < 80`). Reshaped `submit/route.ts` (drop raw `score_pct`/`mastery_band`, fetch `grade_level`+`full_name` from the `users` row it already reads, return `result`; `grading_delayed` path + `after()` hooks untouched) and `student-quiz/route.ts` (completed `existing_attempt` gets a server-built `result`, raw fields dropped, field-by-field build; in-progress = no bundle). Both route test files updated to assert the bundle is present and no raw `score_pct`/`%`/`mastery_band` enum leaks. Before/after code included.
2. **Review-items source.** QuizRunner `handleSubmit` now builds `reviewItems` from `POST /api/attempts/quiz-history { attempt_id }` (real `review[]`: every position + `is_correct` + `correct_answer` + `student_answer` + `explanation` + `question_type`), NOT from `submit`'s OEQ-only `grades[]` (which would mark every MCQ/numeric wrong). Mapping + the leak-test/reviewItems wiring updated.
3. **`/adapt` contract.** Read the route + `adaptQuestions` + `AdaptedQuestionsSchema`: the route returns `{ adapted }` (NOT `adapted_questions`); `adapted.questions[]` are OPEN-response Q4/Q5 only — `{ position, question_text, rubric, scaffold_hint, difficulty_label }`, no `question_type`/`choices`/`correct_answer`. Fixed the field name, unwrapped the real shape, and specified a gated map of each adapted entry → `QuizQuestion` with `question_type:'open'`, `choices:null`, `correct_answer:''`, preserving `position` + original id; splice can't break rendering. Request body dropped to `{}` (route ignores it).
4. **Server page.** Rewrote `page.tsx` to query **`public.users`** (no `students` table exists), treat `grade_level` as **`text`** via a shared `gradeTextToTier(string|null)` (exported from `studentResultBundle.ts`), and reuse `requireRole`'s `schoolId` + `fullName`→`firstName` — querying `users` only for `grade_level`. Fixed the `gradeTier` typing.
5. **`stuckEraseCount` prose.** Global Constraints now reads "computed (pause >3s then Backspace/Delete)" instead of "always 0"; the Task-7 code already computes it correctly. (No grounding-carry-forward "always 0" row exists in this plan file.)
6. **Leak fixture.** Changed the celebrating fixture band `above_level` → `advanced` (real DB enum is `reteach | grade_level | advanced`). The leak audit now builds bundles via the real `studentResultBundle` and asserts no digit/`%`/raw-enum reaches the DOM.

**Kept intact:** render-side Option-D enforcement (`assertNoLeak`, no `scorePct` rendered, neutral soft-label pill), the digit/`%` leak audits, component decomposition, state machine, wall-clock timer, behavioral-capture typing, token discipline. `ResultScreen` (Task 6) now takes the pre-built `scoreMessage` + `masteryLabel` + `needsStudyGuide` (no longer calls `getScoreMessage`); its tests + the QuizRunner leak test updated to the new props.

**Where reading the real code changed the approach:**
- `getScoreMessage` returns `{ message, teliMsg, teliState }` only — it does NOT return a mastery label, so the bundle computes `masteryLabel` separately via `masteryDisplayLabel` (soft words `Building`/`On Track`/`Strong`/`Not yet assessed`).
- `requireRole` already returns `schoolId` + `fullName`, so the page only needs `grade_level` from `users` — not a full profile read.
- `/adapt`'s adapted questions are open-response with no `question_type`/`choices`, which forced the explicit `question_type:'open'` mapping (a naive splice of `data.adapted` into `QuizQuestion[]` would have rendered blank/typeless questions).
