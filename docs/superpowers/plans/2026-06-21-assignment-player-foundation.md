# Assignment Player — Foundation + Core Player (Segments 1–2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Revision 2 (2026-06-21):** folds in the 4-lens adversarial pre-flight review. Key changes from R1: (a) a **dedicated continuous-grade assignment grader** (`gradeAssignment`, 0–100) replaces reusing the quiz's coarse {0,0.5,1.0} OEQ grader — Marvin's call, matches spec §7.5 + V1; (b) **`computeEffortLabel` already exists** (object signature) — reuse it, no new file; (c) **redo flow gated on `allow_redo`** (a graded assignment stays locked unless a teacher grants a redo); (d) leak boundary now also runs **`assertNoBannedWord`**; (e) tests rewritten to mock `after()`, record `.update()` payloads, and assert the write-contract; (f) deep component import paths (no barrel).

**Goal:** Ship the first working slice of the non-SPARK Assignment Player — a student opens an assignment, works through its open-response tasks (typed), autosaves as they go, submits, gets a real AI grade they can see, and the submit writes the full `homework_attempts` write-contract so the teacher signals/snapshot/coach surfaces light up with real data.

**Architecture:** Reuse the Epic-1 quiz-runner spine (auth chain, the `after()` fail-isolated post-grade hooks, the never-half-grade discipline, the behavioral-capture pattern, the Option-D copy primitives, the existing `computeEffortLabel`). Net-new: a dedicated continuous-grade assignment grader, a flat submit route that writes `homework_attempts`, an autosave route, an assignment result bundle that *shows the grade* (leak-guarded prose around it), and the player UI under `assignments/[id]/play`. Teli tutor, the drawing canvas, and voice are **out of scope** (Segments 3/4/5); this plan leaves clean seams for them.

**Tech Stack:** Next.js 16 App Router (async params, `after()` from `next/server`), React 19, TypeScript, Tailwind v4 token classes, Supabase (server + admin clients), Claude grader (`claudeChat` → GPT fallback), Zod, Vitest (+ jsdom for components).

**Spec:** `docs/superpowers/specs/2026-06-21-assignment-player-design.md`. **Grounding:** `docs/superpowers/plans/grounding/2026-06-21-assignment-player.md` + the `2026-06-21-assignment-player/` fragment folder. **Pre-flight review:** archived in this session's task output `w4x2gw35q`.

## Global Constraints

Every task implicitly includes these:

- **Auth chain on every route:** `await createServerSupabaseClient()` → `auth.getUser()` (401) → `createAdminSupabaseClient()` (sync; bypasses RLS) → **object-level ownership guard** (`row.student_id !== userId` → 403 / existence-hiding `EmptyState`). **RLS is NOT the IDOR backstop.** All writes go through the admin client (never under the student session — there is no student INSERT/UPDATE RLS policy and we are not adding one). Pages use `requireRole(['student'])` (returns `{ userId, role, schoolId, fullName }`) AND re-verify object ownership.
- **Assignments are GRADED → the student SEES the grade** (the percentage), distinct from quizzes' Option-D words-only. The grade number is **allow-listed** at its own dedicated render element; it is NOT passed through `assertNoLeak`. Every *other* student-facing string (coach message, overall + per-task feedback) passes **BOTH** `assertNoLeak` AND `assertNoBannedWord`. Diagnostic machinery (mastery-band enum, risk numbers, signal language) never reaches the student.
- **UI term is "Assignment(s)", never "Homework"** (DB identifiers like `homework_attempts` keep the legacy term).
- **WCAG-AA + token-only:** no hardcoded hex, no arbitrary `[var(--..)]` in components; Tier-2 token classes only; content text `text-fg`. `npm run a11y` stays green. **Import core components from their concrete paths** (`@/components/core/EmptyState`, `@/components/core/Card`, `@/components/core/MathText`) — there is NO `@/components/core` barrel.
- **TDD (Iron Law):** failing test first → watch it fail for the right reason → minimal code → green → refactor. No production code without a failing test. **No placeholder test steps** — every "write the failing test" step ships concrete code.
- **`responses` jsonb shape (canonical):** `{ tasks: { "<step>": { text: string, image_url: string | null } } }`. Autosave writes it; the grader reads it. (Seeders keep their legacy pre-graded `{ response_text }` shape — they bypass the grader and are unchanged.)
- **`homework_attempts` has NO `class_id` column** (intentional). The player MUST NOT write `class_id`. Class scoping is via `assignments.class_id`.
- **Submit is attempt-keyed, not assignment-keyed** (deliberate refinement of spec §7.5): the client posts `attempt_id`; the attempt is provisioned server-side by `loadAssignmentForPlay` and its id is the ownership anchor.
- **Gates at merge:** vitest all-green, `tsc` 0, `npm run a11y` 49/49+, build 0, lint 0 new errors.

**Status vocabulary (this plan introduces the CHECK):** `in_progress → submitted → grading → graded` (+ `pending_grade` on grade failure).

**Segment-1+2 acceptance write-contract (the definition of done):** a submitted+graded attempt writes `student_id, assignment_id, status='graded', responses, score_pct, ai_feedback, task_grades, effort_label, submitted_at, graded_at, submitted_on_time, hours_to_submit, attempt_no, is_redo, review_required=false` (and `teli_hint_count` stays its default `0`). **`canvas_data` and a real `teli_hint_count` are explicitly DEFERRED** to Segments 4/3 — the final whole-branch review MUST NOT assert them. Because `teli_hint_count` is 0 here, `effort_label` will only ever take `independent_success` (score ≥ 75) or `independent_struggle` (score < 75) in this segment — that is expected, not a gap.

---

## Task 1: Migration 0015 — extend `homework_attempts`

**Files:**
- Create: `supabase/migrations/0015_assignment_player.sql`
- Modify (append a `describe` block): `supabase/migrations/__tests__/migrations.test.ts` — **read it first** and follow its exact per-migration pattern (each migration 0001–0014 is a `describe` block that reads its `.sql` file text and asserts substrings/regex).

**Interfaces:**
- Produces 4 new columns on `homework_attempts` — `task_grades jsonb`, `hours_to_submit numeric`, `review_required boolean NOT NULL DEFAULT false`, `attempt_no int NOT NULL DEFAULT 1` — and a named CHECK on `status`.

**Current schema (do NOT re-add):** `id, assignment_id, student_id, status, responses, canvas_data, score_pct, ai_feedback, teacher_notes, teacher_score, teli_hint_count, submitted_on_time, submitted_at, graded_at, created_at` (0004) + `effort_label, allow_redo, is_redo, flagged_by` (0011). Latest on disk is `0014`.

