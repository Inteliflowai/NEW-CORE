# V2 Assignments Surface — Grounding (Epic 2: non-SPARK Assignment Player)

Repo: `C:/users/inteliflow/NEW-CORE`. READ-ONLY verbatim facts captured from current code. No proposals, no critique. Quote-accurate identifiers, columns, enums, routes.

Files read in full for this fragment:
- `src/app/(student)/student/assignments/page.tsx`
- `src/app/(student)/student/assignments/[id]/page.tsx`
- `src/app/(student)/student/assignments/[id]/_components/SparkLaunchCard.tsx`
- `src/app/(student)/layout.tsx`
- `src/app/(student)/student/dashboard/page.tsx`
- `src/lib/spark/loadStudentAssignments.ts`
- `src/lib/auth/requireRole.ts`
- `src/app/api/attempts/spark-launch/route.ts`
- `src/app/(teacher)/students/[studentId]/_components/IdentityHeader.tsx`
- `src/app/(teacher)/students/[studentId]/_lib/priorityCta.ts`
- `src/app/api/teacher/assignments/generate/route.ts`
- `src/lib/engine/assignmentGen.ts`
- `src/lib/ai/models.ts`
- `supabase/migrations/0004_assignments_homework.sql`, `0010_engine_columns.sql`, `0012_spark.sql`
- `scripts/seedDemo.ts` (assignment-insert region)
- (cross-ref) `docs/superpowers/plans/grounding/2026-06-20-spark-phase2/P4-v2-assignment-attempt-model.md`

---

## 0. Headline facts (read first)

1. **The existing student assignments surface is SPARK-launch-only.** Both pages render only `content.title`, `content.instructions`, and — when the assignment is a Spark Challenge — a `SparkLaunchCard` whose button hits `POST /api/attempts/spark-launch`. There is **no in-app player** for a non-SPARK assignment today. Clicking a non-SPARK assignment row shows title + instructions and nothing else (no "start"/"play" affordance, no submit).

2. **The discriminator is `assignments.spark_status` (text), NOT a boolean `is_spark`.** A row is treated as a Spark Challenge when `spark_status !== 'none'`. Default is `'none'`. There is no other type/kind column on `assignments`. The non-SPARK player must branch on `spark_status === 'none'`.

3. **Where a non-SPARK player route slots in:** the detail route is `src/app/(student)/student/assignments/[id]/page.tsx`. A natural sibling is `src/app/(student)/student/assignments/[id]/play/page.tsx` (`/student/assignments/[id]/play`). The route group is `(student)`; its layout already applies the `requireRole(['student'])` guard.

4. **The quiz-runner (Epic 1) already shipped a full student runner under `src/app/(student)/student/quiz/`** — `QuizRunner.tsx`, `QuestionCard.tsx`, `QuizTimer.tsx`, `RecoveryBanner.tsx`, `ResultScreen.tsx`, plus `quiz/page.tsx`. (Note: the older P4 grounding doc says "no student player exists" — that is now STALE; the quiz runner exists. The Assignment Player is the next surface and should reuse quiz-runner plumbing.)

5. **`homework_attempts` table exists (legacy "assignment attempt" table) and is written ONLY by seed scripts** — no route reads or writes it. It carries the exact columns the Assignment Player needs (`responses`, `canvas_data`, `score_pct`, `ai_feedback`, `teli_hint_count`, `submitted_at`, `graded_at`). This is the likely persistence target for a non-SPARK player; nothing in production touches it yet.

6. **The teacher "Open Assignments" CTA is a deliberately-deferred no-op** (disabled button) because no teacher assignments view exists. See §7.

---

## 1. Student assignments LIST page — `src/app/(student)/student/assignments/page.tsx`

- Server Component, `async`. Auth: `const { userId } = await requireRole(['student']);` then `const admin = createAdminSupabaseClient();`.
- Data: `const rows = await loadStudentAssignments(admin, userId);`.
- Heading: `<h1>My Assignments</h1>` (`font-display text-2xl text-fg font-semibold`).
- Empty state: `<EmptyState variant="just-getting-started" titleOverride="No assignments yet" bodyOverride="New assignments from your teacher will show up here." />`.
- Each row is a `<Link href={`/student/assignments/${r.id}`}>` showing `{r.title}` and, when `r.sparkStatus !== 'none'`, a `<span className="text-brand text-xs font-bold">Spark Challenge</span>` badge.
- Token-only styling: `border-surface bg-surface px-4 py-3`, `text-fg`, `text-brand`. No scores/bands/risk shown (four-audience comment at top of file).

