-- Events and programmes: poster, start time, capacity, registrations.
alter table public.events add column if not exists starts_at timestamptz;
alter table public.events add column if not exists poster_url text;
alter table public.events add column if not exists capacity integer check (capacity is null or capacity > 0);
alter table public.events add column if not exists registration_open boolean not null default true;
alter table public.events add column if not exists created_at timestamptz not null default now();
create index if not exists events_starts_at_idx on public.events (starts_at);
create table if not exists public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  phone text not null, phone_key text not null, email text,
  attended boolean not null default false,
  created_at timestamptz not null default now(),
  unique (event_id, phone_key)
);
create index if not exists event_registrations_event_idx on public.event_registrations (event_id, created_at);
alter table public.event_registrations enable row level security;
create policy event_registrations_admin on public.event_registrations for all to authenticated using (public.is_admin()) with check (public.is_admin());
