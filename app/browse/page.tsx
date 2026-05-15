import { CourseBrowser } from "@/components/CourseBrowser";
import { buildBrowseRows } from "@/lib/browse";
import { loadTerm } from "@/lib/data";
import { decodeFilterState } from "@/lib/filterState";
import { compareCourses, parseSortDir, parseSortKey } from "@/lib/sort";
import { PINNED_TERM as TERM, termLabel } from "@/lib/terms";

export const metadata = {
  title: "Browse electives · UW Elective Finder",
};

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const state = decodeFilterState(params);
  const sortKey = parseSortKey(params.s);
  const sortDir = parseSortDir(params.d);

  const all = await loadTerm(TERM);
  const rows = buildBrowseRows(all, state);
  rows.sort((a, b) => compareCourses(a.course, b.course, sortKey, sortDir));

  const allCourseCodes = all.map((c) => c.code).sort();
  const knownPrefixes = [...new Set(all.map((c) => c.prefix))].sort();

  return (
    <div className="mx-auto max-w-6xl w-full px-6 py-10 flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {termLabel(TERM)}
        </span>
        <h1 className="text-3xl font-semibold tracking-tight">Browse electives</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-2xl">
          {all.length.toLocaleString()} courses in the catalog. Configure the filters
          on the left to match your program; the URL stays in sync so you can share or
          bookmark any view.
        </p>
      </div>

      <CourseBrowser
        rows={rows}
        state={state}
        sortKey={sortKey}
        sortDir={sortDir}
        totalCount={all.length}
        allCourseCodes={allCourseCodes}
        knownPrefixes={knownPrefixes}
      />
    </div>
  );
}
