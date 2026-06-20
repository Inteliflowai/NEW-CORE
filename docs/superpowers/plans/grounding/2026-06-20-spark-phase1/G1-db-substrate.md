# G1 — DB Substrate & Migrations (VERBATIM grounding)

Surface: DB substrate & migrations for SPARK Phase 1.
Repo: C:/users/inteliflow/NEW-CORE · branch `feat/teacher-app-shell`. Read-only; no edits made.

---

## 1. Migration inventory + naming convention

`Glob supabase/migrations/*.sql` returns exactly 11 migration files:

```
supabase/migrations/0001_identity_roles.sql
supabase/migrations/0002_classes_enrollments.sql
supabase/migrations/0003_lessons_quizzes.sql
supabase/migrations/0004_assignments_homework.sql
supabase/migrations/0005_skills.sql
supabase/migrations/0006_snapshots.sql
supabase/migrations/0007_licensing.sql
supabase/migrations/0008_platform.sql
supabase/migrations/0009_security_hardening.sql
supabase/migrations/0010_engine_columns.sql
supabase/migrations/0011_signals.sql
```

- **Naming convention:** `NNNN_snake_case_name.sql` — zero-padded 4-digit sequential prefix, underscore, lowercase snake_case descriptor.
- **Highest migration number:** `0011`.
- **Next migration number for new work:** `0012_<name>.sql` (e.g. `0012_spark.sql`).
- (There is also a non-migration test file `supabase/migrations/__tests__/migrations.test.ts` — not part of the numbered sequence.)

---

## 2. `0008_platform.sql` — VERBATIM DDL

Header comments (file:1-12) state schema only; metering counting + Spark wire logic are "later-plan deliverables."

### platform_events (0008_platform.sql:18-37)
```sql
CREATE TABLE IF NOT EXISTS public.platform_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text        NOT NULL,   -- e.g. 'tts'|'whisper'|'flux'|'runway'|'teli_chat'
  event_type  text        NOT NULL,
  school_id   uuid        REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id  uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  payload     jsonb       DEFAULT '{}'::jsonb,
  processed   boolean     DEFAULT false,
  error       text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_events_meter
  ON public.platform_events (school_id, source, created_at);
CREATE INDEX IF NOT EXISTS idx_platform_events_source
  ON public.platform_events (source, event_type);
CREATE INDEX IF NOT EXISTS idx_platform_events_student
  ON public.platform_events (student_id);
CREATE INDEX IF NOT EXISTS idx_platform_events_unprocessed
  ON public.platform_events (processed) WHERE processed = false;
```
**=> `platform_events` DOES exist (in 0008).** No CHECK constraints, no UNIQUE.

### platform_links (0008_platform.sql:44-62)
```sql
CREATE TABLE IF NOT EXISTS public.platform_links (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  product       text        NOT NULL CHECK (product IN ('spark','lift','custom')),
  api_key       text        NOT NULL,
  label         text,
  core_base_url text,
  enabled       boolean     DEFAULT true,       -- was is_active in V1
  -- §7 GA rework: rotatable key columns
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
- CHECK: `product IN ('spark','lift','custom')`. UNIQUE: `(school_id, product)`.

### external_identities (0008_platform.sql:69-80)
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

CREATE INDEX IF NOT EXISTS idx_external_identities_lookup
  ON public.external_identities (school_id, provider, external_id);
```
- UNIQUE: `(school_id, provider, external_id)`. No CHECK on `provider` (free text).

### webhook_idempotency_keys (0008_platform.sql:87-101) — IDEMPOTENCY STATE MACHINE
```sql
CREATE TABLE IF NOT EXISTS public.webhook_idempotency_keys (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint         text        NOT NULL,
  idempotency_key  text        NOT NULL,
  status           text        NOT NULL CHECK (status IN ('in_progress','completed','failed')),
  response_body    jsonb,
  created_at       timestamptz DEFAULT now(),
  expires_at       timestamptz,
  UNIQUE (endpoint, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_wik_endpoint_key
  ON public.webhook_idempotency_keys (endpoint, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_wik_expires
  ON public.webhook_idempotency_keys (expires_at) WHERE expires_at IS NOT NULL;
```
- **status CHECK: `IN ('in_progress','completed','failed')`** (state machine: `in_progress -> completed | failed`, per file:86).
- UNIQUE: `(endpoint, idempotency_key)`. Sweep is by `expires_at` (cron 'idempotency-sweep', file:85).

