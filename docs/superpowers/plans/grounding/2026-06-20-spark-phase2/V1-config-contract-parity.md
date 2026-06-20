# V1 SPARK config + create-notify + completion — verbatim grounding (parity check)

Repo: V1 CORE `C:/users/inteliflow/core` (Next.js App Router, top-level `app/ lib/`, NO `src/`).
This is the PROVEN production CORE that talks to SPARK (spark.inteliflowai.com) today.
Scope: SPARK config, the create-notify webhook (payload/headers/timeout/response capture), the
completion ingestion route, and the assignment binding columns. READ-ONLY; no edits. V1 DOES,
not V2 SHOULD.

---

## 1. SPARK configuration (env, secret, per-school key source)

### 1a. Env vars (read at CALL TIME, not module load)
`lib/spark/notifyAssignmentCreated.ts:30-37`:
```ts
// Both env reads at call time (not module-load time) so tests can
// stub them via process.env mutation without resetModules gymnastics.
function getSparkApiUrl(): string {
  return process.env.SPARK_API_URL || 'https://spark.inteliflowai.com';
}

function getSparkSecret(): string | undefined {
  return process.env.CORE_SPARK_API_SECRET;
}
```

`app/api/attempts/spark-launch/route.ts:15-16` (launch reads same two env vars, but at module load):
```ts
const SPARK_API_URL = process.env.SPARK_API_URL || 'https://spark.inteliflowai.com';
const SPARK_SECRET = process.env.CORE_SPARK_API_SECRET;
```

`app/api/attempts/spark-attempt-complete/route.ts:15`:
```ts
const SPARK_SECRET = process.env.CORE_SPARK_API_SECRET;
```

So: ONE shared platform secret `CORE_SPARK_API_SECRET` is used for BOTH directions — signing the
launch JWT, the outbound create-notify Bearer, AND validating the inbound completion Bearer.
Base URL = `SPARK_API_URL` (defaults to prod). There is NO per-school api_key on the outbound
create-notify call — auth is the single platform secret. (See §5 for the per-school
`platform_api_keys` row, which is a SCHOOL→PRODUCT *enablement* record CORE provisions to SPARK
out-of-band; it is NOT sent on the webhook.)

### 1b. Per-school SPARK enablement source
There is NO `core_spark_links` or `spark_schools` table on the CORE side. CORE resolves "is SPARK
provisioned for this school" from two CORE-side facts:
1. A row in `platform_api_keys` with `product='spark'` for the school (the per-school SPARK API key
   CORE issues; see §5).
2. The license feature gate `spark_experiences` (tier-derived professional/enterprise/trialing OR
   explicit `feature_overrides`/`feature_blocks`).

The CORE `school_id` is sent on the webhook payload; SPARK maps it to its own `spark_schools.id`
via SPARK-side `core_spark_links` (per the comment at `notifyAssignmentCreated.ts:106`:
"CORE schools.id. SPARK resolves this to its own spark_schools.id via core_spark_links.").

---

## 2. Create-notify webhook (payload + headers + timeout + RESPONSE CAPTURE)

### 2a. Endpoint, headers, idempotency, timeout
`lib/spark/notifyAssignmentCreated.ts:148` — timeout:
```ts
const REQUEST_TIMEOUT_MS = 35_000;
```
Comment (`:140-147`): Wave 5a inline gen on SPARK side chains Tier2→Tier3→Tier4 (~25s worst case);
35s gives margin. Pre-May-2026 this was 10s when SPARK gen ran async in an `after()` block.

