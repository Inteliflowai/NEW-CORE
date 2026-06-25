-- supabase/migrations/0025_skill_state_snapshots.sql
-- The moat (Item 2): weekly per-(student, skill) Comprehension-Level history.
-- skill_learning_state holds only the LIVE state (one row per student+skill, no history);
-- this table is its weekly archive so the Insights page can show a class trend over time.
-- Written ONLY by the weekly-snapshot cron (service_role) and the demo seed; read ONLY via
-- the admin client (RLS-bypassed). Deny-by-default for authenticated (mirrors alerts in 0017).
-- Additive only — no edits to existing tables.

CREATE TABLE IF NOT EXISTS public.skill_state_snapshots (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    uuid        NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  school_id     uuid        REFERENCES public.schools(id)          ON DELETE CASCADE,
  skill_id      uuid        NOT NULL REFERENCES public.skills(id)  ON DELETE CASCADE,
  snapshot_date date        NOT NULL DEFAULT CURRENT_DATE,
  state         text        NOT NULL CHECK (state IN (
                  'needs_different_instruction',
                  'needs_more_time',
                  'on_track',
                  'ready_to_extend',
                  'insufficient_data',
                  'not_attempted'
                )),
  confidence    numeric     NOT NULL DEFAULT 0,   -- 0-100, soft words only on the surface
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, skill_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_sss_student_date
  ON public.skill_state_snapshots (student_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_sss_skill
  ON public.skill_state_snapshots (skill_id);

-- ── RLS: service_role full; NO authenticated read (read path is admin-client only) ──
ALTER TABLE public.skill_state_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sss_service_role_all" ON public.skill_state_snapshots;
CREATE POLICY "sss_service_role_all" ON public.skill_state_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- PostgREST grants (0005 note: service role 42501 without these). NO authenticated SELECT
-- policy ⇒ with RLS enabled, authenticated reads are denied by default even though the GRANT
-- exists (a GRANT without a permitting policy still returns zero rows). Read path = admin client.
GRANT SELECT ON public.skill_state_snapshots TO authenticated, anon;
GRANT ALL    ON public.skill_state_snapshots TO service_role;
