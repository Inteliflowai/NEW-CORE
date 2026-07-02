# SPARK-platform grounding: student challenge attempt review data (verbatim current-code facts)

Repo: `C:/users/inteliflow/spark-platform` (Next.js App Router at repo root). All paths below are repo-relative.

---

## 1. The student experiment pages

### 1a. Runner: `app/(dashboard)/student/experiment/[sessionId]/page.tsx`
Client component (`"use client"`, line 1). The URL slot accepts **either** an attempt id or a session id:

- Lines 142–148:
```ts
        // URL slot accepts EITHER attempt_id (CORE launch flow, via the
        // /api/integration/auth pre-auth handoff) OR session_id (in-app nav from
        // /student dashboard). Both resolve to the same attempt — the calling
        // student only ever has one attempt per session.
        const match = (all as AttemptRow[]).find(
          (a) => a.id === sessionId || a.session?.id === sessionId
        );
```
- Data load (line 125): `const res = await fetch("/api/experiments/attempts/my");` — no dedicated per-attempt detail endpoint is used by the runner.
- Generated content load (line 248): `fetch(`/api/experiments/attempts/${attempt.id}/content`)` — returns `generation_status`, `generated_content` (8-section template), `student_profile_snapshot` (lines 250–262).
- Draft hydrate/persist: `GET`/`PUT`/`DELETE /api/experiments/attempts/[id]/draft` (lines 337, 372, 653). Draft shape (lines 367–371): `{ responses, currentStepIndex, extensionResponse }`.
- Renders: `StepRenderer`, `TeliPanel`, `EvidenceCapture`, `PostSubmission`, `SparkAcronymProgress`, `MasteryShortcutBanner`/`ExtensionStep` (imports lines 5–21).
- Phase machine (line 25): `type RunnerPhase = "running" | "review" | "submitted" | "extension";`

### 1b. Read-only revisit: `app/(dashboard)/student/lab/artifact/[attemptId]/page.tsx`
This is the **existing read-only render of a completed attempt** — but it is student-self-scoped only.

- Lines 3–7:
```ts
// Wave 3b Stage 3b.2 — Your Lab artifact detail route.
//
// Read-only view of a single completed experiment. Reuses PostSubmission
// with readOnly=true so every student sees the same submission view they
// saw at submit time (consistency of presentation).
```
- Loads via the same self-scoped list endpoint (lines 75, 83): fetches `/api/experiments/attempts/my` and filters `all.find((a) => a.id === attemptId)`.
- Shape it consumes (lines 25–38): `AttemptSummary { id, score, effort_label, completed_at, evidence, session: { experiment: { title, grade, subject_domain } } }`.
- Render (lines 147–153): `<PostSubmission attemptId={attemptId} gradeBand={gradeBand} experimentTitle={...} signalSummary={signalSummary} readOnly />` where `signalSummary = (attempt.evidence as {signal_summary?...})?.signal_summary || {}` (lines 142–143).

### 1c. `components/experiment/PostSubmission.tsx` (577 lines)
What it renders per attempt (the analysis, NOT per-step responses):
- `AnalysisResult` interface (lines 35–43): `overall_score`, `dimension_scores: Record<string, number>`, `effort_label`, `key_observations[]`, optional `celebration_trigger`/`celebration_magnitude`.
- readOnly mode fetch (lines 126–131): `const url = \`/api/experiments/attempts/${attemptId}/${readOnly ? "analysis" : "analyze"}\`;` — readOnly does `GET /analysis` (persisted, no paid re-score), live does `POST /analyze`.
- 9-12 view renders score /100, friendly effort label, per-dimension 0–100 bars, key observations (lines 346–459). Friendly label maps at lines 11–33 (`EFFORT_LABEL_FRIENDLY`, `DIMENSION_LABEL_FRIENDLY`).
- Note lines 420–425: student-side "Signal Data section removed 2026-05-05 … The data still flows to CORE via the analyze webhook for teacher-side diagnostics; just doesn't render student-side."