### Loader — `src/lib/spark/loadStudentAssignments.ts`
```ts
export interface StudentAssignmentRow { id: string; title: string; sparkStatus: string; }

export async function loadStudentAssignments(admin, studentId): Promise<StudentAssignmentRow[]> {
  const { data } = await admin
    .from('assignments')
    .select('id, content, spark_status')
    .eq('student_id', studentId)         // ownership guard = student_id filter on admin client
    .order('created_at', { ascending: false })
    .limit(200);
  // maps → { id, title: content?.title ?? 'Assignment', sparkStatus: spark_status ?? 'none' }
}
```
- Selects only `id, content, spark_status`. **Does NOT select `status`, `due_at`, `mastery_band`, or any attempt/score column.** Title comes from `content.title` (jsonb), fallback `'Assignment'`. No scores/bands returned (four-audience comment).

---

## 2. Student assignment DETAIL page — `src/app/(student)/student/assignments/[id]/page.tsx`

- Server Component. Next-16 async params: `{ params }: { params: Promise<{ id: string }> }`, `const { id } = await params;`.
- Auth: `const { userId } = await requireRole(['student']);`, then `const admin = createAdminSupabaseClient();`.
- Loads the row:
```ts
const { data: row } = await admin
  .from('assignments')
  .select('id, student_id, content, spark_status')
  .eq('id', id)
  .maybeSingle();
```
- **IDOR / existence guard:** `if (!row || row.student_id !== userId)` → renders the SAME `EmptyState` (`titleOverride="Assignment not found"`, `bodyOverride="Head back to your assignments list."`). Deliberately does not leak existence (own comment: "Missing row OR ownership mismatch → same EmptyState").
- Renders: `content.title ?? 'Assignment'` as `<h1>`; `content.instructions` as a `<p>` (only if present).
- `const sparkStatus = (row.spark_status as string) ?? 'none';`
- **Branch:** `{sparkStatus !== 'none' && (<SparkLaunchCard assignmentId={row.id} sparkStatus={sparkStatus} />)}`. There is NO `else` branch — a `spark_status === 'none'` assignment renders only title + instructions (no player, no start button). **This is exactly the gap the Assignment Player fills.**
- `content` is typed inline as `{ title?: string; instructions?: string }` — the page reads only those two fields out of the jsonb.

---

## 3. SparkLaunchCard — `src/app/(student)/student/assignments/[id]/_components/SparkLaunchCard.tsx`

`'use client'`. Props: `{ assignmentId: string; sparkStatus: string }`.

Soft status copy (no scores/bands — four-audience):
```ts
const STATUS_TEXT: Record<string, string> = {
  none: '',
  notified: 'Your Spark Challenge is getting ready…',
  created: 'Your Spark Challenge is ready.',
  in_progress: 'You started this challenge — pick up where you left off.',
  completed: 'Challenge complete. Nice work!',
};
```
- `const completed = sparkStatus === 'completed';` — hides the launch button when completed.
- Button (`!completed`) does `fetch('/api/attempts/spark-launch', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ assignment_id: assignmentId }) })`.
- On `res.ok && json.launch_url` → `window.open(json.launch_url, '_blank')`; else sets error `json.error ?? 'Could not open the challenge.'`.
- Loading label `'Opening…'`, button label `'Launch Challenge'`. Error rendered in `text-risk-fg`.
- Styling token-only: `bg-brand text-fg-on-brand`, `border-surface`, `disabled:opacity-60`.

---

## 4. SPARK launch route (the only attempts route the student UI calls today) — `src/app/api/attempts/spark-launch/route.ts`

This is NOT a player; it is a JWT handoff to the external SPARK app. Documented for contrast — the non-SPARK player will be a different mechanism (in-app, persisting to CORE tables).

