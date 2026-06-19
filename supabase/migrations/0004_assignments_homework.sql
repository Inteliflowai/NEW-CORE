-- supabase/migrations/0004_assignments_homework.sql
-- LIFT V1 000 (assignments + homework_attempts). skill_ids[] is added in 0005 (LIFT 071).

CREATE TABLE IF NOT EXISTS public.assignments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_attempt_id         uuid REFERENCES public.quiz_attempts(id),
  student_id              uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  class_id                uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  lesson_id               uuid REFERENCES public.lessons(id) ON DELETE CASCADE,
  mastery_band            text CHECK (mastery_band IN ('reteach','grade_level','advanced')),
  assignment_mode         text DEFAULT 'standard',
  learning_style          text,
  content                 jsonb NOT NULL,
  status                  text DEFAULT 'draft',
  teacher_reviewed        boolean DEFAULT false,
  teacher_override_reason text,
  push_status             text DEFAULT 'pending',
  reteach_needed          boolean DEFAULT false,
  scaffold_level          text,
  due_at                  timestamptz,
  created_at              timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.homework_attempts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id     uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  student_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status            text DEFAULT 'in_progress',
  responses         jsonb,
  canvas_data       jsonb,
  score_pct         numeric,
  ai_feedback       jsonb,
  teacher_notes     text,
  teacher_score     numeric,
  teli_hint_count   int DEFAULT 0,
  submitted_on_time boolean,
  submitted_at      timestamptz,
  graded_at         timestamptz,
  created_at        timestamptz DEFAULT now()
);

-- ── RLS ──
ALTER TABLE public.assignments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assignments_scoped_read ON public.assignments;
CREATE POLICY assignments_scoped_read ON public.assignments FOR SELECT TO authenticated
  USING (student_id = auth.uid()
         OR class_id IN (SELECT public.get_teacher_class_ids(auth.uid()))
         OR public.is_platform_admin());

DROP POLICY IF EXISTS homework_attempts_owner_read ON public.homework_attempts;
CREATE POLICY homework_attempts_owner_read ON public.homework_attempts FOR SELECT TO authenticated
  USING (student_id = auth.uid()
         OR assignment_id IN (SELECT id FROM public.assignments
              WHERE class_id IN (SELECT public.get_teacher_class_ids(auth.uid())))
         OR public.is_platform_admin());

GRANT ALL ON public.assignments       TO authenticated, anon, service_role;
GRANT ALL ON public.homework_attempts TO authenticated, anon, service_role;
