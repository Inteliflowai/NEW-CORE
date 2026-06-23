-- 0020_content_studio_generate.sql
-- Content Studio Seg 2: AI Lesson Generator + URL import.
-- Multi-day units (chapter_title + day_index), teacher-confirmed standards
-- (standard_codes + standard_framework), and the school's US state (drives the
-- standards-aware proposal). All additive + idempotent. lessons.source is free-text
-- in V2, so source='generate' / 'url' need no CHECK change.
alter table public.lessons
  add column if not exists chapter_title      text,
  add column if not exists day_index          int,
  add column if not exists standard_codes     text[] default '{}',
  add column if not exists standard_framework text;

-- A multi-day unit is grouped by (teacher_id, class_id, chapter_title); index the class+chapter lookup.
create index if not exists lessons_class_chapter_idx
  on public.lessons (class_id, chapter_title);

-- The school's 2-letter US state code (nullable). Populated manually/at provisioning later;
-- when null the generator's standards step degrades to optional (teacher picks inline).
alter table public.schools
  add column if not exists state text;