- `POST(req)`: `createServerSupabaseClient()` → `auth.getUser()` → 401 if no user.
- Body: `{ assignment_id?: string }`. 400 on malformed JSON / missing `assignment_id`. 500 if `!CORE_SPARK_API_SECRET`.
- Admin fetch: `.from('assignments').select('id, student_id, spark_attempt_id').eq('id', assignmentId).maybeSingle()`. 404 if not found; **403 if `assignment.student_id !== user.id`** (object-level IDOR guard); 400 if no `spark_attempt_id`.
- Loads `users (id, full_name, email, school_id)`; 404/400 if missing user / no `school_id`.
- Grade resolved from active enrollment: `.from('enrollments').select('class:classes(grade_level)').eq('student_id', user.id).eq('is_active', true).limit(1).maybeSingle()` — graceful if absent.
- Builds `returnUrl = `${origin}/student/assignments/${assignment.id}``, then `signLaunchJwt({ core_user_id, core_school_id, spark_attempt_id, email?, full_name?, grade, return_url })`.
- `redirectPath = `/student/experiment/${assignment.spark_attempt_id}`` (a SPARK route); `launch_url = `${SPARK_API_URL}/api/integration/auth?token=${token}&redirect=${encodeURIComponent(redirectPath)}``. Returns `{ launch_url }`.
- Model/config: `SPARK_API_URL`, `CORE_SPARK_API_SECRET` from `@/lib/spark/config`; `signLaunchJwt` from `@/lib/spark/signLaunchJwt`.

---

## 5. Student layout & auth guard chain — `src/app/(student)/layout.tsx`

```ts
export default async function StudentLayout({ children }) {
  await requireRole(['student']);            // ← the guard
  const nav = (<>
    <a href="/student/dashboard">Dashboard</a>
    <a href="/student/assignments">Assignments</a>
    <a href="/student/growth">Growth</a>
  </>);
  return <RoleLayout role="student" nav={nav}>{children}</RoleLayout>;
}
```
- `RoleLayout` (from `@/components/core/RoleLayout`) is invoked `role="student"`; the file comment says it sets `data-role="student"` + `data-intensity="loud"`. The root `src/app/layout.tsx` owns `<html>/<body>`; this nests inside it.
- Nav links: `/student/dashboard`, `/student/assignments`, `/student/growth`. Nav `<a>` styling uses raw CSS-var classes `text-[var(--fg)] hover:text-[var(--brand)]` (note: arbitrary `[var(--..)]` here, inside the layout nav).

### `requireRole` — `src/lib/auth/requireRole.ts` (the full guard chain)
Returns `AuthedContext { userId, role, schoolId, fullName }`. Chain (redirects throw `NEXT_REDIRECT`):
1. `const supabase = await createServerSupabaseClient();`
2. `const { data: { user } } = await supabase.auth.getUser();` → `if (!user) redirect('/login?expired=true');`
3. `.from('users').select('role, school_id, full_name').eq('id', user.id).single()` → `if (!role) redirect('/login');`
4. **Trial-expiry gate:** if `schoolId`, fetch `.from('schools').select('trial_status').eq('id', schoolId).single()`; `if (school?.trial_status === 'expired') redirect('/trial-expired');`
5. **Role allow-list:** `if (!allowed.includes(role)) redirect(homeForRole(role));`
6. returns the context.

This guard runs in BOTH the `(student)` layout AND inside each page (pages also call `requireRole(['student'])` directly — defense in depth). A new `/play` page should likewise call `requireRole(['student'])` and re-verify `student_id === userId` (the layout guard alone does not check object ownership).

NOTE on IDOR: per CLAUDE.md, `createAdminSupabaseClient()` **bypasses RLS** — RLS is NOT the IDOR backstop. The detail page enforces ownership manually via `row.student_id !== userId`; the spark-launch route via `assignment.student_id !== user.id`. The player must do the same.

---

## 6. Student dashboard — `src/app/(student)/student/dashboard/page.tsx`

10-line placeholder. Renders a card: `<h1>Your CORE space is being set up</h1>` + `<p>Check back soon — your learning view is on the way.</p>`. No data loading, not `async`, no `requireRole` call inside it (relies on layout guard). Not relevant to the player except as the student home target of `homeForRole('student')`.

---

## 7. The deferred "Open Assignments" CTA (the prior 404 fix)

Two places render an "Open Assignments" affordance; BOTH are intentionally inert because no teacher assignments view exists.

### a) `IdentityHeader.tsx` (teacher student drill-in) — `src/app/(teacher)/students/[studentId]/_components/IdentityHeader.tsx`
- Top-of-file comment: *"Writes are DEFERRED: High Five / Add note / Open Assignments are rendered disabled-looking (no-op) — there is no teacher assignments route yet, so a live link would 404."*
- The three buttons (`High Five`, `Add note`, `Open Assignments ›`) are `<button disabled aria-disabled="true" title="Coming soon" className="… text-fg-muted opacity-50">`. Inline comment: *"The teacher assignments view isn't built yet, so 'Open Assignments' is disabled rather than a dead link that 404s."*

