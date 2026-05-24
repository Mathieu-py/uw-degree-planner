-- Phase 2: backend + accounts (issue #58)
-- Three tables (plans / plan_slots / plan_courses), owner-only RLS, plus a
-- SECURITY DEFINER RPC `get_shared_plan(token)` for public read of plans that
-- have a share_token. Reading shared plans through an RPC keeps the RLS story
-- simple: no policy ever lets an anon user read the plans table directly.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  program_id text,
  specialization_id text,
  system_of_study text check (system_of_study in ('regular', 'stream4', 'stream8')),
  start_term_id integer,
  program_scrape_version text,
  share_token text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index plans_owner_id_idx on public.plans (owner_id);

create table public.plan_slots (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  term_id integer,
  position text not null,
  is_coop boolean not null default false,
  ordinal smallint not null,
  unique (plan_id, position)
);

create index plan_slots_plan_id_idx on public.plan_slots (plan_id);

create table public.plan_courses (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.plan_slots(id) on delete cascade,
  course_code text not null,
  grade text,
  ordinal smallint not null default 0,
  unique (slot_id, course_code)
);

create index plan_courses_slot_id_idx on public.plan_courses (slot_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger on plans
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security: owner-only CRUD on all three tables
-- ---------------------------------------------------------------------------

alter table public.plans enable row level security;
alter table public.plan_slots enable row level security;
alter table public.plan_courses enable row level security;

create policy plans_owner_select on public.plans
  for select using (auth.uid() = owner_id);

create policy plans_owner_insert on public.plans
  for insert with check (auth.uid() = owner_id);

create policy plans_owner_update on public.plans
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy plans_owner_delete on public.plans
  for delete using (auth.uid() = owner_id);

-- plan_slots / plan_courses inherit access through the parent plan's owner.
create policy plan_slots_owner_all on public.plan_slots
  for all
  using (
    exists (
      select 1 from public.plans p
      where p.id = plan_slots.plan_id and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.plans p
      where p.id = plan_slots.plan_id and p.owner_id = auth.uid()
    )
  );

create policy plan_courses_owner_all on public.plan_courses
  for all
  using (
    exists (
      select 1 from public.plan_slots s
      join public.plans p on p.id = s.plan_id
      where s.id = plan_courses.slot_id and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.plan_slots s
      join public.plans p on p.id = s.plan_id
      where s.id = plan_courses.slot_id and p.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Public read of shared plans
--
-- A SECURITY DEFINER function returning the whole plan as JSON. Anon callers
-- never see the plans table directly; they can only resolve a share_token to
-- the plan it points at. NULL is returned for unknown / empty tokens.
-- search_path is pinned to public,pg_temp to defeat search-path hijacking.
-- ---------------------------------------------------------------------------

create or replace function public.get_shared_plan(token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if token is null or token = '' then
    return null;
  end if;

  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'program_id', p.program_id,
    'specialization_id', p.specialization_id,
    'system_of_study', p.system_of_study,
    'start_term_id', p.start_term_id,
    'program_scrape_version', p.program_scrape_version,
    'updated_at', p.updated_at,
    'slots', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'term_id', s.term_id,
          'position', s.position,
          'is_coop', s.is_coop,
          'ordinal', s.ordinal,
          'courses', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'code', c.course_code,
                'grade', c.grade,
                'ordinal', c.ordinal
              )
              order by c.ordinal, c.course_code
            )
            from public.plan_courses c
            where c.slot_id = s.id
          ), '[]'::jsonb)
        )
        order by s.ordinal
      )
      from public.plan_slots s
      where s.plan_id = p.id
    ), '[]'::jsonb)
  )
  into result
  from public.plans p
  where p.share_token = token;

  return result;
end;
$$;

revoke all on function public.get_shared_plan(text) from public;
grant execute on function public.get_shared_plan(text) to anon, authenticated;