- [ ] **Step 1: Write the failing test** — append to `supabase/migrations/__tests__/migrations.test.ts` (self-contained `readFileSync`, matching the file's style):

```ts
// Append inside migrations.test.ts. It already defines:
//   const sql = (f) => readFileSync(resolve(process.cwd(), 'supabase/migrations', f), 'utf8');
// Reuse that helper — do NOT add a new readFileSync/dir const.
describe('0015 assignment_player', () => {
  const s = () => sql('0015_assignment_player.sql');

  it('adds the four player columns idempotently with the chosen nullability', () => {
    expect(s()).toMatch(/ADD COLUMN IF NOT EXISTS task_grades\s+jsonb/i);
    expect(s()).toMatch(/ADD COLUMN IF NOT EXISTS hours_to_submit\s+numeric/i);
    expect(s()).toMatch(/ADD COLUMN IF NOT EXISTS review_required\s+boolean\s+NOT NULL\s+DEFAULT\s+false/i);
    expect(s()).toMatch(/ADD COLUMN IF NOT EXISTS attempt_no\s+int\s+NOT NULL\s+DEFAULT\s+1/i);
  });

  it('adds an idempotent named status CHECK covering the lifecycle vocabulary', () => {
    expect(s()).toMatch(/homework_attempts_status_check/);
    expect(s()).toMatch(/DROP CONSTRAINT[^;]*homework_attempts_status_check|conname = 'homework_attempts_status_check'/);
    for (const v of ['in_progress', 'submitted', 'grading', 'graded', 'pending_grade']) {
      expect(s()).toContain(`'${v}'`);
    }
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`npx vitest run supabase/migrations/__tests__/migrations.test.ts`) → fails: file not found / no match.

- [ ] **Step 3: Write the migration** (idempotent column+CHECK, mirroring 0011's effort_label swap)

```sql
-- supabase/migrations/0015_assignment_player.sql
-- Epic 2 / Segment 1 — Assignment Player foundation.
-- Adds the player-produced columns to homework_attempts + a named status CHECK.
-- Tutor tables (tutor_sessions/tutor_messages) and the student-work storage bucket
-- land in their own later migrations (Segments 3/4). Idempotent throughout.
-- hours_to_submit is bare numeric (the route rounds to 1 dp before writing).

ALTER TABLE public.homework_attempts ADD COLUMN IF NOT EXISTS task_grades     jsonb;
ALTER TABLE public.homework_attempts ADD COLUMN IF NOT EXISTS hours_to_submit numeric;
ALTER TABLE public.homework_attempts ADD COLUMN IF NOT EXISTS review_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.homework_attempts ADD COLUMN IF NOT EXISTS attempt_no      int     NOT NULL DEFAULT 1;

-- Named status CHECK (idempotent drop-then-add, pattern from 0011's effort_label swap).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'homework_attempts_status_check') THEN
    ALTER TABLE public.homework_attempts DROP CONSTRAINT homework_attempts_status_check;
  END IF;
END $$;
ALTER TABLE public.homework_attempts
  ADD CONSTRAINT homework_attempts_status_check
  CHECK (status IN ('in_progress','submitted','grading','graded','pending_grade'));
```

- [ ] **Step 4: Run the test — expect PASS.** Then `npx vitest run supabase/migrations` (full suite) to confirm no regression.

- [ ] **Step 5: Commit** — `feat(assignments): migration 0015 — homework_attempts player columns + status CHECK`

> **Controller apply note (post-merge, mirrors 0011 "NOT applied live here"):** before MCP `apply_migration`, run `SELECT DISTINCT status FROM homework_attempts` on the live NEW CORE DB and confirm the set ⊆ {in_progress, submitted, grading, graded, pending_grade}; a single out-of-set legacy value would make the live `ADD CONSTRAINT` fail. (Seeders only emit in_progress/submitted/graded, so this should pass — verify, don't assume.)

---

## Task 2: `gradeAssignment` — the dedicated continuous-grade assignment grader

**Files:**
- Create: `src/lib/engine/gradeAssignment.ts`
- Test: `src/lib/engine/__tests__/gradeAssignment.test.ts`

**Interfaces:**
- Consumes: `claudeChat` (`@/lib/ai/claude`), `resilientChatCompletion` (`@/lib/ai/openai`), `CLAUDE_GRADING_MODEL` + `OPENAI_GEN_MODEL` (`@/lib/ai/models`), `LlmExhaustedError` (`@/lib/ai/errors`), `zod`. (Mirrors `src/lib/engine/grading.ts`'s Claude→GPT resilience structure — read it as the template.)
- Produces:
  ```ts
  interface AssignmentGradeInput {
    assignmentTitle: string;
    tasks: Array<{ step: number; description: string }>;
    responses: Record<string, { text: string; image_url: string | null }>;
  }
  interface AssignmentGradeResult {
    overall_grade: number;                                             // 0–100 (continuous)
    overall_feedback: string;                                          // 2–3 warm student-facing sentences
    task_grades: Array<{ step: number; grade: number; feedback: string }>; // grade 0–100 per task
  }
  async function gradeAssignment(input: AssignmentGradeInput): Promise<AssignmentGradeResult>
  ```
- Throws `LlmExhaustedError` when both legs exhausted/unparseable — NEVER fabricates a grade. Consumed by Task 6.

- [ ] **Step 1: Write the failing test** (mock both AI legs; assert parse/validate, fallback, and throw-on-exhaustion)

```ts
// src/lib/engine/__tests__/gradeAssignment.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const claudeChat = vi.fn();
const resilientChatCompletion = vi.fn();
vi.mock('@/lib/ai/claude', () => ({ claudeChat }));
vi.mock('@/lib/ai/openai', () => ({ resilientChatCompletion }));
vi.mock('@/lib/ai/models', () => ({ CLAUDE_GRADING_MODEL: 'claude-sonnet-4-6', OPENAI_GEN_MODEL: 'gpt-4o' }));

import { gradeAssignment } from '@/lib/engine/gradeAssignment';
import { LlmExhaustedError } from '@/lib/ai/errors';

const input = {
  assignmentTitle: 'Photosynthesis',
  tasks: [{ step: 1, description: 'Explain photosynthesis' }, { step: 2, description: 'Give an example' }],
  responses: { '1': { text: 'Plants make food from light', image_url: null }, '2': { text: 'A leaf', image_url: null } },
};
const VALID = JSON.stringify({ overall_grade: 84, overall_feedback: 'Strong work.', task_grades: [{ step: 1, grade: 90, feedback: 'Clear.' }, { step: 2, grade: 78, feedback: 'Add detail.' }] });

beforeEach(() => { claudeChat.mockReset(); resilientChatCompletion.mockReset(); });

describe('gradeAssignment', () => {
  it('parses a valid Claude grade (continuous 0–100)', async () => {
    claudeChat.mockResolvedValue(VALID);
    const r = await gradeAssignment(input);
    expect(r.overall_grade).toBe(84);
    expect(r.task_grades).toHaveLength(2);
    expect(r.task_grades[0].grade).toBe(90);
  });

  it('falls back to GPT when Claude throws', async () => {
    claudeChat.mockRejectedValue(new Error('429'));
    resilientChatCompletion.mockResolvedValue({ choices: [{ message: { content: VALID } }] });
    const r = await gradeAssignment(input);
    expect(r.overall_grade).toBe(84);
  });

  it('throws LlmExhaustedError when both legs fail/unparseable (never fabricates)', async () => {
    claudeChat.mockResolvedValue('not json');
    resilientChatCompletion.mockResolvedValue({ choices: [{ message: { content: '{bad' } }] });
    await expect(gradeAssignment(input)).rejects.toBeInstanceOf(LlmExhaustedError);
  });

  it('rejects an out-of-range grade as unparseable (schema guard)', async () => {
    claudeChat.mockResolvedValue(JSON.stringify({ overall_grade: 150, overall_feedback: 'x', task_grades: [] }));
    resilientChatCompletion.mockResolvedValue({ choices: [{ message: { content: '{bad' } }] });
    await expect(gradeAssignment(input)).rejects.toBeInstanceOf(LlmExhaustedError);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement** (mirror `grading.ts`: Claude primary → GPT fallback → throw; Zod-validate)

```ts
// src/lib/engine/gradeAssignment.ts
// Dedicated multi-task assignment grader — CONTINUOUS 0–100 (unlike the quiz OEQ grader
// which is locked to {0,0.5,1.0}). Assignments are GRADED coursework that counts toward
// the class final grade, so the student sees a real percentage. Claude primary (temp 0.3,
// 800 tok) → GPT fallback. Throws LlmExhaustedError on exhaustion — NEVER fabricates.
// Import-safe: no next/server, no module-load SDK construction.
import { z } from 'zod';
import { claudeChat } from '@/lib/ai/claude';
import { resilientChatCompletion } from '@/lib/ai/openai';
import { OPENAI_GEN_MODEL, CLAUDE_GRADING_MODEL } from '@/lib/ai/models';
import { LlmExhaustedError } from '@/lib/ai/errors';

export interface AssignmentGradeInput {
  assignmentTitle: string;
  tasks: Array<{ step: number; description: string }>;
  responses: Record<string, { text: string; image_url: string | null }>;
}

const AssignmentGradeResultSchema = z.object({
  overall_grade: z.number().min(0).max(100),
  overall_feedback: z.string(),
  task_grades: z.array(z.object({ step: z.number(), grade: z.number().min(0).max(100), feedback: z.string() })),
});
export type AssignmentGradeResult = z.infer<typeof AssignmentGradeResultSchema>;

const SYSTEM = [
  'You are an experienced, encouraging K-12 teacher grading a student assignment.',
  'Grade each task on its own merits against the task description and the rubric below, then give an overall grade.',
  'RUBRIC (0-100): no work 5-15; off-topic 0-15; partial/developing 20-59; complete/proficient 60-100.',
  'Feedback speaks TO the student about THEIR RESPONSE, is warm, names what to try next, and NEVER reveals the correct answer.',
  'Do NOT put any number, percentage, score word, or grade inside any feedback string — feedback is words only.',
  'Return ONLY valid JSON, no markdown fences, matching: {"overall_grade":int,"overall_feedback":str,"task_grades":[{"step":int,"grade":int,"feedback":str}]}.',
].join('\n');

function buildPrompt(input: AssignmentGradeInput): string {
  const lines = [`Assignment: ${input.assignmentTitle}`, ''];
  for (const t of input.tasks) {
    const a = input.responses[String(t.step)];
    lines.push(`Task ${t.step}: ${t.description}`);
    lines.push(`Student response: ${a?.text?.trim() || (a?.image_url ? '[submitted a drawing/image]' : '[no response]')}`);
    lines.push('');
  }
  lines.push('Grade every task (by step) and the overall assignment. Return the JSON object only.');
  return lines.join('\n');
}

function tryParse(raw: string | null): AssignmentGradeResult | null {
  if (!raw) return null;
  try { const r = AssignmentGradeResultSchema.safeParse(JSON.parse(raw)); return r.success ? r.data : null; }
  catch { return null; }
}

export async function gradeAssignment(input: AssignmentGradeInput): Promise<AssignmentGradeResult> {
  const userPrompt = buildPrompt(input);

  let claudeRaw: string | null = null;
  try { claudeRaw = await claudeChat(SYSTEM, userPrompt, { temperature: 0.3, maxTokens: 800, model: CLAUDE_GRADING_MODEL }); }
  catch { /* fall through to GPT */ }
  const claudeParsed = tryParse(claudeRaw);
  if (claudeParsed) return claudeParsed;

  let gptRaw: string | null = null;
  try {
    const completion = await resilientChatCompletion({
      model: OPENAI_GEN_MODEL,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userPrompt }],
      temperature: 0.3, max_tokens: 800, response_format: { type: 'json_object' },
    });
    gptRaw = completion?.choices?.[0]?.message?.content ?? null;
  } catch { /* terminal below */ }
  const gptParsed = tryParse(gptRaw);
  if (gptParsed) return gptParsed;

  throw new LlmExhaustedError('claude+openai');
}
```

- [ ] **Step 4: Run the test — expect PASS.**
- [ ] **Step 5: Commit** — `feat(engine): gradeAssignment continuous-grade multi-task grader`

> **Confirm before coding:** open `src/lib/engine/grading.ts` and `src/lib/ai/claude.ts`/`openai.ts`/`models.ts` to verify `claudeChat(system, user, { temperature, maxTokens, model })` and `resilientChatCompletion({ model, messages, temperature, max_tokens, response_format })` signatures exactly. Match them.

---

## Task 3: `assignmentResultBundle` — the grade-visible, double-guarded result bundle

**Files:**
- Create: `src/lib/assignments/assignmentResultBundle.ts`
- Test: `src/lib/assignments/__tests__/assignmentResultBundle.test.ts`

**Interfaces:**
- Consumes: `getScoreMessage` (`@/lib/quiz/scoreMessage`), `masteryDisplayLabel` (`@/lib/utils/masteryLabel`), `hasLeak` + `hasBannedWord` (`@/lib/copy/leakGuard`).
- Produces:
  ```ts
  interface AssignmentResultBundle {
    gradePct: number;                 // ALLOW-LISTED — shown to the student, NOT leak-guarded
    masteryLabel: string;             // soft word (Building/On Track/Strong)
    message: { message: string; teliMsg: string; teliState: 'celebrating'|'idle'|'speaking' }; // double-guarded
    overallFeedback: string;          // sanitized grader prose
    taskFeedback: Array<{ step: number; feedback: string }>; // sanitized per-task prose
  }
  function assignmentResultBundle(input: {
    scorePct: number; masteryBand: 'reteach'|'grade_level'|'advanced';
    tier: 'elementary'|'middle'|'high'; firstName: string | null; attemptId: string;
    rawOverallFeedback: string; rawTaskFeedback: Array<{ step: number; feedback: string }>; locale?: string;
  }): AssignmentResultBundle
  ```

> **Confirm signatures first:** `getScoreMessage(pct, attemptId/*seed*/, locale, tier, firstName)` and `masteryDisplayLabel(band)`. The real EN `scoreMessage` pools contain the banned word "score" in ≥3 variants, so the bundle MUST defensively re-guard `message.message`.

- [ ] **Step 1: Write the failing test** (assert: grade visible; message + feedback pass BOTH guards; banned-word feedback AND banned-word message variant both fall back)

```ts
// src/lib/assignments/__tests__/assignmentResultBundle.test.ts
import { describe, it, expect } from 'vitest';
import { assignmentResultBundle } from '@/lib/assignments/assignmentResultBundle';
import { hasLeak, hasBannedWord } from '@/lib/copy/leakGuard';

const base = { masteryBand: 'advanced' as const, tier: 'middle' as const, firstName: 'Jordan', attemptId: 'attempt-1' };

describe('assignmentResultBundle', () => {
  it('carries the numeric grade for the student to see', () => {
    const b = assignmentResultBundle({ ...base, scorePct: 92, rawOverallFeedback: 'Nice synthesis.', rawTaskFeedback: [] });
    expect(b.gradePct).toBe(92);
  });

  it('coach message passes BOTH guards (no number, no banned word)', () => {
    // sweep several seeds/scores so a banned-word pool variant is exercised and re-guarded
    for (const scorePct of [95, 80, 65, 40]) {
      const b = assignmentResultBundle({ ...base, scorePct, rawOverallFeedback: 'ok', rawTaskFeedback: [] });
      expect(hasLeak(b.message.message)).toBe(false);
      expect(hasBannedWord(b.message.message)).toBe(false);
    }
  });

  it('sanitizes overall + per-task feedback that leaks a number OR a banned word', () => {
    const b = assignmentResultBundle({
      ...base, scorePct: 80,
      rawOverallFeedback: 'Your score model flags this as strong.', // banned words → replaced
      rawTaskFeedback: [
        { step: 1, feedback: 'Great reasoning connecting cause to effect.' }, // clean → kept
        { step: 2, feedback: 'You got 3 of 4 right.' },                        // digits → replaced
      ],
    });
    expect(hasLeak(b.overallFeedback)).toBe(false);
    expect(hasBannedWord(b.overallFeedback)).toBe(false);
    expect(b.taskFeedback[0].feedback).toContain('Great reasoning');
    expect(hasLeak(b.taskFeedback[1].feedback)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement** (double-guard every non-grade string; defensive message fallback)

```ts
// src/lib/assignments/assignmentResultBundle.ts
// Assignments are GRADED → the student SEES the grade (gradePct, allow-listed). Every OTHER
// string passes BOTH guards (assertNoLeak digit/% guard + assertNoBannedWord). The shared
// scoreMessage pools contain the banned word "score" in some variants, so we re-guard the
// picked message and fall back to a clean generic line if it trips.
import { getScoreMessage } from '@/lib/quiz/scoreMessage';
import { masteryDisplayLabel } from '@/lib/utils/masteryLabel';
import { hasLeak, hasBannedWord } from '@/lib/copy/leakGuard';

const GENERIC_FEEDBACK = 'Nice effort here — keep building on your thinking.';
const GENERIC_MESSAGE = 'Nice work on this one. Keep it up!';

const dirty = (s: string) => hasLeak(s) || hasBannedWord(s);
const clean = (s: string, fallback: string) => (dirty(s) ? fallback : s);

export interface AssignmentResultBundle {
  gradePct: number;
  masteryLabel: string;
  message: { message: string; teliMsg: string; teliState: 'celebrating' | 'idle' | 'speaking' };
  overallFeedback: string;
  taskFeedback: Array<{ step: number; feedback: string }>;
}

export function assignmentResultBundle(input: {
  scorePct: number;
  masteryBand: 'reteach' | 'grade_level' | 'advanced';
  tier: 'elementary' | 'middle' | 'high';
  firstName: string | null;
  attemptId: string;
  rawOverallFeedback: string;
  rawTaskFeedback: Array<{ step: number; feedback: string }>;
  locale?: string;
}): AssignmentResultBundle {
  const { scorePct, masteryBand, tier, firstName, attemptId, rawOverallFeedback, rawTaskFeedback, locale = 'en' } = input;

  const picked = getScoreMessage(scorePct, attemptId, locale, tier, firstName);
  const message = {
    message: clean(picked.message, GENERIC_MESSAGE),
    teliMsg: clean(picked.teliMsg, GENERIC_MESSAGE),
    teliState: picked.teliState,
  };

  return {
    gradePct: scorePct,
    masteryLabel: masteryDisplayLabel(masteryBand),
    message,
    overallFeedback: clean(rawOverallFeedback, GENERIC_FEEDBACK),
    taskFeedback: rawTaskFeedback.map(({ step, feedback }) => ({ step, feedback: clean(feedback, GENERIC_FEEDBACK) })),
  };
}
```

- [ ] **Step 4: Run the test — expect PASS.**
- [ ] **Step 5: Commit** — `feat(assignments): assignmentResultBundle (grade-visible, double-guarded prose)`

> Note for STRINGS-FOR-BARB: the shared `scoreMessage` EN pools contain the banned word "score" in ≥3 variants ("Top-band score", "this score reflects…", "Mid-band score"). This bundle defends against it, but Barb should clean those pool variants (the teliMsg twins already avoid "score") — flag it, don't silently leave it.

---

## Task 4: `loadAssignmentForPlay` — load + resolve attempt (with the redo gate)

**Files:**
- Create: `src/lib/assignments/loadAssignmentForPlay.ts`
- Test: `src/lib/assignments/__tests__/loadAssignmentForPlay.test.ts`

**Interfaces:**
- Consumes: admin client, `studentId`, `assignmentId`.
- Produces:
  ```ts
  type AssignmentContent = { title?: string; instructions?: string; reading_passage?: string;
    audio_script?: string; tasks?: Array<{ step: number; description: string; type?: string }> };
  type ResponsesShape = { tasks: Record<string, { text: string; image_url: string | null }> };
  interface PlayableAssignment {
    assignment: { id: string; content: AssignmentContent };
    attempt: { id: string; status: string; responses: ResponsesShape; attempt_no: number };
    ownershipOk: boolean;     // false when missing OR student_id !== studentId
    sparkBlocked: boolean;    // true when spark_status !== 'none'
    gradedLocked: boolean;    // true when the latest attempt is graded AND !allow_redo (no new attempt)
  }
  ```
- **Redo gate (the binding fix):** resume the latest attempt if its status is `in_progress` OR `grading` (crash-recovery). If the latest is `graded`/`submitted`: create a NEW `in_progress` attempt (`attempt_no`+1, `is_redo=true`) **only when `allow_redo === true` on that latest row**; otherwise return that graded row with `gradedLocked: true` and create nothing.
- **Seed-shape normalization:** before coding, open `src/lib/demo/buildSeedRows.ts` and confirm seeded `content.tasks` carry `{ step:number, description:string }`. If a task lacks `step`/`description` (lean seed shape), normalize (index→step, `description ?? instructions ?? ''`) so the grader never receives `undefined`. Test BOTH shapes.

- [ ] **Step 1: Write the failing test** (cover: missing→ownership false; mismatch→ownership false; spark→blocked; resume in_progress; resume grading; graded+allow_redo→new attempt is_redo; graded+!allow_redo→gradedLocked, NO insert; lean-seed tasks normalized)

```ts
// src/lib/assignments/__tests__/loadAssignmentForPlay.test.ts
import { describe, it, expect, vi } from 'vitest';
import { loadAssignmentForPlay } from '@/lib/assignments/loadAssignmentForPlay';

function makeAdmin(opts: { assignmentRow: unknown; latestAttempt: unknown; insertedId?: string }) {
  const insert = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: { id: opts.insertedId ?? 'att-new', attempt_no: 2, status: 'in_progress', responses: { tasks: {} } }, error: null }) }) });
  return {
    _insert: insert,
    from: (table: string) => table === 'assignments'
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.assignmentRow, error: null }) }) }) }
      : { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: opts.latestAttempt, error: null }) }) }) }) }) }), insert },
  } as never;
}
const OWNED = { id: 'a1', student_id: 's1', content: { title: 'X', tasks: [{ step: 1, description: 'Explain' }] }, spark_status: 'none' };

