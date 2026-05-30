-- Issue #73: allow signing in with a username instead of an email.
--
-- supabase.auth.signInWithPassword only accepts an email, so the login form
-- resolves a username to its email first. Anon callers can't read the profiles
-- table (owner-only RLS) or auth.users, so we expose a single-purpose
-- SECURITY DEFINER lookup — the same pattern get_shared_plan uses in 0001.
--
-- Tradeoff: this lets an anon caller turn a known username into the account's
-- email (an enumeration vector). Acceptable for this non-production dev project;
-- revisit before any real launch (e.g. rate-limit or drop username login).

create or replace function public.email_for_username(uname text)
returns text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select u.email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.username = uname
  limit 1;
$$;

revoke all on function public.email_for_username(text) from public;
grant execute on function public.email_for_username(text) to anon, authenticated;
