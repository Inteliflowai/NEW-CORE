# Parent Dashboard + AI Narrative (Epic 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`). Spec: `docs/superpowers/specs/2026-06-25-parent-dashboard-design.md`. Grounding: `docs/superpowers/specs/grounding/2026-06-25-parent-dashboard/grounding-synthesis.md`.

**Goal:** A calm parent dashboard centered on a warm ~5–6-paragraph AI Learning Summary + a conversation starter + a "see more detail" digit-free growth view, plus a printable PDF report — all four-audience-safe (zero numbers, parent leak-guard).

**Architecture:** A new `parentGuard` validator is the four-audience wall. An import-safe `parentNarrative` engine generates → validates EACH paragraph → retries once → deterministic fallback (mirrors `highfives/generateDraft`). The dashboard/route mirror the V2 server-component loader pattern; the children loader keys off `users.parent_id` (consistency with `guardStudentAccess`). Cache in a new `parent_narratives` table (migration 0029). The PDF is a print-friendly page (period-over-period allowed, print-only).

**Tech Stack:** Next 16 App Router, React 19, TS-strict, Supabase, OpenAI (gpt-4o via `OPENAI_VOICE_MODEL`), Vitest 4.

## Global Constraints
- **Four-audience is the wall.** A parent surface NEVER shows the band enum, a risk number/word, CL verbs, divergence, misconceptions, or peer comparisons. **Zero numbers** on the calm dashboard (no %, grades, band labels). Growth = soft direction words + digit-free sparkline. Validate EVERY narrative paragraph + every starter with `parentGuard`. Components carry a `.leak.test` regression. NO raw-grade allow-list for parents.
- **Children loader uses `users.parent_id`** (the column `guardStudentAccess` keys off — `src/lib/auth/guards.ts:92-95`). Per-child routes use `guardStudentAccess` (parent branch grants access) → on deny `redirect()` (server component, NOT NextResponse).
- **NEVER import `loadStudentSignals`** (or `GradeTrendSection`/`spark/contract`/`divergencePhrase`/`triageWhySentence`/`riskFactorPhrase`/`misconceptionPhrase`) into the parent path.
- **Import-safe engine** (no next/server / Supabase / module-load SDK). Model from `src/lib/ai/models.ts` (`OPENAI_VOICE_MODEL`); NEVER `CLAUDE_GRADING_MODEL`. **Fail-soft** — the engine never throws; deterministic fallback; the dashboard renders even if the AI is down.
- All parent copy + the forbidden-words list are **DRAFT → Barb** (`STRINGS-FOR-BARB.md §Parent Dashboard`).
- Tests: lib/route = node env; component/page = `// @vitest-environment jsdom` + `import '@/test/setup-dom';`. Gates: tsc 0, vitest green, build 0.

---

### Task 1: `parentGuard` — the four-audience validator

**Files:** Create `src/lib/copy/parentGuard.ts`; Test `src/lib/copy/__tests__/parentGuard.test.ts`.

**Interfaces:** Produces `parentLeaks(text: string): string[]` (the list of violated phrases; empty = clean) and `hasParentLeak(text: string): boolean`.

- [ ] **Step 1: Write the failing test** — assert CLEAN passes ("Alex's work is trending up lately — keep celebrating the effort.") and each forbidden class is caught: a digit/`%` (via hasLeak), a banned word (via hasBannedWord), a `FOUR_AUDIENCE_LEAKS` phrase (e.g. "grade level", "ahead of"), AND the new gaps — `risk` ("at risk"), `reinforce`, `on track`, `comprehension level`, `approaching`, `enrich`, `partial mastery`, `misconception`, `compared to`, `behind`, `class average`, `peers`, `other students`, `than average`.

- [ ] **Step 2: Run, watch fail.** `npx vitest run src/lib/copy/__tests__/parentGuard.test.ts`