### 1d. The student's actual answers (per-step responses)
Per-step responses are shown only on the pre-submit review screen, `components/experiment/EvidenceCapture.tsx`:
- Evidence compile (lines 35–44):
```ts
      const evidence = {
        step_responses: Object.entries(responses).map(([idx, resp]) => ({
          step_index: Number(idx),
          type: resp.type,
          value: resp.value,
          completed: resp.completed,
        })),
        signal_summary: signalSummary,
        submitted_at: new Date().toISOString(),
      };
```
posted to `POST /api/experiments/attempts/${attemptId}/submit` (line 46). This whole object is persisted verbatim to `experiment_attempts.evidence` (submit route, below). `StepResponse` shape: `components/experiment/StepRenderer.tsx:68-73` — `{ step_index: number; type: StepType; value: unknown; completed: boolean }`.
- The read-only artifact page does **not** re-render `step_responses`; it only passes `evidence.signal_summary` into PostSubmission. So the raw per-step answers exist in the DB (`evidence.step_responses`) but no existing page renders them post-submit.

### 1e. Teli tutor transcript — NOT persisted
`app/api/experiments/attempts/teli/route.ts:94-99`:
```ts
    // Wave 1 Stage 1.3 tone audit — tutor-not-teacher framing.
    // The student is the main character; Teli is on their side. Privacy promise
    // (G1, honest): conversations aren't stored; teachers see that Teli was
    // used, but not what was said. This promise is surfaced visibly to the
    // student via the Privacy Badge in TeliPanel.tsx — the backend must hold
    // the line and never persist message content.
```
Conversation history is client-supplied per request (line 156) and the route only returns the reply — no DB write of message content anywhere in the route. Only the **count** survives (`experiment_attempts.teli_hint_count`, set at submit from `evidence.signal_summary?.help_requests` — submit route line 42).

---

## 2. DB schema (supabase/migrations)

### `experiment_sessions` — `001_initial_schema.sql:72-89`
```sql
CREATE TABLE experiment_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiments(id),
  school_id uuid NOT NULL REFERENCES spark_schools(id),
  core_class_id uuid,
  teacher_id uuid NOT NULL REFERENCES spark_users(id),
  mode text NOT NULL,
  hardware_connector_slug text,
  grouping_mode text NOT NULL DEFAULT 'individual' CHECK (grouping_mode IN ('individual','pairs','teams')),
  intervention_policy text NOT NULL DEFAULT 'normal' CHECK (intervention_policy IN ('minimal','normal','high-support')),
  language text DEFAULT 'en',
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','active','paused','completed','cancelled')),
  safety_acknowledged boolean DEFAULT false,
  launched_at timestamptz,
  completed_at timestamptz,
  settings jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
```

### `experiment_attempts` — `001_initial_schema.sql:91-108`
```sql
CREATE TABLE experiment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES experiment_sessions(id),
  student_id uuid NOT NULL REFERENCES spark_users(id),
  team_id uuid,
  core_homework_id uuid,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  state text NOT NULL DEFAULT 'not_started' CHECK (state IN ('not_started','in_progress','paused','completed','timed_out','teacher_closed')),
  evidence jsonb DEFAULT '{}',
  score numeric CHECK (score BETWEEN 0 AND 100),
  effort_label text CHECK (effort_label IN ('effortful_success','struggling_trying','independent_success','independent_struggle')),
  revision_count integer DEFAULT 0,
  teli_hint_count integer DEFAULT 0,
  submitted_on_time boolean,
  hours_to_submit numeric,
  created_at timestamptz DEFAULT now()
);
```
Later additions:
- `030_experiment_attempt_draft_state.sql:34-36`: `ADD COLUMN IF NOT EXISTS draft_state jsonb, ADD COLUMN IF NOT EXISTS last_active_at timestamptz;` (+ partial index lines 40–42).
- `035_attempts_core_homework_unique.sql:39-41`:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_attempts_core_homework_student
  ON public.experiment_attempts (core_homework_id, student_id)
  WHERE core_homework_id IS NOT NULL;
```

### Signals + AI analysis — `001_initial_schema.sql:114-137`
```sql
CREATE TABLE spark_behavioral_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES experiment_attempts(id),
  signal_type text NOT NULL,
  value jsonb NOT NULL,
  captured_at timestamptz DEFAULT now()
);

CREATE TABLE spark_cognitive_signals ( ... same shape ... );

