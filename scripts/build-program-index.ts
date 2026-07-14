/**
 * Emit `data/programs-index.json` — the client-safe slice of `data/programs.json`.
 *
 * The full file (~2 MB of rule trees) must not ship to the browser. The
 * client needs only index-level fields (name, term span, specialization
 * slug+name) for the picker, transcript matching, term-span and eligibility
 * identity; heavy detail is fetched per-program on demand via the API route.
 *
 * Run standalone (`pnpm build-program-index`) or as the tail of `scrape-programs`
 * so the index never drifts from the source file.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// Type-only: erased at compile, so the 60 KB index JSON that programsMeta
// imports never loads here. One shared shape keeps generator and reader in
// lockstep — a field rename that touched only one side wouldn't compile.
import type { ProgramMeta } from "../lib/programsMeta";

const DATA = join(process.cwd(), "data");

// A full `Program` (scraper) and the raw parsed JSON (CLI) both satisfy the
// ProgramMeta subset structurally, so callers need no cast.
export function buildProgramIndex(
  programs: Record<string, ProgramMeta>,
): Record<string, ProgramMeta> {
  const out: Record<string, ProgramMeta> = {};
  // Sorted keys → stable diffs, whichever producer (CLI or scraper) writes.
  for (const [id, p] of Object.entries(programs).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    out[id] = {
      name: p.name,
      ...(typeof p.numberOfTerms === "number"
        ? { numberOfTerms: p.numberOfTerms }
        : {}),
      ...(p.specializations?.length
        ? {
            specializations: p.specializations.map((s) => ({
              slug: s.slug,
              name: s.name,
            })),
          }
        : {}),
    };
  }
  return out;
}

function main() {
  const raw = JSON.parse(readFileSync(join(DATA, "programs.json"), "utf8"));
  const index = buildProgramIndex(raw);
  writeFileSync(
    join(DATA, "programs-index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
  );
  console.log(
    `programs-index.json: ${Object.keys(index).length} programs written.`,
  );
}

// Run when invoked directly (tsx), not when imported by the scraper.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
