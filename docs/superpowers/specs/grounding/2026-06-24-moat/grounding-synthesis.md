# Grounding Synthesis — CORE V2 "Moat" Feature (Class CL + Learning-Style + Over-Time → Insights)

> Verbatim current-code facts gathered 2026-06-24 by 6 parallel readers + 1 synthesis pass
> (workflow `moat-grounding`). Every claim below is file:line-cited and was marked
> `confirmed` unless noted. This is the grounding of record for the moat spec
> (`docs/superpowers/specs/2026-06-24-moat-class-comprehension-design.md`).

## 1. What exists today

### Comprehension Level (CL) — storage, compute, surface
- **Storage:** `skill_learning_state` — per-`(student, skill)` row with `state` (6-value enum), `confidence` (0–100 numeric), `observation_count`, `evidence` jsonb, `last_reteach_outcome`, `updated_at`. `0005_skills.sql:52–70`. RLS: same-school staff read, service-role write (`0005_skills.sql:89–92`).
- **The 6 internal states → 3 teacher verbs (+null):** `needs_different_instruction`/`needs_more_time` → **Reinforce**, `on_track` → **On Track**, `ready_to_extend` → **Enrich**, `insufficient_data`/`not_attempted` → **null = "Not yet assessed"**. `clVerbs.ts:18–25`.
- **Compute:** `recomputeSkillStatesForStudent()` fuses quiz (MCQ `is_correct` / OEQ `ai_score≥0.5`), homework (`gradePct`), reteach redos, SPARK completions → upserts the fused state. `recomputeSkillStates.ts:88–402`.
- **Surface (teacher-only):** `CLBadge` renders verb + soft confidence word (`consistent`/`tentative`/`emerging`), **never** the raw enum or 0–100. `CLBadge.tsx:1–3, 39–43, 63–91`. Rendered only on the per-student **Skill Map Matrix** drill-in (`SkillMapMatrix.tsx:67`).
- **Already half-wired for the moat:** `loadStudentSignals` **already** loads `per_skill_cl[]` per student — `{skill_id, skill_name, state, cl_verb, cl_display, confidence_label}` — via the `skill_learning_state` join (`loadStudentSignals.ts:108–133`). This is the exact shape a class aggregate rolls up.

### Learning Style — storage, compute, visibility
- **Storage:** three text columns, no CHECK — `quiz_attempts.learning_style` (`0003:64`), `assignments.learning_style` (`0004:12`), `student_model_snapshots.learning_style` (`0006:20`). DB canonical set = `visual|auditory|text|kinesthetic|social|emerging` (`learningStyle.ts:14–22`); the **LLM prompt** vocabulary is a different 6-set `visual|auditory|read_write|kinesthetic|tactile|emerging` (`engine/types.ts:123`). Aliases normalize across them.
- **Compute:** `inferLearningStyle()` — GPT temp-0.3 over behavioral signals → `{learning_style, confidence}`; **degrades to `{emerging, 0}` on any error, never rethrows** (`assignmentGen.ts:131–152`). Derived from telemetry (response time, hesitation, navigation, pauses, word count — `0003:70–93`), never from student/teacher selection.
- **Visibility: shown to NO ONE.** Not teacher, student, or parent. It exists purely as a generation input.
- **Use:** drives **assignment** differentiation via `getStrategiesForStudent(band, style)` → 3 filtered Inteliflow strategies → mandatory per-style task-type minimums in `ASSIGNMENT_SYSTEM` (`prompts.ts:249–261, 706–712`). **Not** used in quiz or lesson generation.

### Insights page — current contents
- `loadInsights` returns exactly: `band_mix` (counts), `observation` (one conditional sentence | null), `concept_gaps` (skill name + soft phrase). `loadInsights.ts:8–35`.
- `band_mix` = filter roster on `band` (`reteach`/`grade_level`/`advanced`/null). **No CL, no learning-style.** `loadInsights.ts:20–26`.
- `observation` = three conditional branches, **null on cold-start and on balanced/on-track classes** (quiet on good days). `insightsObservation.ts:24–40`.
- Page: `PageHeader` → optional `SummaryCallout` → `BandMix` (4 count pills, no %) → `SkillsToFocus` (null if no gaps). `insights/page.tsx:51–58`.
- **No over-time content** anywhere — snapshot only.

