-- Build 4: nudge requests & blocking, personal "checked", shared to-do editing,
-- personal Popular/Explore, group rename notices, owner user list, smarter notifications.
-- Run ONCE in Supabase: Dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
-- Safe to run more than once. Everything runs as one unit: if any line fails, nothing changes.

begin;

-- ============================================================================
-- 1. Connections: who has accepted (or declined, or blocked) whom.
--    Each person only ever sees their own rows.
-- ============================================================================
create table if not exists connections (
  owner_name text not null,          -- the person this choice belongs to
  other_name text not null,          -- the person it's about
  status text not null check (status in ('accepted', 'declined', 'blocked')),
  declined_at timestamptz,           -- nudges sent before this stay hidden for good
  updated_at timestamptz not null default now(),
  primary key (owner_name, other_name)
);
alter table connections enable row level security;
drop policy if exists "own connections" on connections;
create policy "own connections" on connections
  for all to authenticated
  using (owner_name = public.my_display_name())
  with check (owner_name = public.my_display_name());

-- Everyone who already sent or received nudges with each other counts as accepted,
-- so nobody gets surprise requests from people they already talk to.
insert into connections (owner_name, other_name, status)
select distinct x, r.sender, 'accepted'
from reminders r cross join unnest(r.recipients) as x
where x <> r.sender
on conflict (owner_name, other_name) do nothing;

insert into connections (owner_name, other_name, status)
select distinct r.sender, x, 'accepted'
from reminders r cross join unnest(r.recipients) as x
where x <> r.sender
on conflict (owner_name, other_name) do nothing;

-- Can this person see a nudge from that sender (sent at that time)?
create or replace function public.can_receive(p_receiver text, p_sender text, p_created timestamptz)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_receiver = p_sender or exists (
    select 1 from connections c
    where c.owner_name = p_receiver and c.other_name = p_sender
      and c.status = 'accepted'
      and (c.declined_at is null or p_created > c.declined_at)
  )
$$;

-- Sending someone a nudge means you accept nudges back from them
create or replace function public.accept_my_recipients()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into connections (owner_name, other_name, status)
  select NEW.sender, x, 'accepted'
  from unnest(coalesce(NEW.recipients, array[NEW.recipient])) as x
  where x <> NEW.sender
  on conflict (owner_name, other_name) do update
    set status = 'accepted', updated_at = now()
    where connections.status = 'declined';
  return NEW;
end
$$;
drop trigger if exists accept_my_recipients on reminders;
create trigger accept_my_recipients after insert on reminders
  for each row execute function public.accept_my_recipients();

-- Recipients only see a nudge once they've accepted its sender (and never if blocked)
drop policy if exists "see your own and public nudges" on reminders;
create policy "see your own and public nudges" on reminders
  for select to authenticated
  using (
    is_public
    or sender = public.my_display_name()
    or (public.my_display_name() = any(recipients)
        and public.can_receive(public.my_display_name(), sender, created_at))
  );

-- Requests waiting for me: who, how many nudges, and when the latest arrived (no content)
create or replace function public.my_nudge_requests()
returns table (sender text, waiting bigint, latest timestamptz)
language sql stable security definer set search_path = public
as $$
  select r.sender, count(*), max(r.created_at)
  from reminders r
  where public.my_display_name() = any(r.recipients)
    and r.sender <> public.my_display_name()
    and not public.can_receive(public.my_display_name(), r.sender, r.created_at)
    and not exists (
      select 1 from connections c
      where c.owner_name = public.my_display_name() and c.other_name = r.sender
        and (c.status = 'blocked' or (c.declined_at is not null and r.created_at <= c.declined_at))
    )
  group by r.sender
$$;
revoke all on function public.my_nudge_requests() from public, anon;
grant execute on function public.my_nudge_requests() to authenticated;

-- Nudges I sent that someone hasn't accepted yet (a block looks the same: still waiting)
create or replace function public.my_pending_recipients()
returns table (reminder_id uuid, recipient text)
language sql stable security definer set search_path = public
as $$
  select r.id, x
  from reminders r cross join unnest(r.recipients) as x
  where r.sender = public.my_display_name()
    and x <> r.sender
    and not public.can_receive(x, r.sender, r.created_at)
