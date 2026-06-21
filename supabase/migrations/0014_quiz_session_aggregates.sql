-- 0014_quiz_session_aggregates.sql
-- Running session-level behavioral aggregate written by the heartbeat /signal route
-- and read by the submit signal-store hook to build SessionAggregates for computeSignals.
ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS session_aggregates jsonb NOT NULL DEFAULT '{}'::jsonb;
