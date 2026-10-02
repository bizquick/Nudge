-- Database indexes — run ONCE in Supabase: SQL Editor → + New query → paste → Run.
-- Safe to run again. Changes no data; it only makes the common lookups fast as
-- the tables grow (an index lets the database jump straight to matching rows
-- instead of reading every row).

-- "Nudges sent to me" / "nudges I sent" / the Popular tab / newest-first loading
create index if not exists reminders_recipients_idx on reminders using gin (recipients);
create index if not exists reminders_sender_idx on reminders (sender);
create index if not exists reminders_public_idx on reminders (created_at desc) where is_public;
create index if not exists reminders_created_at_idx on reminders (created_at desc);

-- Everything attached to a nudge: chat messages, reactions, likes
create index if not exists messages_reminder_idx on messages (reminder_id, created_at);
create index if not exists reminder_reactions_reminder_idx on reminder_reactions (reminder_id);
create index if not exists reminder_votes_reminder_idx on reminder_votes (reminder_id);

-- Per-person lookups: whose phone to notify, whose folders, who is who
create index if not exists device_tokens_owner_idx on device_tokens (owner_name);
create index if not exists favorite_folders_owner_idx on favorite_folders (owner_name);
create index if not exists favorite_folder_items_folder_idx on favorite_folder_items (folder_id);
create index if not exists profiles_display_name_idx on profiles (display_name);

-- Proof it worked: should list the 11 indexes above
select tablename, indexname
from pg_indexes
where schemaname = 'public' and indexname like '%\_idx'
order by tablename, indexname;
