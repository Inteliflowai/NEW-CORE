# The Moat — Class Comprehension + Learning-Style + Over-Time (Design Spec)

**Status:** DECISIONS LOCKED (Marvin, 2026-06-24) — all 5 of §4 resolved; ready for writing-plans.
**Grounding of record:** `docs/superpowers/specs/grounding/2026-06-24-moat/grounding-synthesis.md` (file:line-cited current-code facts).
**Memory:** [[v2-moat-coach-over-the-shoulder]], [[v2-pilot-feedback-and-reprioritized-queue]], [[v2-rebuild-thesis-operational-vs-pedagogical]], [[v2-reteach-is-reinforce]].

## 1. Why this, why now

This is the moat — the one item Barb + Marvin's pilot feedback kept circling: teacher surfaces show cryptic diagnostic *labels*, but the thing teachers actually need — **"where is my class on understanding this material, who learns how, and is it getting better"** — isn't built. Differentiated learning is a commodity; acting like a **coach over the teacher's shoulder** is the differentiator. This feature is that coach speaking at the **class** level.

The pleasant surprise from grounding: this is mostly **aggregation + history capture + surfacing** over compute that already runs. The per-student Comprehension Level (CL) rollup already exists in `loadStudentSignals.per_skill_cl`; we are not building a new model.

## 2. Scope

**In:**
- A **class-level Comprehension Level view** for teachers — aggregate the existing per-skill CL states into a legible, coach-postured summary.
- **Over-time:** capture CL history so the class summary can say "this is getting better / holding / slipping."
- **(Pending decision)** a **class learning-style** reassurance rollup.
- **Fold** the above into the **Insights** page as the actionable class summary (pending decision e).
- A decision on **divergence**'s place (pending decision d).

**Out (explicitly):**
- Feeding CL into content *generation* (generation keys on band today; changing that is a separate, riskier epic).
- Any student/parent-facing CL or learning-style surface (four-audience: both are teacher-only).
- Per-student new surfaces — the One-Student Skill Map already shows per-student CL.
- Chapter-level evaluation (separate queued item).

## 3. The thesis in one screen

The teacher opens **Insights** and reads, top to bottom, only what's worth saying today:

1. **One coach sentence** — leads with an observation, not a metric (e.g. *"Most of the class has fractions down; a handful need another pass on equivalent fractions."*). Null when the class is balanced/cold-start.
2. **Comprehension by skill** — for the few skills that need attention, a plain tally in the existing 3 verbs: *"Equivalent fractions — 3 Reinforce · 5 On Track · 2 Enrich."* Quiet when nothing needs reinforcement.
3. **Over time** — one calm line + the existing sparkline pattern: *"Comprehension here has been climbing the last few weeks."* Calm cold-start text under 2 data points.
4. **How students learn** — a class reassurance line (no per-student labels, low-confidence gated out): *"…assignments differentiate to each."*

Everything obeys: counts + soft words only (no %, no raw numbers), quiet-on-good-days is mechanical, growth is you-vs-your-own-past, teacher-only.

## 4. The 5 decisions for Marvin (plain English)

For each: the question, why it's a real choice, and my recommendation.

### (a) How should a class's comprehension show up so you *get it in one glance*? — DECIDED
**This view is WHOLE-CLASS** (the gap; per-student CL already lives on the One-Student Skill Map). It counts *students in this class* per skill.
**Decision (Marvin): whole-class tally per skill, with details on demand (progressive disclosure).**
- **Default:** quiet per-skill tally in the 3 verbs — "Equivalent fractions — 3 Reinforce · 5 On Track · 2 Enrich." Sorted most-Reinforce-first, capped to the top ~3 skills, hidden entirely when nothing needs attention.
- **Expand a skill:** reveal *which* students sit in each bucket (names grouped under Reinforce / On Track / Enrich).
- **Click a name:** their existing full Skill Map drill-in.
Quiet by default, depth on demand — no wall of stats.

