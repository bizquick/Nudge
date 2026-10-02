-- Push notifications setup — TEMPLATE (safe to keep in the repo).
-- Don't run this one: run supabase-push-setup.local.sql, which is the same thing
-- with your project's real values filled in (that file is kept out of GitHub).
--
-- What it does:
--   1. device_tokens: remembers each phone's notification address and whose phone it is.
--   2. register_device_token(): lets the app claim a phone for the signed-in person.
--   3. A trigger that tells the "push" Edge Function about every new nudge and chat message.

begin;

create extension if not exists pg_net;

create table if not exists device_tokens (
  token text primary key,
  owner_name text not null,
  platform text not null default 'ios',
  updated_at timestamptz not null default now()
);

alter table device_tokens enable row level security;

-- You can see and remove your own phone's token. Adding/moving one goes through the function below.
drop policy if exists "own device tokens" on device_tokens;
create policy "own device tokens" on device_tokens
  for all to authenticated
  using (owner_name = public.my_display_name())
  with check (owner_name = public.my_display_name());

-- If someone else signs in on the same phone, the phone's token moves to them.
create or replace function public.register_device_token(p_token text, p_platform text default 'ios')
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if public.my_display_name() is null then
    raise exception 'not signed in';
  end if;
  insert into device_tokens (token, owner_name, platform)
  values (p_token, public.my_display_name(), p_platform)
  on conflict (token) do update
    set owner_name = excluded.owner_name, platform = excluded.platform, updated_at = now();
end
$$;

revoke all on function public.register_device_token(text, text) from public, anon;
grant execute on function public.register_device_token(text, text) to authenticated;

-- Tell the Edge Function about new nudges and messages (it decides who to notify).
create or replace function public.notify_push()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://__PROJECT_REF__.supabase.co/functions/v1/smart-processor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer __ANON_KEY__',
      'x-nudge-secret', '__WEBHOOK_SECRET__'
    ),
    body := jsonb_build_object('table', TG_TABLE_NAME, 'id', NEW.id)
  );
  return NEW;
end
$$;

drop trigger if exists push_on_new_reminder on reminders;
create trigger push_on_new_reminder after insert on reminders
  for each row execute function public.notify_push();

drop trigger if exists push_on_new_message on messages;
create trigger push_on_new_message after insert on messages
  for each row execute function public.notify_push();

commit;

-- Proof it worked: should list device_tokens and both triggers
select 'table' as kind, to_regclass('public.device_tokens')::text as name
union all
select 'trigger', tgname from pg_trigger where tgname in ('push_on_new_reminder', 'push_on_new_message');
