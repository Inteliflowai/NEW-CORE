# Grounding — CORE V2 Quiz Runner Phase 3: Coached Timed Runner UI

**Date:** 2026-06-21
**Phase:** 3 of 4 (Phase 1 = Foundation/Migration, Phase 2 = API Routes, Phase 3 = Runner UI, Phase 4 = Surface wiring + verify)
**Scope:** Verbatim, code-grounded reference for building `src/app/(student)/student/quiz/page.tsx` — the client-side coached, timed runner UI — and its `useEventTracker`-style behavioral-capture hook.

**Conventions:** V1 = `C:/users/inteliflow/core` (top-level `app/` + `lib/`, no `src/`). V2 = `C:/users/inteliflow/NEW-CORE` (Next.js 16, code under `src/`). All citations are `file:line`. Read-only research; nothing here changes source.

---

## SECTION 1: What's Already Specified and Grounded

### 1.1 Design spec summary

**Source:** `docs/superpowers/specs/2026-06-20-quiz-runner-design.md`

The design spec fully covers:

**Timer and lifecycle:**
- Ring timer recomputed every tick from server-stamped `started_at` (never a client countdown — honest across reloads). Warning thresholds: 180s/60s/30s. Auto-submit at 0.
- Heartbeat: 15s interval posting `{ heartbeat:true }` to `/signal` to bump `last_active_at` (spec §9).
- Recovery banner: `closureSecondsRemaining` countdown after a 30s–5min gap (spec §9).
- Lazy-forfeit: handle HTTP 410 from `/start` — show gentle forfeit screen, no raw score (spec §9).

**Runner states (spec §9):** `loading | no-quiz | ready (notification) | taking | submitting | grading-pending | done | forfeit | review`

**Question rendering (spec §9):**
- MCQ, numeric, open-response — per-type rendering
- Adaptive Q4/Q5 via `/adapt` after Q3

**Post-submit coaching (Option-D, locked — spec §4, §9):**
- Students NEVER see numeric score/percentage
- Band pill + qualitative coaching copy (Teli message) only
- ✓/✗ review (no per-question numeric scores)
- Study-guide accordion when `score_pct < 80`
- Forfeit screen: honest, gentle, raw forfeit score deliberately not shown

**Behavioral capture (the moat — spec §9):** Per-question: `response_time_ms`, `answer_changes`, `hesitation_ms`, `navigation_backs`, `pause_count`, `total_pause_ms`, `word_count`, `focus_loss_count`, `paste_count`, `hints_used`. Posted via `/signal`. "Cheap, no library."

**Token-only styling:** Rebuild with Tier-2 token classes + `text-fg` — NOT V1's ~1762 lines of inline hex (spec §10).

### 1.2 Phase-2 grounding summary

**Source:** `docs/superpowers/plans/grounding/2026-06-20-quiz-runner.md`

All 6 Phase-2 API routes are **built** (see Section 3 below for full shapes). The grounding document confirmed:
- V2 has NO `useEventTracker`, NO `student_events`, NO `cognitive_signals` pipeline.
- V2's signal spine uses behavioral aggregates stored to `quiz_responses` cols + `quiz_attempts.session_aggregates` jsonb, then `computeSignals()` on submit.
- The `quiz_responses` UNIQUE constraint + `quiz_attempts.last_active_at / forfeit_reason / study_guide` columns (migration 0013) are prerequisites that Phase 1 must have delivered before the UI can function.

### 1.3 Tunables the existing grounding records

From `src/lib/student/quizAttemptState.ts:33–35` (V2, already built in Phase 1):
```ts
export const QUIZ_DURATION_MINUTES = 10;
export const CLOSURE_FORFEIT_MINUTES = 5;
export const RESUME_BANNER_THRESHOLD_SECONDS = 30;
```

From V1 `app/(dashboard)/student/quiz/page.tsx:29–31`:
```ts
const QUIZ_TIME_LIMIT = 10 * 60;      // 600 seconds
const HEARTBEAT_INTERVAL_MS = 15_000; // 15 seconds
```
QuizTimer warning thresholds (V1 `quiz/page.tsx:39–41`): `isWarning = timeLeft <= 180 && timeLeft > 60`, `isDanger = timeLeft <= 60`, `isPulsing = timeLeft <= 30`.

### 1.4 Gaps the plan must fill (Phase 3 scope)

1. The `src/app/(student)/student/quiz/page.tsx` `'use client'` page does not yet exist.
2. No behavioral-capture hook exists in V2 — must be built inline (no library) per spec §9.
3. The post-submit Teli TTS wiring (calling `teliSpeak(teliMsg)` from `getScoreMessage`) — V1 has this; V2 has the `scoreMessage.ts` pools but not the TTS call site.
4. The `grading-pending` polling path (when submit returns `grading_delayed: true`) — not yet implemented.
5. Component tests (jsdom) + the leak-audit test are net-new (spec §12).
6. `STRINGS-FOR-BARB.md` proposals for every piece of copy in the runner.

---

## SECTION 2: V1 Runner UI — Port Source

**Primary file:** `C:/users/inteliflow/core/app/(dashboard)/student/quiz/page.tsx` (1762 lines)
**Supporting:** `lib/signals/useEventTracker.ts`, `lib/signals/types.ts`, `lib/student/quizAttemptState.ts`

### 2.1 Page component structure

**QuizState type** (`quiz/page.tsx:27`):
```ts
type QuizState = 'loading' | 'already-done' | 'no-quiz' | 'taking' | 'submitting' | 'done' | 'grading-pending' | 'forfeit';
```

The dashboard page (`student/page.tsx:20`) has a slightly different variant:
```ts
type QuizState = 'loading' | 'already-done' | 'no-quiz' | 'ready' | 'taking' | 'submitting' | 'done';
```
The runner page omits `ready` and adds `grading-pending` and `forfeit`. V2 spec consolidates these: `loading | no-quiz | ready (notification) | taking | submitting | grading-pending | done | forfeit | review`.

**Architecture:** single `StudentQuizPageInner` function (the runner inner; an outer wrapper handles auth). No sub-components for question rendering — all inline. The `<QuizTimer>` is a sub-component within the same file (`quiz/page.tsx:33–85`).

**Key state refs** (`quiz/page.tsx:518–670`):
- `attemptId, startedAt, timeLeft, currentIndex, questions, responses, state`
- `signals: useRef<Record<number, SignalSnapshot>>({})` — per-question snapshot accumulator
- `questionStartTime: useRef<number>` — set on mount and each advance
- `firstInputTime: useRef<number | null>` — set on first focus/keypress per question
- `answerChanges: useRef<number>` — incremented on each `handleResponse` change per question
- `autoSubmitTriggered: useRef<boolean>` — prevents double-submit at time=0
- `studyGuide: string | null`, `studyGuideLoading: boolean`
- `forfeitData: { reason: string; score_pct?: number; mastery_band?: string } | null`
- `trackingEnabled: boolean` — set `true` after user loads and quiz starts

### 2.2 Countdown timer logic

**Constants** (`quiz/page.tsx:29–31`):
```ts
const QUIZ_TIME_LIMIT = 10 * 60;      // 600s
const HEARTBEAT_INTERVAL_MS = 15_000;
```

