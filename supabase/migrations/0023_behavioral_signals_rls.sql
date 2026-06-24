-- 0023_behavioral_signals_rls.sql
-- Harden behavioral_signals (created in 0013 WITHOUT row-level security): enable
-- deny-by-default RLS so the per-student behavioral model is NOT reachable via the
-- public REST API. Postgres default-grants new public tables to anon/authenticated,
-- so RLS is the only gate; without it, signed-in (and anon) callers could read every
-- student's behavioral signals through PostgREST.
--
-- App access is exclusively via the service-role admin client (createAdminSupabaseClient),
-- which BYPASSES RLS — so deny-by-default does not affect application behavior.
-- Mirrors the platform-table pattern in 0008 / 0022 (google_connections).
ALTER TABLE public.behavioral_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS behavioral_signals_platform_all ON public.behavioral_signals;
CREATE POLICY behavioral_signals_platform_all ON public.behavioral_signals FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