- [ ] **Step 3: Implement** `src/lib/copy/parentGuard.ts`
```ts
// src/lib/copy/parentGuard.ts
// The PARENT four-audience validator. A parent NEVER sees: numbers/grades, the mastery-band enum,
// risk, CL verbs, divergence, misconceptions, or peer comparisons. Reuses the generic numeric/word
// guards + the High-Five FOUR_AUDIENCE_LEAKS, and adds the parent-specific gaps. Pure, import-safe.
import { hasLeak, hasBannedWord } from '@/lib/copy/leakGuard';
import { FOUR_AUDIENCE_LEAKS } from '@/lib/highfives/guardrail';

// Gaps not covered by hasLeak/hasBannedWord/FOUR_AUDIENCE_LEAKS (word-boundary, case-insensitive).
export const PARENT_FORBIDDEN: { pattern: RegExp; phrase: string }[] = [
  { pattern: /\brisk\b/i, phrase: 'risk' },
  { pattern: /\breinforce\b/i, phrase: 'reinforce' },
  { pattern: /\bon track\b/i, phrase: 'on track' },
  { pattern: /\bcomprehension level\b/i, phrase: 'comprehension level' },
  { pattern: /\bapproaching\b/i, phrase: 'approaching' },
  { pattern: /\benrich(?:ment)?\b/i, phrase: 'enrich' },
  { pattern: /\bpartial mastery\b/i, phrase: 'partial mastery' },
  { pattern: /\bmisconception\b/i, phrase: 'misconception' },
  { pattern: /\berror type\b/i, phrase: 'error type' },
  { pattern: /\bcompared to\b/i, phrase: 'compared to' },
  { pattern: /\bfalling behind\b/i, phrase: 'falling behind' },
  { pattern: /\bbehind\b/i, phrase: 'behind' },
  { pattern: /\bclass average\b/i, phrase: 'class average' },
  { pattern: /\bpeers?\b/i, phrase: 'peers' },
  { pattern: /\bother students\b/i, phrase: 'other students' },
  { pattern: /\bthan average\b/i, phrase: 'than average' },
];

/** Returns the list of violated phrases in `text` (empty array = parent-safe). */
export function parentLeaks(text: string): string[] {
  const out: string[] = [];
  if (hasLeak(text)) out.push('a number or percent');
  if (hasBannedWord(text)) out.push('a data word');
  for (const f of FOUR_AUDIENCE_LEAKS) if (f.pattern.test(text)) out.push(f.phrase);
  for (const f of PARENT_FORBIDDEN) if (f.pattern.test(text)) out.push(f.phrase);
  return out;
}

export function hasParentLeak(text: string): boolean {
  return parentLeaks(text).length > 0;
}
```
- [ ] **Step 4: Run, watch pass.** **Step 5: Commit** — `git commit -m "feat(epic4): parentGuard four-audience validator"`

---

### Task 2: Migration 0029 — parent_narratives cache

**Files:** Create `supabase/migrations/0029_parent_narratives.sql`. (No test; applied at merge, Marvin-gated.)

- [ ] **Step 1: Write the migration**
```sql
-- 0029_parent_narratives.sql
-- 24h cache for the AI-generated parent Learning Summary (one row per student). V2 has no
-- student_model table (V1 cached there), so a dedicated cache table. Deny-by-default RLS:
-- service_role (admin client) writes/reads; staff school-scoped SELECT is unnecessary (the parent
-- route reads via the admin client behind guardStudentAccess) — mirror 0027/0026 admin-only.
create table if not exists public.parent_narratives (
  student_id    uuid primary key references public.users(id) on delete cascade,
  payload       jsonb not null,                 -- { paragraphs: string[], conversation_starters: string[], source: 'ai'|'ai_retry'|'fallback' }
  generated_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.parent_narratives enable row level security;
drop policy if exists "parent_narratives_service_role" on public.parent_narratives;
create policy "parent_narratives_service_role" on public.parent_narratives
  for all to service_role using (true) with check (true);
```
- [ ] **Step 2: Commit** — `git commit -m "feat(epic4): migration 0029 parent_narratives cache (deny-by-default RLS)"`

---

### Task 3: `loadParentChildren` + read-only high-fives

**Files:** Create `src/lib/parent/loadParentChildren.ts` + test; Create `src/lib/parent/loadStudentHighFivesReadonly.ts` + test (or a `readonly` flag on the existing loader — read `src/lib/highfives/loadStudentHighFives.ts` first; it has a `viewed_by_student_at` side effect to AVOID).

