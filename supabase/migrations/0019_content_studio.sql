-- 0019_content_studio.sql
-- Content Studio Seg 1: lesson-upload storage + dedup/source columns.
-- Private bucket; the service-role admin client bypasses RLS, so NO storage.objects policies
-- are needed (mirrors V1 070_storage_buckets_provisioning). Idempotent.
insert into storage.buckets (id, name, public)
  values ('lesson-uploads', 'lesson-uploads', false)
  on conflict (id) do update set public = excluded.public;

alter table public.lessons
  add column if not exists file_hash text,
  add column if not exists source    text default 'upload';

-- Exact-dup lookup is WHERE teacher_id = ? AND file_hash = ?; index it.
create index if not exists lessons_teacher_file_hash_idx
  on public.lessons (teacher_id, file_hash);
