# G2 — Assignment generation route + engine (SP-2 hook point) — VERBATIM grounding

Branch: `feat/teacher-app-shell`. Read-only. All quotes verbatim with `file:line`.

---

## 1. Route: `src/app/api/teacher/assignments/generate/route.ts`

### 1a. Auth chain (verbatim, lines 19–54)

```ts
export async function POST(req: NextRequest) {
  try {
    // ── Auth ──
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    ...
    const admin = createAdminSupabaseClient();
    const { data: attempt } = await admin
      .from('quiz_attempts')
      .select(
        'id, student_id, mastery_band, learning_style, quizzes(class_id, lesson_id, lessons(parsed_content, title)), users:student_id(full_name)',
      )
      .eq('id', quiz_attempt_id)
      .single();

    if (!attempt) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    }

    // ── Object-level guard: IDOR — RLS is NOT the backstop on the admin client ──
    const guard = await guardStudentAccess(attempt.student_id as string);
    if (guard) return guard;
```

NOTE the auth chain here is `auth.getUser()` → 401, then **`guardStudentAccess(attempt.student_id)`** (object-level IDOR). There is **no explicit STAFF_ROLES role-gate inside this route** — the guard is `guardStudentAccess` only (see `src/lib/auth/guards.ts`, not read here).

Imports (lines 10–17):
```ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardStudentAccess } from '@/lib/auth/guards';
import { generateAssignment, inferLearningStyle } from '@/lib/engine/assignmentGen';
import { normalizeLearningStyle } from '@/lib/utils/learningStyle';
import { OPENAI_GEN_MODEL } from '@/lib/ai/models';
import { respondEngineError } from '@/app/api/_lib/errorEnvelope';
import { computeBehavioralSummary, formatSignalsForPrompt } from '@/lib/utils/scoring';
```

Request body (lines 29–36): `{ quiz_attempt_id?: string; learning_style?: string }` — only `quiz_attempt_id` is required.

### 1b. The assignment-row INSERT object (verbatim, lines 124–139)

```ts
    // ── Persist (C6: normalizeLearningStyle ONLY at the write boundary) ──
    const { data: row, error: insErr } = await admin
      .from('assignments')
      .insert({
        quiz_attempt_id: attempt.id,
        student_id: attempt.student_id,
        class_id: classId,          // C15: from quizzes join
        lesson_id: lessonId,        // C15: from quizzes join
        mastery_band: band,
        learning_style: normalizeLearningStyle(style), // C6: normalize at boundary
        content: assignment,
        status: 'draft',
        generation_model: OPENAI_GEN_MODEL,
      })
      .select()
      .single();
```

Every column inserted: `quiz_attempt_id`, `student_id`, `class_id`, `lesson_id`, `mastery_band`, `learning_style`, `content`, `status`, `generation_model`. **NO `spark_*` column is inserted.**

### 1c. How `row.id` is obtained after insert (lines 138–145)

`.select().single()` returns the full row into `row`; `row.id` is then read directly:
```ts
    if (insErr || !row) {
      return NextResponse.json({ error: 'Failed to save assignment' }, { status: 500 });
    }

    return NextResponse.json({ assignment_id: row.id, content: assignment });
```

### 1d. Exact post-persist hook range (where SP-2 create-notify would hook)

The successful-persist guard ends at **line 143**, and the response is returned at **line 145**. A post-persist SPARK create-notify hook would go **between line 143 and line 145** (after the `if (insErr || !row)` bail, before `return NextResponse.json(...)`), with `row` fully available. The function `catch` ends at lines 146–149:
```ts
  } catch (err) {
    console.error('[teacher/assignments/generate] error:', err);
    return respondEngineError(err);
  }
```

---

## 2. Engine: `src/lib/engine/assignmentGen.ts`

### 2a. `AssignmentInput` type (verbatim, lines 32–42)

```ts
export interface AssignmentInput {
  lessonSummary: string;
  /** The quiz-score mastery band (never null — route must refuse if absent, C20). */
  band: 'reteach' | 'grade_level' | 'advanced';
  /** Learning style in 6-value prompt vocabulary (read_write/tactile pass through to
   *  getStrategiesForStudent; DB normalization happens at the route, not here). */
  style: string;
  studentName: string;
  sparkEnabled?: boolean;
  targetedPractice?: boolean;
}
```

`sparkEnabled?: boolean` and `targetedPractice?: boolean` already exist on the input type.

### 2b. `generateAssignment` signature + how `sparkEnabled` flows (lines 50–67)

```ts
export async function generateAssignment(input: AssignmentInput): Promise<Assignment> {
  const strategies = getStrategiesForStudent(input.band, input.style).map((s) => ({ ... }));

  const userPrompt = assignmentPrompt(
    input.lessonSummary,
    input.band,
    input.style,
    input.studentName,
    strategies,
    input.sparkEnabled,
    input.targetedPractice,
  );
```

