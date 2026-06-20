-- 0012_spark.sql — SPARK Phase 1: completion ingestion store + assignment↔SPARK binding.
-- Additive + idempotent. Builds on 0008_platform.sql (platform_links/webhook_idempotency_keys/
-- platform_events already exist). RLS mirrors 0011_signals.sql misconception_observations
-- (service_role full; staff school-scoped SELECT; no student/parent read).
-- NOT applied live here — apply via Supabase MCP at merge time (see ops handoff doc).

-- ── 1. Assignment ↔ SPARK binding columns (additive) ──────────────────────────
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS spark_assignment_id text,   -- CORE-generated correlation id sent to SPARK
  ADD COLUMN IF NOT EXISTS spark_attempt_id    text,   -- SPARK's returned spark_attempt_id
  ADD COLUMN IF NOT EXISTS spark_experiment_id text,   -- SPARK's returned synthetic_experiment_id
  ADD COLUMN IF NOT EXISTS spark_status        text DEFAULT 'none';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignments_spark_status_check') THEN
    ALTER TABLE public.assignments
      ADD CONSTRAINT assignments_spark_status_check
      CHECK (spark_status IN ('none','notified','created','in_progress','completed','notify_failed'));
  END IF;
END $$;

-- ── 2. spark_completions — one row per (assignment, student); analyzer pass updates it ───
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

CREATE INDEX IF NOT EXISTS idx_spark_completions_student    ON public.spark_completions (student_id);
CREATE INDEX IF NOT EXISTS idx_spark_completions_assignment ON public.spark_completions (assignment_id);
CREATE INDEX IF NOT EXISTS idx_spark_completions_school     ON public.spark_completions (school_id);

-- ── 3. RLS: service_role full; staff (teacher/admin) school-scoped SELECT; no student/parent ──
ALTER TABLE public.spark_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "spark_completions_service_role_all" ON public.spark_completions;
CREATE POLICY "spark_completions_service_role_all" ON public.spark_completions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "spark_completions_staff_read" ON public.spark_completions;
CREATE POLICY "spark_completions_staff_read" ON public.spark_completions
  FOR SELECT TO authenticated
  USING (
    (public.get_my_role() IN ('teacher','school_admin','school_sysadmin','platform_admin')
       AND school_id = public.get_my_school_id())
    OR public.is_platform_admin()
  );

GRANT SELECT ON public.spark_completions TO authenticated, anon;
GRANT ALL    ON public.spark_completions TO service_role;
