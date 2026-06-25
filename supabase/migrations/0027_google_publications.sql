-- supabase/migrations/0027_google_publications.sql
-- GC Segment 3: maps a CORE unit (quiz / assignment-by-LESSON) or the per-course Open-CORE link to
-- its Google Classroom courseWork/material. Written ONLY via the admin client (service_role) by the
-- publish engine; NO authenticated read path this segment (the UI gating flag is also an admin-client
-- read, server-side). Mirrors the 0026 audit_logs deny-by-default RLS pattern.
CREATE TABLE IF NOT EXISTS public.google_publications (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id              uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id               uuid        NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  resource_type          text        NOT NULL CHECK (resource_type IN ('quiz','assignment','course_link')),
  -- resource_id: quizzes.id (quiz) | lessons.id (assignment unit — there is NO class-wide
  -- assignments.id; the lesson IS the assignment column, see C1) | class_id sentinel (course_link).
  resource_id            text,
  google_course_id       text        NOT NULL,
  google_coursework_id   text        NOT NULL,   -- the GC courseWork id (or courseWorkMaterials id for course_link)
  grade_passback_enabled boolean     NOT NULL DEFAULT false,  -- true only for assignments
  max_points             integer     NOT NULL DEFAULT 100,    -- null/unused semantics for quizzes (never push)
  last_sync_error        text,
  created_by             uuid,                   -- the teacher; no FK (trail durability)
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_type, resource_id, google_course_id)
);

CREATE INDEX IF NOT EXISTS idx_gpub_class    ON public.google_publications (class_id);
CREATE INDEX IF NOT EXISTS idx_gpub_resource ON public.google_publications (resource_type, resource_id);

-- M2: the UNIQUE above does NOT constrain the per-course Open-CORE link (we now store
-- resource_id = class_id sentinel, so it's distinct per class). Belt-and-braces, enforce ONE
-- course_link per google_course_id at the DB level so two concurrent first-publishes can't
-- double-pin "Open CORE" (mirrors 0024's partial-unique idiom); the engine tolerates 23505.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gpub_course_link
  ON public.google_publications (google_course_id) WHERE resource_type = 'course_link';

ALTER TABLE public.google_publications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gpub_service_role_all" ON public.google_publications;
CREATE POLICY "gpub_service_role_all" ON public.google_publications
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- M3: RLS DENIES all authenticated rows (there is NO authenticated SELECT policy). The read path
-- — both the engine's idempotency SELECTs AND the UI gating flag — is the service-role admin client
-- ONLY. The table-level GRANT below mirrors the 0026 house pattern (authenticated gets the grant but
-- every row is still denied by RLS); NO anon grant.
GRANT SELECT ON public.google_publications TO authenticated;
GRANT ALL    ON public.google_publications TO service_role;
