"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { PickerFilters } from "./useFilteredCourses";

const LEVEL_BUCKETS = [100, 200, 300, 400] as const;

/**
 * Filter rail shared by the in-planner slot picker and the standalone catalog
 * page: level chips, subject-prefix exclude list, min-rating sliders, and
 * has-seats / hide-unmet toggles. The `hideUnmet` toggle is hidden on the
 * catalog (which has no target term, so eligibility isn't computed there).
 */
export function FilterSidebar({
  filters,
  knownPrefixes,
  onPatch,
  onReset,
  showHideUnmet = true,
}: {
  filters: PickerFilters;
  knownPrefixes: string[];
  onPatch: (p: Partial<PickerFilters>) => void;
  onReset: () => void;
  showHideUnmet?: boolean;
}) {
  function toggleLevel(lvl: number) {
    const cur = filters.levels;
    const expanded = cur.length === 0 ? [...LEVEL_BUCKETS] : cur;
    const next = expanded.includes(lvl)
      ? expanded.filter((l) => l !== lvl)
      : [...expanded, lvl];
    if (next.length === 0 || next.length === LEVEL_BUCKETS.length) {
      onPatch({ levels: [] });
      return;
    }
    onPatch({ levels: [...next].sort((a, b) => a - b) });
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

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-ink-3">
          Levels
        </span>
        <div className="flex flex-wrap gap-1.5">
          {LEVEL_BUCKETS.map((lvl) => {
            const active =
              filters.levels.length === 0 || filters.levels.includes(lvl);
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => toggleLevel(lvl)}
                aria-pressed={active}
                className={
                  "rounded-full border px-2.5 py-0.5 text-xs font-medium " +
                  (active
                    ? "border-primary bg-primary text-primary-ink"
                    : "border-line-2 text-ink-3 hover:text-ink")
                }
              >
                {lvl}
              </button>
            );
          })}
        </div>
      </div>

      <PrefixFilter
        title="Include prefixes"
        tone="include"
        knownPrefixes={knownPrefixes}
        selected={filters.includePrefixes}
        onChange={(includePrefixes) => onPatch({ includePrefixes })}
      />

      <PrefixFilter
        title="Exclude prefixes"
        tone="exclude"
        knownPrefixes={knownPrefixes}
        selected={filters.excludePrefixes}
        onChange={(excludePrefixes) => onPatch({ excludePrefixes })}
      />

      <RangeRow
        label="Min usefulness"
        value={filters.minUseful}
        onChange={(minUseful) => onPatch({ minUseful })}
      />
      <RangeRow
        label="Min easiness"
        value={filters.minEasy}
        onChange={(minEasy) => onPatch({ minEasy })}
      />

      <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
        <input
          type="checkbox"
          checked={filters.hasSeatsOnly}
          onChange={(e) => onPatch({ hasSeatsOnly: e.target.checked })}
          className="h-3.5 w-3.5 rounded border-line-2"
        />
        Has seats only
      </label>
      {showHideUnmet ? (
        <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filters.hideUnmetPrereqs}
            onChange={(e) => onPatch({ hideUnmetPrereqs: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-line-2"
          />
          Hide unmet prereqs
        </label>
      ) : null}
    </aside>
  );
}

/**
 * A subject-prefix allow/deny picker: tap a known prefix to add it, tap its
 * chip to remove. `tone` only changes the chip colour — gold for the include
 * (allow-list), red for the exclude (deny-list). When both lists name the same
 * prefix, the filter chain lets exclude win.
 */
function PrefixFilter({
  title,
  tone,
  knownPrefixes,
  selected,
  onChange,
}: {
  title: string;
  tone: "include" | "exclude";
  knownPrefixes: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const selectedSet = new Set(selected);
  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return knownPrefixes;
    return knownPrefixes.filter((p) => p.includes(q));
  }, [knownPrefixes, query]);

  function toggle(p: string) {
    onChange(
      selectedSet.has(p) ? selected.filter((x) => x !== p) : [...selected, p],
    );
  }

  const chipClass =
    "rounded-full px-2 py-0.5 text-[10px] font-medium " +
    (tone === "include"
      ? "bg-accent-soft text-accent"
      : "bg-danger-soft text-danger");

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-ink-3">
        {title}
      </span>
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {selected.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => toggle(p)}
              className={chipClass}
              title={`Remove ${p}`}
            >
              {p} ×
            </button>
          ))}
        </div>
      ) : null}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter prefixes…"
        className="rounded border border-line-2 bg-bg px-2 py-1 text-xs placeholder:text-ink-3 outline-none focus:border-accent-bg"
      />
      <div className="max-h-32 overflow-y-auto flex flex-wrap gap-1 mt-0.5">
        {filtered.slice(0, 50).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => toggle(p)}
            disabled={selectedSet.has(p)}
            className={
              "rounded border px-1.5 py-0.5 text-[10px] font-medium " +
              (selectedSet.has(p)
                ? "border-line text-ink-3 cursor-default"
                : "border-line-2 text-ink-2 hover:text-ink")
            }
          >
            {p}
          </button>
        ))}
      </div>
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
  const pct = Math.round((value ?? 0) * 100);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px] text-ink-2">
        <span>{label}</span>
        <span className="tabular-nums">{pct === 0 ? "off" : `${pct}%`}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={pct}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(n === 0 ? null : n / 100);
        }}
        className="accent-(--accent-bg)"
      />
    </div>
  );
}
