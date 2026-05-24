"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ChoiceGroupEntry,
  enumerateChoiceGroups,
} from "@/lib/choiceGroups";
import { type Program, TERM_LETTERS, type TermLetter } from "@/lib/programs";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onApply: (next: Record<string, string[]>) => void;
  program: Program;
  initialSelections: Record<string, string[]>;
}

export function VariantPickerModal({
  isOpen,
  onClose,
  onApply,
  program,
  initialSelections,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [staged, setStaged] = useState<Record<string, string[]>>({});

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

  // Reseed the staging map whenever the modal opens — picks up the latest
  // committed selections, even if the parent updated `initialSelections`
  // between opens (e.g. clearing on program change).
  useEffect(() => {
    if (isOpen) setStaged({ ...initialSelections });
  }, [isOpen, initialSelections]);

  function handleClose() {
    onClose();
  }

  function handleApply() {
    // Prune empty arrays so the URL codec omits the `cgs` param when no
    // picks are made (encoder treats {} specially — see filterState.ts).
    const pruned: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(staged)) {
      if (v.length > 0) pruned[k] = v;
    }
    onApply(pruned);
  }

  function setSelection(path: string, codes: string[]) {
    setStaged((prev) => ({ ...prev, [path]: codes }));
  }

  const totalSelected = Object.values(staged).reduce(
    (sum, codes) => sum + codes.length,
    0,
  );

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
            Pick course variants — {program.name}
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

        {entries.length === 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            This program has no course variants to pick.
          </p>
        ) : (
          <>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              For each choice group below, pick which option(s) you took. Picks
              are saved with your program in the URL.
            </p>
            <div className="flex flex-col gap-4 overflow-y-auto pr-1">
              {program.kind === "engineering"
                ? TERM_LETTERS.map((t) => {
                    const inTerm = groupedByTerm.get(t);
                    if (!inTerm || inTerm.length === 0) return null;
                    return (
                      <div key={t} className="flex flex-col gap-2">
                        <h3 className="text-xs uppercase tracking-wide font-semibold text-zinc-600 dark:text-zinc-400">
                          Term {t}
                        </h3>
                        {inTerm.map((entry) => (
                          <PickerCard
                            key={entry.path}
                            entry={entry}
                            selected={staged[entry.path] ?? []}
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
                      selected={staged[entry.path] ?? []}
                      onChange={(codes) => setSelection(entry.path, codes)}
                    />
                  ))}
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={handleClose}
            className="rounded border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Cancel
          </button>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={handleApply}
              className="rounded bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900 px-3 py-1.5 text-xs font-medium"
            >
              Apply ({totalSelected} pick{totalSelected === 1 ? "" : "s"})
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
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
  onChange: (codes: string[]) => void;
}

function PickerCard({ entry, selected, onChange }: PickerCardProps) {
  const isRadio = entry.selectMax === 1;
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  return (
    <div className="flex flex-col gap-1.5 rounded border border-zinc-200 dark:border-zinc-800 p-3">
      <p className="text-xs text-zinc-700 dark:text-zinc-300">
        {entry.description}
      </p>
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
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
