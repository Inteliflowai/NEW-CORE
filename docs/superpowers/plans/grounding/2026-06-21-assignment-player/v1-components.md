# V1 Grounding — Assignment Player presentational components (verbatim)

**Scope:** the small student-facing components the V1 homework player composes. All facts below are **verbatim from current V1 code** at `C:/users/inteliflow/core`. No critique, no proposals — current-state only. Captured for the V2 "Assignment Player" (Epic 2) spec author.

> **V2 porting caveat (factual, not a fix):** every component below styles via **inline `style={{}}` objects with hardcoded hex** (e.g. `#6366f1`, `#fafaf9`, `#1c1917`, `#78716c`, `#e7e5e4`, `#0f172a`, `#e2e8f0`, `#64748b`). The V2 design system **forbids hardcoded hex / arbitrary `[var(--..)]` in components** (token classes only, content text `text-fg`). So none of these styles port directly — the *structure, copy, props, and UX behavior* port; the styling is re-expressed in V2 tokens. This is recorded because it is load-bearing for the port effort estimate.

Files read in full:
- `components/student/homework/HomeworkListView.tsx` (149 lines)
- `components/student/homework/StateScreens.tsx` (164 lines)
- `components/student/homework/Btn.tsx` (16 lines)
- `components/student/ChoiceBlock.tsx` (232 lines)
- `components/student/IGotThisOffer.tsx` (240 lines)
- `components/student/HugInlineNotification.tsx` (71 lines)
- Supporting (read for prop/contract definitions): `components/student/homework/types.ts`, `components/student/homework/helpers.ts`

---

## Cross-cutting facts

- All are **`'use client'`** components.
- `HomeworkListView`, `StateScreens`, `ChoiceBlock`, `IGotThisOffer` all use the i18n hook **`useTranslations()` from `@/lib/i18n`**; copy comes from the `t.*` namespaces (`t.studentPages.*`, `t.common.*`, `t.choice.*`, `t.iGotThis.*`).
- Date locale: `HomeworkListView` derives `HW_DATE_LOCALE = getBrand().locale === 'pt' ? 'pt-BR' : 'en-US'` (`@/lib/brand`).
- Font is hardcoded everywhere: `fontFamily: "'DM Sans', system-ui, sans-serif"`.
- These pieces were **"extracted verbatim, behavior-frozen (2026-06-11)"** from `app/(dashboard)/student/homework/page.tsx` — i.e. the page still owns gating + data fetching; these are purely presentational and reproduce the original inline handlers exactly.

---

## 1. `HomeworkListView.tsx` — assignment list (entry surface)

**Responsibility:** renders the student's list of assignments (the player's launch screen). Handles class-filter tabs, empty/loading states, the parallel **SPARK Challenges** section, and the standard assignment rows with per-status pills.

**Props (verbatim):**
```ts
{
  hwList: HomeworkListItem[];
  hwClasses: { id: string; name: string }[];
  hwSelectedClass: string;
  hwLoading: boolean;
  onSelectAll: () => void;
  onSelectClass: (classId: string) => void;
  onSelectHomework: (assignmentId: string) => void;
}
```
`HomeworkListItem` (from `types.ts`):
```ts
type HomeworkListItem = {
  assignment_id: string; title: string; class_id: string; class_name: string;
  teacher_name: string; created_at: string; status: string; score: number | null;
};
```
Runtime rows also carry `spark_attempt_id`, `assignment_mode`, `effort_label`, `spark_experiment_id`, `spark_rubric_dimensions`, `spark_ai_layer`, `spark_completed_at`, `spark_content_quality` — read via `Record<string, unknown>` casts.

