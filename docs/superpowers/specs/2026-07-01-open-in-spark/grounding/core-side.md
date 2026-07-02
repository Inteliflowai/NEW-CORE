# CORE-side grounding: "Open in SPARK" teacher link

## 1. Teacher challenges surface — what a challenge row holds today

### Loader: `src/lib/spark/loadChallenges.ts`

The row shape (`src/lib/spark/loadChallenges.ts:6-19`):

```ts
export interface ChallengeRow {
  studentId: string;
  studentName: string;
  assignmentId: string;
  title: string;
  status: 'assigned' | 'in_progress' | 'completed';
  transferScore: number | null;
  contentQuality: 'engaged' | 'minimal' | 'non_engaged' | null;
  rubric: Record<string, number | null> | null;
  completedAt: string | null;
  effortLabel: string | null;
  revisionCount: number | null;
  teliHintCount: number | null;
}
```

**No SPARK ids reach the challenge row today.** The two queries select (`src/lib/spark/loadChallenges.ts:47-60`):

```ts
const { data: aData } = await admin
  .from('assignments')
  .select('id, student_id, lesson_id, spark_status, content, users:student_id(full_name), lessons:lesson_id(title)')
  .eq('class_id', classId)
  .neq('spark_status', 'none')
  .limit(500);
...
const { data: cData } = await admin
  .from('spark_completions')
  .select('assignment_id, transfer_score, content_quality, rubric_dimensions, completed_at, effort_label, revision_count, teli_hint_count')
  .in('assignment_id', ids);
```

So `spark_attempt_id` / `spark_experiment_id` exist on `assignments` (see §2/§5) but are **not selected** here; only `assignmentId` (the CORE `assignments.id`) is carried. Status derivation (`loadChallenges.ts:66-67`):

```ts
const scored = c != null && (c.transfer_score != null || c.content_quality != null);
const status: ChallengeRow['status'] = c ? (scored ? 'completed' : 'in_progress') : 'assigned';
```

Auth contract (`loadChallenges.ts:1-3`): "Caller MUST run requireRole (layout) + guardClassAccess(classId) BEFORE calling (admin client bypasses RLS)."

### Page: `src/app/(teacher)/challenges/page.tsx`

- Class resolution: `?class=` param, else server-default via `firstClassIdForTeacher(userId)` + `redirect(`/challenges?class=${firstId}`)` (`page.tsx:44-51`).
- IDOR: `const guard = await guardClassAccess(classId); if (guard) return ...CLASS_UNAVAILABLE` (`page.tsx:53-54`).
- Data: `const admin = createAdminSupabaseClient(); const { challenges } = await loadChallenges(admin, classId); const groups = groupChallengesByStudent(challenges);` (`page.tsx:56-58`).

### Grouping: `src/lib/spark/groupChallenges.ts`

`groupChallengesByStudent(rows: ChallengeRow[]): StudentChallengeGroup[]` (`groupChallenges.ts:16`) — groups by `studentId`, sorts within student `completed(0) → in_progress(1) → assigned(2)` then `completedAt` desc (`groupChallenges.ts:12,24-28`); group carries `summary: { scored, inProgress, notStarted }` (`groupChallenges.ts:8`). Also pure helpers `studentSummaryLabel` (`:45`), `shortDate` (`:54`), `challengeTooltipLines` (`:63`).

### Components

- `src/app/(teacher)/challenges/_components/ChallengesList.tsx` — `'use client'` (`:4`); expandable per-student rows (`useState<Set<string>>` at `:11`), a single fixed `role="tooltip"` div (`:54-63`); renders `<ChallengeCard key={c.assignmentId} row={c} .../>` (`:41-46`). It receives ONLY `{ groups: StudentChallengeGroup[] }` (`:10`).
- `src/app/(teacher)/challenges/_components/ChallengeCard.tsx` — `'use client'`; props `{ row: ChallengeRow; onTip; onHideTip }` (`:28-35`). Completed rows render Transfer word + `%`, quality label, `Submitted <shortDate>`, rubric `x/4` parts, effort/revision/hint line (`:62-72`); non-completed render `'In progress — not submitted yet'` / `'Not started yet'` (`:73-77`). No link/anchor of any kind is rendered today.

