-- Group chat pictures. Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
--
-- A group is identified by everyone in it (their names, sorted, joined with "|"),
-- the same way the app already groups nudges into chats. Anyone in a group can set
-- or change its picture, and everyone in the group sees it. People outside can't.

begin;

create table if not exists group_avatars (
  group_key text primary key,
  avatar text,                       -- a photo address, or "emoji:..." like profile pictures
  updated_by text not null default public.my_display_name(),
  updated_at timestamptz not null default now()
);
alter table group_avatars enable row level security;

drop policy if exists "people in the group see its picture" on group_avatars;
create policy "people in the group see its picture" on group_avatars
  for select to authenticated
  using (public.my_display_name() = any(string_to_array(group_key, '|')));

drop policy if exists "people in the group set its picture" on group_avatars;
create policy "people in the group set its picture" on group_avatars
  for insert to authenticated
  with check (public.my_display_name() = any(string_to_array(group_key, '|')) and updated_by = public.my_display_name());

drop policy if exists "people in the group change its picture" on group_avatars;
create policy "people in the group change its picture" on group_avatars
  for update to authenticated
  using (public.my_display_name() = any(string_to_array(group_key, '|')))
  with check (public.my_display_name() = any(string_to_array(group_key, '|')) and updated_by = public.my_display_name());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'group_avatars') then
    alter publication supabase_realtime add table group_avatars;
  end if;
end
$$;

commit;

notify pgrst, 'reload schema';

-- Proof it worked: should show 1 row
select to_regclass('public.group_avatars')::text as added;
