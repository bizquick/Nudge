-- Addly: run BeagleExpress (the "clever-processor" function) once a day.
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
--
-- Turns on Supabase's scheduler (pg_cron) and its web-request helper (pg_net), then
-- schedules a daily call at 14:00 UTC (10 AM Eastern / 7 AM Pacific). The key below is
-- the app's public key (the same one inside the app), not a secret.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Replace any earlier BeagleExpress job, then schedule it
select cron.unschedule(jobid) from cron.job where jobname = 'BeagleExpress';

select cron.schedule(
  'BeagleExpress',
  '0 14 * * *',
  $$
  select net.http_post(
    url := 'https://eygojfpgisswyndusron.supabase.co/functions/v1/clever-processor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5Z29qZnBnaXNzd3luZHVzcm9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxOTM4MTcsImV4cCI6MjA4MDc2OTgxN30.T8igSK1q6rFbSeOnyLvGEcimBwGg6A5bBAXiji3x_Tc',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5Z29qZnBnaXNzd3luZHVzcm9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxOTM4MTcsImV4cCI6MjA4MDc2OTgxN30.T8igSK1q6rFbSeOnyLvGEcimBwGg6A5bBAXiji3x_Tc'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);

-- Proof it worked: should show 1 row (BeagleExpress, 0 14 * * *)
select jobname, schedule, active from cron.job where jobname = 'BeagleExpress';