CREATE TABLE spark_ai_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES experiment_attempts(id),
  analysis_type text NOT NULL,
  result jsonb NOT NULL,
  model text DEFAULT 'gpt-4o',
  generated_at timestamptz DEFAULT now()
);
```
Signals are written by `POST /api/experiments/attempts/signals` (`app/api/experiments/attempts/signals/route.ts`), self-scoped via `requireAttemptOwner`, split by `category` (`behavioral`/`cognitive`/`hardware` → `hw_` prefix into behavioral).

### `experiment_attempt_content` (per-attempt generated challenge content) — `025_experiment_attempt_content.sql:34-92`
Key columns: `attempt_id UUID NOT NULL UNIQUE REFERENCES experiment_attempts(id) ON DELETE CASCADE` (lines 39–40), `template_id`, `generated_content JSONB` (the 8-section locked template — lines 48–57: `{ scenario, challenge_question, role_assignment, input_materials: { reteach, grade_level, advanced }, strategy_layer: {...}, output_options[], teli_support_prompts[], reflection_questions[] }`), fingerprints, `generation_status` CHECK `('pending','generating','ready','failed','fallback_barb_original')` (lines 66–73), cost/model/prompt provenance, `is_fallback`. Plus `031_student_profile_snapshot.sql:25-26`: `ADD COLUMN IF NOT EXISTS student_profile_snapshot JSONB` (comment lines 28–29: `{ mastery_band, dominant_learning_style, grade, rubric_rolling_averages, learning_pattern_flags, iep_accommodations }`), and `037_cache_school_scope.sql:15-16` adds `school_id uuid`.
RLS (`025:125-128`):
```sql
ALTER TABLE experiment_attempt_content ENABLE ROW LEVEL SECURITY;
-- (No SELECT/INSERT/UPDATE/DELETE policies — service-role-only by default.)
GRANT ALL ON experiment_attempt_content TO authenticated, service_role;
```

### CORE-link tables — `001_initial_schema.sql:238-258`
```sql
CREATE TABLE core_spark_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  core_school_id uuid UNIQUE NOT NULL,
  spark_school_id uuid NOT NULL REFERENCES spark_schools(id),
  enabled boolean DEFAULT true,
  sync_settings jsonb DEFAULT '{}',
  api_key text NOT NULL DEFAULT gen_random_uuid()::text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE core_experiment_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  core_homework_id uuid UNIQUE NOT NULL,
  experiment_id uuid NOT NULL REFERENCES experiments(id),
  student_id uuid NOT NULL REFERENCES spark_users(id),
  core_class_id uuid,
  spark_attempt_id uuid REFERENCES experiment_attempts(id),
  due_date timestamptz,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','in_progress','completed','late')),
  assigned_at timestamptz DEFAULT now()
);
```
`003_fix_core_assignment_constraint.sql:5-10` replaces the lone unique with composite `UNIQUE (core_homework_id, student_id)`. Migration `035_core_spark_links_core_base_url.sql` adds `core_base_url` (referenced by `resolveCoreBaseUrl`, `lib/integration/core-client.ts:15-26`).

### RLS on attempts — current policy is `036_rls_tenant_isolation_fix.sql:43-61` (supersedes 001:325-327)
```sql
drop policy if exists attempts_access on public.experiment_attempts;
create policy attempts_access on public.experiment_attempts
  for all
  using (
    student_id = public.get_my_spark_user_id()
    or public.get_my_spark_role() = 'platform_admin'
    or (
      public.get_my_spark_role() = any (array['teacher','admin','sysadmin','school_sysadmin'])
      and public.spark_student_in_my_school(student_id)
    )
  )
  with check ( ... identical ... );
```
So at RLS level, a same-school `teacher` CAN read attempts — but in practice all app endpoints use the service-role admin client (`020_rls_hardening.sql:2-4`: "SPARK's app endpoints already use the service role admin client (which bypasses RLS)"), and every attempt API route is student-self-scoped (see §3). `spark_ai_analysis` has a school-scoped SELECT policy (`020:20-29`); `spark_system_events` is locked to service role (`020:36`).

### `spark_users` (student identity) — `001:19-31` + `015_student_learning_profile.sql:4-7`
`spark_users`: `id`, `auth_id uuid UNIQUE NOT NULL`, `school_id → spark_schools(id)`, **`core_user_id uuid`**, `email`, `full_name`, `role`, `grade`, plus (015) `learning_style`, `comprehension_level`, `learning_profile_source ('core'|'inferred'|'none')`, `signal_profile jsonb`.
Role value space after `027_retire_school_admin_role.sql`:
```sql
ALTER TABLE spark_users ADD CONSTRAINT spark_users_role_check
  CHECK (role IN ('student', 'teacher', 'school_sysadmin', 'platform_admin'));