### RLS + GRANTS for all four (0008_platform.sql:106-137)
```sql
ALTER TABLE public.platform_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_links           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_identities      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_idempotency_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_events_platform_all ON public.platform_events;
CREATE POLICY platform_events_platform_all ON public.platform_events FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS platform_links_platform_all ON public.platform_links;
CREATE POLICY platform_links_platform_all ON public.platform_links FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS external_identities_platform_all ON public.external_identities;
CREATE POLICY external_identities_platform_all ON public.external_identities FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS wik_platform_all ON public.webhook_idempotency_keys;
CREATE POLICY wik_platform_all ON public.webhook_idempotency_keys FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

GRANT ALL ON public.platform_events          TO authenticated, anon, service_role;
GRANT ALL ON public.platform_links           TO authenticated, anon, service_role;
GRANT ALL ON public.external_identities      TO authenticated, anon, service_role;
GRANT ALL ON public.webhook_idempotency_keys TO authenticated, anon, service_role;
```
All four are deny-by-default; single `FOR ALL` policy gated on `public.is_platform_admin()`; client roles get table-level GRANT but RLS still gates rows.

---

## 3. CURRENT full column list of `assignments` (0004 + 0005 + 0010)

Base table (0004_assignments_homework.sql:4-22):
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
  status                  text DEFAULT 'draft',
  teacher_reviewed        boolean DEFAULT false,
  teacher_override_reason text,
  push_status             text DEFAULT 'pending',
  reteach_needed          boolean DEFAULT false,
  scaffold_level          text,
  due_at                  timestamptz,
  created_at              timestamptz DEFAULT now()
);
```

Added later (idempotent ALTERs):
- **`skill_ids uuid[] NOT NULL DEFAULT '{}'`** — 0005_skills.sql:44-45 (deferred from 0004; FK-safe after `skills` exists; it is a `uuid[]`, NOT a join table).
- **`generation_model text`** — 0010_engine_columns.sql:71-72.

**Full effective `assignments` columns (in order):**
`id, quiz_attempt_id, student_id, class_id, lesson_id, mastery_band, assignment_mode, learning_style, content, status, teacher_reviewed, teacher_override_reason, push_status, reteach_needed, scaffold_level, due_at, created_at, skill_ids, generation_model`.

- `mastery_band` CHECK: `IN ('reteach','grade_level','advanced')` (teacher-only enum).
- 0011_signals.sql adds NO columns to `assignments` (it touches `homework_attempts`, `misconception_*`, `skill_learning_state`, `student_model_snapshots`, `quiz_attempts`).

---

## 4. Representative RLS-enable + policy + grant block (project style to match)

Best multi-audience template is `0011_signals.sql:39-127` for `misconception_observations` (staff-only read, service_role write, explicit GRANTs). VERBATIM:

```sql
ALTER TABLE public.misconception_observations ENABLE ROW LEVEL SECURITY;

-- Service role: full access (writes come from the grade-time recordMisconceptions lib)
DROP POLICY IF EXISTS "mo_service_role_all" ON public.misconception_observations;
CREATE POLICY "mo_service_role_all" ON public.misconception_observations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- C9: staff-only read (teacher/admin) — NOT school-scope-only (that repeats the peer-data hole).
-- Students and parents have NO read policy on this table.
DROP POLICY IF EXISTS "mo_school_read" ON public.misconception_observations;
CREATE POLICY "mo_school_read" ON public.misconception_observations
  FOR SELECT
  TO authenticated
  USING (
    (public.get_my_role() IN ('teacher', 'school_admin', 'school_sysadmin', 'platform_admin')
       AND school_id = public.get_my_school_id())
    OR public.is_platform_admin()
  );

