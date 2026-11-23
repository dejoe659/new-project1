-- Security hardening (applied to the live project).
alter function public.touch_updated_at() set search_path = public;
alter function public.member_prefs_before_write() set search_path = public;
alter function public.members_set_consent() set search_path = public;
revoke execute on function public.members_create_preferences() from public, anon, authenticated;
create policy deny_all_api on public.care_requests for all to anon, authenticated using (false) with check (false);
create policy deny_all_api on public.care_team for all to anon, authenticated using (false) with check (false);
create policy deny_all_api on public.academic_requests for all to anon, authenticated using (false) with check (false);
create policy deny_all_api on public.academic_coordinators for all to anon, authenticated using (false) with check (false);
revoke all on public.faculties, public.departments from anon, authenticated;
grant select on public.faculties, public.departments to anon, authenticated;
revoke all on public.resources from anon, authenticated;
grant select on public.resources to anon;
grant select, insert, update, delete on public.resources to authenticated;
revoke all on public.event_registrations from anon;
revoke truncate, references, trigger on public.event_registrations from authenticated;
revoke truncate, references, trigger on public.message_log from authenticated;