```

---

## 3. How an attempt is identified and linked

- **Id shape:** `experiment_attempts.id` is `uuid PRIMARY KEY DEFAULT gen_random_uuid()` (`001:92`).
- **Student:** `experiment_attempts.student_id → spark_users.id`; the CORE user id lives at `spark_users.core_user_id` (`001:23`). Webhook upserts students by `core_user_id` (`app/api/integration/webhooks/core/route.ts:654-658`: `.eq("core_user_id", args.core_user_id)`).
- **School:** via `session_id → experiment_sessions.school_id → spark_schools.id`; `spark_schools.school_id uuid UNIQUE NOT NULL` (`001:10`) and school linkage to CORE is `core_spark_links (core_school_id UNIQUE → spark_school_id)`.
- **Originating CORE assignment:** `experiment_attempts.core_homework_id uuid` (`001:96`) = "CORE assignments.id — same across multiple students for the same homework" (`webhooks/core/route.ts:51-52`). Also mapped in `core_experiment_assignments (core_homework_id, student_id) UNIQUE` with `spark_attempt_id` back-pointer, upserted at `webhooks/core/route.ts:461-474` with `onConflict: "core_homework_id,student_id"`.
- **Lesson ids:** SPARK has **no CORE lesson_id column**. The webhook receives `lesson_plan` free-text payload-direct (`webhooks/core/route.ts:59-67`) and pins a synthetic experiment row per homework: `const syntheticId = \`core-assignment-${args.core_homework_id}\`;` (`webhooks/core/route.ts:706`), `title: \`[CORE] ${titleFromLesson}\``, `source: "core_assignment_synthetic"` (lines 728, 741).
- **Attempt creation:** webhook inserts `{ session_id, student_id, core_homework_id, state: "not_started" }` (`webhooks/core/route.ts:402-409`); 23505 race reuses the winner (lines 413–444). Webhook response returns `spark_attempt_id`, `session_id`, `spark_user_id`, `synthetic_experiment_id`, `generation_status` (lines 561–569).
- **Student launch auth:** `GET /api/integration/auth` verifies a CORE-issued HS256 JWT (`lib/integration/core-client.ts:187-292`, payload `{ core_user_id, core_school_id, spark_attempt_id?, return_url?, exp, iat, iss }`, lines 171–185) and creates/signs in the user with hardcoded `role: "student"` (`app/api/integration/auth/route.ts:150`). There is **no teacher-facing attempt page or teacher launch path**; middleware guards `/dashboard` pages only, "not /api/*" (`lib/auth/attemptOwnership.ts:9-11`).
- **Every attempt API route is owner-scoped:** `requireAttemptOwner` (`lib/auth/attemptOwnership.ts:22-58`) returns 403 unless `attempt.student_id === sparkUser.id`; used by submit/analyze/teli/signals/draft; `[id]/content` and `[id]/analysis` do the same check inline (`content/route.ts:58-60`, `analysis/route.ts:53-55`).

---

## 4. Completion webhook to CORE (the `spark_completions` source)

Sender: `notifyCoreAttemptComplete` in `lib/integration/core-client.ts:98-165`. Endpoint (line 129): `POST ${base}/api/attempts/spark-attempt-complete` with headers `Authorization: Bearer ${CORE_SPARK_API_SECRET}` and `X-Idempotency-Key` (lines 131–135); base URL resolves per school from `core_spark_links.core_base_url` else `CORE_API_URL || "https://app.inteliflowai.com"` (lines 7–26); 3 retries `[1000, 5000, 15000]` on 5xx only (lines 95–96, 145).

Payload interface, verbatim (`core-client.ts:64-93`):
```ts
export interface AttemptCompletePayload {
  core_homework_id: string;
  // CORE's user.id (NOT SPARK's sparkUserId). ...
  student_id: string;
  completed_at: string;
  score: number | null;
  effort_label: string | null;
  revision_count: number;
  teli_hint_count: number;
  signal_summary: Record<string, unknown>;
  rubric_dimensions: RubricDimensions | null;
  content_quality: ContentQuality | null;
  bncc_codes?: string[];
  bncc_competencias_gerais?: number[];
}
```
Idempotency key (lines 123–125): `` `${core_homework_id}_${student_id}` `` (submit) or `` `${core_homework_id}_${student_id}_scored` `` (analyzer).

