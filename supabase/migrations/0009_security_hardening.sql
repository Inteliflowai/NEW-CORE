-- ============================================================
-- 0009_security_hardening.sql
-- Security hardening: fix mutable search_path + revoke RPC exposure.
-- Re-runnable: CREATE OR REPLACE; REVOKE is idempotent.
-- ============================================================

-- ── 1. Fix mutable search_path on enforce_enrollment_limit ──
-- Exact body from 0002_classes_enrollments.sql; ONLY adds SET search_path = public.
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 2. Fix mutable search_path on handle_license_updated_at ──
-- Exact body from 0007_licensing.sql; ONLY adds SET search_path = public.
CREATE OR REPLACE FUNCTION public.handle_license_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ── 3. Revoke EXECUTE on SECURITY DEFINER helpers from anon / PUBLIC ──
-- These helpers are only ever called inside RLS policies scoped TO authenticated,
-- so anon has no legitimate use for them — and exposing SECURITY DEFINER functions
-- to anon via /rpc/ is a Supabase security advisory violation.

-- Revoke from PUBLIC first (covers anon implicitly), then be explicit about anon.
REVOKE EXECUTE ON FUNCTION public.is_platform_admin()           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_school_id()            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_role()                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_teacher_class_ids(uuid)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_teacher_student_ids(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_student_class_ids(uuid)   FROM PUBLIC, anon;

-- Also revoke anon from the two trigger functions (not RLS helpers, but SECURITY DEFINER
-- trigger functions should never be callable via /rpc/ by anon).
REVOKE EXECUTE ON FUNCTION public.enforce_enrollment_limit()   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_license_updated_at()  FROM PUBLIC, anon;

-- Ensure authenticated + service_role retain EXECUTE (re-grants for idempotency).
GRANT EXECUTE ON FUNCTION public.is_platform_admin()           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_school_id()            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_role()                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_teacher_class_ids(uuid)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_teacher_student_ids(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_student_class_ids(uuid)   TO authenticated, service_role;