**`sparkEnabled` is PROMPT-ONLY.** It is passed to `assignmentPrompt(...)` (positional arg #6) and nowhere else. In `src/lib/openai/prompts.ts` the `assignmentPrompt` signature param is `sparkEnabled?: boolean` (prompts.ts:751), and it only conditionally appends a "SPARK CHALLENGE — PARALLEL TO HOMEWORK" instruction block to the prompt text (prompts.ts:1033+). It does **NOT** change the output schema and does **NOT** emit any spark task type. The route at `route.ts:117–122` calls `generateAssignment({ lessonSummary, band, style, studentName })` and **does NOT pass `sparkEnabled` or `targetedPractice`** — so spark is currently never enabled at the route.

prompts.ts:1043–1046 (verbatim):
```
- Do NOT emit any task with type "spark_experience". That type does not exist in
  this output schema. The valid task types are exactly: read, write, draw, discuss,
  create, analyze.
```

### 2c. The `Assignment` / content output shape (`src/lib/engine/types.ts:129–157`)

```ts
const AssignmentTaskSchema = z.object({
  step: z.number().int(),
  description: z.string(),
  type: z.enum(['read', 'write', 'draw', 'discuss', 'create', 'analyze']),
  strategy: z.string(),
  atl_skill: z.string(),
  ib_attribute: z.string(),
  bloom_level: z.string(),
});
export const AssignmentSchema = z.object({
  title: z.string(),
  mode: z.string(),
  learning_style: z.string(),
  reading_passage: z.string().min(1),
  audio_script: z.string().min(1),
  diagram_mode: z.enum(['image', 'structured', 'none']),
  diagram_description: z.string().nullable(),
  diagram_svg_prompt: z.string().nullable(),
  diagram_image_prompt: z.string().nullable(),
  youtube_search_query: z.string(),
  instructions: z.string(),
  tasks: z.array(AssignmentTaskSchema).min(2),
  support_note: z.string().optional(),
  extension_prompt: z.string().optional(),
  atl_summary: z.array(z.string()).default([]),
  ib_attributes: z.array(z.string()).default([]),
});
export type Assignment = z.infer<typeof AssignmentSchema>;
```

**DISCREPANCY — the planner must note:** The `Assignment` content shape has `title` and `learning_style`, but **NO `concept_tags`, NO `subject`, NO `subject_domain`** field. There are no concept tags or subject in the assignment-generation output at all.

---

## 3. Student-profile fields available at the route at persist time

| Field needed by SPARK | Available at hook? | Source (verbatim) |
|---|---|---|
| `mastery_band` / `band` | YES | `route.ts:57` `const band = attempt.mastery_band as ...` (from the `quiz_attempts` select). |
| `learning_style` (style) | YES (as `style` string, 6-value vocab) | `route.ts:85` `const attemptStyle = (attempt.learning_style as string \| null) \|\| requestedStyle \|\| null;` → resolved into `style` (route.ts:86–114), possibly via `inferLearningStyle`. Persisted normalized via `normalizeLearningStyle(style)` at route.ts:133. |
| `grade` / `grade_level` | **NOT in the route's select** | The select (route.ts:42–44) pulls only `users:student_id(full_name)` — NO grade. `lessons.grade_level` and `lessons.subject` columns EXIST (0003_lessons_quizzes.sql:16–17) but the join only selects `lessons(parsed_content, title)` (route.ts:43) — **grade_level / subject are NOT selected**. The `users` table has `grade_level` and `grade_levels` (0001_identity_roles.sql:48,51) but neither is selected. |
| `studentName` | YES | `route.ts:77–78` from `users:student_id(full_name)`. |
| `concept_tags` | **NOT available** | Not in `Assignment` output (types.ts), not selected, not persisted. (`lessons.parsed_content` jsonb has `key_concepts` per `ParsedLessonSchema` types.ts:9, and quiz questions have `concept_tag` types.ts:36 — but neither is surfaced at this route.) |
| `subject_domain` | **NOT available** | No such column anywhere; `lessons.subject` exists but is not selected. |
| `grade_band` | **NOT available** | No `grade_band` column exists in any migration. |

The route's only DB read of the attempt (verbatim, route.ts:40–46):
```ts
    const { data: attempt } = await admin
      .from('quiz_attempts')
      .select(
        'id, student_id, mastery_band, learning_style, quizzes(class_id, lesson_id, lessons(parsed_content, title)), users:student_id(full_name)',
      )
      .eq('id', quiz_attempt_id)
      .single();
```

---

## FLAGS / RISKS

- **`assignments` has NO `spark_*` column.** Full DDL: `0004_assignments_homework.sql:4–22` (cols: id, quiz_attempt_id, student_id, class_id, lesson_id, mastery_band, assignment_mode, learning_style, content, status, teacher_reviewed, teacher_override_reason, push_status, reteach_needed, scaffold_level, due_at, created_at). Only later alter to this table is `0010_engine_columns.sql:71–72` adding `generation_model text`. A SPARK linkage column (e.g. `spark_session_id`, `spark_status`) would require a NEW migration.
- **SPARK create payload fields NOT readily available at the hook point:** `grade` / `grade_level`, `grade_band`, `concept_tags`, `subject_domain`. None are selected by the route's query, and `concept_tags`/`subject_domain` do not exist on the `Assignment` output shape at all. `grade_band` exists nowhere in the schema. To supply grade/subject the route's `.select(...)` (route.ts:43) must be widened to pull `lessons(... grade_level, subject)` and/or `users:student_id(full_name, grade_level)`.
- Readily available at hook (line 143–145): `row` (full assignment row incl. `row.id`), `band`, `style` (6-value), normalized `learning_style` (via `normalizeLearningStyle(style)`), `studentName`, `classId`, `lessonId`, `assignment` (the `Assignment` content object incl. `title`).
- **Spark is never enabled in production today:** route.ts:117–122 omits `sparkEnabled`/`targetedPractice`, so `assignmentPrompt` always runs the non-spark branch.
- **No explicit STAFF_ROLES gate in this route** — only `auth.getUser()` + `guardStudentAccess(attempt.student_id)`.

### Next migration number / naming convention
Highest existing migration: `supabase/migrations/0011_signals.sql`. **Next = `0012_<name>.sql`** (zero-padded 4-digit prefix + snake_case description, e.g. `0012_spark.sql`).
