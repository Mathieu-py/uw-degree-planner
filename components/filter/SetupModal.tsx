"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ChoiceGroupEntry,
  enumerateChoiceGroups,
} from "@/lib/choiceGroups";
import {
  isTermLetter,
  type Program,
  TERM_LETTERS,
  type TermLetter,
} from "@/lib/programs";

export interface SetupModalApplyPayload {
  specializationId: string | null;
  currentTerm: TermLetter | null;
  choiceGroupSelections: Record<string, string[]>;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onApply: (next: SetupModalApplyPayload) => void;
  program: Program;
  initialSpecializationId: string | null;
  initialCurrentTerm: TermLetter | null;
  initialSelections: Record<string, string[]>;
  /**
   * Current completed-courses list (primary ∪ extras). Used to pre-fill
   * variant picks for any choice group that doesn't already have a committed
   * selection: an option appearing in completedCourses is auto-selected, up
   * to the group's `selectMax`.
   */
  completedCourses: string[];
}

export function SetupModal({
  isOpen,
  onClose,
  onApply,
  program,
  initialSpecializationId,
  initialCurrentTerm,
  initialSelections,
  completedCourses,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [stagedSpec, setStagedSpec] = useState<string | null>(
    initialSpecializationId,
  );
  const [stagedTerm, setStagedTerm] = useState<TermLetter | null>(
    initialCurrentTerm,
  );
  const [stagedPicks, setStagedPicks] = useState<Record<string, string[]>>({});

  // Spec doesn't yet surface its own choice groups (enumerateChoiceGroups
  // only walks program.terms/program.rules). When that's wired, `stagedSpec`
  // joins the dep list so the entries refresh live as the user changes spec.
  const entries = useMemo(() => enumerateChoiceGroups(program), [program]);
  const groupedByTerm = useMemo(() => groupByTerm(entries), [entries]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Reseed staged state every time the modal opens — picks up the latest
  // committed values even if props shifted between opens (e.g. program
  // change cleared spec/picks externally). Variant picks pre-fill from
  // completedCourses for any group without a committed selection.
  useEffect(() => {
    if (!isOpen) return;
    setStagedSpec(initialSpecializationId);
    setStagedTerm(initialCurrentTerm);
    setStagedPicks(prefillPicks(entries, initialSelections, completedCourses));
  }, [
    isOpen,
    initialSpecializationId,
    initialCurrentTerm,
    initialSelections,
    entries,
    completedCourses,
  ]);

  function handleClose() {
    onClose();
  }

  function handleApply() {
    // Prune empty arrays so the URL codec omits the `cgs` param when no
    // picks are made (encoder treats {} specially — see filterState.ts).
    const pruned: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(stagedPicks)) {
      if (v.length > 0) pruned[k] = v;
    }
    onApply({
      specializationId: stagedSpec,
      currentTerm: stagedTerm,
      choiceGroupSelections: pruned,
    });
  }

  function setSelection(path: string, codes: string[]) {
    setStagedPicks((prev) => ({ ...prev, [path]: codes }));
  }

  const totalPicks = Object.values(stagedPicks).reduce(
    (sum, codes) => sum + codes.length,
    0,
  );
  const specializations = program.specializations ?? [];
  const showTermPicker = program.kind === "engineering";

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      onCancel={(e) => {
        // Native <dialog> double-fires close on Esc otherwise.
        e.preventDefault();
        dialogRef.current?.close();
      }}
      className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 p-0 backdrop:bg-black/40 max-w-2xl w-[min(640px,calc(100vw-2rem))] max-h-[calc(100vh-4rem)]"
    >
      <div className="flex flex-col gap-4 p-5 max-h-[calc(100vh-4rem)]">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Set up your program — {program.name}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50 text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-5 overflow-y-auto pr-1">
          {specializations.length > 0 && (
            <SetupSection title="Specialization">
              <select
                value={stagedSpec ?? ""}
                onChange={(e) => setStagedSpec(e.target.value || null)}
                className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1 text-xs"
              >
                <option value="">None</option>
                {specializations.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.name}
                  </option>
                ))}
              </select>
            </SetupSection>
          )}

          {showTermPicker && (
            <SetupSection title="Current term">
              <select
                value={stagedTerm ?? ""}
                onChange={(e) =>
                  setStagedTerm(
                    isTermLetter(e.target.value) ? e.target.value : null,
                  )
                }
                className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1 text-xs"
              >
                <option value="">Select a term…</option>
                {TERM_LETTERS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </SetupSection>
          )}

          <SetupSection title="Course variants">
            {entries.length === 0 ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                This program has no course variants to pick.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {program.kind === "engineering"
                  ? TERM_LETTERS.map((t) => {
                      const inTerm = groupedByTerm.get(t);
                      if (!inTerm || inTerm.length === 0) return null;
                      return (
                        <div key={t} className="flex flex-col gap-2">
                          <h4 className="text-xs uppercase tracking-wide font-semibold text-zinc-600 dark:text-zinc-400">
                            Term {t}
                          </h4>
                          {inTerm.map((entry) => (
                            <PickerCard
                              key={entry.path}
                              entry={entry}
                              selected={stagedPicks[entry.path] ?? []}
                              completedCourses={completedCourses}
                              onChange={(codes) =>
                                setSelection(entry.path, codes)
                              }
                            />
                          ))}
                        </div>
                      );
                    })
                  : entries.map((entry) => (
                      <PickerCard
                        key={entry.path}
                        entry={entry}
                        selected={stagedPicks[entry.path] ?? []}
                        completedCourses={completedCourses}
                        onChange={(codes) => setSelection(entry.path, codes)}
                      />
                    ))}
              </div>
            )}
          </SetupSection>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={handleClose}
            className="rounded border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="rounded bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900 px-3 py-1.5 text-xs font-medium"
          >
            Apply
            {entries.length > 0
              ? ` (${totalPicks} pick${totalPicks === 1 ? "" : "s"})`
              : ""}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function SetupSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs uppercase tracking-wide font-semibold text-zinc-700 dark:text-zinc-300">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * For each pickable group, decide the initial staged selection:
 *   - If a committed selection exists and is non-empty, use it as-is.
 *   - Else, auto-select the first N (alphabetical) options that appear in
 *     completedCourses, where N = selectMax (or all matches if selectMax is
 *     undefined). Falls back to [] when nothing matches.
 *
 * This is D2 pre-fill: a student whose transcript imported COMMST192 sees it
 * pre-checked in the corresponding choice group. Over-satisfied groups
 * (multiple options in completedCourses, but selectMax forces a pick) get the
 * first match alphabetically — a hint to the user, who can swap.
 */
