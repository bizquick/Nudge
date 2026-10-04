-- Protect what's inside a nudge. Run ONCE in Supabase:
--   Dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
--
-- Before: anyone in a nudge could change any part of it (the app never did, but
-- someone poking at the app's code could rewrite a sender's title, link, or who it
-- was sent to).
--
-- After, checked on the server before every change to a nudge:
--   - Nobody can change who sent a nudge or when it was sent.
--   - The SENDER can still change everything else about their own nudge.
--   - EVERYONE ELSE in it can only do what the app's buttons do: check it off,
--     archive, prioritize, tick to-do lines, tap Complete (for themselves only),
--     rename a group, rearrange their lists, and edit titles in group chats.
--     The description, link, photo, category, and recipients are the sender's alone.
--   - To-do lists: anyone in it can tick lines, but only the sender can change their wording.
--   - Complete: you can only tap Complete (or undo it) for yourself.
-- Server jobs and this SQL Editor aren't affected.

begin;

create or replace function public.protect_nudge_edits()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  me text := public.my_display_name();
  open_to_everyone text[] := array[
    'checked_out', 'checked_at', 'archived', 'favorited', 'prioritized_at',
    'todo_items', 'completed_by', 'group_name', 'manual_order', 'curated_order'
  ];
  old_texts jsonb;
  new_texts jsonb;
begin
  -- Server-side jobs (no signed-in person) aren't limited
  if auth.uid() is null or me is null then
    return NEW;
  end if;

  if NEW.id is distinct from OLD.id
     or NEW.sender is distinct from OLD.sender
     or NEW.created_at is distinct from OLD.created_at then
    raise exception 'A nudge''s sender and send time can''t be changed';
  end if;

  -- Complete on a to-do list: only for yourself, whoever you are
  if NEW.completed_by is distinct from OLD.completed_by and exists (
    select 1 from (
      (select unnest(coalesce(NEW.completed_by, '{}')) except select unnest(coalesce(OLD.completed_by, '{}')))
      union
      (select unnest(coalesce(OLD.completed_by, '{}')) except select unnest(coalesce(NEW.completed_by, '{}')))
    ) changed(name)
    where changed.name <> me
  ) then
    raise exception 'You can only mark a to-do list complete for yourself';
  end if;

  -- The sender can change the rest of their own nudge
  if me = OLD.sender then
    return NEW;
  end if;

  -- In group chats, anyone in the group can edit a nudge's title (the pencil button)
  if cardinality(array_remove(coalesce(OLD.recipients, array[OLD.recipient]), OLD.sender)) > 1 then
    open_to_everyone := open_to_everyone || array['title'];
  end if;

  if (to_jsonb(NEW) - open_to_everyone) is distinct from (to_jsonb(OLD) - open_to_everyone) then
    raise exception 'Only the sender can change that part of a nudge';
  end if;

  -- To-do lists: ticking is fine, rewording isn't
  if NEW.todo_items is distinct from OLD.todo_items then
    select coalesce(jsonb_agg(e -> 'text' order by i), '[]'::jsonb) into old_texts
    from jsonb_array_elements(case when jsonb_typeof(OLD.todo_items) = 'array' then OLD.todo_items else '[]'::jsonb end)
      with ordinality as t(e, i);
    select coalesce(jsonb_agg(e -> 'text' order by i), '[]'::jsonb) into new_texts
    from jsonb_array_elements(case when jsonb_typeof(NEW.todo_items) = 'array' then NEW.todo_items else '[]'::jsonb end)
      with ordinality as t(e, i);
    if old_texts is distinct from new_texts then
      raise exception 'Only the sender can change the wording of a to-do list';
    end if;
  end if;

  return NEW;
end
$$;

drop trigger if exists protect_nudge_edits on reminders;
create trigger protect_nudge_edits
  before update on reminders
  for each row execute function public.protect_nudge_edits();

commit;

-- Proof it worked: should show 1 row
select tgname as installed from pg_trigger where tgname = 'protect_nudge_edits';
