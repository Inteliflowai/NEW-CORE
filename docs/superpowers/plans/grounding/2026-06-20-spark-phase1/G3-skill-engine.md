# G3 — Skill Engine Seam (SP-3 feeds this)

Verbatim current-code grounding. Read-only. CORE V2 @ `C:/users/inteliflow/NEW-CORE`, branch `feat/teacher-app-shell`.

Two files in scope:
- `src/lib/skills/recomputeSkillStates.ts` (DB orchestrator — SP-3 calls this)
- `src/lib/skills/computeSkillState.ts` (pure fusion — SPARK types already defined here)

---

## FLAG (most important) — the spec's guessed name IS correct, signature is OBJECT-form

The spec guessed `recomputeSkillStatesForStudent`. **CONFIRMED — that is the real exported name.** It is **per-student**, NOT per-class. There is NO `recomputeSkillStatesForClass` / no class-level variant.

EXACT signature (`recomputeSkillStates.ts:87-95`):

```ts
export async function recomputeSkillStatesForStudent(
  admin: SupabaseClient,
  args: {
    studentId: string;
    schoolId: string | null;
    /** Limit recompute to these skills. Omit = all touched skills. */
    skillIds?: string[];
  },
): Promise<SkillStateRecomputeSummary>
```

- Param order: **`(admin, args)`** — positional admin client FIRST, then an options object. NOT `(admin, studentId, {...})`. A historical Task-15 spec used the wrong 3-arg form `recomputeSkillStatesForStudent(admin, student_id, { classId })` — that signature does NOT exist and was flagged WRONG (P3-C11). SP-3 MUST call the 2-arg object form.
- `admin` is a `@supabase/supabase-js` `SupabaseClient` (the service-role/admin client; bypasses RLS).
- "Which skills changed": pass `skillIds?: string[]`. If provided, ONLY those skills are recomputed (even with zero observations → honest insufficient_data/not_attempted). If omitted, it sweeps **all touched skills** (every skill seen across the student's quiz responses + homework). See `recomputeSkillStates.ts:302-311`:

```ts
    const touched = new Set<string>([
      ...quizBySkill.keys(),
      ...hwBySkill.keys(),
    ]);
    const targets: string[] =
      args.skillIds?.length ? args.skillIds : Array.from(touched);
```

- `schoolId: null` is ALLOWED — when null, it self-resolves from `users.school_id` for the student (`recomputeSkillStates.ts:102-110`):

```ts
    let schoolId = args.schoolId;
    if (schoolId == null) {
      const { data: userData } = await admin
        .from('users')
        .select('school_id')
        .eq('id', studentId)
        .single();
      schoolId = userData?.school_id ?? null;
    }
```

- **NEVER throws** — wraps everything in try/catch and returns a summary (`recomputeSkillStates.ts:360-363`):

```ts
  } catch (err) {
    console.error('[recomputeSkillStates] Non-blocking error:', err);
    return { ok: false, reason: 'exception', skillsRecomputed: 0, states: {} };
  }
```

Return type (`recomputeSkillStates.ts:35-40`):

```ts
export interface SkillStateRecomputeSummary {
  ok: boolean;
  reason?: string;
  skillsRecomputed: number;
  states: Record<string, string>; // skill_id → state (for logging)
}
```

---

## Task 1 — observation-gather block + the `spark: []` line

### Imports (`recomputeSkillStates.ts:23-31`)

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  computeSkillState,
  type SkillStateInput,
  type SkillQuizObservation,
  type SkillHomeworkObservation,
  type SkillReteachEvent,
} from './computeSkillState';
import { toSessionErrorPattern } from './errorPatternMap';
```

NOTE: `SkillSparkObservation` is NOT currently imported here (it is defined in `computeSkillState.ts` but unused by the orchestrator — SP-3 will need to add the import).

### Quiz-response fetch + observation build (`recomputeSkillStates.ts:112-170`)

```ts
    // ── 1. Quiz responses: both MCQ (is_correct) and OEQ (ai_score) ──────────
    // C20: do NOT filter .not('is_correct','is',null) — that drops OEQ rows.
    // We gather ALL graded responses; correctness is derived per-row below.
    const { data: respData, error: respErr } = await admin
      .from('quiz_responses')
      .select(
        'is_correct, ai_score, question_type_scored, grading_output, ' +
        'quiz_questions!inner(skill_id), ' +
        'quiz_attempts!inner(student_id, is_complete, submitted_at)',
      )
      .eq('quiz_attempts.student_id', studentId)
      .eq('quiz_attempts.is_complete', true)
      .not('quiz_questions.skill_id', 'is', null)
      .limit(2000);

    if (respErr) {
      console.error('[recomputeSkillStates] quiz_responses query error:', {
        message: respErr.message,
        code: respErr.code,
      });
    }

    const responses = (respData ?? []) as unknown as QuizResponseRow[];

    // Build per-skill quiz observations + per-skill session error patterns.
    // C20: MCQ → is_correct===true; OEQ → ai_score >= 0.5.
    // C19: sessionErrorPatterns ONLY from graded-OEQ grading_output.
    const quizBySkill = new Map<string, SkillQuizObservation[]>();
    const errorPatternsBySkill = new Map<string, string[]>();

    for (const r of responses) {
      const skillId = r.quiz_questions?.skill_id;
      if (!skillId) continue;

      const occurredAt = r.quiz_attempts?.submitted_at ?? '';
      const qtype = r.question_type_scored;

      // C20: derive correctness
      let isCorrect: boolean;
      if (qtype === 'open') {
        // OEQ: ai_score >= 0.5 counts as correct
        isCorrect = (r.ai_score ?? 0) >= 0.5;
      } else {
        // MCQ / numeric: is_correct column
        isCorrect = r.is_correct === true;
      }

      if (!quizBySkill.has(skillId)) quizBySkill.set(skillId, []);
      quizBySkill.get(skillId)!.push({ isCorrect, occurredAt });

      // C19: session error patterns from graded-OEQ grading_output only
      if (qtype === 'open' && r.grading_output) {
        const pattern = toSessionErrorPattern(r.grading_output);
        if (pattern !== null) {
          if (!errorPatternsBySkill.has(skillId)) errorPatternsBySkill.set(skillId, []);
          errorPatternsBySkill.get(skillId)!.push(pattern);
        }
      }
    }
