-- Issue #73: accounts get a username.
-- A `profiles` row per auth user, owner-only RLS (mirrors the plans tables in
-- 0001_initial.sql), plus a trigger that creates the row at sign-up from the
-- `username` passed in the signUp metadata. Because the trigger runs inside the
-- same transaction as the auth.users insert, a unique-username collision rolls
-- the whole sign-up back — signUp returns an error we surface inline. OAuth
-- users arrive with no `username` key, so their profile starts with a null
-- username (multiple nulls are allowed under a unique index) and the header
-- falls back to their email.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row-level security: a user can only read / update their own row.
-- No insert policy: rows are created by handle_new_user (security definer).
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

create policy profiles_owner_select on public.profiles
  for select using (auth.uid() = id);

create policy profiles_owner_update on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- Auto-create a profile when an auth user is created.
--
-- security definer so the insert bypasses RLS (the new user isn't the current
-- role at this point). search_path pinned to public,pg_temp to defeat
-- search-path hijacking, matching the get_shared_plan convention in 0001.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data->>'username');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
