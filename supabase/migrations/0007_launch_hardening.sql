-- Launch hardening: remove usernames, bound plan names.

-- Irreversible (no down migration): restoring these means a backup restore.
-- email_for_username let any anon caller map a username to an account email
-- (enumeration oracle, flagged in 0004); with it gone profiles carried nothing
-- else, since plans reference auth.users directly.
drop function if exists public.email_for_username(text);
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop table if exists public.profiles;

-- Mirror MAX_PLAN_NAME_LEN (lib/plan/server/validate.ts). Refuse to silently
-- truncate: fail loudly if any row is over-length so it's resolved deliberately.
-- Preflight to find them: select id from public.plans where char_length(name) > 120;
do $$
begin
  if exists (select 1 from public.plans where char_length(name) > 120) then
    raise exception 'plans.name over 120 chars — resolve manually before adding plans_name_len (refusing to truncate)';
  end if;
end $$;

-- NOT VALID + VALIDATE avoids scanning under an ACCESS EXCLUSIVE lock; the
-- preflight guarantees VALIDATE passes.
alter table public.plans
  add constraint plans_name_len check (char_length(name) <= 120) not valid;
alter table public.plans validate constraint plans_name_len;