$$;
revoke all on function public.my_pending_recipients() from public, anon;
grant execute on function public.my_pending_recipients() to authenticated;

-- ============================================================================
-- 2. Personal state per nudge: checked, archived, and Popular/Explore progress.
--    Your check never changes anyone else's view. People in a nudge can see each
--    other's checks (so the sender sees "Checked"); strangers can't.
-- ============================================================================
create table if not exists nudge_user_state (
  owner_name text not null,
  reminder_id uuid not null references reminders(id) on delete cascade,
  checked_at timestamptz,
  archived_at timestamptz,
  popular_checked_at timestamptz,   -- checked from Popular/Explore (separate from your feed)
  explore_shown_at timestamptz,     -- in your current Explore batch
  explore_done_at timestamptz,      -- dropped from your Explore for good
  primary key (owner_name, reminder_id)
);
alter table nudge_user_state enable row level security;

drop policy if exists "read own and fellow participants' state" on nudge_user_state;
create policy "read own and fellow participants' state" on nudge_user_state
  for select to authenticated
  using (
    owner_name = public.my_display_name()
    or exists (
      select 1 from reminders r
      where r.id = nudge_user_state.reminder_id
        and (r.sender = public.my_display_name() or public.my_display_name() = any(r.recipients))
        and (nudge_user_state.owner_name = r.sender or nudge_user_state.owner_name = any(r.recipients))
    )
  );
drop policy if exists "write own state" on nudge_user_state;
create policy "write own state" on nudge_user_state
  for insert to authenticated
  with check (owner_name = public.my_display_name() and exists (select 1 from reminders r where r.id = reminder_id));
drop policy if exists "update own state" on nudge_user_state;
create policy "update own state" on nudge_user_state
  for update to authenticated
  using (owner_name = public.my_display_name())
  with check (owner_name = public.my_display_name());
drop policy if exists "delete own state" on nudge_user_state;
create policy "delete own state" on nudge_user_state
  for delete to authenticated
  using (owner_name = public.my_display_name());

-- Carry over what's already checked/archived (the old switches were shared by everyone)
insert into nudge_user_state (owner_name, reminder_id, checked_at)
select x, r.id, coalesce(r.checked_at, r.created_at)
from reminders r cross join unnest(r.recipients) as x
where r.checked_out and r.todo_items is null
on conflict (owner_name, reminder_id) do update
  set checked_at = coalesce(nudge_user_state.checked_at, excluded.checked_at);

insert into nudge_user_state (owner_name, reminder_id, archived_at)
select distinct x, r.id, r.created_at
from reminders r cross join unnest(array_append(r.recipients, r.sender)) as x
where r.archived
on conflict (owner_name, reminder_id) do update
  set archived_at = coalesce(nudge_user_state.archived_at, excluded.archived_at);

-- ============================================================================
-- 3. To-do lists anyone in them can edit (add, reword, delete, tick), one change
--    at a time on the server so people editing together don't undo each other.
-- ============================================================================
-- Give every existing to-do line a permanent id
update reminders r
set todo_items = (
  select jsonb_agg(case when e ? 'id' then e else e || jsonb_build_object('id', gen_random_uuid()::text) end order by i)
  from jsonb_array_elements(r.todo_items) with ordinality as t(e, i)
)
where jsonb_typeof(r.todo_items) = 'array'
  and exists (select 1 from jsonb_array_elements(r.todo_items) e where not e ? 'id');

create or replace function public.todo_edit(p_id uuid, p_op text, p_item text default null, p_text text default null)
returns reminders
language plpgsql
set search_path = public
as $$
declare
  me text := public.my_display_name();
  r reminders;
  items jsonb;
  out_items jsonb := '[]'::jsonb;
  e jsonb;
  clean text := nullif(btrim(coalesce(p_text, '')), '');