`lib/spark/notifyAssignmentCreated.ts:178-207` — url, idempotency key, body, headers, signal:
```ts
const idempotencyKey = `${args.core_homework_id}_${args.student_id}`;
const url = `${getSparkApiUrl()}/api/integration/webhooks/core`;
const body = {
  event: 'spark_assignment_created',
  data: {
    spark_assignment_id: args.spark_assignment_id,
    core_homework_id: args.core_homework_id,
    student_id: args.student_id,
    school_id: args.school_id,
    core_class_id: args.core_class_id ?? null,
    teacher_id: args.teacher_id,
    due_date: args.due_date ?? null,
    lesson_plan: args.lesson_plan,
    student_profile: args.student_profile,
    session_config: args.session_config,
  },
};

let res: Response;
try {
  res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${secret}`,
      'X-Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}
```
- Endpoint: `POST {SPARK_API_URL}/api/integration/webhooks/core`
- Auth header: `Authorization: Bearer ${CORE_SPARK_API_SECRET}` (shared platform secret)
- Idempotency: `X-Idempotency-Key: ${core_homework_id}_${student_id}` (wire format pinned both sides)
- Envelope: `{ event: 'spark_assignment_created', data: {...} }`
- Fail-soft: NEVER throws. Missing secret → `{ success:false, error:'spark_secret_not_configured' }`
  + Sentry warning (`:164-176`). Network error → `{ success:false, error: 'network_error: ...' }`
  (`:208-220`). Non-2xx → `spark_http_${status}` (`:231-244`). 200+`success:false` →
  passes through error + ids (`:250-273`).

### 2b. RESPONSE CAPTURE — what V1 reads back from the create webhook
`lib/spark/notifyAssignmentCreated.ts:120-138` — the result interface:
```ts
export interface NotifyAssignmentCreatedResult {
  success: boolean;
  /** SPARK's experiment_attempts.id — written back to assignments.spark_attempt_id. */
  spark_attempt_id?: string;
  /** SPARK's synthetic experiments.id — written back to assignments.spark_experiment_id. */
  synthetic_experiment_id?: string;
  /** Always 'payload_direct' on success in Phase 1+. Useful for audit. */
  generation_path?: string;
  generation_status?: 'ready' | 'failed' | 'fallback_barb_original' | 'absent';
  error?: string;
}
```
`:222` — the parsed JSON shape V1 reads off the response body:
```ts
let json: { success?: boolean; error?: string; detail?: string; spark_attempt_id?: string; synthetic_experiment_id?: string; generation_path?: string; generation_status?: 'ready' | 'failed' | 'fallback_barb_original' | 'absent' } | null = null;
```
`:275-281` — success return:
```ts
return {
  success: true,
  spark_attempt_id: json?.spark_attempt_id,
  synthetic_experiment_id: json?.synthetic_experiment_id,
  generation_path: json?.generation_path,
  generation_status: json?.generation_status,
};
```

### CRITICAL — session_id (deep-link key)
**V1 does NOT capture a `session_id` from the create-webhook response.** The response shape
(`:222`, `:120-138`) has NO `session_id` field anywhere. The only ids V1 reads back are
`spark_attempt_id` (SPARK's `experiment_attempts.id`) and `synthetic_experiment_id` (SPARK's
synthetic `experiments.id`). V1 deep-links the launch off **`spark_attempt_id`**, NOT a session id
(see §3). So V2's current capture (spark_attempt_id + experiment_id, NO session_id) is **PARITY** —
V1 has no session_id to mirror. No divergence here.

---

## 3. Launch flow + deep-link (how the captured ids are used)

`app/api/attempts/spark-launch/route.ts`. POST returns `{ launch_url }`; GET 302-redirects.
`:29-46` — gate: assignment must belong to student AND have `spark_attempt_id` OR (legacy)
`spark_experiment_id` (`hasSparkAttempt`). `:88-110` — JWT + deep-link:
```ts
const token = jwt.sign({
  core_user_id: student.id,
  core_school_id: student.school_id,
  spark_attempt_id: assignment.spark_attempt_id,
  email: student.email,
  full_name: student.full_name,
  grade,
  return_url: returnUrl,
}, SPARK_SECRET, { expiresIn: '15m' });