function prefillPicks(
  entries: ChoiceGroupEntry[],
  committed: Record<string, string[]>,
  completedCourses: string[],
): Record<string, string[]> {
  const completedSet = new Set(completedCourses);
  const out: Record<string, string[]> = {};
  for (const entry of entries) {
    const existing = committed[entry.path];
    if (existing && existing.length > 0) {
      out[entry.path] = existing;
      continue;
    }
    const matches = entry.options.filter((o) => completedSet.has(o));
    if (matches.length === 0) {
      out[entry.path] = [];
      continue;
    }
    const cap = entry.selectMax ?? matches.length;
    out[entry.path] = matches.slice(0, cap);
  }
  return out;
}

function groupByTerm(
  entries: ChoiceGroupEntry[],
): Map<TermLetter, ChoiceGroupEntry[]> {
  const out = new Map<TermLetter, ChoiceGroupEntry[]>();
  for (const entry of entries) {
    if (!entry.termLabel) continue;
    const list = out.get(entry.termLabel) ?? [];
    list.push(entry);
    out.set(entry.termLabel, list);
  }
  return out;
}

interface PickerCardProps {
  entry: ChoiceGroupEntry;
  selected: string[];
  completedCourses: string[];
  onChange: (codes: string[]) => void;
}

function PickerCard({
  entry,
  selected,
  completedCourses,
  onChange,
}: PickerCardProps) {
  const isRadio = entry.selectMax === 1;
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const completedSet = useMemo(
    () => new Set(completedCourses),
    [completedCourses],
  );
  const completedMatches = entry.options.filter((o) => completedSet.has(o));
  const isRequired = (entry.selectMin ?? 0) > 0;
  const showRequiredHint =
    isRequired && selected.length < (entry.selectMin ?? 0);
  const showOverSatisfiedHint =
    entry.selectMax !== undefined &&
    completedMatches.length > entry.selectMax &&
    selected.length === entry.selectMax;

  return (
    <div className="flex flex-col gap-1.5 rounded border border-zinc-200 dark:border-zinc-800 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-zinc-700 dark:text-zinc-300">
          {entry.description}
        </p>
        {showRequiredHint && (
          <span className="text-[10px] uppercase tracking-wide rounded bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 px-1.5 py-0.5">
            required
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {isRadio ? (
          <>
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <input
                type="radio"
                name={`pick-${entry.path}`}
                checked={selected.length === 0}
                onChange={() => onChange([])}
              />
              <span>(none)</span>
            </label>
            {entry.options.map((code) => (
              <label
                key={code}
                className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300"
              >
                <input
                  type="radio"
                  name={`pick-${entry.path}`}
                  checked={selectedSet.has(code)}
                  onChange={() => onChange([code])}
                />
                <span className="font-mono uppercase">{code}</span>
                {completedSet.has(code) && (
                  <span className="text-[10px] text-emerald-700 dark:text-emerald-400">
                    in completed
                  </span>
                )}
              </label>
            ))}
          </>
        ) : (
          entry.options.map((code) => {
            const isChecked = selectedSet.has(code);
            const capReached =
              entry.selectMax !== undefined &&
              selected.length >= entry.selectMax &&
              !isChecked;
            return (
              <label
                key={code}
                className={`flex items-center gap-2 text-xs ${capReached ? "text-zinc-400 dark:text-zinc-600" : "text-zinc-700 dark:text-zinc-300"}`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={capReached}
                  onChange={() => {
                    if (isChecked) {
                      onChange(selected.filter((c) => c !== code));
                    } else if (!capReached) {
                      onChange([...selected, code]);
                    }
                  }}
                />
                <span className="font-mono uppercase">{code}</span>
                {completedSet.has(code) && (
                  <span className="text-[10px] text-emerald-700 dark:text-emerald-400">
                    in completed
                  </span>
                )}
              </label>
            );
          })
        )}
      </div>
      {showOverSatisfiedHint && (
        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
          You took {completedMatches.length} of these; pick which counts.
        </p>
      )}
    </div>
  );
}