### b) `priorityCta.ts` (whole-child rail recommendation) — `src/app/(teacher)/students/[studentId]/_lib/priorityCta.ts`
- `PriorityCtaKind = 'review-risk' | 'flag-reteach' | 'leave-note' | 'open-assignments'`.
- Precedence (first match wins): (1) roster risk high/critical → "Review what's going on"; (2) a top `Reinforce` skill → "Flag {skill} for reteach"; (3) divergence flagged → "Leave a note"; (4) else → `{ kind: 'open-assignments', label: 'Open Assignments' }`.
- File comment: *"The recommendation is text + an optional anchor/href. The WRITE is deferred — the page renders it as a suggestion, it does not perform a mutation."* The `open-assignments` fallback has **no `anchor`/`href`** (rendered as text only).
- Tests assert the fallback: `priorityCta.test.ts` ("4. falls back to Open Assignments"); `page.test.tsx` ("falls back to Open Assignments CTA when nothing is flagged"); `WholeChildRail.test.tsx` references `{ kind: 'open-assignments', label: 'Open Assignments' }`.

**These are TEACHER-side dead CTAs**, distinct from the student player. Building a teacher assignments view (and possibly wiring these CTAs) is out of scope for the student Assignment Player but is the eventual destination of these deferrals.

---

## 8. `assignments` table — full schema (verbatim from migrations)

### Base — `supabase/migrations/0004_assignments_homework.sql:4-22`
```sql
CREATE TABLE IF NOT EXISTS public.assignments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_attempt_id         uuid REFERENCES public.quiz_attempts(id),
  student_id              uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  class_id                uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  lesson_id               uuid REFERENCES public.lessons(id) ON DELETE CASCADE,
  mastery_band            text CHECK (mastery_band IN ('reteach','grade_level','advanced')),
  assignment_mode         text DEFAULT 'standard',
  learning_style          text,
  content                 jsonb NOT NULL,
  status                  text DEFAULT 'draft',         -- no CHECK; seed writes 'published', generate route writes 'draft'
  teacher_reviewed        boolean DEFAULT false,
  teacher_override_reason text,
  push_status             text DEFAULT 'pending',        -- no CHECK; not written by any located code
  reteach_needed          boolean DEFAULT false,
  scaffold_level          text,
  due_at                  timestamptz,
  created_at              timestamptz DEFAULT now()
);
```
Added later:
- `skill_ids uuid[] NOT NULL DEFAULT '{}'` — `0005_skills.sql:44-45`
- `generation_model text` — `0010_engine_columns.sql:71-72`
- SPARK binding cols — `0012_spark.sql:8-12`:
  - `spark_assignment_id text` — CORE-generated correlation id sent to SPARK
  - `spark_attempt_id text` — SPARK's returned spark_attempt_id
  - `spark_experiment_id text` — SPARK's returned synthetic_experiment_id
  - `spark_status text DEFAULT 'none'`
- CHECK: `assignments_spark_status_check` → `spark_status IN ('none','notified','created','in_progress','completed','notify_failed')` (`0012:14-21`).

### RLS — `0004:46-50`
`assignments_scoped_read` (SELECT, authenticated): `student_id = auth.uid() OR class_id IN (SELECT public.get_teacher_class_ids(auth.uid())) OR public.is_platform_admin()`. So a student CAN read their own assignment under RLS. `GRANT ALL ON public.assignments TO authenticated, anon, service_role;`. **No student INSERT/UPDATE policy on `assignments`** (assignments are teacher-generated).

### Discriminator semantics (the key fact for the player)
- **No `is_spark` boolean and no `assignment_type` column exists.** The ONLY spark/non-spark discriminator is `spark_status` (`'none'` = normal CORE assignment; anything else = Spark Challenge). The detail page and list both branch on `spark_status !== 'none'`.
- `status` (`'draft'`/`'published'`) and `push_status` (`'pending'`) are NOT used as a player/lifecycle discriminator. `status` is only ever written `'draft'` (generate route) or `'published'` (seed). No `'pushed'` value used anywhere.

---

## 9. `homework_attempts` table — the legacy player persistence target (currently UNUSED by routes)

