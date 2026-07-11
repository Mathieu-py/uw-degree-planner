"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { ShowFilter } from "@/lib/courses/rowEligibility";
import type { PickerFilters } from "./useFilteredCourses";

const LEVEL_BUCKETS = [100, 200, 300, 400] as const;

// The merged eligibility control (see ShowFilter). Picker-only — the catalog has
// no plan/term, so nothing to judge eligibility against.
const SHOW_OPTIONS: { value: ShowFilter; label: string; dot: string }[] = [
  { value: "eligible", label: "Eligible", dot: "bg-met" },
  { value: "eligibleCheck", label: "Eligible + check", dot: "bg-partial" },
  { value: "all", label: "All courses", dot: "bg-ink-3" },
];

/**
 * Filter rail shared by the slot picker and the catalog page: the "Show"
 * eligibility control, level chips, a searchable subject include/exclude, and
 * min-rating + has-seats controls. `Show` renders only when `showEligibility`
 * (the picker); the catalog omits it. Course search lives in each table's own
 * bar, not here.
 */
export function FilterSidebar({
  filters,
  knownPrefixes,
  onPatch,
  onReset,
  showEligibility = true,
}: {
  filters: PickerFilters;
  knownPrefixes: string[];
  onPatch: (p: Partial<PickerFilters>) => void;
  onReset: () => void;
  showEligibility?: boolean;
}) {
  // Additive selection: no levels picked = all shown (nothing highlighted);
  // tapping a level adds/removes it. Selecting all four normalizes back to []
  // (same meaning as "all", and keeps the display from reading fully-selected).
  function toggleLevel(lvl: number) {
    const next = filters.levels.includes(lvl)
      ? filters.levels.filter((l) => l !== lvl)
      : [...filters.levels, lvl].sort((a, b) => a - b);
    onPatch({ levels: next.length === LEVEL_BUCKETS.length ? [] : next });
  }

  return (
    <aside className="w-full md:w-60 shrink-0 border-b md:border-b-0 md:border-r border-line px-4 py-3 flex flex-col gap-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
          Filters
        </h3>
        <Button
          variant="ghost"
          onClick={onReset}
          className="underline-offset-2"
        >
          Reset
        </Button>
      </div>

      {showEligibility ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-ink-3">
            Show
          </span>
          <div className="flex flex-col">
            {SHOW_OPTIONS.map((o) => {
              const on = filters.show === o.value;
              return (
                <label
                  key={o.value}
                  className={
                    "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs cursor-pointer transition-colors " +
                    (on ? "bg-bg-2 text-ink" : "text-ink-2 hover:bg-bg-2")
                  }
                >
                  <input
                    type="radio"
                    name="show-filter"
                    checked={on}
                    onChange={() => onPatch({ show: o.value })}
                    className="sr-only"
                  />
                  <span
                    className={
                      "flex h-3.5 w-3.5 items-center justify-center rounded-full border " +
                      (on ? "border-accent-bg" : "border-line-strong")
                    }
                  >
                    {on ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-accent-bg" />
                    ) : null}
                  </span>
                  <span className={"h-1.5 w-1.5 rounded-full " + o.dot} />
                  <span>{o.label}</span>
                  {o.value === "eligibleCheck" ? (
                    <span className="ml-auto text-[9px] uppercase tracking-wide text-ink-3">
                      default
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-ink-3">
          Level
        </span>
        <div className="flex w-full gap-0.5 rounded-lg border border-line-2 bg-bg-2 p-0.5">
          {LEVEL_BUCKETS.map((lvl) => {
            const active = filters.levels.includes(lvl);
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => toggleLevel(lvl)}
                aria-pressed={active}
                className={
                  "flex-1 rounded-md py-1 text-xs font-semibold transition-colors " +
                  (active
                    ? "bg-bg text-ink shadow-card-sm dark:bg-line-2"
                    : "text-ink-2 hover:text-ink")
                }
              >
                {lvl}
              </button>
            );
          })}
        </div>
      </div>

      <SubjectFilter
        knownPrefixes={knownPrefixes}
        include={filters.includePrefixes}
        exclude={filters.excludePrefixes}
        onChange={(includePrefixes, excludePrefixes) =>
          onPatch({ includePrefixes, excludePrefixes })
        }
      />

      <div className="flex flex-col gap-3">
        <span className="text-[10px] uppercase tracking-wider text-ink-3">
          Ratings
        </span>
        <RangeRow
          label="Min useful"
          value={filters.minUseful}
          onChange={(minUseful) => onPatch({ minUseful })}
        />
        <RangeRow
          label="Min easy"
          value={filters.minEasy}
          onChange={(minEasy) => onPatch({ minEasy })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-ink-3">
          Availability
        </span>
        <label className="flex items-center gap-2.5 text-xs cursor-pointer select-none">
          <span className="relative inline-flex h-5 w-9 shrink-0 items-center">
            <input
              type="checkbox"
              checked={filters.hasSeatsOnly}
              onChange={(e) => onPatch({ hasSeatsOnly: e.target.checked })}
              className="peer sr-only"
            />
            <span className="h-5 w-9 rounded-full bg-line-2 transition-colors peer-checked:bg-accent-bg" />
            <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow-card-sm transition-transform peer-checked:translate-x-4" />
          </span>
          Has open seats only
        </label>
      </div>
    </aside>
  );
}

const SUBJECT_MODES = [
  { value: "only", label: "Include" },
  { value: "except", label: "Exclude" },
] as const;

/**
 * Subject filter: ONE list with a mode. Include (allow-list) and exclude
 * (deny-list) are the same decision — a whitelist and a blacklist can't both
 * add meaning (an include already hides everything else) — so there's a single
 * list and an Include/Exclude toggle that routes it into includePrefixes or
 * excludePrefixes. Only one of those arrays is ever non-empty, so the filter
 * chain never has to reconcile the two.
 */
function SubjectFilter({
  knownPrefixes,
  include,
  exclude,
  onChange,
}: {
  knownPrefixes: string[];
  include: string[];
  exclude: string[];
  onChange: (include: string[], exclude: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"only" | "except">(
    exclude.length > 0 ? "except" : "only",
  );

  // The single active list is whichever array this mode targets.
  const list = mode === "except" ? exclude : include;
  const listSet = useMemo(() => new Set(list), [list]);
  const results = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    return knownPrefixes
      .filter((p) => p.includes(q) && !listSet.has(p))
      .slice(0, 40);
  }, [knownPrefixes, query, listSet]);

  // Write the one list into the array the current mode targets; the other stays
  // empty so include/exclude never fight.
  const setList = (next: string[]) =>
    mode === "except" ? onChange([], next) : onChange(next, []);

  function switchMode(next: "only" | "except") {
    if (next === mode) return;
    setMode(next);
    // Move the current selection to the other bucket (don't lose it).
    if (next === "except") onChange([], list);
    else onChange(list, []);
  }

  const chipTone =
    mode === "except"
      ? "bg-danger-soft text-danger"
      : "bg-accent-soft text-accent";

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-ink-3">
        Subjects
      </span>

      <div className="flex w-full gap-0.5 rounded-lg border border-line-2 bg-bg-2 p-0.5">
        {SUBJECT_MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => switchMode(m.value)}
            aria-pressed={mode === m.value}
            className={
              "flex-1 rounded-md py-1 text-[11px] font-semibold transition-colors " +
              (mode === m.value
                ? "bg-bg text-ink shadow-card-sm dark:bg-line-2"
                : "text-ink-2 hover:text-ink")
            }
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <Icon
          name="search"
          size="xs"
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search subjects…"
          aria-label="Search subjects"
          className="w-full rounded-lg border border-line-2 bg-bg py-1.5 pl-8 pr-2 text-xs placeholder:text-ink-3 outline-none transition-[border-color,box-shadow] focus:border-accent-bg focus:shadow-[0_0_0_3px_var(--accent-soft)]"
        />
      </div>

      {query.trim() ? (
        <div className="flex max-h-40 flex-col gap-px overflow-y-auto rounded-lg border border-line bg-bg p-1 shadow-card-md">
          {results.length > 0 ? (
            results.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setList([...list, p]);
                  setQuery("");
                }}
                className="rounded-md px-2 py-1.5 text-left font-mono text-xs font-medium text-ink-2 hover:bg-bg-2 hover:text-ink"
              >
                {p}
              </button>
            ))
          ) : (
            <span className="px-2 py-1.5 text-[10px] text-ink-3">
              No matching subjects.
            </span>
          )}
        </div>
      ) : null}

      {list.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {list.map((p) => (
            <span
              key={p}
              className={
                "inline-flex items-center gap-1 rounded-md py-0.5 pl-2 pr-1 font-mono text-[10px] font-semibold " +
                chipTone
              }
            >
              {p}
              <button
                type="button"
                onClick={() => setList(list.filter((x) => x !== p))}
                aria-label={`Remove ${p}`}
                className="opacity-70 hover:opacity-100"
              >
                <Icon name="close" size="xs" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RangeRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  // Drag updates a local value for an instant thumb; the (expensive) filter
  // commit fires only on release, so dragging doesn't re-run the whole
  // filter/sort pipeline per tick. Re-sync if the parent changes (e.g. Reset).
  const committed = Math.round((value ?? 0) * 100);
  const [pct, setPct] = useState(committed);
  useEffect(() => {
    setPct(committed);
  }, [committed]);

  const commit = (n: number) => onChange(n === 0 ? null : n / 100);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] text-ink-2">{label}</span>
      <div className="flex items-center gap-2.5">
        <input
          type="range"
          min={0}
          max={100}
          value={pct}
          onChange={(e) => setPct(Number(e.target.value))}
          onPointerUp={(e) => commit(Number(e.currentTarget.value))}
          onKeyUp={(e) => commit(Number(e.currentTarget.value))}
          aria-label={label}
          style={{ "--pct": `${pct}%` } as CSSProperties}
          className="range-gold flex-1"
        />
        <span
          className={
            "w-9 text-right font-mono text-[11px] font-semibold tabular-nums " +
            (pct === 0 ? "text-ink-3" : "text-ink")
          }
        >
          {pct === 0 ? "Any" : `${pct}%`}
        </span>
      </div>
    </div>
  );
}
