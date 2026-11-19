-- DCF UNN update 2: message log can record visitors and names. Run ONCE in Supabase > SQL Editor
-- (after migration-photo-and-followup.sql). Safe to run twice.
alter table public.message_log add column if not exists recipient_name text;
alter table public.message_log add column if not exists attendance_id uuid references public.attendance(id) on delete cascade;
-- Admins can read the log (already set in the first migration; repeated so this file stands alone).
alter table public.message_log enable row level security;
drop policy if exists "admins read message log" on public.message_log;
create policy "admins read message log" on public.message_log
  for select to authenticated using (exists (select 1 from public.admins));