`supabase/migrations/0004_assignments_homework.sql:24-40`:
```sql
CREATE TABLE IF NOT EXISTS public.homework_attempts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id     uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  student_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status            text DEFAULT 'in_progress',
  responses         jsonb,
  canvas_data       jsonb,
  score_pct         numeric,
  ai_feedback       jsonb,
  teacher_notes     text,
  teacher_score     numeric,
  teli_hint_count   int DEFAULT 0,
  submitted_on_time boolean,
  submitted_at      timestamptz,
  graded_at         timestamptz,
  created_at        timestamptz DEFAULT now()
);
```
- Columns map 1:1 to the Assignment Player's needs: `responses` (jsonb answers), `canvas_data` (drawing canvas), `score_pct` + `ai_feedback` (graded submit), `teli_hint_count` (the hint-ladder counter), `submitted_at`/`graded_at`, `submitted_on_time`.
- RLS — `0004:52-57`: `homework_attempts_owner_read` (SELECT) — `student_id = auth.uid() OR assignment_id IN (teacher's classes) OR is_platform_admin()`. `GRANT ALL … TO authenticated, anon, service_role`. **No student INSERT/UPDATE policy** (only SELECT for owner) — a player that writes via the admin client bypasses RLS anyway; a player that writes under the student session would need an INSERT/UPDATE policy added.
- **Referenced ONLY by seed code** (`scripts/seedDemo.ts`, `src/lib/trial/seedTrialDemoData.ts`); no API route reads/writes it. The grader chain in production grades via `quiz_attempts`/`quiz_responses`, not `homework_attempts`.

---

## 10. Assignment `content` jsonb shape — schema vs what seed actually writes

### Engine-generated shape (`AssignmentSchema`, `src/lib/engine/types.ts:139-157`, per P4 grounding)
Rich differentiated lesson, NOT a question set:
```
AssignmentTask = { step:int, description:string,
  type:'read'|'write'|'draw'|'discuss'|'create'|'analyze',
  strategy:string, atl_skill:string, ib_attribute:string, bloom_level:string }
AssignmentSchema = {
  title, mode, learning_style,
  reading_passage (min 1), audio_script (min 1),
  diagram_mode:'image'|'structured'|'none',
  diagram_description|null, diagram_svg_prompt|null, diagram_image_prompt|null,
  youtube_search_query, instructions,
  tasks: AssignmentTask[] (min 2),
  support_note?, extension_prompt?, atl_summary:string[]=[], ib_attributes:string[]=[]
}
```
- Produced by `generateAssignment()` in `src/lib/engine/assignmentGen.ts` (Claude `CLAUDE_GEN_MODEL` primary temp 0.7 → GPT `OPENAI_GEN_MODEL` fallback; throws `LlmExhaustedError` on exhaustion, never fabricates).
- Persisted by `POST /api/teacher/assignments/generate` (`route.ts:160-174`) into `content`, with `status:'draft'`, `generation_model:OPENAI_GEN_MODEL`, plus `quiz_attempt_id, student_id, class_id, lesson_id, mastery_band, learning_style` (normalized via `normalizeLearningStyle` at the write boundary).
- **The detail page only reads `content.title` and `content.instructions`** — it ignores `reading_passage`, `audio_script`, `tasks`, `diagram_*`, etc. The Assignment Player is what would render the rich body.

### Seed shape (DIFFERENT, smaller) — `scripts/seedDemo.ts:471-477`
The demo seed writes a leaner `content`: `{ bandLabel: band, instructions: …, tasks: assignment.content.tasks }`, with `status:'published'`. So seeded demo assignments have `content.tasks` and `content.instructions` but NOT the full `AssignmentSchema` (no `reading_passage`/`audio_script`/`title` set the same way — `content.title` may be absent on seed rows, hence list fallback `'Assignment'`). The player must tolerate both shapes / missing fields.

---

## 11. Existing quiz-runner plumbing to REUSE (Epic 1, already shipped)

`src/app/(student)/student/quiz/` contains a working student runner the Assignment Player should mirror:
- `quiz/page.tsx`, `_components/QuizRunner.tsx`, `QuestionCard.tsx`, `QuizTimer.tsx`, `RecoveryBanner.tsx`, `ResultScreen.tsx` (+ tests, incl. `QuizRunner.leak.test.tsx` enforcing four-audience leak-guard).
- The grade/adapt backend already exists: `POST /api/attempts/[attemptId]/submit` (383-line grader; positions 1-3 deterministic, 4-5 OEQ via `gradeOpenResponse`; writes `score_pct`, `mastery_band`, fires `recomputeSkillStatesForStudent` + `recordMisconceptions`) and `POST /api/attempts/[attemptId]/adapt`. These operate on the `quiz_attempts`/`quiz_responses` chain, not `homework_attempts`.

---

## 12. Model / AI registry (for Teli tutor, hints, TTS) — `src/lib/ai/models.ts`

