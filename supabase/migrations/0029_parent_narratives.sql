-- 0029_parent_narratives.sql
-- 24h cache for the AI-generated parent Learning Summary (one row per student). V2 has no
-- student_model table (V1 cached there), so a dedicated cache table. Deny-by-default RLS + the
-- service_role grant (I7: RLS policy != grant in this project — 0001/0026/0027 all GRANT, else 42501).
-- Written/read ONLY via the admin client (service_role) by the parent route, behind guardStudentAccess.
create table if not exists public.parent_narratives (
  student_id    uuid primary key references public.users(id) on delete cascade,
  payload       jsonb not null,                 -- { paragraphs: string[], conversation_starters: string[], source: 'ai'|'ai_retry'|'fallback' }
  generated_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.parent_narratives enable row level security;

drop policy if exists "parent_narratives_service_role" on public.parent_narratives;
create policy "parent_narratives_service_role" on public.parent_narratives
  for all to service_role using (true) with check (true);

grant all on public.parent_narratives to service_role;
