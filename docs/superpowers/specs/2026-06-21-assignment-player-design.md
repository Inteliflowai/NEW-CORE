# CORE V2 — Epic 2: The Assignment Player — Design Spec

> **Status:** design for sign-off. Grounding (verbatim V1 + V2 facts) lives in
> `docs/superpowers/plans/grounding/2026-06-21-assignment-player.md` and its
> `2026-06-21-assignment-player/` fragment folder — cite it, don't re-derive it.
> **Next step after sign-off:** `writing-plans` → per-segment plans → subagent-driven-development.

**Author:** Claude (with Marvin) · **Date:** 2026-06-21

---

## 1. Goal (one sentence)

Build the student **Assignment Player** — the screen where a student reads, works through open-response tasks (typed or drawn), gets graduated help from **Teli** (an AI tutor that scaffolds and *never reveals the answer*), saves drafts automatically, and submits for an AI grade — so that, for the first time in V2, real student work flows into the behavioral-signals engine and lights up the teacher dashboards, parent summaries, and the "Worth a look?" coach read that currently render against empty data.

## 2. Why this is the keystone (context)

V2's teacher signal layer, weekly-snapshot cron, parent narrative, and the coach read already **SELECT** `homework_attempts` columns — but **no runtime route writes `homework_attempts` today**; only the demo/trial seeders do. The Assignment Player is the **missing producer**. Two columns are the headline payoff: `teli_hint_count` and `effort_label` are *consumed* by the weekly snapshot and `loadStudentSignals` but are **always 0 / never produced** at runtime — this player is what finally produces them. (Grounding §"The Write-Contract (KEYSTONE)".)

**Product framing:** V1-parity-*plus* on the pilot-relevant surface (per the Beta-not-MVP discipline). V1's term is "Homework"; **V2 UI says "Assignments"**, DB identifiers stay (`homework_attempts`, `/api/attempts/homework-*`).

## 3. Decisions locked (Marvin, 2026-06-21)

| Decision | Choice | Note |
|---|---|---|
| Teli's brain | **Claude** (`claude-opus-4-8`) | Fresh prompts tuned to coach posture; the moat's voice gets the best reasoner. |
| Drawing canvas | **Full V1 toolset + enhancements** | Concrete enhanced toolset locked in §7. |
| Voice (read-aloud + speak-to-Teli) | **In — but its own isolated, flag-gated segment** | §8. Speech stays on specialist models (OpenAI `tts-1`/`whisper-1`). |
| **Teli never reveals the answer** | **HARD GUARANTEE — defense in depth** | §6.3. The single condition on this design. Memory: `v2-teli-tutor-never-reveals-answer`. |

