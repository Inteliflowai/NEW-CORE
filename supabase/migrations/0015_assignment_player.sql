-- supabase/migrations/0015_assignment_player.sql
-- Epic 2 / Segment 1 — Assignment Player foundation.
-- Adds the player-produced columns to homework_attempts + a named status CHECK.
-- Tutor tables (tutor_sessions/tutor_messages) and the student-work storage bucket
-- land in their own later migrations (Segments 3/4). Idempotent throughout.
-- hours_to_submit is bare numeric (the route rounds to 1 dp before writing).

ALTER TABLE public.homework_attempts ADD COLUMN IF NOT EXISTS task_grades     jsonb;
ALTER TABLE public.homework_attempts ADD COLUMN IF NOT EXISTS hours_to_submit numeric;
ALTER TABLE public.homework_attempts ADD COLUMN IF NOT EXISTS review_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.homework_attempts ADD COLUMN IF NOT EXISTS attempt_no      int     NOT NULL DEFAULT 1;

-- Named status CHECK (idempotent drop-then-add, pattern from 0011's effort_label swap).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'homework_attempts_status_check') THEN
    ALTER TABLE public.homework_attempts DROP CONSTRAINT homework_attempts_status_check;
  END IF;
END $$;
ALTER TABLE public.homework_attempts
  ADD CONSTRAINT homework_attempts_status_check
  CHECK (status IN ('in_progress','submitted','grading','graded','pending_grade'));
