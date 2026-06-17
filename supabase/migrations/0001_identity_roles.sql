-- ============================================================
-- 0001_identity_roles.sql
-- LIFT V1 000_full_schema.sql (schools/users/guardians) + 035 trial cols.
-- 6th role reconciliation (spec §1.2): V1 000 enum omitted 'school_sysadmin'
-- though V1 code (guards.ts, requireSchoolAdmin.ts) depends on it — added here.
-- SECURITY DEFINER helpers: only is_platform_admin(), get_my_school_id(),
-- get_my_role() — functions whose bodies reference ONLY tables defined in
-- this migration. get_teacher_student_ids / get_teacher_class_ids /
-- get_student_class_ids reference enrollments/classes (0002) — defined there.
-- ============================================================

-- ── Schools ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.schools (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     text        NOT NULL,
  domain                   text,
  timezone                 text        DEFAULT 'America/New_York',
  google_classroom_enabled boolean     DEFAULT false,
  parent_profile_visible   boolean     DEFAULT true,
  is_active                boolean     DEFAULT true,
  demo_mode                boolean     DEFAULT false,
  demo_expires_at          timestamptz,
  welcome_completed        boolean     DEFAULT false,
  -- Trial / presentation state (LIFT 035; school_licenses.status is the gating SoT, spec §2.3)
  is_trial                 boolean     DEFAULT false,
  trial_started_at         timestamptz,
  trial_expires_at         timestamptz,
  trial_status             text        DEFAULT 'inactive'
                           CHECK (trial_status IN ('inactive','active','expired','converted','cancelled')),
  trial_plan               text        DEFAULT 'pro',
  trial_source             text,
  hl_contact_id            text,
  trial_credentials        jsonb       DEFAULT '{}',
  -- Anti-piracy domain lock (LIFT 049)
  allowed_email_domains    jsonb       DEFAULT '[]',
  created_at               timestamptz DEFAULT now()
);

-- ── Users (canonical identity; role discriminates teacher/student/parent/admin) ──
CREATE TABLE IF NOT EXISTS public.users (
  id              uuid        PRIMARY KEY REFERENCES auth.users(id),
  school_id       uuid        REFERENCES public.schools(id),
  role            text        NOT NULL CHECK (role IN ('teacher','student','parent','school_admin','school_sysadmin','platform_admin')),
  full_name       text        NOT NULL,
  email           text        NOT NULL,
  avatar_url      text,
  display_name    text,
  grade_levels    text,
  subjects        text,
  parent_id       uuid        REFERENCES public.users(id),
  grade_level     text,
  is_active       boolean     DEFAULT true,
  last_active_at  timestamptz,
  lift_candidate_id text,
  lift_data       jsonb,
  -- Trial columns (LIFT 035)
  is_trial_user   boolean     DEFAULT false,
  trial_school_id uuid        REFERENCES public.schools(id),
  created_at      timestamptz DEFAULT now()
);

-- ── Guardians (parent ↔ student link — Parent screen has no data path without it) ──
CREATE TABLE IF NOT EXISTS public.guardians (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id  uuid NOT NULL REFERENCES public.users(id),
  student_id uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(parent_id, student_id)
);

-- ── SECURITY DEFINER RLS helpers ─────────────────────────────
-- Only helpers whose bodies touch tables defined in THIS migration.
-- get_teacher_student_ids / get_teacher_class_ids / get_student_class_ids
-- reference enrollments/classes — those are defined in 0002 and live there.

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'platform_admin');
$$;

CREATE OR REPLACE FUNCTION public.get_my_school_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT school_id FROM public.users WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.schools   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardians ENABLE ROW LEVEL SECURITY;

-- Schools policies
DROP POLICY IF EXISTS schools_member_read ON public.schools;
CREATE POLICY schools_member_read ON public.schools FOR SELECT TO authenticated
  USING (id = public.get_my_school_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS schools_admin_all ON public.schools;
CREATE POLICY schools_admin_all ON public.schools FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Users policies
DROP POLICY IF EXISTS users_self_read ON public.users;
CREATE POLICY users_self_read ON public.users FOR SELECT TO authenticated
  USING (id = auth.uid() OR school_id = public.get_my_school_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS users_self_update ON public.users;
CREATE POLICY users_self_update ON public.users FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_platform_admin())
  WITH CHECK (id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS users_insert_service ON public.users;
CREATE POLICY users_insert_service ON public.users FOR INSERT TO service_role
  WITH CHECK (true);

-- Guardians policies
DROP POLICY IF EXISTS guardians_member_read ON public.guardians;
CREATE POLICY guardians_member_read ON public.guardians FOR SELECT TO authenticated
  USING (parent_id = auth.uid() OR student_id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS guardians_insert_service ON public.guardians;
CREATE POLICY guardians_insert_service ON public.guardians FOR INSERT TO service_role
  WITH CHECK (true);

-- ── PostgREST grants (Bug #7 — 42501 without these) ─────────
GRANT ALL ON public.schools   TO authenticated, anon, service_role;
GRANT ALL ON public.users     TO authenticated, anon, service_role;
GRANT ALL ON public.guardians TO authenticated, anon, service_role;
