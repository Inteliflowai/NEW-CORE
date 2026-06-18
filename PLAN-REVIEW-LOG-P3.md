# Plan Review Log: CORE v2 Plan 3 — Signals & Per-Skill Mastery
Started session 2026-06-18. MAX_ROUNDS=5. PLAN_FILE=docs/superpowers/plans/2026-06-18-p3-signals.md.
Plan authored via 7 parallel section-authors (verbatim V1 lift) + assembled + self-reviewed with a 7-item corrections appendix (P3-C1..C7).

## Round 1 — Codex

**Findings**

1. [guards.ts](C:/users/inteliflow/NEW-CORE/src/lib/auth/guards.ts:78) makes `guardStudentAccess()` allow student self-read and parent child-read, but Task 16’s teacher one-student route then uses an admin client to read `skill_learning_state` and `misconception_observations`. This directly violates the “students/parents must NOT read” invariant. Fix: add a teacher/admin role gate before `guardStudentAccess`, or create `guardTeacherStudentAccess()` that excludes students/parents.

2. [0005_skills.sql](C:/users/inteliflow/NEW-CORE/supabase/migrations/0005_skills.sql:90) already has an RLS hole: `sls_school_read` allows any same-school authenticated user, including students and parents, to read `skill_learning_state`. Fix: migration 0011 must replace this policy with staff-only roles plus platform admin.

3. The proposed `misconception_observations` RLS repeats the same bug: `school_id = public.get_my_school_id()` allows same-school students/parents to read observations. Fix: role-gate `mo_school_read` to `teacher`, `school_admin`, `school_sysadmin`, or platform admin.

4. Task 13 still reads phantom `quizzes(school_id)` and uses composite `responseId: "${attemptId}:${position}"` despite P3-C2. `quizzes.school_id` does not exist, and `quiz_response_id` is a UUID FK. Fix: select/capture real `quiz_responses.id`, and derive school_id via `quizzes.class_id -> classes.school_id` or `users.school_id`.

5. Task 6’s recompute code reads phantom columns/tables: `homework_attempts.grade`, `assignments.reteach_completed_at`, and `cognitive_signals`. None exist in migrations. Fix: use `homework_attempts.score_pct` or `teacher_score`, derive reteach from redo flags or add a real migrated/write-backed field, and replace `cognitive_signals` with actual `quiz_responses.grading_output` / `misconception_observations`.

6. `recomputeSkillStatesForStudent` is defined as `(admin, { studentId, schoolId, skillIds? })`, but Task 15 calls `recomputeSkillStatesForStudent(admin, student_id, { classId })`. Fix: update all call sites to the produced object signature.

7. Task 10 produces a verbatim V1 `computeRosterRiskIndex({ homeworkAttempts, quizAttempts, totalAssigned })`, but Task 15/16 call it with `{ avgHwScore, avgQuizScore, completionRate, quizScores, hwScores }`. Fix: map DB rows to the V1 input shape or intentionally change the producer and tests.

8. Session risk says all-zero telemetry must be neutral, but Task 11’s code only neutralizes empty arrays; default zero telemetry still returns baseline risk around `0.135`. Fix: add an all-telemetry-zero guard returning neutral sub-scores.

9. Session risk call sites omit data needed by the producer: Task 16 selects quiz attempts without `id`, then uses `latestAttemptId`, and `quiz_responses` are selected without `is_correct`. Fix: select `id` on attempts and `is_correct` on responses.

10. Weekly snapshot `improvement_4w` uses `.lte(snapshot_date, priorDate)` and the newest earlier row, but the spec requires exactly `snapshot_date - 28d` else `NULL`. Fix: use `.eq('snapshot_date', priorDateStr).maybeSingle()`.

11. `computeTrajectory` polarity correction P3-C6 is correct, but task bodies still call `computeTrajectory(quizScores)` in both cron/read routes. Fix: call `computeTrajectory(quizScores, false)` and add call-site tests.

12. Migration 0011’s inline `ADD COLUMN IF NOT EXISTS effort_label text CHECK (...)` is not fully idempotent if the column already exists without the check. Fix: add the column first, then drop/add a named `homework_attempts_effort_label_check` in a DO-block.

13. `misconception_types` is granted `ALL` to `authenticated, anon` with no RLS. That lets clients mutate the taxonomy. Fix: grant `SELECT` to anon/authenticated and `ALL` only to service_role, or enable RLS with read-only policies.

14. Task 12’s reteach effectiveness row shape requires `homework_attempts.class_id`, but the table has no `class_id`; class lives through `assignments.class_id`. Fix: join assignments or remove direct `class_id` from the pure input and map it at the route boundary.

Corrections P3-C1..C7 are mostly directionally correct, but they are not sufficient. They miss the teacher-route authorization leak, the existing `skill_learning_state` RLS leak, the recompute phantom schema, roster-risk signature mismatch, exact 4-week snapshot lookup, and session-risk neutral/id correctness.

VERDICT: REVISE

### Claude's response (round 1)
ACCEPTED all 14 findings (all concrete schema/RLS/signature facts, validated against migrations). Added corrections P3-C8..C18 + extended P3-C2 to the plan appendix:
- C8 staff role-gate on teacher read routes; C9 0011 tightens 0005 sls_school_read (LIVE hole) + misconception RLS to staff-only via get_my_role(); C10 recompute reads real cols (score_pct/teacher_score, redo flags, grading_output) not phantom grade/reteach_completed_at/cognitive_signals; C11 recompute object-signature at all call sites; C12 computeRosterRiskIndex takes raw attempt arrays; C13 session-risk all-zero-telemetry neutral guard (not 0.135); C14 read-API selects id+is_correct+telemetry; C15 improvement_4w exact .eq(-28d); C16 effort_label CHECK idempotent split; C17 misconception_types read-only to clients; C18 no homework_attempts.class_id; C2-ext Task 13 quizzes(school_id) phantom.
No findings rejected.