**Two fires per attempt:**
1. **Submit-time** — `app/api/experiments/attempts/[id]/submit/route.ts:223-252`, inside `after()`, only `if (data?.core_homework_id)` (line 180). `student_id` resolved via `spark_users.core_user_id` (lines 194–200). Sends `score: data.score` (null at this point unless previously analyzed), `content_quality: null`, `rubric_dimensions` best-effort from `getLatestRubricDimensions`. Result logged to `spark_system_events` as `core_signal_sent`/`core_signal_failed` (lines 239–249).
2. **Analyzer-time** ("scored") — `app/api/experiments/attempts/[id]/analyze/route.ts:368-389`, **awaited** (comment lines 341–359 explains fire-and-forget was killed by Vercel teardown). Sends the real `score: overall_score`, `effort_label`, `rubric_dimensions`, `content_quality`, optional BNCC fields; suffix `"scored"` (line 387). Logged as `core_score_sent`/`core_score_failed` (lines 390–400).

Supporting types: `RubricDimensions` = 7 keys each `1|2|3|4` (`collaboration: RubricScore | null`) — `lib/analyzer/rubric.ts:28-36`; `ContentQuality = "engaged" | "minimal" | "non_engaged"` — `rubric.ts:61-62`. `overall_score` derivation: weighted average of `rubricToLegacyScore` (1→25 … 4→100), weights at `rubric.ts:190-198`. The persisted analysis row (`spark_ai_analysis.result`, `analysis_type='experiment_scoring'`) contains `{ overall_score, content_quality, rubric_dimensions, dimension_observations, dimension_scores, effort_label, key_observations, prompt_version }` (`analyze/route.ts:251-260`); `dimension_scores` is the legacy 0-100 alias for `evidence_quality`/`reasoning_depth` only (lines 246–249).

A separate CORE-bound channel exists for mid-attempt mastery-shortcut events: `lib/integration/coreShortcut.ts` (`POST /api/attempts/platform/event` per `docs/wave-4c-core-interface.md:226`) — distinct from the completion webhook.

---

## 5. Existing read-only renders of an attempt

Three exist, **all student-self-scoped; none is teacher-accessible**:

1. **`/student/lab/artifact/[attemptId]`** (`app/(dashboard)/student/lab/artifact/[attemptId]/page.tsx`) — `PostSubmission` with `readOnly` (§1b). Renders persisted analysis only, not step responses; logs a `revisit_own_work` behavioral signal on mount (lines 91–105).
2. **Post-submit screen** in the runner (`phase === "submitted"`, runner page lines 710–720) — same `PostSubmission`, live mode.
3. **Pre-submit review** (`EvidenceCapture`, `phase === "review"`) — the only surface that renders per-step response text (§1d), and it exists only before submit.

Data-read endpoints backing them:
- `GET /api/experiments/attempts/my` (`app/api/experiments/attempts/my/route.ts:34-50`) — full attempt list incl. `evidence` jsonb, joined `session:experiment_sessions(... experiment:experiments(...))`, filtered `.eq("student_id", sparkUser.id)`.
- `GET /api/experiments/attempts/[id]/analysis` (`analysis/route.ts`) — persisted `spark_ai_analysis` newest `experiment_scoring` row; comment lines 14–17: "Privacy: self-scoped. … Teachers / admins have their own surfaces (signal dashboards, student detail views); this endpoint is for the student's Your Lab revisit path. Attempting to read another student's attempt returns 403." (Note: no such teacher surface for attempt review actually exists in `app/(dashboard)/` — the admin area is `admin/{api-test,connectors,customers,generation,integrations,system,trials,users}` and `dashboard/page.tsx` only.)
- `GET /api/experiments/attempts/[id]/content` (`content/route.ts:62-73`) — the generated challenge the student actually saw (`generation_status, generated_content, student_profile_snapshot, template_id, is_fallback, generation_error, prompt_version, model_version, created_at, updated_at`), also 403 for non-owners.

**Summary of what exists in the DB to render a teacher review page:** the challenge content the student saw (`experiment_attempt_content.generated_content` + `student_profile_snapshot`), the student's answers (`experiment_attempts.evidence.step_responses[]` with `step_index/type/value/completed`), scoring (`experiment_attempts.score/effort_label/revision_count/teli_hint_count`, `spark_ai_analysis.result` with 7-dim rubric + voice-gated observations + `content_quality`), raw signals (`spark_behavioral_signals`/`spark_cognitive_signals` keyed by `attempt_id`), timestamps (`started_at/completed_at`), and the CORE linkage (`core_homework_id`, `spark_users.core_user_id`, `core_experiment_assignments`, session `core_class_id`/`school_id`). Teli chat transcripts are deliberately never persisted (`teli/route.ts:94-99`).