-- Nudge update: silencing, priority nudges, to-do lists, and "a new message re-opens a nudge".
-- Run ONCE in Supabase: SQL Editor → + New query → paste this whole file → click inside the box → Run.
-- Safe to run again. Needs public.my_display_name() from supabase-privacy-fix.sql (already run).

begin;

-- 🤯 Priority nudges and to-do lists are stored on the nudge itself
alter table reminders add column if not exists prioritized_at timestamptz;
alter table reminders add column if not exists todo_items jsonb;

-- Silenced notifications. target is 'contact:<name>', 'group:<key>' or 'nudge:<id>'.
create table if not exists mutes (
  owner_name text not null,
  target text not null,
  created_at timestamptz not null default now(),
  primary key (owner_name, target)
);

alter table mutes enable row level security;

drop policy if exists "own mutes" on mutes;
create policy "own mutes" on mutes
  for all to authenticated
  using (owner_name = public.my_display_name())
  with check (owner_name = public.my_display_name());

-- Has p_owner silenced this nudge, or the chat it belongs to? p_actor is whoever
-- just sent the nudge/message (for a 1-on-1 chat, that's the "contact").
-- The group key matches the app's: everyone in the nudge, sorted, joined with "|".
create or replace function public.is_muted(p_owner text, p_reminder uuid, p_actor text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from reminders r
    join mutes m on m.owner_name = p_owner
    where r.id = p_reminder
      and m.target in (
        'nudge:' || r.id::text,
        case
          when (select count(*) from unnest(r.recipients) x(name) where x.name <> r.sender) > 1
            then 'group:' || (
              select string_agg(n, '|' order by n collate "C")
              from (select distinct unnest(array_append(r.recipients, r.sender)) as n) people
            )
          else 'contact:' || p_actor
        end
      )
  )
$$;

revoke all on function public.is_muted(text, uuid, text) from public, anon, authenticated;
grant execute on function public.is_muted(text, uuid, text) to service_role;

-- A new chat message brings its nudge back: unchecked and out of the archive —
-- unless everyone else in the nudge has silenced it.
create or replace function public.reopen_nudge_on_message()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update reminders r
  set checked_out = false, archived = false
  where r.id = NEW.reminder_id
    and (r.checked_out or r.archived)
    and exists (
      select 1
      from unnest(array_append(r.recipients, r.sender)) p(name)
      where p.name <> NEW.sender
        and not public.is_muted(p.name, r.id, NEW.sender)
    );
  return NEW;
end
$$;

drop trigger if exists reopen_nudge_on_message on messages;
create trigger reopen_nudge_on_message after insert on messages
  for each row execute function public.reopen_nudge_on_message();

-- Lets the password-reset email remind people of their Nudge name
-- (new sign-ups store it automatically; this fills it in for existing accounts).
update auth.users u
set raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('display_name', p.display_name)
from profiles p
where p.id = u.id
  and coalesce(u.raw_user_meta_data ->> 'display_name', '') is distinct from p.display_name;

commit;

notify pgrst, 'reload schema';

-- Proof it worked: should show 4 rows
select 'column' as kind, column_name as name from information_schema.columns
  where table_schema = 'public' and table_name = 'reminders' and column_name in ('prioritized_at', 'todo_items')
union all
select 'table', to_regclass('public.mutes')::text
union all
select 'trigger', tgname from pg_trigger where tgname = 'reopen_nudge_on_message';
