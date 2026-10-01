-- Nudge privacy fix — run ONCE in Supabase:
--   Dashboard → your project → SQL Editor → New query → paste this whole file → Run.
-- Everything runs as one unit: if any line fails, nothing changes.
--
-- After this:
--   • You only see nudges you sent, received, or that are marked Public (Popular tab).
--   • Only people in a nudge can change it (mark read, archive, rename a group, etc.).
--   • Chat messages are only visible to people who can see that nudge — and
--     sending messages works (before, there was no rule allowing it at all).
--   • Reactions and votes follow the same visibility as their nudge.

begin;

-- Your display name, looked up from your login. "security definer" lets the
-- rules below use it without tripping over the profiles table's own rules.
create or replace function public.my_display_name()
returns text
language sql stable security definer set search_path = public
as $$
  select display_name from profiles where id = auth.uid()
$$;

-- ── Nudges ──────────────────────────────────────────────────────────────
drop policy if exists "signed in users can read reminders" on reminders;
drop policy if exists "signed in users can update reminders" on reminders;
drop policy if exists "see your own and public nudges" on reminders;
drop policy if exists "people in a nudge can update it" on reminders;

create policy "see your own and public nudges" on reminders
  for select to authenticated
  using (
    is_public
    or sender = public.my_display_name()
    or public.my_display_name() = any(recipients)
  );

create policy "people in a nudge can update it" on reminders
  for update to authenticated
  using (sender = public.my_display_name() or public.my_display_name() = any(recipients))
  with check (sender = public.my_display_name() or public.my_display_name() = any(recipients));

-- (Sending nudges as yourself is already protected — that rule stays as is.)

-- ── Chat messages ───────────────────────────────────────────────────────
-- "exists (select … from reminders …)" only finds nudges you're allowed to see,
-- because the nudge rules above apply inside it too.
drop policy if exists "signed in users can read messages" on messages;
drop policy if exists "read messages on nudges you can see" on messages;
drop policy if exists "send messages as yourself" on messages;

create policy "read messages on nudges you can see" on messages
  for select to authenticated
  using (exists (select 1 from reminders r where r.id = messages.reminder_id));

create policy "send messages as yourself" on messages
  for insert to authenticated
  with check (
    sender = public.my_display_name()
    and exists (select 1 from reminders r where r.id = messages.reminder_id)
  );

-- ── Reactions and votes: visible only on nudges you can see ────────────
drop policy if exists "signed in users can read reactions" on reminder_reactions;
drop policy if exists "read reactions on nudges you can see" on reminder_reactions;
create policy "read reactions on nudges you can see" on reminder_reactions
  for select to authenticated
  using (exists (select 1 from reminders r where r.id = reminder_reactions.reminder_id));

drop policy if exists "signed in users can read votes" on reminder_votes;
drop policy if exists "read votes on nudges you can see" on reminder_votes;
create policy "read votes on nudges you can see" on reminder_votes
  for select to authenticated
  using (exists (select 1 from reminders r where r.id = reminder_votes.reminder_id));

commit;
