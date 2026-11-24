-- Alumni directory and mentor requests (applied to the live project). Server-only tables: the public never reads them directly.
create table if not exists public.alumni (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  full_name text not null check (length(full_name) between 2 and 120),
  graduation_year int not null check (graduation_year between 1960 and 2100),
  faculty_id uuid not null references public.faculties(id),
  department_id uuid references public.departments(id),
  occupation text check (length(occupation) <= 150),
  location text check (length(location) <= 100),
  bio text check (length(bio) <= 600),
  email text not null, phone text,
  mentor boolean not null default false,
  consent_public boolean not null default false,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  ip_hash text);
create unique index if not exists alumni_email_uidx on public.alumni (lower(email));
create index if not exists alumni_status_idx on public.alumni (status, graduation_year desc);
create table if not exists public.mentor_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  faculty_id uuid not null references public.faculties(id),
  name text not null check (length(name) between 2 and 120),
  phone text, email text,
  message text not null check (length(message) between 5 and 1000),
  status text not null default 'new' check (status in ('new','matched','closed')),
  note text check (length(note) <= 1000), handled_by text, ip_hash text);
alter table public.alumni enable row level security; alter table public.mentor_requests enable row level security;
revoke all on public.alumni, public.mentor_requests from anon, authenticated;
create policy deny_all_api on public.alumni for all to anon, authenticated using (false) with check (false);
create policy deny_all_api on public.mentor_requests for all to anon, authenticated using (false) with check (false);