### Over-time / snapshot infrastructure
- `student_model_snapshots` — weekly per-`(student, snapshot_date)`, ISO-week-Monday key, `UNIQUE(student_id, snapshot_date)`, `snapshot_schema_version` (v1/v2). Captures `mastery_band`, **`learning_style`** (most-recent non-null), `consistency_*`, `avg_score`, `improvement_4w` (exact `−28d` delta, null if absent), `risk_score`, `divergence_*`. `0006_snapshots.sql:11–44`; writer `cron/weekly-snapshot/route.ts:288–326`.
- **CL is NOT snapshotted** — 0 hits for any CL column in snapshots; only `updated_at` on `skill_learning_state`.
- **Proven trend pattern to mirror:** `loadStudentGradeTrend` → direction `climbing`/`steady`/`sliding`/null, 3-pt threshold, cold-start <2 pts (`loadStudentGradeTrend.ts:17–30`), rendered by `GradeTrendSparkline` (token SVG, calm text on cold-start).
- Next migration number = **0025** (`0024_gc_roster.sql` is highest).

### Divergence (quiz ↔ assignment)
- `computeHwQuizDivergence` → `{divergence_score 0–100, direction, trend, hw_avg, quiz_avg}`; aligned if gap ≤10, flagged at score ≥20 (`computeHwQuizDivergence.ts`; `loadStudentSignals.ts:304–308`).
- Rendered teacher-only in 3 places (One-Student "A pattern worth knowing"; Today "Needs you"; Roster triage), feeds `diagnosis.ts` suggested actions (≥25 verbal_check/reteach/profile; ≥20 monitor). It is the **one explicit exception** to number-hiding (`student.leak.test.tsx:51`). **Already DROPPED as an Alerts trigger** in Epic 3b.

### Differentiation pipeline
- **Band** drives quiz + assignment; thresholds ≤50 reteach / ≤79 grade_level / >79 advanced (`scoring.ts:10–14`); re-derived from most-recent complete quiz each load.
- **Learning style** drives assignment modality only. **CL does not currently drive generation.**

## 2. What does NOT exist — the gaps the moat fills

1. **No class-level CL aggregate.** Confirmed (`loadRosterSignals.ts:23–52` never queries `skill_learning_state`). But the per-student rollup already exists in `loadStudentSignals.per_skill_cl` — the gap is an aggregator, not new compute.
2. **No CL history / snapshot.** Confirmed. CL has only a live `updated_at`. Needs periodic capture.
3. **Learning style never teacher-visible.** Confirmed. Surfacing it at all is a net-new four-audience decision.
4. **Generation keys on band, not CL** — partially correct. Assignments key on band **and** learning style. Accurate gap: CL (per-skill state) is not a generation input; quizzes/lessons key on neither CL nor LS.
5. **No class learning-style distribution view.** Confirmed.
6. **No learning-style trend.** Confirmed (snapshot stores latest, not change).
7. **Insights has no over-time dimension and no CL/LS sections.** Confirmed.

Net: the moat is mostly **aggregation + history capture + surfacing decisions**, riding on compute that already runs.

## 3. Four-audience + coach-posture constraints the build MUST honor

1. **CL is teacher-only and stays so.** New class aggregate lives only under `(teacher)`. Never surface the 6-value enum or the 0–100 confidence — only the 3 verbs + soft words. Don't loosen the student growth route's "NEVER reads `skill_learning_state`" rule.
2. **Learning style is inferred and degradable** (`{emerging, 0}` fallback). Any teacher surfacing must gate out low/zero-confidence and `emerging`, present as tendency not verdict, never label an individual to non-teachers.
3. **Quiet on good days is mechanical:** every new section null-when-nothing-to-say (precedent: `insightsObservation`, `SkillsToFocus`, sparkline cold-start).
4. **Counts + soft words only — no %, no raw numbers** on the class summary. The divergence number-exception must NOT migrate here.
5. **Growth is "you vs your own past,"** never peer-relative or fabricated; explicit cold-start.
6. **Coach four-beat + reduced motion** (FEEL-DIRECTION / coachMotion); `prefers-reduced-motion` snaps every beat (WCAG-AA).
7. **Auth chain unchanged:** `guardClassAccess(classId)` + admin client; new snapshot table gets deny-by-default RLS like 0017/0023.
8. **All new copy is a Barb draft** → `STRINGS-FOR-BARB.md` (esp. the dignity-sensitive "Reinforce, never Reteach" rule).

## Primary files of record
`src/lib/insights/loadInsights.ts`, `src/lib/signals/loadRosterSignals.ts`, `src/lib/signals/loadStudentSignals.ts` (per_skill_cl shape), `src/lib/skills/clVerbs.ts`, `src/lib/skills/recomputeSkillStates.ts`, `src/components/core/CLBadge.tsx`, `src/components/core/GradeTrendSparkline.tsx`, `src/lib/gradebook/loadStudentGradeTrend.ts`, `src/app/api/cron/weekly-snapshot/route.ts`, `supabase/migrations/0006_snapshots.sql` + `0005_skills.sql`, `src/lib/engine/assignmentGen.ts` + `src/lib/openai/prompts.ts` (LS/strategy pipeline), `src/lib/copy/insightsObservation.ts`, `COACH-POSTURE.md`.