describe('loadAssignmentForPlay', () => {
  it('ownership false when missing', async () => { expect((await loadAssignmentForPlay(makeAdmin({ assignmentRow: null, latestAttempt: null }), 's1', 'a1')).ownershipOk).toBe(false); });
  it('ownership false on student mismatch', async () => { expect((await loadAssignmentForPlay(makeAdmin({ assignmentRow: { ...OWNED, student_id: 'x' }, latestAttempt: null }), 's1', 'a1')).ownershipOk).toBe(false); });
  it('sparkBlocked for a spark assignment', async () => { expect((await loadAssignmentForPlay(makeAdmin({ assignmentRow: { ...OWNED, spark_status: 'created' }, latestAttempt: null }), 's1', 'a1')).sparkBlocked).toBe(true); });
  it('resumes an in_progress attempt', async () => { const r = await loadAssignmentForPlay(makeAdmin({ assignmentRow: OWNED, latestAttempt: { id: 'att-r', status: 'in_progress', responses: { tasks: {} }, attempt_no: 1, allow_redo: false } }), 's1', 'a1'); expect(r.attempt.id).toBe('att-r'); expect(r.gradedLocked).toBe(false); });
  it('resumes a stranded grading attempt (crash recovery)', async () => { const r = await loadAssignmentForPlay(makeAdmin({ assignmentRow: OWNED, latestAttempt: { id: 'att-g', status: 'grading', responses: { tasks: {} }, attempt_no: 1, allow_redo: false } }), 's1', 'a1'); expect(r.attempt.id).toBe('att-g'); });
  it('graded + allow_redo=true → creates a new is_redo attempt', async () => { const admin = makeAdmin({ assignmentRow: OWNED, latestAttempt: { id: 'att-old', status: 'graded', responses: { tasks: {} }, attempt_no: 1, allow_redo: true } }); const r = await loadAssignmentForPlay(admin, 's1', 'a1'); expect(r.attempt.id).toBe('att-new'); expect((admin as { _insert: ReturnType<typeof vi.fn> })._insert).toHaveBeenCalled(); });
  it('graded + allow_redo=false → gradedLocked, NO new attempt', async () => { const admin = makeAdmin({ assignmentRow: OWNED, latestAttempt: { id: 'att-old', status: 'graded', responses: { tasks: {} }, attempt_no: 1, allow_redo: false } }); const r = await loadAssignmentForPlay(admin, 's1', 'a1'); expect(r.gradedLocked).toBe(true); expect((admin as { _insert: ReturnType<typeof vi.fn> })._insert).not.toHaveBeenCalled(); });
  it('normalizes lean-seed tasks lacking step/description', async () => { const lean = { id: 'a1', student_id: 's1', spark_status: 'none', content: { instructions: 'Do it', tasks: [{ description: 'Only desc' }] } }; const r = await loadAssignmentForPlay(makeAdmin({ assignmentRow: lean, latestAttempt: null }), 's1', 'a1'); expect(r.assignment.content.tasks?.[0].step).toBe(1); expect(r.assignment.content.tasks?.[0].description).toBe('Only desc'); });
});
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement** (existence-hiding guard; spark guard; redo gate; normalize tasks; resume in_progress|grading)

