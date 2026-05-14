import Link from "next/link";

export default function Home() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28 flex flex-col gap-10">
      <div className="flex flex-col gap-5">
        <span className="inline-flex items-center self-start gap-2 rounded-full border border-zinc-300 dark:border-zinc-700 px-3 py-1 text-xs uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          Winter 2026 catalog
        </span>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-tight">
          Find the right{" "}
          <span className="bg-gradient-to-br from-rose-500 via-amber-500 to-emerald-500 bg-clip-text text-transparent">
            UWaterloo elective
          </span>{" "}
          without the spreadsheet.
        </h1>
        <p className="text-lg leading-relaxed text-zinc-600 dark:text-zinc-300 max-w-2xl">
          Sort and filter ~10,000 UWaterloo courses by usefulness, easiness,
          prerequisites you&apos;ve already done, and available seats — sourced
          from UWFlow ratings and refreshed nightly.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/browse"
          className="inline-flex items-center justify-center rounded-full bg-zinc-950 px-6 py-3 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors"
        >
          Browse electives →
        </Link>
        <a
          href="https://github.com/Mathieu-py/uw-elective-finder"
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center justify-center rounded-full border border-zinc-300 dark:border-zinc-700 px-6 py-3 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
        >
          View on GitHub
        </a>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-6 border-t border-zinc-200 dark:border-zinc-800">
        <Feature
          title="Real reviews"
          body="Ratings, easiness, and review counts come from UWFlow — no guesswork from course descriptions alone."
        />
        <Feature
          title="Smart filters"
          body="Auto-exclude courses that conflict with your program, require prereqs you don't have, or have no seats left."
        />
        <Feature
          title="Coming: ask in English"
          body="“Find me easy STEM electives that complement CS” → typed filters, powered by Claude."
        />
      </dl>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
        {title}
      </dt>
      <dd className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
        {body}
      </dd>
    </div>
  );
}
