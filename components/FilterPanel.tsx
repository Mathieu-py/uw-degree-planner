"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Chip } from "./filter/Chip";
import { CompletedCoursesInput } from "./filter/CompletedCoursesInput";
import { PrefixPicker } from "./filter/PrefixPicker";
import {
  BROWSE_QS_STORAGE_KEY,
  DEFAULT_FILTER_STATE,
  decodeFilterState,
  mergeFilterStateIntoParams,
} from "@/lib/filterState";
import { safeSetItem } from "@/lib/storage";
import type { FilterState } from "@/lib/types";

interface Props {
  state: FilterState;
  allCourseCodes: string[];
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

export function FilterPanel({ state, allCourseCodes, knownPrefixes }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  const commit = useCallback(
    (next: FilterState) => {
      // Read the live querystring so sort params (s, d) survive a filter change.
      const current = typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : new URLSearchParams();
      const qs = mergeFilterStateIntoParams(current, next).toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      safeSetItem(BROWSE_QS_STORAGE_KEY, qs);
      startTransition(() => {
        router.replace(url, { scroll: false });
      });
    },
    [pathname, router],
  );

  function patch(p: Partial<FilterState>) {
    // URL is source of truth. Reading the prop would lose changes made by a
    // prior click in the same transition (router.replace is async).
    const live = typeof window !== "undefined"
      ? decodeFilterState(new URLSearchParams(window.location.search))
      : state;
    commit({ ...live, ...p });
  }

  return (
    <aside className="flex flex-col gap-6 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Filters
        </h2>
        <button
          type="button"
          onClick={() => commit(DEFAULT_FILTER_STATE)}
          className="text-xs text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50 underline-offset-2 hover:underline"
        >
          Reset
        </button>
      </div>

      <Section title="Levels">
        <div className="flex flex-wrap gap-2">
          {LEVEL_BUCKETS.map((lvl) => {
            const active = state.levels.length === 0 || state.levels.includes(lvl);
            return (
              <Chip
                key={lvl}
                active={active}
                onClick={() => patch({ levels: toggleLevel(state.levels, lvl) })}
              >
                {lvl}
              </Chip>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {state.levels.length === 0 ? "All levels" : `${state.levels.join(", ")} only`}
        </p>
      </Section>

      <Section title="Exclude prefixes">
        <PrefixPicker
          selected={state.excludePrefixes}
          known={knownPrefixes}
          onChange={(excludePrefixes) => patch({ excludePrefixes })}
          emptyLabel="No prefixes excluded"
        />
      </Section>

      <Section title="Include only">
        <PrefixPicker
          selected={state.includePrefixes}
          known={knownPrefixes}
          onChange={(includePrefixes) => patch({ includePrefixes })}
          emptyLabel="Include all prefixes"
        />
      </Section>

      <Section title="Ratings">
        <RangeSlider
          label="Min usefulness"
          value={state.minUseful}
          onChange={(minUseful) => patch({ minUseful })}
        />
        <RangeSlider
          label="Min easiness"
          value={state.minEasy}
          onChange={(minEasy) => patch({ minEasy })}
        />
      </Section>

      <Section title="Toggles">
        <Toggle
          label="Hide courses with no seats"
          checked={state.hasSeatsAvailable}
          onChange={(hasSeatsAvailable) => patch({ hasSeatsAvailable })}
        />
        <Toggle
          label="Hide unmet prereqs"
          checked={state.hideUnmetPrereqs}
          onChange={(hideUnmetPrereqs) => patch({ hideUnmetPrereqs })}
        />
      </Section>

      <Section title="Completed courses">
        <CompletedCoursesInput
          value={state.completedCourses}
          allCourseCodes={allCourseCodes}
          onChange={(completedCourses) => patch({ completedCourses })}
        />
      </Section>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {title}
      </h3>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
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
        <span className="tabular-nums">{draftPct === 0 ? "off" : `${draftPct}%`}</span>
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