**Behavior / patterns:**
- Filter: `const filtered = hwSelectedClass === 'all' ? hwList : hwList.filter(h => h.class_id === hwSelectedClass)`.
- Class tabs render only when `hwClasses.length > 1`. Buttons: "All classes" (`t.studentPages.allClasses`) + one per class. Active tab styled indigo (`border #6366f1`, `bg #eef2ff`, `color #4338ca`).
- **Loading:** centered text `t.common.loading`.
- **Empty (filtered.length === 0):** card with `📋`, title `t.studentPages.noHomeworkYet`, body `t.studentPages.homeworkWillAppear`.
- **SPARK section** (renders when any filtered row has truthy `spark_attempt_id`): header `⚡ {t.studentPages.sparkChallenges}` then one `<SparkAssignmentCard>` per spark row, then a `📋 {t.studentPages.homeworkSectionLabel}` divider. `SparkAssignmentCard` import: `@/components/homework/SparkAssignmentCard`; props passed: `assignmentId, title, dueDate={null}, status (('assigned'|'in_progress'|'completed')||'assigned'), score, effortLabel, sparkExperimentId, initialRubricDimensions, initialAILayer, initialCompletedAt, initialContentQuality ('engaged'|'minimal'|'non_engaged'|null)`.
- **Standard rows** filter out legacy `assignment_mode === 'spark_experiment'` rows. Per-row status logic:
  - `isGraded = hw.status === 'graded'`
  - `isSubmitted = hw.status === 'submitted' || hw.status === 'pending_grade'`
  - `isPending = !isGraded && !isSubmitted`
  - Graded rows derive a qualitative pill via **`hwGradePill(score)` from `@/lib/copy/hwGradePill`** giving `{ color, bg, border, label, detail }`. Default-fallback colors: graded `#047857`/`#ecfdf5`/`#a7f3d0`; submitted `#f59e0b`/`#fffbeb`/`#fde68a`; pending `#6366f1`/`#eef2ff`/`#c7d2fe`.
  - `statusLabel`: graded → `pill.label ?? t.studentPages.statusGraded`; submitted → `t.studentPages.statusSubmitted`; else `t.studentPages.statusStart`.
  - `statusIcon`: graded `✅`, submitted `⏳`, else `📝`.
  - Row meta line: `{class_name} · {teacher_name} · {created_at toLocaleDateString(month:'short',day:'numeric')}`.
  - Pending rows show a trailing `→`. Hover handlers mutate `borderColor`/`background` inline.

**Four-audience note (verbatim comment in code):** graded rows show only the **qualitative pill** (color/label/detail), NOT a raw HW %. Cited as **"Barb 2026-05-11 — reversal of Option D's HW % visibility for students."** (Distinct from `HomeworkAttemptState.grade` which *is* still shown — see §6.)

---

## 2. `StateScreens.tsx` — full-screen player states

Six exported screen components. All centered, `min-height:100vh`, bg `#fafaf9`. Each uses `useTranslations()` and (most) the `Btn` component.

| Export | Props | Renders |
|---|---|---|
| `LoadingScreen()` | none | gradient `📋` badge; `t.studentPages.loadingHomework` + `...loadingHomeworkBody` |
| `NoHomeworkScreen({ onBack })` | `onBack: () => void` | `📋`; `t.studentPages.noHomeworkYetTitle` + `...noHomeworkYetBody`; `Btn` → `t.studentPages.goToDashboard` |
| `SubmittedScreen({ onBack })` | `onBack: () => void` | `⏳`; `t.studentPages.homeworkSubmittedTitle` + `...homeworkSubmittedBody`; `Btn` → `t.studentPages.backToDashboard` |
| `GradedLockedScreen({ homeworkAttempt, onBack })` | `homeworkAttempt: HomeworkAttemptState \| null; onBack: () => void` | `✅`; `t.studentPages.homeworkGradedTitle`; qualitative pill; AI + teacher feedback blocks; locked note; `Btn` → backToDashboard |
| `DoneScreen({ showConfetti, tier, onConfettiDone, homeworkAttempt, completedCount, taskCount, reteachMessage, submitError, onBack })` | see below | `🎉`; confetti; pill OR `{completedCount}/{taskCount} {tasksCount}`; feedback; reteach; error; `Btn` → goToDashboard |
| `SubmittingScreen()` | none | gradient `✨` badge; `t.studentPages.gradingHomework` + `...gradingHomeworkBody` |

