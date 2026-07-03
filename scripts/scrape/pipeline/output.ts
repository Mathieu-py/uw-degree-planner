/**
 * Output side of the pipeline: validate + write data/programs.json (atomic
 * rename), plus the end-of-run stderr summaries.
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Program, validatePrograms } from "../../../lib/programs";

export function reportList(label: string, items: readonly string[]): void {
  if (items.length === 0) return;
  console.error(`\n${items.length} ${label}:`);
  for (const s of items) console.error(`  ${s}`);
}

/**
 * Sort programs by slug and write the JSON output. Returns the absolute
 * path of the written file.
 */
export async function writeOutput(
  programs: Record<string, Program>,
): Promise<string> {
  const sorted = Object.fromEntries(
    Object.entries(programs).sort(([a], [b]) => a.localeCompare(b)),
  );
  // Fail fast on a malformed shape rather than committing a programs.json the
  // app would reject at load (it parses the same schema via validatePrograms).
  validatePrograms(sorted);
  const dataDir = path.resolve(process.cwd(), "data");
  await mkdir(dataDir, { recursive: true });
  const outPath = path.join(dataDir, "programs.json");
  const tmpPath = `${outPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(sorted, null, 2), "utf-8");
  await rename(tmpPath, outPath);
  return outPath;
}
