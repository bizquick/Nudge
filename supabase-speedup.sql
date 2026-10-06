-- Speed-up: the privacy rules look up "who is asking" once per request instead of once
-- per nudge. Same rules, same results — just faster as the number of nudges grows.
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run.

begin;

drop policy if exists "see your own and public nudges" on reminders;
create policy "see your own and public nudges" on reminders
  for select to authenticated
  using (
    is_public
    or sender = (select public.my_display_name())
    or ((select public.my_display_name()) = any(recipients)
        and public.can_receive((select public.my_display_name()), sender, created_at))
  );

drop policy if exists "people in a nudge can update it" on reminders;
create policy "people in a nudge can update it" on reminders
  for update to authenticated
  using (sender = (select public.my_display_name()) or (select public.my_display_name()) = any(recipients))
  with check (sender = (select public.my_display_name()) or (select public.my_display_name()) = any(recipients));

drop policy if exists "read own and fellow participants' state" on nudge_user_state;
create policy "read own and fellow participants' state" on nudge_user_state
  for select to authenticated
  using (
    owner_name = (select public.my_display_name())
    or exists (
      select 1 from reminders r
      where r.id = nudge_user_state.reminder_id
        and (r.sender = (select public.my_display_name()) or (select public.my_display_name()) = any(r.recipients))
        and (nudge_user_state.owner_name = r.sender or nudge_user_state.owner_name = any(r.recipients))
    )
  );

create index if not exists messages_reminder_id on messages (reminder_id);
create index if not exists reactions_reminder_id on reminder_reactions (reminder_id);

commit;

-- Proof it worked: should show 3 rows
select policyname from pg_policies
where policyname in ('see your own and public nudges', 'people in a nudge can update it', 'read own and fellow participants'' state');
