-- Launch hardening: remove usernames, bound plan names.

-- Usernames are removed entirely: sign-in is email-only and the header derives
-- initials from the email. email_for_username let any anon caller map a
-- username to the account's email (enumeration oracle, flagged in 0004), and
-- with it gone the profiles table carried nothing else — plans reference
-- auth.users directly, so nothing depends on it.
drop function if exists public.email_for_username(text);
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop table if exists public.profiles;

-- Mirror MAX_PLAN_NAME_LEN (lib/plan/server/validate.ts). No length was enforced
-- before this, so refuse to silently truncate persisted plan names: fail loudly
-- if any row is over-length so it's resolved deliberately (rather than the ADD
-- below rejecting it with a cryptic constraint-violation error).
do $$
begin
  if exists (select 1 from public.plans where char_length(name) > 120) then
    raise exception 'plans.name over 120 chars — resolve manually before adding plans_name_len (refusing to truncate)';
  end if;
end $$;
alter table public.plans add constraint plans_name_len check (char_length(name) <= 120);
