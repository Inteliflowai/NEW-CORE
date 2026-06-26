# Parent Dashboard + AI Narrative (Epic 4) — Design Spec

**Status:** DECISIONS LOCKED (Marvin, 2026-06-25) — ready for writing-plans.
**Grounding:** `docs/superpowers/specs/grounding/2026-06-25-parent-dashboard/grounding-synthesis.md` (V1 floor + V2 foundation, file:line-cited).
**Memory:** [[v2-parity-program-meat-and-potatoes]] (Epic 4), [[v2-backlog-status-2026-06-25]], the four-audience discipline.

## 1. Why / what
The last V1-parity epic: a **calm parent dashboard** centered on a warm, AI-generated **Learning Summary**, plus a **printable PDF report**. Four-audience is the binding constraint — parents see growth ("you vs your own past") and warm guidance, **never** the mastery-band enum, a raw risk number, CL verbs, divergence, misconceptions, or peer comparisons.

## 2. Locked decisions (Marvin, 2026-06-25)
- **Narrative shape: CALMER, ~5–6 warm paragraphs** (not V1's full 9). Keep: warm status opener, how-the-child-learns + 2 home strategies, the thinking/power skills, **3 specific home suggestions**, one thing to celebrate. **Trim** the diagnostic-leaning paragraphs (why-personalized, consistency). Plus the conversation starter (below).
- **Zero numbers on the calm dashboard** — no %, no grades, no band labels. Growth = soft direction words ("climbing / steady / just getting started") + a **digit-free** sparkline (no axis numbers, no digits in ariaLabel/`<title>`). (Barb gates the final copy + may later allow earned-assignment-grade digits; default = none.)
- **Include the printable PDF report** (V1 parity) — a print-friendly page where **period-over-period comparison IS allowed** (last ~6 weeks vs prior, print-only; never on the calm dashboard). Browser print-to-PDF (a `/parent/children/[studentId]/report` print page), not a server-side PDF lib.
- **Keep the conversation starter** — a second small AI call → 2–3 prompts a parent can ask their child, with a deterministic fallback.

## 3. Defaults taken (no further sign-off; Barb gates copy)
- **Model:** `OPENAI_VOICE_MODEL` (gpt-4o, V1 parity) for both the narrative + the starter.
- **Guard strength:** deterministic regex guard + **one** stricter retry + deterministic fallback + source tag (`'ai'|'ai_retry'|'fallback'`); validate EACH paragraph. (No fail-closed second-model classifier — the regex set is the wall.)
- **Cache:** 24h, a new column on `student_model` (migration **0029**) + `narrative_generated_at` + a manual "refresh" affordance.
- **Multi-child:** child-selector (one child at a time, V1 style); **extend the demo seed** to link the demo parent to 2 children.
- **Cold-start:** when a child has too little data, emit a warm "just getting started" line in place of trend/consistency claims — **never fabricate**.
- **Read-only high-fives** for the parent (a variant that does NOT stamp `viewed_by_student_at`).

## 4. The PARENT leak-guard (binding — the high-stakes piece)
New `src/lib/copy/parentGuard.ts` (pure, import-safe) = `hasLeak` + `hasBannedWord` (from `leakGuard.ts`) + `FOUR_AUDIENCE_LEAKS` (reuse from `src/lib/highfives/guardrail.ts`) + **additionally ban**: `risk`, the band enum (reteach/approaching/grade_level/on grade level/enrich/partial mastery/top-/mid-band/proficient/remedial), CL verbs (reinforce/on track/comprehension level), `misconception`/error-type, and peer-relative phrases (compared to/ahead of/behind/class average/peers/other students/than average). The narrative engine validates **every paragraph** + the starters; the dashboard components carry a `*.leak.test` regression (per-string `hasLeak===false && parentGuard clean`). **NO raw-grade allow-list for parents** (unless Barb signs off later). The guard + all copy are **Barb-gated** before ship.

## 5. Build shape (on sign-off → writing-plans)
1. **`src/lib/copy/parentGuard.ts`** + tests — the parent four-audience validator (pure).
2. **Migration 0029** — `student_model.parent_narrative_cache` (jsonb) + `parent_narrative_generated_at` (timestamptz). (Confirm `student_model` exists; else a small `parent_narratives` table.)
3. **Loaders:** `loadParentChildren(admin, parentId)` (query `users WHERE parent_id` — matches the guard); a parent-safe **already-translated** context loader `loadParentNarrativeContext(admin, studentId)` (firstName + qualitative-only fields from the SAFE loaders — grade-trend DIRECTION, growth, assignments, effort — NEVER `loadStudentSignals`); a read-only `loadStudentHighFivesReadonly`.
3. **`src/lib/engine/parentNarrative.ts`** (import-safe) — `resilientChatCompletion(OPENAI_VOICE_MODEL, json_object → {paragraphs[], conversation_starters[]})` → per-paragraph parentGuard → retry once → deterministic fallback + source tag; cold-start gating. Prompts in `src/lib/openai/prompts.ts`.
4. **Route** `GET/POST /api/parent/narrative` (or a server-action) — auth + `guardStudentAccess` + admin client + the safe loaders + 24h cache + engine; `?force=1` refresh.
5. **Dashboard** `(parent)/parent/dashboard/page.tsx` (real) + components: child selector, the narrative card (centerpiece), the conversation-starter line, action affordances (contact teacher / help at home / celebrate — lightweight), a "see more detail" collapse with the **digit-free** growth (sparkline + GrowthMotif) + read-only high-fives.
6. **PDF report** `(parent)/parent/children/[studentId]/report/page.tsx` — a print-friendly page (period-over-period comparison allowed via a `perChildReportData`-style loader) + a "Print / Save as PDF" affordance; reachable from `/parent/reports`/the dashboard.
7. **Seed:** extend the demo to link the parent to 2 children; backfill enough data for a non-cold-start demo.
8. **Strings → `STRINGS-FOR-BARB.md §Parent Dashboard`** (all parent copy + the forbidden-words list — Barb gates).

## 6. Constraints (binding)
- **Four-audience above all** — the parent guard is the wall; per-paragraph validation; never fabricate (cold-start instead); zero numbers on the dashboard.
- **Children loader uses `users.parent_id`** (consistency with `guardStudentAccess`).
- **Never import `loadStudentSignals`** or the teacher-only diagnostic helpers into the parent path.
- **Auth chain** — `requireRole(['parent'])` (layout) + `guardStudentAccess` per child (server-component → `redirect()` on deny) + admin client (RLS-bypassed; guard is the backstop).
- **Import-safe engine** (no next/server / Supabase / module-load SDK); model from the registry (never `CLAUDE_GRADING_MODEL`).
- **Fail-soft generation** — never throws; deterministic fallback; the dashboard renders even if the AI is down.
- Process: writing-plans → **pre-code adversarial review (four-audience-leak + IDOR focus)** → subagent TDD + per-task review → whole-branch review → Playwright preview (Marvin) + apply 0029 → Marvin merge. Gates: tsc 0, vitest green, build 0.