**`DoneScreen` full props (verbatim):**
```ts
{
  showConfetti: boolean;
  tier: AgeTierName;                 // from @/lib/design/useAgeTier
  onConfettiDone: () => void;
  homeworkAttempt: HomeworkAttemptState | null;
  completedCount: number;
  taskCount: number;
  reteachMessage: string | null;
  submitError: string | null;
  onBack: () => void;
}
```
- Renders `<ConfettiCelebration trigger={showConfetti} tier={tier} xpEarned={150} headline={t.studentPages.confettiHomeworkDoneHeadline} reason={t.studentPages.confettiHomeworkDoneReason} onDone={onConfettiDone} />` (import `@/components/student/ConfettiCelebration`). **XP value hardcoded `150`.**
- If `homeworkAttempt?.grade != null`: render `hwGradePill(grade)` pill (24px, `pill.label` + `pill.detail`); else render `{completedCount} / {taskCount} {t.studentPages.tasksCount}`.
- `ai_feedback` block: indigo card, label `t.studentPages.coreFeedbackLabel`.
- `reteachMessage`: green card prefixed `💙`.
- `submitError`: red card prefixed `⚠️`.
- Footer note `t.studentPages.teacherMayAdjust`.

**`GradedLockedScreen` specifics:**
- Same `hwGradePill` pill pattern (gated on `homeworkAttempt?.grade != null`).
- `ai_feedback` → indigo card, label `t.studentPages.coreFeedbackLabel`.
- `teacher_notes` → green card, label `t.studentPages.teacherFeedbackLabel`.
- Locked note `t.studentPages.homeworkLocked`.
- Verbatim comment confirms the **Option D reversal**: students no longer see the 72px HW % verdict; replaced by the qualitative pill (`hwGradePill`); teachers/parents/gradebook keep the raw grade.

**Reusable UX patterns for V2:** centered full-screen state shell; the feedback-card pattern (uppercase label + body, color-coded indigo=AI/CORE, green=teacher); confetti-on-done w/ tier + xp; pill-not-number grade display.

---

## 3. `Btn.tsx` — shared button

**Responsibility:** the single primary/outline button used across player state screens.

**Props (verbatim):**
```ts
{ onClick: () => void; children: React.ReactNode; color?: string; disabled?: boolean;
  fullWidth?: boolean; outline?: boolean; small?: boolean }
```
Defaults: `color = '#6366f1'`, all booleans default `false`.

**Behavior:**
- Internal `useState(false)` `hov`; `on = !disabled && hov`.
- Hover/disabled styling computed inline from `color` via **`shadeColor(color, -12)`** (from `./helpers`).
- `outline` true → border `1.5px solid color`, translucent bg (`${color}18` hover / `${color}0d`), text = color. `outline` false → solid `color` bg, white text, drop shadow `${color}44` (hover) / `${color}22`, `translateY(-1px)` on hover.
- `disabled` → bg `#f5f5f4`, text `#a8a29e`, `cursor: not-allowed`.
- `small` → `7px 14px` / 12px font; else `11px 22px` / 14px.

**`shadeColor(hex, pct)`** (verbatim, from `helpers.ts`): parses `#RRGGBB`, shifts each channel by `pct * 2.55`, clamps 0–255, returns `#RRGGBB`. (Pure helper; V2 needs an equivalent only if it keeps dynamic color math — token-based variants likely replace it.)

---

## 4. `ChoiceBlock.tsx` — student choice architecture block