## 2. `spark_completions` schema — `supabase/migrations/0012_spark.sql`

Full table, verbatim (`0012_spark.sql:24-42`):

```sql
CREATE TABLE IF NOT EXISTS public.spark_completions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid        REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id        uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  assignment_id     uuid        NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  spark_attempt_id  text,
  score             int2,
  effort_label      text,
  rubric_dimensions jsonb,
  content_quality   text        CHECK (content_quality IN ('engaged','minimal','non_engaged')),
  transfer_score    int2,
  revision_count    int,
  teli_hint_count   int,
  signal_summary    jsonb,
  completed_at      timestamptz,
  received_at       timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE (assignment_id, student_id)
);
```

Indexes on `student_id`, `assignment_id`, `school_id` (`0012_spark.sql:44-46`). RLS: `spark_completions_service_role_all` (FOR ALL to service_role) + `spark_completions_staff_read` (SELECT to authenticated where role IN `('teacher','school_admin','school_sysadmin','platform_admin')` AND `school_id = public.get_my_school_id()` OR `public.is_platform_admin()`) (`0012_spark.sql:51-62`). No student/parent read.

**Important write-path fact:** the live ingestion webhook `src/app/api/attempts/spark-attempt-complete/route.ts` upserts `spark_completions` **without** `spark_attempt_id` (upsert field list at `route.ts:126-143` contains `assignment_id, student_id, school_id, score, effort_label, rubric_dimensions, content_quality, transfer_score, revision_count, teli_hint_count, signal_summary, completed_at, updated_at` — no `spark_attempt_id`). Only the demo seed populates it (`scripts/seedDemo.ts:843` `spark_attempt_id: \`demo-${s.key}-attempt\``). So in production the reliable attempt id lives on **`assignments.spark_attempt_id`**, not on `spark_completions`.

## 3. Existing student launch — `POST /api/attempts/spark-launch`

File `src/app/api/attempts/spark-launch/route.ts`.

- Auth: `createServerSupabaseClient()` → `auth.getUser()` → 401 (`route.ts:10-12`); ownership: `if ((assignment.student_id as string) !== user.id) return ... 403` (`route.ts:25`); requires `assignment.spark_attempt_id` else 400 `'Spark not provisioned for this assignment'` (`route.ts:26`).
- Config gate: `if (!CORE_SPARK_API_SECRET) return ... 500` (`route.ts:19`).
- JWT construction — `src/lib/spark/signLaunchJwt.ts` (hand-rolled, no jsonwebtoken dep):

```ts
export interface LaunchClaims {
  core_user_id: string;
  core_school_id: string;
  spark_attempt_id?: string;
  email?: string;
  full_name?: string;
  grade?: string;
  return_url?: string;
}
...
export function signLaunchJwt(claims: LaunchClaims, ttlSeconds = 900): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ ...claims, iss: 'inteliflow-core', iat: now, exp: now + ttlSeconds }));
  const sig = createHmac('sha256', CORE_SPARK_API_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}
```

(`signLaunchJwt.ts:7-25`; alg HS256, secret = `CORE_SPARK_API_SECRET`, TTL default 900 s, `iss: 'inteliflow-core'`, `exp` in epoch seconds. Header comment `:2-3`: "Matches SPARK's verifier (verifyCoreJWT)".)

