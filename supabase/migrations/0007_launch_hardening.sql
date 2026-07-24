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

-- Mirror MAX_PLAN_NAME_LEN (lib/plan/server/validate.ts); clamp any oversized
-- rows first so the constraint validates.
update public.plans set name = left(name, 120) where char_length(name) > 120;
alter table public.plans add constraint plans_name_len check (char_length(name) <= 120);
