# G7 — Seed + Provisioning + Integration/Cron Stubs (verbatim grounding)

Branch: `feat/teacher-app-shell`. All facts below are quoted verbatim from current code with `file:line` refs. READ-ONLY; no changes proposed.

---

## ⚠️ TOP FLAGS (read first)

### FLAG 1 — DEMO SCHOOL IDENTITY: there is NO `slug` column on `schools`.
The demo school is identified at seed time by **`name = 'CORE Demo School'` + `demo_mode = true`** (a `.maybeSingle()` lookup), and its `id` is a freshly generated `randomUUID()` on first seed (reused on re-seed). There is no stable/deterministic id and **no slug** anywhere.

- Constant: `src/lib/demo/demoCast.ts:42` — `export const DEMO_SCHOOL_NAME = 'CORE Demo School';`
- Seed lookup/create: `scripts/seedDemo.ts:112-132`:
  ```ts
  const { data: existingSchool } = await admin
    .from('schools')
    .select('id')
    .eq('name', DEMO_SCHOOL_NAME)
    .eq('demo_mode', true)
    .maybeSingle();
  if (existingSchool) {
    schoolId = existingSchool.id;
    ...
  } else {
    schoolId = randomUUID();
    const { error: schoolErr } = await admin.from('schools').insert({
      id: schoolId,
      name: DEMO_SCHOOL_NAME,
      demo_mode: true,
      is_active: true,
    });
  ```
- `schools` table has NO `slug`. Columns: `id, name, domain, timezone, google_classroom_enabled, parent_profile_visible, is_active, demo_mode, demo_expires_at, welcome_completed, is_trial, trial_started_at, trial_expires_at, trial_status, trial_plan, trial_source, hl_contact_id, trial_credentials, allowed_email_domains, created_at` (`supabase/migrations/0001_identity_roles.sql:13-37`).

**Implication for the planner:** any `platform_links` / `core_spark_links` seed for the demo school must resolve `school_id` by the SAME `name='CORE Demo School' AND demo_mode=true` query at seed time (NOT a hard-coded uuid, NOT a slug). The demo `school_id` is only knowable after that lookup.

### FLAG 2 — `platform_links` / `external_identities` / `core_spark_links` have ZERO TypeScript helpers or call sites in `src/`.
Grep for `platform_links|external_identities|core_spark_links` across `src/` returned **No matches found**. The tables exist ONLY as DDL in `0008_platform.sql`. There is **no existing read/write helper, no insert, no query** anywhere in app/lib code. `core_spark_links` does not exist as a table at all (no DDL, no code) — it is referenced only by the spec/handoff, so it is a NEW artifact the plan must create.

### FLAG 3 — Ingestion path `src/app/api/attempts/spark-attempt-complete/route.ts` ALREADY EXISTS as a 501 stub.
The spec wants ingestion at THAT path (not at `integrations/core`). The file is present today as the standard P1 501 stub (quoted below). Both `integrations/core/route.ts` AND `attempts/spark-attempt-complete/route.ts` exist as identical 501 stubs.

### FLAG 4 — `idempotency-sweep` cron is NOT registered in `vercel.json` (despite the stub existing and 0008 referencing it).
`vercel.json` registers `idempotency-sweep` — CORRECTION: it IS registered. See FLAG 4-detail below. (Re-verified: `vercel.json:4` lists `/api/cron/idempotency-sweep`.) The cron that is NOT registered is `/api/cron/snapshot` and `/api/cron/trial-check` (both stubs exist but are absent from `vercel.json`).

---

## 1. Demo seed — `scripts/seedDemo.ts` + `src/lib/demo/*`

### 1a. demoCast.ts identities (`src/lib/demo/demoCast.ts:42-94`)
```ts
export const DEMO_SCHOOL_NAME = 'CORE Demo School';

export const DEMO_TEACHER = { key: 'teacher', full_name: 'Dana Whitfield', role: 'teacher' as const };
export const DEMO_PARENT  = { key: 'parent',  full_name: 'Rosa Rivera',    role: 'parent'  as const };
export const DEMO_ADMIN   = { key: 'admin',   full_name: 'Priya Anand',    role: 'school_admin' as const };
```
8 students, `DEMO_STUDENTS` (keys): `alex, sofia, marcus, emma, jordan, lily, darius, nadia` (`demoCast.ts:49-94`). `alex` is `DEMO_STUDENTS[0]` (the pre-created first student in trial provisioning).

`DemoStudent` interface (`demoCast.ts:26-40`): `{ key, full_name, effort_label, quizzes: DemoQuiz[], homework: DemoHw[], reteachNeeded?, expect: { band, volatile, diagnose, risk } }`.