**Interfaces:** `loadParentChildren(admin, parentId): Promise<{ id: string; firstName: string }[]>` (query `users WHERE parent_id = parentId AND role = 'student'`, order by full_name; firstName = first token). `loadStudentHighFivesReadonly(admin, studentId, limit?)` — same data as `loadStudentHighFives` but NO write/stamp.

- [ ] TDD each (mock admin). Commit `feat(epic4): loadParentChildren + read-only high-fives loader`.

---

### Task 4: `loadParentNarrativeContext` — the parent-SAFE translated context

**Files:** Create `src/lib/parent/loadParentNarrativeContext.ts` + test.

**Interfaces:** `loadParentNarrativeContext(admin, studentId): Promise<ParentContext>` where `ParentContext` is qualitative-only: `{ firstName, gradeTrendDirection: 'climbing'|'steady'|'sliding'|null, hasGrowth: boolean, learningStyleLabel: string|null, recentAssignmentTitles: string[], effortLabel: string|null, dataPoints: number }`. **Source ONLY from parent-safe loaders** — `loadStudentGradeTrend` (use `.direction`, NEVER the point digits), `loadStudentAssignments` (titles only), `student_model_snapshots.avg_score` count for `hasGrowth`/`dataPoints`, the learning_style alias. **NEVER** `loadStudentSignals`, band, CL, risk, or any digit. (Read `src/lib/gradebook/loadStudentGradeTrend.ts`, `src/lib/spark/loadStudentAssignments.ts`, `src/lib/utils/learningStyle.ts` for the exact shapes.)

- [ ] TDD (mock admin); assert the returned object contains NO digits/band/CL fields. Commit `feat(epic4): parent-safe narrative context loader (no diagnostic machinery)`.

---

### Task 5: `parentNarrative` engine

**Files:** Create `src/lib/engine/parentNarrative.ts` + test; add prompts to `src/lib/openai/prompts.ts`.

**Interfaces:** `generateParentNarrative(ctx: ParentContext): Promise<{ paragraphs: string[]; conversation_starters: string[]; source: 'ai'|'ai_retry'|'fallback' }>` — NEVER throws.

- [ ] **Logic (mirror `src/lib/highfives/generateDraft.ts`):** build the prompt from `ctx` (firstName + qualitative fields; instruct ~5–6 warm paragraphs in the locked order — opener / how-they-learn + 2 home strategies / thinking skills / 3 home suggestions / one celebration — **zero numbers, no levels, no comparisons**; cold-start: if `dataPoints` low, a warm "just getting started" instead of a trend claim). Call `resilientChatCompletion({ model: OPENAI_VOICE_MODEL, temperature: 0.6, response_format: { type: 'json_object' } }, { timeoutMs })` in try/catch → parse `{ paragraphs, conversation_starters }`. **Validate EVERY paragraph + starter with `parentLeaks`**; if any violation, retry ONCE with a stricter suffix; if STILL violating (or AI null/parse-fail), return a **deterministic fallback** (hard-coded warm, number-free paragraphs + 2 generic starters built from `ctx.firstName`) with `source:'fallback'`. Tag `'ai'`/`'ai_retry'`/`'fallback'`.
- [ ] **Test:** mock `resilientChatCompletion` → (a) clean output → `source:'ai'`, paragraphs pass `parentLeaks`; (b) first output leaks ("grade level") then clean → `'ai_retry'`; (c) always-leaking → `'fallback'`, output number/level-free; (d) AI throws/null → `'fallback'`. Assert the fallback paragraphs themselves pass `parentLeaks`.
- [ ] Commit `feat(epic4): parentNarrative engine (per-paragraph guard, retry-once, fallback)`.

---

### Task 6: Narrative route + cache

**Files:** Create `src/app/api/parent/narrative/route.ts` + test.

**Interfaces:** `GET ?studentId=&force=1` → `{ paragraphs, conversation_starters, source, generated_at }`.