```ts
// src/lib/assignments/loadAssignmentForPlay.ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type AssignmentContent = { title?: string; instructions?: string; reading_passage?: string; audio_script?: string; tasks?: Array<{ step: number; description: string; type?: string }> };
export type ResponsesShape = { tasks: Record<string, { text: string; image_url: string | null }> };
export interface PlayableAssignment {
  assignment: { id: string; content: AssignmentContent };
  attempt: { id: string; status: string; responses: ResponsesShape; attempt_no: number };
  ownershipOk: boolean; sparkBlocked: boolean; gradedLocked: boolean;
}
const EMPTY: ResponsesShape = { tasks: {} };
const NO_ATTEMPT = { id: '', status: 'none', responses: EMPTY, attempt_no: 0 };

/** Tolerate both the rich AssignmentSchema and the lean seed shape: every task gets {step, description}. */
function normalizeContent(raw: AssignmentContent | null): AssignmentContent {
  const c = raw ?? {};
  const tasks = (c.tasks ?? []).map((t, i) => {
    const tt = t as { step?: number; description?: string; type?: string };
    return { step: typeof tt.step === 'number' ? tt.step : i + 1, description: tt.description ?? c.instructions ?? '', type: tt.type };
  });
  return { ...c, tasks };
}

export async function loadAssignmentForPlay(admin: SupabaseClient, studentId: string, assignmentId: string): Promise<PlayableAssignment> {
  const { data: row } = await admin.from('assignments').select('id, student_id, content, spark_status').eq('id', assignmentId).maybeSingle();
  if (!row || (row as { student_id: string }).student_id !== studentId) {
    return { assignment: { id: assignmentId, content: {} }, attempt: { ...NO_ATTEMPT }, ownershipOk: false, sparkBlocked: false, gradedLocked: false };
  }
  const r = row as { id: string; content: AssignmentContent | null; spark_status: string | null };
  const content = normalizeContent(r.content);
  if ((r.spark_status ?? 'none') !== 'none') {
    return { assignment: { id: r.id, content }, attempt: { ...NO_ATTEMPT }, ownershipOk: true, sparkBlocked: true, gradedLocked: false };
  }

  const { data: latest } = await admin.from('homework_attempts')
    .select('id, status, responses, attempt_no, allow_redo')
    .eq('assignment_id', assignmentId).eq('student_id', studentId)
    .order('attempt_no', { ascending: false }).limit(1).maybeSingle();
  const a = latest as { id: string; status: string; responses: ResponsesShape | null; attempt_no: number | null; allow_redo: boolean | null } | null;

  // Resume an active attempt (in_progress, or a stranded 'grading' row after a crash).
  if (a && (a.status === 'in_progress' || a.status === 'grading')) {
    return { assignment: { id: r.id, content }, attempt: { id: a.id, status: a.status, responses: a.responses ?? EMPTY, attempt_no: a.attempt_no ?? 1 }, ownershipOk: true, sparkBlocked: false, gradedLocked: false };
  }

  // Latest is graded/submitted: only a teacher-granted redo opens a NEW attempt.
  if (a && !a.allow_redo) {
    return { assignment: { id: r.id, content }, attempt: { id: a.id, status: a.status, responses: a.responses ?? EMPTY, attempt_no: a.attempt_no ?? 1 }, ownershipOk: true, sparkBlocked: false, gradedLocked: true };
  }

  const nextNo = (a?.attempt_no ?? 0) + 1;
  const { data: inserted } = await admin.from('homework_attempts')
    .insert({ assignment_id: assignmentId, student_id: studentId, status: 'in_progress', responses: EMPTY, attempt_no: nextNo, is_redo: nextNo > 1 })
    .select('id, status, responses, attempt_no').single();
  const ins = inserted as { id: string; status: string; responses: ResponsesShape | null; attempt_no: number };
  return { assignment: { id: r.id, content }, attempt: { id: ins.id, status: ins.status, responses: ins.responses ?? EMPTY, attempt_no: ins.attempt_no }, ownershipOk: true, sparkBlocked: false, gradedLocked: false };
}
```