### 1b. Seed account emails + password
- Demo emails: `` `${key}@demo.coreedtech.com` `` (e.g. `scripts/seedDemo.ts:155`, `:173`, `:187`, `:208`).
- Shared password: `scripts/seedDemo.ts:105` — `const DEMO_PASSWORD = 'DemoCore#2026';`
- Class name: `scripts/seedDemo.ts:106` — `const CLASS_NAME = 'Demo Period 1';`

### 1c. Admin client construction in scripts (NOT the app helper)
`scripts/seedDemo.ts:42` — `const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);` (reads `process.env.NEXT_PUBLIC_SUPABASE_URL` + `process.env.SUPABASE_SECRET_KEY`, `:33-34`).

### 1d. How students/assignments/signals are seeded (writer ordering)
`scripts/seedDemo.ts` `main()` step order: (1) school, (1b) `school_licenses` upsert `onConflict:'school_id'`, (2) teacher, (3) parent+admin, (4) 8 students via `ensureAuthUser`, (5) parent→alex link, (6) class, (7) enrollments upsert `onConflict:'class_id,student_id'`, (8) skill via `ensureSkill` (slug `demo-skill-1`), (9) lesson, (10) quiz + 5 quiz_questions, (11) `buildSeedRows(DEMO_STUDENTS, now)`, (12) quiz_attempts, (13) assignments + homework_attempts, (14) student_model_snapshots upsert `onConflict:'student_id,snapshot_date'`, (15) skill_learning_state upsert `onConflict:'student_id,skill_id'`, (16) misconception_observations.

Pure row builder: `src/lib/demo/buildSeedRows.ts` — `export function buildSeedRows(students: DemoStudent[], now: Date): SeedRows` returns `{ assignments, homework_attempts, quiz_attempts, snapshots, skill_learning_state, misconceptions }` (`buildSeedRows.ts:83-90, 143`). No quiz/lesson/class rows in `SeedRows` (those are created imperatively by the writer; only the trial builder emits scaffold rows).

### 1e. EXACT PATTERN to add a new seed block (e.g. `spark_completions`)
Each soft-fail block follows this shape (quoting the misconceptions block as the closest analogue to a new completions block, `scripts/seedDemo.ts:593-612`):
```ts
  // ── Step 16: Misconception observations (soft fail) ───────────────────────
  if (skillId) {
    for (const m of seedRows.misconceptions) {
      const sid = studentIds[m.student_key];
      if (!sid) continue;
      try {
        await admin.from('misconception_observations').insert({
          student_id: sid,
          skill_id: skillId,
          school_id: schoolId,
          error_type: m.error_type,
          reasoning_pattern: m.reasoning_pattern,
          observed_at: m.observed_at,
        });
      } catch (e) {
        console.warn(`[seed] misconception ${m.student_key} failed (soft):`, (e as Error).message);
      }
    }
    console.log('[seed] Misconceptions done');
  }
```
Available in-scope resolved IDs at that point: `schoolId`, `teacherId`, `classId` (nullable), `lessonId` (nullable), `quizId` (nullable), `skillId` (nullable), `studentIds: Record<string,string>` (key→uuid), `assignmentIds: Record<string,string>` (keyed `` `${assignment.key}:${student.key}` ``). A new `spark_completions` block would (a) add a typed array to `SeedRows` + emit it in `buildSeedRows`, then (b) add a writer block resolving `student_key`→`studentIds[key]` and inserting with `school_id: schoolId`.

### 1f. reset — `scripts/resetDemo.ts`
Deletes demo school by the SAME identity (`name=DEMO_SCHOOL_NAME AND demo_mode=true`, `.maybeSingle()`, `resetDemo.ts:53-58`) then `.delete().eq('id', school.id)` relies on FK cascade. Then deletes auth users scoped to `@demo.coreedtech.com` emails, never platform_admin (`resetDemo.ts:75-111`). A new demo table must be FK `ON DELETE CASCADE` to `schools(id)` (or `users(id)`) to be cleaned by reset.

---

## 2. Trial provisioning — `src/lib/trial/*`

### 2a. `provisionTrial.ts` — does NOT touch `platform_links` / `external_identities`.
`provisionTrial` writes (in order, `provisionTrial.ts:83-225`): `schools` INSERT (hard-fail, generated `schoolId = randomUUID()`), `school_licenses` UPSERT `onConflict:'school_id'`, teacher via `ensureAuthUser`, parent + first student (Alex) via `ensureAuthUser`, `schools.trial_credentials` UPDATE, `seedTrialDemoData(...)`, `logTrialEvent('trial_signup')`. **Nothing in this function references platform_links, external_identities, or spark.** There is NO existing pattern here for writing a SPARK platform_links row.

