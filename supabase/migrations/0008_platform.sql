-- supabase/migrations/0008_platform.sql
-- LIFT V1 034_platform_api.sql: platform_events (media-meter substrate) +
-- platform_api_keys -> platform_links (rename + spec §7 GA-rework columns).
-- NEW: external_identities (LIFT/Spark student linking)
--      webhook_idempotency_keys (§7.3 idempotency state machine, swept by cron)
-- Schema only — metering counting and Spark wire logic are later-plan deliverables.
-- FK targets: schools (0001), users (0001). No forward-refs.
--
-- CORRECTIONS vs. brief:
--   platform_links product CHECK: ('spark','lift','custom') — 'lift' MUST be present
--   so the P1 LIFT pre-populate handoff can provision a 'lift' row.
--   Full V1 column set on platform_events (processed, error carried faithfully).

-- ============================================================
-- 1. platform_events — media-meter substrate (LIFT 034)
-- ============================================================
-- Each metered call inserts a row; checkUsageCap counts rows by school/source.
CREATE TABLE IF NOT EXISTS public.platform_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text        NOT NULL,   -- e.g. 'tts'|'whisper'|'flux'|'runway'|'teli_chat'
  event_type  text        NOT NULL,
  school_id   uuid        REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id  uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  payload     jsonb       DEFAULT '{}'::jsonb,
  processed   boolean     DEFAULT false,
  error       text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_events_meter
  ON public.platform_events (school_id, source, created_at);
CREATE INDEX IF NOT EXISTS idx_platform_events_source
  ON public.platform_events (source, event_type);
CREATE INDEX IF NOT EXISTS idx_platform_events_student
  ON public.platform_events (student_id);
CREATE INDEX IF NOT EXISTS idx_platform_events_unprocessed
  ON public.platform_events (processed) WHERE processed = false;

-- ============================================================
-- 2. platform_links — generalization of V1 platform_api_keys (LIFT 034 + §7 GA rework)
-- ============================================================
-- One row per school per product. product CHECK MUST include 'lift' so the
-- P1 LIFT pre-populate handoff can INSERT product='lift' rows.
CREATE TABLE IF NOT EXISTS public.platform_links (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  product       text        NOT NULL CHECK (product IN ('spark','lift','custom')),
  api_key       text        NOT NULL,
  label         text,
  core_base_url text,
  enabled       boolean     DEFAULT true,       -- was is_active in V1
  -- §7 GA rework: rotatable key columns
  key_version   int         DEFAULT 1,
  rotated_at    timestamptz,
  expires_at    timestamptz,
  last_used_at  timestamptz,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (school_id, product)
);

CREATE INDEX IF NOT EXISTS idx_platform_links_key
  ON public.platform_links (api_key) WHERE enabled = true;

-- ============================================================
-- 3. external_identities — LIFT/Spark student linking
-- ============================================================
-- Resolves create-vs-match for inbound handoffs: given (school_id, provider,
-- external_id) find the corresponding core_student_id.
CREATE TABLE IF NOT EXISTS public.external_identities (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  provider         text        NOT NULL,   -- e.g. 'lift', 'spark', 'google'
  external_id      text        NOT NULL,
  core_student_id  uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  created_at       timestamptz DEFAULT now(),
  UNIQUE (school_id, provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_external_identities_lookup
  ON public.external_identities (school_id, provider, external_id);

-- ============================================================
-- 4. webhook_idempotency_keys — §7.3 idempotency state machine
-- ============================================================
-- The §7.3 cron 'idempotency-sweep' purges expired rows.
-- status state machine: in_progress -> completed | failed
CREATE TABLE IF NOT EXISTS public.webhook_idempotency_keys (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint         text        NOT NULL,
  idempotency_key  text        NOT NULL,
  status           text        NOT NULL CHECK (status IN ('in_progress','completed','failed')),
  response_body    jsonb,
  created_at       timestamptz DEFAULT now(),
  expires_at       timestamptz,
  UNIQUE (endpoint, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_wik_endpoint_key
  ON public.webhook_idempotency_keys (endpoint, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_wik_expires
  ON public.webhook_idempotency_keys (expires_at) WHERE expires_at IS NOT NULL;

-- ============================================================
-- RLS — all four tables: deny-by-default; service_role + platform admin only
-- ============================================================
ALTER TABLE public.platform_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_links           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_identities      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_idempotency_keys ENABLE ROW LEVEL SECURITY;

-- platform_events
DROP POLICY IF EXISTS platform_events_platform_all ON public.platform_events;
CREATE POLICY platform_events_platform_all ON public.platform_events FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- platform_links
DROP POLICY IF EXISTS platform_links_platform_all ON public.platform_links;
CREATE POLICY platform_links_platform_all ON public.platform_links FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- external_identities
DROP POLICY IF EXISTS external_identities_platform_all ON public.external_identities;
CREATE POLICY external_identities_platform_all ON public.external_identities FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- webhook_idempotency_keys
DROP POLICY IF EXISTS wik_platform_all ON public.webhook_idempotency_keys;
CREATE POLICY wik_platform_all ON public.webhook_idempotency_keys FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- ============================================================
-- GRANTS — all four tables
-- ============================================================
GRANT ALL ON public.platform_events          TO authenticated, anon, service_role;
GRANT ALL ON public.platform_links           TO authenticated, anon, service_role;
GRANT ALL ON public.external_identities      TO authenticated, anon, service_role;
GRANT ALL ON public.webhook_idempotency_keys TO authenticated, anon, service_role;
