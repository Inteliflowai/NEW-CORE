-- supabase/migrations/0011_signals.sql
-- Plan 3 signals layer:
--   • homework_attempts: effort_label + redo flags (idempotent named CHECK per C16)
--   • misconception_types: canonical 14-row taxonomy seed (C5), SELECT-only client grants (C17)
--   • misconception_observations: per-OEQ occurrence table, staff-only RLS (C9)
--   • student_model_snapshots.consistency_score column
--   • skill_learning_state sls_school_read TIGHTENED to staff-only (C9)
--   • student_model_snapshots sms_scoped_read TIGHTENED to own-row + guardian + staff (C21)
--   • quiz_attempts.grading_status CHECK (idempotent DO-block)
-- Idempotent: ADD COLUMN IF NOT EXISTS throughout; DO-block CHECK swaps for named constraints.
-- NOT applied live here — see Task 17 (post-build MCP apply).

-- ── homework_attempts: effort_label + redo flags ───────────────────────────────
-- C16: split column ADD from CHECK so the named constraint is always (re)applied.
ALTER TABLE public.homework_attempts ADD COLUMN IF NOT EXISTS effort_label text;
ALTER TABLE public.homework_attempts ADD COLUMN IF NOT EXISTS allow_redo boolean DEFAULT false;
ALTER TABLE public.homework_attempts ADD COLUMN IF NOT EXISTS is_redo boolean DEFAULT false;
ALTER TABLE public.homework_attempts ADD COLUMN IF NOT EXISTS flagged_by text;

-- C16: idempotent named CHECK (drop-if-exists then add, pattern from 0010's question_type swap).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'homework_attempts_effort_label_check') THEN
    ALTER TABLE public.homework_attempts DROP CONSTRAINT homework_attempts_effort_label_check;
  END IF;
END $$;
ALTER TABLE public.homework_attempts
  ADD CONSTRAINT homework_attempts_effort_label_check
  CHECK (effort_label IS NULL OR effort_label IN (
    'effortful_success',
    'struggling_trying',
    'independent_success',
    'independent_struggle'
  ));

-- ── misconception_types: reference vocabulary (C5 canonical taxonomy) ──────────
-- First-class taxonomy (8 error_type + 6 reasoning_pattern, Barb-ratified).
-- C17: SELECT-only to clients; ALL to service_role only (below, in grants section).
CREATE TABLE IF NOT EXISTS public.misconception_types (
  code          text    PRIMARY KEY,
  kind          text    NOT NULL CHECK (kind IN ('error_type', 'reasoning_pattern')),
  display_label text    NOT NULL,
  sort_order    int,
  active        boolean DEFAULT true
);

-- C5: Seed error_type codes (8 — verbatim from V1 lib/openai/prompts.ts:589)
INSERT INTO public.misconception_types (code, kind, display_label, sort_order, active)
VALUES
  ('none',                   'error_type', 'No error',                1, true),
  ('factual_error',          'error_type', 'Factual error',           2, true),
  ('reasoning_gap',          'error_type', 'Incomplete reasoning',    3, true),
  ('incomplete',             'error_type', 'Incomplete response',     4, true),
  ('misunderstood_question', 'error_type', 'Misunderstood question',  5, true),
  ('vocabulary_confusion',   'error_type', 'Vocabulary confusion',    6, true),
  ('off_topic',              'error_type', 'Off-topic response',      7, true),
  ('blank',                  'error_type', 'Blank or no response',    8, true)
ON CONFLICT (code) DO NOTHING;

-- C5: Seed reasoning_pattern codes (6 — verbatim from V1 lib/openai/prompts.ts:590)
INSERT INTO public.misconception_types (code, kind, display_label, sort_order, active)
VALUES
  ('surface_recall',       'reasoning_pattern', 'Surface recall',       1, true),
  ('partial_reasoning',    'reasoning_pattern', 'Partial reasoning',    2, true),
  ('full_reasoning',       'reasoning_pattern', 'Full reasoning',       3, true),
  ('misconception',        'reasoning_pattern', 'Misconception',        4, true),
  ('creative_extension',   'reasoning_pattern', 'Creative extension',   5, true),
  ('blank_or_off_topic',   'reasoning_pattern', 'Blank or off-topic',   6, true)
ON CONFLICT (code) DO NOTHING;

-- ── misconception_observations: per-OEQ occurrence ────────────────────────────
CREATE TABLE IF NOT EXISTS public.misconception_observations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       uuid        NOT NULL REFERENCES public.users(id)          ON DELETE CASCADE,
  skill_id         uuid        REFERENCES public.skills(id)                  ON DELETE SET NULL,
  quiz_response_id uuid        REFERENCES public.quiz_responses(id)          ON DELETE SET NULL,
  school_id        uuid        REFERENCES public.schools(id)                 ON DELETE CASCADE,
  error_type       text,
  reasoning_pattern text,
  observed_at      timestamptz DEFAULT now()
);