**Responsibility:** renders at the **top of an assignment** when the teacher enabled any choice ("Choice Architecture", V6 Prompt 6 Part B). Calm/brief, **NOT gamified, no animations**. Writes to **`homework_attempts.student_choices`** via the caller's `onSave` handler (verbatim comment: "typically a PATCH to `/api/attempts/homework/[id]`"). Selecting the harder path (e.g. "talk through reasoning") is **signal-rich — read downstream by the Prompt 5 effort-hug evaluator.**

**Props (verbatim):**
```ts
interface Props {
  settings: ChoiceSettings;
  availableProblems?: ProblemOption[];   // default []
  initialChoices?: StudentChoices;
  onSave: (choices: StudentChoices) => Promise<void> | void;
  locked?: boolean;                      // default false — student can revisit but not flip
}
interface ProblemOption { id: string; label: string; step?: number; }
```
Types from **`@/lib/student/choiceArchitecture`** (`ChoiceSettings`, `StudentChoices`).

**`ChoiceSettings` fields referenced (verbatim):** `allow_problem_selection`, `allow_modality_choice`, `allow_topic_choice`, `allow_order_choice`, `topic_options` (array), `min_problems_to_complete` (number).

**`StudentChoices` shape written by `onSave` (verbatim):**
```ts
{
  modality,                          // StudentChoices['modality'] — values used: 'type' | 'talk' | null
  chosen_topic: topic,               // string | null
  selected_problem_ids: shows.problem ? selectedIds : undefined,  // string[]
}
```
Internal state mirrors `initialChoices`: `modality` (`initialChoices?.modality ?? null`), `topic` (`initialChoices?.chosen_topic ?? null`), `selectedIds` (`initialChoices?.selected_problem_ids ?? []`).

**Visibility gating (`shows`):**
- `problem`: `allow_problem_selection === true && availableProblems.length > 0`
- `modality`: `allow_modality_choice === true`
- `topic`: `allow_topic_choice === true && Array.isArray(topic_options) && topic_options.length > 0`
- `order`: `allow_order_choice === true` (verbatim comment: order is **hint-only, no picker** — "Barb flagged it as unnecessary ceremony"; order set organically by which problem clicked first)
- If none shown → `return null`.

**Save validation:** if `shows.problem` and `selectedIds.length < (min_problems_to_complete ?? 0)` → error `${t.choice.pickAtLeast} ${min}.` and abort.

**Copy keys (`t.choice.*`):** `blockTitle`, `blockSubtitle`, `pickProblems`, `youvePicked`, `pickModality`, `modalityType`, `modalityTalk`, `pickTopic`, `orderHint`, `saving`, `saveButton`, `pickAtLeast`.

**Sub-component `OptionPill`** (active/disabled/onClick/children): pill toggle, active = indigo (`border #6366f1`, `bg #eef2ff`, `color #4338ca`), inactive = `border #e2e8f0`, `bg #fff`, `color #475569`. Used for modality + topic.

**Reusable patterns for V2:** checkbox multi-select with live "you've picked N/min" counter; pill single-select (modality, topic); the "harder choice = signal" principle; lockable-after-save UI.

---

## 5. `IGotThisOffer.tsx` — "I Got This" modal (mastery shortcut + go-deeper)

**Responsibility:** slide-in dismissible modal (V6 Prompt 6 Part C). Three options. **Never shown more than once per attempt** — parent owns `open`; verbatim comment: "server also sets `i_got_this_offered=true` at check." Three actions map to **server POST actions: `skipped`, `deeper`, `continued`** (per verbatim prop comments). The three offer options (verbatim header comment):
- `🏁 Submit what I have` — flags **`mastery_shortcut`** (teacher reviews)
- `🔬 Give me a harder one` — extension problem generated
- `⏭ Just keep going` — close, continue normally

