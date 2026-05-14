"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  DEFAULT_FILTER_STATE,
  FILTER_STORAGE_KEY,
  encodeFilterState,
} from "@/lib/filterState";
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
      const qs = encodeFilterState(next).toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(FILTER_STORAGE_KEY, qs);
      }
      startTransition(() => {
        router.replace(url, { scroll: false });
      });
    },
    [pathname, router],
  );

  function patch(p: Partial<FilterState>) {
    commit({ ...state, ...p });
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
          label="Hide unmet prereqs (substring check)"
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

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors ${
        active
          ? "bg-zinc-950 text-white border-zinc-950 dark:bg-zinc-50 dark:text-zinc-950 dark:border-zinc-50"
          : "bg-transparent text-zinc-600 border-zinc-300 hover:bg-zinc-100 dark:text-zinc-400 dark:border-zinc-700 dark:hover:bg-zinc-900"
      }`}
    >
      {children}
    </button>
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

  // Pick up external URL/state changes (Reset button, shared link).
  useEffect(() => {
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

function PrefixPicker({
  selected,
  known,
  onChange,
  emptyLabel,
}: {
  selected: string[];
  known: string[];
  onChange: (next: string[]) => void;
  emptyLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");

  function toggle(prefix: string) {
    const p = prefix.toUpperCase();
    onChange(selected.includes(p) ? selected.filter((s) => s !== p) : [...selected, p].sort());
  }

  function remove(prefix: string) {
    onChange(selected.filter((s) => s !== prefix));
  }

  function addCustom() {
    const p = custom.trim().toUpperCase();
    if (!p || selected.includes(p)) {
      setCustom("");
      return;
    }
    onChange([...selected, p].sort());
    setCustom("");
  }

  return (
    <div className="flex flex-col gap-2">
      {selected.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{emptyLabel}</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {selected.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => remove(p)}
              className="inline-flex items-center gap-1 rounded-full bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 px-2 py-0.5 text-xs font-medium font-mono"
              title={`Remove ${p}`}
            >
              {p}
              <span className="text-zinc-400 dark:text-zinc-500">×</span>
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="self-start text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-50 underline-offset-2 hover:underline"
      >
        {open ? "Hide picker" : "Pick from known prefixes…"}
      </button>

      {open && (
        <div className="max-h-48 overflow-y-auto rounded border border-zinc-200 dark:border-zinc-800 p-2 flex flex-wrap gap-1">
          {known.map((p) => (
            <Chip key={p} active={selected.includes(p)} onClick={() => toggle(p)}>
              <span className="font-mono">{p}</span>
            </Chip>
          ))}
        </div>
      )}

      <div className="flex gap-1">
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder="Add prefix (e.g. PHIL)…"
          className="flex-1 min-w-0 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1 text-xs uppercase placeholder:normal-case placeholder:text-zinc-400"
        />
        <button
          type="button"
          onClick={addCustom}
          disabled={custom.trim() === ""}
          className="rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs disabled:opacity-40 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function CompletedCoursesInput({
  value,
  allCourseCodes,
  onChange,
}: {
  value: string[];
  allCourseCodes: string[];
  onChange: (next: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const knownCodes = useMemo(() => new Set(allCourseCodes), [allCourseCodes]);

  function add() {
    const code = input.trim().toLowerCase();
    if (!code) {
      setError(null);
      return;
    }
    if (value.includes(code)) {
      setInput("");
      setError(null);
      return;
    }
    if (!knownCodes.has(code)) {
      setError(`"${code}" isn't in this term's catalog.`);
      return;
    }
    onChange([...value, code]);
    setInput("");
    setError(null);
  }

  function remove(code: string) {
    onChange(value.filter((c) => c !== code));
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => remove(c)}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200 px-2 py-0.5 text-xs font-medium font-mono"
              title={`Remove ${c}`}
            >
              {c}
              <span className="opacity-60">×</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-1">
        <input
          type="text"
          list="all-course-codes"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add course (e.g. math116)…"
          className="flex-1 min-w-0 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1 text-xs placeholder:text-zinc-400"
        />
        <button
          type="button"
          onClick={add}
          disabled={input.trim() === ""}
          className="rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs disabled:opacity-40 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          Add
        </button>
      </div>
      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}
      <datalist id="all-course-codes">
        {allCourseCodes.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}
