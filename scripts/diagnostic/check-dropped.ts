/**
 * Silent-loss diagnostic for the program-requirements parser.
 *
 * The audit can only read "100% complete" honestly if every owed requirement in
 * a program's calendar entry was either turned into a rule node OR recorded as
 * `unverified` (which gates the headline below 100% and is surfaced to the
 * student). A requirement that the parser drops with NO trace is a silent loss:
 * the audit would read complete while a real requirement was never tracked.
 *
 * This script re-runs `parseProgramRequirements` over the saved raw Kuali
 * payloads in `scripts/diagnostic/raw/*.json` (no network needed) and reports,
 * per program:
 *   - warnings  : parser misses (recognized-but-unextractable rules, unknown prose)
 *   - unverified: owed requirements we couldn't structure (audit gates on these)
 *
 * A clean run is zero warnings everywhere. Any warning is a requirement that was
 * either dropped or only partially captured — investigate it.
 *
 * Run: pnpm tsx scripts/diagnostic/check-dropped.ts
 *
 * Note: this covers only the 8-9 saved sample programs. For the full 194-program
 * picture, run `pnpm scrape-programs` and watch its per-program warning output —
 * the same parser, the same signals.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseProgramRequirements } from "../scrape-programs.parser";

const RAW_DIR = join(process.cwd(), "scripts", "diagnostic", "raw");

// Degree-level payloads aren't program details (different shape) — skip them.
const SKIP = /^degree-/;

interface Row {
  file: string;
  kind: string;
  warnings: string[];
  unverified: string[];
}

const rows: Row[] = [];
for (const file of readdirSync(RAW_DIR).sort()) {
  if (!file.endsWith(".json") || SKIP.test(file)) continue;
  const detail = JSON.parse(readFileSync(join(RAW_DIR, file), "utf8"));
  const result = parseProgramRequirements(detail, file.replace(/\.json$/, ""));
  rows.push({
    file,
    kind: result.kind,
    warnings: result.warnings,
    unverified: result.unverified,
  });
}

let totalWarnings = 0;
let totalUnverified = 0;
for (const r of rows) {
  totalWarnings += r.warnings.length;
  totalUnverified += r.unverified.length;
  const flag = r.warnings.length > 0 ? "⚠ " : "  ";
  console.log(
    `${flag}${r.file.padEnd(40)} kind=${r.kind.padEnd(12)} warnings=${r.warnings.length} unverified=${r.unverified.length}`,
  );
  for (const w of r.warnings) console.log(`      warning:    ${w}`);
  for (const u of r.unverified)
    console.log(`      unverified: ${u.slice(0, 160)}`);
}

console.log(
  `\n${rows.length} programs · ${totalWarnings} warnings · ${totalUnverified} unverified`,
);
if (totalWarnings > 0) {
  console.log(
    "⚠ Parser misses present — each is a requirement dropped or only partially captured.",
  );
  process.exitCode = 1;
} else {
  console.log("✓ No parser misses in the sample set.");
}
