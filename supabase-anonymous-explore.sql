-- Addly: anonymous public posts, and BeagleExpress filling Explore.
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
--
-- Public nudges (Popular and Explore) show as "Anonymous" unless the person who posted
-- them turns on "Show my name on public posts" in the You tab. The name is hidden by
-- the server itself — it never reaches anyone else's phone — including on the replies
-- the poster writes under their own anonymous post. BeagleExpress (Addly's Explore
-- bot) always shows its name.

begin;

-- ── The setting, and names nobody can take ──────────────────────────────
alter table profiles add column if not exists show_name_publicly boolean not null default false;

create or replace function public.reserved_names()
returns trigger
language plpgsql
as $$
begin
  if lower(trim(NEW.display_name)) in ('anonymous', 'beagleexpress', 'beagle express')
     and (TG_OP = 'INSERT' or lower(OLD.display_name) is distinct from lower(NEW.display_name)) then
    raise exception 'That username is taken';
  end if;
  return NEW;
end
$$;
drop trigger if exists reserved_names on profiles;
create trigger reserved_names before insert or update of display_name on profiles
  for each row execute function public.reserved_names();

-- Does a public post show who wrote it?
create or replace function public.nudge_author_shown(p_sender text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_sender = 'BeagleExpress'
      or exists (select 1 from profiles where display_name = p_sender and show_name_publicly)
$$;

-- Can I see this nudge at all? (Public ones count, even anonymous ones.)
create or replace function public.can_see_nudge(p_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from reminders r
    where r.id = p_id
      and (r.is_public
           or r.sender = public.my_display_name()
           or (public.my_display_name() = any(r.recipients)
               and public.can_receive(public.my_display_name(), r.sender, r.created_at)))
  )
$$;
revoke all on function public.can_see_nudge(uuid) from public, anon;
grant execute on function public.can_see_nudge(uuid) to authenticated;

-- ── Nudges: strangers' anonymous posts only come through public_nudges() ──
drop policy if exists "see your own and public nudges" on reminders;
create policy "see your own and public nudges" on reminders
  for select to authenticated
  using (
    (is_public and public.nudge_author_shown(sender))
    or sender = (select public.my_display_name())
    or ((select public.my_display_name()) = any(recipients)
        and public.can_receive((select public.my_display_name()), sender, created_at))
  );

-- Popular and Explore: recent public posts (plus the all-time most liked), with the
-- poster's name swapped for "Anonymous" unless they've chosen to show it.
create or replace function public.public_nudges()
returns setof jsonb
language sql stable security definer set search_path = public
as $$
  with me as (select public.my_display_name() as name),
  ids as (
    (select r.id from reminders r, me
      where r.is_public and r.created_at > now() - interval '21 days'
        and r.sender <> me.name and not (me.name = any(r.recipients))
      order by r.created_at desc limit 600)
    union
    (select r.id from reminders r, me
      where r.is_public and r.sender <> me.name and not (me.name = any(r.recipients))
      order by (select count(*) from reminder_votes v where v.reminder_id = r.id) desc, r.created_at desc
      limit 100)
  ),
  pool as (select r.* from reminders r join ids on ids.id = r.id)
  select to_jsonb(p)
    || jsonb_build_object(
         'sender', shown.name,
         'recipient', shown.name,
         'recipients', jsonb_build_array(shown.name),
         'completed_by', '[]'::jsonb,
         'group_name', null,
         'group_renamed_by', null,
         'voters', coalesce((select jsonb_agg(v.voter_name) from reminder_votes v where v.reminder_id = p.id), '[]'::jsonb)
       )
  from pool p
  cross join lateral (select case when public.nudge_author_shown(p.sender) then p.sender else 'Anonymous' end as name) shown
$$;
revoke all on function public.public_nudges() from public, anon;
grant execute on function public.public_nudges() to authenticated;

-- ── Everything else attached to a nudge follows "can I see this nudge" ──
drop policy if exists "read messages on nudges you can see" on messages;
create policy "read messages on nudges you can see" on messages
  for select to authenticated
  using (public.can_see_nudge(reminder_id));

-- The poster's replies under their own anonymous post are saved as "Anonymous";
-- who really wrote them is kept in message_authors, which only they can read.
create table if not exists message_authors (
  message_id uuid primary key references messages(id) on delete cascade,
  real_sender text not null
);
alter table message_authors enable row level security;
drop policy if exists "see your own anonymous messages" on message_authors;
create policy "see your own anonymous messages" on message_authors
  for select to authenticated
  using (real_sender = public.my_display_name());

create or replace function public.anonymize_poster_reply()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if NEW.sender = public.my_display_name() and exists (
    select 1 from reminders r
    where r.id = NEW.reminder_id and r.is_public and r.sender = NEW.sender
      and not public.nudge_author_shown(r.sender)
  ) then
    NEW.sender := 'Anonymous';
  end if;
  return NEW;
end
$$;
drop trigger if exists anonymize_poster_reply on messages;
create trigger anonymize_poster_reply before insert on messages
  for each row execute function public.anonymize_poster_reply();

create or replace function public.remember_anonymous_author()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if NEW.sender = 'Anonymous' and public.my_display_name() is not null then
    insert into message_authors (message_id, real_sender) values (NEW.id, public.my_display_name())
    on conflict (message_id) do nothing;
  end if;
  return NEW;
end
$$;
drop trigger if exists remember_anonymous_author on messages;
create trigger remember_anonymous_author after insert on messages
  for each row execute function public.remember_anonymous_author();

drop policy if exists "send messages as yourself" on messages;
create policy "send messages as yourself" on messages
  for insert to authenticated
  with check (
    public.can_see_nudge(reminder_id)
    and (
      sender = public.my_display_name()
      -- your own reply on your own anonymous post (switched to "Anonymous" above)
      or (sender = 'Anonymous' and exists (
            select 1 from reminders r
            where r.id = reminder_id and r.is_public and r.sender = public.my_display_name()))
    )
  );

drop policy if exists "read reactions on nudges you can see" on reminder_reactions;
create policy "read reactions on nudges you can see" on reminder_reactions
  for select to authenticated
  using (public.can_see_nudge(reminder_id));
drop policy if exists "react to nudges you can see" on reminder_reactions;
create policy "react to nudges you can see" on reminder_reactions
  for insert to authenticated
  with check (username = public.my_display_name() and public.can_see_nudge(reminder_id));
drop policy if exists "remove your own nudge reaction" on reminder_reactions;
create policy "remove your own nudge reaction" on reminder_reactions
  for delete to authenticated
  using (username = public.my_display_name());

drop policy if exists "read votes on nudges you can see" on reminder_votes;
create policy "read votes on nudges you can see" on reminder_votes
  for select to authenticated
  using (public.can_see_nudge(reminder_id));
drop policy if exists "like nudges you can see" on reminder_votes;
create policy "like nudges you can see" on reminder_votes
  for insert to authenticated
  with check (voter_name = public.my_display_name() and public.can_see_nudge(reminder_id));
drop policy if exists "remove your own like" on reminder_votes;
create policy "remove your own like" on reminder_votes
  for delete to authenticated
  using (voter_name = public.my_display_name());

drop policy if exists "write own state" on nudge_user_state;
create policy "write own state" on nudge_user_state
  for insert to authenticated
  with check (owner_name = public.my_display_name() and public.can_see_nudge(reminder_id));

drop policy if exists "own favorites" on user_favorites;
create policy "own favorites" on user_favorites
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and public.can_see_nudge(reminder_id));

