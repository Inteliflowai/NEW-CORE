-- ============================================================
-- 0002_classes_enrollments.sql
-- LIFT V1 000_full_schema.sql (classes, enrollments) + 049 seat-enforcement trigger.
-- The trigger reads school_licenses.student_limit (created in 0007).
-- Guarded by to_regclass('public.school_licenses') so a live db push of 0002 won't
-- fail when school_licenses does not yet exist.
-- Order: tables → helpers (bodies query enrollments/classes now present) → RLS policies.
-- ============================================================

-- ── Classes ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.classes (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id                 uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  teacher_id                uuid        REFERENCES public.users(id) ON DELETE CASCADE,
  name                      text        NOT NULL,
  subject                   text,
  grade_level               text,
  period                    text,
  google_course_id          text,
  google_grade_sync_enabled boolean     DEFAULT false,
  google_feed_enabled       boolean     DEFAULT false,
  enrollment_count          int         DEFAULT 0,
  is_active                 boolean     DEFAULT true,
  created_at                timestamptz DEFAULT now()
);

-- ── Enrollments ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.enrollments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id    uuid        NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id  uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  enrolled_at timestamptz DEFAULT now(),
  is_active   boolean     DEFAULT true,
  UNIQUE(class_id, student_id)
);

-- ── Seat-enforcement trigger (LIFT 049:169-222) ──────────────
-- Hard-stops enrollments past the school_licenses.student_limit.
-- Guarded by to_regclass so 0002 is inert until 0007 (school_licenses) exists.
CREATE OR REPLACE FUNCTION public.enforce_enrollment_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_school_id    uuid;
  v_current_count integer;
  v_limit        integer;
BEGIN
  -- to_regclass guard: school_licenses is created in 0007; until then, allow all.
  IF to_regclass('public.school_licenses') IS NULL THEN RETURN NEW; END IF;

  -- Resolve student's school
  SELECT school_id INTO v_school_id FROM public.users WHERE id = NEW.student_id;
  IF v_school_id IS NULL THEN
    RETURN NEW; -- no school = unprovisioned, let it through (e.g. demo seed)
  END IF;

  -- Resolve license limit (active licenses only — trial/pilot = no enforcement)
  SELECT student_limit INTO v_limit
    FROM public.school_licenses
   WHERE school_id = v_school_id
     AND status = 'active'
   LIMIT 1;
  IF v_limit IS NULL THEN
    RETURN NEW; -- no active license = trial / pilot, no enforcement
  END IF;

  -- Count distinct enrolled students at this school
  SELECT COUNT(DISTINCT u.id) INTO v_current_count
    FROM public.users u
    JOIN public.enrollments e ON e.student_id = u.id
   WHERE u.school_id = v_school_id
     AND u.role = 'student'
     AND u.is_active = true;

  -- Allow re-enrollments of existing students; only block new ones past limit
  IF v_current_count >= v_limit THEN
    -- Check if this student is already enrolled in any class at this school
    IF NOT EXISTS (
      SELECT 1 FROM public.enrollments e2
        JOIN public.users u2 ON u2.id = e2.student_id
       WHERE u2.school_id = v_school_id
         AND e2.student_id = NEW.student_id
    ) THEN
      RAISE EXCEPTION 'Enrollment limit reached: school has % students, license allows %', v_current_count, v_limit
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_enrollment_limit ON public.enrollments;
CREATE TRIGGER trg_enforce_enrollment_limit
  BEFORE INSERT ON public.enrollments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_enrollment_limit();

-- ── Enrollment/class SECURITY DEFINER RLS helpers ────────────
-- Defined HERE (after classes + enrollments exist) per spec ordering.
-- Absent from 0001 to avoid forward-ref against tables not yet created.

CREATE OR REPLACE FUNCTION public.get_teacher_student_ids(teacher_uuid uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT e.student_id FROM public.enrollments e
  JOIN public.classes c ON c.id = e.class_id
  WHERE c.teacher_id = teacher_uuid AND e.is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.get_teacher_class_ids(teacher_uuid uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.classes WHERE teacher_id = teacher_uuid;
$$;

CREATE OR REPLACE FUNCTION public.get_student_class_ids(student_uuid uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT class_id FROM public.enrollments WHERE student_id = student_uuid AND is_active = true;
$$;

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.classes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;

-- Classes policies
DROP POLICY IF EXISTS classes_school_read ON public.classes;
CREATE POLICY classes_school_read ON public.classes FOR SELECT TO authenticated
  USING (
    teacher_id = auth.uid()
    OR school_id = public.get_my_school_id()
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS classes_teacher_write ON public.classes;
CREATE POLICY classes_teacher_write ON public.classes FOR ALL TO authenticated
  USING (teacher_id = auth.uid() OR public.is_platform_admin())
  WITH CHECK (teacher_id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS classes_service ON public.classes;
CREATE POLICY classes_service ON public.classes FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Enrollments policies
-- NOTE: enrollments_school_read references get_teacher_class_ids — defined ABOVE.
DROP POLICY IF EXISTS enrollments_school_read ON public.enrollments;
CREATE POLICY enrollments_school_read ON public.enrollments FOR SELECT TO authenticated
  USING (
    class_id IN (SELECT public.get_teacher_class_ids(auth.uid()))
    OR student_id = auth.uid()
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS enrollments_teacher_write ON public.enrollments;
CREATE POLICY enrollments_teacher_write ON public.enrollments FOR ALL TO authenticated
  USING (
    class_id IN (SELECT public.get_teacher_class_ids(auth.uid()))
    OR public.is_platform_admin()
  )
  WITH CHECK (
    class_id IN (SELECT public.get_teacher_class_ids(auth.uid()))
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS enrollments_service ON public.enrollments;
CREATE POLICY enrollments_service ON public.enrollments FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── PostgREST grants ─────────────────────────────────────────
GRANT ALL ON public.classes     TO authenticated, anon, service_role;
GRANT ALL ON public.enrollments TO authenticated, anon, service_role;
