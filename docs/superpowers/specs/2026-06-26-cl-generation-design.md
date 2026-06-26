# CL → Generation — Design Spec

> Per-skill Comprehension Level drives assignment generation. Ground: `grounding/2026-06-26-cl-generation/grounding-synthesis.md`. Status: **decisions locked except D3/D4 (awaiting Marvin)**, then `writing-plans`.

## Goal
Make the moat *do something*: generate an assignment whose structure reflects the student's **per-skill** Comprehension Level — a **section per skill of the lesson**, each section's tasks generated at that skill's own level (Reinforce → scaffolded, On Track → standard, Enrich → extension), every task **tagged to its skill** and **naming its power (critical-thinking) skill**. A genuine upgrade past V1, which fed only one coarse band.

## Non-goals
- No new model/algorithm — this is aggregation + threading existing per-skill CL into the prompt + a presentation layer.
- No migration (all tables/columns exist).
- No change to the `step`-keyed task identity, the autosave/submit contract, the drawing/voice slots, or the earned-grade carve-out.
- Quizzes are untouched (diagnostic; never personalized at generation — V1 parity).

## Locked decisions
1. **Mechanism = fully restructured per-skill** (Marvin): section per skill, each independently leveled + tagged; power skill named per task.
2. **Power skill ON** (Marvin): the strategy's `critical_thinking_skill` is passed into the prompt; each task names it alongside ATL/IB/Bloom.
3. **Presentation over a flat array** (engineering, forced by the keying invariant): tasks remain ONE flat `tasks[]` array keyed by immutable `step`. Each task gains `skill_id`, `skill_name`, `power_skill`. The engine emits tasks **grouped in skill order**; the **player derives section headings by grouping consecutive same-`skill_name` tasks**. No nesting, no renumbering, no re-keying. Autosave/submit/drawing/grader all keep working unchanged.
4. **Conservative confidence gate**: a skill steers its section's level only when its CL verb is non-null AND confidence ≥ 40 (tentative+). A cold / low-confidence skill falls back to the overall quiz band's level. The feature can only improve an assignment, never worsen it on a weak signal. (Mirrors the moat's confidence discipline.)
5. **Scope = both call sites** (post-quiz generate + Reinforce) and **populate `assignments.skill_ids`** (fixes the latent gap so assignment results finally feed per-skill CL).
6. **Section cap = 4 skills**, ordered **Reinforce-first, then On Track, then Enrich** (then by confidence). A lesson with >4 skills keeps the 4 highest-need; a 1-skill lesson is one (unlabeled) section — graceful degrade to today's behavior. Non-silent `console.warn` on truncation.
7. **Backward compatible**: when no skill targets resolve (cold student, no skills tagged, single low-conf skill), `generateAssignment` produces exactly today's single-band assignment. The per-skill path is strictly additive.

## D3/D4 — LOCKED (Marvin, 2026-06-26)
- **D3 = close the loop, per-task.** Each task's grade routes back to ITS skill's CL (the virtuous cycle). Built as one well-isolated, heavily-tested task that edits the moat pipeline (`recomputeSkillStates` + the `homework-submit` `after()` hook): per-skill homework observations are built from per-task skill tags, not one assignment-level grade fanned to all skills. `skill_ids` is still populated (assignment-level remains the fallback for any untagged task).
- **D4 = show skill-name section headings to the student.** A plain topic heading per section ("Fractions", "Decimals"). Skill names are non-diagnostic lesson topics; the level/verb stay hidden, guarded by a new `.leak.test`. A single unlabeled section (1-skill or degrade) renders no heading, exactly like today.

## Architecture

### New: `src/lib/skills/resolveSkillTargets.ts` (pure + a thin loader)
- `levelForVerb(verb, confidence, fallbackMode) → AssignmentMode` — Reinforce→'scaffolded', On Track→'standard', Enrich→'extension'; null verb or confidence<40 → `fallbackMode`. Pure, unit-tested.
- `loadSkillTargets(admin, { studentId, skillIds, fallbackBand }) → SkillTarget[]` where `SkillTarget = { skill_id, skill_name, level: AssignmentMode, verb: CLVerb|null, confident: boolean }`. Queries `skill_learning_state` for `(studentId, skillIds)` + joins `skills` for names; maps via `CL_VERB_BY_STATE` + the gate; orders Reinforce→On Track→Enrich→confidence; caps at 4 (warn on truncation). Skills with no row → cold target at `fallbackBand`'s mode.

### New: `src/lib/lessons/resolveLessonSkills.ts`
- `resolveLessonSkills(admin, lessonId) → { skill_id, skill_name }[]` — lesson → its quiz(zes) → `quiz_questions.skill_id` (distinct) → join `skills`. (Post-quiz route can resolve from the attempted quiz directly; Reinforce route resolves from the assignment's lesson.) Returns `[]` when untagged → triggers the backward-compat single-band path.

### Engine: `generateAssignment`
- `AssignmentInput` gains `skillTargets?: SkillTarget[]`.
- When `skillTargets?.length >= 1` AND (>1 target OR a confident target exists) → build the **sectioned prompt**; else today's single-band prompt.
- Per section: select strategies with `getStrategiesForStudent(modeToBand(level), style)`; pass the **6th** field `critical_thinking_skill`.
- `AssignmentTaskSchema` gains `skill_id: z.string().nullable()`, `skill_name: z.string()`, `power_skill: z.string()`. (`.nullable()` skill_id tolerates the cold/untagged degrade.)

### Prompt: `assignmentPrompt` (sectioned variant)
- New instruction block: "Produce tasks grouped by the skills below, in the given order. For each skill, generate its tasks at the skill's LEVEL using that level's bandProfile rules. Tag every task with its `skill_id` and `skill_name`. Each task also names its `power_skill` (the strategy's critical-thinking skill)." Reuses the existing `bandProfiles` per-section level. The single-band prompt is unchanged.
- **Locks (review lenses):** never emit the level/verb in any student-visible field (title/passage/instructions/description/support_note); a Reinforce section's tasks must obey the scaffolded verb whitelist and Bloom ceiling; every task carries a non-empty `skill_name` + `power_skill`.

### Persistence (both routes)
- Resolve lesson skills → load skill targets → pass to engine.
- Insert: `content = assignment` (now skill-tagged) AND `skill_ids = relevantSkillIds`.

### Player
- `AssignmentContent`/`normalizeContent` pass through `skill_name` per task (NOT level, NOT verb). 
- Player groups consecutive same-`skill_name` tasks under a heading (skill name only; omitted when a single unlabeled section). Step keying, autosave, drawing, voice all unchanged.
- New `.leak.test`: assert normalized player content + rendered headings contain no level/verb/band/digit leak (extend the existing `DIAGNOSTIC_VOCAB_RE`/`leakGuard` net).

### Moat write-back (D3)
- Always: `skill_ids` now populated → assignment results attribute correctly.
- If D3=(b): per-task attribution in the `homework-submit` `after()` hook + `recomputeSkillStates` — map each task's grade to its `skill_id`, build per-skill homework observations from per-task tags instead of one assignment-level grade fanned to all skills. Heavily tested; the one task that touches the moat pipeline.

## Risks & mitigations
- **Breaking the player/grader** → the flat step-keyed array invariant (decision 3) keeps every downstream layer untouched; sections are pure presentation.
- **Four-audience leak via section headings/level** → headings are skill names only; level/verb never serialized to client; new `.leak.test` + existing guards.
- **LLM ignores per-section levels / mixes difficulty** → bandProfile rules reused verbatim per section; review lens asserts whitelist/Bloom compliance; fail-safe is today's single-band assignment.
- **Moat-pipeline regression (if D3=b)** → isolate to one reviewed task with full `recomputeSkillStates`/`homework-submit` test coverage; descope to (a) if risk surfaces.
- **Cold start / untagged lessons** → backward-compat single-band path; `[]` skills degrade gracefully.

## Test plan (TDD)
Pure: `levelForVerb` (verb×confidence×fallback matrix), `resolveSkillTargets` ordering/cap/cold, `resolveLessonSkills` distinct/empty. Engine: sectioned vs single-band branch, 6th strategy field, schema with new task fields, fallback safety. Prompt: sectioned instruction present only with targets; locks. Routes: `skill_ids` populated; targets threaded; backward-compat. Player: heading grouping; `.leak.test`. Moat (if D3=b): per-task attribution. All existing suites stay green.

## Gates
tsc 0 · full vitest green · build 0 (a11y + tokens). No migration. Strings (any student-visible heading copy) → `STRINGS-FOR-BARB.md §CL Generation`.
