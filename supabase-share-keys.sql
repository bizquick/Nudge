-- Share menu: private send-keys for the "Addly" option in the iPhone Share menu.
-- Run ONCE in Supabase: Dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
--
-- The Share menu runs outside the app, where it can't use your Addly login. So the app
-- makes it a private send-key: a long random code that only lets it send nudges as you.
-- Only a scrambled fingerprint of the key is stored here, never the key itself, and
-- signing out of the app cancels it. Nobody can read this table from the app.

begin;

create table if not exists share_keys (
  key_hash text primary key,            -- sha256 fingerprint of the key
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table share_keys enable row level security;  -- no rules = no access from the app

-- The app asks for a new key (shown to it once, then only the fingerprint is kept)
create or replace function public.create_share_key()
returns text
language plpgsql volatile security definer
set search_path = public
as $$
declare
  raw text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into share_keys (key_hash, owner_id)
  values (encode(sha256(convert_to(raw, 'UTF8')), 'hex'), auth.uid());
  return raw;
end
$$;
revoke all on function public.create_share_key() from public, anon;
grant execute on function public.create_share_key() to authenticated;

-- Signing out cancels your keys
create or replace function public.revoke_share_keys()
returns void
language sql volatile security definer
set search_path = public
as $$
  delete from share_keys where owner_id = auth.uid();
$$;
revoke all on function public.revoke_share_keys() from public, anon;
grant execute on function public.revoke_share_keys() to authenticated;

-- Used only by the server function that sends from the Share menu: whose key is this?
create or replace function public.share_key_owner(p_key text)
returns text
language plpgsql volatile security definer
set search_path = public
as $$
declare
  who text;
begin
  update share_keys set last_used_at = now()
  where key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex')
  returning (select display_name from profiles where id = share_keys.owner_id) into who;
  return who;
end
$$;
revoke all on function public.share_key_owner(text) from public, anon, authenticated;
grant execute on function public.share_key_owner(text) to service_role;

commit;

notify pgrst, 'reload schema';

-- Proof it worked: should show 4 rows
select 'table' as kind, to_regclass('public.share_keys')::text as name
union all
select 'function', proname from pg_proc where proname in ('create_share_key', 'revoke_share_keys', 'share_key_owner');
