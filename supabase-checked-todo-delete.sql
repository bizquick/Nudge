-- Checked times, shared to-do completion, deleting your own nudges, and "new message" tracking.
-- Run ONCE in Supabase: Dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
-- Everything runs as one unit: if any line fails, nothing changes.
--
-- After this:
--   - Each nudge remembers WHEN it was checked (shown on the card next to when it was sent).
--   - To-do lists remember who has tapped Complete; the list counts as checked once everyone has.
--   - The sender of a nudge can delete it (for everyone in it).
--   - A message on a checked nudge no longer un-checks it. Instead, each person's app
--     remembers when they last opened it, and brings it back to the top of Home when
--     someone else writes something newer.

begin;

-- When it was checked off (to-do lists: when the last person tapped Complete)
alter table reminders add column if not exists checked_at timestamptz;

-- To-do lists: the names of everyone who has tapped Complete
alter table reminders add column if not exists completed_by text[] not null default '{}';

-- Tap Complete on a to-do list (or tap again to undo). Done in one step on the
-- server, so two people tapping at the same moment can't overwrite each other.
-- Runs with the caller's own permissions, so the normal "people in a nudge" rule applies.
create or replace function public.toggle_todo_complete(p_id uuid)
returns reminders
language plpgsql
set search_path = public
as $$
declare
  me text := public.my_display_name();
  r reminders;
  all_done boolean;
begin
  if me is null then
    raise exception 'not signed in';
  end if;

  update reminders
  set completed_by = case
        when me = any(completed_by) then array_remove(completed_by, me)
        else array_append(completed_by, me)
      end
  where id = p_id
    and todo_items is not null
    and (sender = me or me = any(recipients))
  returning * into r;

  if r.id is null then
    raise exception 'not allowed';
  end if;

  select bool_and(p = any(r.completed_by)) into all_done
  from unnest(array_append(r.recipients, r.sender)) as p;

  update reminders
  set checked_out = coalesce(all_done, false),
      checked_at = case when coalesce(all_done, false) then coalesce(checked_at, now()) else null end
  where id = p_id
  returning * into r;

  return r;
end
$$;

revoke all on function public.toggle_todo_complete(uuid) from public, anon;
grant execute on function public.toggle_todo_complete(uuid) to authenticated;

-- The sender deletes a nudge they sent: removes it, and everything attached to it, for everyone.
create or replace function public.delete_my_nudge(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  me text := public.my_display_name();
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  if not exists (select 1 from reminders where id = p_id and sender = me) then
    raise exception 'only the sender can delete a nudge';
  end if;

  delete from messages where reminder_id = p_id;
  delete from reminder_reactions where reminder_id = p_id;
  delete from reminder_votes where reminder_id = p_id;
  delete from user_favorites where reminder_id = p_id;
  delete from favorite_folder_items where reminder_id = p_id;
  delete from nudge_reads where reminder_id = p_id;
  delete from mutes where target = 'nudge:' || p_id::text;
  delete from reminders where id = p_id;
end
$$;

-- When each person last opened each nudge (private to that person)
create table if not exists nudge_reads (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reminder_id uuid not null references reminders(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (owner_id, reminder_id)
);

alter table nudge_reads enable row level security;

drop policy if exists "own read times" on nudge_reads;
create policy "own read times" on nudge_reads
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- (delete_my_nudge is created above before nudge_reads exists; Postgres only checks
-- table names when the function runs, so the order is fine.)
revoke all on function public.delete_my_nudge(uuid) from public, anon;
grant execute on function public.delete_my_nudge(uuid) to authenticated;

-- A new message no longer un-checks a nudge (it stays in Checked and pops to the top of Home instead)
drop trigger if exists reopen_nudge_on_message on messages;

commit;

notify pgrst, 'reload schema';

-- Proof it worked: should show 5 rows
select 'column' as kind, column_name as name from information_schema.columns
  where table_schema = 'public' and table_name = 'reminders' and column_name in ('checked_at', 'completed_by')
union all
select 'function', proname from pg_proc where proname in ('toggle_todo_complete', 'delete_my_nudge')
union all
select 'table', to_regclass('public.nudge_reads')::text;
