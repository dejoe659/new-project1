-- DCF UNN: member photos + follow-up message log.
-- Run ONCE in Supabase > SQL Editor BEFORE uploading the new code. Safe to run twice.

-- 1. Member photo column. The public site may store it on sign-up and read it for approved profiles.
alter table public.members add column if not exists photo_url text;
grant insert (photo_url) on public.members to anon;
grant select (photo_url) on public.members to anon;

-- 2. Public bucket for photos: images only, max 2 MB each.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-photos', 'member-photos', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "member photos: anyone can upload" on storage.objects;
create policy "member photos: anyone can upload" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'member-photos');

drop policy if exists "member photos: admins can delete" on storage.objects;
create policy "member photos: admins can delete" on storage.objects
  for delete to authenticated using (bucket_id = 'member-photos' and exists (select 1 from public.admins));

-- 3. Log of every email / SMS / WhatsApp the system sends. Only the server writes; only admins read.
create table if not exists public.message_log (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id) on delete cascade,
  recipient text,
  channel text not null check (channel in ('email','sms','whatsapp')),
  kind text not null,                       -- welcome | manual | missed_two
  status text not null check (status in ('sent','failed')),
  detail text,                              -- reason when failed
  created_at timestamptz not null default now()
);
create index if not exists message_log_kind_created on public.message_log (kind, created_at desc);
alter table public.message_log enable row level security;
drop policy if exists "admins read message log" on public.message_log;
create policy "admins read message log" on public.message_log
  for select to authenticated using (exists (select 1 from public.admins));
