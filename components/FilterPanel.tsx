"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Chip } from "./filter/Chip";
import { CompletedCoursesInput } from "./filter/CompletedCoursesInput";
import { PrefixPicker } from "./filter/PrefixPicker";
import {
  TranscriptImportModal,
  type TranscriptImportPayload,
} from "./filter/TranscriptImportModal";
import { rebaseCompletedCourses } from "@/lib/completedCourses";
import { applyTranscriptToFilterState } from "@/lib/transcript/applyHelpers";
import {
  BROWSE_QS_STORAGE_KEY,
  DEFAULT_FILTER_STATE,
  decodeFilterState,
  mergeFilterStateIntoParams,
} from "@/lib/filterState";
import {
  PROGRAMS,
  TERM_LETTERS,
  type TermLetter,
  hasSchedule,
  isTermLetter,
} from "@/lib/programs";
import { safeSetItem } from "@/lib/storage";
import type { FilterState } from "@/lib/types";

interface Props {
  state: FilterState;
  completedCourses: string[];
  onCompletedChange: (next: string[]) => void;
  allCourseCodes: string[];
  knownPrefixes: string[];
}

const LEVEL_BUCKETS = [100, 200, 300, 400] as const;

// Only programs with a real per-term required-course list are useful seeds.
// The scraper emits empties for programs whose Kuali entry lacks a term-by-
// term schedule (most non-Engineering majors) — hiding them avoids a silent
// no-op when the user picks one.
const SORTED_PROGRAMS_WITH_SCHEDULE = Object.entries(PROGRAMS)
  .filter(([, p]) => hasSchedule(p))
  .sort(([, a], [, b]) => a.name.localeCompare(b.name));

// state.levels === [] means "all four buckets". Selecting all four (or none) collapses back to [].
function toggleLevel(current: readonly number[], lvl: number): number[] {
  const expanded = current.length === 0 ? [...LEVEL_BUCKETS] : current;
  const next = expanded.includes(lvl)
    ? expanded.filter((l) => l !== lvl)
    : [...expanded, lvl];
  if (next.length === 0 || next.length === LEVEL_BUCKETS.length) return [];
  return [...next].sort((a, b) => a - b);
}

export function FilterPanel({
  state,
  completedCourses,
  onCompletedChange,
  allCourseCodes,
  knownPrefixes,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [transcriptModalOpen, setTranscriptModalOpen] = useState(false);

  const completedCoursesRef = useRef(completedCourses);
  useEffect(() => {
    completedCoursesRef.current = completedCourses;
  }, [completedCourses]);

  const commit = useCallback(
    (next: FilterState) => {
      // Read the live querystring so sort params (s, d) survive a filter change.
      const current = typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : new URLSearchParams();
      const merged = mergeFilterStateIntoParams(current, next);
      merged.delete("p");
      const qs = merged.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      safeSetItem(BROWSE_QS_STORAGE_KEY, qs);
      startTransition(() => {
        router.replace(url, { scroll: false });
      });
    },
    [pathname, router],
  );

  // URL is source of truth. Reading the prop would lose changes made by a
  // prior click in the same transition (router.replace is async). The updater
  // form lets callers derive the next state from the live one — required for
  // toggles like level chips where the input depends on the current value.
  function patch(p: Partial<FilterState> | ((live: FilterState) => Partial<FilterState>)) {
    const live = typeof window !== "undefined"
      ? decodeFilterState(new URLSearchParams(window.location.search))
      : state;
    const delta = typeof p === "function" ? p(live) : p;
    const next = { ...live, ...delta };

    // Prog/term changes shift the inferred baseline; rebase the user's list
    // through the new baseline so the table updates immediately. Source the
    // live list from the prop (localStorage-backed) — `live.completedCourses`
    // from the URL decoder is always [].
    if (delta.programId !== undefined || delta.currentTerm !== undefined) {
      onCompletedChange(
        rebaseCompletedCourses(
          { ...live, completedCourses: completedCoursesRef.current },
          next.programId,
          next.currentTerm,
        ),
      );
    }

    commit(next);
  }

  // The transcript IS the source of truth — skip the prog/term rebase that
  // `patch` would do. Decode the live URL, merge the payload's prog/term in,
  // commit to the URL, and replace completedCourses in localStorage.
  function handleTranscriptApply(payload: TranscriptImportPayload) {
    const live =
      typeof window !== "undefined"
        ? decodeFilterState(new URLSearchParams(window.location.search))
        : state;
    const next = applyTranscriptToFilterState(live, payload);
    commit(next);
    onCompletedChange(payload.codes);
    setTranscriptModalOpen(false);
  }

  return (
    <aside className="flex flex-col gap-6 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Filters
        </h2>
        <button
          type="button"
          onClick={() => patch(DEFAULT_FILTER_STATE)}
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
                onClick={() => patch((live) => ({ levels: toggleLevel(live.levels, lvl) }))}
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

      <Section title="Program & term">
        <ProgramSeeder state={state} patch={patch} />
      </Section>

      <Section title="Completed courses">
        <CompletedCoursesInput
          value={completedCourses}
          allCourseCodes={allCourseCodes}
          onChange={onCompletedChange}
        />
        <button
          type="button"
          onClick={() => setTranscriptModalOpen(true)}
          className="self-start rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          ↗ Upload transcript (PDF)
        </button>
      </Section>

      <TranscriptImportModal
        isOpen={transcriptModalOpen}
        onClose={() => setTranscriptModalOpen(false)}
        onApply={handleTranscriptApply}
        allCourseCodes={allCourseCodes}
        currentCompletedCount={completedCourses.length}
      />
    </aside>
  );
}

function ProgramSeeder({
  state,
  patch,
}: {
  state: FilterState;
  patch: (p: Partial<FilterState>) => void;
}) {
  const selectedProgram = state.programId ? PROGRAMS[state.programId] : null;
  const term = isTermLetter(state.currentTerm) ? state.currentTerm : null;

  // If the selected program isn't in the schedule-having set (e.g. a stale URL
  // like ?prog=3g-anthropology, or a slug that pre-dated the catalog refresh),
  // surface it as a pinned option so the user can see and clear it. Without
  // this, <select> with an unknown value would render as empty.
  const selectedNotInList =
    selectedProgram &&
    !SORTED_PROGRAMS_WITH_SCHEDULE.some(([id]) => id === state.programId);

  const selectClass =
    "w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1 text-xs";

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-zinc-600 dark:text-zinc-400">Program</span>
        <select
          value={state.programId ?? ""}
          onChange={(e) => patch({ programId: e.target.value || null })}
          className={selectClass}
        >
          <option value="">Select a program…</option>
          {selectedNotInList && state.programId && (
            <option value={state.programId}>
              {selectedProgram.name} (no schedule data)
            </option>
          )}
          {SORTED_PROGRAMS_WITH_SCHEDULE.map(([id, p]) => (
            <option key={id} value={id}>{p.name}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-zinc-600 dark:text-zinc-400">Current term</span>
        <select
          value={term ?? ""}
          onChange={(e) =>
            patch({ currentTerm: isTermLetter(e.target.value) ? e.target.value : null })
          }
          className={selectClass}
        >
          <option value="">Select a term…</option>
          {TERM_LETTERS.map((t: TermLetter) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>

      {selectedProgram && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Sourced from UW calendar (as of {selectedProgram.asOf}).
        </p>
      )}
    </div>
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

