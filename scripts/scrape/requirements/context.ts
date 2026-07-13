/**
 * Per-program parse state, threaded explicitly through the requirement parser
 * instead of living in module-level globals. One `ParseContext` is created per
 * `parseProgramRequirements` call, so each program's parse is fully isolated —
 * this is what lets the parse be reentrant (the old globals required every call
 * to stay synchronous and non-interleaved; see the note in `index.ts`).
 */
export interface ParseContext {
  /**
   * This program's named course lists keyed by normalized heading — its
   * `courseListsNew` plus its titled requirement sections (added by
   * `indexSectionLists`). Joins a rule's "from List N" / "from the … list"
   * reference to its courses.
   */
  namedLists: Map<string, string[]>;
  /**
   * Free electives dropped from this program's rule tree (redundant with the
   * unit headline's free remainder) — collected so the assembler can re-surface
   * them for programs with no `totalUnits` denominator. See FREE_ELECTIVE_RE.
   */
  droppedFreeElectives: string[];
  /** Developer-facing parser warnings (unrecognized shapes, extraction misses). */
  warnings: string[];
  /** Verbatim owed-requirement statements we couldn't structure into a rule. */
  unverified: string[];
}