> **Lifecycle note (acceptable for the Beta):** an attempt row is created on first page-load of a fresh assignment. To avoid orphan/double rows under refresh or strict-mode double-render, the create branch is reached only when there is NO resumable row — a refresh resumes the just-created `in_progress` row rather than inserting again. (A true idempotency key is deferred; document this.)

- [ ] **Step 4: Run the test — expect PASS.**
- [ ] **Step 5: Commit** — `feat(assignments): loadAssignmentForPlay (redo gate + resume + seed normalization)`

---

## Task 5: Autosave route — `PUT/GET /api/attempts/homework-draft`

(Unchanged from R1 — already clean per review. Reuses the in-progress `homework_attempts` row.)

**Files:**
- Create: `src/app/api/attempts/homework-draft/route.ts`
- Test: `src/app/api/attempts/homework-draft/__tests__/route.test.ts`

**Interfaces:** `PUT { attempt_id, responses }` → upsert `responses` for the owned, `in_progress` attempt (`401`/`404`/`409`/`200 {ok:true}`). `GET ?attempt_id=` → `{ responses }`.

- [ ] **Step 1: Write the failing test** (auth 401, ownership 404, status 409, happy 200) — *use the R1 test verbatim* (`docs/.../2026-06-21-assignment-player-foundation.md` history) — it mocks `@/lib/supabase/server`, asserts the four cases.
- [ ] **Step 2: Run it — expect FAIL.**
- [ ] **Step 3: Implement** — load `id, student_id, status`; guard ownership + `status==='in_progress'` (409 otherwise); `update({ responses })`. (R1 code is correct; copy it.)
- [ ] **Step 4: Run the test — expect PASS.**
- [ ] **Step 5: Commit** — `feat(assignments): homework-draft autosave route`

```ts
// src/app/api/attempts/homework-draft/route.ts
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
type ResponsesShape = { tasks: Record<string, { text: string; image_url: string | null }> };

async function owned(admin: ReturnType<typeof createAdminSupabaseClient>, attemptId: string, userId: string) {
  const { data } = await admin.from('homework_attempts').select('id, student_id, status').eq('id', attemptId).eq('student_id', userId).maybeSingle();
  return data as { id: string; student_id: string; status: string } | null;
}
export async function PUT(req: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let p: { attempt_id?: string; responses?: ResponsesShape };
  try { p = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  if (!p.attempt_id || !p.responses) return NextResponse.json({ error: 'Missing attempt_id or responses' }, { status: 400 });
  const admin = createAdminSupabaseClient();
  const att = await owned(admin, p.attempt_id, user.id);
  if (!att) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
  if (att.status !== 'in_progress') return NextResponse.json({ error: 'Attempt not editable' }, { status: 409 });
  const { error } = await admin.from('homework_attempts').update({ responses: p.responses }).eq('id', p.attempt_id).eq('student_id', user.id);
  if (error) return NextResponse.json({ error: 'Save failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
export async function GET(req: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const attemptId = new URL(req.url).searchParams.get('attempt_id');
  if (!attemptId) return NextResponse.json({ error: 'Missing attempt_id' }, { status: 400 });
  const admin = createAdminSupabaseClient();
  const { data } = await admin.from('homework_attempts').select('responses').eq('id', attemptId).eq('student_id', user.id).maybeSingle();
  if (!data) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
  return NextResponse.json({ responses: (data as { responses: ResponsesShape | null }).responses });
}
```

---

## Task 6: Submit + grade route — `POST /api/attempts/homework-submit`

**Files:**
- Create: `src/app/api/attempts/homework-submit/route.ts`
- Test: `src/app/api/attempts/homework-submit/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `gradeAssignment` (Task 2), **the existing** `computeEffortLabel` (`@/lib/signals/computeEffortLabel` — **object signature** `computeEffortLabel({ score, teliHintCount })`; confirm by reading the file), `assignmentResultBundle` (Task 3), `computeMasteryBand` (`@/lib/utils/scoring`), `gradeTextToTier` (`@/lib/quiz/gradeTextToTier`), `computeSignals` + `upsertBehavioralSignals`, `recomputeSkillStatesForStudent`, `respondEngineError`, `after`.
- Request body: `{ attempt_id, responses, sessionAggregates, perTaskMetrics }`. Never-half-grade: a `gradeAssignment` throw OR any write error → `status:'pending_grade'`, `review_required:true`, return `{ attempt_id, grading_delayed:true, message }`.
- Grade write (all-clean path): `score_pct = overall_grade`; `task_grades` from the grader; `ai_feedback = { overall, tasks }`; `effort_label = computeEffortLabel({ score: scorePct, teliHintCount })`; `submitted_on_time` from `assignments.due_at` (true when `due_at` null); `hours_to_submit` from `created_at` (documented approximation). Moat hook: `context:'homework'`, per-task `isCorrect = grade >= 50`, `hintsUsed: 0` (Segment 3 feeds real counts).

- [ ] **Step 1: Write the failing test** — **mock `next/server`'s `after`**, mock the signal libs, and **record `.update()` payloads** so the write-contract is actually asserted. Use the `vi.resetModules()` + dynamic `await import('.../route')` idiom the existing submit tests use.

```ts
// src/app/api/attempts/homework-submit/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// after() runs the callback synchronously in tests (mirror submit-signals.test.ts).
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (cb: () => void | Promise<void>) => { void cb(); } }));

const getUser = vi.fn();
const gradeAssignment = vi.fn();
const computeSignals = vi.fn().mockReturnValue({ ok: true });
const upsertBehavioralSignals = vi.fn().mockResolvedValue(undefined);
const recompute = vi.fn().mockResolvedValue(undefined);
const updates: Array<Record<string, unknown>> = [];

