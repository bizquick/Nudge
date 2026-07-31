-- Run this once in your Supabase project's SQL Editor (Dashboard > SQL Editor > New query).
--
-- This project already ships with a Supabase project auto-provisioned by Figma Make
-- (see src/app/utils/supabase/info.tsx for the URL/key already wired into the app).
-- You can run this directly against that same project — no new project needed.
-- If that project is ever paused or you'd rather use your own, create a new Supabase
-- project, run this script there, and update projectId / publicAnonKey in info.tsx.

create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('link','music','video','text')),
  title text not null,
  content text not null,
  url text,
  sender text not null,
  recipient text not null,
  checked_out boolean not null default false,
  archived boolean not null default false,
  favorited boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists reminder_reactions (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references reminders(id) on delete cascade,
  emoji text not null,
  username text not null,
  created_at timestamptz not null default now(),
  unique (reminder_id, emoji, username)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references reminders(id) on delete cascade,
  sender text not null,
  text text not null,
  created_at timestamptz not null default now()
);

alter table reminders enable row level security;
alter table reminder_reactions enable row level security;
alter table messages enable row level security;

-- Open policies: anyone with the anon key can read and write, matching the
-- app's "no password, just type your name" design. Fine for a small trusted
-- group testing the app; not meant for a public audience.
create policy "anon full access reminders" on reminders
  for all using (true) with check (true);

create policy "anon full access reminder_reactions" on reminder_reactions
  for all using (true) with check (true);

create policy "anon full access messages" on messages
  for all using (true) with check (true);

-- Enable Realtime so reminders/reactions/messages update live across testers' devices
alter publication supabase_realtime add table reminders;
alter publication supabase_realtime add table reminder_reactions;
alter publication supabase_realtime add table messages;
