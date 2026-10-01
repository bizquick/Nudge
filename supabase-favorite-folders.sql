-- Favorites folders — run this ONCE in Supabase:
--   Dashboard → your project → SQL Editor → New query → paste this whole file → Run.
-- Safe to run again: it skips anything that already exists.
--
-- Folders are personal: each person only ever sees and changes their own.
-- Ownership is matched by display name, the same way contact_prefs works.
-- Needs public.my_display_name(), created by supabase-privacy-fix.sql — run that first.

create table if not exists favorite_folders (
  id uuid primary key default gen_random_uuid(),
  owner_name text not null,
  name text not null,
  created_at timestamptz not null default now()
);

-- Which folder each favorited nudge is in (at most one folder per nudge, per person)
create table if not exists favorite_folder_items (
  owner_name text not null,
  reminder_id uuid not null references reminders(id) on delete cascade,
  folder_id uuid not null references favorite_folders(id) on delete cascade,
  primary key (owner_name, reminder_id)
);

alter table favorite_folders enable row level security;
alter table favorite_folder_items enable row level security;

-- Only the signed-in owner can read or write their folders
drop policy if exists "own folders" on favorite_folders;
create policy "own folders" on favorite_folders
  for all to authenticated
  using (owner_name = public.my_display_name())
  with check (owner_name = public.my_display_name());

drop policy if exists "own folder items" on favorite_folder_items;
create policy "own folder items" on favorite_folder_items
  for all to authenticated
  using (owner_name = public.my_display_name())
  with check (
    owner_name = public.my_display_name()
    and folder_id in (select id from favorite_folders where owner_name = public.my_display_name())
  );
