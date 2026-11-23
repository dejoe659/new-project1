-- Freshers' guides and academic support live in the same managed library as sermons (Admin > Sermons).
alter table public.resources drop constraint if exists resources_kind_check;
alter table public.resources add constraint resources_kind_check check (kind in ('sermon','audio','video','study','discipleship','devotional','fresher','academic'));
