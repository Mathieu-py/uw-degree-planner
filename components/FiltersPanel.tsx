"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_PURE_FILTERS,
  decodePureFilters,
  mergePureFiltersIntoParams,
} from "@/lib/filterState";
import type { PureFilters } from "@/lib/types";
import { Chip } from "./filter/Chip";
import { PrefixPicker } from "./filter/PrefixPicker";
import { Section } from "./filter/Section";
import { useFilterCommit } from "./filter/useFilterCommit";

interface Props {
  filters: PureFilters;
  knownPrefixes: string[];
}

const LEVEL_BUCKETS = [100, 200, 300, 400] as const;

// state.levels === [] means "all four buckets". Selecting all four (or none) collapses back to [].
function toggleLevel(current: readonly number[], lvl: number): number[] {
  const expanded = current.length === 0 ? [...LEVEL_BUCKETS] : current;
  const next = expanded.includes(lvl)
    ? expanded.filter((l) => l !== lvl)
    : [...expanded, lvl];
  if (next.length === 0 || next.length === LEVEL_BUCKETS.length) return [];
  return [...next].sort((a, b) => a - b);
}

export function FiltersPanel({ filters, knownPrefixes }: Props) {
  const commit = useFilterCommit(mergePureFiltersIntoParams);

  // URL is source of truth. Reading the prop would lose changes made by a
  // prior click in the same transition (router.replace is async). The updater
  // form lets callers derive the next state from the live one — required for
  // toggles like level chips where the input depends on the current value.
  function patchFilters(
    p: Partial<PureFilters> | ((live: PureFilters) => Partial<PureFilters>),
  ) {
    const live =
      typeof window !== "undefined"
        ? decodePureFilters(new URLSearchParams(window.location.search))
        : filters;
    const delta = typeof p === "function" ? p(live) : p;
    commit({ ...live, ...delta });
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Filters
        </h2>
        <button
          type="button"
          onClick={() => patchFilters(DEFAULT_PURE_FILTERS)}
          className="text-xs text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50 underline-offset-2 hover:underline"
        >
          Reset
        </button>
      </div>

      <Section title="Levels">
        <div className="flex flex-wrap gap-2">
          {LEVEL_BUCKETS.map((lvl) => {
            const active =
              filters.levels.length === 0 || filters.levels.includes(lvl);
            return (
              <Chip
                key={lvl}
                active={active}
                onClick={() =>
                  patchFilters((live) => ({
                    levels: toggleLevel(live.levels, lvl),
                  }))
                }
              >
                {lvl}
              </Chip>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {filters.levels.length === 0
            ? "All levels"
            : `${filters.levels.join(", ")} only`}
        </p>
      </Section>

      <Section title="Exclude prefixes">
        <PrefixPicker
          selected={filters.excludePrefixes}
          known={knownPrefixes}
          onChange={(excludePrefixes) => patchFilters({ excludePrefixes })}
          emptyLabel="No prefixes excluded"
        />
      </Section>

      <Section title="Ratings">
        <RangeSlider
          label="Min usefulness"
          value={filters.minUseful}
          onChange={(minUseful) => patchFilters({ minUseful })}
        />
        <RangeSlider
          label="Min easiness"
          value={filters.minEasy}
          onChange={(minEasy) => patchFilters({ minEasy })}
        />
      </Section>

      <Section title="Toggles">
        <Toggle
          label="Hide courses with no seats"
          checked={filters.hasSeatsAvailable}
          onChange={(hasSeatsAvailable) => patchFilters({ hasSeatsAvailable })}
        />
        <Toggle
          label="Hide unmet prereqs"
          checked={filters.hideUnmetPrereqs}
          onChange={(hideUnmetPrereqs) => patchFilters({ hideUnmetPrereqs })}
        />
      </Section>
    </>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
      />
      <span>{label}</span>
    </label>
  );
}

function RangeSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  const committedPct = Math.round((value ?? 0) * 100);
  const [draftPct, setDraftPct] = useState(committedPct);

  // Sync external committedPct (derived from props.value) into local draftPct so
  // that URL/state changes from outside this component (Reset button, shared
  // link, navigation) update the slider. Local-only drags continue to write
  // draftPct directly from the onChange handler.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional external→local sync; see comment above
    setDraftPct(committedPct);
  }, [committedPct]);

  function commit() {
    if (draftPct === committedPct) return;
    onChange(draftPct === 0 ? null : draftPct / 100);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400">
        <span>{label}</span>
        <span className="tabular-nums">
          {draftPct === 0 ? "off" : `${draftPct}%`}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={draftPct}
        onChange={(e) => setDraftPct(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="accent-zinc-950 dark:accent-zinc-50"
      />
    </div>
  );
}