Signatures:
```ts
export interface ProvisionTrialInput {
  admin: SupabaseClient; schoolName: string; teacherEmail: string; teacherName: string;
  trialPlan?: string; trialSource?: string | null; studentLimit?: number; trialDays?: number; rng?: Rng;
}
export interface ProvisionTrialResult {
  schoolId: string; teacherId: string; parentId: string | null; firstStudentId: string | null;
  password: string; trialExpiresAt: string; credentials: Record<string, TrialCredential>; seedReport?: SeedReport;
}
export async function provisionTrial(input: ProvisionTrialInput): Promise<ProvisionTrialResult>
```
(`provisionTrial.ts:34-63`). Trial `schoolId = randomUUID()` (`:80`), `schoolIdShort = schoolId.slice(0, 8)` (`:81`). Trial student emails: `` `demo-${key}@trial-${schoolIdShort}.core.com` `` (`provisionTrial.ts:149-150`, `buildTrialRows.ts:202`).

### 2b. The generic row-write pattern (closest model for a platform_links insert)
`provisionTrial.ts` school insert (hard-fail) (`:84-98`):
```ts
  {
    const { error } = await admin.from('schools').insert({
      id: schoolId,
      name: schoolName,
      is_trial: true,
      ...
      demo_mode: false,
      is_active: true,
    });
    if (error) throw new Error(`provisionTrial: failed to create school: ${error.message}`);
  }
```
`school_licenses` upsert pattern (`:111-128`): `admin.from('school_licenses').upsert({ school_id, ... }, { onConflict: 'school_id' })`.

`seedTrialDemoData.ts` SOFT-FAIL writer pattern (each step try/catch + `recordOk`/`recordSkip`, `seedTrialDemoData.ts:40-49, 83-101`). `SeedReport = { seeded: string[]; skipped: { step; reason }[] }`. This function NEVER throws.

### 2c. `ensureAuthUser` (`src/lib/trial/ensureAuthUser.ts`)
```ts
export interface EnsureAuthUserParams {
  admin: SupabaseClient; email: string; password: string; full_name: string; role: string; school_id: string;
}
export async function ensureAuthUser(...): Promise<string>   // returns auth user id
export async function findAuthIdByEmail(admin: SupabaseClient, email: string): Promise<string | null>
```
Account-takeover guard: reconciles by AUTH ID; never overwrites `role`/`school_id`; HARD-THROWS on role/school mismatch (`ensureAuthUser.ts:91-109`). No DB trigger syncs auth→public.users; caller relies on this fn to INSERT the `public.users` row (`:113-128`).

### 2d. `logTrialEvent` (`src/lib/trial/logTrialEvent.ts`)
```ts
export interface LogTrialEventParams { admin: SupabaseClient; schoolId: string | null; userId?: string | null; eventType: string; metadata?: Record<string, unknown>; }
export async function logTrialEvent({...}): Promise<void>   // inserts into public.trial_events; soft-fail (logs + swallows)
```
`event_type` is constrained to an 18-value CHECK enum incl. `'trial_signup'` (`logTrialEvent.ts:5-8`).

---

## 3. Integration / ingestion / cron stubs (verbatim)

### 3a. `src/app/api/integrations/core/route.ts` (ENTIRE FILE — 501 stub)
```ts
import { NextResponse } from 'next/server';
// P1 stub — body is a later-plan deliverable. Created up front to dodge the
// Turbopack new-top-level-api-folder 404 trap (spec §1.5).
export async function POST() {
  return NextResponse.json({ error: 'Not implemented' }, { status: 501 });
}
export async function GET() {
  return NextResponse.json({ error: 'Not implemented' }, { status: 501 });
}
```

### 3b. `src/app/api/cron/idempotency-sweep/route.ts` (ENTIRE FILE — IDENTICAL 501 stub)
Byte-identical to 3a (same 9 lines). It is the body the `idempotency-sweep` cron will replace; `webhook_idempotency_keys` table (with `expires_at`, state machine `in_progress|completed|failed`) is the sweep target — `0008_platform.sql:87-101`.

### 3c. `src/app/api/attempts/spark-attempt-complete/route.ts` (ENTIRE FILE — IDENTICAL 501 stub, the spec's intended ingestion path)
Byte-identical to 3a (same 9 lines). **This is the path the spec wants ingestion at.** It already exists as a stub; implement here, NOT at `integrations/core`.

Other identical 501 stubs confirmed: `src/app/api/cron/snapshot/route.ts`, `src/app/api/cron/trial-check/route.ts`, `src/app/api/cron/trial-expiry/route.ts` (all byte-identical to 3a).

