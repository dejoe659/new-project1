-- Faculties and departments (public read) and academic help requests (PRIVATE, server-only).
-- Faculty coordinators are NOT rows in public.admins: they have no database permissions at all and can only use the server, which limits them to their own faculties.
create table if not exists public.faculties (id uuid primary key default gen_random_uuid(), name text not null unique);
create table if not exists public.departments (id uuid primary key default gen_random_uuid(), faculty_id uuid not null references public.faculties(id) on delete cascade, name text not null, unique (faculty_id, name));
alter table public.faculties enable row level security; alter table public.departments enable row level security;
create policy faculties_read on public.faculties for select to anon, authenticated using (true);
create policy departments_read on public.departments for select to anon, authenticated using (true);
grant select on public.faculties, public.departments to anon, authenticated;
create table if not exists public.academic_coordinators (
  id uuid primary key default gen_random_uuid(),
  email text not null unique, name text,
  faculty_ids uuid[] not null default '{}',
  can_view_contact boolean not null default true,
  can_update boolean not null default true,
  active boolean not null default true,
  added_by text, created_at timestamptz not null default now());
create table if not exists public.academic_requests (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  faculty_id uuid not null references public.faculties(id), department_id uuid references public.departments(id),
  course text not null check (length(course) between 2 and 150), level text,
  issue text not null check (length(issue) between 5 and 3000),
  name text not null check (length(name) between 2 and 120), phone text, email text,
  status text not null default 'new' check (status in ('new','in_progress','resolved','closed')),
  coordinator_note text, handled_by text, ip_hash text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists academic_requests_fac_idx on public.academic_requests (faculty_id, status, created_at desc);
create index if not exists academic_requests_ip_idx on public.academic_requests (ip_hash, created_at);
alter table public.academic_coordinators enable row level security; alter table public.academic_requests enable row level security;
revoke all on public.academic_coordinators, public.academic_requests from anon, authenticated;
insert into public.faculties (name) values
('Agriculture'),
('Arts'),
('Basic Medical Sciences'),
('Biological Sciences'),
('Business Administration'),
('Dentistry'),
('Education'),
('Engineering'),
('Environmental Studies'),
('Health Sciences'),
('Law'),
('Medicine'),
('Pharmaceutical Sciences'),
('Physical Sciences'),
('Social Sciences'),
('Veterinary Medicine'),
('Vocational Technical Education')
on conflict (name) do nothing;
insert into public.departments (faculty_id, name) select id, d from public.faculties, unnest(array['Agricultural Economics','Agricultural Extension','Animal Science','Crop Science','Food Science and Technology','Soil Science']) d where name='Agriculture' on conflict do nothing;
insert into public.departments (faculty_id, name) select id, d from public.faculties, unnest(array['Archaeology and Tourism','English and Literary Studies','Fine and Applied Arts','Foreign Languages and Literary Studies','History and International Studies','Igbo, African and Asian Studies','Linguistics','Mass Communication','Music','Philosophy','Religion and Cultural Studies','Theatre and Film Studies']) d where name='Arts' on conflict do nothing;
insert into public.departments (faculty_id, name) select id, d from public.faculties, unnest(array['Anatomy','Physiology']) d where name='Basic Medical Sciences' on conflict do nothing;
insert into public.departments (faculty_id, name) select id, d from public.faculties, unnest(array['Biochemistry','Botany','Microbiology','Plant Science and Biotechnology','Zoology and Environmental Biology']) d where name='Biological Sciences' on conflict do nothing;
insert into public.departments (faculty_id, name) select id, d from public.faculties, unnest(array['Accountancy','Banking and Finance','Business Management','Marketing','Public Administration and Local Government']) d where name='Business Administration' on conflict do nothing;
insert into public.departments (faculty_id, name) select id, d from public.faculties, unnest(array['Dentistry']) d where name='Dentistry' on conflict do nothing;
insert into public.departments (faculty_id, name) select id, d from public.faculties, unnest(array['Adult Education and Extra-Mural Studies','Arts Education','Early Childhood and Primary Education','Educational Foundations','Health and Physical Education','Library and Information Science','Science Education','Social Science Education']) d where name='Education' on conflict do nothing;
insert into public.departments (faculty_id, name) select id, d from public.faculties, unnest(array['Agricultural and Bioresources Engineering','Chemical Engineering','Civil Engineering','Electrical Engineering','Electronic Engineering','Mechanical Engineering','Metallurgical and Materials Engineering','Petroleum and Gas Engineering']) d where name='Engineering' on conflict do nothing;
insert into public.departments (faculty_id, name) select id, d from public.faculties, unnest(array['Architecture','Estate Management','Geoinformatics and Surveying','Urban and Regional Planning']) d where name='Environmental Studies' on conflict do nothing;
insert into public.departments (faculty_id, name) select id, d from public.faculties, unnest(array['Health Administration and Management','Human Nutrition and Dietetics','Medical Laboratory Science','Medical Rehabilitation','Nursing Sciences','Radiography and Radiological Sciences']) d where name='Health Sciences' on conflict do nothing;
insert into public.departments (faculty_id, name) select id, d from public.faculties, unnest(array['Law']) d where name='Law' on conflict do nothing;
insert into public.departments (faculty_id, name) select id, d from public.faculties, unnest(array['Medicine and Surgery']) d where name='Medicine' on conflict do nothing;
insert into public.departments (faculty_id, name) select id, d from public.faculties, unnest(array['Pharmacy']) d where name='Pharmaceutical Sciences' on conflict do nothing;
insert into public.departments (faculty_id, name) select id, d from public.faculties, unnest(array['Computer Science','Geology','Mathematics','Physics and Astronomy','Pure and Industrial Chemistry','Statistics']) d where name='Physical Sciences' on conflict do nothing;
insert into public.departments (faculty_id, name) select id, d from public.faculties, unnest(array['Economics','Geography','Political Science','Psychology','Social Work','Sociology and Anthropology']) d where name='Social Sciences' on conflict do nothing;
insert into public.departments (faculty_id, name) select id, d from public.faculties, unnest(array['Veterinary Medicine']) d where name='Veterinary Medicine' on conflict do nothing;
insert into public.departments (faculty_id, name) select id, d from public.faculties, unnest(array['Agricultural Education','Business Education','Computer and Robotics Education','Home Economics and Hospitality Management Education','Industrial Technical Education']) d where name='Vocational Technical Education' on conflict do nothing;
