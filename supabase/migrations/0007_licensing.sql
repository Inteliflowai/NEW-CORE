-- supabase/migrations/0007_licensing.sql
-- LIFT V1 020_licensing.sql (school_licenses, license_usage, license_events)
--      + 049_activation_keys_billing.sql (license_keys, allowed_email_domains on school_licenses)
--      + 035_trial_architecture.sql (trial_events)
-- TIER-ENUM RECONCILIATION (spec §2.3):
--   020 used professional — canonical.
--   049 license_keys used a shorter alias — corrected to professional here.
--   Do NOT carry the short alias anywhere.
-- No business logic — gating/activation lives in the licensing plan.
-- FK targets: schools (0001), users (0001). No forward-refs.

-- ============================================================
-- 1. school_licenses — one license per school (LIFT 020 + 049)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.school_licenses (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id               uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE UNIQUE,
  tier                    text        NOT NULL CHECK (tier IN ('essentials','professional','enterprise')),
  status                  text        NOT NULL CHECK (status IN ('trialing','active','past_due','suspended','cancelled')),
  student_limit           int         NOT NULL DEFAULT 300,
  trial_starts_at         timestamptz,
  trial_ends_at           timestamptz,
  trial_converted         bool        DEFAULT false,
  starts_at               timestamptz,
  ends_at                 timestamptz,
  renewal_date            timestamptz,
  setup_fee_paid          bool        DEFAULT false,
  setup_fee_amount        int         DEFAULT 1500000,   -- cents ($15,000)
  stripe_customer_id      text,                          -- RESERVED: no code path may assume populated
  stripe_subscription_id  text,                          -- RESERVED
  billing_cycle           text        CHECK (billing_cycle IN ('annual','biannual')),
  feature_overrides       jsonb       DEFAULT '{}'::jsonb,
  feature_blocks          jsonb       DEFAULT '{}'::jsonb,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

-- ============================================================
-- 2. license_keys — HMAC burn ledger (LIFT 049; tier reconciled)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.license_keys (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key                   text        UNIQUE NOT NULL,
  -- Plan attributes encoded into key payload (validated by HMAC at activation)
  tier                  text        NOT NULL CHECK (tier IN ('essentials','professional','enterprise')),  -- reconciled from V1 049 (spec §2.3)
  student_limit         integer     NOT NULL CHECK (student_limit > 0),
  duration_months       integer     NOT NULL DEFAULT 12 CHECK (duration_months > 0),
  -- Issuance
  issued_to_school_id   uuid        REFERENCES public.schools(id) ON DELETE SET NULL,
  issued_by             uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  issued_at             timestamptz NOT NULL DEFAULT now(),
  -- Activation (one-time burn)
  activated_at          timestamptz,
  activated_by          uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  expires_at            timestamptz,
  -- Lifecycle
  status                text        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending','active','expired','revoked')),
  signature             text        NOT NULL,  -- HMAC-SHA256 truncated; verified at activation
  notes                 text,                  -- PO number, contract ref, etc.
  -- Anti-piracy: domains baked into key at issue time (LIFT 049)
  allowed_email_domains jsonb       DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_license_keys_school  ON public.license_keys(issued_to_school_id);
CREATE INDEX IF NOT EXISTS idx_license_keys_status  ON public.license_keys(status);
CREATE INDEX IF NOT EXISTS idx_license_keys_expires ON public.license_keys(expires_at);

-- Back-ref from school_licenses to the key that activated it (LIFT 049)
ALTER TABLE public.school_licenses
  ADD COLUMN IF NOT EXISTS activated_via_key_id uuid REFERENCES public.license_keys(id) ON DELETE SET NULL;

-- ============================================================
-- 3. license_usage — monthly snapshots (LIFT 020)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.license_usage (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id           uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  month               date        NOT NULL,
  students_enrolled   int         DEFAULT 0,
  active_students     int         DEFAULT 0,
  quiz_attempts       int         DEFAULT 0,
  hw_submissions      int         DEFAULT 0,
  teli_interactions   int         DEFAULT 0,
  created_at          timestamptz DEFAULT now(),
  UNIQUE(school_id, month)
);

CREATE INDEX IF NOT EXISTS idx_license_usage_school_month
  ON public.license_usage(school_id, month);

-- ============================================================
-- 4. license_events — audit log (LIFT 020)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.license_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  event_type    text        NOT NULL,
  old_tier      text,
  new_tier      text,
  old_status    text,
  new_status    text,
  metadata      jsonb       DEFAULT '{}'::jsonb,
  triggered_by  uuid,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_license_events_school_created
  ON public.license_events(school_id, created_at DESC);

-- ============================================================
-- 5. trial_events — lifecycle breadcrumbs (LIFT 035)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.trial_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid        REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id     uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  event_type  text        NOT NULL CHECK (event_type IN (
    'trial_signup',
    'first_login',
    'lesson_created',
    'quiz_taken',
    'homework_submitted',
    'teli_used',
    'signals_viewed',
    'reports_viewed',
    'upgrade_clicked',
    'upgrade_completed',
    'trial_expired',
    'login',
    'day_25_email_sent',
    'day_30_email_sent',
    'trial_extended',
    'trial_converted',
    'trial_cancelled',
    'manual_nudge_sent'
  )),
  metadata    jsonb       DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trial_events_school   ON public.trial_events(school_id);
CREATE INDEX IF NOT EXISTS idx_trial_events_type     ON public.trial_events(event_type);
CREATE INDEX IF NOT EXISTS idx_trial_events_created  ON public.trial_events(created_at DESC);

-- ============================================================
-- 6. updated_at trigger on school_licenses (LIFT 020)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_license_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_license_updated_at ON public.school_licenses;
CREATE TRIGGER trg_license_updated_at
  BEFORE UPDATE ON public.school_licenses
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_license_updated_at();

-- ============================================================
-- 7. Row Level Security
-- ============================================================

ALTER TABLE public.school_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_keys    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_usage   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_events    ENABLE ROW LEVEL SECURITY;

-- ── school_licenses ──
DROP POLICY IF EXISTS school_licenses_platform_all ON public.school_licenses;
CREATE POLICY school_licenses_platform_all ON public.school_licenses FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS school_licenses_member_read ON public.school_licenses;
CREATE POLICY school_licenses_member_read ON public.school_licenses FOR SELECT TO authenticated
  USING (school_id = public.get_my_school_id());

-- ── license_keys ──
DROP POLICY IF EXISTS license_keys_platform_all ON public.license_keys;
CREATE POLICY license_keys_platform_all ON public.license_keys FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS license_keys_school_read ON public.license_keys;
CREATE POLICY license_keys_school_read ON public.license_keys FOR SELECT TO authenticated
  USING (issued_to_school_id = public.get_my_school_id());

-- ── license_usage ──
DROP POLICY IF EXISTS license_usage_platform_all ON public.license_usage;
CREATE POLICY license_usage_platform_all ON public.license_usage FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS license_usage_school_read ON public.license_usage;
CREATE POLICY license_usage_school_read ON public.license_usage FOR SELECT TO authenticated
  USING (school_id = public.get_my_school_id());

-- ── license_events ──
DROP POLICY IF EXISTS license_events_platform_all ON public.license_events;
CREATE POLICY license_events_platform_all ON public.license_events FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS license_events_member_read ON public.license_events;
CREATE POLICY license_events_member_read ON public.license_events FOR SELECT TO authenticated
  USING (school_id = public.get_my_school_id());

-- ── trial_events ──
DROP POLICY IF EXISTS trial_events_platform_all ON public.trial_events;
CREATE POLICY trial_events_platform_all ON public.trial_events FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS trial_events_service ON public.trial_events;
CREATE POLICY trial_events_service ON public.trial_events FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 8. Grants
-- ============================================================
GRANT ALL ON public.school_licenses TO authenticated, anon, service_role;
GRANT ALL ON public.license_keys    TO authenticated, anon, service_role;
GRANT ALL ON public.license_usage   TO authenticated, anon, service_role;
GRANT ALL ON public.license_events  TO authenticated, anon, service_role;
GRANT ALL ON public.trial_events    TO authenticated, anon, service_role;
