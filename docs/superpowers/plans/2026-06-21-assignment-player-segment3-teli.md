# Assignment Player — Segment 3: Teli, the Tutor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision 2 (post pre-flight review).** A 5-lens adversarial pre-flight review found 2 Criticals + several Importants in R1; all are folded in here. Key R2 changes: the reveal-check **fails closed** (a classifier outage yields the safe fallback, never un-certified text); `claudeChat` throws are caught so Teli ALWAYS returns a safe string; an **output-side "names a thinking move"** predicate is tested (not prompt-only); the ladder is race-robust (count-after-insert + atomic RPC + one-active-session-per-attempt unique index); migration 0016 carries **RLS + policies + GRANTs**.

**Goal:** Build Teli — the one canonical Socratic AI tutor inside the non-SPARK Assignment Player — that scaffolds a student toward their own reasoning with a bounded hint ladder and **never reveals the answer**, and wire its hint usage into the moat (`teli_hint_count` → `effort_label` → behavioral signals).

**Architecture:** One route `POST /api/attempts/homework-tutor` (body-based `attempt_id`, matching the sibling homework routes), powered by `claude-opus-4-8`, **non-streaming** (reply generated in full → reveal-checked server-side → only then returned). A server-authoritative 4-rung ladder (`nudge → cue → step → encourage`) in `src/lib/teli/`. Two net-new clean tables (`tutor_sessions`, `tutor_messages`, migration 0016) with RLS. An inline `TeliPanel` mounts under the task card in `AssignmentPlayer`. At submit, the session's hint count becomes `teli_hint_count` and per-task hint counts feed `computeSignals`.

**Tech Stack:** Next.js 16 App Router (async params, `after()`), React 19, TypeScript, Tailwind v4 (token-only), Vitest 4 (+ jsdom for components), Supabase (admin client bypasses RLS — ownership guard is the IDOR backstop), `@anthropic-ai/sdk` via the existing `claudeChat` wrapper.

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from the spec (`docs/superpowers/specs/2026-06-21-assignment-player-design.md` §5.5–§6.7) and project rules.