begin
  if me is null then raise exception 'not signed in'; end if;

  select * into r from reminders
  where id = p_id and todo_items is not null and (sender = me or me = any(recipients))
  for update;
  if r.id is null then raise exception 'not allowed'; end if;
  items := case when jsonb_typeof(r.todo_items) = 'array' then r.todo_items else '[]'::jsonb end;

  if p_op = 'add' then
    if clean is null then raise exception 'empty item'; end if;
    items := items || jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'text', left(clean, 300), 'done', false));
    -- a new item means the list isn't finished any more
    update reminders set todo_items = items, completed_by = '{}', checked_out = false, checked_at = null
    where id = p_id returning * into r;
    return r;
  end if;

  for e in select value from jsonb_array_elements(items) loop
    if e ->> 'id' = p_item then
      if p_op = 'delete' then
        continue;
      elsif p_op = 'edit' then
        if clean is null then continue; end if;  -- clearing the words deletes the line
        e := e || jsonb_build_object('text', left(clean, 300));
      elsif p_op = 'toggle' then
        if coalesce((e ->> 'done')::boolean, false) then
          e := jsonb_build_object('id', e -> 'id', 'text', e -> 'text', 'done', false);
        else
          e := e || jsonb_build_object('done', true, 'by', me, 'at', now());
        end if;
      end if;
    end if;
    out_items := out_items || jsonb_build_array(e);
  end loop;

  update reminders set todo_items = out_items where id = p_id returning * into r;
  return r;
end
$$;
revoke all on function public.todo_edit(uuid, text, text, text) from public, anon;
grant execute on function public.todo_edit(uuid, text, text, text) to authenticated;

-- ============================================================================
-- 4. Group rename notices: remember who renamed a group, and when.
-- ============================================================================
alter table reminders add column if not exists group_renamed_by text;
alter table reminders add column if not exists group_renamed_at timestamptz;

-- The protection rule from before, updated: anyone in a to-do list can now reword it,
-- and anyone in a group can record a rename (but only as themselves).
create or replace function public.protect_nudge_edits()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  me text := public.my_display_name();
  open_to_everyone text[] := array[
    'checked_out', 'checked_at', 'archived', 'favorited', 'prioritized_at',
    'todo_items', 'completed_by', 'group_name', 'group_renamed_by', 'group_renamed_at',
    'manual_order', 'curated_order'
  ];
begin
  if auth.uid() is null or me is null then
    return NEW;
  end if;

  if NEW.id is distinct from OLD.id
     or NEW.sender is distinct from OLD.sender
     or NEW.created_at is distinct from OLD.created_at then
    raise exception 'A nudge''s sender and send time can''t be changed';
  end if;

  if NEW.completed_by is distinct from OLD.completed_by
     and NEW.completed_by <> '{}'::text[]
     and exists (
       select 1 from (
         (select unnest(coalesce(NEW.completed_by, '{}')) except select unnest(coalesce(OLD.completed_by, '{}')))
         union
         (select unnest(coalesce(OLD.completed_by, '{}')) except select unnest(coalesce(NEW.completed_by, '{}')))
       ) changed(name)
       where changed.name <> me
     ) then
    raise exception 'You can only mark a to-do list complete for yourself';
  end if;

  if NEW.group_renamed_by is distinct from OLD.group_renamed_by and NEW.group_renamed_by is distinct from me then
    raise exception 'You can only rename a group as yourself';
  end if;

  if me = OLD.sender then
    return NEW;
  end if;

  if cardinality(array_remove(coalesce(OLD.recipients, array[OLD.recipient]), OLD.sender)) > 1 then
    open_to_everyone := open_to_everyone || array['title'];
  end if;

  if (to_jsonb(NEW) - open_to_everyone) is distinct from (to_jsonb(OLD) - open_to_everyone) then
    raise exception 'Only the sender can change that part of a nudge';
  end if;

  return NEW;
end
$$;

-- ============================================================================
-- 5. Notifications: who should hear about what (used only by the notification server).
-- ============================================================================
-- 'ok' = send it, 'request' = send a "wants to send you nudges" alert, 'skip' = don't
create or replace function public.push_allowed(p_owner text, p_reminder uuid, p_actor text)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  r reminders;
  waiting bigint;
