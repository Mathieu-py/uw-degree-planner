import Link from "next/link";

const REPO_URL = "https://github.com/Mathieu-py/uw-degree-planner";

export function Footer() {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-12 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold tracking-tight">
            UW Degree Planner
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            An unofficial planning tool for UWaterloo undergrads.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-5 text-sm text-zinc-600 dark:text-zinc-400">
          <Link
            href="/plan"
            className="hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            Try the demo
          </Link>
          <Link
            href="/login"
            className="hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            Sign in
          </Link>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
