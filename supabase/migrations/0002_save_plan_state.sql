-- Phase 2 / PR 2: server-side plan CRUD.
--
-- Adds `save_plan_state(plan_id, snapshot)` so the planner can push a full
-- in-memory snapshot in one round trip. The function wipes the existing
-- slots+courses for the plan and rewrites them from the snapshot inside a
-- single statement-block — atomic from the client's perspective.
--
-- `security invoker` (the default) keeps RLS in effect: the caller can only
-- mutate plans they own. The `update ... where id = p_plan_id` clause returns
-- zero rows when the plan doesn't exist OR isn't owned by the caller; either
-- way we raise `42501` (insufficient privilege) so the client surfaces the
-- same error for both cases (avoiding plan-id enumeration).
--
-- Snapshot shape (matches what `lib/plan/server/serialize.ts` produces):
--   {
--     programId: string | null,
--     specializationId: string | null,
--     stream: 'regular' | 'stream4' | 'stream8',
--     startTermId: number | null,
--     programScrapeVersion: string | null,
--     slots: [
--       { id: uuid, termId: number|null, position: text, isCoop: bool,
--         courses: [ { code: text, grade: text|null } ] }
--     ]
--   }
--
-- Slot ordinal is derived from snapshot array order (1-based becomes 0-based);
-- course ordinal likewise. Client-supplied slot UUIDs are preserved so
-- in-flight UI state keyed on slot id survives a save round trip.

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
    program_id = nullif(p_snapshot->>'programId', ''),
    specialization_id = nullif(p_snapshot->>'specializationId', ''),
    system_of_study = nullif(p_snapshot->>'stream', ''),
    start_term_id = case
      when (p_snapshot->'startTermId') is null
        or jsonb_typeof(p_snapshot->'startTermId') = 'null' then null
      else (p_snapshot->>'startTermId')::int
    end,
    program_scrape_version = nullif(p_snapshot->>'programScrapeVersion', '')
  where id = p_plan_id;

  if not found then
    raise exception 'plan not found or not authorized'
      using errcode = '42501';
  end if;

  -- Cascade clears plan_courses too.
  delete from public.plan_slots where plan_id = p_plan_id;

  -- `coalesce(p_snapshot->'slots', '[]')` only catches SQL NULL; a JSON null
  -- (`{"slots": null}`) or a non-array (`{"slots": "broken"}`) would still
  -- make jsonb_array_elements raise "cannot extract elements from a non-array".
  -- Force the input to '[]' when the type isn't 'array' so the iteration is
  -- always safe — the slot count then drives whether anything gets inserted.
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

  insert into public.plan_courses (slot_id, course_code, grade, ordinal)
  select
    (slot->>'id')::uuid,
    course->>'code',
    nullif(course->>'grade', ''),
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
