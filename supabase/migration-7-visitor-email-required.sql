-- Visitor email is compulsory; the check-in notice is their consent.
create or replace function public.check_in_visitor(p_code text, p_name text, p_phone text, p_email text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s public.sessions; n text; e text;
begin
 select * into s from public.sessions where code=trim(p_code) and is_open order by created_at desc limit 1;
 if not found then return jsonb_build_object('status','bad_code'); end if;
 if length(trim(coalesce(p_name,'')))<2 then return jsonb_build_object('status','bad_name'); end if;
 n:=right(regexp_replace(coalesce(p_phone,''),'\D','','g'),10);
 if length(n)<10 then return jsonb_build_object('status','bad_phone'); end if;
 e:=lower(left(trim(coalesce(p_email,'')),200));
 if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('status','bad_email'); end if;
 if not exists(select 1 from public.attendance where session_id=s.id and right(regexp_replace(coalesce(visitor_phone,''),'\D','','g'),10)=n) then
  insert into public.attendance(session_id,visitor_name,visitor_phone,visitor_email,visitor_email_consent,method)
  values(s.id,left(trim(p_name),120),left(trim(p_phone),30),e,true,'self');
 end if;
 return jsonb_build_object('status','ok','name',split_part(trim(p_name),' ',1),'kind',s.kind);
end $$;
grant execute on function public.check_in_visitor(text,text,text,text) to anon, authenticated;