**Defaults I'm taking (Marvin may veto at spec review):**
- **Untimed.** No countdown/forfeit (V1 parity). We still use the attempt lifecycle (start → heartbeat signal → submit) for behavioral capture + autosave — just no clock.
- **Redo keeps history.** A redo creates a **new attempt row**, not an overwrite — so "did the reteach help?" is answerable and `detectCompletedReteachCycles` (which expects two rows on one `assignment_id`) works. Upgrade over V1's overwrite-in-place.
- **Assignments are GRADED coursework → the student sees the grade they earned.** Unlike quizzes (diagnostic → Option-D, words-only), a submitted assignment counts toward the class final grade, so the student sees the actual grade (the percentage) plus supportive feedback. The four-audience rule still hides the *diagnostic* machinery (mastery-band enum, risk numbers, behavioral-signal language) — it was never meant to hide earned grades. (Marvin, 2026-06-21.)
- **Grading stays AI-only** (no MCQ on assignments — those are the Quiz Runner's identity). Grade column stays **`score_pct`** (V2 signal consumers already SELECT it; no rename to V1's `grade`).
- **No `homework_drafts` table.** Autosave reuses the in-progress attempt row (`responses` + `canvas_data` columns already exist) + localStorage. Fewer tables, columns already present.
- **Deferred as "extra V1 stuff, no signal value":** mid-assignment auto-rewrite (`homework-adapt` — silently changes a task underfoot), choice architecture (`ChoiceBlock`/`student_choices`), "I got this"/extension shortcuts, BNCC/pt-BR.
- **Plain questions to Teli are free; only real hints count + escalate the ladder** (kinder than V1's "every message burns a hint"; better effort signal). Flagged for Marvin's review in §6.4.

## 4. Architecture — one player, five segments

The player is one student surface, built and reviewed as five self-contained, independently-testable segments. Order is deliberate: **signals start flowing after Segment 2.**

```
Segment 1  Data foundation            → tables/columns the player writes (the write-contract)
Segment 2  Core player screen         → read→tasks flow, typed answers, autosave, grade+submit  ← SIGNALS LIGHT UP HERE
Segment 3  Teli tutor + hint ladder   → Claude, 4-rung scaffold, NEVER reveals the answer        ← THE MOAT'S VOICE
Segment 4  Enhanced canvas            → full V1 toolset + locked enhancements, vector+PNG persist
Segment 5  Voice module (flag-gated)  → read-aloud + speak-to-Teli, isolated, OpenAI speech models
```

Dependencies: 2 needs 1; 3, 4, 5 each need 2; 3/4/5 are independent of each other.

**Reuse spine (already in V2, do NOT rebuild):** the behavioral-signals moat (`computeSignals` + `behavioralModel.emaMerge` + `upsertBehavioralSignals`, already typed `context:'homework'`), the OEQ grader engine (`gradeOpenResponse`), the Option-D copy primitives (`studentResultBundle`, `scoreMessage`, `masteryDisplayLabel`, `leakGuard`), the `after()` fail-isolated post-grade hook pattern, the attempt-lifecycle + behavioral-capture pattern in `quiz/_components/QuizRunner.tsx`, and the `requireRole` auth+IDOR chain. (Grounding §"What V2 Already Has".)

---

## 5. Segment 1 — Data foundation

**Files:** new migration `supabase/migrations/0015_assignment_player.sql`; Supabase Storage bucket `student-work`.

### 5.1 `homework_attempts` — extend the existing table

Exists today (19 cols, migrations 0004 + 0011). **Add** (all nullable / safe-defaulted; no backfill needed since the player produces them going forward):

| Column | Type | Purpose / consumer |
|---|---|---|
| `task_grades` | `jsonb` | per-task `[{ step, grade, feedback }]` for the gradebook drill-in (Epic 3) |
| `hours_to_submit` | `numeric(5,1)` | lateness/effort context |
| `review_required` | `boolean DEFAULT false` | set when AI grading fails → teacher review queue |
| `attempt_no` | `int NOT NULL DEFAULT 1` | redo-as-new-row ordering (see §5.4) |

**Keep `score_pct`** (do not add `grade`). **Do NOT add `class_id`** (intentional in V2 — class scoping is via `assignments.class_id`). `effort_label` (4-enum, migration 0011) and `allow_redo`/`is_redo` (0011) already exist. Images persist as per-task `image_url` inside `responses` (no separate `diagram_url`).

**`status` lifecycle (add a CHECK this time):** `CHECK (status IN ('in_progress','submitted','grading','graded','pending_grade'))`. The player drives `in_progress → submitted → grading → graded` (or `pending_grade` on grade failure).

### 5.2 `responses` jsonb shape (the answer contract)

Per-task, keyed by task step — the grader and the player agree on this exact shape:

```jsonc
// homework_attempts.responses
{
  "tasks": {
    "1": { "text": "student's typed answer", "image_url": "https://.../task-1-...png" | null },
    "2": { "text": "...", "image_url": null }
  }
}
```

(V2 seeders currently write a flat `{ response_text }`; the grader will be written to consume this per-task shape. Seeders updated to match in Segment 2's task list.)

### 5.3 `canvas_data` jsonb shape (upgrade over V1)

V1 persisted a **flattened PNG only** — strokes were lost on resume. V2 stores **both**: the flattened PNG (in Storage) *and* the vector strokes, so a student can re-open and keep drawing.

```jsonc
// homework_attempts.canvas_data
{
  "tasks": {
    "1": {
      "png_url": "https://.../task-1-drawing-<n>.png",
      "strokes": [ { "tool": "pen", "color": "...", "width": 2, "opacity": 1, "points": [[x,y],...] }, ... ],
      "template": "blank" | "grid" | "lined" | "number_line" | "coordinate_plane",
      "width": 900, "height": 540
    }
  }
}
```

### 5.4 Redo = new row (not overwrite)

An attempt row is created on player open (`status='in_progress'`, `attempt_no` = max+1 for this student+assignment). Edits update *that* row through to `graded`. A teacher granting `allow_redo` lets the student start a **new** in-progress row with `is_redo=true`, `attempt_no` incremented — the original graded row is preserved. Risk/reteach consumers see the full history.

### 5.5 Tutor persistence — net-new clean tables

V1's `tutor_sessions`/`tutor_messages` are drift-laden and self-contradictory (the `role` CHECK forbids the `'user'` value the code inserts). Define clean:

```sql
CREATE TABLE tutor_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignment_id   uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  attempt_id      uuid REFERENCES homework_attempts(id) ON DELETE SET NULL,
  hint_count      int NOT NULL DEFAULT 0,        -- total hints PULLED this session (→ teli_hint_count at submit)
  help_request_count int NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tutor_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES tutor_sessions(id) ON DELETE CASCADE,
  task_step       int,                            -- which task the turn was about
  role            text NOT NULL CHECK (role IN ('student','teli','system')),
  content         text NOT NULL,                  -- Teli replies are POST-leak-guard text only
  is_help_request boolean NOT NULL DEFAULT false, -- did this turn pull a hint?
  hint_rung       text CHECK (hint_rung IN ('nudge','cue','step','encourage')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

There is no `signal_events` table in V2 (the moat replaced it). Per-hint behavioral effect reaches the moat via the session's `hint_count` rolled into the submit aggregates (§6.5) — `tutor_messages` is the durable per-turn record.

### 5.6 RLS + Storage

- RLS on all three tables: student manages own rows; teacher reads rows for own classes; platform-admin all. **But writes go through the admin client** (bypasses RLS) — so the **object-level ownership guard is mandatory** on every player/tutor route (`row.student_id !== userId` → existence-hiding `EmptyState`/403). RLS is NOT the IDOR backstop (project rule).
- **Storage bucket `student-work`** (public-read) for canvas PNGs + uploaded images, path `${student_id}/assignment-${assignmentId}/task-${step}-...png`.

### 5.7 The write-contract (acceptance gate for the whole epic)

By end of Segment 2 (+3 for hint count), a submitted+graded attempt MUST write, and the teacher surfaces MUST render from: `student_id, assignment_id, status, responses, canvas_data, score_pct, ai_feedback, task_grades, teli_hint_count, effort_label, submitted_at, graded_at, submitted_on_time, hours_to_submit, allow_redo, is_redo, attempt_no`. (Teacher-only writes — `teacher_notes`, `teacher_score`, `flagged_by='teacher'` — are NOT the player's job.) This table is the epic's definition of done.

---

## 6. Segment 3 — Teli, the tutor (presented before Segment 2's UI because it defines the core contract)

> Ordered here for clarity; **built after Segment 2.** Teli is the pedagogical heart and the moat's voice.

### 6.1 Canonical contract — ONE path

V1 had **five** overlapping tutor implementations. V2 has exactly one: a route **`POST /api/attempts/[attemptId]/tutor`** (route.ts, matching the V2 quiz pattern — not V1's server action), powered by `claude-opus-4-8`, streaming the reply. Request `{ task_step, student_message, is_help_request }`; it loads/creates the `tutor_session` for this attempt, runs the ladder, persists the turn, and returns `{ reply, hint_rung, hints_remaining }`.

### 6.2 The hint ladder (4 rungs, one authoritative server counter)

```
rungs = ['nudge', 'cue', 'step', 'encourage']   // 'encourage' = the hard stop, NOT an answer
HINTS_PER_TASK = 3                                // nudge, cue, step; then 'encourage' forever
```

- The counter lives **only on the server** (`tutor_sessions.hint_count` + a per-task rung index) — V1's client/server off-by-one is not carried. Client renders `hints_remaining` from the response; it never decides the rung.
- Sequence per task: 1st hint → `nudge`, 2nd → `cue`, 3rd → `step`, 4th+ → `encourage` (stays). `hints_remaining` = 2,1,0,0.
- Rung instructions (drafts → Barb; all forbid the answer, including `encourage`):
  - **nudge** — "Ask one question that points their thinking in the right direction. Give no part of the answer."
  - **cue** — "Name the key idea or strategy to focus on. Do not give the answer."
  - **step** — "Walk through the *first* step of the approach. Stop before the result; do not give the final answer."
  - **encourage** — "They've used their hints. Affirm the effort, restate the thinking move they should try, and hand it back. No answer, no new step."

### 6.3 The no-answer guarantee — defense in depth (the hard requirement)

Three independent layers; a single failure cannot leak the answer. (Memory: `v2-teli-tutor-never-reveals-answer`.)

1. **Bounded ladder, no answer rung.** There is structurally no rung whose purpose is to give a solution; past the cap Teli only encourages. A student cannot pull until it caves.
2. **No answer key in the prompt.** Teli receives the task text + the student's own work/thinking — never a "correct answer is X" field. Grading is a separate call with a separate prompt. Open-response tasks generally have no single answer to parrot.
3. **Output-boundary reveal-check.** Before any reply renders: (a) the existing `assertNoLeak` + `assertNoBannedWord` number/word guard, **plus** (b) a lightweight reveal-check — if the draft reply appears to hand over the solution (heuristic + a cheap classifier pass), it regenerates once with a stricter instruction, and on a second failure falls back to a fixed safe scaffold line. The student never sees un-checked text.

**Plus the critical-thinking requirement:** every Teli reply must **name the thinking move** ("let's separate what we know from what we're solving for") rather than the answer content. This gets its own tests (§6.6).

### 6.4 System prompt (fresh, Claude, coach-posture)

A new `src/lib/teli/prompt.ts` builds the system prompt from: the Socratic contract (never reveal; ≤3 sentences; adapt to frustration; celebrate effort over correctness; when stuck twice, offer a *different* approach; **always name the thinking move**), light per-student personalization if available (learning style, recent struggle topics), the current task text, and the active rung instruction. **No V1 brand/curriculum names** ("i-Ready", "Knowledge Bridge") — reconciled to coach posture and the token system. All copy is DRAFTS → `STRINGS-FOR-BARB.md`; COACH-POSTURE Rule 6 ("not a chatbot") governs the surface.

**Confirmed (Marvin, 2026-06-21):** plain questions (no help requested) are answered *without* advancing the ladder or counting a hint; only `is_help_request` turns escalate. The server, not the client, classifies ambiguous turns conservatively (a genuine "I'm stuck" counts; "what does this word mean?" does not).

### 6.5 How a hint becomes a signal (the moat wiring)

At submit, the session's `hint_count` → `homework_attempts.teli_hint_count`; `effort_label` is derived (§ next) and written; the submit aggregates pass real `hintsUsed` (not the quiz's hardcoded 0) into `computeSignals` → `upsertBehavioralSignals` (context `'homework'`). This is the path that finally makes the effort signal non-zero.

### 6.6 `effort_label` runtime derivation (REUSE the existing fn)

`src/lib/signals/computeEffortLabel.ts` **already exists** (Plan-3 lift; object signature `computeEffortLabel({ score, teliHintCount })` → `EffortLabel | null`). Reuse it — do NOT recreate it. Its rule:
```
SUCCESS_THRESHOLD = 75; EFFORT_THRESHOLD = 2 (hints)
success & effortful   → 'effortful_success'
!success & effortful  → 'struggling_trying'
success & !effortful  → 'independent_success'
else                  → 'independent_struggle'   (null if score null)
```
Written at grade time. (The 4 enum values already match `homework_attempts_effort_label_check`.)

### 6.7 Teli tutor tests

Unit (pure ladder logic): rung sequence, cap, counter authority, free-question-doesn't-escalate. Leak/guarantee tests: a battery of "just tell me the answer" / "what's the final number" prompts must never produce an answer-revealing reply (reveal-check forces regeneration/fallback); every reply passes `assertNoLeak` + `assertNoBannedWord`; every help reply contains a named thinking move. Persistence: turns land in `tutor_messages` with correct `role`/`hint_rung`; `hint_count` rolls to `teli_hint_count`.

---

## 7. Segment 2 — The core player screen

**Files (net-new):** `src/app/(student)/student/assignments/[id]/play/page.tsx` (server: auth + IDOR + load) + `_components/AssignmentPlayer.tsx` (client) + `_components/{ReadPhase,TaskCard,TaskRail,SubmitPanel,StateScreens}.tsx`; grade route `src/app/api/attempts/homework-submit/route.ts`; autosave route `src/app/api/attempts/homework-draft/route.ts`; load route `src/app/api/attempts/student-homework/route.ts` (or fold load into the server page). Reuse the `gradeOpenResponse` engine with a net-new multi-task GRADE prompt.

### 7.1 Route & navigation

A non-SPARK assignment row in the list links to **`/student/assignments/[id]/play`** (sibling of the SPARK detail page, mirroring `quiz/`). The player owns the read→tasks flow internally (no separate intro page). SPARK assignments keep their existing detail/launch path untouched (discriminator: `assignments.spark_status !== 'none'`).

### 7.2 State machine (ported from V1, re-skinned to tokens)

First-match-wins, same spine as V1: `loading → (no assignment) → submitted → graded-locked(!allow_redo) → done → submitting → main player`. The main player has two phases: **`read`** (passage / `audio_script` placeholder / diagram if present / "Ready to start?") then **`tasks`** (per-task carousel, progress rail `Task X of Y`, typed `<textarea>` answer, the inline Teli panel from Segment 3, the canvas panel from Segment 4 for visual tasks, submit panel). Defensive rendering against the two live `content` shapes (rich `AssignmentSchema` vs lean seed) — missing `title`/`reading_passage`/`tasks` degrade gracefully.

### 7.3 Attempt lifecycle + behavioral capture (reuse quiz pattern, no clock)

On entering tasks: ensure an `in_progress` attempt row. Lift `QuizRunner`'s behavioral capture wholesale (ref counters + global listeners: pause ≥3s, focus loss, paste, backspace bursts) and **add the producers the quiz hardcodes to zero**: `canvasUsed`, `ttsPlayCount`, per-task `hintsUsed`. A periodic signal heartbeat persists progress + feeds live behavioral aggregates. **No countdown, no forfeit** (untimed).

### 7.4 Autosave (in-progress row + localStorage)

Immediate localStorage write on change (`hw-progress-${assignmentId}`); 3s-debounced `PUT /api/attempts/homework-draft` upserting the in-progress attempt's `responses` + `canvas_data`. Restore on mount (server first, localStorage fallback). No separate drafts table.

### 7.5 Submit + grade (the core contract)

`POST /api/attempts/homework-submit` body `{ assignment_id, responses, canvas_data }`:
- **Auth + IDOR** (admin client + ownership guard).
- **Completeness gate:** every task needs text or an image → else 400 with a coach-posture message.
- **Redo lock:** a graded attempt with `!allow_redo` → 409; a redo starts a new row (§5.4).
- **Grade = AI-only** via a **dedicated `gradeAssignment` grader** (`src/lib/engine/gradeAssignment.ts`, net-new — Claude `claude-sonnet-4-6` → GPT-4o fallback, throws `LlmExhaustedError` on exhaustion, never fabricates). It returns a **continuous 0–100** grade (the quiz's `gradeOpenResponse` is locked to {0, 0.5, 1.0} per-OEQ and would make assignment grades coarse — Marvin's call: assignments are graded coursework, so the grade must be smooth). Output: `overall_grade` (→ `score_pct`), `overall_feedback`, `task_grades: [{ step, grade 0–100, feedback }]`. Student-facing strings run BOTH `assertNoLeak` + `assertNoBannedWord` at the result-bundle boundary (the grade number itself is allow-listed).
- **Write** (§5.7): `status='graded'`, `score_pct`, `ai_feedback`, `task_grades`, `effort_label` (§6.6), `teli_hint_count` (from the session), `submitted_at`, `graded_at`, `submitted_on_time`, `hours_to_submit`. Clear the draft (localStorage + leave the row as the graded record).
- **MOAT-critical awaited hooks:** `computeSignals(context:'homework')` + `recomputeSkillStatesForStudent` (via the `after()` fail-isolated pattern). Other V1 side effects (LMS, Classroom, parent email, hugs, XP, BNCC) are **out of scope** for this epic.
- **Grade failure** → `status='pending_grade'`, `review_required=true`; surface a calm "your teacher will look at this" to the student.

### 7.6 Student-facing result — assignments are GRADED (NOT Option-D)

**Assignments count toward the class final grade, so the student sees the grade they earned** (Marvin, 2026-06-21) — the percentage (e.g., "92%") shown as the official grade, plus the supportive `ai_feedback` and per-task feedback. This is a deliberate distinction from the Quiz Runner: quizzes are *diagnostic/formative* and stay words-only (Option-D); assignments are *summative/graded* and show the number.

**Leak-guard boundary (scoped, not removed):** the official grade value is **allow-listed** at its own render site — it is the student's earned grade, not a leaked diagnostic signal. A dedicated `GradeDisplay` element renders the number directly; it is NOT passed through `assertNoLeak`. Everything *around* it still passes `assertNoLeak`/`assertNoBannedWord`: the encouraging message, the coach framing, and the feedback prose carry no mastery-band enum, no risk number, no behavioral-signal language. So the student sees "92% — strong work connecting the evidence to your claim", never "92nd percentile" or a band/risk readout.

**Barb note:** this reverses V1's current (May-2026) pill-only homework presentation. Barb confirms the exact presentation — number prominence, whether a qualitative band label sits alongside the number, and a letter-grade mapping if CORE adds one — but the grade *is shown* either way.

### 7.7 Core player tests

Server load (auth/IDOR/defensive content). Submit route: completeness gate, redo lock, grade write hits every write-contract column, `effort_label` correctness, the awaited moat hooks fire, grade-failure path. Client: state machine, two-phase flow, autosave debounce + restore, behavioral producers feed real `canvasUsed`/`hintsUsed`/`ttsPlayCount`. Leak: a `*.leak.test.tsx` rendering the real server bundle→DOM proves no number/banned-word reaches the student.

---

## 8. Segment 4 — Enhanced canvas

**Files:** `_components/canvas/DrawingCanvas.tsx` + tool modules; writes `homework_attempts.canvas_data` (§5.3) + uploads PNG to `student-work`.

**Locked toolset** (V1 parity **+** enhancements — this is the lock that prevents scope-creep):

- **V1 parity:** pen, pencil, eraser, straight line, rectangle, circle/ellipse, arrow, text; stroke widths; preset + custom colors; fill; undo/redo (Ctrl/Cmd+Z/Y); mouse + touch.
- **Enhancements:** highlighter (semi-transparent), fill-bucket + eyedropper, triangle/polygon, double-headed arrow, adjustable stroke **opacity**, movable sticky-note text boxes, **zoom & pan**, **paper templates** (blank / grid / lined / number-line / coordinate-plane), **stylus pressure**, responsive/larger canvas, and **vector-stroke persistence** (re-editable on resume — the upgrade over V1's flat-PNG-only).
- **Deferred (named, not silently dropped):** layers, shape-recognition/auto-smoothing, collaborative canvas.

Token-only styling (no hardcoded hex — V1's canvas was 100% inline hex). Using the canvas flips the real `canvasUsed` signal. Tests: each tool draws + persists strokes; PNG upload; template render; resume restores strokes; touch + pressure paths.

## 9. Segment 5 — Voice module (isolated, flag-gated)

**Files:** `_components/voice/{ReadAloudButton,TeliVoiceButton}.tsx`; routes `src/app/api/attempts/tts/route.ts` + `src/app/api/attempts/teli-voice/route.ts`; a light per-school usage meter `src/lib/voice/usageCaps.ts`; feature flag `voice_enabled` (per-school, default off for pilots until tuned).

- **Read-aloud:** `POST /api/attempts/tts` `{ text }` → MP3 (OpenAI `tts-1`, voice `nova`, speed 0.9, input capped). Drives an `<audio>` element + Listen/Pause; flips the real `ttsPlayCount` signal.
- **Speak-to-Teli:** `TeliVoiceButton` → MediaRecorder → multipart `POST /api/attempts/teli-voice` (OpenAI `whisper-1`) → `{ transcript }` appended to the task answer / sent to Teli.
- **Isolation:** own components, own routes, own metering, behind the flag — the core player never imports it conditionally on the happy path; everything **degrades to typing** silently on failure or when the flag is off.
- **Vendor note:** OpenAI is **already a V2 dependency** (the grader's GPT-4o fallback uses `OPENAI_API_KEY`), so voice adds *models*, not a new vendor/secret. Speech stays on OpenAI because Claude doesn't do TTS/STT.
- `language` param: hardcode `'en'` for the Beta (pt-BR deferred) but keep a single seam.
- Tests: route happy-path + graceful 429/failure; flag-off hides the surface; typing fallback; the two signals increment.

## 10. Cross-cutting requirements (every segment)

- **Auth chain on every route:** `createServerSupabaseClient()` → `auth.getUser()` → role gate → **object-level ownership guard** → `createAdminSupabaseClient()`. RLS is not the IDOR backstop.
- **Four-audience / Option-D (scoped):** students never see the *diagnostic* machinery — `mastery_band` enum, risk numbers, behavioral-signal language — and **quiz** scores stay words-only. **Graded-assignment grades ARE shown to the student** (§7.6) — earned coursework, not a leaked signal. Every student-facing string still passes `assertNoLeak` + `assertNoBannedWord` *except* the single official grade value, allow-listed at its dedicated render site; Teli replies and AI-feedback prose carry no numbers/banned words.
- **Coach posture:** COACH-POSTURE.md governs all copy; new strings are DRAFTS in `STRINGS-FOR-BARB.md`; Barb gates final copy.
- **Token-only + WCAG-AA:** no hardcoded hex / arbitrary `[var(--..)]`; Tier-2 token classes only; content text deep-ink; `npm run a11y` must stay green.
- **Next 16:** async `params`/`cookies()`/`headers()`; post-response side effects via `after()`.
- **TDD (Iron Law) — every task is built test-first.** The plan encodes each task as red-green-refactor steps (failing test → watch it fail for the right reason → minimal code → green → refactor); no production code without a failing test first; SDD implementers follow it exactly. The tests that are *load-bearing for the product here* — write them first, watch them fail, then build:
  - **The no-answer guarantee (§6.7):** a battery of "just tell me the answer" / "what's the final number" prompts that MUST never elicit an answer-revealing reply (reveal-check forces regenerate/fallback) — and a test that every help reply names a thinking move. These prove the moat's core promise; they must exist and fail before the tutor route exists.
  - **The leak boundary:** a `*.leak.test.tsx` rendering the real server bundle → DOM proving no banned word / no stray number reaches the student — *and* a paired test proving the official assignment grade IS shown (the allow-listed carve-out, §7.6).
  - **The write-contract (§5.7):** an assertion that a submitted+graded attempt writes every required column with correct values (esp. `teli_hint_count`, `effort_label`, `score_pct`, `submitted_at`) and that the awaited moat hooks fire — this is the epic's definition of done.
- **Gates at merge:** vitest all-green, `tsc` 0, `npm run a11y` 49/49+, build 0, lint 0 new errors.

## 11. Deferred (explicitly, not forgotten)

Mid-assignment auto-rewrite (`homework-adapt`); choice architecture; "I got this"/extension shortcuts; LMS/Google Classroom passback; parent email/hugs/XP; BNCC/pt-BR; teacher-side "Open Assignments" view (the deferred CTA stays deferred — this epic is the *student* player). Teacher-authoring of non-SPARK assignments is its own scope; this epic *consumes* assignment rows (seeded + the existing generate route).

## 12. Open questions resolved → remaining for Marvin's review

**Resolved in this spec:** tutor model (Claude), tutor path (one route), canvas scope (locked toolset), voice (in, segmented, flagged), timed (no), redo (new row), grade column (`score_pct`), autosave target (attempt row), `responses`/`canvas_data` shapes, tutor table shapes, `effort_label` derivation, player route, storage bucket, leak-guard boundary.

**All resolved at spec review (Marvin, 2026-06-21) — go on all four:**
1. ~~Free questions vs hints~~ **RESOLVED:** plain questions to Teli don't burn a hint; only genuine help requests escalate the ladder + count (§6.4). Kinder to students, cleaner effort signal.
2. ~~Voice flag default~~ **RESOLVED:** `voice_enabled` ships **off** for initial pilots, turned on per-school once tuned (§9).
3. ~~Canvas enhancement list~~ **RESOLVED:** the locked enhanced toolset in §8 is the agreed ambition.
4. ~~Grade band-pill visibility~~ **RESOLVED:** assignments are graded coursework counting toward the final grade → the student sees the grade they earned (§7.6), a deliberate distinction from quizzes' Option-D words-only. Barb confirms exact presentation; the grade is shown either way.
