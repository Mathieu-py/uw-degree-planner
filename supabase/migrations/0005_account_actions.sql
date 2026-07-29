-- Milestone 4: account management from the Settings page.
--
-- `delete_own_account` lets a signed-in user delete their own account. The
-- authenticated/anon roles can't touch auth.users directly, so we expose a
-- SECURITY DEFINER RPC scoped to auth.uid() — the same pattern get_shared_plan
-- (0001) uses. Deleting the auth.users row cascades to the user's plans
-- (plans.owner_id → auth.users on delete cascade), wiping their data too.
-- (0003's profiles table also cascaded here until 0007 dropped it.)

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- auth.uid() is null for anon callers, so this is a no-op for them and only
  -- ever removes the caller's own row. The cascade handles the user's plans.
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