const sparkAttemptId = assignment.spark_attempt_id || assignment.spark_experiment_id;
const redirectPath = `/student/experiment/${sparkAttemptId}`;
const launchUrl = `${SPARK_API_URL}/api/integration/auth?token=${token}&redirect=${encodeURIComponent(redirectPath)}`;
```
- JWT signed HS256 with `CORE_SPARK_API_SECRET`, 15m expiry.
- Claims: `core_user_id, core_school_id, spark_attempt_id, email, full_name, grade, return_url`.
- Deep-link target = **`/student/experiment/{spark_attempt_id}`** on SPARK — keyed by
  spark_attempt_id, NOT a session_id.
- Handoff endpoint = `{SPARK_API_URL}/api/integration/auth?token=<jwt>&redirect=<urlencoded path>`
  (confirmed canonical 2026-04-27; `/auth/core` was the wrong original guess).
- `return_url` = `{origin}/student/homework?assignmentId={assignment.id}` (param name MUST be
  `assignmentId`) so SPARK's "back to challenges" routes the student to their CORE homework.

---

## 4. Completion ingestion — `app/api/attempts/spark-attempt-complete/route.ts`

### 4a. Auth (THREE accepted paths)
`:52-79`:
- `Authorization: Bearer <token>` → try HS256 JWT (`validateSparkJWT`, `:29-50`, manual HMAC-SHA256
  verify of `header.payload` against `CORE_SPARK_API_SECRET`, base64url, checks `exp`).
- Fallback: plain shared-secret bearer — `timingSafeStringCompare(token, SPARK_SECRET)` (`:70-72`).
  Comment `:65-69`: SPARK's current `notifyCoreAttemptComplete` sends
  `Bearer <CORE_SPARK_API_SECRET>` directly (no JWT envelope) — caught 2026-05-04 when CORE 401'd
  because validateSparkJWT split a 64-char hex on dots and got 1 part.
- Also accepts `x-internal-secret === process.env.INTERNAL_API_SECRET` (`:74-76`).
- `timingSafeStringCompare` (`:22-27`) uses crypto `timingSafeEqual`.

### 4b. Idempotency
`:81-110`: reads `x-idempotency-key`; INSERT into `spark_signal_dedupe` (PK on `idempotency_key`,
migration 059). `23505` conflict → returns `{ ok:true, deduped:true }`. Other insert error →
FAIL OPEN (proceed). Missing header → warn + proceed.

### 4c. Incoming body fields
`:114-146`: `core_homework_id, student_id, completed_at, score, effort_label, revision_count,
teli_hint_count, signal_summary, rubric_dimensions` (top-level, migration 060), `content_quality`
('engaged'|'minimal'|'non_engaged'), `bncc_codes` (as `sparkBnccCodes`),
`bncc_competencias_gerais` (as `sparkBnccCompetencias`). `student_id` required → 400 if missing
(`:148`).

### 4d. Audit submission (fail-soft self-fetch)
`:164-196`: POSTs to `/api/attempts/platform/submission` with `x-internal-secret`, body
`{ source:'spark', student_id, submission_type:'experiment', score, title (signal_summary.
experiment_title || 'Spark Challenge'), external_id: core_homework_id, effort_label,
revision_count, hint_count: teli_hint_count, signal_summary }`. Returns `attempt_id`. WRAPPED in
try/catch — pre-2026-05-05 a throw here killed the handler and the card stayed "Not Started"
(ECONNREFUSED on serverless).

### 4e. Assignment update (when core_homework_id present)
`:216-219`: parallel SELECT `assignments(id, content, lesson_id, class_id, skill_ids)` +
`users(full_name, school_id)`. `:299-346`: writes `assignments.content` JSONB with `spark_score,
spark_effort_label, spark_completed_at, spark_revision_count, spark_hint_count,
spark_signal_summary`, conditionally `spark_rubric_dimensions`, `spark_ai_layer` (3-audience Claude
gen via `generateAIOutputLayer`, `:234-252`), `spark_content_quality`, and (pt-BR only)
`spark_bncc_*`. Sets `status:'completed'` + content; on enum-drift error, falls back to
content-only update (`:343-364`).

### 4f. transfer_score → skill engine
`:367-482`: updates `student_model` — appends to `spark_signals[core_homework_id]`, refines
`consistency_label`, blends `revision_count` into `avg_hints_per_assignment`, sets per-dimension
rolling averages `spark_dim_*` via `rollingAvg` (migration 060), increments
`spark_dim_attempt_count`/`spark_dim_collaboration_count`.
`:548-572` — **skill-state recompute (the skill engine feed)**:
```ts
const sparkSkillIds = (assignment as { skill_ids?: string[] | null } | null)?.skill_ids;
if (Array.isArray(sparkSkillIds) && sparkSkillIds.length > 0) {
  const { recomputeSkillStatesForStudent } = await import('@/lib/skills/recomputeSkillStates');
  const summary = await recomputeSkillStatesForStudent(admin, {
    studentId: student_id, schoolId: studentSchoolId, skillIds: sparkSkillIds,
  });
```
SPARK completion = a LOW-SCAFFOLD TRANSFER observation for every skill on the parent assignment
(`assignments.skill_ids`). AWAITED (Bug #36). Also BNCC mastery roll-up (`:507-546`,
`rollUpBnccMastery`, pt-BR only). `:574-583` inserts `platform_events`
(`event_type:'spark_signal_received'`). Returns `{ ok:true, received:true, attempt_id }` (`:589`).

---

## 5. Assignment ⇄ SPARK binding (columns) + how they're written

### 5a. Columns (migrations)
`supabase/migrations/038_spark_assignments.sql`:
```sql
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS assignment_mode text DEFAULT 'standard';
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS spark_experiment_id text;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS spark_attempt_id text;
ALTER TABLE student_model ADD COLUMN IF NOT EXISTS spark_signals jsonb DEFAULT '{}';
```
`supabase/migrations/056_spark_sync_state.sql`:
```sql
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS spark_sync_failed       boolean      DEFAULT false,
  ADD COLUMN IF NOT EXISTS spark_sync_error        text,
  ADD COLUMN IF NOT EXISTS spark_sync_attempted_at timestamptz;
-- partial index on (spark_sync_failed, spark_sync_attempted_at) WHERE spark_experiment_id IS NOT NULL
```
`supabase/migrations/057_spark_experiment_enum.sql`:
```sql
ALTER TYPE public.assignment_mode ADD VALUE IF NOT EXISTS 'spark_experiment';
```
So binding columns on `assignments`: `spark_attempt_id` (text), `spark_experiment_id` (text),
`spark_sync_failed` (bool), `spark_sync_error` (text), `spark_sync_attempted_at` (timestamptz),
`assignment_mode` (text). **No `spark_session_id` column exists.** Per-attempt detail + ai layer
+ bncc live in `assignments.content` JSONB; rolling rubric on `student_model.spark_dim_*`.

### 5b. Where the create-notify result is persisted (the caller)
`app/api/attempts/[attemptId]/submit/route.ts:1156-1217`. Fires AFTER assignment insert, gated on
`sparkInjectionAllowed && assignment && !assignmentGenerationFailed && classForSpark?.school_id &&
gradeBand !== undefined` (`:1094-1100`). Builds args (incl. iep_accommodations,
rubric_rolling_averages from `spark_dim_*`, learning_pattern_flags, locale via `getCurrentLocale()`),
calls `notifyAssignmentCreated(...)`, then `:1201-1211`:
```ts
await admin
  .from('assignments')
  .update({
    spark_attempt_id: result.spark_attempt_id ?? null,
    spark_experiment_id: result.synthetic_experiment_id ?? null,
    spark_sync_failed: !result.success,
    spark_sync_error: result.error ?? null,
    spark_sync_attempted_at: new Date().toISOString(),
  })
  .eq('id', assignment.id);
```
**Only `spark_attempt_id` + `spark_experiment_id` are persisted** (plus sync-state). No session id.
Render/launch gate (per migration 056 comment + `:43`): launch only when `spark_attempt_id IS NOT
NULL AND NOT spark_sync_failed`.

---

## 6. Per-school SPARK key provisioning (super-admin path)

`app/api/admin/platform-keys/route.ts` — Inteliflow-ops provisioning of per-school Bearer keys for
ecosystem products (lift/spark/pulse/custom).
- Auth: `X-Provisioning-Secret: $CORE_PROVISIONING_SECRET` + optional `X-Operator`
  (`validateProvisioningAuth`, `lib/platform/provisioningAuth.ts`). NOT the Supabase auth chain.
- POST body `{ product, school_id, api_key?, label?, is_active? }`. `VALID_PRODUCTS =
  {lift, spark, pulse, custom}` (`:21`). Verifies school exists. Key = caller-supplied (≥24 chars)
  or generated `core_${product}_${base64url(randomBytes(36))}` (`:156-161`). Inserts into
  `platform_api_keys (school_id, product, api_key, label, is_active)`. 409 on (school_id, product)
  unique collision (`:90-94`). Audit-logs to `audit_logs`.
- GET lists keys (never returns `api_key`). Filter by `?school_id=&product=`.
- Read surface for ops: `app/api/teacher/platform/spark-schools/route.ts` (platform_admin only)
  computes provisioning state from `platform_api_keys (product='spark')` × license
  `spark_experiences` gate → discriminated union `fully_enabled | feature_only | key_only |
  not_provisioned` (`:35-50`, `:184-223`).

---

## 7. Divergence notes vs V2 (parity check)

- **session_id: NO divergence.** V1 does NOT capture or store a SPARK `session_id` and does NOT
  deep-link by it. V1 deep-links by `spark_attempt_id` (`/student/experiment/{spark_attempt_id}`).
  V2 capturing spark_attempt_id + experiment_id (NO session_id) is exact parity. There is no
  missing session_id for V2 to add.
- Create-notify endpoint `/api/integration/webhooks/core`, envelope
  `{ event:'spark_assignment_created', data:{...} }`, `Authorization: Bearer CORE_SPARK_API_SECRET`,
  `X-Idempotency-Key: {core_homework_id}_{student_id}`, **35s** timeout (NOT 10s — was raised when
  SPARK moved gen inline). V2 must match the 35s ceiling and the idempotency wire format exactly.
- Response capture fields to mirror: `spark_attempt_id`, `synthetic_experiment_id` (→
  `spark_experiment_id`), `generation_path`, `generation_status`
  ('ready'|'failed'|'fallback_barb_original'|'absent'). On 200+success:false, V1 STILL passes
  `spark_attempt_id`/`synthetic_experiment_id`/`generation_status` through for audit/retry.
- Completion auth accepts BOTH a real HS256 JWT AND a plain `Bearer <CORE_SPARK_API_SECRET>`
  (constant-time compare) AND `x-internal-secret`. SPARK in prod sends the plain bearer — V2 must
  accept the non-JWT bearer path or it will 401 real SPARK traffic (the exact 2026-05-04 bug).
- Idempotency on completion = INSERT-into-dedupe-table (`spark_signal_dedupe`, PK idempotency_key),
  FAIL OPEN on non-23505 errors.
- Skill-engine feed: SPARK completion recomputes skill states for `assignments.skill_ids` as a
  low-scaffold transfer observation, AWAITED.
- Provisioning auth is a separate secret-header path (`X-Provisioning-Secret`/
  `CORE_PROVISIONING_SECRET`), not the Supabase staff-role chain; key stored in `platform_api_keys`
  keyed `(school_id, product)` unique.
