-- =====================================================================
-- DCF UNN - Phase 2: communication foundation
-- Per-channel consent and opt-out, queue, logs, approvals, templates,
-- settings, meeting schedule, audit trail, webhook store.
--
-- Safe to run more than once. It never deletes member data. Existing
-- members get a preferences row (their old single consent counts for
-- email, SMS and WhatsApp, and is marked legacy_general_consent).
-- Every automation rule is seeded as DISABLED.
-- =====================================================================
begin;

-- 0. Helpers ----------------------------------------------------------
create or replace function public.admin_role() returns text
  language sql stable security definer set search_path = public as
$$ select role from public.admins where user_id = auth.uid() $$;

create or replace function public.has_admin_role(roles text[]) returns boolean
  language sql stable security definer set search_path = public as
$$ select coalesce(public.admin_role() = any (roles), false) $$;

revoke all on function public.admin_role() from public, anon;
revoke all on function public.has_admin_role(text[]) from public, anon;
grant execute on function public.admin_role() to authenticated, service_role;
grant execute on function public.has_admin_role(text[]) to authenticated, service_role;

create or replace function public.touch_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

-- 1. Members: hostel address + the channels chosen on the join form -----
alter table public.members
  add column if not exists hostel_address text,
  add column if not exists reg_pref_whatsapp boolean not null default false,
  add column if not exists reg_pref_sms boolean not null default false,
  add column if not exists reg_pref_email boolean not null default false;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'members_hostel_address_len') then
    alter table public.members add constraint members_hostel_address_len
      check (hostel_address is null or char_length(hostel_address) <= 300);
  end if;
end $$;

grant insert (hostel_address, reg_pref_whatsapp, reg_pref_sms, reg_pref_email) on public.members to anon;

