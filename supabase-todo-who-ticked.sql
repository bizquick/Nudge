-- To-do lists: remember who ticked each line (and when), one line at a time.
-- Run ONCE in Supabase: Dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
--
-- Ticking a line goes through this function, which changes only that one line on the
-- server. That way two people ticking different lines at the same moment can't
-- overwrite each other's ticks. Runs with the caller's own permissions, so only
-- people in the nudge can tick its lines.

begin;

create or replace function public.toggle_todo_item(p_id uuid, p_index int)
returns reminders
language plpgsql
set search_path = public
as $$
declare
  me text := public.my_display_name();
  r reminders;
  item jsonb;
begin
  if me is null then
    raise exception 'not signed in';
  end if;

  select * into r from reminders
  where id = p_id
    and todo_items is not null
    and (sender = me or me = any(recipients))
  for update;

  if r.id is null then
    raise exception 'not allowed';
  end if;

  item := r.todo_items -> p_index;
  if item is null then
    raise exception 'no such line';
  end if;

  if coalesce((item ->> 'done')::boolean, false) then
    item := jsonb_build_object('text', item -> 'text', 'done', false);
  else
    item := item || jsonb_build_object('done', true, 'by', me, 'at', now());
  end if;

  update reminders
  set todo_items = jsonb_set(todo_items, array[p_index::text], item)
  where id = p_id
  returning * into r;

  return r;
end
$$;

revoke all on function public.toggle_todo_item(uuid, int) from public, anon;
grant execute on function public.toggle_todo_item(uuid, int) to authenticated;

commit;

notify pgrst, 'reload schema';

-- Proof it worked: should show 1 row
select proname from pg_proc where proname = 'toggle_todo_item';