vi.mock('@/lib/engine/gradeAssignment', () => ({ gradeAssignment }));
vi.mock('@/lib/signals/computeSignals', () => ({ computeSignals }));
vi.mock('@/lib/signals/behavioralModel', () => ({ upsertBehavioralSignals }));
vi.mock('@/lib/skills/recomputeSkillStates', () => ({ recomputeSkillStatesForStudent: recompute }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'assignments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'a1', content: { title: 'X', tasks: [{ step: 1, description: 'Explain X' }, { step: 2, description: 'Explain Y' }] }, due_at: null } }) }) }) };
      if (t === 'users') return { select: () => ({ eq: () => ({ single: async () => ({ data: { school_id: 'sch1', grade_level: '7', full_name: 'Jordan Lee' } }) }) }) };
      return { // homework_attempts
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ATTEMPT }) }) }) }),
        update: (payload: Record<string, unknown>) => { updates.push(payload); return { eq: () => ({ eq: async () => ({ error: null }) }) }; },
      };
    },
  }),
}));

let ATTEMPT: unknown;
const req = (b: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(b) });
const fullBody = {
  attempt_id: 'att1',
  responses: { tasks: { '1': { text: 'because photosynthesis', image_url: null }, '2': { text: 'energy flows', image_url: null } } },
  sessionAggregates: { focusLossCount: 0, pasteCount: 0, pauseCount: 1, totalPauseMs: 1000, totalFocusLossMs: 0, backspaceCount: 2, keypressCount: 40, ttsPlayCount: 0, canvasUsed: false, stuckEraseCount: 0 },
  perTaskMetrics: [{ step: 1, timeTakenMs: 30000, changeCount: 1 }, { step: 2, timeTakenMs: 25000, changeCount: 0 }],
};

async function load() { vi.resetModules(); return (await import('@/app/api/attempts/homework-submit/route')).POST; }

beforeEach(() => {
  getUser.mockReset(); gradeAssignment.mockReset(); updates.length = 0;
  computeSignals.mockClear(); upsertBehavioralSignals.mockClear(); recompute.mockClear();
  ATTEMPT = { id: 'att1', student_id: 'u1', assignment_id: 'a1', status: 'in_progress', teli_hint_count: 0, created_at: new Date(Date.now() - 3600_000).toISOString(), allow_redo: false };
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  gradeAssignment.mockResolvedValue({ overall_grade: 84, overall_feedback: 'Strong work.', task_grades: [{ step: 1, grade: 90, feedback: 'Clear.' }, { step: 2, grade: 78, feedback: 'Add detail.' }] });
});

