-- Several photos and files per nudge, alongside a link. Run ONCE in Supabase:
--   Dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
--
-- Adds an "attachments" list to each nudge (photos/files, each with its address,
-- name, and kind). The link stays in its own field, so a nudge can have both.
-- Only the sender can change a nudge's attachments (the protection rule from
-- before already covers any new field like this one).
-- Also updates Insights so "Photos & files" counts nudges with attachments.

begin;

alter table reminders add column if not exists attachments jsonb;

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
      'checked', (select count(*) from shared where checked_out),
      'median_minutes_to_check', (
        select round((percentile_cont(0.5) within group (
          order by extract(epoch from (checked_at - created_at)) / 60))::numeric, 1)
        from shared where checked_at is not null and checked_at >= created_at),
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

-- Proof it worked: should show 1 row
select column_name as added from information_schema.columns
where table_schema = 'public' and table_name = 'reminders' and column_name = 'attachments';