**Props (verbatim):**
```ts
interface Props {
  open: boolean;
  onClose: () => void;
  onSkip: () => Promise<void> | void;        // student picks 🏁; caller POSTs action=skipped + submit/navigate
  onGoDeeper: () => Promise<{ problem_text: string; transfer_angle?: string } | null>;  // picks 🔬; caller POSTs action=deeper; returns extension problem
  onContinue: () => Promise<void> | void;     // picks ⏭; caller POSTs action=continued
  onExtensionResult: (outcome: 'correct' | 'incorrect' | 'partial' | 'abandoned', text: string) => Promise<void> | void;  // after extension answer
}
```

**Phase state machine (verbatim `Phase` type):**
```ts
type Phase = 'offer' | 'extension_loading' | 'extension_active' | 'extension_submitted' | 'closing';
```
- `offer`: title `t.iGotThis.offerTitle`, body `t.iGotThis.offerBody`, three `ActionButton`s: skip (`optionSkip`, tone neutral), deeper (`optionDeeper`, tone primary), continue (`optionContinue`, tone ghost).
- `handleDeeper` → `extension_loading` (title `extensionLoadingTitle`, body `extensionLoadingBody`); awaits `onGoDeeper()`; on null → error toast `t.iGotThis.extensionFailedToast`, back to `offer`; on success stores `{ text: problem_text, angle: transfer_angle }` → `extension_active`.
- `extension_active`: title `extensionTitle`, optional uppercase `angle` (transfer_angle), problem `text` card, `<textarea>` answer (placeholder `extensionAnswerPlaceholder`), three submit buttons calling `submitExtension(outcome)`: "Got it" → `'correct'` (`extensionGotIt`), "Partial" → `'partial'` (`extensionPartial`), "Give up" → `'abandoned'` (`extensionGiveUp`). Note: `'incorrect'` is in the outcome union but no button emits it here.
- `submitExtension(outcome)` → `await onExtensionResult(outcome, answer)` → `extension_submitted`.
- `extension_submitted`: title `extensionDoneTitle`, body `extensionDoneBody`, CTA `extensionDoneCta` → `onClose`.
- `useEffect` on `!open` resets all state (`offer`, clear extension/answer/error/submitting).

**Copy keys (`t.iGotThis.*`):** `offerTitle`, `offerBody`, `optionSkip`, `optionDeeper`, `optionContinue`, `extensionFailedToast`, `extensionLoadingTitle`, `extensionLoadingBody`, `extensionTitle`, `extensionAnswerPlaceholder`, `extensionGotIt`, `extensionPartial`, `extensionGiveUp`, `extensionDoneTitle`, `extensionDoneBody`, `extensionDoneCta`.

**Sub-component `ActionButton`** (`onClick/disabled/tone:'primary'|'neutral'|'ghost'/children`): left-aligned; primary = `#6366f1` bg white text; neutral = white bg `#475569` text `#e2e8f0` border; ghost = transparent `#64748b` text. Modal: fixed overlay `rgba(15,23,42,0.35)`, `zIndex:1000`, card maxWidth 440, `role="dialog" aria-modal="true"`.

**Reusable patterns for V2:** the multi-phase modal state machine; the "submit-as-is (mastery shortcut) vs go-deeper extension vs keep going" trichotomy; outcome enum `'correct'|'incorrect'|'partial'|'abandoned'`; once-per-attempt gating via server flag `i_got_this_offered`.

---

## 6. `HugInlineNotification.tsx` — virtual-hug toast (peripheral, NOT player-core)

**Responsibility:** slide-in toast when a teacher issues a **virtual hug** (V6 Prompt 5 Stage B). **Relation to the player:** triggered by an on-page-load check for un-viewed hugs (sets `viewed_by_student_at` server-side once dismissed/expired); it can appear on the student homework page, but it is part of the hug system, **not** the assignment-player core. Realtime subscription (Supabase `virtual_hugs` INSERT) deferred per verbatim comment.

