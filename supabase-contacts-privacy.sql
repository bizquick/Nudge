-- Nudge update: only show people you actually know.
-- Run ONCE in Supabase: SQL Editor → + New query → paste → click inside the box → Run. Safe to run again.
--
-- Before: any signed-in person could list every Nudge user's name.
-- After:  you can see your own profile, people you share a nudge with, and authors of
--         public nudges. To reach someone new you need their exact Nudge name.

begin;

drop policy if exists "profiles are readable by anyone signed in" on profiles;
drop policy if exists "see yourself and people you know" on profiles;
create policy "see yourself and people you know" on profiles
  for select to authenticated
  using (
    id = auth.uid()
    -- the reminders rules apply inside this check, so it only finds nudges you can see
    or exists (
      select 1 from reminders r
      where r.sender = profiles.display_name
         or r.recipients @> array[profiles.display_name]
    )
  );

-- Look someone up by their exact Nudge name (capital letters don't matter).
-- Returns their name only if it exists — there's no way to list or search everyone.
create or replace function public.find_profile(p_name text)
returns text
language sql stable security definer set search_path = public
as $$
  select display_name from profiles
  where lower(display_name) = lower(trim(p_name))
  limit 1
$$;

revoke all on function public.find_profile(text) from public, anon;
grant execute on function public.find_profile(text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- Proof it worked: should show 2 rows
select 'policy' as kind, policyname as name from pg_policies
  where tablename = 'profiles' and policyname = 'see yourself and people you know'
union all
select 'function', proname from pg_proc where proname = 'find_profile';
