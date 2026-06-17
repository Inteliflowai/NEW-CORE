-- supabase/migrations/0006_snapshots.sql
-- LIFT V1 039_longitudinal_data.sql (student_model_snapshots table) +
--      V1 046_snapshot_schema_v2.sql (six signal fields + snapshot_schema_version).
-- Trajectory grain = per (student, week). Weekly write job is a later-plan cron,
-- idempotent per (student, week).
-- "<4 weeks of data" is the cold-start empty state for the "you vs 4 weeks ago" UI.
--
-- Forward-ref safety: FKs only to users, schools, classes (all exist by 0006).
-- No FK to tables created after 0006.

CREATE TABLE IF NOT EXISTS public.student_model_snapshots (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id                uuid        NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  school_id                 uuid        REFERENCES public.schools(id)          ON DELETE CASCADE,
  class_id                  uuid        REFERENCES public.classes(id)          ON DELETE CASCADE,
  snapshot_date             date        NOT NULL DEFAULT CURRENT_DATE,

  -- V1 039 base model fields
  mastery_band              text        CHECK (mastery_band IN ('reteach','grade_level','advanced')),
  learning_style            text,
  consistency_label         text,
  dominant_effort_pattern   text,
  preferred_scaffold_level  text,
  avg_score                 numeric,
  total_quizzes             integer,
  total_homework            integer,
  strength_topics           text[],
  struggle_topics           text[],
  improvement_4w            numeric,

  -- V1 046 signal fields the tribe/historical classifier reads (046:29-42)
  risk_score                numeric,
  avg_hints_per_attempt     numeric,
  divergence_direction      text,
  divergence_score          numeric,
  recent_effort_labels      jsonb       DEFAULT '[]'::jsonb,

  -- Forensic hygiene stamp: NULL = pre-v2 row, 'v2' = written by this schema onward
  snapshot_schema_version   text        CHECK (snapshot_schema_version IS NULL
                                           OR snapshot_schema_version IN ('v1','v2')),

  created_at                timestamptz DEFAULT now(),

  UNIQUE (student_id, snapshot_date)
);

-- Per-student DESC index for recent-snapshot queries (039 pattern)
CREATE INDEX IF NOT EXISTS idx_sms_student_date
  ON public.student_model_snapshots (student_id, snapshot_date DESC);

-- Partial index for COMEBACK + PATTERN rules that filter v2 snapshots (046 pattern)
CREATE INDEX IF NOT EXISTS idx_sms_v2_recent
  ON public.student_model_snapshots (student_id, snapshot_date DESC)
  WHERE snapshot_schema_version = 'v2';

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.student_model_snapshots ENABLE ROW LEVEL SECURITY;

-- Service role full access (snapshots are written by cron/service, not authenticated users)
DROP POLICY IF EXISTS "sms_service_role_write" ON public.student_model_snapshots;
CREATE POLICY "sms_service_role_write" ON public.student_model_snapshots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read their own snapshot or snapshots in their school
DROP POLICY IF EXISTS "sms_scoped_read" ON public.student_model_snapshots;
CREATE POLICY "sms_scoped_read" ON public.student_model_snapshots
  FOR SELECT
  TO authenticated
  USING (
    student_id = auth.uid()
    OR school_id = public.get_my_school_id()
    OR public.is_platform_admin()
  );

-- ── Grants ───────────────────────────────────────────────────────────────────
GRANT ALL ON public.student_model_snapshots TO authenticated, anon, service_role;
