-- supabase/migrations/0003_lessons_quizzes.sql
-- LIFT V1 000_full_schema.sql lines 97-181 (lessons, quizzes, quiz_questions, quiz_attempts, quiz_responses).
-- Quiz chain stays SEPARATE from the assignment chain so the Assignment-vs-Quiz gap signal works.
-- Forward-ref safety: skills table (Task 12) not yet created — skill_id FK omitted; add via ALTER in later migration.

-- ── Lessons ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lessons (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id       uuid        NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  teacher_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title          text,
  file_name      text,
  file_url       text,
  file_type      text,
  parsed_content jsonb,
  grade_level    text,
  subject        text,
  status         text        DEFAULT 'draft' CHECK (status IN ('draft','pending_review','approved','published','archived')),
  version        int         DEFAULT 1,
  created_at     timestamptz DEFAULT now()
);

-- ── Quizzes ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quizzes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id      uuid        REFERENCES public.lessons(id) ON DELETE CASCADE,
  class_id       uuid        NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  teacher_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title          text,
  status         text        DEFAULT 'draft' CHECK (status IN ('draft','pending_review','approved','published','archived')),
  rubric_version text        DEFAULT '1.0',
  teacher_notes  text,
  published_at   timestamptz,
  created_at     timestamptz DEFAULT now()
);

-- ── Quiz Questions ───────────────────────────────────────
-- question_type: 'mcq' (3 per quiz) | 'open' (2 OEQ per quiz) — V1 3MCQ+2OEQ structure.
CREATE TABLE IF NOT EXISTS public.quiz_questions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id        uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  position       int  NOT NULL,
  question_type  text NOT NULL CHECK (question_type IN ('mcq','open')),
  question_text  text NOT NULL,
  choices        jsonb,
  correct_answer text,
  rubric         text,
  concept_tag    text,
  created_at     timestamptz DEFAULT now()
);

-- ── Quiz Attempts ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quiz_attempts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id        uuid        NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  student_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_id     text,
  started_at     timestamptz DEFAULT now(),
  submitted_at   timestamptz,
  is_complete    boolean     DEFAULT false,
  raw_score      numeric,
  score_pct      numeric,
  mastery_band   text        CHECK (mastery_band IN ('reteach','grade_level','advanced')),
  learning_style text,
  created_at     timestamptz DEFAULT now()
);

-- ── Quiz Responses ───────────────────────────────────────
-- Carries cognitive + behavioral telemetry columns (V1 000_full_schema.sql lines 158-181).
CREATE TABLE IF NOT EXISTS public.quiz_responses (
  id                   uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id           uuid    NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  question_id          uuid    REFERENCES public.quiz_questions(id),
  position             int     NOT NULL,
  response_text        text,
  is_correct           boolean,
  ai_score             numeric,
  ai_score_explanation text,
  cognitive_notes      text,
  question_type_scored text,
  rubric_version       text,
  grader_source        text    DEFAULT 'ai',
  confidence           numeric,
  -- behavioral telemetry
  response_time_ms     int     DEFAULT 0,
  hesitation_ms        int     DEFAULT 0,
  answer_changes       int     DEFAULT 0,
  navigation_backs     int     DEFAULT 0,
  pause_count          int     DEFAULT 0,
  total_pause_ms       int     DEFAULT 0,
  word_count           int     DEFAULT 0,
  created_at           timestamptz DEFAULT now()
);

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE public.lessons        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quizzes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_responses ENABLE ROW LEVEL SECURITY;

-- ── Lessons policies ─────────────────────────────────────
DROP POLICY IF EXISTS lessons_school_read ON public.lessons;
CREATE POLICY lessons_school_read ON public.lessons FOR SELECT TO authenticated
  USING (teacher_id = auth.uid()
         OR class_id IN (SELECT public.get_teacher_class_ids(auth.uid()))
         OR class_id IN (SELECT public.get_student_class_ids(auth.uid()))
         OR public.is_platform_admin());

DROP POLICY IF EXISTS lessons_teacher_write ON public.lessons;
CREATE POLICY lessons_teacher_write ON public.lessons FOR ALL TO authenticated
  USING (teacher_id = auth.uid() OR public.is_platform_admin())
  WITH CHECK (teacher_id = auth.uid() OR public.is_platform_admin());

-- ── Quizzes policies ─────────────────────────────────────
DROP POLICY IF EXISTS quizzes_school_read ON public.quizzes;
CREATE POLICY quizzes_school_read ON public.quizzes FOR SELECT TO authenticated
  USING (teacher_id = auth.uid()
         OR class_id IN (SELECT public.get_teacher_class_ids(auth.uid()))
         OR class_id IN (SELECT public.get_student_class_ids(auth.uid()))
         OR public.is_platform_admin());

DROP POLICY IF EXISTS quizzes_teacher_write ON public.quizzes;
CREATE POLICY quizzes_teacher_write ON public.quizzes FOR ALL TO authenticated
  USING (teacher_id = auth.uid() OR public.is_platform_admin())
  WITH CHECK (teacher_id = auth.uid() OR public.is_platform_admin());

-- ── Quiz Questions policies ──────────────────────────────
DROP POLICY IF EXISTS quiz_questions_read ON public.quiz_questions;
CREATE POLICY quiz_questions_read ON public.quiz_questions FOR SELECT TO authenticated
  USING (quiz_id IN (SELECT id FROM public.quizzes WHERE teacher_id = auth.uid()
                     OR class_id IN (SELECT public.get_student_class_ids(auth.uid())))
         OR public.is_platform_admin());

-- ── Quiz Attempts policies ───────────────────────────────
DROP POLICY IF EXISTS quiz_attempts_owner_read ON public.quiz_attempts;
CREATE POLICY quiz_attempts_owner_read ON public.quiz_attempts FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS quiz_attempts_owner_write ON public.quiz_attempts;
CREATE POLICY quiz_attempts_owner_write ON public.quiz_attempts FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid());

-- ── Quiz Responses policies ──────────────────────────────
DROP POLICY IF EXISTS quiz_responses_owner_read ON public.quiz_responses;
CREATE POLICY quiz_responses_owner_read ON public.quiz_responses FOR SELECT TO authenticated
  USING (attempt_id IN (SELECT id FROM public.quiz_attempts WHERE student_id = auth.uid())
         OR public.is_platform_admin());

DROP POLICY IF EXISTS quiz_responses_owner_write ON public.quiz_responses;
CREATE POLICY quiz_responses_owner_write ON public.quiz_responses FOR INSERT TO authenticated
  WITH CHECK (attempt_id IN (SELECT id FROM public.quiz_attempts WHERE student_id = auth.uid()));

-- ── Grants ───────────────────────────────────────────────
GRANT ALL ON public.lessons        TO authenticated, anon, service_role;
GRANT ALL ON public.quizzes        TO authenticated, anon, service_role;
GRANT ALL ON public.quiz_questions TO authenticated, anon, service_role;
GRANT ALL ON public.quiz_attempts  TO authenticated, anon, service_role;
GRANT ALL ON public.quiz_responses TO authenticated, anon, service_role;
