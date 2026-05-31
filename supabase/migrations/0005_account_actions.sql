-- Milestone 4: account management from the Settings page.
--
-- `delete_own_account` lets a signed-in user delete their own account. The
-- authenticated/anon roles can't touch auth.users directly, so we expose a
-- SECURITY DEFINER RPC scoped to auth.uid() — the same pattern get_shared_plan
-- (0001) and email_for_username (0004) use. Deleting the auth.users row cascades
-- to public.profiles and public.plans (both reference auth.users / profiles with
-- on delete cascade), so this single call wipes the user's data too.
--
-- Username changes go through the normal owner-update RLS policy on profiles
-- (0003), so no extra grant is needed there.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- auth.uid() is null for anon callers, so this is a no-op for them and only
  -- ever removes the caller's own row. The cascade handles profiles + plans.
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
