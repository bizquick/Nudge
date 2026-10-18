-- Addly: what the App Store requires — deleting your account, and reporting content.
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.

begin;

-- ── Reports ─────────────────────────────────────────────────────────────
-- Anyone can report a nudge, a message, or a person. Only you (the app's admin,
-- see app_admins) can read them, in Insights. The reporter can see their own
-- reports, so the app can hide what they reported from them right away.
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid default auth.uid() references auth.users(id) on delete set null,
  reporter_name text default public.my_display_name(),
  kind text not null check (kind in ('nudge', 'message', 'user')),
  target_id text,            -- the nudge or message id (empty for a person)
  target_user text,          -- who posted it / who's being reported
  reason text not null,
  details text,
  snapshot text,             -- a copy of what was reported, kept even if it's deleted later
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now()
);
create index if not exists reports_status_idx on reports (status, created_at desc);

alter table reports enable row level security;

drop policy if exists "report as yourself" on reports;
create policy "report as yourself" on reports
  for insert to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists "see your own reports, admins see all" on reports;
create policy "see your own reports, admins see all" on reports
  for select to authenticated
  using (reporter_id = auth.uid() or public.is_admin());

drop policy if exists "admins resolve reports" on reports;
create policy "admins resolve reports" on reports
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Admin: resolve a report, optionally removing the nudge or message it's about
create or replace function public.admin_resolve_report(p_report uuid, p_remove boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r reports%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Only the app admin can do that';
  end if;
  select * into r from reports where id = p_report;
  if not found then return; end if;
  if p_remove and r.target_id is not null then
    if r.kind = 'nudge' then
      delete from reminders where id::text = r.target_id;
    elsif r.kind = 'message' then
      delete from messages where id::text = r.target_id;
    end if;
  end if;
  update reports set status = 'resolved' where id = p_report;
end
$$;
revoke all on function public.admin_resolve_report(uuid, boolean) from public, anon;
grant execute on function public.admin_resolve_report(uuid, boolean) to authenticated;

-- ── Deleting an account ─────────────────────────────────────────────────
-- Removes everything that's theirs: nudges they sent (and their messages), their
-- messages and reactions everywhere, their settings and lists, their name from
-- nudges others sent them, their profile, and their sign-in. It can't be undone.
-- Used by "Delete account" in the app, and by the admin to remove an abusive user.
create or replace function public.delete_account_data(p_uid uuid)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare
  me text;
begin
  select display_name into me from profiles where id = p_uid;

  -- From here on this runs as a server job, so the "only the sender can change a
  -- nudge" rule doesn't stop us taking the name off nudges others sent them
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  if me is not null then
    -- Nudges they sent (their messages, reactions, checks… go with them)
    delete from reminders where sender = me;

    -- Their messages and reactions on everyone else's nudges
    delete from messages where sender = me;
    delete from message_reactions where username = me;
    delete from reminder_reactions where username = me;
    delete from reminder_votes where voter_name = me;

    -- Take the name off nudges others sent them; ones sent only to them are deleted
    delete from reminders
      where me = any(recipients) and cardinality(array_remove(array_remove(recipients, me), sender)) = 0;
    update reminders
      set recipients = array_remove(recipients, me),
          recipient = case when recipient = me then (array_remove(recipients, me))[1] else recipient end,
          completed_by = array_remove(coalesce(completed_by, '{}'), me)
      where me = any(recipients);

    -- Settings, lists, and connections (both directions)
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

  -- The profile, then the sign-in itself
  delete from profiles where id = p_uid;
  delete from auth.users where id = p_uid;
end
$$;
-- Not callable from the app directly — only through the two functions below
revoke all on function public.delete_account_data(uuid) from public, anon, authenticated;

-- "Delete account" in the app
create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  perform public.delete_account_data(auth.uid());
end
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Admin: remove an abusive user (everything of theirs, like Delete account)
create or replace function public.admin_remove_user(p_name text)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare
  target uuid;
begin
  if not public.is_admin() then
    raise exception 'Only the app admin can do that';
  end if;
  select id into target from profiles where display_name = p_name;
  if target is null then return; end if;
  if target = auth.uid() then
    raise exception 'That''s you — use Delete account instead';
  end if;
  update reports set status = 'resolved' where target_user = p_name and status = 'open';
  perform public.delete_account_data(target);
end
$$;
revoke all on function public.admin_remove_user(text) from public, anon;
grant execute on function public.admin_remove_user(text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- Proof it worked: should show 5 rows
select 'table' as kind, tablename as name from pg_tables where tablename = 'reports'
union all
select 'function', proname from pg_proc
  where proname in ('delete_account_data', 'delete_my_account', 'admin_remove_user', 'admin_resolve_report');
