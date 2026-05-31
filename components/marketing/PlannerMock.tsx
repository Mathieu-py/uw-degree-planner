/**
 * A purely decorative, static mock of the planner UI for the landing page.
 * Built from divs + the app's Tailwind palette (no screenshot asset) so it
 * stays in visual sync with the real planner and renders deterministically.
 * Marked aria-hidden — it carries no information a screen reader needs.
 */

type Status = "done" | "planned" | "empty";

const STATUS_CHIP: Record<Exclude<Status, "empty">, string> = {
  done: "border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300",
  planned:
    "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300",
};

const MOCK_TERMS: Array<{
  label: string;
  courses: Array<{ id: string; code: string; status: Status }>;
}> = [
  {
    label: "1A · F23",
    courses: [
      { id: "1a-1", code: "MATH 115", status: "done" },
      { id: "1a-2", code: "SYDE 101", status: "done" },
      { id: "1a-3", code: "PHYS 115", status: "done" },
    ],
  },
  {
    label: "1B · W24",
    courses: [
      { id: "1b-1", code: "MATH 116", status: "done" },
      { id: "1b-2", code: "SYDE 121", status: "done" },
      { id: "1b-3", code: "CHE 102", status: "done" },
    ],
  },
  {
    label: "2A · F24",
    courses: [
      { id: "2a-1", code: "SYDE 211", status: "planned" },
      { id: "2a-2", code: "SYDE 223", status: "planned" },
      { id: "2a-3", code: "", status: "empty" },
    ],
  },
  {
    label: "2B · W25",
    courses: [
      { id: "2b-1", code: "SYDE 252", status: "planned" },
      { id: "2b-2", code: "", status: "empty" },
      { id: "2b-3", code: "", status: "empty" },
    ],
  },
];

const AUDIT_ROWS: Array<{
  label: string;
  status: "met" | "partial" | "missing";
}> = [
  { label: "Mathematics", status: "met" },
  { label: "Natural science", status: "partial" },
  { label: "Complementary studies", status: "missing" },
  { label: "Technical electives", status: "partial" },
];

const DOT: Record<(typeof AUDIT_ROWS)[number]["status"], string> = {
  met: "bg-emerald-500",
  partial: "bg-amber-500",
  missing: "bg-zinc-300 dark:bg-zinc-600",
};

export function PlannerMock() {
  return (
    <section className="mx-auto max-w-5xl px-6 pb-4 sm:pb-8" aria-hidden="true">
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 shadow-sm overflow-hidden">
        {/* browser chrome */}
        <div className="flex items-center gap-1.5 border-b border-zinc-200 dark:border-zinc-800 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-rose-400/70" />
          <span className="size-2.5 rounded-full bg-amber-400/70" />
          <span className="size-2.5 rounded-full bg-emerald-400/70" />
          <span className="ml-3 truncate text-xs text-zinc-400">
            Systems Design Engineering · Stream 8 co-op
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_240px]">
          {/* timeline */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {MOCK_TERMS.map((term) => (
              <div
                key={term.label}
                className="flex flex-col gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/40 p-2.5"
              >
                <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                  {term.label}
                </span>
                {term.courses.map((c) =>
                  c.status === "empty" ? (
                    <span
                      key={c.id}
                      className="rounded border border-dashed border-zinc-300 dark:border-zinc-700 px-2 py-1.5 text-center text-[11px] text-zinc-400 dark:text-zinc-600"
                    >
                      + add
                    </span>
                  ) : (
                    <span
                      key={c.id}
                      className={`rounded border px-2 py-1.5 text-[11px] font-medium ${STATUS_CHIP[c.status]}`}
                    >
                      {c.code}
                    </span>
                  ),
                )}
              </div>
            ))}
          </div>

          {/* audit panel */}
          <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/40 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">Degree audit</span>
              <span className="text-[11px] text-zinc-400">62% complete</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div className="h-full w-[62%] rounded-full bg-gradient-to-r from-emerald-500 to-amber-500" />
            </div>
            <ul className="flex flex-col gap-2">
              {AUDIT_ROWS.map((row) => (
                <li
                  key={row.label}
                  className="flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-400"
                >
                  <span className={`size-2 rounded-full ${DOT[row.status]}`} />
                  {row.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