-- 2. Consent records (source of truth for who may be messaged, per channel)
create table if not exists public.member_preferences (
  member_id uuid primary key references public.members(id) on delete cascade,
  whatsapp_opt_in boolean not null default false,
  sms_opt_in boolean not null default false,
  email_opt_in boolean not null default false,
  whatsapp_consented_at timestamptz,
  sms_consented_at timestamptz,
  email_consented_at timestamptz,
  consent_source text not null default 'registration'
    check (consent_source in ('registration','legacy_general_consent','admin','member_request')),
  opted_out boolean not null default false,       -- global stop: overrides every channel
  opted_out_at timestamptz,
  opt_out_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.member_prefs_before_write() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' or new.whatsapp_opt_in is distinct from old.whatsapp_opt_in then
    if new.whatsapp_opt_in then new.whatsapp_consented_at := coalesce(new.whatsapp_consented_at, now()); end if;
  end if;
  if tg_op = 'INSERT' or new.sms_opt_in is distinct from old.sms_opt_in then
    if new.sms_opt_in then new.sms_consented_at := coalesce(new.sms_consented_at, now()); end if;
  end if;
  if tg_op = 'INSERT' or new.email_opt_in is distinct from old.email_opt_in then
    if new.email_opt_in then new.email_consented_at := coalesce(new.email_consented_at, now()); end if;
  end if;
  if new.opted_out then new.opted_out_at := coalesce(new.opted_out_at, now());
  else new.opted_out_at := null; end if;
  return new;
end $$;
drop trigger if exists member_prefs_before_write on public.member_preferences;
create trigger member_prefs_before_write before insert or update on public.member_preferences
  for each row execute function public.member_prefs_before_write();

-- Join form: consent_comms is now DERIVED from the channels the person ticked.
-- A request that sends only the old single consent flag (the previous form)
-- is treated as the legacy "all channels" consent and is marked as such.
create or replace function public.members_set_consent() returns trigger
  language plpgsql as $$
declare legacy boolean := false;
begin
  if new.consent_comms and not (new.reg_pref_whatsapp or new.reg_pref_sms or new.reg_pref_email) then
    legacy := true;
    new.reg_pref_whatsapp := true; new.reg_pref_sms := true; new.reg_pref_email := true;
  end if;
  new.consent_comms := new.reg_pref_whatsapp or new.reg_pref_sms or new.reg_pref_email;
  perform set_config('dcf.legacy_consent', case when legacy then '1' else '0' end, true);
  return new;
end $$;
drop trigger if exists members_set_consent on public.members;
create trigger members_set_consent before insert on public.members
  for each row execute function public.members_set_consent();

create or replace function public.members_create_preferences() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.member_preferences (member_id, whatsapp_opt_in, sms_opt_in, email_opt_in, consent_source)
  values (new.id, new.reg_pref_whatsapp, new.reg_pref_sms, new.reg_pref_email,
          case when current_setting('dcf.legacy_consent', true) = '1' then 'legacy_general_consent'
               when public.admin_role() is not null then 'admin'
               else 'registration' end)
  on conflict (member_id) do nothing;
  return new;
end $$;
drop trigger if exists members_create_preferences on public.members;
create trigger members_create_preferences after insert on public.members
  for each row execute function public.members_create_preferences();

-- Existing members: their one general consent carries over to all three channels,
-- dated from when they registered, and clearly marked as legacy.
insert into public.member_preferences
  (member_id, whatsapp_opt_in, sms_opt_in, email_opt_in,
   whatsapp_consented_at, sms_consented_at, email_consented_at, consent_source)
select m.id, m.consent_comms, m.consent_comms, m.consent_comms,
       case when m.consent_comms then m.created_at end,
       case when m.consent_comms then m.created_at end,
       case when m.consent_comms then m.created_at end,
       'legacy_general_consent'
from public.members m
on conflict (member_id) do nothing;

-- Close a gap: public sign-ups could set their own review_status. They can no longer.
drop policy if exists members_insert on public.members;
create policy members_insert on public.members for insert to anon
  with check (profile_approved = false and review_status = 'pending');

-- 3. Suppression list (opt-outs for people with no member record, e.g. visitors, and bounces)
create table if not exists public.contact_suppressions (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('email','sms','whatsapp','all')),
  address text not null,                       -- digits in international form (2348012345678) or lower-case email
  reason text,
  source text not null default 'admin'
    check (source in ('admin','stop_reply','unsubscribe_link','provider_bounce','complaint')),
  created_at timestamptz not null default now(),
  unique (channel, address)
);
create index if not exists contact_suppressions_address on public.contact_suppressions (address);

-- 4. Settings, rules, templates -----------------------------------------
create table if not exists public.communication_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.communication_settings (key, value, description) values
 ('timezone',   '"Africa/Lagos"', 'All scheduling uses this timezone'),
 ('test_mode',  '{"enabled": true, "recipients": []}', 'While enabled, messages go ONLY to the listed recipients (phone digits or email)'),
 ('retry',      '{"max_attempts": 3, "base_seconds": 60}', 'Exponential backoff: base_seconds x 2^attempt'),
 ('rate_limit', '{"per_minute": 30}', 'Maximum messages dispatched per minute'),
 ('retention',  '{"webhook_days": 90, "queue_days": 180, "log_days": 730, "audit_days": 1095}', 'Older rows are purged by purge_old_communication_data()')
on conflict (key) do nothing;

