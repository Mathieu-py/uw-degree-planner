import { CourseBrowser } from "@/components/CourseBrowser";
import { loadTerm } from "@/lib/data";
import { applyFilters, SYDE_M1_DEFAULTS } from "@/lib/filters";
import { termLabel } from "@/lib/terms";

export const metadata = {
  title: "Browse electives · UW Elective Finder",
};

export default async function BrowsePage() {
  const all = await loadTerm(SYDE_M1_DEFAULTS.term);
  const filtered = applyFilters(all, SYDE_M1_DEFAULTS);

  return (
    <div className="mx-auto max-w-6xl w-full px-6 py-10 flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {termLabel(SYDE_M1_DEFAULTS.term)}
        </span>
        <h1 className="text-3xl font-semibold tracking-tight">
          Electives for Systems Design Engineering
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-2xl">
          Filtered from {all.length.toLocaleString()} courses. Excludes SYDE-overlap
          subjects, language/art/social-studies departments, essay-heavy classes,
          and anything with no seats. Sort and search below.
        </p>
        <details className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          <summary className="cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 select-none">
            Why these courses? (filter details)
          </summary>
          <ul className="mt-2 space-y-1 list-disc list-inside">
            <li>100–300 level only, with available seats in {termLabel(SYDE_M1_DEFAULTS.term)}.</li>
            <li>Excludes SYDE-overlapping prefixes (PHYS, CS, ME, MSE, INTEG, MNS, SYDE, ECE, MATH, MTHEL).</li>
            <li>Excludes language, art, social-studies, music/geography/kin/chem/bio, essay-heavy, and health/environment prefixes.</li>
            <li>Drops courses where easiness &lt; 40% <em>and</em> usefulness &lt; 50%.</li>
            <li>Keeps only courses whose listed prereqs are met by MATH 116 / 117 (legacy substring check; real AST parser lands in M2).</li>
            <li>Custom programs and personalized prereq checks come in milestone&nbsp;2.</li>
          </ul>
        </details>
      </div>

      <CourseBrowser courses={filtered} />
    </div>
  );
}