**QuizTimer component** (`quiz/page.tsx:33–85`):
- SVG ring, depletes clockwise (rotated -90deg). `pct = timeLeft / total`, strokeDasharray drives the ring.
- `isWarning = timeLeft <= 180 && timeLeft > 60` → amber ring (#f59e0b), amber text, amber bg (`quiz/page.tsx:39`)
- `isDanger = timeLeft <= 60` → red ring (#ef4444), red text, red bg (`quiz/page.tsx:40`)
- `isPulsing = timeLeft <= 30` → CSS `timerPulse` animation at 0.8s (`quiz/page.tsx:41`)
- Ring color: danger `#ef4444`, warning `#f59e0b`, normal `#6366f1` (`quiz/page.tsx:43`)

**V2 translation:** Replace all hardcoded hex with token classes. Warning amber → `text-warn-fg bg-warn-surface`. Danger red → `text-risk-fg bg-risk-surface`. Normal ring → `text-brand`. Label text → `text-fg`.

**Wall-clock tick** (`quiz/page.tsx:600–619`):
```ts
// Tick every 1s — recomputes from server-stamped startedAt, NOT a decrement
setInterval(() => {
  const remaining = quizTimeRemainingSeconds(attemptStartedAt, new Date());
  setTimeLeft(remaining);
  if ([30, 10, 5, 3, 2, 1].includes(remaining)) playTick();
  if (remaining <= 0 && !buzzerPlayed.current) { playBuzzer(); buzzerPlayed.current = true; }
}, 1000);
```
NOTE: `quizTimeRemainingSeconds` is already built in V2 `src/lib/student/quizAttemptState.ts:111–120`.

**Audible cues** (quiz/page.tsx:610–615): beeps at 30/10/5/3/2/1 via `playTick()` (Web Audio API), buzzer at 0 via `playBuzzer()` (three descending square-wave tones: 440→340→260 Hz, 0.2s intervals). V2 should replicate or omit gracefully (audio APIs need `'use client'` + user-gesture gating).

**Auto-submit** (`quiz/page.tsx:647–652`):
```ts
useEffect(() => {
  if (timeLeft === 0 && state === 'taking' && !autoSubmitTriggered.current) {
    autoSubmitTriggered.current = true;
    handleSubmit();
  }
}, [timeLeft, state]);
```
An overlay renders at `quiz/page.tsx:1526–1538`: ⏰ "Time's up / Auto-submitting your answers…" — shown while `state === 'submitting'` and `autoSubmitTriggered.current === true`.

### 2.3 Resume/recovery banner

**Trigger** (`quiz/page.tsx:806–810`): when `classifyAttemptState` returns `resuming_after_gap` AND `existingAttempt.last_active_at` exists:
```ts
const gapSec = Math.floor((Date.now() - new Date(existingAttempt.last_active_at).getTime()) / 1000);
setResumedAfterSeconds(gapSec);
setShowRecoveryBanner(true);
```
`resuming_after_gap` fires when gap >= 30s AND gap < 300s (5 min).

**Banner rendering** (`quiz/page.tsx:1603–1634`):
- Yellow/amber banner (`#fffbeb`, `#fde68a` border) → V2 token: `bg-warn-surface border-warn`
- Title: `< 60s` → shows seconds elapsed; else minutes elapsed
- Body: tells student the wall-clock kept running, they have `CLOSURE_FORFEIT_MINUTES` minutes left before the quiz closes
- Dismiss: ✕ button sets `showRecoveryBanner(false)`

**`closureSecondsRemaining`** (`lib/student/quizAttemptState.ts:128–137`): how many seconds remain until closure forfeit fires. Already built in V2. V1 does NOT render a live countdown of this in the banner (it shows the gap elapsed). V2 can optionally show the countdown-to-forfeit to heighten urgency. Decision: show `closureSecondsRemaining` as a live countdown (more useful than the gap, matches the spec's description).

### 2.4 Lazy-forfeit flow

**Path A — detected via classifyAttemptState before calling /start** (`quiz/page.tsx:777–797`):
Client pre-classifies the existing attempt as `closure_forfeit` or `time_up_forfeit` → calls `POST /api/attempts/start` → server returns HTTP 410 with `{ forfeit_reason, score_pct, mastery_band }` → client sets `forfeitData`, `setState('forfeit')`.

**Path B — stranded attempt** (`quiz/page.tsx:824–837`):
First touch, no existing attempt seen, but `/start` still returns 410 (edge case) → same extraction.

**Forfeit screen** (`quiz/page.tsx:1459–1509`):
- ⏸️ emoji, amber border
- Eyebrow: "Quiz Closed" or equivalent (uppercase label, amber)
- Reason: `closure` → "The quiz closed while you were away" | `time_up` → "Time ran out"
- Body: encouraging copy ("Your teacher can see your progress…")
- **Option-D enforcement, commented explicitly at `quiz/page.tsx:1492–1493`:** "the raw forfeit score % is intentionally NOT shown to the student."
- CTA: return to Dashboard

### 2.5 Per-question rendering by type

**Type detection** (`quiz/page.tsx:1513–1515`):
```ts
const isMCQ     = currentQuestion.question_type === 'mcq';
const isNumeric = currentQuestion.question_type === 'numeric';
// open-response = !isMCQ && !isNumeric
```

**MCQ** (`quiz/page.tsx:1659–1677`):
- `currentQuestion.choices as MCQChoice[]` — rendered as `<button>` per choice
- Selected: `currentResponse === choice.label || currentResponse === choice.text` (label comparison first)
- On click: `handleResponse(choice.label)` — stores the label string (e.g. "A"), not choice text
- Selected styles: indigo outline + bg → V2 token: `border-brand bg-brand-surface`
- ✓ shown on selected. `MathText` wraps both question text and each choice text

**Numeric** (`quiz/page.tsx:1679–1695`):
- `<input type="text" inputMode="decimal">` (NOT `type="number"` — allows fractions like `3/4`)
- Raw string stored via `handleResponse(e.target.value)`
- `firstInputTime.current` set on `onFocus`

**Open-response** (`quiz/page.tsx:1697–1707`):
- `<textarea rows={6} style="resize:vertical">`
- Raw string stored via `handleResponse(e.target.value)`
- `firstInputTime.current` set on `onFocus`

**No sub-components** for question rendering — all inline. `MathText` (from V2 `src/components/core/MathText.tsx:94`) wraps question text and MCQ choice text.

**`handleResponse`** (`quiz/page.tsx:874–884`): sets `responses[currentQuestion.position] = value`. Increments `answerChanges.current` when value differs from prior. Sets `firstInputTime.current` on first call. Fires `trackEvent('answer_change')` and `trackEvent('answer_draft')`.

### 2.6 In-quiz navigation

**Prev** (`quiz/page.tsx:1712–1722`): shown only when `currentIndex > 0`. Calls `setCurrentIndex(prev => prev - 1)` then `trackEvent('question_prev', { fromIndex: currentIndex })`. No `saveSignalAndAdvance` on back-nav — per-question metrics are NOT snapshotted on prev.

**Next** (`quiz/page.tsx:1724–1727`): calls `saveSignalAndAdvance()`. Disabled when `!currentResponse`.

**Submit** (`quiz/page.tsx:1728–1731`): last question only. Calls `handleSubmit()`.

**Progress dots** (`quiz/page.tsx:1736–1745`): one pill dot per question. Active = wide pill. Answered = green (#a7f3d0 → V2: `bg-ok`), unvisited = grey. Clickable if answered OR `i <= currentIndex`.

**`saveSignalAndAdvance`** (`quiz/page.tsx:886–919`): snapshots `signals.current[position]` with the 4 client-tracked metrics, fires 3 trackEvent calls, resets per-question refs, advances index.

### 2.7 Study guide surface

**Trigger** (`quiz/page.tsx:681–685`):
```ts
useEffect(() => {
  if (state === 'done' && result && result.score_pct < 80 && attemptId && !studyGuide) {
    loadStudyGuide(attemptId);
  }
}, [state, result, attemptId]);
```

**API call** (`quiz/page.tsx:687–701`): `POST /api/attempts/study-guide` with `{ quiz_attempt_id }`. Returns `{ study_guide: string }`.

**Rendering** (`quiz/page.tsx:1362–1398`): a `<ProgressiveSection>` (accordion-style collapsible), NOT a modal. Summary label "📚 Revision notes for what you missed." Badge "Ready" when loaded. Content rendered via `dangerouslySetInnerHTML` with `**bold**` → `<strong>` conversion and newlines → `<br />`. Loading: spinner + copy. Failed: graceful copy. Score >= 80: shows green "Strong performance" message instead.

**V2 note:** V2 has no `ProgressiveSection` component. Build an accordion using Tailwind token classes, or a simple `<details>`/`<summary>` pair. No third-party library needed.

### 2.8 Post-submit screen (state === 'done')

**Critical Option-D comment** (`quiz/page.tsx:1178–1183`):
> "80px score% + band pill stripped per Barb's locked Option D. Result screen shows non-numeric 'You finished the quiz!' copy plus Teli's contextual message; the diagnostic data still drives HW personalization server-side."

**What students SEE** (`quiz/page.tsx:1185–1457`):
- ✨ emoji, heading: "You finished the quiz!" (qualitative)
- Body text: a qualitative tier+band message (e.g. "Nailed it, Alex. Strong grasp on this one.") via `getScoreMessage()` — NO number
- Teli avatar + `scoreInfo.teliMsg` + TTS call: `teliSpeak(scoreInfo.teliMsg)`
- Mute Teli button
- `LearningStyleCard` component (V2: defer/omit initially — no equivalent built)
- "What happens next" section: animated dot → ✓ "Assignment ready" after 3s delay
- Per-question ✓/✗ review ("How did you do?") accordion: shows correct/incorrect per question, student answer, correct MCQ answer on wrong items, Teli feedback on open-response from `result.open_explanations[position]` — NO numeric score per question
- XP earned: `100 + (score_pct >= 80 ? 50 : 0) + (score_pct >= 100 ? 150 : 0)` shown via `StatWithContext` component (V2: omit or simplify to an encouraging message — this is an engagement mechanic that can be added later)
- Study guide accordion (score < 80 only)
- CTA: "Start assignment" → `/student/assignments?assignmentId=...`

**What students do NOT see:** numeric score, percentage, mastery_band enum, raw points. Confirmed by `quiz/page.tsx:1053–1056` comment.

**Band thresholds for message selection (internal only, `quiz/page.tsx:385`):**
- `pct >= 90` → `celebrating`
- `pct >= 75` → `strong`
- `pct >= 60` → `effort`
- `< 60` → `tough`
These match `src/lib/quiz/scoreMessage.ts:215–246` already built in V2.

### 2.9 Grading-pending screen

**Trigger** (`quiz/page.tsx:960–964`): `handleSubmit` receives `data.grading_delayed === true` from `POST /api/attempts/{id}/submit` → `setState('grading-pending')`.

**Screen** (`quiz/page.tsx:1018–1031`): `<StateScreen>` with ⏳ emoji, "Your quiz is being graded" title, amber info block with "Open-response answers are being graded by our AI. You'll see your results soon. Safe to leave — we'll save your results." CTA: Back to Dashboard.

**V2 note:** V2's grader already returns `{ grading_delayed: true }` on OEQ failure (see `submit/route.ts`). The runner must handle this path. There is currently no polling mechanism — implement as a static "come back later" screen identical to V1.

### 2.10 V1 behavioral capture — EXACT client-side implementation

**This is the moat's data source. Document exactly.**

**Four per-question tracking refs** (`quiz/page.tsx:655–658`):
```ts
const questionStartTime = useRef<number>(Date.now());
const firstInputTime    = useRef<number | null>(null);
const answerChanges     = useRef<number>(0);
const signals = useRef<Record<number, {
  response_time_ms: number;
  hesitation_ms:    number;
  answer_changes:   number;
  word_count:       number;
}>({});
```

**response_time_ms:** `Date.now() - questionStartTime.current`, computed in `saveSignalAndAdvance` (`quiz/page.tsx:889`) and `handleSubmit` (`quiz/page.tsx:931`). `questionStartTime.current` reset to `Date.now()` after each advance (line 911) and at quiz start (line 811/845).

**hesitation_ms:** `firstInputTime.current - questionStartTime.current` when first input occurred (`quiz/page.tsx:890`). Falls back to `responseTime` (line 890) or `0` (line 934) if no input recorded. `firstInputTime.current` set on the **first** `handleResponse` call (line 876) and also on `onFocus` for text/numeric inputs (lines 1692, 1704). Reset to `null` after each advance (line 912).

**answer_changes:** `answerChanges.current` incremented in `handleResponse` (line 878) when `responses[position]` already exists AND new value differs. Reset to `0` after each advance (line 913).

**word_count:** computed inline at snapshot time: `response.trim().split(/\s+/).filter(Boolean).length` (lines 897, 936).

**These four are snapshotted into `signals.current[position]`** in both `saveSignalAndAdvance` (lines 893–898) and `handleSubmit` (lines 928–937).

**When posted to `/signal`** (`quiz/page.tsx:949–953`):
```ts
await fetch(`/api/attempts/${attemptId}/signal`, {
  method: 'POST',
  body: JSON.stringify({ responses, signals: signals.current }),
});
```
Called **once at final submit** with the complete map. Heartbeat POSTs send `{ responses, signals: {}, heartbeat: true }` — current responses but EMPTY signals (line 636).

**Metrics V1 tracks via `useEventTracker` (NOT via the signals ref) — and what they feed:**

| Event type | How tracked | V1 pipeline | V2 plan |
|---|---|---|---|
| `pause_start` / `pause_end` | global keypress gap > 3s (`useEventTracker.ts:101–119`) | → `student_events` → `computeSignals` | capture `pause_count` + `total_pause_ms` client-side per question; post to `/signal` SessionAggregates |
| `focus_loss` / `focus_gain` | window blur/focus (`useEventTracker.ts:112–120`) | → `student_events` → `computeSignals` | capture `focusLossCount` + `totalFocusLossMs`; post to `/signal` SessionAggregates |
| `paste` | paste listener (NOT in quiz/page.tsx but in useEventTracker) | → `student_events` → `computeSignals` | capture `pasteCount` per question; post to `/signal` |
| `question_prev` | `trackEvent` (`quiz/page.tsx:1716`) | → `student_events` | capture `navigation_backs` counter in client refs |
| `backspace` | global keydown handler (`useEventTracker.ts:107`) | → `student_events` → `computeSignals` | capture `backspaceCount`; post to SessionAggregates |

**Critical finding:** In V1, `pause_count`, `total_pause_ms`, `focus_loss_count`, `paste_count`, and `navigation_backs` are NOT in the quiz runner's `signals.current` accumulator — they are computed server-side from the `student_events` raw event log. V2 has no `student_events` table. The V2 plan (already designed in the spec) is to capture these as **client-side counters** in the runner and include them in the `SessionAggregates` object posted to `/signal`. The `signal/route.ts` already accepts `sessionAggregates` (line 86–89).

**V2 behavioral capture plan (the lightweight alternative to useEventTracker):**

Build directly in the runner page — no separate hook needed:

```ts
// Per-question refs (per signal field)
const navigationBacksRef    = useRef(0);         // incremented on prev-click
const pauseCountRef         = useRef(0);         // incremented on pause_end
const totalPauseMs          = useRef(0);         // accumulated on pause_end
const focusLossCountRef     = useRef(0);         // incremented on blur
const totalFocusLossMsRef   = useRef(0);         // accumulated on focus
const pasteCountRef         = useRef(0);         // incremented on paste event
const backspaceCountRef     = useRef(0);         // incremented on keydown:Backspace
const keypressCountRef      = useRef(0);         // incremented on keydown:printable

// Session-level (persisted across questions)
const sessionFocusLossCount = useRef(0);
const sessionPauseCount     = useRef(0);
const sessionPasteCount     = useRef(0);
```

Global listeners (visibilitychange/blur for focus, paste listener, keydown for backspace/keypress, pausing on 3s gap) — wire in `useEffect` on mount. Per-question refs reset on advance/prev. Session refs accumulate throughout.

Signal posted at `/signal` in `SessionAggregates` shape:
```ts
{
  focusLossCount:    sessionFocusLossCount.current,
  pasteCount:        sessionPasteCount.current,
  pauseCount:        sessionPauseCount.current,
  totalPauseMs:      totalPauseMs.current,
  totalFocusLossMs:  totalFocusLossMsRef.current,
  backspaceCount:    backspaceCountRef.current,
  keypressCount:     keypressCountRef.current,
  ttsPlayCount:      ttsPlayCountRef.current,
  canvasUsed:        false,  // quiz never has canvas
  stuckEraseCount:   0,      // quiz never has canvas
}
```

### 2.11 V1 post-submit student presentation — Option-D assessment

V1's runner (`quiz/page.tsx:1178–1183`) explicitly stripped the numeric score as a locked design decision ("Barb's locked Option D"). **V1 does NOT show a numeric score or raw percentage to the student.** Students see only qualitative Teli message + ✓/✗ per question. V2 must maintain this. The score flows server-side and is only used internally to select the band message pool.

**What V1 DOES show:**
- Qualitative message from `getScoreMessage` (e.g. "Nailed it, Alex — strong grasp on this one.")
- Teli avatar with encouraging `teliMsg`
- ✓/✗ per question (correct/incorrect only, no points)
- XP earned (engagement mechanic, not a grade)
- Study guide accordion (wrong answers only, < 80%)
- "Assignment ready" confirmation (downstream assignment was personalized server-side)

This is the V2 standard. `assertNoLeak` must be run on every string in the done/forfeit screens.

---

## SECTION 3: V2 Building Blocks

### 3.1 Existing student route structure and conventions

**`src/app/(student)/layout.tsx`** (33 lines):
- `await requireRole(['student'])` (line 13) — server component gate
- Wraps in `<RoleLayout role="student" nav={nav}>` (line 29)
- `RoleLayout` sets `data-role="student"` + `data-intensity="loud"` on root div → activates student token scope
- Nav links: `/student/dashboard`, `/student/assignments`, `/student/growth`
- WCAG note: layout uses `text-[var(--fg)]` (line 16) — minor token-discipline deviation; runner must use `text-fg`

**`src/app/(student)/student/assignments/[id]/page.tsx`** (55 lines):
- Server component pattern: `async function ... ({ params }: { params: Promise<{ id: string }> })`
- `const { id } = await params` (line 16) — Next.js 16 async params
- `await requireRole(['student'])` → gets `userId` (line 17)
- `createAdminSupabaseClient()` for all queries (line 18) — RLS bypassed; ownership is the backstop
- IDOR: checks `row.student_id !== userId` (line 27) — returns same `EmptyState` for 404 vs. 403 (don't leak existence)
- Returns JSX directly (server components return `React.JSX.Element`)

**`src/app/(student)/student/assignments/[id]/_components/SparkLaunchCard.tsx`** (64 lines):
- `'use client'` directive (line 1)
- `useState` for local loading/error state (lines 21–22)
- `fetch('/api/attempts/spark-launch', { method: 'POST', body: JSON.stringify({ assignment_id }) })` (line 39)
- Token classes throughout: `border-surface`, `bg-surface`, `text-fg`, `bg-brand`, `text-fg-on-brand`, `text-risk-fg` (lines 26–61)
- No hardcoded hex anywhere — this is the correct pattern

**The runner page pattern (to build):**
- Route: `src/app/(student)/student/quiz/page.tsx`
- `'use client'` — it needs `useState`, `useRef`, `useEffect`, timers, fetch
- Hydration via `useEffect` on mount (auth check via API, or pass `userId` from a thin server wrapper)
- Recommended: thin server component wrapper (`src/app/(student)/student/quiz/page.tsx` = server, sets userId + initial quiz data) wrapping an inner `'use client'` runner component — mirrors the existing V1 pattern of `StudentQuizPageInner`. See Section 5 for route decision.

### 3.2 V2 component kit — `src/components/core/`

All 8 production components with their props:

**`Card.tsx`** (69 lines):
- `type CardTone = 'surface' | 'brand' | 'ok' | 'warn' | 'risk'`
- `CardProps: { children: ReactNode; className?: string; tone?: CardTone }` — tone defaults to `'surface'`
- Pop-Art chrome: `rounded-lg border-2 border-sidebar-edge shadow-sticker p-4` + tone-tinted background
- `StatCard: { label: string; value: ReactNode; className?: string }` — uses `CARD_BASE` styles; label is `text-fg-muted text-xs font-medium uppercase tracking-wide`; value is `text-fg text-2xl font-display font-bold leading-tight`

**`CLBadge.tsx`** (93 lines) — TEACHER-ONLY:
- `CLBadgeProps: { state: SkillLearningState; confidence?: number | null; confidenceWord?: ConfidenceWord | null }`
- `type ConfidenceWord = 'consistent' | 'tentative' | 'emerging'`
- Maps via `CL_VERB_BY_STATE`; renders: Reinforce → `bg-warn-surface text-warn-fg`, On Track → `bg-ok-surface text-ok-fg`, Enrich → `bg-brand-surface text-brand-fg`
- Raw confidence number NEVER rendered — safe guard already baked in

**`EmptyState.tsx`** (72 lines):
- `type EmptyStateVariant = 'not-yet-assessed' | 'just-getting-started' | 'on-track'`
- `EmptyStateProps: { variant: EmptyStateVariant; className?: string; titleOverride?: string; bodyOverride?: string }`
- Three cold-start/empty states with icon (○/◇/◆), heading, body copy

**`GrowthMotif.tsx`** (116 lines):
- `GrowthMotifProps: { history?: number[]; growth_history?: number[]; deltaLabel?: string; accent?: 'brand' | 'ok' }`
- Requires ≥4 data points (`COLD_START_THRESHOLD = 4`) — fewer → "just getting started" empty state
- Bars normalized to series' own max. "You vs your own past" framing.

**`MasteryLabel.tsx`** (35 lines):
- `MasteryLabelProps: { band: string | null }`
- Uniform neutral pill (`bg-surface text-fg border-fg-muted`) for ALL bands — no traffic-light color
- Calls `masteryDisplayLabel(band)` from `@/lib/utils/masteryLabel`
- Safe for student/parent/teacher — use this in the done screen's band display

**`MathText.tsx`** (112 lines) — `'use client'`:
- `MathTextProps: { children: string }`
- Renders inline `$…$` and block `$$…$$` math via KaTeX
- On parse error: shows raw delimited text (never blank, never throws)
- USE THIS to wrap all `question_text` and MCQ choice text in the runner

**`RiskBadge.tsx`** (50 lines) — TEACHER/ADMIN-ONLY:
- `RiskBadgeProps: { score?: number; scale?: '0to1' | '0to100'; band?: RiskBand }`
- Raw score never in DOM. Do NOT use on student surfaces.

**`RoleLayout.tsx`** (57 lines):
- `RoleLayoutProps: { role: Role; nav?: React.ReactNode; children: React.ReactNode }`
- Sets `data-role` + `data-intensity`; renders ◆ CORE header mark

**`icons.tsx`** (106 lines):
- All icons take `className?: string`, `aria-hidden`, `currentColor` fill, `strokeWidth=1.8`
- Exports: `IconToday, IconRoster, IconGradebook, IconAlerts, IconHighFive, IconLessons, IconQuizzes, IconInsights, IconUpload, IconChevron, IconSignOut, IconMenu, IconBolt`

### 3.3 Design tokens for the runner — `src/app/globals.css`

**Student role tokens** (`globals.css:145–163`) — activated by `data-role="student"`:
```css
--brand:         var(--emerald-600);   /* primary buttons, ring normal color */
--brand-accent:  var(--lime-500);
--fg-on-brand:   var(--white);         /* text on brand buttons */
--ok:            var(--emerald-600);   /* ✓ correct answers */
--bg:            var(--ink-50);
--surface:       var(--white);
--fg:            var(--ink-900);       /* ALL content text — use text-fg */
--fg-muted:      var(--ink-600);
--brand-surface: var(--emerald-50);    /* selected MCQ bg, selected state bg */
--brand-fg:      var(--emerald-800);
```

**Student loud variant** (`globals.css:158–163`):
```css
[data-role="student"][data-intensity="loud"] {
  --radius:      0.75rem;
  --radius-lg:   1.25rem;
  --shadow:      0 2px 6px 0 rgb(5 150 105 / 0.12);
  --shadow-pop:  0 10px 28px -4px rgb(5 150 105 / 0.22), 0 4px 10px -2px rgb(5 150 105 / 0.14);
}
```

**Sticker shadows** (`globals.css:307–308`):
```css
--shadow-sticker:    3px 3px 0 var(--sidebar-edge);
--shadow-sticker-lg: 6px 6px 0 var(--sidebar-edge);
```

**Pop-art utilities** (`globals.css:352–363`):
- `pop-dots` (L352): brand-tinted dot pattern, `background-size: 16px 16px` — use on quiz card headers
- `pop-canvas` (L360): lighter brand-tinted dot pattern, `background-size: 18px 18px` — use on study guide bg

**Timer ring tokens to use:**
- Normal: `stroke-brand` (emerald-600) — not a timer class; must use inline SVG stroke or a derived class
- Warning (≤180s): `stroke-warn` / `text-warn-fg bg-warn-surface`
- Danger (≤60s): `stroke-risk` / `text-risk-fg bg-risk-surface`
- Pulse (≤30s): `animate-pulse` (Tailwind utility)

### 3.4 `src/lib/student/quizAttemptState.ts` — already built in Phase 1

`L33`: `QUIZ_DURATION_MINUTES = 10`
`L34`: `CLOSURE_FORFEIT_MINUTES = 5`
`L35`: `RESUME_BANNER_THRESHOLD_SECONDS = 30`

`AttemptState` union (`L37–43`): `'completed_normal' | 'closure_forfeit' | 'time_up_forfeit' | 'fresh' | 'active' | 'resuming_after_gap'`

`AttemptStateInput` interface (`L45–58`): `isComplete, forfeitReason, startedAt, lastActiveAt, now, quizDurationMinutes?, closureForfeitMinutes?`

`classifyAttemptState(input)` (`L60–103`): pure, no DB, injected `now`

`quizTimeRemainingSeconds(startedAt, now, quizDurationMinutes?)` (`L111–120`): drives the ring timer

`closureSecondsRemaining(lastActiveAt, now, closureForfeitMinutes?)` (`L128–137`): drives the recovery banner countdown

### 3.5 `src/lib/quiz/scoreMessage.ts` — Teli Option-D post-submit copy

**Already built in Phase 1.**

`ScoreVariant` (`L20`): `{ message: string; teliMsg: string; teliState: 'celebrating' | 'idle' | 'speaking' }`
`Band` (`L22`): `'celebrating' | 'strong' | 'effort' | 'tough'`
`Tier` (`L23`): `'elementary' | 'middle' | 'high'`

`SCORE_VARIANTS_EN_BY_TIER` (`L35–114`): 3 tiers × 4 bands × 4 variants = 48 EN variants. Uses `{name}` placeholder.
`SCORE_VARIANTS_PT` (`L121–170`): PT-BR pool, 4 bands × 8–10 variants.
`pickVariantStable(variants, seed): ScoreVariant` (`L182`): pure djb2 hash — callers should include `attemptId` in seed.
`applyName(variant, firstName): ScoreVariant` (`L195`): substitutes `{name}`, gracefully drops placeholder+comma if no name.
`getScoreMessage(pct, seed, locale, tier, firstName)` (`L215`): band thresholds: ≥90 celebrating, ≥75 strong, ≥60 effort, <60 tough. Runtime `hasLeak` warn in non-production.

**TTS wiring:** V1 calls `teliSpeak(scoreInfo.teliMsg)` after setting state to 'done'. V2 needs this wired. Teli TTS is an existing V2 capability (used in the teacher shell); confirm the call site before building.

### 3.6 `src/lib/signals/behavioralTypes.ts` — SessionAggregates exact fields

**Already built in Phase 1.**

**`SessionAggregates`** (`behavioralTypes.ts:45–57`) — EXACT camelCase fields the runner must capture and post:
```ts
interface SessionAggregates {
  // Original 4
  focusLossCount:  number;   // window blur events during session
  pasteCount:      number;   // paste events during session
  pauseCount:      number;   // pause sequences (gap > 3s between keypresses)
  totalPauseMs:    number;   // total milliseconds spent paused

  // 6 ADDED fields (required by signal helpers — see behavioralTypes.ts:26–44)
  totalFocusLossMs: number;  // total ms window was blurred (feeds computeAttention)
  backspaceCount:   number;  // keydown:Backspace count (feeds computeFrustration)
  keypressCount:    number;  // total printable keypresses (velocity denominator)
  ttsPlayCount:     number;  // TTS plays (feeds computeEngagement); always 0 for MCQ
  canvasUsed:       boolean; // canvas drawing used; always false for quiz
  stuckEraseCount:  number;  // large erase events (backspace bursts); always 0 for quiz
}
```

**`QuestionAttemptData`** (`behavioralTypes.ts:15`):
```ts
interface QuestionAttemptData {
  questionId:     string;
  questionIndex:  number;
  isCorrect:      boolean;
  timeTakenMs:    number;
  changeCount:    number;
  hintsUsed:      number;
}
```

**`ComputedSignals`** (`behavioralTypes.ts:71`): output of `computeSignals()`, 12 signal groups including `learningVelocity`, `frustrationScore`, `attentionScore`, `errorPatternType`, `confidenceScore`, `engagementScore`, `predictiveRiskScore`, `sessionDurationMs`. All scores clamped to [0, 1].

### 3.7 Phase-2 API routes — request/response contracts

#### `GET /api/attempts/student-quiz`
**File:** `src/app/api/attempts/student-quiz/route.ts` (224 lines)

Request: `GET /api/attempts/student-quiz[?quizId=<uuid>]`

Response (success):
```ts
{
  quiz: {
    id: string; title: string; status: string;
    quiz_questions: Array<{
      id: string; position: number; question_type: 'mcq' | 'numeric' | 'open';
      question_text: string; choices: unknown; correct_answer: string;
      rubric: string | null; concept_tag: string | null; skill_id: string | null;
    }>;
  };
  existing_attempt: {
    id: string; is_complete: boolean; score_pct: number | null;
    mastery_band: string | null; adapted_questions: unknown;
    started_at: string | null; last_active_at: string | null;
    forfeit_reason: string | null;
  } | null;
  teacher_name: string | null;
  class_name: string | null;
}
```
Errors: `401` (no auth), `404` (no quiz available).

#### `POST /api/attempts/start`
**File:** `src/app/api/attempts/start/route.ts` (208 lines)

Request: `{ quiz_id: string }`

Response variants:
- `410 { attempt_id, forfeited: true, forfeit_reason: 'closure'|'time_up', score_pct: number, mastery_band: string }` — lazy-forfeit branch (`L120–135`)
- `200 { attempt_id, started_at, state: 'active', resumed_after_seconds?, closure_forfeit_minutes?, resume_banner_threshold_seconds? }` — active/resuming/fresh/new
- `400` already complete; `403` not enrolled; `404` quiz not found

#### `POST /api/attempts/[attemptId]/signal`
**File:** `src/app/api/attempts/[attemptId]/signal/route.ts` (160 lines)

Request:
```ts
{
  responses?: Array<{
    question_id: string;
    position: number;
    response_text: string;
    response_time_ms?: number;
    hesitation_ms?: number;
    answer_changes?: number;
    navigation_backs?: number;
    pause_count?: number;
    total_pause_ms?: number;
    word_count?: number;
    focus_loss_count?: number;
    paste_count?: number;
    hints_used?: number;
    question_type_scored?: string;
  }>;
  sessionAggregates?: Record<string, unknown>;  // SessionAggregates shape
  heartbeat?: boolean;
}
```
Response: `{ ok: true }` or `{ ok: true, heartbeat_only: true }` (heartbeat branch, L119–121).

Behavior:
- Always bumps `quiz_attempts.last_active_at` + folds `sessionAggregates` into same update (L97–113)
- Heartbeat-only (empty responses or `heartbeat: true`): returns early after liveness bump (L119–121)
- Non-heartbeat: upserts `quiz_responses` on `(attempt_id, question_id)` (L126–147)

#### `POST /api/attempts/[attemptId]/submit`
**File:** `src/app/api/attempts/[attemptId]/submit/route.ts` (383 lines) — reused unchanged from Phase 1

Response:
```ts
{ attempt_id: string; raw_score: number; score_pct: number; mastery_band: string; grades: Array<{ position: number; score: number }> }
// OR on OEQ grading failure:
{ attempt_id: string; grading_delayed: true; message: string }
```

**Critical contract:** the grader reads `quiz_responses.response_text` per position — these must already be written by `/signal` before submit is called. The runner must ensure the final submit also POSTs to `/signal` with all responses before calling `/submit`.

#### `POST /api/attempts/study-guide`
**File:** `src/app/api/attempts/study-guide/route.ts` (191 lines)

Request: `{ quiz_attempt_id: string }`

Response: `{ study_guide: string; cached: boolean }` or `{ study_guide: null; cached: false; unavailable: true }` (graceful LLM failure, L183–189).

Cache: `quiz_attempts.study_guide` column (set in Phase 1 migration).

#### `GET/POST /api/attempts/quiz-history`
**File:** `src/app/api/attempts/quiz-history/route.ts` (233 lines)

`GET` response: `{ classes: Array<{...}>, quizzes: Array<{ attempt_id, quiz_id, quiz_title, class_id, class_name, submitted_at }> }` — score_pct/mastery_band deliberately NOT in response (Option-D, L108–110).

`POST { attempt_id }` response: `{ review: Array<{ position, question_type, question_text, correct_answer, choices, rubric, student_answer, is_correct, ai_score, explanation }> }` — score_pct/mastery_band explicitly excluded (L207).

---

## SECTION 4: Governing Standard and Carry-Forwards

### 4.1 COACH-POSTURE.md — the six tests the runner UI must pass

**File:** `C:/users/inteliflow/NEW-CORE/COACH-POSTURE.md` (125 lines)

The six rules as pass/fail tests for the runner:

**Rule 1 — Speaks first, user never digs** (`COACH-POSTURE.md:24–28`):
TEST: can a student glance at the quiz result screen and know the ONE thing — "how did I do and what's next" — without reading a metric? The done screen must lead with the Teli message (qualitative) and the next-step CTA, not a data grid.

**Rule 2 — One thing at a time** (`COACH-POSTURE.md:30–33`):
TEST: is there one clear priority on each screen? The taking screen should foreground the question + timer only. The done screen leads with the coaching message. Fail = a wall of competing elements.

**Rule 3 — Plain human language** (`COACH-POSTURE.md:35–43`):
BANNED terms in front of students: `score, percentile, index, signal, algorithm, flag, divergence, threshold, model`. Enforced by `assertNoLeak`. TEST: would a 10-year-old understand every word?

**Rule 4 — Notices, suggests, never decides** (`COACH-POSTURE.md:44–49`):
The study guide and Teli message suggest, never judge. "Here's what to look at" not "you failed." TEST: every recommendation is phrased as a suggestion.

**Rule 5 — Quiet when nothing to say** (`COACH-POSTURE.md:51–55`):
On the taking screen: nothing but the question, answer area, and timer. No unnecessary chrome. TEST: is the screen calm when no warning is needed?

**Rule 6 — Not a chatbot** (`COACH-POSTURE.md:57–63`):
Teli speaks ONCE on the done screen. It does not yap through the quiz. TEST: is there a persistent chatbot widget on the taking screen? If yes, fail.

**Language Standard bans** (`COACH-POSTURE.md:71–93`):
BANNED: `score, percentile, index, divergence, threshold, signal, model, algorithm, flag`. Never "adaptive" — use "personalized." Comprehension = Reinforce / On Track / Enrich. Never "AI-powered." "Assignments" not "Homework."

**Process rule** (`COACH-POSTURE.md:119–124`): all new/changed user-facing strings go to `STRINGS-FOR-BARB.md`. Barb gates copy before ship.

### 4.2 Carry-forward 1 — exact behavioral fields the runner must capture

**Per-question behavioral columns** (posted to `/signal` in each `responses[]` item):

| Field | Type | How to capture |
|---|---|---|
| `response_time_ms` | number | `Date.now() - questionStartTime.current` at advance/submit |
| `hesitation_ms` | number | `firstInputTime.current - questionStartTime.current` |
| `answer_changes` | number | `answerChanges.current` ref incremented on each change |
| `navigation_backs` | number | `navigationBacksRef.current` incremented on prev-click |
| `pause_count` | number | incremented on each pause_end event (gap > 3s between keypresses) |
| `total_pause_ms` | number | accumulated from each pause_end `durationMs` |
| `word_count` | number | `response.trim().split(/\s+/).filter(Boolean).length` at snapshot |
| `focus_loss_count` | number | incremented on each `visibilitychange` hidden / `blur` event |
| `paste_count` | number | incremented on each `paste` event on textarea/input |
| `hints_used` | number | always 0 for Phase 3 (no hint route); capture for future |
| `question_type_scored` | string | `currentQuestion.question_type` |

**SessionAggregates fields** (posted to `/signal` in `sessionAggregates`, accumulated across all questions):

| camelCase field | Type | Source |
|---|---|---|
| `focusLossCount` | number | window blur/visibilitychange hidden events |
| `pasteCount` | number | paste events (all inputs) |
| `pauseCount` | number | pause sequences (gap > 3s between keypresses) |
| `totalPauseMs` | number | sum of all pause durations |
| `totalFocusLossMs` | number | total ms spent with window blurred |
| `backspaceCount` | number | keydown:Backspace/Delete events |
| `keypressCount` | number | total printable keydown events |
| `ttsPlayCount` | number | Teli TTS plays; increment on each `teliSpeak()` call |
| `canvasUsed` | boolean | always `false` for quiz |
| `stuckEraseCount` | number | always `0` for quiz |

### 4.3 Carry-forward 2 — Option-D: mastery_band to label, never raw score

`student-quiz` returns `existing_attempt` including `score_pct + mastery_band`. The runner must NOT render the raw score or the `mastery_band` enum value.

**How to reduce to a label:**
Use `src/components/core/MasteryLabel.tsx` — it calls `masteryDisplayLabel(band)` from `@/lib/utils/masteryLabel` and renders a uniform neutral pill with the human-readable label. This is the correct component for the done screen.

**`src/lib/copy/` helpers available for student surfaces:**

- `src/lib/copy/leakGuard.ts:23` — `hasLeak(text)`: true if text contains a bare digit, `%`, `avg`, `score N`, ordinal, percentile, or rank
- `src/lib/copy/leakGuard.ts:31` — `assertNoLeak(text, ctx?)`: throws on leak — call this on every string in the done/forfeit screens
- `src/lib/copy/effortPhrase.ts:23` — `effortPhrase(label)`: returns student-safe effort description from `EffortLabel` enum
- `src/lib/copy/reteachWorkingPhrase.ts:17` — `reteachWorkingPhrase(outcome)`: returns encouragement copy
- `src/lib/copy/trajectoryPhrase.ts:17` — `trajectoryPhrase(direction)`: "Trending upward lately." etc.
- `src/lib/copy/consistencyPhrase.ts:17` — `consistencyPhrase(label)`: "Performance has been steady." etc.
- `src/lib/copy/topicFrame.ts:22` — `topicFrame(topic)`: "still building: <TitleCase>" (no "struggling")
- `src/lib/copy/riskBandLabel.ts:15` — `riskBandLabel(score)`: converts to RiskBand — TEACHER-ONLY, do NOT use on student surface
- `src/lib/copy/sessionRiskPhrase.ts:17` — `sessionRiskPhrase(input)`: TEACHER-ONLY
- `src/lib/copy/storyLine.ts:41` — `storyLine(input)`: TEACHER-ONLY

**Copy that IS student-safe:** `effortPhrase`, `reteachWorkingPhrase`, `trajectoryPhrase`, `consistencyPhrase`, `topicFrame`, `pctIncorrectToWords` (words only, no %s). All others are teacher-side.

---

## SECTION 5: Gap Table and Route Decision

### 5.1 Runner capability gap table

| Runner capability | V1 has it | V2 has it (Phase 1–2) | Net-new to build (Phase 3) |
|---|---|---|---|
| `quizAttemptState.ts` classifier + tunables | ✓ `lib/student/quizAttemptState.ts` | ✓ `src/lib/student/quizAttemptState.ts` | — |
| `forfeitAttempt` pipeline | ✓ `lib/quiz/forfeitAttempt.ts` | ✓ `src/lib/quiz/forfeitAttempt.ts` | — |
| `isQuizAvailableForStudent` gate | ✓ `lib/quiz/isQuizAvailableForStudent.ts` | ✓ `src/lib/quiz/isQuizAvailableForStudent.ts` | — |
| `getScoreMessage` + Teli pools | ✓ inline in runner | ✓ `src/lib/quiz/scoreMessage.ts` | TTS call site |
| `computeSignals` + behavioral model | ✓ `lib/signals/signalComputer.ts` | ✓ `src/lib/signals/computeSignals.ts` | — |
| `GET /api/attempts/student-quiz` | ✓ | ✓ | — |
| `POST /api/attempts/start` (with lazy-forfeit) | ✓ | ✓ | — |
| `POST /api/attempts/[id]/signal` (heartbeat + upsert) | ✓ | ✓ | — |
| `POST /api/attempts/[id]/submit` (grader) | ✓ | ✓ | — |
| `POST /api/attempts/study-guide` | ✓ | ✓ | — |
| `GET/POST /api/attempts/quiz-history` | ✓ | ✓ | — |
| `POST /api/attempts/[id]/adapt` | ✓ | ✓ | — |
| DB migration (last_active_at, forfeit_reason, study_guide, UNIQUE constraint) | n/a | ✓ Phase 1 | — |
| Runner page (`student/quiz/page.tsx`) | ✓ 1762 lines | ✗ | **BUILD** |
| Wall-clock ring timer (SVG ring, token-only) | ✓ (hex) | ✗ | **BUILD** (token-only) |
| 15s heartbeat loop | ✓ | ✗ | **BUILD** |
| Recovery banner with `closureSecondsRemaining` countdown | ✓ (partial) | ✗ | **BUILD** |
| Lazy-forfeit 410 handler | ✓ | ✗ | **BUILD** |
| Forfeit screen (Option-D, no score) | ✓ | ✗ | **BUILD** |
| MCQ question rendering | ✓ | ✗ | **BUILD** |
| Numeric question rendering | ✓ | ✗ | **BUILD** |
| Open-response question rendering | ✓ | ✗ | **BUILD** |
| Per-question prev/next navigation | ✓ | ✗ | **BUILD** |
| Progress dots | ✓ | ✗ | **BUILD** |
| Auto-submit at `timeLeft === 0` | ✓ | ✗ | **BUILD** |
| Adaptive Q4/Q5 via `/adapt` after Q3 | ✓ | ✗ | **BUILD** |
| Behavioral capture: `response_time_ms`, `hesitation_ms`, `answer_changes`, `word_count` | ✓ via refs | ✗ | **BUILD** (inline refs) |
| Behavioral capture: `navigation_backs`, `pause_count`, `total_pause_ms` | ✓ via useEventTracker | ✗ | **BUILD** (inline listeners) |
| Behavioral capture: `focus_loss_count`, `paste_count` | ✓ via useEventTracker | ✗ | **BUILD** (inline listeners) |
| SessionAggregates (`backspaceCount`, `keypressCount`, etc.) | ✓ via useEventTracker | ✗ | **BUILD** (inline listeners) |
| Signal post on advance + final submit | ✓ | ✗ | **BUILD** |
| Post-submit done screen (Teli message, Option-D) | ✓ | ✗ | **BUILD** |
| Teli TTS call on done | ✓ `teliSpeak(teliMsg)` | ✗ | **BUILD** (or graceful omit if TTS not wired) |
| ✓/✗ per-question review accordion | ✓ | ✗ | **BUILD** |
| Study guide accordion (score < 80) | ✓ | ✗ | **BUILD** |
| Grading-pending screen | ✓ | ✗ | **BUILD** |
| `MathText` wrapping on questions + MCQ choices | ✓ | ✓ (component) | Wire it in |
| `MasteryLabel` for band display | ✗ (V1 showed score) | ✓ (component) | Wire it in |
| `assertNoLeak` on all student strings | partial (V1 ad-hoc) | ✓ (helper) | Wire it in |
| Component tests (jsdom) | ✗ | ✗ | **BUILD** |
| Leak-audit test | ✗ | ✗ | **BUILD** |
| `STRINGS-FOR-BARB.md` proposals | ✗ | ✗ | **DRAFT** |
| `useEventTracker` hook (event stream to student_events) | ✓ | ✗ | **SKIP** (aggregate-only; no student_events table in V2) |
| Per-question hint route | ✓ `[id]/hint/route.ts` | ✗ | **DEFER** to v1.1 (capture `hints_used=0` now) |
| XP mechanic (engagement points) | ✓ | ✗ | **DEFER** (not in spec) |
| `LearningStyleCard` | ✓ | ✗ | **DEFER** (not in spec) |
| Audio cues (playTick, playBuzzer) | ✓ Web Audio API | ✗ | **OPTIONAL** (can omit; not in spec) |
| sessionStorage nav-block | V1 does NOT have it | ✗ | Do not build |

### 5.2 Route location recommendation

**Recommendation: `src/app/(student)/student/quiz/page.tsx`** — a dedicated route, NOT an extension of assignments.

**Rationale:**

1. **V1 precedent:** V1 uses a dedicated route `app/(dashboard)/student/quiz/page.tsx` separate from `app/(dashboard)/student/homework/page.tsx`. The quiz is a timed, ephemeral, single-session surface with its own lifecycle (start/heartbeat/forfeit/grading-pending). Assignments are longer-form, saveable, and multi-session. Mixing them into one route creates state-machine complexity that neither V1 nor the V2 spec recommends.

2. **Routing shape:** `GET /api/attempts/student-quiz` returns a single active quiz for the class. The runner navigates to its own URL so the student can be deep-linked from a notification or the "Ready" banner on the dashboard. If embedded in `assignments/[id]`, there is no clean way to handle `grading-pending` returning the student to the right screen.

3. **`(student)/layout.tsx` convention:** the layout gates by `requireRole(['student'])` and renders `data-role="student"`. A standalone `/student/quiz` page is a sibling of `/student/assignments` and `/student/growth` — clean and symmetrical with V2's nav structure.

4. **Spec alignment:** `docs/superpowers/specs/2026-06-20-quiz-runner-design.md:§9` explicitly states: `src/app/(student)/student/quiz/page.tsx ('use client')`.

**Preferred implementation pattern:** thin server wrapper + inner client component.
```
src/app/(student)/student/quiz/
  page.tsx        ← server component (thin: requireRole, pass userId/schoolId/tier as props)
  _components/
    QuizRunner.tsx     ← 'use client' — all state, timers, API calls, behavioral capture
    QuizTimer.tsx      ← 'use client' — SVG ring timer
    QuestionCard.tsx   ← question rendering by type (MCQ/numeric/open)
    ResultScreen.tsx   ← done/forfeit/grading-pending screens
    RecoveryBanner.tsx ← recovery/resume banner
```

This mirrors the SparkLaunchCard pattern (`assignments/[id]/page.tsx` + `_components/SparkLaunchCard.tsx`) and keeps the runner manageable at ~300–400 lines per component instead of V1's monolithic 1762 lines.

---

## SECTION 6: Surprises and Implementation Notes

### 6.1 Surprise: V2 signal route already accepts `sessionAggregates`

`src/app/api/attempts/[attemptId]/signal/route.ts:86–89` accepts `sessionAggregates?: Record<string, unknown>` and upserts it into `quiz_attempts.session_aggregates` jsonb. The `quiz_attempts.session_aggregates` column was added in Phase 1 (migration 0014 is referenced in the signal route's L20–21 note). This means the runner can post all SessionAggregates via the existing heartbeat/signal flow without any new route.

### 6.2 Surprise: `student/layout.tsx` uses CSS var syntax (not token class)

`src/app/(student)/layout.tsx:16` uses `text-[var(--fg)]` and `hover:text-[var(--brand)]` — this violates the Tier-2 token-only discipline. Do NOT copy this pattern into the runner. Use `text-fg`, `hover:text-brand` (Tailwind token classes) throughout the runner.

### 6.3 `navigation_backs` not directly tracked in V1 quiz refs

V1 tracks `question_prev` as a `trackEvent` call (via `useEventTracker`) but does NOT accumulate `navigation_backs` as a counter in `signals.current`. The `quiz_responses.navigation_backs` column exists and is listed in `ResponseSignal` interface in `signal/route.ts:30–46` — but V1 never populated it from the quiz runner (it was populated from the homework runner instead). V2 must add a `navigationBacksRef` counter incremented on prev-click and post it per-question in `responses[]`.

### 6.4 V2's `forfeitAttempt.ts` reconciles the band off-by-one

V1's inline forfeit band cut was `>=51 grade_level` vs. `computeMasteryBand`'s `<=50 reteach`. V2's `src/lib/quiz/forfeitAttempt.ts` calls `computeMasteryBand(scorePct)` as the single source (`forfeitAttempt.ts:line 5 import`), so the off-by-one is already resolved in Phase 1.

### 6.5 `quiz-history` GET Option-D is already in place

`quiz-history/route.ts:108–110` explicitly excludes `score_pct` and `mastery_band` from the GET response. The runner's history/review screen just needs to render `is_correct` + explanations — no additional filtering needed.

### 6.6 Teli TTS wiring is unclear

`getScoreMessage` returns `{ message, teliMsg, teliState }`. V1 calls `teliSpeak(teliMsg)` after setting done state. V2's codebase has Teli avatar components in the teacher shell, but no `teliSpeak()` function is visible in the V2 src. Before implementing TTS, check `src/components/` for a Teli component and confirm the TTS call site exists. If not, the runner should render `teliMsg` as static text (still coaching-register correct) and TTS can be wired in later.

### 6.7 `computeSignals` is called on submit (in the submit route hook)

The spec states that `submit/route.ts` must be extended with a fail-isolated hook calling `computeSignals()` + storing results in `behavioral_signals`. This is Phase 3 work that technically touches Phase 1 code. The runner UI's submit sequence assumes this hook fires server-side — the client just calls `/submit` and awaits `{ attempt_id, score_pct, mastery_band, grades }` or `{ grading_delayed: true }`.

### 6.8 `quiz_attempts.session_aggregates` column

The signal route (`signal/route.ts:97–113`) upserts `session_aggregates` alongside `last_active_at`. Confirm this column exists in the Phase 1 migration (`supabase/migrations/0013_quiz_runner.sql` or `0014`). If missing, it must be added before the SessionAggregates post can succeed.

---

## Appendix A: Fast-path reuse map for the implementer

```
Load active quiz:          GET  /api/attempts/student-quiz     (Phase 2, built)
Start/resume/forfeit:      POST /api/attempts/start             (Phase 2, built; 410 = forfeit)
Heartbeat liveness:        POST /api/attempts/{id}/signal   { heartbeat:true }  (Phase 2, built)
Save per-Q signals:        POST /api/attempts/{id}/signal   { responses, sessionAggregates }  (Phase 2, built)
Adaptive Q4/Q5:            POST /api/attempts/{id}/adapt        (Phase 1, built)
Grade quiz:                POST /api/attempts/{id}/submit        (Phase 1, built; existing grader)
Study guide:               POST /api/attempts/study-guide        (Phase 2, built)
History/review:            GET  /api/attempts/quiz-history       (Phase 2, built)

Timer math:                src/lib/student/quizAttemptState.ts  (Phase 1, built)
  quizTimeRemainingSeconds  → drives ring
  closureSecondsRemaining   → drives recovery banner countdown
  classifyAttemptState      → drives all screen transitions

Forfeit pipeline:          src/lib/quiz/forfeitAttempt.ts        (Phase 1, built; called server-side in /start)
Teli message pools:        src/lib/quiz/scoreMessage.ts          (Phase 1, built)
  getScoreMessage(pct, attemptId, 'en', tier, firstName)
Leak guard:                src/lib/copy/leakGuard.ts             (built)
  assertNoLeak(text, 'ResultScreen') — call on EVERY student-facing string
Mastery label:             src/components/core/MasteryLabel.tsx  (built)
Math rendering:            src/components/core/MathText.tsx      (built)
Card chrome:               src/components/core/Card.tsx          (built; use tone='brand' for question card)
Empty state:               src/components/core/EmptyState.tsx    (built; use for no-quiz state)
Behavioral types:          src/lib/signals/behavioralTypes.ts    (Phase 1, built)
  SessionAggregates — exact fields to capture
```

## Appendix B: Component tree (proposed)

```
src/app/(student)/student/quiz/
  page.tsx                       ← server component
    └─ QuizRunner.tsx            ← 'use client', ~400 lines
         ├─ (loading)            → spinner
         ├─ (no-quiz)            → EmptyState variant='just-getting-started'
         ├─ (ready)              → quiz notification card + Start button
         ├─ (taking)
         │    ├─ RecoveryBanner  ← shows on resuming_after_gap
         │    ├─ QuizTimer       ← SVG ring, token-only colors
         │    ├─ QuestionCard    ← MCQ | numeric | open + MathText wrapping
         │    ├─ ProgressDots    ← per-question pill dots
         │    └─ Prev/Next/Submit buttons
         ├─ (submitting)         → overlay with time-up message or spinner
         ├─ (grading-pending)    → "AI is grading" screen + back CTA
         ├─ (done)
         │    ├─ TeliMessage     ← getScoreMessage result + teliState avatar
         │    ├─ MasteryLabel    ← band label (neutral pill, no color)
         │    ├─ QuestionReview  ← ✓/✗ accordion (no numeric scores)
         │    └─ StudyGuide      ← accordion (score < 80 only)
         └─ (forfeit)            → gentle copy, band label, no score, back CTA
```

## Appendix C: Strings requiring Barb sign-off (STRINGS-FOR-BARB.md)

All strings below are net-new or V1 copy requiring V2 leak-guard verification before ship:

1. Quiz taking screen header / timer label at each threshold (Normal / Warning / Danger)
2. Recovery banner body (elapsed gap copy + "N minutes to close" warning)
3. Auto-submit overlay ("Time's up / Submitting…")
4. Forfeit screen: eyebrow, reason copy (closure / time_up variants), body, CTA
5. Grading-pending screen: title, body, CTA
6. Done screen: heading ("You finished the quiz!"), "what happens next" section
7. Per-question review accordion label ("How did you do?")
8. Study guide accordion label + loading copy + failed copy + strong-performance alt
9. No-quiz empty state copy

All must pass `assertNoLeak()` before ship.