-- misconception_observations: client SELECT (teachers read via RLS), full service_role write.
GRANT SELECT ON public.misconception_observations TO authenticated, anon;
GRANT ALL    ON public.misconception_observations TO service_role;
```

Platform-admin-only variant (e.g. for a metering/completions table not exposed to clients) — match `0008` four-table style:
```sql
ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS <t>_platform_all ON public.<t>;
CREATE POLICY <t>_platform_all ON public.<t> FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
GRANT ALL ON public.<t> TO authenticated, anon, service_role;
```

**Helper functions referenced by policies (used project-wide; defined in earlier migrations 0001/0009):**
- `public.is_platform_admin()`
- `public.get_my_school_id()`
- `public.get_my_role()` (returns role text; staff set = `('teacher','school_admin','school_sysadmin','platform_admin')`)
- `public.get_teacher_class_ids(auth.uid())` (used by assignments/homework_attempts read policies)

---

## 5. License / feature / entitlement system — DOES IT EXIST?

**A licensing system DOES exist — `supabase/migrations/0007_licensing.sql`.** It defines five tables:
`school_licenses`, `license_keys`, `license_usage`, `license_events`, `trial_events`.

### school_licenses (0007_licensing.sql:15-36) — has feature-flag JSONB columns
```sql
CREATE TABLE IF NOT EXISTS public.school_licenses (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id               uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE UNIQUE,
  tier                    text        NOT NULL CHECK (tier IN ('essentials','professional','enterprise')),
  status                  text        NOT NULL CHECK (status IN ('trialing','active','past_due','suspended','cancelled')),
  student_limit           int         NOT NULL DEFAULT 300,
  trial_starts_at         timestamptz,
  trial_ends_at           timestamptz,
  trial_converted         bool        DEFAULT false,
  starts_at               timestamptz,
  ends_at                 timestamptz,
  renewal_date            timestamptz,
  setup_fee_paid          bool        DEFAULT false,
  setup_fee_amount        int         DEFAULT 1500000,   -- cents ($15,000)
  stripe_customer_id      text,                          -- RESERVED: no code path may assume populated
  stripe_subscription_id  text,                          -- RESERVED
  billing_cycle           text        CHECK (billing_cycle IN ('annual','biannual')),
  feature_overrides       jsonb       DEFAULT '{}'::jsonb,
  feature_blocks          jsonb       DEFAULT '{}'::jsonb,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);
```
Feature gating uses **`feature_overrides jsonb` / `feature_blocks jsonb`** on `school_licenses` (NOT a dedicated per-feature table). RLS: `school_licenses_platform_all` (FOR ALL, is_platform_admin) + `school_licenses_member_read` (FOR SELECT, `school_id = public.get_my_school_id()`).

### >>> FLAG: NO `spark_experiences` table, NO dedicated Spark license/entitlement table exists.
- `spark_experiences` and `spark_completions` appear **ONLY in docs/specs**, never in `supabase/migrations/` or `src/`:
  - `docs/superpowers/specs/2026-06-20-spark-integration-phase1-design.md`
  - `docs/SCOPE.md`
  - `docs/superpowers/specs/2026-06-17-core-v2-p1-design.md`
  - `docs/spark-mining-findings.md`
- `license` matches in `src/`: `src/lib/trial/provisionTrial.ts` (+ its test) — provisioning writes `school_licenses` rows; there is no separate entitlements/feature-flag library or table.

---

## 6. Demo-school identity

From `src/lib/demo/demoCast.ts:42`:
```ts
export const DEMO_SCHOOL_NAME = 'CORE Demo School';
```
- The `schools` table has **no `slug` column**; `scripts/seedDemo.ts` looks the school up **by name** (`.eq('name', DEMO_SCHOOL_NAME)` at seedDemo.ts:115, insert at :126).
- Demo cast (demoCast.ts:44-46): teacher `Dana Whitfield` (role `teacher`), parent `Rosa Rivera` (role `parent`), admin `Priya Anand` (role `school_admin`). Per-student stable slug is `DemoStudent.key` (demoCast.ts:27).
- Demo skill slug used by seed: `'demo-skill-1'` (buildSeedRows.ts:358, seedDemo.ts:283).

---

## 7. FLAG summary

- **platform_events EXISTS** (0008_platform.sql:18). Columns: id, source, event_type, school_id, student_id, payload(jsonb), processed(bool), error(text), created_at. No CHECK/UNIQUE.
- **NO license/entitlement table for Spark exists.** Licensing = `0007_licensing.sql` (`school_licenses` + 4 others); Spark gating, if needed, would ride on `school_licenses.feature_overrides`/`feature_blocks` JSONB or a NEW table. `spark_experiences`/`spark_completions` are spec-only, unbuilt.
- **webhook_idempotency_keys columns (exact):** `id uuid PK`, `endpoint text NOT NULL`, `idempotency_key text NOT NULL`, `status text NOT NULL CHECK (status IN ('in_progress','completed','failed'))`, `response_body jsonb`, `created_at timestamptz DEFAULT now()`, `expires_at timestamptz`, `UNIQUE (endpoint, idempotency_key)`. State machine: `in_progress -> completed | failed`; sweep by `expires_at`.
- **Next migration:** `0012_<name>.sql`.
- Note: 0011 header (file:11) and 0011-era tables note "NOT applied live here — see Task 17 (post-build MCP apply)"; 0010 header (file:5) says it IS applied live with 0001-0009. Live-vs-repo migration application state for 0010/0011 is annotated in-file but not verified by this grounding pass.
