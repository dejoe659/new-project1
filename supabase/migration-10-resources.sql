-- Sermons, audio, video, Bible study, discipleship and devotionals. Public can read PUBLISHED rows only; content admins manage them.
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('sermon','audio','video','study','discipleship','devotional')),
  title text not null check (length(trim(title)) between 2 and 150),
  speaker text, category text, description text,
  body text check (body is null or length(body) <= 10000),
  url text check (url is null or url ~ '^https://'),
  published_on date not null default current_date,
  is_featured boolean not null default false,
  is_published boolean not null default true,
  created_by uuid, created_at timestamptz not null default now()
);
create index if not exists resources_pub_idx on public.resources (is_published, published_on desc);
alter table public.resources enable row level security;
create policy resources_public_read on public.resources for select to anon, authenticated using (is_published = true);
create policy resources_admin_all on public.resources for all to authenticated using (public.has_admin_role(array['super_admin','content_admin'])) with check (public.has_admin_role(array['super_admin','content_admin']));
grant select on public.resources to anon;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sermons','sermons',true,52428800,array['audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/ogg','application/pdf']) on conflict (id) do nothing;
create policy "sermons: public read" on storage.objects for select to public using (bucket_id = 'sermons');
create policy "sermons: admins upload" on storage.objects for insert to authenticated with check (bucket_id = 'sermons' and public.has_admin_role(array['super_admin','content_admin']));
create policy "sermons: admins update" on storage.objects for update to authenticated using (bucket_id = 'sermons' and public.has_admin_role(array['super_admin','content_admin']));
create policy "sermons: admins delete" on storage.objects for delete to authenticated using (bucket_id = 'sermons' and public.has_admin_role(array['super_admin','content_admin']));
