-- Prayer and counselling centre. PRIVATE: no one can read these tables through the public API or the normal admin login.
-- Only the server reads them, after checking that the signed-in person is an administrator AND listed in care_team.
create table if not exists public.care_requests (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  kind text not null check (kind in ('prayer','counselling')),
  category text not null,
  anonymous boolean not null default false,
  name text, phone text, email text,
  message text not null check (length(message) between 5 and 3000),
  privacy text not null check (privacy in ('prayer_team','counsellors_only')),
  status text not null default 'new' check (status in ('new','in_progress','prayed','follow_up','closed')),
  team_note text,
  handled_by text,
  ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists care_requests_status_idx on public.care_requests (status, created_at desc);
create index if not exists care_requests_ip_idx on public.care_requests (ip_hash, created_at);
create table if not exists public.care_team (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null check (role in ('prayer','counsellor')),
  added_by text,
  created_at timestamptz not null default now()
);
alter table public.care_requests enable row level security;
alter table public.care_team enable row level security;
revoke all on public.care_requests from anon, authenticated;
revoke all on public.care_team from anon, authenticated;
