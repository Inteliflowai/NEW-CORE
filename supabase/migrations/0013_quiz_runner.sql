-- 0013_quiz_runner.sql
-- Student Quiz Runner foundation: forfeit/resume liveness + study-guide cache on
-- quiz_attempts; behavioral-aggregate completeness + heartbeat-upsert constraint on
-- quiz_responses; and the dedicated per-student behavioral_signals EMA model
-- (the coach's evolving understanding — replaces V1's cognitive_signals/student_model
-- /signal_aggregates/signal_history sprawl with one model).
-- Additive only. FKs only to users/schools (exist by 0001).

ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz,
  ADD COLUMN IF NOT EXISTS forfeit_reason text
    CHECK (forfeit_reason IS NULL OR forfeit_reason IN ('closure','time_up')),
  ADD COLUMN IF NOT EXISTS study_guide text;

ALTER TABLE public.quiz_responses
  ADD COLUMN IF NOT EXISTS focus_loss_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paste_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hints_used integer NOT NULL DEFAULT 0;

-- Required for the heartbeat upsert onConflict(attempt_id, question_id).
-- Guarded so re-runs don't error if it already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quiz_responses_attempt_question_unique'
  ) THEN
    ALTER TABLE public.quiz_responses
      ADD CONSTRAINT quiz_responses_attempt_question_unique UNIQUE (attempt_id, question_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.behavioral_signals (
  student_id        uuid        PRIMARY KEY REFERENCES public.users(id)   ON DELETE CASCADE,
  school_id         uuid        REFERENCES public.schools(id)             ON DELETE CASCADE,
  computed          jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- latest EMA-smoothed ComputedSignals
  observation_count integer     NOT NULL DEFAULT 0,             -- # of submits folded into the model
  updated_at        timestamptz NOT NULL DEFAULT now()
);
