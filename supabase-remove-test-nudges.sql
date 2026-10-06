-- Remove the "Addly Bot" test nudges (and everything attached to them).
-- Run in Supabase: SQL Editor -> New query -> paste -> Run.

begin;

delete from messages where reminder_id in (select id from reminders where sender = 'Addly Bot');
delete from reminder_reactions where reminder_id in (select id from reminders where sender = 'Addly Bot');
delete from reminder_votes where reminder_id in (select id from reminders where sender = 'Addly Bot');
delete from reminders where sender = 'Addly Bot';
delete from connections where owner_name = 'Addly Bot' or other_name = 'Addly Bot';

commit;

-- Proof it worked: should show 0
select count(*) as addly_bot_nudges_left from reminders where sender = 'Addly Bot';