## Round 2 — Codex

The new P3-C8..C18 corrections cover most round-1 defects at the appendix level, but the plan still has material breaks.

1. Session-risk neutrality is still contradictory. P3-C13 says all-zero telemetry must return no risk, but Task 11’s test still expects `computeSessionRisk([])` to return `0.135` and only checks “no factors” for all-zero rows, not `score === 0` ([plan](C:/users/inteliflow/NEW-CORE/docs/superpowers/plans/2026-06-18-p3-signals.md:5093)). Fix: update the implementation and tests so empty and all-zero telemetry both return `{ score: 0, factors: [] }` or an explicit insufficient-telemetry result.

2. `computeSkillState`’s error-pattern vocabulary still does not match the new taxonomy. The V1 state machine expects `sessionErrorPatterns` values like `conceptual`, `careless`, and `procedural` ([plan](C:/users/inteliflow/NEW-CORE/docs/superpowers/plans/2026-06-18-p3-signals.md:2335)), but P3-C10 tells implementers to derive them from `reasoning_pattern` / `misconception_observations`, whose values are `surface_recall`, `partial_reasoning`, `misconception`, etc. ([plan](C:/users/inteliflow/NEW-CORE/docs/superpowers/plans/2026-06-18-p3-signals.md:83)). That means conceptual/slip shares silently stay zero. Fix: add a required mapping from OEQ taxonomy to V1 session patterns before feeding `computeSkillState`.

3. OEQ responses still won’t contribute to per-skill quiz evidence. Task 6 filters `quiz_responses` with `.not('is_correct', 'is', null)` ([plan](C:/users/inteliflow/NEW-CORE/docs/superpowers/plans/2026-06-18-p3-signals.md:3007)), but the current submit route writes OEQ `ai_score` and `grading_output`, not `is_correct` ([submit route](C:/users/inteliflow/NEW-CORE/src/app/api/attempts/[attemptId]/submit/route.ts:217)). Fix: either set OEQ `is_correct` from `ai_score` during submit, or have recompute derive correctness from `ai_score` for open responses.

4. Student snapshot RLS is still broader than the plan implies. `student_model_snapshots` allows any same-school authenticated user to read rows via `school_id = public.get_my_school_id()` ([0006](C:/users/inteliflow/NEW-CORE/supabase/migrations/0006_snapshots.sql:69)), while the student growth route text assumes student-scoped snapshot reads. Since snapshots include mastery band, risk, strengths, and struggles, this is peer-data exposure. Fix: tighten snapshot RLS to `student_id = auth.uid()` for students/parents and staff-only same-school reads.

5. P3-C10 says recompute may derive `sessionErrorPatterns` from `misconception_observations`, but `recordMisconceptions` intentionally excludes `error_type='none'` and MCQ/numeric rows. That is fine for recurring misconception reports, but insufficient as the only source for “careless/procedural/not conceptual” signals. Fix: define recompute’s pattern source explicitly: use graded `quiz_responses` telemetry/grading output for session patterns, and use `misconception_observations` only for recurring-error features.

VERDICT: REVISE

### Claude's response (round 2)
ACCEPTED all 5 findings (validated against migrations + submit route). Added P3-C19 (errorPatternMap: graded-OEQ grading_output → V1 session vocab conceptual/procedural/careless/random, so conceptualShare/slipShare populate; sessionErrorPatterns source = graded OEQ only, misconception_observations is the recurring-error feature store), P3-C20 (OEQ quiz-observation correctness = ai_score>=0.5, gather both question types — don't filter is_correct IS NOT NULL), P3-C21 (0011 tightens 0006 sms_scoped_read — students/parents own-row only, staff same-school, fixing peer-snapshot leak), and reinforced P3-C13 (change the Task 11 test to expect score 0 for empty AND all-zero telemetry). No findings rejected.


### Claude's response (round 3)
ACCEPTED all 4. Added P3-C22 (cron upserts consistency_score), P3-C23 (cron writes snapshot.mastery_band by COPYING currentMasteryBand over quiz rows — not recompute; invariant intact), P3-C24 (inject referenceDate into computeRosterRiskIndex + any wall-clock signal so the weekly snapshot is deterministic; tests freeze the clock). Added a Corrections->Task dispatch index to mitigate the stale-snippet copy hazard (round-3 #4) — each implementer is dispatched with only its task's binding corrections. No findings rejected.


## Round 4 — Codex

The new C22-C24 corrections close the remaining snapshot-write and determinism gaps. With the appendix governing over stale task snippets, the plan now has binding corrections for the schema mismatches, RLS posture, two-instrument invariant, session-risk adaptation, exact 28-day snapshot lookup, and weekly-snapshot ordering/write requirements.

I do not see a remaining material blocker. The one operational risk is that many task bodies still contain obsolete snippets, but the dispatch index now makes the binding corrections explicit per task; implementation review should reject any task that copies the stale body over its assigned corrections.

VERDICT: APPROVED
### Resolution
CONVERGED — VERDICT: APPROVED after 4 rounds. 24 corrections total (P3-C1..C24) + a Corrections->Task dispatch index. The plan's task bodies retain some pre-correction snippets; the appendix is BINDING and the dispatch index makes per-task corrections explicit — the subagent task-review gate must reject any task that copies a stale body over its assigned corrections.

