-- 0024_gc_roster.sql
-- Google Classroom epic, Segment 2: roster import.
-- ADDITIVE + IDEMPOTENT. Adapts the existing external_identities (0008) — adds email +
-- last_seen_at WITHOUT touching its (school_id, provider, external_id) + core_student_id shape
-- or its UNIQUE(school_id, provider, external_id) / deny-by-default RLS. Do NOT copy V1's column
-- names (never copy V1 legacy column names). Adds enrollments.source so the two-way reconcile can scope
-- soft-removal to Google-sourced seats IN THIS CLASS (per-class provenance, decision item A). Also
-- makes classes.google_course_id uniquely upsertable per school so roster import can
-- match-or-create a class by GC course id 1:1.

-- 1. external_identities: email (lowercased at write) + last_seen_at (hardened on each sync).
ALTER TABLE public.external_identities
  ADD COLUMN IF NOT EXISTS email        text;
ALTER TABLE public.external_identities
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- Email lookup within a school+provider (the match key for roster import). PLAIN column index:
-- emails are written lowercased and queried with .eq('email', lower(value)), so a lower(email)
-- functional index would NOT be used by the equality query (MIN-3).
CREATE INDEX IF NOT EXISTS idx_external_identities_email
  ON public.external_identities (school_id, provider, email);

-- 2. enrollments.source: per-class GC provenance. 'google' = this seat was created by a GC roster
-- import; the reconcile REMOVE side ONLY considers source='google' seats in THIS class, so a
-- manually-added seat (NULL/other source) is never touched and a student GC-sourced via another
-- class is scoped out by class_id (decision item A). Nullable + additive — existing seats stay NULL.
ALTER TABLE public.enrollments
  ADD COLUMN IF NOT EXISTS source text;

-- 3. classes: a clean per-school upsert key on the GC course id. Partial unique index so it is
-- safe to apply even if some rows have NULL google_course_id (manually-created classes).
CREATE UNIQUE INDEX IF NOT EXISTS uq_classes_school_google_course
  ON public.classes (school_id, google_course_id)
  WHERE google_course_id IS NOT NULL;
