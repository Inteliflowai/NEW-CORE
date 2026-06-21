# Grounding — V2 Copy Discipline (Assignment Player / Teli)

> Verbatim current-code facts captured 2026-06-21 for the Epic-2 Non-SPARK
> Assignment Player spec. **Reports what EXISTS — no critique, no proposals.**
> All quoted identifiers, prompts, enums, and routes are exact. Paths absolute.

---

## 0. TL;DR for the spec author

- The Assignment Player's student strings + Teli replies cross the **same
  four-audience string boundary** the Quiz Runner already uses: every
  student-facing string must pass **`assertNoLeak`** (no numbers/%/score-N/
  ordinals/percentile/rank) AND must obey the **COACH-POSTURE banned-words**
  list (`assertNoBannedWord` / `hasBannedWord`).
- **Option-D is locked:** students/parents NEVER receive a raw `score_pct`,
  raw `mastery_band` enum, or a `%`. The single server-side translation point
  is `studentResultBundle()` (score+band → words) backed by
  `getScoreMessage()` (Teli message pools) and `masteryDisplayLabel()` (band →
  soft label). Routes ship the pre-built bundle; the client never holds a number.
- **The Teli TUTOR pools (the hint-ladder nudge→cue→step→answer_blocked
  voice + system prompt) are NOT yet ported to V2.** V2 currently has ONLY the
  **post-quiz** Teli `scoreMessage` pools. The tutor lives in V1
  (`C:/users/inteliflow/core/lib/teli/prompts.ts` + `.../homework/actions.ts`)
  and is the completeness floor the Player must port. Its leak-audit status in
  V2 = **does not exist yet → must be built + leak-guarded at the boundary.**
- V2 has **`OPENAI_VOICE_MODEL`** (`gpt-4o`, env-overridable) reserved with the
  literal comment "Teli chat, tutor/hint" — the model slot is wired, the prompt
  is not.

---

## 1. The banned-words list (verbatim)

`src/lib/copy/leakGuard.ts` lines 44–47:

```ts
/**
 * COACH-POSTURE banned words — metric/engineering jargon never shown to users.
 * "risk" is intentionally NOT here (it appears in established teacher copy).
 */
export const BANNED_WORDS: readonly string[] = [
  'score', 'percentile', 'index', 'divergence', 'threshold',
  'signal', 'model', 'algorithm', 'flag',
];
```

Matching is **whole-word, case-insensitive**:
`new RegExp(\`\\b(?:${BANNED_WORDS.join('|')})\\b\`, 'i')`.
So `'their score went up'` → banned, but `'at risk of falling behind'`,
`'flagship lesson'`, `'indexed earlier'` → NOT banned (substring / `risk`
exempt). Confirmed by `src/lib/copy/__tests__/leakGuard.test.ts`.

**`COACH-POSTURE.md` Language Standard** also names a banned set in prose
(superset of the code list, used as the review lens, not all mechanically
enforced): **score, percentile, index, divergence, threshold, signal, model,
algorithm, flag** — "engineering terms, internal field names, and acronyms a
layperson would not know." Plus established term rules:
- **"Mastery"**, not "Band."
- **Never "adaptive"** in front of users → use **personalized / differentiated**.
- **Comprehension** band words for users are **Reinforce / On Track / Enrich**.
- Never lead with **"AI-powered."**
- **"Assignments"**, never **"Homework"** (legacy survives only in DB
  identifiers like `homework_attempts`).

---

## 2. The leakGuard API (verbatim signatures)

`src/lib/copy/leakGuard.ts` — pure, import-safe (no Next/Supabase).

`LEAK_PATTERNS: RegExp[]` (a "leak" = numeric/statistical):
```ts
export const LEAK_PATTERNS: RegExp[] = [
  /\d/,                          // any bare digit
  /%/,                           // percent sign
  /\bavg\b/i,                    // "avg"
  /\bscore\s+\d/i,               // "score <number>"
  /\d+(?:st|nd|rd|th)\b/i,       // ordinals: 2nd, 73rd, 1st …
  /\bpercentile\b/i,             // the word "percentile"
  /\brank(?:ed)?\b/i,            // "rank" or "ranked"
];
```

