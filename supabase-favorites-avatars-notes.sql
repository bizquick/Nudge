-- Nudge update: personal favorites, profile pictures, chat descriptions.
-- Run ONCE in Supabase: SQL Editor → + New query → paste this whole file → click inside the box → Run.
-- Safe to run again.
--
-- New tables are keyed by each person's permanent login id (auth.uid()) rather than
-- their display name — the direction the app needs to go to scale.

begin;

-- 1. Personal favorites. Before: one shared "favorited" switch on the nudge, so a
--    favorite by anyone showed up for everyone. Now each person has their own list,
--    independent of archiving or anything else that happens in the chat.
create table if not exists user_favorites (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reminder_id uuid not null references reminders(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, reminder_id)
);
alter table user_favorites enable row level security;
drop policy if exists "own favorites" on user_favorites;
create policy "own favorites" on user_favorites
  for all to authenticated
  using (owner_id = auth.uid())
  -- you can only favorite a nudge you're allowed to see
  with check (owner_id = auth.uid() and exists (select 1 from reminders r where r.id = reminder_id));

-- Carry over existing favorites: since the old switch was shared, give each
-- favorited nudge to everyone who was in it (they can unfavorite their copy).
insert into user_favorites (owner_id, reminder_id)
select p.id, r.id
from reminders r
join profiles p on p.display_name = any(array_append(r.recipients, r.sender))
where r.favorited
on conflict do nothing;

-- 2. Profile pictures: a photo address, or a premade emoji choice like "emoji:🐸"
alter table profiles add column if not exists avatar text;

-- 3. Chat descriptions: your own short note on a chat (only you see it).
--    chat_key is 'contact:<name>' or 'group:<key>'.
create table if not exists chat_notes (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  chat_key text not null,
  note text not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, chat_key)
);
alter table chat_notes enable row level security;
drop policy if exists "own chat notes" on chat_notes;
create policy "own chat notes" on chat_notes
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create index if not exists user_favorites_reminder_idx on user_favorites (reminder_id);

commit;

notify pgrst, 'reload schema';

-- Proof it worked: should show 3 rows
select 'table' as kind, to_regclass('public.user_favorites')::text as name
union all select 'table', to_regclass('public.chat_notes')::text
union all select 'column', column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles' and column_name = 'avatar';
