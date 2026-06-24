-- 0022_google_connections.sql
-- Google Classroom epic, Segment 1: per-teacher OAuth token vault.
-- Tokens are AES-256-GCM ciphertext (access_token_enc/refresh_token_enc) written by the
-- token-manager (src/lib/google/tokens.ts) — NEVER plaintext. RLS deny-by-default; all real
-- access is via the service-role admin client behind the route auth chain (RLS is not the
-- IDOR backstop). Mirrors the platform tables in 0008.
CREATE TABLE IF NOT EXISTS public.google_connections (
  user_id           uuid        PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  school_id         uuid        REFERENCES public.schools(id) ON DELETE CASCADE,
  google_id         text,
  email             text,
  access_token_enc  text,
  refresh_token_enc text,
  token_expiry      timestamptz,
  granted_scopes    text[],
  connected_at      timestamptz NOT NULL DEFAULT now(),
  last_refresh_at   timestamptz
);

ALTER TABLE public.google_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS google_connections_platform_all ON public.google_connections;
CREATE POLICY google_connections_platform_all ON public.google_connections FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

GRANT ALL ON public.google_connections TO authenticated, anon, service_role;
