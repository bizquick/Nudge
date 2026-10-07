-- Addly: find people by username or email, and react to messages with emojis.
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.

begin;

-- ── Find people ─────────────────────────────────────────────────────────
-- Username: any part of it (at least 2 letters), best matches first, up to 10.
-- Email: must match exactly, so nobody can fish for addresses. Only the username
-- ever comes back, never the email. People who've blocked you don't show up.
create or replace function public.search_people(p_query text)
returns table (display_name text)
language plpgsql stable security definer set search_path = public, auth
as $$
declare
  q text := lower(trim(coalesce(p_query, '')));
  me text := public.my_display_name();
begin
  if length(q) < 2 or me is null then
    return;
  end if;

  if position('@' in q) > 0 then
    return query
      select p.display_name from profiles p join auth.users u on u.id = p.id
      where lower(u.email) = q
        and p.display_name <> me
        and not exists (select 1 from connections c
                        where c.owner_name = p.display_name and c.other_name = me and c.status = 'blocked')
      limit 1;
  else
    return query
      select p.display_name from profiles p
      where position(q in lower(p.display_name)) > 0
        and p.display_name <> me
        and not exists (select 1 from connections c
                        where c.owner_name = p.display_name and c.other_name = me and c.status = 'blocked')
      order by (lower(p.display_name) = q) desc,
               starts_with(lower(p.display_name), q) desc,
               length(p.display_name),
               p.display_name
      limit 10;
  end if;
end
$$;

revoke all on function public.search_people(text) from public, anon;
grant execute on function public.search_people(text) to authenticated;

-- ── Reactions on messages ───────────────────────────────────────────────
-- One reaction per person per message (pick another to change it, tap it again to remove).
create table if not exists message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  username text not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, username)
);
create index if not exists message_reactions_message_idx on message_reactions (message_id);

alter table message_reactions enable row level security;

-- "exists (select … from messages …)" only finds messages you're allowed to see,
-- because the message rules apply inside it too.
drop policy if exists "read reactions on messages you can see" on message_reactions;
create policy "read reactions on messages you can see" on message_reactions
  for select to authenticated
  using (exists (select 1 from messages m where m.id = message_reactions.message_id));

drop policy if exists "react as yourself" on message_reactions;
create policy "react as yourself" on message_reactions
  for insert to authenticated
  with check (
    username = public.my_display_name()
    and exists (select 1 from messages m where m.id = message_reactions.message_id)
  );

drop policy if exists "change your own reaction" on message_reactions;
create policy "change your own reaction" on message_reactions
  for update to authenticated
  using (username = public.my_display_name())
  with check (username = public.my_display_name());

drop policy if exists "remove your own reaction" on message_reactions;
create policy "remove your own reaction" on message_reactions
  for delete to authenticated
  using (username = public.my_display_name());

-- Reactions show up live on everyone's phones
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'message_reactions') then
    alter publication supabase_realtime add table message_reactions;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- Proof it worked: should show 2 rows
select 'function' as kind, proname as name from pg_proc where proname = 'search_people'
union all
select 'table', tablename from pg_tables where tablename = 'message_reactions';