-- ── Reports about anonymous posts still reach the real author ───────────
create or replace function public.fill_report_target()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if NEW.kind = 'nudge' and NEW.target_id is not null then
    select sender into NEW.target_user from reminders where id::text = NEW.target_id;
  elsif NEW.kind = 'message' and NEW.target_id is not null and NEW.target_user = 'Anonymous' then
    select real_sender into NEW.target_user from message_authors where message_id::text = NEW.target_id;
  end if;
  NEW.target_user := coalesce(NEW.target_user, 'Unknown');
  return NEW;
end
$$;
drop trigger if exists fill_report_target on reports;
create trigger fill_report_target before insert on reports
  for each row execute function public.fill_report_target();

-- ── Deleting an account also removes its anonymous replies ──────────────
create or replace function public.delete_account_data(p_uid uuid)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare
  me text;
begin
  select display_name into me from profiles where id = p_uid;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  if me is not null then
    delete from reminders where sender = me;
    delete from messages where id in (select message_id from message_authors where real_sender = me);
    delete from messages where sender = me;
    delete from message_reactions where username = me;
    delete from reminder_reactions where username = me;
    delete from reminder_votes where voter_name = me;

    delete from reminders
      where me = any(recipients) and cardinality(array_remove(array_remove(recipients, me), sender)) = 0;
    update reminders
      set recipients = array_remove(recipients, me),
          recipient = case when recipient = me then (array_remove(recipients, me))[1] else recipient end,
          completed_by = array_remove(coalesce(completed_by, '{}'), me)
      where me = any(recipients);

    delete from connections where owner_name = me or other_name = me;
    delete from nudge_user_state where owner_name = me;
    delete from favorite_folder_items where owner_name = me;
    delete from favorite_folders where owner_name = me;
    delete from mutes where owner_name = me or target = me;
    delete from contact_prefs where owner_name = me or contact_name = me;
    delete from device_tokens where owner_name = me;
  end if;

  delete from chat_notes where owner_id = p_uid;
  delete from nudge_reads where owner_id = p_uid;
  delete from user_favorites where owner_id = p_uid;
  delete from share_keys where owner_id = p_uid;
  delete from app_admins where user_id = p_uid;

  delete from profiles where id = p_uid;
  delete from auth.users where id = p_uid;
end
$$;
revoke all on function public.delete_account_data(uuid) from public, anon, authenticated;

-- ── BeagleExpress housekeeping ──────────────────────────────────────────
-- Removes BeagleExpress posts older than 45 days that nobody liked, saved, checked,
-- or talked about. (Called by the beagle-express function; not from the app.)
create or replace function public.beagle_cleanup()
returns integer
language sql security definer set search_path = public
as $$
  with gone as (
    delete from reminders r
    where r.sender = 'BeagleExpress' and r.created_at < now() - interval '45 days'
      and not exists (select 1 from reminder_votes v where v.reminder_id = r.id)
      and not exists (select 1 from user_favorites f where f.reminder_id = r.id)
      and not exists (select 1 from messages m where m.reminder_id = r.id)
      and not exists (select 1 from nudge_user_state s where s.reminder_id = r.id and (s.archived_at is not null))
    returning 1
  )
  select count(*)::integer from gone
$$;
revoke all on function public.beagle_cleanup() from public, anon, authenticated;
grant execute on function public.beagle_cleanup() to service_role;

create index if not exists reminders_public_recent on reminders (created_at desc) where is_public;
create index if not exists reminders_sender_idx on reminders (sender);
create index if not exists votes_reminder_idx on reminder_votes (reminder_id);

commit;

notify pgrst, 'reload schema';

-- Proof it worked: should show 5 rows
select 'column' as kind, column_name as name from information_schema.columns
  where table_name = 'profiles' and column_name = 'show_name_publicly'
union all
select 'function', proname from pg_proc where proname in ('public_nudges', 'can_see_nudge', 'beagle_cleanup')
union all
select 'table', tablename from pg_tables where tablename = 'message_authors';