---

## 4. Cron configuration — `vercel.json` (ENTIRE FILE)
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/cron/idempotency-sweep", "schedule": "0 3 * * *" },
    { "path": "/api/cron/weekly-snapshot", "schedule": "0 6 * * 1" },
    { "path": "/api/cron/parent-narrative", "schedule": "0 7 * * 1" },
    { "path": "/api/cron/trial-expiry", "schedule": "0 8 * * *" }
  ]
}
```
Registered crons: `idempotency-sweep` (daily 03:00), `weekly-snapshot` (Mon 06:00), `parent-narrative` (Mon 07:00), `trial-expiry` (daily 08:00). **NOT registered (stubs exist but absent from vercel.json): `/api/cron/snapshot`, `/api/cron/trial-check`.**

### 4a. EXISTING IMPLEMENTED CRON ROUTE PATTERN — `src/app/api/cron/weekly-snapshot/route.ts`
The one fully-implemented cron, the canonical pattern for a new cron route:
- Auth gate (`weekly-snapshot/route.ts:72-78`):
  ```ts
  export async function POST(req: NextRequest): Promise<NextResponse> {
    const secret = process.env.CRON_SECRET;
    const provided = req.headers.get('x-cron-secret');
    if (!secret || provided !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  ```
- Admin client: `const admin = createAdminSupabaseClient();` (`:90`, imported from `@/lib/supabase/server`, `:27`).
- GET retained for Vercel probe: `export async function GET(req: NextRequest) { return POST(req); }` (`:351-353`).
- Per-student failures isolated (try/catch in loop), returns `{ snapshot_date, processed, failed, skipped }` (`:342-347`).

Supabase server helpers (`src/lib/supabase/server.ts`): `export async function createServerSupabaseClient()` (`:5`) and `export function createAdminSupabaseClient()` (`:27`, synchronous).

---

## 5. `platform_links` / `external_identities` schema (DDL only — `0008_platform.sql`)

### 5a. `platform_links` (`0008_platform.sql:44-62`)
```sql
CREATE TABLE IF NOT EXISTS public.platform_links (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  product       text        NOT NULL CHECK (product IN ('spark','lift','custom')),
  api_key       text        NOT NULL,
  label         text,
  core_base_url text,
  enabled       boolean     DEFAULT true,       -- was is_active in V1
  key_version   int         DEFAULT 1,
  rotated_at    timestamptz,
  expires_at    timestamptz,
  last_used_at  timestamptz,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (school_id, product)
);
CREATE INDEX IF NOT EXISTS idx_platform_links_key
  ON public.platform_links (api_key) WHERE enabled = true;
```
`product` CHECK includes `'spark'`. `UNIQUE (school_id, product)` → upsert with `onConflict:'school_id,product'`. `api_key` is `NOT NULL`. RLS deny-by-default; only `is_platform_admin()` (`:117-119`) — service_role/admin client bypasses RLS.

### 5b. `external_identities` (`0008_platform.sql:69-80`)
```sql
CREATE TABLE IF NOT EXISTS public.external_identities (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  provider         text        NOT NULL,   -- e.g. 'lift', 'spark', 'google'
  external_id      text        NOT NULL,
  core_student_id  uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  created_at       timestamptz DEFAULT now(),
  UNIQUE (school_id, provider, external_id)
);
```
Resolve create-vs-match by `(school_id, provider, external_id)` → `core_student_id`. `provider='spark'` is intended. `UNIQUE (school_id, provider, external_id)` → upsert `onConflict:'school_id,provider,external_id'`.

### 5c. `webhook_idempotency_keys` (`0008_platform.sql:87-101`) — sweep target for `idempotency-sweep`
Columns: `id, endpoint, idempotency_key, status CHECK('in_progress','completed','failed'), response_body jsonb, created_at, expires_at`; `UNIQUE (endpoint, idempotency_key)`; index on `expires_at WHERE expires_at IS NOT NULL`.

---

## 6. Migrations — next number + naming

Existing: `0001_identity_roles.sql` … `0011_signals.sql` (`supabase/migrations/`). Highest is `0011_signals.sql`. **Next migration number = `0012_`**, naming convention `NNNN_snake_case_topic.sql` (4-digit zero-padded prefix, underscore, snake_case slug). Migrations are tested by `supabase/migrations/__tests__/migrations.test.ts` (regex assertions on DDL text — a new table/column will likely need a matching test there; the test file already asserts `platform_links`/`external_identities` shapes at lines 506-560).

`core_spark_links` does NOT exist (no DDL, no code) — if the plan needs it, it is a NEW table in `0012_`.