- `CLAUDE_GRADING_MODEL` = env `ANTHROPIC_GRADING_MODEL` || `'claude-sonnet-4-6'` (calibration-locked grader).
- `CLAUDE_GEN_MODEL` = env `ANTHROPIC_GEN_MODEL` || `'claude-sonnet-4-6'` (assignment generation).
- `OPENAI_GEN_MODEL` = env `OPENAI_GEN_MODEL` || `'gpt-4o'` (frozen, calibration-sensitive).
- **`OPENAI_VOICE_MODEL` = env `OPENAI_VOICE_MODEL` || `'gpt-4o'`** — comment: *"OpenAI model for non-graded voice/tone surfaces (Teli chat, tutor/hint, etc.). PILOT LEVER."* This is the registered model for the Teli tutor + hint ladder the player needs.
- `MODELS = { grading, claude_generation, generation, voice }`. `PROMPT_VERSION='1.0.0'`, `MODEL_VERSION=`${CLAUDE_GRADING_MODEL}+${OPENAI_GEN_MODEL}``.
- `usesLegacyTokenParam(model)` / `tokenLimitParams(model, n)` helpers for `max_tokens` vs `max_completion_tokens`.
- **NOTE:** no Teli-tutor, hint-ladder, TTS, autosave, or canvas route/lib was found in this grounding pass (out of the assigned read set). The model registry has a `voice` slot reserved but no tutor endpoint located here — those are net-new for Epic 2 (V1 `student/homework` ~1557 lines is the reference per CLAUDE.md).

---

## 13. Where the player route slots in — summary for the spec author

- **Route group:** `(student)` — guard `requireRole(['student'])` applied by layout; pages also re-call it. `RoleLayout role="student"` wraps content.
- **Detail page branch point:** `src/app/(student)/student/assignments/[id]/page.tsx` currently has `if (sparkStatus !== 'none') <SparkLaunchCard/>` and NO else. The non-SPARK branch (`spark_status === 'none'`) is where a "Start" CTA / link to the player goes.
- **Suggested player path:** `src/app/(student)/student/assignments/[id]/play/page.tsx` → `/student/assignments/[id]/play` (sibling of the detail route; mirrors the `quiz/` runner pattern). The spec must decide this.
- **Persistence:** `homework_attempts` (assignment-scoped, currently route-unused) carries `responses`, `canvas_data`, `score_pct`, `ai_feedback`, `teli_hint_count`, `submitted_at`, `graded_at`, `submitted_on_time`, `status DEFAULT 'in_progress'`. No create/save/submit route exists yet — all net-new.
- **Ownership guard pattern to copy:** `row.student_id !== userId` → return the existence-hiding `EmptyState` (detail page) or 403 (spark-launch route). Admin client bypasses RLS, so the object guard is mandatory.
- **Four-audience discipline (enforced on every student string):** no scores, rubric dims, mastery band enums, CL verbs, divergence, misconceptions, or raw risk numbers in any student-facing copy. The list/detail pages and `SparkLaunchCard` all carry this rule in their header comments; the player inherits it (see `QuizRunner.leak.test.tsx` for the established test pattern).

---

## Open questions for the spec to resolve
1. Player route shape: `assignments/[id]/play` vs an inline mode on the detail page vs a dedicated `/student/play/[id]`. (Not decided in code.)
2. Persistence: confirm `homework_attempts` is the target (it is route-unused and column-complete) vs reusing the `quiz_attempts`/`quiz_responses` chain the existing grader already drives. The grader (`submit`/`adapt`) operates on the quiz chain, NOT `homework_attempts` — so a non-SPARK assignment-grade path is currently UNBUILT.
3. No student INSERT/UPDATE RLS policy exists on `homework_attempts` (only owner SELECT) — a player writing under the student session would need a policy; writing via admin client sidesteps RLS but then needs the manual object guard.
4. Teli tutor / 3-step hint ladder (nudge→cue→step→blocked) / drawing canvas / TTS / autosave: NONE located in V2 code in this pass. `OPENAI_VOICE_MODEL` is the reserved model slot; everything else is net-new and should be ground from V1 `student/homework` (~1557 lines, `C:/users/inteliflow/core`).
5. `content` jsonb has two live shapes (full `AssignmentSchema` from the generate route vs the lean seed shape) — the player must render defensively against missing `reading_passage`/`audio_script`/`title`/`tasks`.
6. Should clicking a non-SPARK assignment in the LIST go straight to the player, or to the detail page first (which then offers a Start CTA)? Current list links to the detail page for all rows.