```

Homework gather (assignments + homework_attempts) lives at `recomputeSkillStates.ts:172-300`; it builds `hwBySkill: Map<string, SkillHomeworkObservation[]>` and `reteachBySkill: Map<string, SkillReteachEvent>`. SPARK observations would mirror this — a `sparkBySkill: Map<string, SkillSparkObservation[]>` is what SP-3 must add.

### The `spark: []` line — fuse + upsert loop (`recomputeSkillStates.ts:313-326`)

```ts
    // ── 5. Fuse + upsert ─────────────────────────────────────────────────────
    const states: Record<string, string> = {};

    for (const skillId of targets) {
      // C19: session error patterns for this skill (from OEQ grading_output via map)
      const sessionErrorPatterns = errorPatternsBySkill.get(skillId) ?? [];

      const input: SkillStateInput = {
        quiz: quizBySkill.get(skillId) ?? [],
        homework: hwBySkill.get(skillId) ?? [],
        sessionErrorPatterns,
        reteach: reteachBySkill.get(skillId) ?? null,
        spark: [], // SPARK webhook is Plan 6; always empty here
      };

      const fused = computeSkillState(input);
      states[skillId] = fused.state;
```

>>> THE LINE SP-3 REPLACES is `recomputeSkillStates.ts:325`: `spark: [], // SPARK webhook is Plan 6; always empty here`. The spec's "~line 325" estimate is exact.

Upsert that follows (`recomputeSkillStates.ts:332-347`):

```ts
      const { error: upErr } = await admin
        .from('skill_learning_state')
        .upsert(
          {
            student_id: studentId,
            school_id: schoolId,
            skill_id: skillId,
            state: fused.state,
            confidence: fused.confidence,
            observation_count: fused.observationCount,
            evidence: fused.evidence,
            last_reteach_outcome: fused.lastReteachOutcome,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'student_id,skill_id' },
        );
```

---

## Task 2 — EVERY caller of `recomputeSkillStatesForStudent`

Only TWO production call sites (both 2-arg object form). SP-3 must call identically.

### Caller 1 — submit route (`src/app/api/attempts/[attemptId]/submit/route.ts`)

Import (`route.ts:27`): `import { recomputeSkillStatesForStudent } from '@/lib/skills/recomputeSkillStates';`

Invocation (`route.ts:294-303`) — fail-isolated, fire-and-forget (`void` + `.catch`), `schoolId: null`:

```ts
    try {
      void recomputeSkillStatesForStudent(admin, {
        studentId: attempt.student_id,
        schoolId: null, // recomputeSkillStatesForStudent resolves school_id from users.school_id internally when null
      }).catch((recomputeErr) => {
        console.warn('[submit] skill state recompute failed (non-blocking):', recomputeErr);
      });
    } catch (recomputeErr) {
      console.error('[submit] skill state recompute hook threw (non-blocking):', recomputeErr);
    }
```

### Caller 2 — weekly-snapshot cron (`src/app/api/cron/weekly-snapshot/route.ts`)

Import (`route.ts:28`): `import { recomputeSkillStatesForStudent } from '@/lib/skills/recomputeSkillStates';`

Invocation (`route.ts:127-132`) — `await`ed, per-student in a loop, `schoolId: school_id || null`, MUST run before the skill_learning_state rollup:

```ts
      // ── Step 1: recomputeSkillStatesForStudent — MUST run first (C11) ──────
      // C11: object signature { studentId, schoolId }
      await recomputeSkillStatesForStudent(admin, {
        studentId: student_id,
        schoolId: school_id || null,
      });
```

Other matches are tests/specs only: `src/lib/skills/__tests__/recomputeSkillStates.test.ts`, `src/app/api/attempts/[attemptId]/submit/__tests__/route.test.ts:214-215` (mock), `src/app/api/cron/weekly-snapshot/__tests__/route.test.ts:65-66` (mock), and `docs/superpowers/plans/2026-06-18-p3-signals.md`.

Both production callers pass NO `skillIds` → full per-student sweep. SP-3's ingestion route would follow the SAME pattern (per-student, object form). If SP-3 wants to scope to the skills a SPARK completion touched, it passes `skillIds`.

---

## Task 3 — `SkillSparkObservation` and `SkillStateInput` (verbatim from computeSkillState.ts)

### `SkillSparkObservation` (`computeSkillState.ts:67-85`)

```ts
export interface SkillSparkObservation {
  /**
   * 0-100 transfer score for this SPARK completion: average of the
   * non-null 7-dim rubric values × 25 (same mapping the BNCC roll-up
   * uses), falling back to SPARK's own 0-100 score when the analyzer
   * dims are absent. null = completion recorded but never scored
   * (submit-time webhook only) — counts as contact, not as a graded
   * observation.
   */
  transferScore: number | null;
  /**
   * SPARK analyzer's engagement classification. 'non_engaged' and
   * 'minimal' completions are NOT skill evidence (engagement-guard
   * parity: "didn't engage" must never be scored as "can't").
   */
  contentQuality: 'engaged' | 'minimal' | 'non_engaged' | null;
  completed: boolean;
  occurredAt: string; // ISO
}
```

### `SkillStateInput` (`computeSkillState.ts:87-107`)

```ts
export interface SkillStateInput {
  quiz: SkillQuizObservation[];
  homework: SkillHomeworkObservation[];
  /**
   * Session-level cognitive_signals.error_pattern_type values from
   * the student's quiz sessions (chronological). Session-level, not
   * per-skill — labeled as such in the evidence.
   */
  sessionErrorPatterns: string[];
  /** Most recent completed reteach touching this skill, if any. */
  reteach?: SkillReteachEvent | null;
  /**
   * SPARK simulation completions attributed to this skill via the
   * parent assignment's skill_ids (assignment-level attribution —
   * same granularity as homework observations). SPARK is a
   * LOW-SCAFFOLD APPLICATION context: closer to a cold test than
   * homework, exercised in a novel setting. Optional — absent input
   * is byte-identical to pre-SPARK behavior.
   */
  spark?: SkillSparkObservation[];
}
```

Supporting types referenced by the input (verbatim):

`SkillQuizObservation` (`computeSkillState.ts:41-45`):
```ts
export interface SkillQuizObservation {
  /** Cold (unscaffolded) per-question correctness on this skill. */
  isCorrect: boolean;
  occurredAt: string; // ISO
}
```

`SkillHomeworkObservation` (`computeSkillState.ts:47-55`):
```ts
export interface SkillHomeworkObservation {
  gradePct: number | null;
  submitted: boolean;
  occurredAt: string; // ISO
  effortLabel?: string | null;
}
```

`SkillReteachEvent` (`computeSkillState.ts:57-65`):
```ts
export interface SkillReteachEvent {
  type: 'more_practice' | 'different_approach';
  completedAt: string; // ISO
}
```

---

## Engine consumption already wired (no engine change needed for SP-3)

`computeSkillState` ALREADY consumes `input.spark` end-to-end. SPARK-relevant facts:

- Filter (`computeSkillState.ts:225-230`): keeps only `s.completed && contentQuality !== 'non_engaged' && contentQuality !== 'minimal'`; "scored" = `typeof transferScore === 'number'`.
- `observationCount = quiz.length + gradedHw.length + sparkScored.length` (`computeSkillState.ts:232`).
- `not_attempted` guard counts raw spark contact (`computeSkillState.ts:238`): `(input.spark ?? []).length === 0` is part of the zero-contact test.
- SPARK thresholds in `SKILL_STATE_WEIGHTS` (`computeSkillState.ts:191-203`): `SPARK_STRONG_TRANSFER: 70`, `SPARK_WEAK_TRANSFER: 50`, `SPARK_TREND_DELTA: 15`, `CONFIDENCE_SPARK_DISCOUNT: 10`, `CONFIDENCE_FLOOR: 10`.

So SP-3's ONLY job in the engine seam: gather `spark_completions` → map to `SkillSparkObservation[]` per skill → replace `spark: []` at line 325 with `sparkBySkill.get(skillId) ?? []`. No change to `computeSkillState`.

---

## DISCREPANCIES / RISKS

- **No phantom function.** There is no `recomputeSkillStatesForClass`; per-student only. SP-3's ingestion route knows the studentId from the completion, so call per-student.
- **`SkillLearningState` has 6 values** (`computeSkillState.ts:33-39`): includes `ready_to_extend` (the spec's header comment in recomputeSkillStates.ts at top references "6 values" — consistent).
- **`spark_completions` table is the assumed SPARK source** (per the SPARK Phase-1 spec, `docs/superpowers/specs/2026-06-20-spark-integration-phase1-design.md:67`). This grounding did NOT verify that table exists in migrations — a SEPARATE grounding (schema) should confirm `spark_completions` columns (`transfer/score`, `content_quality`, `completed`, timestamp, `assignment_id`/`skill` linkage). The mapping `content_quality ∈ {non_engaged,minimal}` filtered OUT is the engagement guard.
- **Attribution granularity:** `SkillSparkObservation` docstring says SPARK is attributed to a skill via the parent assignment's `skill_ids` (assignment-level — same as homework). SP-3's gather must join `spark_completions → assignment → skill_ids`, mirroring the homework block at lines 172-300.
- `errorPatternMap` exports `toSessionErrorPattern` (imported at line 31) — unrelated to SPARK but part of the file's import surface.