create table if not exists public.automation_rules (
  key text primary key check (key in ('welcome','visitor_followup','meeting_reminder','birthday','absent_followup','announcement')),
  mode text not null default 'disabled' check (mode in ('disabled','automatic','approval')),
  channels text[] not null default '{}' check (channels <@ array['email','sms','whatsapp']::text[]),
  config jsonb not null default '{}',          -- timing, thresholds, and the recommended mode for later
  audience jsonb not null default '{}',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.automation_rules (key, mode, channels, config) values
 ('welcome',          'disabled', '{}', '{"intended_mode":"automatic"}'),
 ('visitor_followup', 'disabled', '{}', '{"intended_mode":"approval","thank_you_delay_minutes":0}'),
 ('meeting_reminder', 'disabled', '{}', '{"intended_mode":"automatic","offsets_minutes":[1440,120],"optional_offsets_minutes":[30]}'),
 ('birthday',         'disabled', '{}', '{"intended_mode":"automatic","send_hour_local":8}'),
 ('absent_followup',  'disabled', '{}', '{"intended_mode":"approval","consecutive_sessions":2}'),
 ('announcement',     'disabled', '{}', '{"intended_mode":"approval"}')
on conflict (key) do nothing;

create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  category text not null,
  channel text not null default 'any' check (channel in ('any','email','sms','whatsapp')),
  language text not null default 'en',
  subject text,
  body text not null,
  variables text[] not null default '{}',
  whatsapp_template_name text,                 -- the Meta-approved template used for business-initiated WhatsApp
  is_active boolean not null default true,
  version int not null default 1,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key, channel, language)
);
insert into public.message_templates (key, category, subject, body, variables) values
 ('welcome','welcome','Welcome to Dunamis Campus Fellowship',
  'Hello {name}, welcome to Dunamis Campus Fellowship, UNN! {schedule} God bless you.', '{name,schedule}'),
 ('visitor_thanks','visitor_followup','Thank you for worshipping with us',
  'Hello {name}, thank you for worshipping with us at Dunamis Campus Fellowship. We were glad to have you and would love to see you again. God bless you.', '{name}'),
 ('absent_followup','absent_followup','We have been thinking of you',
  'Hello {name}, we missed you at Dunamis Campus Fellowship. We pray all is well with you and would love to see you at our next service. God bless you.', '{name}'),
 ('birthday','birthday','Happy birthday from DCF UNN',
  'Happy birthday, {name}! Everyone at Dunamis Campus Fellowship is celebrating you today. May God''s grace and favour be with you in the year ahead.', '{name}'),
 ('meeting_reminder','meeting_reminder','Reminder: {title}',
  'Hello {name}, a reminder that {title} holds {when} at {venue}. We look forward to seeing you.', '{name,title,when,venue}'),
 ('meeting_cancelled','meeting_cancelled','Cancelled: {title}',
  'Hello {name}, please note that {title} on {date} has been cancelled. {note}', '{name,title,date,note}'),
 ('meeting_venue_changed','meeting_venue_changed','New venue: {title}',
  'Hello {name}, the venue for {title} on {date} has changed to {venue}. {note}', '{name,title,date,venue,note}')
on conflict (key, channel, language) do nothing;

-- 5. Recurring meetings (editable) and one-off changes ------------------
create table if not exists public.meeting_schedule (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  weekday smallint not null check (weekday between 0 and 6),   -- 0 = Sunday ... 6 = Saturday
  start_time time not null,                                    -- local time (Africa/Lagos)
  venue text not null,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (weekday, start_time)
);
insert into public.meeting_schedule (title, weekday, start_time, venue) values
 ('Celebration Service', 2, '17:30', 'Faculty of Social Sciences Lecture Hall, opposite the VC''s Office'),
 ('Bible Study',        4, '17:00', 'Faculty of Social Sciences Lecture Hall, opposite the VC''s Office'),
 ('Friday Prayer',      5, '17:00', 'Lawn Tennis'),
 ('Evangelism',         6, '15:00', 'Lawn Tennis')
on conflict (weekday, start_time) do nothing;

create table if not exists public.meeting_exceptions (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.meeting_schedule(id) on delete cascade,
  on_date date not null,
  kind text not null check (kind in ('cancelled','venue_changed')),
  new_venue text,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (schedule_id, on_date),
  check (kind <> 'venue_changed' or new_venue is not null)
);

