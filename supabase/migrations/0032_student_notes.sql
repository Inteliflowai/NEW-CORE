-- 0032_student_notes.sql — private per-student teacher notes.
-- Backs the One-Student drill-in "Add note" button (deferred since Epic 3 —
-- "no backing store"). Notes are PRIVATE TO THE AUTHORING TEACHER: the API
-- filters author_id = caller on every read. Deny-by-default RLS (the `alerts`
-- pattern, 0017): service_role only — app routes enforce STAFF_ROLES +
-- guardStudentAccess + author scoping. NO student/parent read path exists
-- (four-audience: this table must never surface outside teacher routes).

CREATE TABLE IF NOT EXISTS public.student_notes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid        REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id   uuid        REFERENCES public.classes(id) ON DELETE SET NULL,
  student_id uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  author_id  uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  note_text  text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_notes_lookup_idx
  ON public.student_notes (student_id, author_id, created_at DESC);

ALTER TABLE public.student_notes ENABLE ROW LEVEL SECURITY;

-- service_role full access; NO authenticated policies (deny-by-default).
-- DROP-first: CREATE POLICY has no IF NOT EXISTS (house idempotency pattern).
DROP POLICY IF EXISTS student_notes_service_all ON public.student_notes;
CREATE POLICY student_notes_service_all ON public.student_notes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT ALL ON public.student_notes TO service_role;