describe('POST /api/attempts/homework-submit', () => {
  it('401 without a user', async () => { getUser.mockResolvedValue({ data: { user: null }, error: null }); expect((await (await load())(req(fullBody))).status).toBe(401); });
  it('404 when not owned', async () => { ATTEMPT = null; expect((await (await load())(req(fullBody))).status).toBe(404); });
  it('400 incomplete when a task has no text or image', async () => {
    const res = await (await load())(req({ ...fullBody, responses: { tasks: { '1': { text: '', image_url: null }, '2': { text: '', image_url: null } } } }));
    expect(res.status).toBe(400); expect((await res.json()).error).toBe('incomplete_assignment');
  });
  it('409 when a graded attempt without allow_redo is resubmitted', async () => { ATTEMPT = { ...(ATTEMPT as object), status: 'graded', allow_redo: false }; expect((await (await load())(req(fullBody))).status).toBe(409); });
  it('grades, returns the VISIBLE grade, and writes the full contract', async () => {
    const res = await (await load())(req(fullBody));
    expect(res.status).toBe(200);
    expect((await res.json()).result.gradePct).toBe(84);
    const graded = updates.find(u => u.status === 'graded');
    expect(graded).toBeDefined();
    expect(graded!.score_pct).toBe(84);
    expect(graded!.task_grades).toBeDefined();
    expect(graded!.effort_label).toBeTruthy();
    expect(graded!.submitted_at).toBeTruthy();
    expect(graded!.graded_at).toBeTruthy();
    expect(typeof graded!.hours_to_submit).toBe('number');
  });
  it('fires the moat hook with context:homework on the clean path', async () => {
    await (await load())(req(fullBody));
    expect(upsertBehavioralSignals).toHaveBeenCalledTimes(1);
    expect(computeSignals.mock.calls[0][0].context).toBe('homework');
  });
  it('routes to pending_grade and does NOT fire the moat when grading throws', async () => {
    gradeAssignment.mockRejectedValueOnce(new Error('llm down'));
    const res = await (await load())(req(fullBody));
    expect((await res.json()).grading_delayed).toBe(true);
    expect(upsertBehavioralSignals).not.toHaveBeenCalled();
    expect(updates.some(u => u.status === 'pending_grade')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement**

```ts
// src/app/api/attempts/homework-submit/route.ts
import { NextResponse, after } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { gradeAssignment } from '@/lib/engine/gradeAssignment';
import { computeEffortLabel } from '@/lib/signals/computeEffortLabel';
import { assignmentResultBundle } from '@/lib/assignments/assignmentResultBundle';
import { computeMasteryBand } from '@/lib/utils/scoring';
import { gradeTextToTier } from '@/lib/quiz/gradeTextToTier';
import { respondEngineError } from '@/app/api/_lib/errorEnvelope';
import { recomputeSkillStatesForStudent } from '@/lib/skills/recomputeSkillStates';
import type { QuestionAttemptData, SessionAggregates, RawSessionData } from '@/lib/signals/behavioralTypes';

type ResponsesShape = { tasks: Record<string, { text: string; image_url: string | null }> };
type PerTaskMetric = { step: number; timeTakenMs: number; changeCount: number };
const PENDING = (id: string) => NextResponse.json({ attempt_id: id, grading_delayed: true, message: 'Your answers have been saved. Grading is on its way — check back shortly.' });

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: { attempt_id?: string; responses?: ResponsesShape; sessionAggregates?: Partial<SessionAggregates>; perTaskMetrics?: PerTaskMetric[] };
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
    if (!body.attempt_id || !body.responses) return NextResponse.json({ error: 'Missing attempt_id or responses' }, { status: 400 });

    const admin = createAdminSupabaseClient();
    const { data: attemptRow } = await admin.from('homework_attempts')
      .select('id, student_id, assignment_id, status, teli_hint_count, created_at, allow_redo')
      .eq('id', body.attempt_id).eq('student_id', user.id).maybeSingle();
    const attempt = attemptRow as { id: string; student_id: string; assignment_id: string; status: string; teli_hint_count: number | null; created_at: string; allow_redo: boolean | null } | null;
    if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    if (attempt.status === 'graded' && !attempt.allow_redo) return NextResponse.json({ error: 'Already graded' }, { status: 409 });

    const { data: aRow } = await admin.from('assignments').select('id, content, due_at').eq('id', attempt.assignment_id).maybeSingle();
    const content = (aRow as { content?: { title?: string; tasks?: Array<{ step: number; description: string }> } } | null)?.content ?? {};
    const dueAt = (aRow as { due_at?: string | null } | null)?.due_at ?? null;
    const tasks = content.tasks ?? [];
    if (tasks.length === 0) return NextResponse.json({ error: 'no_tasks' }, { status: 400 });

    // Completeness gate.
    const answers = body.responses.tasks ?? {};
    const missing = tasks.filter(t => { const a = answers[String(t.step)]; return !(a && (a.text?.trim() || a.image_url)); });
    if (missing.length > 0) return NextResponse.json({ error: 'incomplete_assignment', missing_count: missing.length, total_tasks: tasks.length }, { status: 400 });

    // Mark grading (best-effort) + persist final answers.
    await admin.from('homework_attempts').update({ status: 'grading', responses: body.responses }).eq('id', attempt.id).eq('student_id', user.id);

    // Dedicated continuous grader (never half-grade: throw → pending).
    let grade;
    try {
      grade = await gradeAssignment({ assignmentTitle: content.title ?? 'Assignment', tasks, responses: answers });
    } catch {
      await admin.from('homework_attempts').update({ status: 'pending_grade', review_required: true, submitted_at: new Date().toISOString() }).eq('id', attempt.id).eq('student_id', user.id);
      return PENDING(attempt.id);
    }

    const scorePct = Math.round(grade.overall_grade);
    const masteryBand = computeMasteryBand(scorePct);
    const teliHintCount = attempt.teli_hint_count ?? 0;
    const effortLabel = computeEffortLabel({ score: scorePct, teliHintCount }); // existing object-signature fn
    const submittedAt = new Date();
    const hoursToSubmit = Math.round(((submittedAt.getTime() - new Date(attempt.created_at).getTime()) / 3_600_000) * 10) / 10;
    const onTime = dueAt ? submittedAt.getTime() <= new Date(dueAt).getTime() : true; // untimed: on-time unless past due_at

    const { error: writeErr } = await admin.from('homework_attempts').update({
      status: 'graded', score_pct: scorePct,
      ai_feedback: { overall: grade.overall_feedback, tasks: grade.task_grades },
      task_grades: grade.task_grades, effort_label: effortLabel,
      submitted_at: submittedAt.toISOString(), graded_at: submittedAt.toISOString(),
      submitted_on_time: onTime, hours_to_submit: hoursToSubmit, review_required: false,
    }).eq('id', attempt.id).eq('student_id', user.id);
    if (writeErr) {
      await admin.from('homework_attempts').update({ status: 'pending_grade', review_required: true, submitted_at: submittedAt.toISOString() }).eq('id', attempt.id).eq('student_id', user.id);
      return PENDING(attempt.id);
    }

    // ── Behavioral-signals hook (the MOAT) — context:'homework' ──
    after(async () => {
      try {
        const { computeSignals } = await import('@/lib/signals/computeSignals');
        const { upsertBehavioralSignals } = await import('@/lib/signals/behavioralModel');
        const { data: userRow } = await admin.from('users').select('school_id').eq('id', attempt.student_id).single();
        const schoolId = (userRow as { school_id?: string | null } | null)?.school_id ?? null;
        const gradeByStep = new Map(grade.task_grades.map(g => [g.step, g.grade]));
        const metrics = new Map((body.perTaskMetrics ?? []).map(m => [m.step, m]));
        const questionAttempts: QuestionAttemptData[] = tasks.map(t => ({
          questionId: String(t.step), questionIndex: t.step,
          isCorrect: (gradeByStep.get(t.step) ?? 0) >= 50,
          timeTakenMs: metrics.get(t.step)?.timeTakenMs ?? 0,
          changeCount: metrics.get(t.step)?.changeCount ?? 0,
          hintsUsed: 0,
        }));
        const sa = body.sessionAggregates ?? {};
        const aggregates: SessionAggregates = {
          focusLossCount: sa.focusLossCount ?? 0, pasteCount: sa.pasteCount ?? 0, pauseCount: sa.pauseCount ?? 0,
          totalPauseMs: sa.totalPauseMs ?? 0, totalFocusLossMs: sa.totalFocusLossMs ?? 0, backspaceCount: sa.backspaceCount ?? 0,
          keypressCount: sa.keypressCount ?? 0, ttsPlayCount: sa.ttsPlayCount ?? 0, canvasUsed: sa.canvasUsed ?? false, stuckEraseCount: sa.stuckEraseCount ?? 0,
        };
        const rawSession: RawSessionData = {
          studentId: attempt.student_id, sessionId: attempt.id, context: 'homework', schoolId,
          questionAttempts, aggregates,
          sessionStartMs: new Date(attempt.created_at).getTime(), sessionEndMs: submittedAt.getTime(),
        };
        await upsertBehavioralSignals(admin, { studentId: attempt.student_id, schoolId, next: computeSignals(rawSession) });
      } catch (err) { console.warn('[homework-submit] behavioral hook failed (non-fatal):', err); }
    });

    // ── Skill-state recompute hook ──
    after(async () => { try { await recomputeSkillStatesForStudent(admin, { studentId: attempt.student_id, schoolId: null }); } catch (err) { console.warn('[homework-submit] skill recompute failed (non-fatal):', err); } });

    // ── Student-safe result (assignments SHOW the grade) ──
    const { data: profile } = await admin.from('users').select('grade_level, full_name').eq('id', attempt.student_id).single();
    const tier = gradeTextToTier((profile as { grade_level?: string | null } | null)?.grade_level ?? null);
    const firstName = ((profile as { full_name?: string | null } | null)?.full_name ?? '').trim().split(/\s+/)[0] || null;
    const result = assignmentResultBundle({ scorePct, masteryBand, tier, firstName, attemptId: attempt.id, rawOverallFeedback: grade.overall_feedback, rawTaskFeedback: grade.task_grades.map(g => ({ step: g.step, feedback: g.feedback })) });

    return NextResponse.json({ attempt_id: attempt.id, result });
  } catch (err) {
    console.error('[homework-submit] error:', err);
    return respondEngineError(err);
  }
}
```

> **Crash-stranding note:** a row stuck in `grading` after a process crash is recoverable — `loadAssignmentForPlay` (Task 4) resumes `grading` rows. **Verify the existing `computeEffortLabel` arg shape by reading `src/lib/signals/computeEffortLabel.ts` before wiring it** (object `{ score, teliHintCount }`).

- [ ] **Step 4: Run the test — expect PASS.** Then `npm test` (full suite).
- [ ] **Step 5: Commit** — `feat(assignments): homework-submit grade route (dedicated grader + write-contract + moat hook)`

---

## Task 7: Play page (server) — `assignments/[id]/play/page.tsx`

**Files:**
- Create: `src/app/(student)/student/assignments/[id]/play/page.tsx`
- Test: `src/app/(student)/student/assignments/[id]/play/__tests__/page.test.tsx`

**Interfaces:** Consumes `requireRole(['student'])`, `createAdminSupabaseClient`, `loadAssignmentForPlay`. Renders `<AssignmentPlayer/>` when `ownershipOk && !sparkBlocked && !gradedLocked`; the existence-hiding `EmptyState` on `!ownershipOk`; a "this one opens as a challenge" EmptyState on `sparkBlocked`; a graded/locked screen on `gradedLocked`.

- [ ] **Step 1: Write the failing test** (concrete — async params; mock `requireRole` + `loadAssignmentForPlay`)

```tsx
// src/app/(student)/student/assignments/[id]/play/__tests__/page.test.tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/auth/requireRole', () => ({ requireRole: vi.fn().mockResolvedValue({ userId: 's1' }) }));
vi.mock('@/lib/supabase/server', () => ({ createAdminSupabaseClient: () => ({}) }));
const load = vi.fn();
vi.mock('@/lib/assignments/loadAssignmentForPlay', () => ({ loadAssignmentForPlay: load }));
vi.mock('../_components/AssignmentPlayer', () => ({ AssignmentPlayer: () => <div data-testid="player" /> }));

import AssignmentPlayPage from '@/app/(student)/student/assignments/[id]/play/page';
const render Page = async (p = { id: 'a1' }) => render(await AssignmentPlayPage({ params: Promise.resolve(p) }));

describe('AssignmentPlayPage', () => {
  it('shows the existence-hiding EmptyState when not owned', async () => {
    load.mockResolvedValue({ ownershipOk: false });
    await renderPage();
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });
  it('renders the player when owned, non-spark, not locked', async () => {
    load.mockResolvedValue({ ownershipOk: true, sparkBlocked: false, gradedLocked: false, assignment: { id: 'a1', content: { tasks: [] } }, attempt: { id: 'att1', status: 'in_progress', responses: { tasks: {} }, attempt_no: 1 } });
    await renderPage();
    expect(screen.getByTestId('player')).toBeInTheDocument();
  });
  it('shows a graded/locked screen when gradedLocked', async () => {
    load.mockResolvedValue({ ownershipOk: true, sparkBlocked: false, gradedLocked: true, assignment: { id: 'a1', content: {} }, attempt: { id: 'att1', status: 'graded', responses: { tasks: {} }, attempt_no: 1 } });
    await renderPage();
    expect(screen.getByText(/already turned in|graded/i)).toBeInTheDocument();
  });
});
```

> (Fix the obvious typo `render Page`→`renderPage` when transcribing.)

- [ ] **Step 2: Run it — expect FAIL.**
- [ ] **Step 3: Implement**

```tsx
// src/app/(student)/student/assignments/[id]/play/page.tsx
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadAssignmentForPlay } from '@/lib/assignments/loadAssignmentForPlay';
import { EmptyState } from '@/components/core/EmptyState';
import { AssignmentPlayer } from './_components/AssignmentPlayer';

export default async function AssignmentPlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = await requireRole(['student']);
  const admin = createAdminSupabaseClient();
  const data = await loadAssignmentForPlay(admin, userId, id);

  if (!data.ownershipOk) return <EmptyState variant="just-getting-started" titleOverride="Assignment not found" bodyOverride="Head back to your assignments list." />;
  if (data.sparkBlocked) return <EmptyState variant="just-getting-started" titleOverride="This one opens as a Challenge" bodyOverride="Open it from your assignments list to launch the challenge." />;
  if (data.gradedLocked) return <EmptyState variant="just-getting-started" titleOverride="Already turned in" bodyOverride="You've finished this one. Your teacher can reopen it if you need another try." />;

  return <AssignmentPlayer assignmentId={data.assignment.id} attemptId={data.attempt.id} content={data.assignment.content} initialResponses={data.attempt.responses} />;
}
```

- [ ] **Step 4: Run the test — expect PASS.**
- [ ] **Step 5: Commit** — `feat(assignments): play page (server load + guards + graded-lock)`

---

## Task 8: `AssignmentPlayer` client + child components

**Files:**
- Create: `_components/AssignmentPlayer.tsx` (client; two-phase state machine + behavioral capture + autosave + submit) + `_components/{ReadPhase,TaskCard,TaskRail,SubmitPanel,AssignmentResultScreen,StateScreens}.tsx`
- Test: `_components/__tests__/AssignmentPlayer.test.tsx` and `_components/__tests__/AssignmentPlayer.leak.test.tsx` (both: `// @vitest-environment jsdom` then `import '@/test/setup-dom';`).

**Interfaces:** `AssignmentPlayer` props `{ assignmentId: string; attemptId: string; content: AssignmentContent; initialResponses: ResponsesShape }`. **State:** `'read' | 'tasks' | 'submitting' | 'graded' | 'pending' | 'error'`. Submit → `POST /api/attempts/homework-submit` `{ attempt_id, responses, sessionAggregates, perTaskMetrics }`. **Imports:** `EmptyState`/`Card`/`MathText` each from `@/components/core/<Name>` (no barrel); `assertNoLeak` from `@/lib/copy/leakGuard`. **Read `QuizRunner.tsx` + `ResultScreen.tsx` as the template** for the capture refs/listeners (`buildSessionAggregates` over focusLoss/paste/pause/backspace/keypress/stuckErase, `PAUSE_THRESHOLD=3000`; `ttsPlayCount`/`canvasUsed` stay `0/false`), the `assertNoLeak` render-boundary, and the token classes. Do NOT port timer/forfeit (untimed).

- [ ] **8a (test first, full code):** state machine + submit-gating + reaching `graded`.

```tsx
// excerpt — _components/__tests__/AssignmentPlayer.test.tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AssignmentPlayer } from '../AssignmentPlayer';

const content = { title: 'X', tasks: [{ step: 1, description: 'Explain X' }] };
beforeEach(() => { vi.restoreAllMocks(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ attempt_id: 'att1', result: { gradePct: 84, masteryLabel: 'Strong', message: { message: 'Nice!', teliMsg: 'Nice!', teliState: 'idle' }, overallFeedback: 'Good.', taskFeedback: [{ step: 1, feedback: 'Clear.' }] } }) })); });

describe('AssignmentPlayer', () => {
  it('moves read → tasks, gates submit until the task has text, then reaches graded', async () => {
    render(<AssignmentPlayer assignmentId="a1" attemptId="att1" content={content} initialResponses={{ tasks: {} }} />);
    fireEvent.click(screen.getByRole('button', { name: /ready to start|start/i }));
    const submit = screen.getByRole('button', { name: /turn in|submit/i });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'because photosynthesis' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByText('84%')).toBeInTheDocument()); // the grade IS shown
  });
});
```

- [ ] **8b:** autosave — typing fires a debounced `PUT /api/attempts/homework-draft` (fake timers); mount restores a newer `localStorage` draft. *(Assertion: after 3s a `fetch` to `/homework-draft` with the typed responses; with a newer localStorage blob present at mount, the textarea shows the restored text.)*
- [ ] **8c:** behavioral capture — paste/blur/backspace events update `buildSessionAggregates()`, and the submit POST body carries `sessionAggregates` + `perTaskMetrics`. *(Assertion: inspect the `fetch` submit-call body.)*
- [ ] **8d (the load-bearing four-audience leak test — full code):** render the REAL bundle → DOM; grade visible, everything else clean.

```tsx
// _components/__tests__/AssignmentPlayer.leak.test.tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { assignmentResultBundle } from '@/lib/assignments/assignmentResultBundle';
import { hasLeak, hasBannedWord } from '@/lib/copy/leakGuard';
import { AssignmentResultScreen } from '../AssignmentResultScreen';

it('shows the grade number but leaks nothing else', () => {
  const bundle = assignmentResultBundle({ scorePct: 84, masteryBand: 'grade_level', tier: 'middle', firstName: 'Jordan', attemptId: 'a1', rawOverallFeedback: 'You connected the ideas well.', rawTaskFeedback: [{ step: 1, feedback: 'Clear reasoning.' }] });
  render(<AssignmentResultScreen result={bundle} />);
  // (1) the grade IS shown (allow-listed), in its dedicated element
  expect(screen.getByTestId('grade-display')).toHaveTextContent('84%');
  // (2) every NON-grade string is clean — assert per bundle string, not over the whole DOM
  for (const s of [bundle.message.message, bundle.message.teliMsg, bundle.overallFeedback, ...bundle.taskFeedback.map(t => t.feedback)]) {
    expect(hasLeak(s)).toBe(false);
    expect(hasBannedWord(s)).toBe(false);
  }
});
```

> `AssignmentResultScreen` must render `gradePct` inside an element with `data-testid="grade-display"` (the allow-listed carve-out) and never render the per-task numeric `task_grades[].grade` to the student — only `taskFeedback` prose.

- [ ] **8e:** token-only components (no hex / no arbitrary `[var(--..)]`) — re-skin from `QuizRunner` token usage; rely on the a11y/lint gate.
- [ ] **Commit** after each green sub-step.

---

## Task 9: Wire the detail page — non-SPARK "Start" CTA

**Files:**
- Modify: `src/app/(student)/student/assignments/[id]/page.tsx` (add the `spark_status === 'none'` branch — the gap the grounding flagged)
- Test: extend `src/app/(student)/student/assignments/[id]/__tests__/page.test.tsx` — non-SPARK row shows a Start link to `/student/assignments/[id]/play`; SPARK still renders `SparkLaunchCard`.

- [ ] **Step 1: Write/extend the failing test.**
- [ ] **Step 2: Run it — expect FAIL.**
- [ ] **Step 3: Implement** `{sparkStatus === 'none' && <Link href={`/student/assignments/${id}/play`} className="…token classes…">Start assignment</Link>}`, preserving the existing ownership guard + SPARK branch.
- [ ] **Step 4: Run the test — expect PASS.**
- [ ] **Step 5: Commit** — `feat(assignments): non-SPARK Start CTA links to the player`

---

## Final whole-branch review

After Task 9, run all gates (`npm test`, `npx tsc --noEmit`, `npm run a11y`, `npm run build`, `npm run lint`) and dispatch the broad whole-branch review (most-capable model) per subagent-driven-development. **Acceptance = the Segment-1+2 write-contract** (Global Constraints): a submitted+graded assignment populates `status='graded', score_pct, ai_feedback, task_grades, effort_label, submitted_at, graded_at, submitted_on_time, hours_to_submit, attempt_no, is_redo, review_required=false`, the behavioral hook runs with `context:'homework'`, and the student sees the grade while no other string leaks. **Do NOT assert `canvas_data` or a non-zero `teli_hint_count`** (deferred to Segments 4/3). Then `superpowers:finishing-a-development-branch`.

**Deferred to later segment-plans (leave seams, do not build):** Teli tutor + hint ladder (Segment 3 — `teli_hint_count` stays 0), the drawing canvas (Segment 4 — `canvas_data`/`image_url`, the `student-work` bucket), voice (Segment 5 — `ttsPlayCount`). The `responses.tasks[].image_url` field and `sessionAggregates.canvasUsed/ttsPlayCount` already exist in the contracts so those segments slot in without reshaping data.
```