-- Lookup index for recurring-error query (student + skill + error_type)
CREATE INDEX IF NOT EXISTS idx_mo_student_skill_error
  ON public.misconception_observations (student_id, skill_id, error_type);

-- ── RLS: misconception_observations ───────────────────────────────────────────
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

-- ── Grants ─────────────────────────────────────────────────────────────────────
-- C17: misconception_types is SELECT-only to clients (reference vocabulary, not client-writable).
GRANT SELECT ON public.misconception_types TO authenticated, anon;
GRANT ALL    ON public.misconception_types TO service_role;

-- misconception_observations: client SELECT (teachers read via RLS), full service_role write.
GRANT SELECT ON public.misconception_observations TO authenticated, anon;
GRANT ALL    ON public.misconception_observations TO service_role;

-- ── RLS: skill_learning_state — TIGHTEN sls_school_read (C9) ──────────────────
-- 0005's sls_school_read used school_id = get_my_school_id() which let same-school
-- students/parents read peer skill states (live hole). Replace with staff-only.
DROP POLICY IF EXISTS sls_school_read ON public.skill_learning_state;
CREATE POLICY sls_school_read ON public.skill_learning_state
  FOR SELECT TO authenticated
  USING (
    (public.get_my_role() IN ('teacher', 'school_admin', 'school_sysadmin', 'platform_admin')
       AND school_id = public.get_my_school_id())
    OR public.is_platform_admin()
  );

-- ── RLS: student_model_snapshots — TIGHTEN sms_scoped_read (C21) ──────────────
-- 0006's sms_scoped_read included school_id = get_my_school_id() which let same-school
-- students/parents read PEERS' mastery/risk/strength snapshots (live hole). Replace with:
--   student reads own row | guardian reads child | staff reads school | platform_admin
-- guardians(parent_id, student_id) confirmed in 0001.
DROP POLICY IF EXISTS "sms_scoped_read" ON public.student_model_snapshots;
CREATE POLICY "sms_scoped_read" ON public.student_model_snapshots
  FOR SELECT TO authenticated
  USING (
    student_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.guardians g
      WHERE g.parent_id = auth.uid() AND g.student_id = student_model_snapshots.student_id
    )
    OR (public.get_my_role() IN ('teacher', 'school_admin', 'school_sysadmin', 'platform_admin')
        AND school_id = public.get_my_school_id())
    OR public.is_platform_admin()
  );

-- ── student_model_snapshots: add consistency_score ────────────────────────────
-- consistency_label already exists (0006); consistency_score (0-100 numeric)
-- is the computed value from std-dev of last 5 quiz score_pct values.
ALTER TABLE public.student_model_snapshots
  ADD COLUMN IF NOT EXISTS consistency_score numeric;

-- ── quiz_attempts: add grading_status CHECK (idempotent DO-block) ─────────────
-- grading_status column already exists (0010_engine_columns.sql, unconstrained text).
-- Drop any existing CHECK on grading_status, then add named constraint.
-- Pattern matches 0010's question_type CHECK swap.
DO $$
DECLARE
  _con name;
BEGIN
  SELECT conname INTO _con
  FROM pg_constraint
  WHERE conrelid = 'public.quiz_attempts'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%grading_status%';

  IF _con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.quiz_attempts DROP CONSTRAINT %I', _con);
  END IF;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE public.quiz_attempts
  ADD CONSTRAINT quiz_attempts_grading_status_check
  CHECK (grading_status IS NULL OR grading_status IN ('pending', 'complete'));
