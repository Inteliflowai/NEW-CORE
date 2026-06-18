-- supabase/migrations/0010_engine_columns.sql
-- Engine columns the P2 quiz/attempt/assignment engine needs (Tasks 4/6/8).
-- Idempotent: every statement uses ADD COLUMN IF NOT EXISTS.
-- The question_type CHECK is extended to include 'numeric' (C13).
-- This migration is applied to the live DB together with 0001-0009.

-- ── quizzes ───────────────────────────────────────────────
ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS is_math boolean DEFAULT false;

ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS generation_model text;

-- ── quiz_questions ────────────────────────────────────────
ALTER TABLE public.quiz_questions
  ADD COLUMN IF NOT EXISTS numeric_spec jsonb;

ALTER TABLE public.quiz_questions
  ADD COLUMN IF NOT EXISTS rubric_version text;

-- Extend question_type CHECK to include 'numeric' (C13).
-- Pattern: DROP the old constraint, ADD the new one.
-- Both operations are wrapped in DO blocks so they are no-ops if the
-- constraint is already in the desired state (idempotent re-runs).
DO $$
BEGIN
  -- Drop the old CHECK that only allowed mcq|open, if it exists.
  -- pg_get_constraintdef catches the constraint by scanning its definition
  -- so this is safe whether the constraint is named or not.
  DECLARE
    _con name;
  BEGIN
    SELECT conname INTO _con
    FROM pg_constraint
    WHERE conrelid = 'public.quiz_questions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%question_type%';

    IF _con IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.quiz_questions DROP CONSTRAINT %I', _con);
    END IF;
  END;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE public.quiz_questions
  ADD CONSTRAINT quiz_questions_question_type_check
  CHECK (question_type IN ('mcq','open','numeric'));

-- ── quiz_attempts ─────────────────────────────────────────
ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS adapted_questions jsonb;

ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS grading_status text;

ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS grading_failed boolean DEFAULT false;

ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS raw_score numeric;

ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS score_pct numeric;

-- ── quiz_responses ────────────────────────────────────────
ALTER TABLE public.quiz_responses
  ADD COLUMN IF NOT EXISTS grading_output jsonb;

-- ── assignments ───────────────────────────────────────────
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS generation_model text;