begin
  select * into r from reminders where id = p_reminder;
  if r.id is null then return 'skip'; end if;

  -- Blocked the person acting? Never hear from them.
  if exists (select 1 from connections where owner_name = p_owner and other_name = p_actor and status = 'blocked') then
    return 'skip';
  end if;

  -- A recipient who hasn't accepted the sender yet
  if p_owner <> r.sender and p_owner = any(r.recipients) and not public.can_receive(p_owner, r.sender, r.created_at) then
    if p_actor <> r.sender then return 'skip'; end if;
    if exists (select 1 from connections where owner_name = p_owner and other_name = r.sender
               and declined_at is not null and r.created_at <= declined_at) then
      return 'skip';
    end if;
    -- Only the first waiting nudge triggers a request alert (no spamming)
    select count(*) into waiting from reminders x
    where x.sender = r.sender and p_owner = any(x.recipients)
      and not public.can_receive(p_owner, x.sender, x.created_at);
    return case when waiting = 1 then 'request' else 'skip' end;
  end if;

  if public.is_muted(p_owner, p_reminder, p_actor) then return 'skip'; end if;
  return 'ok';
end
$$;
revoke all on function public.push_allowed(text, uuid, text) from public, anon, authenticated;
grant execute on function public.push_allowed(text, uuid, text) to service_role;

-- The red number on the app icon: nudges waiting for that person, plus requests
create or replace function public.unread_count(p_name text)
returns bigint
language sql stable security definer set search_path = public
as $$
  select
    (select count(*) from reminders r
     where p_name = any(r.recipients)
       and public.can_receive(p_name, r.sender, r.created_at)
       and not (r.todo_items is not null and r.checked_out)
       and not exists (select 1 from nudge_user_state s
                       where s.owner_name = p_name and s.reminder_id = r.id
                         and (s.checked_at is not null or s.archived_at is not null)))
    +
    (select count(distinct r.sender) from reminders r
     where p_name = any(r.recipients) and r.sender <> p_name
       and not public.can_receive(p_name, r.sender, r.created_at)
       and not exists (select 1 from connections c where c.owner_name = p_name and c.other_name = r.sender
                       and (c.status = 'blocked' or (c.declined_at is not null and r.created_at <= c.declined_at))))
$$;
revoke all on function public.unread_count(text) from public, anon, authenticated;
grant execute on function public.unread_count(text) to service_role;

-- ============================================================================
-- 6. Owner-only user list (for Insights). Refuses anyone who isn't the owner.
-- ============================================================================
create or replace function public.admin_users()
returns table (display_name text, email text, joined timestamptz, last_active timestamptz, sent bigint, received bigint)
language plpgsql stable security definer set search_path = public, auth
as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return query
  select p.display_name, u.email::text, u.created_at,
    (select max(t) from (
       select max(created_at) as t from reminders where sender = p.display_name
       union all select max(created_at) from messages where sender = p.display_name
       union all select max(updated_at) from device_tokens where owner_name = p.display_name
       union all select max(seen_at) from nudge_reads where owner_id = p.id
     ) a),
    (select count(*) from reminders where sender = p.display_name),
    (select count(*) from reminders where p.display_name = any(recipients) and sender <> p.display_name)
  from profiles p join auth.users u on u.id = p.id
  order by u.created_at desc;
end
$$;
revoke all on function public.admin_users() from public, anon;
grant execute on function public.admin_users() to authenticated;

-- ============================================================================
-- 7. Live updates for the new tables
-- ============================================================================
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'nudge_user_state') then
    alter publication supabase_realtime add table nudge_user_state;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'connections') then
    alter publication supabase_realtime add table connections;
  end if;
end
$$;

create index if not exists nudge_user_state_reminder on nudge_user_state (reminder_id);


