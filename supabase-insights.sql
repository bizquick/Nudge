-- Owner-only Insights: app-wide numbers (totals and trends, never anyone's content).
-- TEMPLATE (safe to keep in the repo). Don't run this one: run supabase-insights.local.sql,
-- which is the same thing with the owner's email filled in (that file is kept out of GitHub).
--
-- What it does:
--   1. app_admins: the list of accounts allowed to see Insights. Nobody can read or
--      change it from the app (no access rules = no access); only this SQL Editor can.
--   2. is_admin(): lets the app ask "am I the owner?" so it knows whether to show Insights.
--   3. admin_stats(): adds up the numbers. It refuses to run for anyone not in app_admins,
--      so even someone poking at the app's code can't get them.
--
-- "Active" means the person did something that day: sent a nudge, wrote a message,
-- reacted, opened a nudge, or opened the app with notifications on. Nothing new is
-- collected for this; it's counted from what's already stored.

begin;

create table if not exists app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table app_admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from app_admins where user_id = auth.uid())
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

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

-- The owner's account
insert into app_admins (user_id)
select id from auth.users where lower(email) = lower('__OWNER_EMAIL__')
on conflict do nothing;

commit;

notify pgrst, 'reload schema';

-- Proof it worked. "owner accounts" should be 1. (The rows after it list the
-- database's access rules on the main tables, for a privacy check-up.)
select 'owner accounts' as what, count(*)::text as detail from app_admins
union all
select 'rule on ' || tablename, policyname || ' (' || cmd || ')'
from pg_policies
where schemaname = 'public' and tablename in ('reminders', 'messages', 'reminder_reactions', 'reminder_votes', 'profiles');