Functions:
- `hasLeak(text: string): boolean` — true if ANY leak pattern matches.
- `assertNoLeak(text: string, ctx?: string): void` — **throws**
  `"[ctx] Audience-copy leak detected in: \"<text>\""` if `hasLeak`.
- `hasBannedWord(text: string): boolean` — true if a `BANNED_WORDS` whole-word
  match (case-insensitive).
- `assertNoBannedWord(text: string, ctx?: string): void` — **throws**
  `"[ctx] Banned coach-posture word detected in: \"<text>\""` if `hasBannedWord`.

**There is no copy barrel** (`src/lib/copy/index.ts` does NOT exist); import the
helpers directly from `@/lib/copy/leakGuard`.

---

## 3. The Option-D rule — students/parents never see raw score_pct / mastery_band / %

**Locked rule (spec §4 quoted verbatim in
`docs/superpowers/specs/2026-06-20-quiz-runner-design.md`):**

> Option-D (locked): students **never** see the numeric score/percentage. Band
> pill + qualitative coaching copy only; score flows server-side. Every
> student-facing string routes through `src/lib/copy` and is checked with
> `assertNoLeak(...)`.

Enforcement points already built (the Player must follow the same pattern):
- `studentResultBundle()` is **"the ONLY place that converts a raw
  number/enum into student copy"** (file header comment). Routes call it
  server-side and ship the bundle; the runner **never receives a percentage or
  a raw band over the wire.**
