-- Drop plans.program_scrape_version.
--
-- Reserved for choice-group remap warnings that were never built: nothing ever
-- wrote a non-null value (snapshots come from LocalPlan-shaped values without
-- the field, so every save stored null) and nothing reads it. No down
-- migration; re-adding a nullable column is cheap if the feature ever lands.

-- ---------------------------------------------------------------------------
-- Recreate save_plan_state without the program_scrape_version assignment.
-- Body otherwise identical to migrations/0008. (Functions can't be patched in
-- place; a full `create or replace` is the migration idiom.)
-- ---------------------------------------------------------------------------

create or replace function public.save_plan_state(
  p_plan_id uuid,
  p_snapshot jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'snapshot must be a JSON object' using errcode = '22023';
  end if;

  update public.plans set
    program_ids = coalesce(
      (
        select array_agg(elem)
        from jsonb_array_elements_text(
          case when jsonb_typeof(p_snapshot->'programIds') = 'array'
            then p_snapshot->'programIds'
            else '[]'::jsonb
          end
        ) as elem
      ),
      '{}'::text[]
    ),
    specialization_ids = coalesce(
      (
        select jsonb_object_agg(key, value)
        from jsonb_each(
          case when jsonb_typeof(p_snapshot->'specializationIds') = 'object'
            then p_snapshot->'specializationIds'
            else '{}'::jsonb
          end
        )
        where (
          case when jsonb_typeof(p_snapshot->'programIds') = 'array'
            then p_snapshot->'programIds'
            else '[]'::jsonb
          end
        ) ? key
      ),
      '{}'::jsonb
    ),
    -- Acknowledged unverified requirements, keyed by programId. Drop any entry
    -- whose program isn't on the plan (same stale-key guard as specializations).
    acknowledged_requirements = coalesce(
      (
        select jsonb_object_agg(key, value)
        from jsonb_each(
          case when jsonb_typeof(p_snapshot->'acknowledgedRequirements') = 'object'
            then p_snapshot->'acknowledgedRequirements'
            else '{}'::jsonb
          end
        )
        where (
          case when jsonb_typeof(p_snapshot->'programIds') = 'array'
            then p_snapshot->'programIds'
            else '[]'::jsonb
          end
        ) ? key
      ),
      '{}'::jsonb
    ),
    system_of_study = nullif(p_snapshot->>'stream', ''),
    start_term_id = case
      when (p_snapshot->'startTermId') is null
        or jsonb_typeof(p_snapshot->'startTermId') = 'null' then null
      else (p_snapshot->>'startTermId')::int
    end
  where id = p_plan_id;

  if not found then
    raise exception 'plan not found or not authorized'
      using errcode = '42501';
  end if;

  -- Cascade clears plan_courses too.
  delete from public.plan_slots where plan_id = p_plan_id;

  insert into public.plan_slots (id, plan_id, term_id, position, is_coop, ordinal)
  select
    (slot->>'id')::uuid,
    p_plan_id,
    case
      when (slot->'termId') is null
        or jsonb_typeof(slot->'termId') = 'null' then null
      else (slot->>'termId')::int
    end,
    slot->>'position',
    coalesce((slot->>'isCoop')::boolean, false),
    (ord - 1)::smallint
  from jsonb_array_elements(
    case when jsonb_typeof(p_snapshot->'slots') = 'array'
      then p_snapshot->'slots'
      else '[]'::jsonb
    end
  ) with ordinality as t(slot, ord);

  insert into public.plan_courses (slot_id, course_code, outcome, ordinal)
  select
    (slot->>'id')::uuid,
    course->>'code',
    -- A malformed direct call degrades to null rather than tripping the CHECK.
    case when course->>'outcome' in ('credit', 'noCredit', 'inProgress', 'transfer')
         then course->>'outcome' end,
    (course_ord - 1)::smallint
  from jsonb_array_elements(
    case when jsonb_typeof(p_snapshot->'slots') = 'array'
      then p_snapshot->'slots'
      else '[]'::jsonb
    end
  ) as slot,
  jsonb_array_elements(
    case when jsonb_typeof(slot->'courses') = 'array'
      then slot->'courses'
      else '[]'::jsonb
    end
  ) with ordinality as t(course, course_ord);
end;
$$;

revoke all on function public.save_plan_state(uuid, jsonb) from public;
grant execute on function public.save_plan_state(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Recreate get_shared_plan without the program_scrape_version key. Body
-- otherwise identical to migrations/0008.
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
    'program_ids', p.program_ids,
    'specialization_ids', p.specialization_ids,
    'acknowledged_requirements', p.acknowledged_requirements,
    'system_of_study', p.system_of_study,
    'start_term_id', p.start_term_id,
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
                'outcome', c.outcome,
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

alter table public.plans drop column program_scrape_version;
