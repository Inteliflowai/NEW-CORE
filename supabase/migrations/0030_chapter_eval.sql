-- supabase/migrations/0030_chapter_eval.sql
-- Chapter-Level Evaluation: 6 new tables + lessons.chapter_id.
-- All RLS deny-by-default (service_role FOR ALL). Admin client only.
-- See spec docs/superpowers/specs/2026-06-26-chapter-eval.md.
-- V1 reference: core/supabase/migrations/065_chapter_tests.sql.
-- NOTE: concept_gaps extension deferred (not needed for V2 pilot).

-- ── chapters ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chapters (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id    uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  teacher_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  sequence    int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (class_id, title)
);
CREATE INDEX IF NOT EXISTS idx_chapters_class
  ON public.chapters(class_id, archived_at NULLS FIRST, sequence);
CREATE INDEX IF NOT EXISTS idx_chapters_teacher
  ON public.chapters(teacher_id);

-- ── lessons.chapter_id (nullable rollup) ────────────────────
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS chapter_id uuid REFERENCES public.chapters(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_lessons_chapter
  ON public.lessons(chapter_id) WHERE chapter_id IS NOT NULL;

-- ── chapter_tests ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chapter_tests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id        uuid NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  class_id          uuid NOT NULL REFERENCES public.classes(id),
  teacher_id        uuid NOT NULL REFERENCES public.users(id),
  title             text NOT NULL,
  template          text NOT NULL DEFAULT 'humanities'
    CHECK (template IN ('humanities','stem')),
  total_minutes     int  NOT NULL DEFAULT 44,
  total_points      int  NOT NULL DEFAULT 60,
  generation_status text NOT NULL DEFAULT 'draft'
    CHECK (generation_status IN ('draft','queued','generating','ready','failed')),
  status            text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),
  published_at      timestamptz,
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chapter_tests_chapter
  ON public.chapter_tests(chapter_id);
CREATE INDEX IF NOT EXISTS idx_chapter_tests_class
  ON public.chapter_tests(class_id, status);
CREATE INDEX IF NOT EXISTS idx_chapter_tests_inflight
  ON public.chapter_tests(generation_status)
  WHERE generation_status IN ('queued','generating');

-- ── chapter_test_sections ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chapter_test_sections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_test_id uuid NOT NULL REFERENCES public.chapter_tests(id) ON DELETE CASCADE,
  section_order   int  NOT NULL,
  section_kind    text NOT NULL
    CHECK (section_kind IN (
      'vocabulary','short_answer','compare_contrast',
      'data_interpretation','mini_essay','multi_step_problem'
    )),
  title           text NOT NULL,
  time_minutes    int  NOT NULL,
  total_points    int  NOT NULL,
  power_skill     text,
  UNIQUE (chapter_test_id, section_order)
);
CREATE INDEX IF NOT EXISTS idx_chapter_test_sections_test
  ON public.chapter_test_sections(chapter_test_id, section_order);

-- ── chapter_test_questions (per-student rows) ────────────────
CREATE TABLE IF NOT EXISTS public.chapter_test_questions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id         uuid NOT NULL REFERENCES public.chapter_test_sections(id) ON DELETE CASCADE,
  student_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  question_order     int  NOT NULL,
  question_type      text NOT NULL
    CHECK (question_type IN (
      'mcq','matching','short_answer','data_interpretation','mini_essay','multi_step_problem'
    )),
  question_text      text NOT NULL,
  payload            jsonb NOT NULL DEFAULT '{}',
  points             int  NOT NULL,
  comprehension_band text,
  learning_style     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (section_id, student_id, question_order)
);
CREATE INDEX IF NOT EXISTS idx_chapter_test_questions_section_student
  ON public.chapter_test_questions(section_id, student_id);
CREATE INDEX IF NOT EXISTS idx_chapter_test_questions_student
  ON public.chapter_test_questions(student_id);

-- ── chapter_test_attempts ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chapter_test_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_test_id uuid NOT NULL REFERENCES public.chapter_tests(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  started_at      timestamptz DEFAULT now(),
  submitted_at    timestamptz,
  last_active_at  timestamptz DEFAULT now(),
  status          text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started','in_progress','submitted','graded')),
  total_grade     numeric(5,2),
  total_max       int,
  forfeit_reason  text CHECK (forfeit_reason IS NULL OR forfeit_reason IN ('closure','time_up')),
  UNIQUE (chapter_test_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_chapter_test_attempts_test
  ON public.chapter_test_attempts(chapter_test_id, status);
CREATE INDEX IF NOT EXISTS idx_chapter_test_attempts_student
  ON public.chapter_test_attempts(student_id, submitted_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_chapter_test_attempts_inflight
  ON public.chapter_test_attempts(last_active_at)
  WHERE status = 'in_progress';

-- ── chapter_test_responses ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chapter_test_responses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id       uuid NOT NULL REFERENCES public.chapter_test_attempts(id) ON DELETE CASCADE,
  question_id      uuid NOT NULL REFERENCES public.chapter_test_questions(id),
  response_text    text,
  response_payload jsonb DEFAULT '{}',
  grade            numeric(5,2),
  ai_feedback      text,
  graded_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_chapter_test_responses_attempt
  ON public.chapter_test_responses(attempt_id);

-- ── RLS: deny-by-default, service_role FOR ALL ───────────────
ALTER TABLE public.chapters                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapter_tests           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapter_test_sections   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapter_test_questions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapter_test_attempts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapter_test_responses  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chapters_service_role_all"              ON public.chapters;
DROP POLICY IF EXISTS "chapter_tests_service_role_all"         ON public.chapter_tests;
DROP POLICY IF EXISTS "chapter_test_sections_service_role_all" ON public.chapter_test_sections;
DROP POLICY IF EXISTS "chapter_test_questions_service_role_all" ON public.chapter_test_questions;
DROP POLICY IF EXISTS "chapter_test_attempts_service_role_all" ON public.chapter_test_attempts;
DROP POLICY IF EXISTS "chapter_test_responses_service_role_all" ON public.chapter_test_responses;

CREATE POLICY "chapters_service_role_all"
  ON public.chapters FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "chapter_tests_service_role_all"
  ON public.chapter_tests FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "chapter_test_sections_service_role_all"
  ON public.chapter_test_sections FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "chapter_test_questions_service_role_all"
  ON public.chapter_test_questions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "chapter_test_attempts_service_role_all"
  ON public.chapter_test_attempts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "chapter_test_responses_service_role_all"
  ON public.chapter_test_responses FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Grants (Bug #7) ──────────────────────────────────────────
GRANT ALL ON public.chapters                TO authenticated, anon, service_role;
GRANT ALL ON public.chapter_tests           TO authenticated, anon, service_role;
GRANT ALL ON public.chapter_test_sections   TO authenticated, anon, service_role;
GRANT ALL ON public.chapter_test_questions  TO authenticated, anon, service_role;
GRANT ALL ON public.chapter_test_attempts   TO authenticated, anon, service_role;
GRANT ALL ON public.chapter_test_responses  TO authenticated, anon, service_role;
