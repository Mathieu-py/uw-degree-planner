import { PROGRAMS, type Program, programShortName } from "@/lib/programs";

/**
 * A Joint Honours plan is half a degree — matched by name, not the `jh-` prefix,
 * since `earth-sciences` and `science-with-arts-major` lack it.
 */
export function isJointHonours(program: Program): boolean {
  return /joint honours/i.test(program.name);
}

/**
 * An honours-level plan — a valid partner. "Joint Honours" matches too (two joint
 * plans pair each other); every plan without "honours" is a General/professional
 * one, which doesn't qualify.
 */
export function isHonours(program: Program): boolean {
  return /honours/i.test(program.name);
}

/**
 * The selected Joint Honours plan lacking a valid partner, or null. Partner must
 * be honours-level: "combined with another joint or honours plan" (UW Calendar),
 * so a Three-/Four-Year General plan doesn't count. Faculty-line rules (Science
 * crosses faculties, Math stays within) are deferred — the sources conflict.
 */
export function unpairedJointHonours(
  programIds: readonly string[],
): Program | null {
  // Dedup ids first: a repeated id would otherwise pair with its own second
  // copy at a different array index (the j !== i check only excludes the same
  // position), letting a lone Joint Honours plan look partnered.
  const resolved = [...new Set(programIds)]
    .map((id) => PROGRAMS[id])
    .filter((p): p is Program => Boolean(p));
  for (let i = 0; i < resolved.length; i++) {
    if (!isJointHonours(resolved[i])) continue;
    if (!resolved.some((p, j) => j !== i && isHonours(p))) return resolved[i];
  }
  return null;
}

/** Canonical "add a partner plan" copy, shared by every surface that warns. */
export function jointHonoursPartnerMessage(program: Program): string {
  return `Joint Honours is only half a degree — pair ${programShortName(program)} with a second honours plan to complete it.`;
}

/** The partner-needed warning for a program selection, or null when it's fine. */
export function jointHonoursWarning(
  programIds: readonly string[],
): string | null {
  const program = unpairedJointHonours(programIds);
  return program ? jointHonoursPartnerMessage(program) : null;
}