- [ ] Auth chain: `getUser` → 401; `guardStudentAccess(studentId)` (returns a NextResponse on deny — in a ROUTE handler that's fine) → admin client. Read `parent_narratives` cache; if fresh (<24h) and not `force` → return it. Else `loadParentNarrativeContext` → `generateParentNarrative` → upsert the cache (with `generated_at`) → return. Never 500 on AI failure (the engine never throws). 
- [ ] TDD (mock guards/loaders/engine): 401, IDOR-deny, cache-hit, cache-miss→generate→cache, force-refresh. Commit `feat(epic4): GET /api/parent/narrative (guarded + 24h cache + refresh)`.

---

### Task 7: Parent dashboard page + components

**Files:** Replace `src/app/(parent)/parent/dashboard/page.tsx` (server); create components under `(parent)/parent/dashboard/_components/`: `ChildSelector`, `NarrativeCard`, `ConversationStarter`, `SeeMoreDetail` (digit-free growth: `GradeTrendSparkline` with a digit-free ariaLabel + `GrowthMotif` + read-only high-fives). Tests (jsdom) + a `dashboard.leak.test.tsx` regression.

- [ ] **page.tsx (server):** `requireRole(['parent'])` → `loadParentChildren` → if none, a warm empty state → resolve the selected child (`?child=` or first) → `guardStudentAccess(childId)` (redirect on deny) → fetch the narrative (call the engine/route loader server-side OR a shared `getParentNarrative(admin, studentId)`), `loadParentNarrativeContext` extras, read-only high-fives, the digit-free growth data → render the client components. Child-selector only when >1 child.
- [ ] **Components:** the NarrativeCard renders the paragraphs (the centerpiece, calm typography, tokens only); ConversationStarter shows one starter + a "more" affordance; SeeMoreDetail is a `<details>` collapse with the digit-free sparkline + GrowthMotif + high-fives. **No numbers anywhere.** A lightweight "Refresh" affordance (calls `?force=1`).
- [ ] **`dashboard.leak.test.tsx`:** render with a fixture narrative + signals and assert every rendered string passes `hasParentLeak===false` (mirror `AssignmentPlayer.leak.test.tsx`).
- [ ] Commit `feat(epic4): parent dashboard page + components (calm, zero-number, leak-tested)`.

---

### Task 8: Printable PDF report

**Files:** Create `src/app/(parent)/parent/children/[studentId]/report/page.tsx` (print-friendly) + `src/lib/parent/perChildReportData.ts` (period-over-period) + tests; a link from the dashboard / `/parent/reports`.

- [ ] **Loader `perChildReportData(admin, studentId)`:** the period-over-period comparison (last ~6 weeks vs prior ~6 weeks of graded HW; min-prior-count gate; soft direction). Print-only context — comparison phrasing in DIRECTION words (no peer comparison; self vs own past). **Still parent-safe** (no band/CL/risk).
- [ ] **page.tsx:** `requireRole(['parent'])` → `guardStudentAccess` (redirect on deny) → admin client → `perChildReportData` → render a print-CSS page (a "Print / Save as PDF" button calling `window.print()`; `@media print` styles). Period-over-period comparison is allowed HERE (print-only). Tokens + a `report.leak.test`.
- [ ] Commit `feat(epic4): parent printable report (period-over-period, print-only)`.

---

### Task 9: Demo seed (multi-child) + nav + strings

**Files:** Modify `src/lib/trial/seedTrialDemoData.ts` (link the demo parent to a 2nd child + ensure both have enough graded data for a non-cold-start narrative); fix the `(parent)/layout.tsx` nav (point at the real `/parent/dashboard` + `/parent/reports`, drop any dead link); add `STRINGS-FOR-BARB.md §Parent Dashboard` (all parent copy + the `PARENT_FORBIDDEN` list).

- [ ] Wire against the real seed vars; run the seed-shape test if one exists. Commit `feat(epic4): demo seed 2-child parent + parent nav + Barb strings`.

---

## Self-Review
- Coverage: guard (T1), cache (T2), children+readonly-hf (T3), safe context (T4), engine (T5), route (T6), dashboard (T7), PDF (T8), seed/nav/strings (T9).
- Four-audience: `parentGuard` validates every paragraph + starter (T5) AND every rendered string (`*.leak.test` T7/T8); zero numbers; `loadParentNarrativeContext` is the only data source (T4) and never touches `loadStudentSignals`.
- IDOR: children loader keys off `users.parent_id`; `guardStudentAccess` on every per-child surface; admin client behind the guard.
- Fail-soft: engine never throws; dashboard renders on AI outage.
- Deferred (note in ledger): SPARK-paragraph injection; earned-grade digits (Barb call); the action modals (contact teacher/help-at-home) can be lightweight links this epic.
