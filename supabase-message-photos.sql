-- Photos in a nudge's conversation. Run ONCE in Supabase:
--   Dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
-- Adds an "attachments" list to chat messages (the same format nudges use for photos).
-- Who can read and send messages doesn't change.

alter table messages add column if not exists attachments jsonb;

notify pgrst, 'reload schema';

-- Proof it worked: should show 1 row
select column_name as added from information_schema.columns
where table_schema = 'public' and table_name = 'messages' and column_name = 'attachments';
