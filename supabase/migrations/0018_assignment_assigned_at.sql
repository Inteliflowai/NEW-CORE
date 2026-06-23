-- 0018_assignment_assigned_at.sql
-- Gradebook v1.1: an explicit "assigned date" on assignments, stamped once at generation
-- and never changed (independent of due_at, which may be overridden per student). Becomes
-- part of the gradebook column key (lesson + assigned-day) so same-lesson work on different
-- days splits into separate dated columns. No RLS change (assignments RLS unchanged).
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

-- Backfill existing rows to their creation day so historical columns split sensibly.
-- (No column-level DEFAULT: a now() default would stamp every existing row with the
-- migration-run instant and collapse all history into one column.)
UPDATE public.assignments SET assigned_at = created_at WHERE assigned_at IS NULL;
