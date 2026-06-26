-- 0028_avatars.sql
-- Profile avatars: a PRIVATE bucket (minors' photos must never sit on a public URL).
-- Service-role admin bypasses RLS → no storage.objects policies needed (mirrors 0021 student-drawings).
-- users.avatar_url (column exists since 0001) stores a proxy link to GET /api/profile/avatar — never a
-- public/expiring URL.
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', false)
  on conflict (id) do update set public = excluded.public;
