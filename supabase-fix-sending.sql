-- Addly fix: sending nudges failed with "infinite recursion detected in policy for
-- relation reminders". An older rule on the nudges table (set up outside these files)
-- and the newer ones were checking each other in a loop.
-- This clears every rule on the nudges table and puts back exactly the three the app needs.
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.

begin;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'reminders' loop
    execute format('drop policy %I on public.reminders', p.policyname);
  end loop;
end $$;

alter table reminders enable row level security;

-- See: your own nudges, ones sent to you (from people you've accepted), and public
-- posts whose author shows their name (anonymous ones come through public_nudges())
create policy "see your own and public nudges" on reminders
  for select to authenticated
  using (
    (is_public and public.nudge_author_shown(sender))
    or sender = (select public.my_display_name())
    or ((select public.my_display_name()) = any(recipients)
        and public.can_receive((select public.my_display_name()), sender, created_at))
  );

-- Send: only as yourself
create policy "send nudges as yourself" on reminders
  for insert to authenticated
  with check (sender = (select public.my_display_name()));

-- Change: people in a nudge (what each person may change is checked by protect_nudge_edits)
create policy "people in a nudge can update it" on reminders
  for update to authenticated
  using (sender = (select public.my_display_name()) or (select public.my_display_name()) = any(recipients))
  with check (sender = (select public.my_display_name()) or (select public.my_display_name()) = any(recipients));

-- (Deleting goes through delete_my_nudge(), which checks it's yours.)

commit;

notify pgrst, 'reload schema';

-- Proof it worked: should show exactly 3 rows
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'reminders' order by cmd;
