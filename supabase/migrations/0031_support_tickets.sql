-- 0031_support_tickets.sql
-- Any authenticated user may submit a support ticket; platform_admin triages.
-- Two tables + a private storage bucket. Deny-by-default RLS (service_role writes,
-- platform_admin + submitter read — no authenticated write policy).

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by      uuid        NOT NULL REFERENCES public.users(id),
  submitted_by_role text        NOT NULL,    -- snapshot at submission time
  school_id         uuid        REFERENCES public.schools(id),  -- null = parent w/o school
  subject           text        NOT NULL,
  description       text        NOT NULL,
  category          text        NOT NULL DEFAULT 'general' CHECK (category IN ('general','bug','feature','account','data','other')),
  priority          text        NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status            text        NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
  screenshot_path   text,       -- full path including bucket prefix, e.g. support-uploads/{userId}/{uuid}.ext
  assigned_to       uuid        REFERENCES public.users(id),
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_st_submitted_by    ON public.support_tickets (submitted_by);
CREATE INDEX IF NOT EXISTS idx_st_status_created  ON public.support_tickets (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid        NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id   uuid        NOT NULL REFERENCES public.users(id),
  message     text        NOT NULL,
  is_internal boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stm_ticket ON public.support_ticket_messages (ticket_id, created_at ASC);

-- RLS: support_tickets
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "st_service_role_all" ON public.support_tickets;
CREATE POLICY "st_service_role_all" ON public.support_tickets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "st_platform_admin_read" ON public.support_tickets;
CREATE POLICY "st_platform_admin_read" ON public.support_tickets
  FOR SELECT TO authenticated USING (public.is_platform_admin());

DROP POLICY IF EXISTS "st_submitter_read" ON public.support_tickets;
CREATE POLICY "st_submitter_read" ON public.support_tickets
  FOR SELECT TO authenticated USING (submitted_by = auth.uid());

-- RLS: support_ticket_messages
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stm_service_role_all" ON public.support_ticket_messages;
CREATE POLICY "stm_service_role_all" ON public.support_ticket_messages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "stm_platform_admin_read" ON public.support_ticket_messages;
CREATE POLICY "stm_platform_admin_read" ON public.support_ticket_messages
  FOR SELECT TO authenticated USING (public.is_platform_admin());

-- Non-admin submitter: own ticket messages only, internal notes filtered out
DROP POLICY IF EXISTS "stm_submitter_read" ON public.support_ticket_messages;
CREATE POLICY "stm_submitter_read" ON public.support_ticket_messages
  FOR SELECT TO authenticated
  USING (
    is_internal = false
    AND ticket_id IN (
      SELECT id FROM public.support_tickets WHERE submitted_by = auth.uid()
    )
  );

-- Table-level grants (house pattern: authenticated gets SELECT via policies; service_role gets ALL)
GRANT SELECT ON public.support_tickets         TO authenticated;
GRANT ALL    ON public.support_tickets         TO service_role;
GRANT SELECT ON public.support_ticket_messages TO authenticated;
GRANT ALL    ON public.support_ticket_messages TO service_role;

-- Private bucket: screenshots must never be publicly accessible (minors + PII risk)
INSERT INTO storage.buckets (id, name, public)
  VALUES ('support-uploads', 'support-uploads', false)
  ON CONFLICT (id) DO UPDATE SET public = excluded.public;
