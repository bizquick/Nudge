-- Signing out on one device only cancels THAT device's send-key (the iPhone Share
-- menu and the Chrome add-on each have their own). Run ONCE in Supabase SQL Editor.

create or replace function public.revoke_share_key(p_key text)
returns void
language sql volatile security definer
set search_path = public
as $$
  -- Having the key is what proves it's yours, so whoever holds it can cancel it
  delete from share_keys where key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex');
$$;
revoke all on function public.revoke_share_key(text) from public;
grant execute on function public.revoke_share_key(text) to anon, authenticated;

notify pgrst, 'reload schema';

-- Proof it worked: should show 1 row
select proname from pg_proc where proname = 'revoke_share_key';
