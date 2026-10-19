-- Addly: clear out BeagleExpress's posts so it can refill Explore with the stricter filter.
-- Only removes BeagleExpress posts that nobody has liked, saved, or talked about yet.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run.
delete from reminders r
where r.sender = 'BeagleExpress'
  and not exists (select 1 from reminder_votes v where v.reminder_id = r.id)
  and not exists (select 1 from user_favorites f where f.reminder_id = r.id)
  and not exists (select 1 from messages m where m.reminder_id = r.id);

-- How many BeagleExpress posts are left (should be 0, or only ones people interacted with)
select count(*) as beagle_posts_left from reminders where sender = 'BeagleExpress';
