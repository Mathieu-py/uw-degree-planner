/**
 * Advisory drift check for scripts/scrape/data/subjectFaculty.ts.
 *
 * That subject → Faculty map is hand-transcribed from UW's "Course Subjects
 * Offered" table, so it silently goes stale when UW adds a subject: a
 * "Faculty of X" pool then omits the new subject and quietly under-credits an
 * audit. This flags any real/offered subject in the committed catalog snapshot
 * that is in neither SUBJECT_FACULTY nor OMITTED_SUBJECTS — a code a human must
 * classify (map to its owning faculty, or omit if it has none).
 *
 * "Real/offered" is loadCatalogCodes()'s `units != null` lens, which already
 * excludes inactive/not-offered and WLU cross-listed codes (#117) — without it
 * the catalog's historical superset buries the signal in ~100 dead subjects.
 *
 * Non-fatal by design (always exits 0): a mid-term catalog refresh that adds a
 * subject must not fail CI. Unlike check-dropped.ts, drift here is a heads-up,
 * not a regression. See issue #122.
 *
 * Run: pnpm check-subjects
 */
import { appendFileSync } from "node:fs";
import {
  OMITTED_SUBJECTS,
  SUBJECT_FACULTY,
} from "../scrape/data/subjectFaculty";
import { loadCatalogCodes } from "../scrape/util/catalog";
import { isDirectInvocation } from "../scrape/util/entry";

/** Subject prefixes present in `prefixes` but absent from `known`, sorted. */
export function findUnclassified(
  prefixes: Iterable<string>,
  known: Set<string>,
): string[] {
  return [...prefixes].filter((p) => !known.has(p)).sort();
}

function main(): void {
  const mapped = Object.keys(SUBJECT_FACULTY);
  const known = new Set<string>([...mapped, ...OMITTED_SUBJECTS]);
  const { byPrefix } = loadCatalogCodes();
  const unclassified = findUnclassified(byPrefix.keys(), known);

  const lines: string[] = [];
  if (unclassified.length === 0) {
    lines.push(
      `✓ Every real/offered subject is classified (${mapped.length} mapped, ${OMITTED_SUBJECTS.length} omitted).`,
    );
  } else {
    lines.push(
      `⚠ ${unclassified.length} catalog subject(s) not classified in subjectFaculty.ts:`,
      "",
    );
    for (const p of unclassified) {
      const entries = byPrefix.get(p) ?? [];
      const sample = entries
        .slice()
        .sort((a, b) => a.num - b.num)
        .slice(0, 3)
        .map((e) => e.code);
      const n = entries.length;
      lines.push(
        `  ${p} (${n} course${n === 1 ? "" : "s"}): ${sample.join(", ")}`,
      );
    }
    lines.push(
      "",
      "Classify each per UW's Course Subjects Offered table: add to SUBJECT_FACULTY",
      "(a single owning faculty) or OMITTED_SUBJECTS (no single faculty).",
    );
  }

  const report = lines.join("\n");
  console.log(report);

  // Surface drift on the CI job page (e.g. the weekly UWFlow refresh) with no
  // extra workflow yaml. GITHUB_STEP_SUMMARY is set only under GitHub Actions.
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    appendFileSync(
      summaryFile,
      `## Subject drift check\n\n\`\`\`\n${report}\n\`\`\`\n`,
    );
  }
}

// Run main() only when invoked directly, so tests can import findUnclassified.
// Advisory by design (file header): swallow any failure — e.g. an unwritable
// GITHUB_STEP_SUMMARY — so the check still exits 0 and never fails the refresh.
if (isDirectInvocation(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error("check-subjects skipped (non-fatal):", err);
  }
}
