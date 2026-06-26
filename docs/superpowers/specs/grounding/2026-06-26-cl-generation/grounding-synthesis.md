# CL → Generation — Grounding Synthesis

> Gathered 2026-06-26 by two parallel read-only Explore sweeps (7 agents) + synthesis. All claims file:line-cited. V2 = `C:/users/inteliflow/NEW-CORE` (build target). V1 = `C:/users/inteliflow/core` (READ-ONLY reference).

## 0. The opportunity (one line)
The moat computes a per-skill **Comprehension Level** (Reinforce / On Track / Enrich) per student, but **it never reaches assignment generation** — the generator is fed only one coarse quiz `band`. Wiring per-skill CL into generation is the moat's "do something," and it's a genuine **upgrade past V1** (V1 also fed only the band; its `skill_learning_state` was likewise unused by generation).

## 1. The keying invariant (THE constraint)
`step` (integer) is the single source of truth for task identity across **every** layer:
- Generated content `tasks[].step` (`src/lib/engine/types.ts:130-138`)
- Persisted `assignments.content` jsonb (`supabase/migrations/0004_assignments_homework.sql:13`)
- Student responses `responses.tasks[String(step)]` (`src/app/api/attempts/homework-draft/route.ts:9`, `homework-submit/route.ts`)
- Player render + autosave + drawing upload all key by `step` (`AssignmentPlayer.tsx` `textFor`/`imageFor`/`uploadTaskImage`; drawing `POST /api/attempts/drawing` form field `step`)
- Grader `gradeAssignment` keys responses by `String(t.step)` (`src/lib/engine/gradeAssignment.ts:35-45`)
- Moat per-task signals key by `step` (`homework-submit/route.ts:129-137`)

**Implication:** per-skill "sections" must be a **presentation + tagging layer over a flat, step-keyed `tasks[]` array**. Do NOT renumber, nest, or re-key tasks. Sections are derived/grouped; `step` stays immutable.

## 2. Generation today
- `generateAssignment(input: AssignmentInput)` → `Assignment` — `src/lib/engine/assignmentGen.ts:50-113`.
  - `AssignmentInput = { lessonSummary, band: 'reteach'|'grade_level'|'advanced', style, studentName, sparkEnabled?, targetedPractice? }` (`assignmentGen.ts:32-42`).
- `Assignment` content schema — `src/lib/engine/types.ts:139-157`: `{ title, mode, learning_style, reading_passage, audio_script, diagram_*, youtube_search_query, instructions, tasks: AssignmentTaskSchema[].min(2), support_note?, extension_prompt?, atl_summary, ib_attributes }`.
- `AssignmentTaskSchema` — `types.ts:130-138`: `{ step:int, description, type:enum(read|write|draw|discuss|create|analyze), strategy, atl_skill, ib_attribute, bloom_level }`.
- Prompt builder `assignmentPrompt()` — `src/lib/openai/prompts.ts:745-1059`. Has `bandProfiles[band]` (SCAFFOLDED RETEACH / STANDARD GRADE LEVEL / EXTENSION ADVANCED) with reading-level/passage-length/verb-whitelist/Bloom-ceiling rules. Interpolates band, style, studentName, lessonSummary, and **5** strategy fields: `name, what_students_do, atl_skills, ib_learner_profile, bloom_level` (`assignmentGen.ts:51-57`).
- Strategy toolkit — `prompts.ts:16-219`: 12 strategies, each `{ name, category, what_students_do, learning_styles[], critical_thinking_skill, learning_outcome, atl_skills[], atl_categories, ib_learner_profile[], bloom_level, band_fit[] }`. Selection `getStrategiesForStudent(band, style)` (`prompts.ts:249-261`) filters by style→strategies, band→category-focus, and `band_fit`; returns ≤3.
- **`critical_thinking_skill` ("power skill") is DORMANT** — not used in selection (selection uses category/style/band_fit) and not passed into the prompt.
- **CONFIRMED: per-skill CL is not in the prompt today.**

### Call sites
1. Post-quiz: `POST /api/teacher/assignments/generate` — `route.ts:152-157`. Loads `attempt.mastery_band` (single quiz band) + `attempt.learning_style`; `studentId` available. `lesson_id`, `class_id` resolved via the quizzes join.
2. Reinforce: `POST /api/teacher/assignments/reinforce` — `route.ts:139-144`. Hardcodes `band='reteach'`; `studentId`, assignment, lesson available.

## 3. Per-skill CL data (the moat)
- `loadStudentSignals(admin, studentId)` → `StudentSignals` — `src/lib/signals/loadStudentSignals.ts:90-93`. Field `per_skill_cl: PerSkillCL[]` where `PerSkillCL = { skill_id:string|null, skill_name, state:SkillLearningState, cl_verb:'Reinforce'|'On Track'|'Enrich'|null, cl_display, confidence_label }` (`:43-50`). **TEACHER-ONLY** (carries band/risk/divergence/misconceptions) — but generation is server-side and never shown to the student, so reading it (or `skill_learning_state` directly) in the engine path is fine. There is **no standalone single-student per-skill CL loader** — either call `loadStudentSignals` or query the table directly.
- `skill_learning_state` table — `supabase/migrations/0005_skills.sql:52-71`: `(student_id, school_id, skill_id, state, confidence numeric 0-100, observation_count, evidence jsonb, last_reteach_outcome, updated_at)`, `UNIQUE(student_id, skill_id)`. `state ∈ {needs_different_instruction, needs_more_time, on_track, ready_to_extend, insufficient_data, not_attempted}`.
- CL mapping — `src/lib/skills/clVerbs.ts:8-25` `CL_VERB_BY_STATE`: needs_different_instruction/needs_more_time → **Reinforce**; on_track → **On Track**; ready_to_extend → **Enrich**; insufficient_data/not_attempted → **null** ("Not yet assessed").
- Confidence soft labels — `loadStudentSignals.ts:34-39`: ≥70 consistent, ≥40 tentative, else emerging.