-- 6. Campaigns (special programmes and announcements) -------------------
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  event_at timestamptz,
  venue text,
  registration_url text,
  event_id uuid references public.events(id) on delete set null,
  audience jsonb not null default '{}',                      -- e.g. {"all_members":true,"levels":["100"],"departments":[]}
  channels text[] not null default '{}' check (channels <@ array['email','sms','whatsapp']::text[]),
  content jsonb not null default '{}',                       -- per-channel text the admin reviewed
  ai_generated boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft','pending_approval','approved','scheduled','processing','sent','failed','rejected','cancelled')),
  scheduled_for timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists campaigns_status on public.campaigns (status, scheduled_for);

-- 7. The queue: every message waits here before it is sent --------------
create table if not exists public.message_queue (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,                      -- same key = same message, never sent twice
  category text not null check (category in ('welcome','visitor_thanks','visitor_followup','meeting_reminder',
    'meeting_cancelled','meeting_venue_changed','birthday','absent_followup','announcement','manual')),
  mode text not null default 'automatic' check (mode in ('automatic','ai_draft','manual')),
  channel text not null check (channel in ('email','sms','whatsapp')),
  provider text check (provider in ('gmail','termii','whatsapp_cloud')),
  member_id uuid references public.members(id) on delete cascade,
  attendance_id uuid references public.attendance(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  recipient_name text,
  recipient_address text,                                    -- phone digits or email, copied at queue time
  subject text,
  body text not null,
  template_key text,
  template_vars jsonb not null default '{}',
  ai_generated boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft','pending_approval','approved','scheduled','processing','sent','delivered','failed','rejected','cancelled')),
  scheduled_for timestamptz,
  attempts int not null default 0,
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  dead_lettered_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists message_queue_due on public.message_queue (status, scheduled_for);
create index if not exists message_queue_retry on public.message_queue (status, next_attempt_at);
create index if not exists message_queue_member on public.message_queue (member_id);
create index if not exists message_queue_campaign on public.message_queue (campaign_id);

-- 8. Logs: extend the existing message_log instead of creating a duplicate
alter table public.message_log
  add column if not exists provider text,
  add column if not exists provider_message_id text,
  add column if not exists queue_id uuid references public.message_queue(id) on delete set null,
  add column if not exists category text,
  add column if not exists delivery_status text,             -- the provider's own status word
  add column if not exists delivery_updated_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists retry_count int not null default 0,
  add column if not exists scheduled_for timestamptz;

do $$ declare c text; begin
  for c in select conname from pg_constraint
           where conrelid = 'public.message_log'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%status%' loop
    execute format('alter table public.message_log drop constraint %I', c);
  end loop;
  alter table public.message_log add constraint message_log_status_check
    check (status in ('sent','delivered','failed'));
end $$;

create unique index if not exists message_log_provider_msg
  on public.message_log (provider, provider_message_id) where provider_message_id is not null;
create index if not exists message_log_created on public.message_log (created_at desc);

-- 9. Approvals, webhook inbox, admin audit trail ------------------------
create table if not exists public.message_approvals (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid references public.message_queue(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  action text not null check (action in ('submitted','edited','approved','rejected','scheduled','cancelled')),
  admin_user_id uuid references auth.users(id) on delete set null,
  admin_email text,
  admin_role text,
  note text,
  body_before text,
  body_after text,
  created_at timestamptz not null default now(),
  check (queue_id is not null or campaign_id is not null)
);
create index if not exists message_approvals_queue on public.message_approvals (queue_id, created_at);
create index if not exists message_approvals_campaign on public.message_approvals (campaign_id, created_at);

create table if not exists public.provider_webhooks (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('whatsapp_cloud','termii','gmail')),
  event_type text,
  provider_message_id text,
  dedupe_key text not null,                                  -- providers retry; the same event is stored once
  payload jsonb not null,
  signature_valid boolean,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  unique (provider, dedupe_key)
);
create index if not exists provider_webhooks_msg on public.provider_webhooks (provider, provider_message_id);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references auth.users(id) on delete set null,
  admin_email text,
  admin_role text,
  action text not null,
  entity text,
  entity_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_logs_created on public.admin_audit_logs (created_at desc);

-- 10. updated_at maintenance ---------------------------------------------
do $$ declare t text; begin
  foreach t in array array['automation_rules','communication_settings','message_templates','meeting_schedule',
                           'campaigns','message_queue'] loop
    execute format('drop trigger if exists touch_updated_at on public.%I', t);
    execute format('create trigger touch_updated_at before update on public.%I
                    for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- 11. Retention: purge old rows. Called by the scheduler (Phase 5), service role only.
create or replace function public.purge_old_communication_data() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r jsonb; w int; q int; l int; a int;
begin
  select value into r from public.communication_settings where key = 'retention';
  delete from public.provider_webhooks where received_at < now() - make_interval(days => coalesce((r->>'webhook_days')::int, 90));
  get diagnostics w = row_count;
  delete from public.message_queue
    where status in ('sent','delivered','failed','rejected','cancelled')
      and updated_at < now() - make_interval(days => coalesce((r->>'queue_days')::int, 180));
  get diagnostics q = row_count;
  delete from public.message_log where created_at < now() - make_interval(days => coalesce((r->>'log_days')::int, 730));
  get diagnostics l = row_count;
  delete from public.admin_audit_logs where created_at < now() - make_interval(days => coalesce((r->>'audit_days')::int, 1095));
  get diagnostics a = row_count;
  return jsonb_build_object('webhooks', w, 'queue', q, 'logs', l, 'audit', a);
end $$;
revoke all on function public.purge_old_communication_data() from public, anon, authenticated;
grant execute on function public.purge_old_communication_data() to service_role;

-- 12. Row Level Security -------------------------------------------------
-- Role model: super_admin = everything. content_admin = write drafts, templates, schedule, consent.
-- moderator = read only. Approving and sending always go through the server, which checks the role.
do $$ declare t text; begin
  foreach t in array array['member_preferences','contact_suppressions','communication_settings','automation_rules',
    'message_templates','meeting_schedule','meeting_exceptions','campaigns','message_queue','message_approvals',
    'provider_webhooks','admin_audit_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;
revoke all on table public.message_log from anon;

-- Read access
drop policy if exists "admins read" on public.member_preferences;
create policy "admins read" on public.member_preferences for select to authenticated using (public.admin_role() is not null);
drop policy if exists "admins read" on public.contact_suppressions;
create policy "admins read" on public.contact_suppressions for select to authenticated using (public.admin_role() is not null);
drop policy if exists "admins read" on public.communication_settings;
create policy "admins read" on public.communication_settings for select to authenticated using (public.admin_role() is not null);
drop policy if exists "admins read" on public.automation_rules;
create policy "admins read" on public.automation_rules for select to authenticated using (public.admin_role() is not null);
drop policy if exists "admins read" on public.message_templates;
create policy "admins read" on public.message_templates for select to authenticated using (public.admin_role() is not null);
drop policy if exists "admins read" on public.meeting_schedule;
create policy "admins read" on public.meeting_schedule for select to authenticated using (public.admin_role() is not null);
drop policy if exists "admins read" on public.meeting_exceptions;
create policy "admins read" on public.meeting_exceptions for select to authenticated using (public.admin_role() is not null);
drop policy if exists "admins read" on public.campaigns;
create policy "admins read" on public.campaigns for select to authenticated using (public.admin_role() is not null);
drop policy if exists "admins read" on public.message_queue;
create policy "admins read" on public.message_queue for select to authenticated using (public.admin_role() is not null);
drop policy if exists "admins read" on public.message_approvals;
create policy "admins read" on public.message_approvals for select to authenticated
  using (public.has_admin_role(array['super_admin','content_admin']));
drop policy if exists "super admin read" on public.provider_webhooks;
create policy "super admin read" on public.provider_webhooks for select to authenticated using (public.has_admin_role(array['super_admin']));
drop policy if exists "super admin read" on public.admin_audit_logs;
create policy "super admin read" on public.admin_audit_logs for select to authenticated using (public.has_admin_role(array['super_admin']));
drop policy if exists "admins read message log" on public.message_log;
create policy "admins read message log" on public.message_log for select to authenticated using (public.admin_role() is not null);

-- Write access (the queue, approvals, webhooks and audit log are written only by the server)
grant update on public.member_preferences to authenticated;
drop policy if exists "consent managers update" on public.member_preferences;
create policy "consent managers update" on public.member_preferences for update to authenticated
  using (public.has_admin_role(array['super_admin','content_admin']))
  with check (public.has_admin_role(array['super_admin','content_admin']));

grant insert on public.contact_suppressions to authenticated;
grant delete on public.contact_suppressions to authenticated;
drop policy if exists "add suppression" on public.contact_suppressions;
create policy "add suppression" on public.contact_suppressions for insert to authenticated
  with check (public.has_admin_role(array['super_admin','content_admin']));
drop policy if exists "remove suppression" on public.contact_suppressions;
create policy "remove suppression" on public.contact_suppressions for delete to authenticated
  using (public.has_admin_role(array['super_admin']));   -- re-enabling an opted-out person is a super admin decision

grant insert, update on public.communication_settings to authenticated;
drop policy if exists "super admin write" on public.communication_settings;
create policy "super admin write" on public.communication_settings for all to authenticated
  using (public.has_admin_role(array['super_admin'])) with check (public.has_admin_role(array['super_admin']));

grant update on public.automation_rules to authenticated;
drop policy if exists "super admin update" on public.automation_rules;
create policy "super admin update" on public.automation_rules for update to authenticated
  using (public.has_admin_role(array['super_admin'])) with check (public.has_admin_role(array['super_admin']));

grant insert, update, delete on public.message_templates to authenticated;
drop policy if exists "content write" on public.message_templates;
create policy "content write" on public.message_templates for insert to authenticated
  with check (public.has_admin_role(array['super_admin','content_admin']));
drop policy if exists "content update" on public.message_templates;
create policy "content update" on public.message_templates for update to authenticated
  using (public.has_admin_role(array['super_admin','content_admin']))
  with check (public.has_admin_role(array['super_admin','content_admin']));
drop policy if exists "super delete" on public.message_templates;
create policy "super delete" on public.message_templates for delete to authenticated using (public.has_admin_role(array['super_admin']));

grant insert, update, delete on public.meeting_schedule to authenticated;
drop policy if exists "content write" on public.meeting_schedule;
create policy "content write" on public.meeting_schedule for all to authenticated
  using (public.has_admin_role(array['super_admin','content_admin']))
  with check (public.has_admin_role(array['super_admin','content_admin']));
grant insert, update, delete on public.meeting_exceptions to authenticated;
drop policy if exists "content write" on public.meeting_exceptions;
create policy "content write" on public.meeting_exceptions for all to authenticated
  using (public.has_admin_role(array['super_admin','content_admin']))
  with check (public.has_admin_role(array['super_admin','content_admin']));

-- Campaigns: admins may create and edit DRAFTS. Approval, scheduling and sending are server-side.
grant insert, update, delete on public.campaigns to authenticated;
drop policy if exists "draft insert" on public.campaigns;
create policy "draft insert" on public.campaigns for insert to authenticated
  with check (public.has_admin_role(array['super_admin','content_admin']) and status in ('draft','pending_approval'));
drop policy if exists "draft update" on public.campaigns;
create policy "draft update" on public.campaigns for update to authenticated
  using (public.has_admin_role(array['super_admin','content_admin']) and status in ('draft','pending_approval','rejected'))
  with check (public.has_admin_role(array['super_admin','content_admin']) and status in ('draft','pending_approval','cancelled'));
drop policy if exists "draft delete" on public.campaigns;
create policy "draft delete" on public.campaigns for delete to authenticated
  using (public.has_admin_role(array['super_admin','content_admin']) and status in ('draft','rejected'));

commit;
