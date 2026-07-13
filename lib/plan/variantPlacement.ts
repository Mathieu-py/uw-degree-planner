/**
 * Resolve variant-picker selections into timeline positions for a fresh
 * manual plan. Engineering picks carry their rule's own term; flexible picks
 * (CS and most majors, no term in the rule) go to the earliest prereq-eligible
 * term at or after the course's level term (1xx→1A … 4xx→4A) — prereq-aware via
 * {@link eligibleSlotIdsForCourse}, level-floored so a senior pick never lands in
 * first year even when its prereqs are unplaced mandatory courses. Pure: runs
 * server-side where the catalog lives, returns `{code, position}` the client
 * applies to its own slot ids (positions are unique per academic term).
 */

import { courseLevel, levelBucket } from "@/lib/courses/code";
import type { Course } from "@/lib/courses/types";
import type { TermLetter } from "@/lib/programs";
import {
  programIdentities,
  programIdsTermSpan,
  programReferencedCodes,
} from "@/lib/programsRegistry";
import type { TermId } from "@/lib/terms";
import { isAcademicSlot } from "./derive";
import { eligibleSlotIdsForCourse } from "./eligibleTerms";
import { addCourseToSlot } from "./mutateSlots";
import { buildEmptySlots } from "./sequence";
import {
  type LocalPlan,
  PLAN_SCHEMA_VERSION,
  type SlotPosition,
  type Stream,
} from "./types";

export interface VariantSelection {
  code: string;
  /** Engineering pick's term, or null for a flexible (term-agnostic) pick. */
  termLabel: TermLetter | null;
}

export interface VariantPlacement {
  code: string;
  position: SlotPosition;
}

export interface VariantPlacementInput {
  programIds: string[];
  startTermId: TermId;
  stream: Stream;
  selections: VariantSelection[];
}

/**
 * The academic term a course's level conventionally sits in — 1xx→1A, 2xx→2A,
 * 3xx→3A, 4xx→4A (UW numbers courses by year). A placement floor: a flexible pick
 * is never scheduled before this term, so a senior course stays out of first year.
 */
function levelTermFloor(code: string): TermLetter {
  const hundreds = levelBucket(courseLevel(code)) / 100; // 0 when uncatalogued
  const year = Math.min(4, Math.max(1, hundreds || 1));
  return `${year}A` as TermLetter;
}

export function resolveVariantPlacements(
  input: VariantPlacementInput,
  catalog: Course[],
): VariantPlacement[] {
  const { programIds, startTermId, stream, selections } = input;
  if (selections.length === 0) return [];

  let counter = 0;
  const mintId = () => `s${counter++}`;
  let plan: LocalPlan = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    programIds,
    specializationIds: {},
    stream,
    startTermId,
    slots: buildEmptySlots(
      startTermId,
      stream,
      mintId,
      programIdsTermSpan(programIds),
    ),
    acknowledgedRequirements: {},
    updatedAt: "",
  };

  const catalogByCode = new Map(catalog.map((c) => [c.code, c]));
  const programs = programIdentities(programIds, {});
  const referenced = new Set<string>();
  for (const id of programIds) {
    for (const c of programReferencedCodes(id)) referenced.add(c);
  }

  // Slot ids/positions are stable across addCourseToSlot, so this list built
  // once stays valid; buildEmptySlots emits academic terms in sequence order.
  const academicSlots = plan.slots.filter(isAcademicSlot);

  const placements: VariantPlacement[] = [];
  const placed = new Set<string>(); // a code can appear in two programs' groups

  const place = (code: string, slotId: string, position: SlotPosition) => {
    const next = addCourseToSlot(plan, slotId, { code });
    if (next === plan) return; // dedup no-op
    plan = next;
    placed.add(code);
    placements.push({ code, position });
  };

  // 1) Engineering-termed picks → their rule's own term (authoritative).
  for (const sel of selections) {
    if (sel.termLabel === null) continue;
    const code = sel.code.toLowerCase();
    if (placed.has(code)) continue;
    const slot = plan.slots.find((s) => s.position === sel.termLabel);
    if (slot) place(code, slot.id, slot.position);
  }

  // 2) Flexible picks → earliest eligible academic term. Sequential greedy,
  //    prereqs first (level asc) so a placed pick informs the next's eligibility.
  const flexible = selections
    .filter((s) => s.termLabel === null)
    .map((s) => s.code.toLowerCase())
    .filter((code) => !placed.has(code))
    .sort((a, b) => courseLevel(a) - courseLevel(b) || (a < b ? -1 : 1));

  for (const code of flexible) {
    if (placed.has(code)) continue;
    const eligible = eligibleSlotIdsForCourse(
      plan,
      code,
      catalogByCode,
      programs,
      referenced,
    );
    // Never place a pick before its level term (1xx→1A … 4xx→4A): search from
    // the floor down for the earliest prereq-eligible term, and if none is (a
    // manual plan places no mandatory prereqs) settle on the floor itself. Keeps
    // a senior course out of first year. Floor absent (short plan) → last term.
    const floorIdx = academicSlots.findIndex(
      (s) => s.position === levelTermFloor(code),
    );
    const search =
      floorIdx >= 0 ? academicSlots.slice(floorIdx) : academicSlots.slice(-1);
    const target = search.find((s) => eligible.has(s.id)) ?? search[0];
    if (target) place(code, target.id, target.position);
  }

  return placements;
}