-- ============================================================================
-- 8. Insights: count checks from the new personal state
-- ============================================================================
create or replace function public.admin_stats()
returns jsonb
language plpgsql stable security definer
set search_path = public, auth
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  with activity as (
    select sender as name, created_at as t from reminders
    union all select sender, created_at from messages
    union all select username, created_at from reminder_reactions
    union all select owner_name, updated_at from device_tokens
    union all select p.display_name, nr.seen_at from nudge_reads nr join profiles p on p.id = nr.owner_id
    union all select owner_name, coalesce(checked_at, popular_checked_at) from nudge_user_state
  ),
  days as (
    select generate_series(current_date - 29, current_date, interval '1 day')::date as d
  ),
  -- nudges sent to at least one other person ("Save to My Nudges"-only copies don't count)
  shared as (
    select * from reminders r
    where cardinality(array_remove(coalesce(r.recipients, array[r.recipient]), r.sender)) > 0
  )
  select jsonb_build_object(
    'generated_at', now(),
    'users', jsonb_build_object(
      'total', (select count(*) from profiles),
      'new_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
      'new_30d', (select count(*) from auth.users where created_at > now() - interval '30 days'),
      'active_1d', (select count(distinct name) from activity where t > now() - interval '1 day'),
      'active_7d', (select count(distinct name) from activity where t > now() - interval '7 days'),
      'active_30d', (select count(distinct name) from activity where t > now() - interval '30 days'),
      'with_notifications', (select count(distinct owner_name) from device_tokens),
      'ever_sent', (select count(distinct sender) from shared)
    ),
    'nudges', jsonb_build_object(
      'total', (select count(*) from reminders),
      'last_7d', (select count(*) from reminders where created_at > now() - interval '7 days'),
      'last_30d', (select count(*) from reminders where created_at > now() - interval '30 days'),
      'links', (select count(*) from reminders where url is not null and url not like '%/nudge-uploads/%'),
      'uploads', (select count(*) from reminders where url like '%/nudge-uploads/%' or jsonb_array_length(coalesce(attachments, '[]'::jsonb)) > 0),
      'todos', (select count(*) from reminders where todo_items is not null),
      'groups', (select count(*) from shared where cardinality(array_remove(recipients, sender)) > 1),
      'public', (select count(*) from reminders where is_public),
      'priority', (select count(*) from reminders where prioritized_at is not null),
      'by_type', (select coalesce(jsonb_object_agg(k, c), '{}'::jsonb)
                  from (select coalesce(type, 'none') as k, count(*) as c from reminders group by 1) x)
    ),
    'engagement', jsonb_build_object(
      'shared', (select count(*) from shared),
      -- checked = at least one recipient checked it (each person's check is their own now)
      'checked', (select count(*) from shared sh where sh.checked_out or exists (
        select 1 from nudge_user_state s where s.reminder_id = sh.id and s.checked_at is not null and s.owner_name <> sh.sender)),
      'median_minutes_to_check', (
        select round((percentile_cont(0.5) within group (order by m))::numeric, 1)
        from (
          select extract(epoch from (min(s.checked_at) - sh.created_at)) / 60 as m
          from shared sh join nudge_user_state s on s.reminder_id = sh.id
          where s.checked_at is not null and s.owner_name <> sh.sender and s.checked_at >= sh.created_at
          group by sh.id, sh.created_at
        ) first_checks),
      'messages_total', (select count(*) from messages),
      'messages_7d', (select count(*) from messages where created_at > now() - interval '7 days'),
      'reactions_total', (select count(*) from reminder_reactions),
      'likes_total', (select count(*) from reminder_votes),
      'favorites_total', (select count(*) from user_favorites)
    ),
    'daily', (
      select jsonb_agg(jsonb_build_object(
        'day', d,
        'nudges', (select count(*) from reminders where created_at::date = d),
        'messages', (select count(*) from messages where created_at::date = d),
        'active', (select count(distinct name) from activity where t::date = d),
        'signups', (select count(*) from auth.users where created_at::date = d)
      ) order by d)
      from days
    )
  ) into result;

  return result;
end
$$;

revoke all on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;

commit;

notify pgrst, 'reload schema';

-- Proof it worked: should show 8 rows
select 'table' as kind, to_regclass('public.connections')::text as name
union all select 'table', to_regclass('public.nudge_user_state')::text
union all select 'function', proname from pg_proc
  where proname in ('can_receive', 'my_nudge_requests', 'my_pending_recipients', 'todo_edit', 'push_allowed', 'admin_users');