- **Teli NEVER reveals the answer — defense in depth (the single hard requirement).** Three independent layers, no single failure can leak: (1) bounded ladder with no answer rung; (2) no answer key in the prompt (Teli gets the task text + the student's own work, never a "correct answer is X" field); (3) **output-boundary reveal-check that FAILS CLOSED** — generate full → assess → regenerate once on suspicion → fixed safe scaffold line on a second failure **OR whenever safety cannot be certified** (classifier/model unavailable). The student never sees un-checked or un-certified text. Memory: `v2-teli-tutor-never-reveals-answer`. **The guarantee outranks availability** (spec §6.1): during a reveal-classifier outage Teli returns the safe scaffold line rather than risk an un-certified reply — this degradation is intended.
- **Every help reply names the thinking move** ("let's separate what we know from what we're solving for"), not the answer content — and this is verified on Teli's OUTPUT via the `namesAThinkingMove` predicate + a soft regenerate, not merely requested in the prompt (per binding memory: "never prompt-only").
- **Numbers ARE allowed in tutor turns (Marvin, 2026-06-21).** Teli's guard is `hasBannedWord` (blocks the diagnostic vocabulary: score, percentile, index, divergence, threshold, signal, model, algorithm, flag) **plus the answer-reveal-check** — but **NOT** the blanket digit-ban `assertNoLeak`/`hasLeak`. A subject tutor legitimately uses ordinary numbers. The reveal-check, not a numeral ban, is the wall against leaking the *answer*.
- **Non-streaming.** The route returns a complete, already-checked reply. Client shows a brief "Teli's thinking…" state.
- **Server-authoritative, race-robust ladder.** The rung and counts are decided ONLY on the server, from persisted `tutor_messages` (count-after-insert) + an atomic counter RPC. The client renders `hints_remaining` from the response; it never decides a rung. One active `tutor_session` per attempt (a partial-unique index enforces it).
- **Free questions don't cost a hint (Marvin, 2026-06-21).** A turn with `is_help_request: false` is answered without advancing the ladder or incrementing any counter — but **the full safety guard still runs on it** (layers 2+3 are load-bearing for free turns). The explicit two-button UI (ask vs. hint) is the student's declared intent and **supersedes** the spec §6.4 "server classifies ambiguous turns" line; the server still authoritatively decides rung/count and guards every reply. (Spec §6.4 to be amended to match.)
- **Auth chain on the route:** `await createServerSupabaseClient()` → `auth.getUser()` (401 if absent) → `createAdminSupabaseClient()` → object-ownership guard (`.eq('id', attempt_id).eq('student_id', user.id)`, 404 existence-hiding) before any write. RLS is NOT the IDOR backstop.
- **Model:** `claude-opus-4-8` via `CLAUDE_TUTOR_MODEL`; the cheap reveal classifier uses `claude-haiku-4-5` via `CLAUDE_TUTOR_CHECK_MODEL`. Reuse `claudeChat(system, user, options?)` (returns `string | null` for non-retryable failures/timeouts, and **THROWS `LlmExhaustedError` on retry exhaustion** — callers MUST try/catch). Do NOT configure `thinking`.
- **`teli_hint_count` is an unbounded help-request-turn count**, NOT capped at 3 (`encourage` turns past the per-task cap still increment it). It is an effort proxy; `computeEffortLabel` only tests `>= EFFORT_THRESHOLD (2)`, so over-counting never reduces effort credit. Epic-3 consumers must not assume a 0–3 ceiling.
- **Copy = drafts → `STRINGS-FOR-BARB.md §Teli-Tutor`.** All Teli-visible strings are drafts; Barb gates final copy. COACH-POSTURE Rule 6 ("not a chatbot") governs the surface.
- **WCAG-AA token-only UI.** No hardcoded hex / arbitrary `[var(--..)]`; Tier-2 token classes only; content text `text-fg`. `npm run a11y` (49/49) stays green.
- **TDD.** Failing test first → watch it fail → minimal code. Component tests start with `// @vitest-environment jsdom` then `import '@/test/setup-dom';`. **Implementers must never weaken a reveal/guarantee assertion to make a test green — they may only ADD reveal cases.**

## File Structure

**Net-new:** `supabase/migrations/0016_tutor_tables.sql`; `src/lib/teli/{ladder,prompt,revealCheck,generateHint}.ts`; `src/app/api/attempts/homework-tutor/route.ts`; `src/app/(student)/student/assignments/[id]/play/_components/TeliPanel.tsx`; colocated `__tests__/`.

**Modified:** `src/lib/ai/models.ts`; `src/app/api/attempts/homework-submit/route.ts`; `src/app/(student)/student/assignments/[id]/play/_components/AssignmentPlayer.tsx`; `supabase/migrations/__tests__/migrations.test.ts`; `STRINGS-FOR-BARB.md`.

---

## Task 1: Migration 0016 — tutor tables (+ RLS + atomic bump RPC)

**Files:**
- Create: `supabase/migrations/0016_tutor_tables.sql`
- Modify: `supabase/migrations/__tests__/migrations.test.ts`

**Interfaces:**
- Produces: `tutor_sessions` + `tutor_messages` (per spec §5.5), a partial-unique index `(attempt_id) WHERE status='active'`, and `public.bump_tutor_session(p_session_id uuid)` (atomic counter increment). RLS enabled + policies + grants per repo convention (mirror 0012).

- [ ] **Step 1: Write the failing tests** — append to `migrations.test.ts` using the existing module-level `sql(f)` helper (do NOT use `MIGRATIONS_DIR`/`join` — they don't exist):

```ts
describe('0016 tutor_tables', () => {
  const s = () => sql('0016_tutor_tables.sql');
  it('creates tutor_sessions with counters + one-active-session unique index', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.tutor_sessions/);
    expect(s()).toMatch(/hint_count\s+int\s+NOT NULL DEFAULT 0/);
    expect(s()).toMatch(/help_request_count\s+int\s+NOT NULL DEFAULT 0/);
    expect(s()).toMatch(/status\s+text\s+NOT NULL DEFAULT 'active'\s+CHECK \(status IN \('active','completed'\)\)/);
    expect(s()).toMatch(/attempt_id\s+uuid\s+REFERENCES public\.homework_attempts\(id\) ON DELETE SET NULL/);
    expect(s()).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS \w+ ON public\.tutor_sessions \(attempt_id\) WHERE status = 'active'/);
  });
  it('creates tutor_messages with role + hint_rung checks and cascade', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.tutor_messages/);
    expect(s()).toMatch(/session_id\s+uuid\s+NOT NULL REFERENCES public\.tutor_sessions\(id\) ON DELETE CASCADE/);
    expect(s()).toMatch(/role\s+text\s+NOT NULL CHECK \(role IN \('student','teli','system'\)\)/);
    expect(s()).toMatch(/hint_rung\s+text\s+CHECK \(hint_rung IN \('nudge','cue','step','encourage'\)\)/);
    expect(s()).toMatch(/is_help_request\s+boolean\s+NOT NULL DEFAULT false/);
  });
  it('defines the atomic session bump function', () => {
    expect(s()).toMatch(/FUNCTION public\.bump_tutor_session\(p_session_id uuid\)/);
    expect(s()).toMatch(/hint_count = hint_count \+ 1/);
  });
  it('enables RLS + service_role policy + grants on both tables', () => {
    expect(s()).toMatch(/ALTER TABLE public\.tutor_sessions\s+ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/ALTER TABLE public\.tutor_messages\s+ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/DROP POLICY IF EXISTS/);
    expect(s()).toMatch(/CREATE POLICY .*service_role/);
    expect(s()).toMatch(/GRANT ALL\s+ON public\.tutor_sessions\s+TO service_role/);
    expect(s()).toMatch(/GRANT ALL\s+ON public\.tutor_messages\s+TO service_role/);
  });
  it('indexes the hot lookup paths', () => {
    expect(s()).toMatch(/CREATE INDEX IF NOT EXISTS .*tutor_messages.*session_id/);
  });
});
```

- [ ] **Step 2: Run — verify it fails** (file missing).
Run: `npx vitest run supabase/migrations/__tests__/migrations.test.ts`

- [ ] **Step 3: Write the migration** `0016_tutor_tables.sql`:

```sql
-- 0016_tutor_tables.sql — Teli tutor persistence (Assignment Player Segment 3).
-- Net-new clean tables (V1's were drift-laden). Additive + idempotent.
-- RLS mirrors 0012_spark.sql (service_role full; staff school-scoped read deferred to Epic 3;
-- student-own read). NOT applied live here — applied via Supabase MCP at merge time.

CREATE TABLE IF NOT EXISTS public.tutor_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  assignment_id      uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  attempt_id         uuid REFERENCES public.homework_attempts(id) ON DELETE SET NULL,
  hint_count         int NOT NULL DEFAULT 0,
  help_request_count int NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_activity_at   timestamptz NOT NULL DEFAULT now()
);

-- At most ONE active session per attempt (kills duplicate-session undercount + the create race).
CREATE UNIQUE INDEX IF NOT EXISTS uq_tutor_sessions_active_attempt
  ON public.tutor_sessions (attempt_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_tutor_sessions_student_assignment ON public.tutor_sessions (student_id, assignment_id);

CREATE TABLE IF NOT EXISTS public.tutor_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES public.tutor_sessions(id) ON DELETE CASCADE,
  task_step       int,
  role            text NOT NULL CHECK (role IN ('student','teli','system')),
  content         text NOT NULL,
  is_help_request boolean NOT NULL DEFAULT false,  -- TRUE only on the STUDENT row of a hint pull; teli row is always false
  hint_rung       text CHECK (hint_rung IN ('nudge','cue','step','encourage')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tutor_messages_session_id   ON public.tutor_messages (session_id);
CREATE INDEX IF NOT EXISTS idx_tutor_messages_session_task ON public.tutor_messages (session_id, task_step);

-- Atomic counter bump (avoids the read-modify-write lost-update on concurrent help pulls).
CREATE OR REPLACE FUNCTION public.bump_tutor_session(p_session_id uuid)
RETURNS void LANGUAGE sql AS $$
  UPDATE public.tutor_sessions
     SET hint_count = hint_count + 1,
         help_request_count = help_request_count + 1,
         last_activity_at = now()
   WHERE id = p_session_id;
$$;

-- ── RLS: service_role full; student reads own; staff school-scoped read deferred to Epic 3 ──
ALTER TABLE public.tutor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tutor_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tutor_sessions_service_role_all" ON public.tutor_sessions;
CREATE POLICY "tutor_sessions_service_role_all" ON public.tutor_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "tutor_sessions_student_read" ON public.tutor_sessions;
CREATE POLICY "tutor_sessions_student_read" ON public.tutor_sessions FOR SELECT TO authenticated USING (student_id = auth.uid());

DROP POLICY IF EXISTS "tutor_messages_service_role_all" ON public.tutor_messages;
CREATE POLICY "tutor_messages_service_role_all" ON public.tutor_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "tutor_messages_student_read" ON public.tutor_messages;
CREATE POLICY "tutor_messages_student_read" ON public.tutor_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tutor_sessions s WHERE s.id = session_id AND s.student_id = auth.uid()));

GRANT SELECT ON public.tutor_sessions TO authenticated, anon;
GRANT ALL    ON public.tutor_sessions TO service_role;
GRANT SELECT ON public.tutor_messages TO authenticated, anon;
GRANT ALL    ON public.tutor_messages TO service_role;
```

- [ ] **Step 4: Run — verify it passes.**
- [ ] **Step 5: Commit.** `git commit -m "feat(teli): migration 0016 — tutor tables, atomic bump RPC, RLS"`

> **NOTE:** the live migration to NEW CORE (`pmdzxwppdlnddtnkoarc`) is applied by the controller after merge (per-action authorization for prod DDL). The implementer does NOT touch the live DB.

---

## Task 2: Tutor model constants

**Files:** Modify `src/lib/ai/models.ts`; Test `src/lib/ai/__tests__/models.test.ts` (create if absent).

**Interfaces:** Produces `CLAUDE_TUTOR_MODEL` (`'claude-opus-4-8'`, env `ANTHROPIC_TUTOR_MODEL`), `CLAUDE_TUTOR_CHECK_MODEL` (`'claude-haiku-4-5'`, env `ANTHROPIC_TUTOR_CHECK_MODEL`).

- [ ] **Step 1: Failing test:**
```ts
import { CLAUDE_TUTOR_MODEL, CLAUDE_TUTOR_CHECK_MODEL } from '@/lib/ai/models';
describe('tutor model constants', () => {
  it('defaults Teli to claude-opus-4-8', () => { expect(CLAUDE_TUTOR_MODEL).toBe('claude-opus-4-8'); });
  it('uses a cheap model for the reveal classifier', () => { expect(CLAUDE_TUTOR_CHECK_MODEL).toBe('claude-haiku-4-5'); });
});
```
- [ ] **Step 2: Run — verify it fails.** `npx vitest run src/lib/ai/__tests__/models.test.ts`
- [ ] **Step 3: Add constants** to `models.ts`, matching its env-overridable pattern:
```ts
export const CLAUDE_TUTOR_MODEL = process.env.ANTHROPIC_TUTOR_MODEL || 'claude-opus-4-8';
export const CLAUDE_TUTOR_CHECK_MODEL = process.env.ANTHROPIC_TUTOR_CHECK_MODEL || 'claude-haiku-4-5';
```
- [ ] **Step 4: Run — verify it passes.**
- [ ] **Step 5: Commit.** `git commit -m "feat(teli): tutor model constants (opus-4-8 + haiku check)"`

---

## Task 3: Pure hint-ladder logic

**Files:** Create `src/lib/teli/ladder.ts`; Test `src/lib/teli/__tests__/ladder.test.ts`.

**Interfaces:** Produces `RUNGS = ['nudge','cue','step','encourage'] as const`; `type HintRung`; `HINTS_PER_TASK = 3`; `rungForHelpCount(priorHelpCount): HintRung`; `hintsRemaining(priorHelpCount): number`. Consumed by the route.

- [ ] **Step 1: Failing test** (identical to R1 — it was correct):
```ts
import { rungForHelpCount, hintsRemaining, RUNGS, HINTS_PER_TASK } from '@/lib/teli/ladder';
describe('hint ladder', () => {
  it('escalates nudge → cue → step → encourage and stays', () => {
    expect(rungForHelpCount(0)).toBe('nudge'); expect(rungForHelpCount(1)).toBe('cue');
    expect(rungForHelpCount(2)).toBe('step'); expect(rungForHelpCount(3)).toBe('encourage');
    expect(rungForHelpCount(9)).toBe('encourage');
  });
  it('reports hints_remaining 2,1,0,0', () => {
    expect(hintsRemaining(0)).toBe(2); expect(hintsRemaining(1)).toBe(1);
    expect(hintsRemaining(2)).toBe(0); expect(hintsRemaining(3)).toBe(0);
  });
  it('exposes the canonical rungs + cap', () => { expect(RUNGS).toEqual(['nudge','cue','step','encourage']); expect(HINTS_PER_TASK).toBe(3); });
});
```
- [ ] **Step 2: Run — verify it fails.** `npx vitest run src/lib/teli/__tests__/ladder.test.ts`
- [ ] **Step 3: Implement** `ladder.ts`:
```ts
export const RUNGS = ['nudge', 'cue', 'step', 'encourage'] as const;
export type HintRung = (typeof RUNGS)[number];
export const HINTS_PER_TASK = 3;
export function rungForHelpCount(priorHelpCount: number): HintRung {
  return RUNGS[Math.min(Math.max(priorHelpCount, 0), RUNGS.length - 1)];
}
export function hintsRemaining(priorHelpCount: number): number {
  return Math.max(0, HINTS_PER_TASK - (priorHelpCount + 1));
}
```
- [ ] **Step 4: Run — verify it passes.**
- [ ] **Step 5: Commit.** `git commit -m "feat(teli): pure 4-rung hint ladder"`

---

## Task 4: Teli system-prompt builder

**Files:** Create `src/lib/teli/prompt.ts`; Test `src/lib/teli/__tests__/prompt.test.ts`.

**Interfaces:**
- Consumes `HintRung` from `./ladder`.
- Produces `RUNG_INSTRUCTIONS: Record<HintRung, string>`; `MOVE_NUDGE: string` (a stricter suffix used by the move-regenerate); `buildTeliSystemPrompt(opts: { taskDescription: string; studentResponse?: string; rung: HintRung | null; isHelpRequest: boolean; studentContext?: { learningStyle?: string; recentStruggleTopics?: string[] } }): string`. The `studentContext` param exists for §6.4 personalization but the route passes it `undefined` in v1 (deferred — see Self-Review). **No answer-key field, ever.**

- [ ] **Step 1: Failing test** (structure + no-answer-key invariant):
```ts
import { buildTeliSystemPrompt, RUNG_INSTRUCTIONS } from '@/lib/teli/prompt';
const base = { taskDescription: 'Explain why ice floats on water.', studentResponse: 'because its cold' };
describe('buildTeliSystemPrompt', () => {
  it('embeds the task + the never-reveal contract + the thinking-move directive', () => {
    const p = buildTeliSystemPrompt({ ...base, rung: 'nudge', isHelpRequest: true });
    expect(p).toContain('Explain why ice floats on water.');
    expect(p.toLowerCase()).toContain('never');
    expect(p.toLowerCase()).toContain('thinking move');
  });
  it('includes the active rung instruction only on a help request', () => {
    expect(buildTeliSystemPrompt({ ...base, rung: 'step', isHelpRequest: true })).toContain(RUNG_INSTRUCTIONS.step);
    expect(buildTeliSystemPrompt({ ...base, rung: null, isHelpRequest: false })).not.toContain(RUNG_INSTRUCTIONS.step);
  });
  it('NEVER contains an answer key', () => {
    const p = buildTeliSystemPrompt({ ...base, rung: 'encourage', isHelpRequest: true });
    expect(p.toLowerCase()).not.toContain('correct answer:');
    expect(p.toLowerCase()).not.toContain('answer key');
  });
  it('passes the student\'s own work through', () => {
    expect(buildTeliSystemPrompt({ ...base, rung: 'cue', isHelpRequest: true })).toContain('because its cold');
  });
  it('folds in personalization when provided', () => {
    const p = buildTeliSystemPrompt({ ...base, rung: 'nudge', isHelpRequest: true, studentContext: { learningStyle: 'visual' } });
    expect(p.toLowerCase()).toContain('visual');
  });
});
```
- [ ] **Step 2: Run — verify it fails.** `npx vitest run src/lib/teli/__tests__/prompt.test.ts`
- [ ] **Step 3: Implement** `prompt.ts` (copy = DRAFT → Barb; no V1 brand names):
```ts
import type { HintRung } from './ladder';
export const RUNG_INSTRUCTIONS: Record<HintRung, string> = {
  nudge: 'Ask one question that points their thinking in the right direction. Give no part of the answer.',
  cue: 'Name the key idea or strategy to focus on. Do not give the answer.',
  step: 'Walk through the FIRST step of the approach. Stop before the result; do not give the final answer.',
  encourage: 'They have used their hints. Affirm the effort, restate the thinking move they should try, and hand it back. No answer, no new step.',
};
export const MOVE_NUDGE = '\n\nIMPORTANT: name the specific THINKING MOVE you want them to try (e.g. "let\'s separate what we know from what we\'re solving for"). Do not give the answer.';
const CONTRACT = [
  'You are Teli, a warm, encouraging Socratic tutor for a K-12 student on the CORE platform.',
  'Your job is to guide the student to their OWN reasoning — you NEVER reveal or state the answer.',
  'Keep replies to at most 3 short sentences. Use age-appropriate language. Celebrate effort over correctness.',
  'If the student is stuck on the same step twice, offer a DIFFERENT approach (an analogy, a simpler example, a fresh angle) — not the same explanation louder.',
  'ALWAYS name the THINKING MOVE you want them to try, rather than the answer content. This is how they learn HOW to think.',
  'You are a tutor, not a chatbot: stay on this task, end with an encouraging question or nudge.',
].join('\n');
const STYLE_HINT: Record<string, string> = {
  visual: 'Suggest a diagram or picture.', auditory: 'Suggest saying it aloud or explaining it as if teaching.',
  kinesthetic: 'Suggest acting it out or building a model.', text: 'Suggest writing a short summary or list.',
};
export function buildTeliSystemPrompt(opts: {
  taskDescription: string; studentResponse?: string; rung: HintRung | null; isHelpRequest: boolean;
  studentContext?: { learningStyle?: string; recentStruggleTopics?: string[] };
}): string {
  const parts = [CONTRACT, '', `CURRENT TASK:\n${opts.taskDescription}`];
  const style = opts.studentContext?.learningStyle;
  if (style && STYLE_HINT[style]) parts.push('', `This student leans ${style}. ${STYLE_HINT[style]}`);
  if (opts.studentContext?.recentStruggleTopics?.length) parts.push(`They have recently struggled with: ${opts.studentContext.recentStruggleTopics.slice(0,3).join(', ')}. Reference gently if relevant.`);
  if (opts.studentResponse?.trim()) parts.push('', `THE STUDENT'S WORK SO FAR (their words — react to it, do not grade it):\n${opts.studentResponse.trim()}`);
  if (opts.isHelpRequest && opts.rung) parts.push('', `HINT LEVEL — ${opts.rung.toUpperCase()}: ${RUNG_INSTRUCTIONS[opts.rung]}`);
  else parts.push('', 'The student asked a question (not a hint request). Answer it Socratically without solving the task for them.');
  // NOTE: there is deliberately NO correct-answer field anywhere in this prompt (defense layer 2).
  return parts.join('\n');
}
```
- [ ] **Step 4: Run — verify it passes.**
- [ ] **Step 5: Commit.** `git commit -m "feat(teli): system-prompt builder (no answer key, names the thinking move, optional personalization)"`

---

## Task 5: Reveal-check + thinking-move predicates (pure, synchronous)

**Files:** Create `src/lib/teli/revealCheck.ts`; Test `src/lib/teli/__tests__/revealCheck.test.ts`.

**Interfaces:**
- Consumes `hasBannedWord` from `@/lib/copy/leakGuard`.
- Produces:
  - `heuristicRevealsAnswer(reply): boolean` — high-precision patterns for OBVIOUS answer-handing. **It is a best-effort first gate, NOT a safety certifier** (the classifier in Task 6 is the real gate; this only short-circuits the clearest reveals).
  - `failsSyncGate(reply): boolean` = `heuristicRevealsAnswer(reply) || hasBannedWord(reply)`. Does NOT call `hasLeak` (numbers allowed).
  - `namesAThinkingMove(reply): boolean` — true if the reply contains move-language or ends in a question (the Socratic move). Used by Task 6's soft regenerate.
- **The unit tests assert the heuristic only on cases it actually catches.** Declarative reveals (e.g. "Ice is less dense than water") are NOT asserted here — they are caught by the classifier (Task 6). This keeps the oracle honest.

- [ ] **Step 1: Failing test:**
```ts
import { heuristicRevealsAnswer, failsSyncGate, namesAThinkingMove } from '@/lib/teli/revealCheck';
describe('reveal-check sync gate', () => {
  it('flags the obvious answer-handing templates', () => {
    expect(heuristicRevealsAnswer('The answer is 42.')).toBe(true);
    expect(heuristicRevealsAnswer('So the correct answer would be photosynthesis.')).toBe(true);
    expect(heuristicRevealsAnswer('Just multiply 7 by 8 to get 56.')).toBe(true);
    expect(heuristicRevealsAnswer('You should write that the mitochondria is the powerhouse.')).toBe(true);
  });
  it('allows genuine Socratic hints, including ones with numbers', () => {
    expect(heuristicRevealsAnswer('What happens to the 2 numbers when you combine them?')).toBe(false);
    expect(heuristicRevealsAnswer('Great start — what is the first thing the leaf needs?')).toBe(false);
  });
  it('fails the gate on diagnostic vocabulary but NOT on bare numbers', () => {
    expect(failsSyncGate('Your score shows you should try again.')).toBe(true);
    expect(failsSyncGate('Try adding the first 3 terms together.')).toBe(false);
  });
  it('detects whether a reply names a thinking move', () => {
    expect(namesAThinkingMove("Let's separate what we know from what we're solving for.")).toBe(true);
    expect(namesAThinkingMove('What is the first thing the question asks?')).toBe(true); // ends in a question
    expect(namesAThinkingMove('Less dense.')).toBe(false);
  });
});
```
- [ ] **Step 2: Run — verify it fails.** `npx vitest run src/lib/teli/__tests__/revealCheck.test.ts`
- [ ] **Step 3: Implement** `revealCheck.ts` (run EACH test string against the final regexes in Node before declaring done; if a legit-hint case trips a pattern, tighten the PATTERN — never delete a reveal assertion):
```ts
import { hasBannedWord } from '@/lib/copy/leakGuard';
// High-precision answer-handing patterns. The classifier (generateHint) is the real gate;
// these only catch the clearest giveaways so they short-circuit before the LLM check.
const REVEAL_PATTERNS: RegExp[] = [
  /\bthe (?:correct |final )?answer (?:is|would be|=)\b/i,
  /\bthe (?:final )?(?:result|solution) is\b/i,
  /\b(?:just|simply) (?:multiply|add|subtract|divide|write|put|say)\b[^?]*\bto get\b/i,
  /\byou should (?:write|put|say|answer)\b[^?]*\bthat\b/i,
];
export function heuristicRevealsAnswer(reply: string): boolean {
  return REVEAL_PATTERNS.some((re) => re.test(reply));
}
export function failsSyncGate(reply: string): boolean {
  return heuristicRevealsAnswer(reply) || hasBannedWord(reply);
}
const MOVE_PATTERNS: RegExp[] = [
  /\b(let'?s|try|start by|what if|think about|focus on|compare|separate|picture|imagine|notice|break it (?:down|into))\b/i,
  /\?\s*$/,
];
export function namesAThinkingMove(reply: string): boolean {
  return MOVE_PATTERNS.some((re) => re.test(reply.trim()));
}
```
- [ ] **Step 4: Run — verify it passes.**
- [ ] **Step 5: Commit.** `git commit -m "feat(teli): reveal heuristic + banned-word gate + thinking-move predicate"`

---

## Task 6: Guarded hint generator — fail-closed (the moat's keystone)

**Files:** Create `src/lib/teli/generateHint.ts`; Test `src/lib/teli/__tests__/generateHint.test.ts`.

**Interfaces:**
- Consumes `claudeChat` (`@/lib/ai/claude`), the tutor model consts, `buildTeliSystemPrompt`/`MOVE_NUDGE` (`./prompt`), `failsSyncGate`/`namesAThinkingMove` (`./revealCheck`), `HintRung` (`./ladder`).
- Produces `SAFE_FALLBACK_REPLY` (fixed scaffold line; DRAFT → Barb) and `generateGuardedHint(opts): Promise<string>` — **ALWAYS returns a checked, safe string** (the invariant the moat depends on).

**Control flow (the implementer follows exactly):**
1. `assessSafety(reply): Promise<'safe' | 'unsafe' | 'cannot-verify'>`:
   - `if (reply == null) return 'cannot-verify';` (model exhausted/unavailable)
   - `if (failsSyncGate(reply)) return 'unsafe';` (always-on)
   - `const v = await classifyReveal(reply);` → `'ok' | 'reveal' | 'unavailable'`
   - `if (v === 'reveal') return 'unsafe';`
   - `if (v === 'unavailable') return 'cannot-verify';` (**FAIL CLOSED** — never certify without the classifier)
   - `return 'safe';`
2. `classifyReveal(reply)`: ONE `claudeChat` call to `CLAUDE_TUTOR_CHECK_MODEL`. Wrap in try/catch: **on throw OR null return `'unavailable'`** (never `'ok'`). Parse with `/\bREVEAL\b/i.test(verdict)` → `'reveal'` else `'ok'`.
3. `tryGenerate(system): Promise<string | null>`: wrap `claudeChat(system, studentMessage, { model: CLAUDE_TUTOR_MODEL, temperature: 0.7, maxTokens: 300 })` in try/catch → return null on throw (`LlmExhaustedError`) so a model outage flows to the safe path, never escapes. (If opus-4-8 rejects `temperature` at runtime — surfaced as a null/throw — drop `temperature` and note it in the report.)
4. `generateGuardedHint`:
   - `const sys = buildTeliSystemPrompt(opts);`
   - `let reply = await tryGenerate(sys); let verdict = await assessSafety(reply);`
   - `if (verdict === 'safe' && (!opts.isHelpRequest || namesAThinkingMove(reply!))) return reply!;`
   - Else regenerate ONCE with the appropriate nudge: stricter-reveal suffix if `verdict !== 'safe'`, else `MOVE_NUDGE` (safe but missing a move). `reply = await tryGenerate(sys + suffix); verdict = await assessSafety(reply);`
   - `if (verdict === 'safe') return reply!;` (safe trumps a missing move on the 2nd pass)
   - `return SAFE_FALLBACK_REPLY;`

- [ ] **Step 1: Failing test** (mock `claudeChat` via `vi.hoisted`; annotate which gate each case exercises):
```ts
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { LlmExhaustedError } from '@/lib/ai/errors';
const { claudeChatMock } = vi.hoisted(() => ({ claudeChatMock: vi.fn() }));
vi.mock('@/lib/ai/claude', () => ({ claudeChat: claudeChatMock }));
import { generateGuardedHint, SAFE_FALLBACK_REPLY } from '@/lib/teli/generateHint';
const base = { taskDescription: 'Why does ice float?', rung: 'nudge' as const, isHelpRequest: true, studentMessage: 'help' };
beforeEach(() => claudeChatMock.mockReset());

it('returns a clean Socratic reply that already names a move', async () => {
  claudeChatMock.mockResolvedValueOnce("Let's start by asking what changes when water freezes — what do you notice?"); // opus (safe + move)
  claudeChatMock.mockResolvedValueOnce('OK'); // classifier OK
  expect(await generateGuardedHint(base)).toContain('what changes when water freezes');
});
it('regenerates when the first draft reveals via the heuristic, accepts the clean retry', async () => {
  claudeChatMock.mockResolvedValueOnce('The answer is that ice is less dense.'); // heuristic-caught → NO classifier call
  claudeChatMock.mockResolvedValueOnce('What happens to most things when they freeze, unlike ice?'); // opus retry (safe + move)
  claudeChatMock.mockResolvedValueOnce('OK'); // classifier on retry
  const out = await generateGuardedHint(base);
  expect(out).not.toMatch(/the answer is/i); expect(out).toContain('What happens');
});
it('catches a DECLARATIVE reveal the heuristic misses, via the classifier', async () => {
  claudeChatMock.mockResolvedValueOnce('Ice is less dense than water, which is why it floats.'); // passes sync gate
  claudeChatMock.mockResolvedValueOnce('REVEAL'); // classifier flags
  claudeChatMock.mockResolvedValueOnce('What could you compare ice and water by to explain floating?'); // retry (safe + move)
  claudeChatMock.mockResolvedValueOnce('OK'); // classifier OK
  expect(await generateGuardedHint(base)).toContain('compare ice and water');
});
it('FAILS CLOSED to the safe line when the classifier is unavailable on a heuristic-clean reply', async () => {
  claudeChatMock.mockResolvedValueOnce('Ice is less dense than water, which is why it floats.'); // passes sync gate
  claudeChatMock.mockRejectedValueOnce(new LlmExhaustedError('claude')); // classifier DOWN → cannot-verify
  // cannot-verify short-circuits to fallback (no gamble)
  expect(await generateGuardedHint(base)).toBe(SAFE_FALLBACK_REPLY);
});
it('falls back when even the retry reveals the answer', async () => {
  claudeChatMock.mockResolvedValueOnce('The answer is less dense.'); // heuristic
  claudeChatMock.mockResolvedValueOnce('Basically the answer is density.'); // retry heuristic
  expect(await generateGuardedHint(base)).toBe(SAFE_FALLBACK_REPLY);
});
it('falls back to the safe line when the opus model throws (exhausted)', async () => {
  claudeChatMock.mockRejectedValue(new LlmExhaustedError('claude'));
  expect(await generateGuardedHint(base)).toBe(SAFE_FALLBACK_REPLY);
});
it('soft-regenerates a safe-but-moveless help reply, then ships safe even if still moveless', async () => {
  claudeChatMock.mockResolvedValueOnce('Less dense than water.'); // safe (no banned/heuristic) but NO move
  claudeChatMock.mockResolvedValueOnce('OK'); // classifier OK on draft
  claudeChatMock.mockResolvedValueOnce('Density is the idea here.'); // retry still moveless but safe
  claudeChatMock.mockResolvedValueOnce('OK'); // classifier OK on retry
  expect(await generateGuardedHint(base)).toBe('Density is the idea here.');
});
```
- [ ] **Step 2: Run — verify it fails.** `npx vitest run src/lib/teli/__tests__/generateHint.test.ts`
- [ ] **Step 3: Implement** `generateHint.ts` per the control flow. `SAFE_FALLBACK_REPLY = "Let's slow down and take it one piece at a time — what's the very first thing the question is asking you to find? Tell me that and we'll build from there."`
- [ ] **Step 4: Run — verify it passes.**
- [ ] **Step 5: Commit.** `git commit -m "feat(teli): fail-closed guarded hint generator (catch throws, classifier-required, move-aware)"`

---

## Task 7: The tutor route — POST /api/attempts/homework-tutor

**Files:** Create `src/app/api/attempts/homework-tutor/route.ts`; Test `src/app/api/attempts/homework-tutor/__tests__/route.test.ts`.

**Interfaces:**
- Consumes the supabase server/admin clients, `generateGuardedHint`, `rungForHelpCount`/`hintsRemaining`, `normalizeContent`.
- Body: `{ attempt_id: string; task_step: number; student_message: string; is_help_request: boolean }`.
- Returns `{ reply: string; hint_rung: HintRung | null; hints_remaining: number | null }`. **Never 500s on a generation failure** (generateGuardedHint always returns a safe string).

**Server flow (exact):**
1. Auth: `createServerSupabaseClient()` → `auth.getUser()` → 401 if absent.
2. Parse; 400 on bad JSON or missing `attempt_id`/`student_message`/`task_step`/`is_help_request`.
3. Admin client. Ownership-load: `.from('homework_attempts').select('id, student_id, assignment_id, status').eq('id', attempt_id).eq('student_id', user.id).maybeSingle()` → 404 if null. If `status === 'graded'` → 409.
4. **Find-or-create the one active session** (the partial-unique index makes this safe): select active by `attempt_id`+`student_id`+`status='active'`; if none, insert `{ student_id, assignment_id, attempt_id, status:'active' }` and `.select('id').maybeSingle()`; **on a unique-violation error (23505) re-select** the existing active row (lost the create race).
5. Load the task text: `.from('assignments').select('content')` → `normalizeContent` → find `tasks.find(t => t.step === task_step)?.description` (fallback to a generic line if absent).
6. **Insert the student turn FIRST** (count-after-insert kills the rung race): `.from('tutor_messages').insert({ session_id, task_step, role:'student', content: student_message, is_help_request })`.
7. If `is_help_request`: count this session's student help rows for this task — `const { count } = await admin.from('tutor_messages').select('id', { count:'exact', head:true }).eq('session_id', session.id).eq('task_step', task_step).eq('role','student').eq('is_help_request', true);` (read `count`, NOT `data`). `priorHelpCount = (count ?? 1) - 1` (the row just inserted is included). `rung = rungForHelpCount(priorHelpCount)`, `remaining = hintsRemaining(priorHelpCount)`. Then bump counters atomically: `await admin.rpc('bump_tutor_session', { p_session_id: session.id });`. Else `rung = null; remaining = null;` and just `await admin.from('tutor_sessions').update({ last_activity_at: new Date().toISOString() }).eq('id', session.id);`.
8. Generate: `const reply = await generateGuardedHint({ taskDescription, rung, isHelpRequest: is_help_request, studentMessage: student_message });` (studentResponse + studentContext deferred — omitted in v1).
9. Insert the teli turn: `.from('tutor_messages').insert({ session_id, task_step, role:'teli', content: reply, is_help_request: false, hint_rung: rung });` (**teli row is_help_request=false** so counts never double).
10. Return `{ reply, hint_rung: rung, hints_remaining: remaining }`.

- [ ] **Step 1: Write the failing tests.** Build a controllable supabase mock (use `vi.hoisted`). A worked skeleton the implementer extends:
```ts
// Each .from(table) returns a chainable whose terminal (.maybeSingle / count / insert) is scripted per test.
// Provide: homework_attempts.maybeSingle -> { id, student_id, assignment_id, status }; assignments.maybeSingle -> { content };
// tutor_sessions.maybeSingle -> null then insert.select.maybeSingle -> { id:'sess1' };
// tutor_messages.insert -> capture payload (assert role/is_help_request/hint_rung); the head:true count query -> { count }.
// admin.rpc -> a mock to assert bump_tutor_session called for help turns, NOT for free turns.
// Mock generateGuardedHint to return a fixed safe string.
```
Cover: (a) 401 no user; (b) 404 non-owned (ownership maybeSingle → null); (c) first help pull → `{ hint_rung:'nudge', hints_remaining:2 }`, persists a `student` row (`is_help_request:true`) + a `teli` row (`is_help_request:false`, `hint_rung:'nudge'`), and **rpc('bump_tutor_session') was called**; (d) second help pull (count→2) → `{ hint_rung:'cue', hints_remaining:1 }`; (e) free question (`is_help_request:false`) → `{ hint_rung:null, hints_remaining:null }`, **rpc NOT called**, rows persisted with `is_help_request:false`; (f) 409 when status `graded`.

- [ ] **Step 2: Run — verify the tests fail.** `npx vitest run src/app/api/attempts/homework-tutor/__tests__/route.test.ts`
- [ ] **Step 3: Implement** `route.ts` per the flow. Mirror `homework-submit/route.ts` for the auth/admin/ownership idiom; all errors existence-hiding.
- [ ] **Step 4: Run — verify the tests pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat(teli): POST /api/attempts/homework-tutor (race-robust server ladder, ownership-guarded)"`

---

## Task 8: Wire the hint count into the moat (submit route)

**Files:** Modify `src/app/api/attempts/homework-submit/route.ts`; Modify `src/app/api/attempts/homework-submit/__tests__/route.test.ts`.

**Changes the existing behavior:** `teli_hint_count` is sourced from the tutor session (was always `attempt.teli_hint_count ?? 0` = 0), written to the graded row, and per-task `hintsUsed` is sourced from `tutor_messages` (was hardcoded `0`).

**Exact edits to the current file:**
1. After the attempt is loaded (after current line 33), load the one active/most-recent session for the attempt:
```ts
const { data: tutorSession } = await admin.from('tutor_sessions')
  .select('id, hint_count').eq('attempt_id', attempt.id).eq('student_id', user.id)
  .order('created_at', { ascending: false }).limit(1).maybeSingle();
const sessionId = (tutorSession as { id?: string } | null)?.id ?? null;
const teliHintCount = (tutorSession as { hint_count?: number } | null)?.hint_count ?? 0;
```
(The partial-unique index from Task 1 guarantees at most one ACTIVE session; `limit(1)` handles a prior completed one.)
2. Delete current line 66 (`const teliHintCount = attempt.teli_hint_count ?? 0;`) — `teliHintCount` now comes from step 1.
3. In the graded `update({ ... })` (lines 72–78), ADD `teli_hint_count: teliHintCount,`.
4. Before the `after(...)` hook, build the per-task help-count map (cheap single query, closed over):
```ts
const perTaskHints = new Map<number, number>();
if (sessionId) {
  const { data: helpRows } = await admin.from('tutor_messages')
    .select('task_step').eq('session_id', sessionId).eq('role', 'student').eq('is_help_request', true);
  for (const r of (helpRows ?? []) as { task_step: number | null }[]) {
    if (r.task_step != null) perTaskHints.set(r.task_step, (perTaskHints.get(r.task_step) ?? 0) + 1);
  }
}
```
5. In the `questionAttempts` map inside `after()` (line 93–99), replace `hintsUsed: 0,` with `hintsUsed: perTaskHints.get(t.step) ?? 0,`.

- [ ] **Step 1: Write the failing test** — add a case to the route test: a submit where a `tutor_sessions` row (`hint_count: 3`) + matching `tutor_messages` exist asserts (a) the graded `update` is called with `teli_hint_count: 3`, and (b) `effort_label` reflects 3 hints (score ≥75 + 3 hints → `'effortful_success'`). **Extend the shared admin mock with explicit `tutor_sessions` and `tutor_messages` branches** so the new `.from(...).select(...).eq(...).eq(...).order(...).limit(...).maybeSingle()` and the help-rows `select(...).eq(...).eq(...).eq(...)` chains resolve (default both to empty for the PRE-EXISTING cases so they don't break).

- [ ] **Step 2: Run — verify the new case fails** (currently teli_hint_count is 0/unwritten). `npx vitest run src/app/api/attempts/homework-submit/__tests__/route.test.ts`
- [ ] **Step 3: Apply the 5 edits.**
- [ ] **Step 4: Run — verify ALL cases pass** — the new case AND every pre-existing case (graded-overwrite 409 lock, never-half-grade pending, seed-shape normalize, the moat hook). No regressions.
- [ ] **Step 5: Commit.** `git commit -m "feat(teli): source teli_hint_count + per-task hintsUsed from the tutor session at submit"`

---

## Task 9: TeliPanel component

**Files:** Create `.../play/_components/TeliPanel.tsx`; Test `.../play/_components/__tests__/TeliPanel.test.tsx`.

**Interfaces:** `interface TeliPanelProps { attemptId: string; step: number; taskDescription: string }`. Renders an intro bubble; a message list (`student` right, `teli` left, each `teli` bubble tagged with its rung label when present); a text input; two actions — **"Ask Teli"** (`is_help_request:false`) and **"I'm stuck — get a hint"** (`is_help_request:true`); a hints-remaining pill updated from the response; a "Teli's thinking…" state while awaiting. On send → `POST /api/attempts/homework-tutor` with `{ attempt_id, task_step: step, student_message, is_help_request }`; append the returned `reply`. **Resets its conversation when `step` changes** (the ladder is per-task). Root carries `data-testid="teli-panel"`. Token-only.

**Copy (DRAFTS → Barb §Teli-Tutor):** intro `"Hi! I'm Teli 👋 Stuck on this one? Ask me anything — I'll help you think it through."`; rung labels nudge→"A nudge", cue→"A cue", step→"First step", encourage→"Keep going"; hints pill `"{n} hints left"` / `"No hints left — you've got this"`; thinking `"Teli's thinking…"`.

- [ ] **Step 1: Failing tests** (header `// @vitest-environment jsdom` then `import '@/test/setup-dom';`; mock `fetch`):
Cover: (a) renders intro + both buttons + `data-testid="teli-panel"`; (b) "I'm stuck — get a hint" with input POSTs to `/api/attempts/homework-tutor` with `is_help_request:true` and `task_step` = the `step` prop, renders the returned `reply`, updates the pill from `hints_remaining`; (c) "Ask Teli" sends `is_help_request:false`; (d) **leak test — assert `hasBannedWord(...) === false` ONLY (NOT `hasLeak`) on the panel's own chrome strings** (intro/labels/pill), because numbers are allowed in tutor surfaces (the "2 hints left" pill legitimately contains a digit). Do NOT copy the dual `hasLeak`+`hasBannedWord` pattern from `AssignmentResultScreen.leak.test.tsx` here.

- [ ] **Step 2: Run — verify the tests fail.**
- [ ] **Step 3: Implement** `TeliPanel.tsx` (`'use client'`), token classes only, no countdown.
- [ ] **Step 4: Run — verify the tests pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat(teli): inline TeliPanel (ask vs hint, per-task reset, hints pill)"`

---

## Task 10: Mount TeliPanel in the player

**Files:** Modify `.../play/_components/AssignmentPlayer.tsx`; Modify `.../play/_components/__tests__/AssignmentPlayer.test.tsx`.

**Interfaces:** Mounts `TeliPanel` **inside the existing `flex-1 … flex flex-col gap-6` wrapper div, directly after `<TaskCard … />`** (so it is still before the sibling `<SubmitPanel>`), passing `attemptId={attemptId}`, `step={currentTask.step}`, `taskDescription={currentTask.description}`.

- [ ] **Step 1: Failing test** — extend `AssignmentPlayer.test.tsx`: after advancing into the tasks phase, assert `data-testid="teli-panel"` is present; and that it is absent during the `read` phase. (Mock `fetch`; the panel must not fire on mount.)
- [ ] **Step 2: Run — verify it fails.** `npx vitest run "src/app/(student)/student/assignments/[id]/play/_components/__tests__/AssignmentPlayer.test.tsx"`
- [ ] **Step 3: Add the mount** inside the `flex-1 … gap-6` div, after `<TaskCard/>`:
```tsx
  <TaskCard step={currentTask.step} description={currentTask.description} value={currentText}
    onChange={(v) => handleTaskChange(currentTask.step, v)} onFirstInput={handleFirstInput} />
  <TeliPanel attemptId={attemptId} step={currentTask.step} taskDescription={currentTask.description} />
</div>
```
Add `import { TeliPanel } from './TeliPanel';` at the top.
- [ ] **Step 4: Run — verify it passes**, then run `AssignmentPlayer.leak.test.tsx` to confirm no regression.
- [ ] **Step 5: Commit.** `git commit -m "feat(teli): mount TeliPanel under the task card in the player"`

---

## Final steps (controller, after all tasks)

- Full gates: `npx vitest run`, `npx tsc --noEmit`, `npm run a11y`, `npm run build`, `npm run lint` — all green (a11y 49/49, tsc 0, build 0, no new lint errors).
- Final whole-branch adversarial review (most-capable model) keyed on the Global Constraints — **special attention to the no-answer guarantee**: try to find any path where un-checked/un-certified text reaches the student (classifier fail-open regressions, an un-caught `claudeChat` throw, a free-turn bypass of layers 2/3), where the ladder double-counts under concurrency, or where the submit-route change regressed the graded-overwrite lock / seed-shape normalize / pending paths.
- Append the Teli copy drafts to `STRINGS-FOR-BARB.md §Teli-Tutor`.
- `superpowers:finishing-a-development-branch` (merge to main per standing preference) → controller applies migration 0016 to live NEW CORE (`pmdzxwppdlnddtnkoarc`) AFTER merge, under the per-action authorization gate.

## Self-Review (controller, before dispatching Task 1)

- **Spec coverage:** §5.5 tables + RLS §5.6 (T1) ✓ · §6.1 one non-streaming route (T7) ✓ · §6.2 4-rung server-authoritative race-robust ladder (T3, T7) ✓ · §6.3 three-layer fail-closed no-answer guarantee — bounded ladder (T3), no answer key (T4), reveal-check + regenerate + fallback + classifier-required (T5, T6) ✓ · numbers-allowed (T5) ✓ · §6.4 fresh prompt + free-question-no-escalate + two-button-supersedes-NLP (T4, T7, documented) ✓ · §6.4 personalization — **consciously deferred**: the `studentContext` param exists (T4) but the route passes it `undefined` in v1; a follow-up wires learning-style/struggle data ✓(deferred) · §6.5 hint→signal wiring (T8) ✓ · §6.6 reuse `computeEffortLabel` unchanged (T8) ✓ · §6.7 tests incl. output-side thinking-move (T5, T6) ✓ · model opus-4-8 (T2) ✓.
- **Type consistency:** `HintRung` from `ladder.ts` consumed identically by prompt/generateHint/route. `generateGuardedHint` signature identical T6↔T7. `claudeChat` returns `string | null` AND throws `LlmExhaustedError` — every caller (T6 `tryGenerate`/`classifyReveal`) try/catches.
- **No placeholders:** every code step has real code; every run step names command + expected result.
- **Known/accepted (documented, non-blocking):** classifier-outage degrades Teli to the safe fallback (intended — guarantee > availability); `teli_hint_count` is an unbounded help-turn count; teacher school-scoped RLS read on tutor tables deferred to Epic 3 (no consumer yet; ownership guard, not RLS, is the IDOR backstop).
