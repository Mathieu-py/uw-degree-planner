/**
 * Degree-level requirements: fetch each shared "Bachelor of X degree-level
 * requirements" page once, then attach it to every referencing program and
 * propagate the degree total into programs that don't state their own.
 */
import { countNoun } from "../../../lib/format";
import type { DegreeRequirements, Program } from "../../../lib/programs";
import { resolveDegreeTotalUnits } from "../program/degreeTotal";
import {
  type DegreeParseResult,
  parseDegreeRequirements,
} from "../programs-parser";
import { API_BASE } from "../sources/kualiCatalog";
import { fetchJson } from "../util/fetch";
import { fetchEachPaced, VIEW_BASE } from "./shared";

/**
 * Fetch each unique degree-level page once and parse it. Programs reference
 * these by pid; the same "Bachelor of Science degree-level requirements" is
 * shared by every Science major, so we dedup before fetching.
 */
export async function runPhaseDegrees(
  catalogId: string,
  degreeRefBySlug: ReadonlyMap<string, { pid: string; name: string }>,
): Promise<Map<string, DegreeParseResult>> {
  const byPid = new Map<string, DegreeParseResult>();
  const pids = [...new Set([...degreeRefBySlug.values()].map((r) => r.pid))];
  if (pids.length === 0) return byPid;
  console.log(`\nFetching ${pids.length} degree-level requirement pages...`);
  await fetchEachPaced({
    items: pids,
    label: (pid) => `degree ${pid}`,
    fetcher: (pid) =>
      fetchJson<Record<string, string>>(
        `${API_BASE}/program/${catalogId}/${encodeURIComponent(pid)}`,
      ),
    onResult: (detail, pid) => {
      const parsed = parseDegreeRequirements(
        detail,
        pid,
        `${VIEW_BASE}/${encodeURIComponent(pid)}`,
      );
      byPid.set(pid, parsed);
      const b = parsed.degree.constraints?.length ?? 0;
      return `ok (${b} ${countNoun(b, "breadth constraint")})`;
    },
    onError: () => {},
  });
  return byPid;
}

/**
 * Attach the shared degree-level requirements to each referencing program:
 * set `degreeRequirements` and propagate the degree-page total into a program
 * that doesn't state its own.
 */
export function attachDegreeRequirements(
  programs: Record<string, Program>,
  degreeRefBySlug: ReadonlyMap<string, { pid: string; name: string }>,
  degreesByPid: ReadonlyMap<string, DegreeParseResult>,
): number {
  let attached = 0;
  for (const [slug, ref] of degreeRefBySlug) {
    const program = programs[slug];
    const parsed = degreesByPid.get(ref.pid);
    if (!program || !parsed) continue;
    const degree: DegreeRequirements = parsed.degree;
    program.degreeRequirements = degree;

    // Propagate the degree-page total to a program that states none of its own
    // (e.g. Math majors), or that states a major *subtotal* shadowing the real
    // whole-degree total (e.g. `h-sociology` lists 8.0 while the BA is 20.0).
    const newTotal = resolveDegreeTotalUnits(
      slug,
      program.name,
      program.unitPlan?.totalUnits,
      parsed,
    );
    if (newTotal != null) {
      program.unitPlan = {
        ...(program.unitPlan ?? {}),
        totalUnits: newTotal,
      };
    }
    attached++;
  }
  return attached;
}
