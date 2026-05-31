import Link from "next/link";

const CTA_SOLID =
  "inline-flex items-center justify-center rounded-full bg-zinc-950 px-6 py-3 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors";
const CTA_OUTLINE =
  "inline-flex items-center justify-center rounded-full border border-zinc-300 dark:border-zinc-700 px-6 py-3 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors";

export function Hero() {
  return (
    <section className="mx-auto max-w-3xl px-6 pt-20 pb-12 sm:pt-28 flex flex-col gap-6">
      <span className="inline-flex items-center self-start gap-2 rounded-full border border-zinc-300 dark:border-zinc-700 px-3 py-1 text-xs uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        UWaterloo degree planner
      </span>
      <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-tight">
        Plan every term of your{" "}
        <span className="bg-gradient-to-br from-rose-500 via-amber-500 to-emerald-500 bg-clip-text text-transparent">
          UWaterloo degree
        </span>{" "}
        on one screen.
      </h1>
      <p className="text-lg leading-relaxed text-zinc-600 dark:text-zinc-300 max-w-2xl">
        Import your Quest transcript and get a full multi-term plan in seconds —
        every past course placed, requirements audited live, and prereq-aware
        suggestions sourced from UWFlow ratings and the UW Undergraduate
        Calendar.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/plan" className={CTA_SOLID}>
          Try the demo →
        </Link>
        <Link href="/login" className={CTA_OUTLINE}>
          Sign in
        </Link>
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        For UWaterloo undergrads — any program our catalog covers. No account
        needed to try it.
      </p>
    </section>
  );
}
