-- supabase/migrations/0005_skills.sql
-- LIFT V1 071_skills_registry.sql + 072_skill_learning_state.sql verbatim.
-- Per-skill state is a LIFT, not net-new (spec §1.2 correction). 6-state vocabulary.

-- ── Skills registry (LIFT 071) ────────────────────────────────
-- Per-school skill registry. Free-text AI concept_tags resolve to stable
-- uuid-keyed rows (slug match, else auto-create status='unreviewed').
-- COALESCE unique index closes the nullable-subject hole.
CREATE TABLE IF NOT EXISTS public.skills (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  subject     text,                                -- classes.subject of originating class; NULL when unknown
  name        text        NOT NULL,               -- display name (first-seen raw tag, cleaned)
  slug        text        NOT NULL,               -- normalized identity (see lib/skills/skillSlug.ts)
  aliases     jsonb       NOT NULL DEFAULT '[]',  -- alternate raw tags folded into this skill
  status      text        NOT NULL DEFAULT 'unreviewed'
              CHECK (status IN ('unreviewed','active','merged','retired')),
  merged_into uuid        REFERENCES public.skills(id),
  created_by  text        NOT NULL DEFAULT 'ai'
              CHECK (created_by IN ('ai','teacher','backfill')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Subject is nullable; plain UNIQUE treats NULLs as distinct, which would let
-- duplicate (school, NULL, slug) rows in. COALESCE index closes that hole.
CREATE UNIQUE INDEX IF NOT EXISTS uq_skills_school_subject_slug
  ON public.skills (school_id, COALESCE(subject, ''), slug);

CREATE INDEX IF NOT EXISTS idx_skills_school ON public.skills(school_id);

-- ── Linkage columns (LIFT 071:56-66) ──────────────────────────
-- skills table is created above — FKs are safe now (no forward-refs).
ALTER TABLE public.quiz_questions
  ADD COLUMN IF NOT EXISTS skill_id uuid REFERENCES public.skills(id);

CREATE INDEX IF NOT EXISTS idx_quiz_questions_skill
  ON public.quiz_questions(skill_id);

-- Denormalized skill set the homework practices (from the parent lesson's quiz
-- questions). uuid[] — not a join table — because the consumer (per-skill signal
-- aggregation) only ever needs the set. skill_ids was intentionally deferred from
-- 0004 to here so the FK-safe ALTER runs after skills exists.
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS skill_ids uuid[] NOT NULL DEFAULT '{}';

-- ── Per-(student, skill) learning state (LIFT 072) ────────────
-- Fuses corrected cognitive signals into ONE observational verdict per skill.
-- OBSERVATIONAL, not diagnostic — teacher UI renders soft language only.
-- insufficient_data is first-class (anti-noise guard: never assert verdict on
-- < 3 graded observations, and never score non-submission as "can't").
CREATE TABLE IF NOT EXISTS public.skill_learning_state (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id           uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  school_id            uuid        REFERENCES public.schools(id) ON DELETE CASCADE,
  skill_id             uuid        NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  state                text        NOT NULL CHECK (state IN (
                         'needs_different_instruction',
                         'needs_more_time',
                         'on_track',
                         'ready_to_extend',
                         'insufficient_data',
                         'not_attempted'
                       )),
  confidence           numeric     NOT NULL DEFAULT 0,   -- 0-100, rendered as soft words only (never clinical)
  observation_count    int         NOT NULL DEFAULT 0,   -- graded cold + scaffolded observations
  evidence             jsonb       NOT NULL DEFAULT '{}',  -- { drivers: string[], metrics: {...} }
  last_reteach_outcome text,       -- e.g. 'different_approach_improved' (see computeSkillState.ts)
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_sls_student ON public.skill_learning_state(student_id);
CREATE INDEX IF NOT EXISTS idx_sls_skill   ON public.skill_learning_state(skill_id);
CREATE INDEX IF NOT EXISTS idx_sls_school  ON public.skill_learning_state(school_id);

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE public.skills               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_learning_state ENABLE ROW LEVEL SECURITY;

-- skills: same-school read; writes go through service role only (resolver lib / backfill).
DROP POLICY IF EXISTS skills_school_read ON public.skills;
CREATE POLICY skills_school_read ON public.skills
  FOR SELECT TO authenticated
  USING (school_id = public.get_my_school_id() OR public.is_platform_admin());

-- skill_learning_state: same-school staff read; service role only writes.
-- Students/parents never read this table (Option D: no diagnostic surfaces student-side).
DROP POLICY IF EXISTS sls_school_read ON public.skill_learning_state;
CREATE POLICY sls_school_read ON public.skill_learning_state
  FOR SELECT TO authenticated
  USING (school_id = public.get_my_school_id() OR public.is_platform_admin());

-- PostgREST grants (Bug #7 — service role gets 42501 without these)
GRANT ALL ON public.skills               TO authenticated, anon, service_role;
GRANT ALL ON public.skill_learning_state TO authenticated, anon, service_role;

-- ── Idempotent CHECK refresh (LIFT 072:68-78) ─────────────────
-- 'ready_to_extend' (per-skill Enrich signal) was added after the original 072
-- was applied to CORE prod (5-state). This DROP+ADD makes the file safe to re-run
-- on environments that applied the earlier five-state version, and a no-op-equivalent
-- on fresh installs where the 6-state CHECK above already set the constraint.
ALTER TABLE public.skill_learning_state
  DROP CONSTRAINT IF EXISTS skill_learning_state_state_check;
ALTER TABLE public.skill_learning_state
  ADD CONSTRAINT skill_learning_state_state_check CHECK (state IN (
    'needs_different_instruction',
    'needs_more_time',
    'on_track',
    'ready_to_extend',
    'insufficient_data',
    'not_attempted'
  ));