**Props (verbatim):**
```ts
{
  hug: HugRow | null;                       // HugRow imported from ./HugCard
  onDismiss?: (hugId: string) => void;
  autoDismissMs?: number;                   // default 6000
}
```
**Behavior:** if `hug` null → `return null`. On mount slides in (`requestAnimationFrame`), auto-dismisses after `autoDismissMs` (default 6s) calling `onDismiss?.(hug.id)` after a 300ms exit transition; click also dismisses. `role="status" aria-live="polite"`, fixed bottom-right `zIndex:1000`. Renders `<HugCard hug={hug} variant="notification" />` (import `./HugCard`).

**Reusable pattern for V2 (if hugs surface in the player):** auto-dismissing accessible toast wrapper with slide transition; delegates rendering to a `HugCard variant="notification"`.

---

## Supporting contracts pulled from `types.ts` (used by the above + the player page)

These define the prop shapes the components consume and the broader player data model the page passes down:

- **`HomeworkAttemptState`** (consumed by StateScreens):
  ```ts
  { grade: number | null; teacher_notes: string | null; ai_feedback?: string | null; allow_redo: boolean; }
  ```
  Verbatim comment: `grade` is **HW grade 0–100**, "renamed from `score` in 1c-1 — homework produces grades. HW grades remain visible to students per Barb's Option D (only quiz scores + band labels are stripped)." `allow_redo` gates the redo path.
- **`TutorMessage`** (Teli tutor chat): `{ role: 'user' | 'assistant'; content: string; hint_type?: string; input_method?: 'text' | 'voice' }` — confirms voice input + per-message hint typing.
- **`TaskSignal`** (behavioral signal per task): `{ task_index, task_description, completed, completion_time_ms, help_requests, retry_attempts, time_after_last_hint_ms, recovery_pattern: 'immediate' | 'delayed' | 'failed' | 'none' }`.
- **`AssignmentTask`**: `{ step, description, type; strategy?, atl_skill?, ib_attribute?, bloom_level? }`.
- **`Assignment.content`** keys: `title, instructions, tasks[], reading_passage?, audio_script?, diagram_mode?('image'|'structured'|'none'), diagram_description?, diagram_svg_prompt?, diagram_image_prompt?, youtube_search_query?, support_note?, extension_prompt?, atl_summary?[], ib_attributes?[]`. Also `mastery_band, learning_style, scaffold_level?, reteach_needed?, reteach_completed_at?` + spark sync fields (`spark_attempt_id?, spark_experiment_id?, spark_sync_failed?, spark_sync_error?`).
- **`AdaptedTask`**: `{ adapted_description, scaffold_note, difficulty, encouragement }`.

## The hint ladder (verbatim, from `helpers.ts` — load-bearing for the player)

```ts
buildHintLabel(t) => {
  nudge:          t.studentPages.hintNudge,
  cue:            t.studentPages.hintCue,
  step:           t.studentPages.hintWalkthrough,
  answer_blocked: t.studentPages.hintsExhausted,
}
HINT_COLOR = { nudge: '#eef2ff', cue: '#fffbeb', step: '#faf5ff', answer_blocked: '#fef2f2' }
```
So the V1 hint ladder enum is **`nudge → cue → step → answer_blocked`** (the task prompt's "nudge->cue->step->blocked" maps to these exact keys; the 4th is named `answer_blocked`, labeled `hintsExhausted`).

```ts
TASK_TYPE = {  // bg/color/border per task type
  read, write, draw, discuss, create, analyze
}
isVisualTask(t) => t.type === 'draw' || t.type === 'create'
  || description includes any of: 'diagram','drawing','draw','visual','sketch','label'
scoreLabel(s,t) => s>=80 ? scoreExcellent : s>=50 ? scoreGood : scoreKeepGoing
renderPassage(text) => bolds **...** as styled <strong> (dangerouslySetInnerHTML)
```
`isVisualTask` is what decides whether the **drawing canvas** shows for a task. Task types observed: `read, write, draw, discuss, create, analyze`.
