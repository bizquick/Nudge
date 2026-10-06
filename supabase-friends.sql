-- Friends list: add and remove friends (blocking already exists).
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
--
-- "Remove" keeps everything you already have from that person, but anything new
-- they send becomes a nudge request again (like someone you've never met).

begin;

alter table connections drop constraint if exists connections_status_check;
alter table connections add constraint connections_status_check
  check (status in ('accepted', 'declined', 'blocked', 'removed'));
alter table connections add column if not exists removed_at timestamptz;

create or replace function public.can_receive(p_receiver text, p_sender text, p_created timestamptz)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_receiver = p_sender or exists (
    select 1 from connections c
    where c.owner_name = p_receiver and c.other_name = p_sender
      and (c.declined_at is null or p_created > c.declined_at)
      and (
        c.status = 'accepted'
        -- removed friends: what they sent before you removed them stays visible
        or (c.status = 'removed' and c.removed_at is not null and p_created <= c.removed_at)
      )
  )
$$;

-- Sending someone a nudge (again) makes them a friend again
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
    where connections.status in ('declined', 'removed');
  return NEW;
end
$$;

commit;

notify pgrst, 'reload schema';

-- Proof it worked: should show 1 row
select column_name as added from information_schema.columns
where table_schema = 'public' and table_name = 'connections' and column_name = 'removed_at';