### (b) Should you ever see the *mix of how students learn* in a class — and how? — DECIDED
**Why it's an inference:** nobody declares learning style — the student doesn't pick it, the teacher doesn't set it. The system **infers** it from *behavior during quizzes* (pause length, backtracking, response time, word count); an AI maps that behavior to a style. It's a best guess that grows more confident with data and stays "still figuring it out" (low confidence) when signal is thin.
**Decision (Marvin): a class-level reassurance line, no individual labels.** e.g. *"Your class spans visual, hands-on, and discussion-based learners — assignments **differentiate** to each."* **Copy lock: "differentiate," never "adapt."** Excludes low-confidence/"emerging" guesses; never labels a specific student; teacher-only. Tells the personalization story without turning a guess into a verdict.

### (c) How do we remember a class's understanding *over time*? — DECIDED
**Decision (Marvin): a new weekly per-skill CL snapshot table (migration 0025), written by the cron that already runs weekly, shown with the sparkline already shipped.** Same weekly cadence as every other trend; keeps the actionable skill grain; reuses a shipped, accessible component.

### (d) The quiz-vs-assignment "gap" signal — keep, reframe, or hide? — DECIDED
**Decision (Marvin, default accepted): leave it exactly as-is per-student, and do NOT add it to the class summary.** It's inherently a per-student pattern — averaging it across a class is misleading — and adding raw numbers would pollute a deliberately quiet summary. No new work, no posture cost.

### (e) Should all this become *the* Insights page, or a separate surface? — DECIDED
**Decision (Marvin): fold into Insights**, structured exactly as §3 (coach sentence → CL tally → trend → learning-style line), every section quiet when empty. One hub for "the state of my class" matches the coach-over-the-shoulder goal better than a second dashboard.

## 5. Proposed build shape (on sign-off → writing-plans)

Assuming the recommended defaults, the work decomposes to:
1. **Migration 0025** — `skill_state_snapshots` (per `(student, skill, iso_week)`; CL state + confidence), deny-by-default RLS (mirror 0017/0023). Additive only.
2. **Weekly cron extension** — `cron/weekly-snapshot` also writes the per-skill CL snapshot for each active student (idempotent upsert on `(student_id, skill_id, snapshot_date)`).
3. **Aggregator** — a `loadClassComprehension(admin, classId)` lib: roll up `skill_learning_state` across the class into per-skill `{reinforce, on_track, enrich, not_assessed}` tallies + the **student names per bucket** (for the expand) + a class trend direction (mirror `loadStudentGradeTrend`), reading the new snapshot table. Pure, fully unit-tested.
4. **Insights extension** — `loadInsights` gains the CL tally + trend + LS rollup; page renders new quiet sections; lead coach sentence upgraded to speak to comprehension. **Per-skill row expands to student names grouped by bucket; each name links to the existing One-Student Skill Map** (`/students/[id]`). Reuse `GradeTrendSparkline`, `BandMix`-style pills, `SummaryCallout`, coachMotion four-beat.
5. **Learning-style rollup** — confidence-gated class distribution → one reassurance line ("differentiate," not "adapt"); teacher-only; never per-student.
6. **Copy** → `STRINGS-FOR-BARB.md §Insights / Class Comprehension` (all draft, Barb gates).

**Process:** writing-plans → subagent-driven TDD (fresh implementer per task + per-task review) → whole-branch adversarial Workflow review → Playwright preview (propose-only visuals; no gold-plating — whole-UI redesign is on hold) → Marvin merge call. Gates: tsc 0, vitest green, build 0 (a11y + tokens).

## 6. Constraints (binding — from grounding §3)
Teacher-only CL (never the enum/0–100); learning style gated + never individually labeled to non-teachers; quiet-when-empty mechanical; counts + soft words only (divergence number-exception does not migrate here); you-vs-your-own-past with explicit cold-start; auth chain unchanged + RLS deny-by-default on the new table; reduced-motion snaps; all copy is a Barb draft; "Reinforce, never Reteach."