## 4. Skills model
- `skills` table — `0005_skills.sql:9-29` (school-scoped UUID, name, slug, aliases).
- `quiz_questions.skill_id` FK → skills (`0005:34-35`). **Lessons have no direct skill column** — a lesson's skills = the skill set of its quiz's questions (`quizzes.lesson_id` + `quiz_questions.skill_id`).
- `assignments.skill_ids uuid[] NOT NULL DEFAULT '{}'` — `0005:44-45`. **NEVER populated by the generate/reinforce routes today** (stays `{}`).

## 5. Player (student-facing)
- `loadAssignmentForPlay` → `normalizeContent` (`src/lib/assignments/loadAssignmentForPlay.ts:12,28-39`) **strips tasks to `{ step, description, type }`** before reaching the client. Strategy/atl/ib/bloom never leave the server.
- `AssignmentPlayer.tsx` / `TaskCard.tsx`: shows only the step number + description. DrawingCanvas + MicButton + ReadAloudButton bind by `step`. `canvasUsed` behavioral signal flips on draw.
- Four-audience guards: `DIAGNOSTIC_VOCAB_RE` (`assignmentResultBundle.ts:21-22`) blocks reteach/reinforce/enrich/band/grade-level; `leakGuard` blocks digits/%/score/etc. (`leakGuard.ts:10-17,44-47`). `AssignmentResultScreen` shows the earned `{gradePct}%` (the allow-listed carve-out) and leak-guards all prose. `AssignmentPlayer.leak.test.tsx` is the regression net.
- **Skill NAMES are safe** to show as section headings (they're lesson topics, non-diagnostic). The **level (scaffolded/standard/extension) and the CL verb (Reinforce) must never reach the client.**

## 6. Grader + autosave + moat write-back
- `gradeAssignment({ assignmentTitle, tasks:[{step,description}], responses })` → `{ overall_grade, overall_feedback, task_grades:[{step,grade,feedback}] }` (`gradeAssignment.ts:13-24,53-75`). Continuous 0-100. `computeEffortLabel({score, teliHintCount})` is assignment-level.
- Submit completeness: a task is answered if `text.trim()` OR `image_url` (`homework-submit/route.ts:76-79`). Drawing-only counts.
- After submit, `recomputeSkillStatesForStudent` runs (`homework-submit/route.ts:153-154`). It attributes each graded assignment's grade/effort/reteach to **every** skill in `assignments.skill_ids[]` (`recomputeSkillStates.ts:230-301,354-395`), then fuses with quiz/spark observations via `computeSkillState` and upserts `skill_learning_state`.
  - **Because `skill_ids` is empty today, assignments currently contribute ZERO to per-skill CL.** Populating `skill_ids` alone turns assignment results into per-skill evidence (assignment-level granularity). Per-**task** attribution (each task's grade → its own skill) would be the finer, loop-closing upgrade and requires per-task skill tags + a change to the attribution loop.

## 7. V1 reference (the floor)
- V1 also fed only the coarse `band` into generation (`core/lib/openai/prompts.ts:744` `assignmentPrompt`); its `skill_learning_state` existed but was never consumed by generation. V1's detailed `bandProfiles` (reading level, passage length, verb whitelist/blacklist, Bloom ceiling) are mirrored in V2.
- V1 injected MORE student context than V2 currently does (`formatModelForPrompt`: trends, consistency, effort, hints, divergence, pattern flags → targeted prompt adaptations), but **never per-skill**. The grounding agents independently named "target the skill the student is weak on, not the class-average band" as V1's #1 generation gap — exactly what this epic closes.

## 8. Tests that constrain the change
Generation: `assignmentGen.test.ts`, `prompts.test.ts`, `assignments/generate/__tests__/route.test.ts`, `reinforce/__tests__/route.test.ts`.
Content/player: `loadAssignmentForPlay.test.ts`, `AssignmentPlayer.test.tsx`, `AssignmentPlayer.leak.test.tsx`, `TaskCard.test.tsx`, `DrawingCanvas.test.tsx`, `MicButton.test.tsx`, `ReadPhase.test.tsx`, `assignmentResultBundle.test.ts`, `imageUrlGuard.test.ts`.
Grader/moat: `gradeAssignment.test.ts`, `homework-submit/__tests__/route.test.ts`, `recomputeSkillStates.test.ts`, `computeEffortLabel.test.ts`, `computeSkillState.test.ts`.

## 9. No migration needed
`skill_learning_state`, `skills`, `quiz_questions.skill_id`, `assignments.skill_ids` all already exist. The lesson→skills resolution is a read; populating `skill_ids` is a write to an existing column. New per-task fields (`skill_id`, `skill_name`, `power_skill`) live inside the existing `content` jsonb — no DDL.
