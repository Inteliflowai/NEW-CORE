-- 0021_student_drawings.sql
-- Content Studio Seg 5: a private bucket for student drawing/photo answers.
-- Private (public=false); the service-role admin client bypasses RLS, so NO
-- storage.objects policies are needed (mirrors 0019 lesson-uploads). The image-proxy
-- route (/api/attempts/drawing) authorizes each read (student-owns OR staff-with-access).
-- Drawings persist as a proxy URL inside homework_attempts.responses — no table change.
insert into storage.buckets (id, name, public)
  values ('student-drawings', 'student-drawings', false)
  on conflict (id) do update set public = excluded.public;
