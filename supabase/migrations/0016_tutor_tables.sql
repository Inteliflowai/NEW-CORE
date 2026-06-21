-- 0016_tutor_tables.sql — Teli tutor persistence (Assignment Player Segment 3).
-- Net-new clean tables (V1's were drift-laden). Additive + idempotent.
-- RLS mirrors 0012_spark.sql (service_role full; staff school-scoped read deferred to Epic 3;
-- student-own read). NOT applied live here — applied via Supabase MCP at merge time.

CREATE TABLE IF NOT EXISTS public.tutor_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  assignment_id      uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  attempt_id         uuid REFERENCES public.homework_attempts(id) ON DELETE SET NULL,
  hint_count         int NOT NULL DEFAULT 0,
  help_request_count int NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_activity_at   timestamptz NOT NULL DEFAULT now()
);

-- At most ONE active session per attempt (kills duplicate-session undercount + the create race).
CREATE UNIQUE INDEX IF NOT EXISTS uq_tutor_sessions_active_attempt ON public.tutor_sessions (attempt_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_tutor_sessions_student_assignment ON public.tutor_sessions (student_id, assignment_id);

CREATE TABLE IF NOT EXISTS public.tutor_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES public.tutor_sessions(id) ON DELETE CASCADE,
  task_step       int,
  role            text NOT NULL CHECK (role IN ('student','teli','system')),
  content         text NOT NULL,
  is_help_request boolean NOT NULL DEFAULT false,  -- TRUE only on the STUDENT row of a hint pull; teli row is always false
  hint_rung       text CHECK (hint_rung IN ('nudge','cue','step','encourage')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tutor_messages_session_id   ON public.tutor_messages (session_id);
CREATE INDEX IF NOT EXISTS idx_tutor_messages_session_task ON public.tutor_messages (session_id, task_step);

-- Atomic counter bump (avoids the read-modify-write lost-update on concurrent help pulls).
CREATE OR REPLACE FUNCTION public.bump_tutor_session(p_session_id uuid)
RETURNS void LANGUAGE sql AS $$
  UPDATE public.tutor_sessions
     SET hint_count = hint_count + 1,
         help_request_count = help_request_count + 1,
         last_activity_at = now()
   WHERE id = p_session_id;
$$;

-- ── RLS: service_role full; student reads own; staff school-scoped read deferred to Epic 3 ──
ALTER TABLE public.tutor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tutor_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tutor_sessions_service_role_all" ON public.tutor_sessions;
CREATE POLICY "tutor_sessions_service_role_all" ON public.tutor_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "tutor_sessions_student_read" ON public.tutor_sessions;
CREATE POLICY "tutor_sessions_student_read" ON public.tutor_sessions FOR SELECT TO authenticated USING (student_id = auth.uid());

DROP POLICY IF EXISTS "tutor_messages_service_role_all" ON public.tutor_messages;
CREATE POLICY "tutor_messages_service_role_all" ON public.tutor_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "tutor_messages_student_read" ON public.tutor_messages;
CREATE POLICY "tutor_messages_student_read" ON public.tutor_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tutor_sessions s WHERE s.id = session_id AND s.student_id = auth.uid()));

GRANT SELECT ON public.tutor_sessions TO authenticated, anon;
GRANT ALL    ON public.tutor_sessions TO service_role;
GRANT SELECT ON public.tutor_messages TO authenticated, anon;
GRANT ALL    ON public.tutor_messages TO service_role;