- Routes build responses **field-by-field, NO row spread**, with explicit
  comments that `score_pct` / `mastery_band` are never copied out:
  - `src/app/api/attempts/[attemptId]/submit/route.ts` (line ~456 "Build the
    student-safe result bundle (Option-D server boundary)").
  - `src/app/api/attempts/student-quiz/route.ts` (line 195 "Option-D: build
    field-by-field; score_pct / mastery_band are NEVER copied out").
  - `src/app/api/attempts/quiz-history/route.ts` (lines 100–110, 206–226:
    "Build response array FIELD-BY-FIELD (Option-D: no row spread)"; review
    payload is `{ review }` only — **no overall score key**).
- The **render boundary** re-checks: `ResultScreen.tsx` runs `assertNoLeak` on
  every rendered string ("belt-and-suspenders … the last line of defense").
- **Teacher-side parallel (Option-D too):** `loadStudentSignals.ts:274`
  translates the raw EMA model to words server-side; only the word-level
  `CoachObservation` is added to `StudentSignals`. No digit/%/raw score reaches
  any client payload or the DOM. (Player is student-facing, but the Player's
  signals it emits feed this same teacher pipeline.)

**Leak-audit tests prove the chain** (the Player will need equivalents):
- `src/lib/quiz/__tests__/scoreMessage.test.ts` iterates EVERY variant in BOTH
  pools and asserts `hasLeak(message) === false && hasLeak(teliMsg) === false`
  (EN pool = 48 variants; PT pool audited too).
- `src/app/(student)/student/quiz/_components/__tests__/QuizRunner.leak.test.tsx`
  renders the real server bundle → DOM and asserts `container.textContent`
  matches no `/\d/`, no `%`, and never contains the raw band enum string
  (`reteach`/`grade_level`/`advanced`).

---

## 4. How the quiz result bundle translates score → words SERVER-side

`src/lib/quiz/studentResultBundle.ts` (pure, framework-agnostic):

```ts
export interface StudentResultBundleInput {
  scorePct: number;
  masteryBand: string | null;
  tier: Tier;               // 'elementary' | 'middle' | 'high'
  firstName: string | null;
  attemptId: string;
  locale?: 'en' | 'pt';
}
export interface StudentResultBundle {
  scoreMessage: { message: string; teliMsg: string;
                  teliState: 'celebrating' | 'idle' | 'speaking' };
  masteryLabel: string;
  needsStudyGuide: boolean;
}
export function studentResultBundle(input): StudentResultBundle {
  const scoreMessage = getScoreMessage(scorePct, attemptId, locale, tier, firstName);
  const masteryLabel = masteryDisplayLabel(masteryBand);
  const needsStudyGuide = scorePct < 80;     // study-guide threshold
  return { scoreMessage, masteryLabel, needsStudyGuide };
}
```

**Band cut points** (`getScoreMessage`, `scoreMessage.ts:222–223`):
`pct >= 90 → 'celebrating'`, `>= 75 → 'strong'`, `>= 60 → 'effort'`,
else `'tough'`. (These `Band` values index the message pools — NOT the same as
the DB `mastery_band` enum.)

**Tier** (voice register), `src/lib/quiz/gradeTextToTier.ts`: parses grade_level
text → K–5 `elementary`, 6–8 `middle`, 9–12 `high`, unparseable `middle`.

**`masteryDisplayLabel`** (`src/lib/utils/masteryLabel.ts`) — the band→soft-label
map (the ONLY thing a student sees of the band):
```ts
const BAND_LABELS: Record<string, string> = {
  reteach: 'Building',
  grade_level: 'On Track',
  advanced: 'Strong',
};
// null / unknown → 'Not yet assessed'
```

**`getScoreMessage(pct, seed, locale, tier, firstName)`** picks a variant
deterministically (`pickVariantStable` — pure hash, no localStorage; V1's
localStorage de-dup branch was dropped) and substitutes `{name}` via
`applyName` (drops the placeholder + trailing comma/space cleanly when no
name). Returns `{ message, teliMsg, teliState }`. In non-production it runs a
runtime `hasLeak` warning on the substituted output.

**Post-quiz Teli `teliState` values:** `'celebrating' | 'idle' | 'speaking'`
(distinct from the V1 TUTOR `teliState`, which includes `'thinking'`).

---

## 5. Where the V2 Teli pools live, and their leak-audit status

### 5a. EXISTS in V2 — post-quiz `scoreMessage` pools (leak-audited, clean)

`src/lib/quiz/scoreMessage.ts` — "ported verbatim from V1
`app/(dashboard)/student/quiz/page.tsx:162-395`." Two pools:
- `SCORE_VARIANTS_EN_BY_TIER: Record<Tier, Record<Band, ScoreVariant[]>>` —
  tier-aware (elementary playful+emoji, middle friendly, high peer-equal
  no-emoji), `{name}` placeholder, 4 variants per (tier × band) = 48.
- `SCORE_VARIANTS_PT: Record<Band, ScoreVariant[]>` — pt-BR, `você` informal,
  10 variants per band. Each `ScoreVariant = { message, teliMsg, teliState }`.
  `teliMsg` is the TTS-spoken line (minimal emoji because TTS reads them weirdly).
- **Leak-audit status: GREEN.** Every variant is asserted leak-free in
  `scoreMessage.test.ts` (§3 above). These are the post-quiz Teli VOICE — they
  congratulate/console after grading; they are NOT the in-task hint tutor.

### 5b. DOES NOT EXIST in V2 yet — the Teli TUTOR (hint ladder + system prompt)

- **No `src/lib/teli/` directory in V2** (confirmed absent).
- **No tutor system prompt, no hint-ladder constants, no tutor API route** for a
  non-SPARK assignment player in V2. `src/lib/openai/prompts.ts` (1060 lines,
  "LIFT verbatim from V1") contains lesson-parse, quiz-gen, math-quiz-gen,
  grading, learning-style, and assignment-gen prompts — **but NOT a
  `tutorSystemPrompt`/Teli tutor prompt.** (V1's `prompts.ts` has
  `tutorSystemPrompt` at line 1098; V2's does not.)
- **Model slot reserved:** `src/lib/ai/models.ts`:
  ```ts
  /** OpenAI model for non-graded voice/tone surfaces (Teli chat, tutor/hint, etc.).
   *  PILOT LEVER — env-overridable; defaults to gpt-4o so an unset var changes nothing. */
  export const OPENAI_VOICE_MODEL = process.env.OPENAI_VOICE_MODEL || 'gpt-4o';
  ```
  Also `OPENAI_GEN_MODEL = 'gpt-4o'` (CALIBRATION-SENSITIVE, frozen),
  `CLAUDE_GRADING_MODEL = 'claude-sonnet-4-6'` (calibration-locked grader),
  `CLAUDE_GEN_MODEL = 'claude-sonnet-4-6'` (assignment-gen). `tokenLimitParams`
  / `usesLegacyTokenParam` handle `max_tokens` vs `max_completion_tokens`.
- **Leak-audit status of the V2 tutor: N/A — it doesn't exist.** When ported,
  every student-facing Teli tutor reply that the Player renders must pass
  `assertNoLeak` + `assertNoBannedWord` at the boundary (the V1 tutor did NOT
  leak-guard — it was free-form LLM output rendered ad-hoc; V2 must add the
  guard). Note: a live LLM reply is not a fixed pool, so the audit is a runtime
  boundary check on rendered output, not a per-variant unit test.

---

## 6. V1 Teli TUTOR — the completeness floor to port (verbatim)

Source: `C:/users/inteliflow/core/app/(dashboard)/student/homework/actions.ts`
(`sendTutorMessage`) + `C:/users/inteliflow/core/lib/teli/prompts.ts`
(`buildTeliPrompt`) + `C:/users/inteliflow/core/lib/openai/prompts.ts`
(`tutorSystemPrompt`).

### 6a. Hint ladder (4 levels, server-authoritative)

```ts
const HINT_LADDER = ['nudge', 'cue', 'step', 'answer_blocked'] as const;
const HINTS = {
  nudge:          'Ask a thought-provoking question pointing right direction. Do NOT give any part of the answer.',
  cue:            'Narrow focus with a key concept. Do not give the answer.',
  step:           'Give step-by-step scaffold. Do not give the final answer.',
  answer_blocked: 'Student used all hints. Encourage effort. No direct answer.',
};
```
- On each help request: `helpRequestCount += 1`;
  `hintType = HINT_LADDER[Math.min(newScaffoldDepth, 3)]`;
  `newScaffoldDepth = Math.min(newScaffoldDepth + 1, 3)`; `hintCount += 1`.
- Returns `{ response, hint_type, scaffold_depth, hints_remaining:
  Math.max(0, 3 - newScaffoldDepth), help_request_count }`.
- **3 hints per task.** Client mirrors with `hintsRemaining` (init 3), a hard
  client cap (`if (hintsRemaining <= 0) return;` for both text + voice), and
  resets to 3 on task change. Voice input must NOT bypass the cap.
- DB: V1 used tables `tutor_sessions` (cols incl. `scaffold_depth`,
  `help_request_count`, `hint_count`, `scaffold_dependency_score`,
  `tasks_completed`, `tasks_total`, `status`, `mastery_band`, `learning_style`)
  and `tutor_messages` (cols incl. `role`, `content`, `message_index`,
  `task_index`, `is_help_request`, `hint_type`, `scaffold_level`). Behavioral
  signals flushed to `signal_events` (`event_type: 'homework_task'`,
  `source_module: 'homework'`, `signal_family: 'behavioral'`, `schema_version:
  'v1'`). **These tables/columns are V1 — confirm/port to V2 schema in the
  schema-grounding pass; this fragment only reports the V1 facts.**

### 6b. Teli TUTOR system prompt + voice constants (V1 `lib/teli/prompts.ts`)

`TELI_SYSTEM_PROMPT` (verbatim):
> You are Teli, a warm and encouraging Socratic AI tutor for K-12 students on
> the CORE learning platform.
> Core rules:
> - NEVER reveal answers directly — always guide with questions
> - Keep responses under 3 sentences
> - Adapt tone to the student's frustration level: calm and patient when
>   frustrated, enthusiastic when engaged
> - Always end with an encouraging question or statement
> - Use age-appropriate language
> - Be warm, supportive, and celebrate effort over correctness
> - When a student is stuck on the same step twice, offer a DIFFERENT approach
>   — not the same explanation louder. … One-way-only teaching is i-Ready's
>   failure mode; you are the opposite of that.
> - When the student successfully unblocks themselves, name the THINKING move
>   they used … This is how they build self-knowledge of how they learn.

Other V1 Teli constants:
- `TELI_HINT_LABELS = { nudge: '💭 Teli Nudge', cue: '🔑 Teli Cue', step: '📋
  Teli Walkthrough', answer_blocked: '🚫 Hints exhausted' }` (the badge shown
  above each hint reply).
- `TELI_INTRO_MESSAGE = "Hi! I'm Teli, your learning buddy 👋 …"`.
- `TELI_CATCHPHRASES` (5 lines, e.g. "You're closer than you think!").
- `buildTeliPrompt({ dominantStyle, struggleTopics, scaffoldLevel })` appends
  per-student personalization: `STYLE_HINTS` (visual/auditory/kinesthetic/text/
  emerging), up to 5 `struggleTopics`, and scaffold depth
  (high/low/moderate). It reads `student_model` (`dominant_style`,
  `struggle_topics`, `preferred_scaffold_level`).
- `tutorSystemPrompt(assignmentContent, lessonSummary)` (the assignment-context
  system prompt, V1 `lib/openai/prompts.ts:1098`): "NEVER state the direct
  answer", Socratic questioning, "Speak to a student, not a teacher."
- V1 call: `openai.chat.completions.create({ model: OPENAI_GEN_MODEL, messages:
  [{role:'system', content: withLocaleInstruction(teliPrompt + assignmentContext
  + hintInstruction)}, ...history, {role:'user', content: message}],
  temperature: 0.7, max_tokens: 500 })`.

### 6c. V1 client state worth knowing (homework `page.tsx`)

- `teliState` includes `'thinking'` (set while a tutor reply is loading) — a
  **4th** state beyond the post-quiz `celebrating/idle/speaking`.
- Adaptation trigger: after **2 hint requests** on a task, the task auto-adapts
  (`if (hintCount >= 2 && !adaptedTasks[idx]) adaptTask(idx)`).
- Events tracked: `trackEvent('hint_request', { taskIndex, taskDescription,
  input_method? })`, `FeedbackThumbs event="teli_hint_rated"`.
- Voice/TTS: `<TeliVoiceButton onTranscript onStateChange={setTeliState}>` for
  both task-response dictation and Ask-Teli voice input.
- Graded submit posts to `/api/attempts/homework-submit` with
  `{ assignment_id, class_id, diagram_url, response_text, responses }` where
  `responses` is keyed by `task.step` (`responsesByStep`).

---

## 7. What an Assignment Player's student strings + Teli replies must satisfy at the string boundary

A consolidated checklist derived from the code above (facts, not
recommendations):

1. **Pass `assertNoLeak`** — no bare digit, no `%`, no `avg`, no `score <N>`, no
   ordinal, no `percentile`, no `rank(ed)` in any student-rendered string.
2. **Pass `assertNoBannedWord`** — none of: score, percentile, index,
   divergence, threshold, signal, model, algorithm, flag (whole-word, CI).
   `risk` is allowed.
3. **Option-D:** the Player's API responses must build student payloads
   field-by-field and never ship `score_pct` or the raw `mastery_band` enum.
   Any score→words translation happens server-side (the `studentResultBundle`
   pattern); band → `masteryDisplayLabel` soft word only.
4. **"Assignments", never "Homework"** in all UI/copy (DB identifiers like
   `homework_attempts` / `/api/attempts/homework-submit` exempt).
5. **Established term rules:** "Mastery" not "Band"; never "adaptive" →
   personalized/differentiated; never lead "AI-powered"; comprehension words =
   Reinforce / On Track / Enrich.
6. **Teli tutor voice (port from V1, then guard):** Socratic, never reveals the
   answer, ≤3 sentences, ends encouraging, celebrates effort over correctness,
   names the thinking move on unblock, offers a DIFFERENT angle on repeat
   stuck. Hint ladder nudge→cue→step→answer_blocked, 3 hints/task,
   server-authoritative scaffold depth. Every rendered reply must still clear
   `assertNoLeak` + `assertNoBannedWord` at the render boundary (V1 did NOT
   guard tutor output — V2 adds this).
7. **COACH-POSTURE Rule 6 ("Not a chatbot"):** the tutor is rare/precise input,
   not a constantly-talking assistant. (Behavioral/layout test, not a string
   test — flagged here because the Player introduces a conversational surface,
   the exact thing the posture warns against over-building.)
8. **Render-boundary belt-and-suspenders:** even with server-side guarding,
   the component re-runs `assertNoLeak(str, 'ctx')` on each rendered string
   (the `ResultScreen.tsx` precedent), and a `.leak.test.tsx` renders the real
   server bundle → DOM and asserts no `/\d/`, no `%`, no raw enum.
9. **Process:** all new user-facing strings are DRAFTS → go to
   `STRINGS-FOR-BARB.md` (exists, ~14 KB); **Barb gates all copy.** Existing
   quiz-runner copy drafts live under `STRINGS-FOR-BARB.md §Quiz-Runner-Phase3`.

---

## 8. File inventory (absolute paths)

V2 (current):
- `C:/users/inteliflow/NEW-CORE/COACH-POSTURE.md`
- `C:/users/inteliflow/NEW-CORE/src/lib/copy/leakGuard.ts`
- `C:/users/inteliflow/NEW-CORE/src/lib/copy/coachObservation.ts`
- `C:/users/inteliflow/NEW-CORE/src/lib/copy/__tests__/leakGuard.test.ts`
- `C:/users/inteliflow/NEW-CORE/src/lib/copy/pctIncorrectToWords.ts`
- `C:/users/inteliflow/NEW-CORE/src/lib/copy/riskBandLabel.ts`
- `C:/users/inteliflow/NEW-CORE/src/lib/quiz/scoreMessage.ts`
- `C:/users/inteliflow/NEW-CORE/src/lib/quiz/studentResultBundle.ts`
- `C:/users/inteliflow/NEW-CORE/src/lib/quiz/gradeTextToTier.ts`
- `C:/users/inteliflow/NEW-CORE/src/lib/quiz/__tests__/scoreMessage.test.ts`
- `C:/users/inteliflow/NEW-CORE/src/lib/utils/masteryLabel.ts`
- `C:/users/inteliflow/NEW-CORE/src/lib/ai/models.ts`
- `C:/users/inteliflow/NEW-CORE/src/lib/openai/prompts.ts` (no tutor prompt)
- `C:/users/inteliflow/NEW-CORE/src/app/(student)/student/quiz/_components/ResultScreen.tsx`
- `C:/users/inteliflow/NEW-CORE/src/app/(student)/student/quiz/_components/__tests__/QuizRunner.leak.test.tsx`
- `C:/users/inteliflow/NEW-CORE/STRINGS-FOR-BARB.md`
- (ABSENT in V2: `src/lib/teli/`, `src/lib/copy/index.ts`)

V1 (completeness floor — Teli tutor):
- `C:/users/inteliflow/core/app/(dashboard)/student/homework/actions.ts`
- `C:/users/inteliflow/core/app/(dashboard)/student/homework/page.tsx` (~112 KB)
- `C:/users/inteliflow/core/lib/teli/prompts.ts`
- `C:/users/inteliflow/core/lib/openai/prompts.ts` (`tutorSystemPrompt` @1098)
