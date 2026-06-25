-- supabase/migrations/0026_audit_logs.sql
-- Production ops: append-only audit log for sensitive staff actions + widen the seat-cap
-- trigger to cover trialing (pilot) schools. Additive; no edits to existing tables.
--
-- audit_logs: written ONLY via the admin client (service_role) by logAudit(); read ONLY by
-- platform_admin. Append-only — no UPDATE/DELETE policy. NO FKs on actor_id/school_id so the
-- trail survives user/school deletion. school_id stamped on every row (enables later
-- school-admin-scoped reads via one added policy).
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid,                              -- the staff user; null = system/cron
  school_id     uuid,                              -- the affected school (stamp always)
  action        text        NOT NULL,              -- e.g. 'grade.override', 'roster.sync'
  resource_type text        NOT NULL,              -- e.g. 'homework_attempt', 'class', 'school'
  resource_id   text,                              -- the affected row id (text — heterogeneous)
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- {before,after} for changes; counts for summaries
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_school_created   ON public.audit_logs (school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource         ON public.audit_logs (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_action_created   ON public.audit_logs (action, created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_service_role_all" ON public.audit_logs;
CREATE POLICY "audit_service_role_all" ON public.audit_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Platform admins may READ the trail. No INSERT/UPDATE/DELETE policy for authenticated ⇒
-- append-only from the app's perspective; the only writer is the service-role admin client.
DROP POLICY IF EXISTS "audit_platform_read" ON public.audit_logs;
CREATE POLICY "audit_platform_read" ON public.audit_logs
  FOR SELECT TO authenticated USING (public.is_platform_admin());

-- No anon grant (matches the 0022/0023 deny-by-default house pattern): anon never reads the
-- trail and has no SELECT policy. authenticated gets table-level SELECT but is still gated to
-- platform_admin by the policy above; service_role is the only writer.
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL    ON public.audit_logs TO service_role;

-- ── Widen the seat-cap trigger to cover trialing (pilot) schools ──
-- Verbatim from 0009_security_hardening.sql:9-59 EXCEPT the one status line (active → active+trialing).
-- A school with no matching license row still no-ops (v_limit IS NULL → RETURN NEW), so this is a
-- no-op for unlicensed/demo schools and only bites a trialing school past its student_limit.
CREATE OR REPLACE FUNCTION public.enforce_enrollment_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_school_id    uuid;
  v_current_count integer;
  v_limit        integer;
BEGIN
  IF to_regclass('public.school_licenses') IS NULL THEN RETURN NEW; END IF;
  SELECT school_id INTO v_school_id FROM public.users WHERE id = NEW.student_id;
  IF v_school_id IS NULL THEN RETURN NEW; END IF;
  SELECT student_limit INTO v_limit
    FROM public.school_licenses
   WHERE school_id = v_school_id
     AND status IN ('active','trialing')      -- WIDENED: pilots are enforced too
   LIMIT 1;
  IF v_limit IS NULL THEN RETURN NEW; END IF;
  SELECT COUNT(DISTINCT u.id) INTO v_current_count
    FROM public.users u
    JOIN public.enrollments e ON e.student_id = u.id
   WHERE u.school_id = v_school_id AND u.role = 'student' AND u.is_active = true;
  IF v_current_count >= v_limit THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.enrollments e2 JOIN public.users u2 ON u2.id = e2.student_id
       WHERE u2.school_id = v_school_id AND e2.student_id = NEW.student_id
    ) THEN
      RAISE EXCEPTION 'Enrollment limit reached: school has % students, license allows %', v_current_count, v_limit
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