- Claims actually sent (`route.ts:45-53`): `core_user_id` = `student.id`, `core_school_id` = `student.school_id`, `spark_attempt_id` = `assignment.spark_attempt_id`, `email`, `full_name`, `grade` (from active enrollment's `classes.grade_level`, `route.ts:33-41`), `return_url` = `` `${origin}/student/assignments/${assignment.id}` `` (`route.ts:43-44`).
- Target URL shape (`route.ts:54-55`):

```ts
const redirectPath = `/student/experiment/${assignment.spark_attempt_id as string}`;
const launch_url = `${SPARK_API_URL}/api/integration/auth?token=${token}&redirect=${encodeURIComponent(redirectPath)}`;
```

Note the SPARK deep-link path is keyed on **`spark_attempt_id`** (not `spark_experiment_id`).

## 4. SPARK base URL + enabled gate

- SPARK base URL is a **single global env**, not per-school — `src/lib/spark/config.ts:5-6`:

```ts
export const SPARK_API_URL = process.env.SPARK_API_URL || 'https://spark.inteliflowai.com';
export const CORE_SPARK_API_SECRET = process.env.CORE_SPARK_API_SECRET || '';
```

- Per-school enablement gate = presence of an ENABLED `platform_links` row with `product='spark'` — `src/lib/spark/sparkLink.ts:12-25`:

```ts
export async function getSparkLink(admin: SupabaseClient, schoolId: string): Promise<SparkLink | null> {
  const { data } = await admin
    .from('platform_links')
    .select('api_key, core_base_url, enabled')
    .eq('school_id', schoolId)
    .eq('product', 'spark')
    .maybeSingle();
  if (!data || (data as SparkLink).enabled !== true) return null;
  return data as SparkLink;
}
export async function isSparkEnabled(...): Promise<boolean> { return (await getSparkLink(admin, schoolId)) !== null; }
```

- `platform_links` table (`supabase/migrations/0008_platform.sql:44-59`): columns `id, school_id, product CHECK IN ('spark','lift','custom'), api_key, label, core_base_url, enabled boolean DEFAULT true, key_version, rotated_at, expires_at, last_used_at, created_at`, `UNIQUE (school_id, product)`. Note: `core_base_url` is **CORE's own URL sent to SPARK** (for SPARK→CORE webhooks), not SPARK's URL. The `schools` table has **no** SPARK columns (only migrations 0008/0012 mention spark).
- Enable flow — `src/app/api/admin/spark-enable/route.ts`: `guardPlatformAdmin()` gate (`:16`); hardcoded `const CORE_BASE_URL = 'https://newcore.inteliflowai.com';` (`:13`); step 1 `provisionSparkSchool({ coreSchoolId, name, coreBaseUrl })` → SPARK's `POST ${SPARK_API_URL}/api/integration/provision-school` with `Authorization: Bearer ${CORE_SPARK_API_SECRET}` returning `{ success, spark_school_id }` (`provisionSparkSchool.ts:20-28`); step 2 upsert the `platform_links` row via `provisionSparkLink` reusing an existing `api_key` else `` `core_spark_${randomUUID()}` `` (`route.ts:41-44`); step 3 `school_licenses.feature_overrides.spark_experiences = true` (`route.ts:50-59`); audits `spark.enable` on `ok===true` (`route.ts:63-72`). The SPARK-side per-school id (`spark_school_id`) is returned in the response but **not stored anywhere in CORE's DB** — CORE↔SPARK correlation is by `core_school_id` on the SPARK side (SPARK's `core_spark_links`), per `docs/spark-mining-findings.md:31`.

## 5. SPARK-challenge `assignments` rows vs normal ones

A SPARK challenge is **not a separate row type** — it is a normal generated `assignments` row that additionally gets the SPARK binding columns set after a successful create-notify. Binding columns (`supabase/migrations/0012_spark.sql:8-12`):

```sql
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS spark_assignment_id text,   -- CORE-generated correlation id sent to SPARK
  ADD COLUMN IF NOT EXISTS spark_attempt_id    text,   -- SPARK's returned spark_attempt_id
  ADD COLUMN IF NOT EXISTS spark_experiment_id text,   -- SPARK's returned synthetic_experiment_id
  ADD COLUMN IF NOT EXISTS spark_status        text DEFAULT 'none';
```

with `CHECK (spark_status IN ('none','notified','created','in_progress','completed','notify_failed'))` (`0012_spark.sql:16-20`).

Write sites (both call `notifyAssignmentCreated` then update the just-inserted row):
- `src/app/api/teacher/assignments/generate/route.ts:229-237`:

```ts
await admin
  .from('assignments')
  .update({
    spark_assignment_id: result.sparkAssignmentId,
    spark_attempt_id: result.sparkAttemptId ?? null,
    spark_experiment_id: result.syntheticExperimentId ?? null,
    spark_status: result.success ? 'created' : 'notify_failed',
  })
  .eq('id', row.id);
```

- Identical block in `src/app/api/teacher/assignments/reinforce/route.ts:207-215`.

`notifyAssignmentCreated` (`src/lib/spark/notifyAssignmentCreated.ts:33-100`): generates `sparkAssignmentId = randomUUID()` (`:34`), POSTs `{SPARK_API_URL}/api/integration/webhooks/core` with `Authorization: Bearer ${CORE_SPARK_API_SECRET}` and `X-Idempotency-Key: ${coreHomeworkId}_${studentId}` (`:69-75`), event `'spark_assignment_created'`, and reads back `{ spark_attempt_id, synthetic_experiment_id }` (`:82-93`).

Content shape: identical to normal assignments (`content: assignment` from `generateAssignment`, `generate/route.ts:190`); the only content field the challenges surface reads is `content.title` with fallback to `lessons.title` then `'Spark Challenge'` (`loadChallenges.ts:72`). The challenge marker is purely `spark_status !== 'none'` (`loadChallenges.ts:51`; student badge comment `src/app/(student)/student/assignments/page.tsx:4`; the assignment player rejects spark rows: `loadAssignmentForPlay.ts:53` `if ((r.spark_status ?? 'none') !== 'none')`).

Ingestion correlation is CORE-native: the SPARK→CORE completion webhook resolves by `core_homework_id` (= `assignments.id`) + `student_id` (`spark-attempt-complete/route.ts:53-57,106-118`) — it never uses the spark ids.

## 6. Env vars involved (names only)

Read in non-test source (single site, `src/lib/spark/config.ts:5-6`):
- `SPARK_API_URL` (default `https://spark.inteliflowai.com` when unset)
- `CORE_SPARK_API_SECRET` (default `''`; both the Bearer secret for CORE↔SPARK API calls and the HS256 launch-JWT key; standing rotation recommendation in CLAUDE.md)

No other `SPARK_*`/`CORE_SPARK*` env names exist in `src/`, `scripts/`, or `supabase/` (test files set the same two).

## Key facts for the feature (summary)

- The teacher-visible SPARK attempt/experiment ids live on `assignments.spark_attempt_id` / `assignments.spark_experiment_id` (`0012_spark.sql:10-11`), but `loadChallenges` does not currently select them (`loadChallenges.ts:49`) and `ChallengeRow` does not carry them (`loadChallenges.ts:6-19`).
- `spark_completions.spark_attempt_id` exists but is NOT populated by the live webhook (`spark-attempt-complete/route.ts:126-143`), only by the demo seed (`scripts/seedDemo.ts:843`).
- SPARK's existing auth entry is student-only: `${SPARK_API_URL}/api/integration/auth?token=<HS256 JWT>&redirect=/student/experiment/<spark_attempt_id>` (`spark-launch/route.ts:54-55`); JWT = HS256, secret `CORE_SPARK_API_SECRET`, `iss 'inteliflow-core'`, TTL 900 s (`signLaunchJwt.ts:19-25`).
- Per-school SPARK gate = `platform_links` row `product='spark' AND enabled=true` via `getSparkLink`/`isSparkEnabled` (`sparkLink.ts:12-25`); SPARK host itself is the global `SPARK_API_URL` env, and CORE stores no SPARK-side school id.