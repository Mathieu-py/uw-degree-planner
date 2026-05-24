-- RLS smoke test for the planner schema.
--
-- Designed to be run against a freshly-reset local Supabase database:
--   pnpm exec supabase db reset
--   psql "$DB_URL" -f supabase/test/rls.sql
--
-- The script seeds two users and one plan per user, then asserts:
--   1. User A's session cannot SELECT user B's plan rows.
--   2. plan_slots / plan_courses inherit the same isolation.
--   3. Anyone (anon or authenticated) can resolve a known share_token via
--      `get_shared_plan(token)` and get the full plan as JSON.
--
-- A clean run finishes with "RLS test passed". Any failure raises an
-- exception and aborts the transaction so the script exits non-zero.

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Seed: two auth users (bypassing GoTrue, since this is a SQL-level test)
-- ---------------------------------------------------------------------------

-- Two deterministic UUIDs so the test is repeatable.
do $$
declare
  user_a uuid := '11111111-1111-1111-1111-111111111111';
  user_b uuid := '22222222-2222-2222-2222-222222222222';
  plan_a uuid;
  plan_b uuid;
  slot_a uuid;
  shared_token text := 'share-token-a';
  shared_result jsonb;
  visible_count integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values
    (user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.local', '', now(), now(), now()),
    (user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.local', '', now(), now(), now())
  on conflict (id) do nothing;

  -- Seed one plan per user, with one slot + one course each.
  -- Inserts happen as superuser, so RLS is bypassed for setup.
  insert into public.plans (owner_id, name, system_of_study, share_token)
  values (user_a, 'A''s plan', 'regular', shared_token)
  returning id into plan_a;

  insert into public.plans (owner_id, name, system_of_study)
  values (user_b, 'B''s plan', 'stream8')
  returning id into plan_b;

  insert into public.plan_slots (plan_id, term_id, position, ordinal)
  values (plan_a, 1259, '1A', 0)
  returning id into slot_a;

  insert into public.plan_courses (slot_id, course_code, ordinal)
  values (slot_a, 'cs246', 0);

  -- -------------------------------------------------------------------------
  -- Assert 1: as user A, only A's plan is visible.
  -- -------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into visible_count from public.plans;
  if visible_count <> 1 then
    raise exception 'RLS fail: user A sees % plan rows, expected 1', visible_count;
  end if;

  select count(*) into visible_count from public.plans where id = plan_b;
  if visible_count <> 0 then
    raise exception 'RLS fail: user A can see user B''s plan by id';
  end if;

  -- -------------------------------------------------------------------------
  -- Assert 2: plan_slots / plan_courses inherit isolation.
  -- -------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);

  select count(*) into visible_count from public.plan_slots where plan_id = plan_a;
  if visible_count <> 0 then
    raise exception 'RLS fail: user B can see user A''s slots';
  end if;

  select count(*) into visible_count from public.plan_courses;
  if visible_count <> 0 then
    raise exception 'RLS fail: user B can see user A''s courses (count=%)', visible_count;
  end if;

  -- -------------------------------------------------------------------------
  -- Assert 3: get_shared_plan resolves a known token regardless of caller.
  -- Test from the anon role to prove the SECURITY DEFINER path works.
  -- -------------------------------------------------------------------------
  perform set_config('request.jwt.claims', null, true);
  perform set_config('role', 'anon', true);

  select public.get_shared_plan(shared_token) into shared_result;
  if shared_result is null then
    raise exception 'RPC fail: get_shared_plan returned NULL for known token';
  end if;
  if (shared_result->>'name') <> 'A''s plan' then
    raise exception 'RPC fail: get_shared_plan returned wrong plan: %', shared_result;
  end if;
  if jsonb_array_length(shared_result->'slots') <> 1 then
    raise exception 'RPC fail: shared plan should have 1 slot, got %', shared_result->'slots';
  end if;

  select public.get_shared_plan('not-a-real-token') into shared_result;
  if shared_result is not null then
    raise exception 'RPC fail: get_shared_plan returned non-null for unknown token';
  end if;

  raise notice 'RLS test passed';
end $$;

rollback;
