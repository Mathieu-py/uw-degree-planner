"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PROGRAMS, type TermLetter } from "@/lib/programs";
import {
  buildImportPayload,
  categorize,
  type Categorized,
  type TranscriptImportPayload,
} from "@/lib/transcript/applyHelpers";
import {
  parseTranscript,
  type ParsedCourse,
} from "@/lib/transcript/parse";

export type { TranscriptImportPayload } from "@/lib/transcript/applyHelpers";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onApply: (payload: TranscriptImportPayload) => void;
  allCourseCodes: string[];
  currentCompletedCount: number;
}

export function TranscriptImportModal({
  isOpen,
  onClose,
  onApply,
  allCourseCodes,
  currentCompletedCount,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Reset internal state on close so a stale paste doesn't leak into the next
  // open. Driven by user action (Cancel / Esc / Apply), not a render effect.
  function handleClose() {
    setText("");
    setExcluded(new Set());
    onClose();
  }

  const parseResult = useMemo(() => parseTranscript(text), [text]);
  const catalog = useMemo(() => new Set(allCourseCodes), [allCourseCodes]);
  const categorized = useMemo<Categorized>(
    () => categorize(parseResult, catalog),
    [parseResult, catalog],
  );

  // Set of unrecognized codes the user has opted to INCLUDE. Today (Commit 3)
  // the default is "all included unless excluded"; Commit 4 flips this to
  // "all excluded unless included". Stored as a Set for fast membership.
  const includedUnrecognizedSet = useMemo(
    () =>
      new Set(
        categorized.unrecognized
          .map((c) => c.code)
          .filter((code) => !excluded.has(code)),
      ),
    [categorized.unrecognized, excluded],
  );
  const includedCount =
    categorized.passed.length +
    categorized.inProgress.length +
    categorized.transfer.length +
    includedUnrecognizedSet.size;

  const detectedProgramName = parseResult.detectedProgramId
    ? PROGRAMS[parseResult.detectedProgramId]?.name
    : null;

  function toggleExcluded(code: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function handleApply() {
    onApply(buildImportPayload(parseResult, categorized, includedUnrecognizedSet));
    setText("");
    setExcluded(new Set());
  }

  const hasInput = text.trim().length > 0;
  const hasResults = parseResult.courses.length > 0;

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      onCancel={handleClose}
      className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 p-0 backdrop:bg-black/40 max-w-2xl w-[min(640px,calc(100vw-2rem))]"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Import from transcript</h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50 text-lg leading-none"
          >
            ×
          </button>
        </div>

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Parsed in your browser. Never sent anywhere.
        </p>

        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste your Quest unofficial transcript here…"
          rows={10}
          className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs font-mono placeholder:text-zinc-400 resize-y"
        />

        <div className="text-xs">
          {!hasInput && (
            <p className="text-zinc-500 dark:text-zinc-400">
              Paste your Quest unofficial transcript above.
            </p>
          )}

          {hasInput && !hasResults && (
            <p className="text-rose-600 dark:text-rose-400">
              No course codes found — make sure you pasted from Quest&apos;s
              unofficial transcript.
            </p>
          )}

          {hasResults && (
            <div className="flex flex-col gap-2">
              <DetectionLine
                programName={detectedProgramName}
                currentTerm={parseResult.detectedCurrentTerm}
                rawPlan={parseResult.rawPlanText}
              />

              {categorized.passed.length > 0 && (
                <CategoryDetails
                  title={`✓ Passed (${categorized.passed.length})`}
                  items={categorized.passed}
                />
              )}
              {categorized.inProgress.length > 0 && (
                <CategoryDetails
                  title={`✓ In-progress (${categorized.inProgress.length})`}
                  items={categorized.inProgress}
                />
              )}
              {categorized.transfer.length > 0 && (
                <CategoryDetails
                  title={`✓ Transfer credit (${categorized.transfer.length})`}
                  items={categorized.transfer}
                />
              )}
              {categorized.skipped.length > 0 && (
                <CategoryDetails
                  title={`✗ Skipped (failed/withdrawn) (${categorized.skipped.length})`}
                  items={categorized.skipped}
                  muted
                />
              )}
              {categorized.unrecognized.length > 0 && (
                <UnrecognizedDetails
                  items={categorized.unrecognized}
                  excluded={excluded}
                  onToggle={toggleExcluded}
                />
              )}

              {parseResult.warnings.length > 0 && (
                <div className="text-amber-700 dark:text-amber-400 text-xs">
                  {parseResult.warnings.map((w, i) => (
                    <p key={i}>⚠ {w}</p>
                  ))}
                </div>
              )}

              {currentCompletedCount > 0 && (
                <p className="text-amber-700 dark:text-amber-400">
                  ⚠ Replaces your current {currentCompletedCount} completed
                  course{currentCompletedCount === 1 ? "" : "s"}.
                </p>
              )}
            </div>
          )}
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
            disabled={includedCount === 0}
            className="rounded bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900 px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          >
            Apply {includedCount} course{includedCount === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function DetectionLine({
  programName,
  currentTerm,
  rawPlan,
}: {
  programName: string | null | undefined;
  currentTerm: TermLetter | null;
  rawPlan: string | null;
}) {
  const programPart = programName
    ? programName
    : rawPlan
      ? `${rawPlan} (no matching program — pick after import)`
      : "(no program detected — pick after import)";
  const termPart = currentTerm
    ? `term ${currentTerm}`
    : "(term not detected — pick after import)";
  return (
    <p className="text-zinc-700 dark:text-zinc-300">
      Detected: <span className="font-medium">{programPart}</span> — {termPart}
    </p>
  );
}

function CategoryDetails({
  title,
  items,
  muted = false,
}: {
  title: string;
  items: ParsedCourse[];
  muted?: boolean;
}) {
  return (
    <details
      className={
        muted
          ? "text-zinc-500 dark:text-zinc-500"
          : "text-zinc-700 dark:text-zinc-300"
      }
    >
      <summary className="cursor-pointer select-none">{title}</summary>
      <ul className="mt-1 ml-4 list-disc text-xs space-y-0.5">
        {items.map((c) => (
          <li key={c.code} className="font-mono">
            {c.code}
            <span className="ml-2 font-sans text-zinc-500 dark:text-zinc-400">
              {c.name}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function UnrecognizedDetails({
  items,
  excluded,
  onToggle,
}: {
  items: ParsedCourse[];
  excluded: Set<string>;
  onToggle: (code: string) => void;
}) {
  return (
    <details open className="text-amber-700 dark:text-amber-400">
      <summary className="cursor-pointer select-none">
        ⚠ Unrecognized codes ({items.length}) — review
      </summary>
      <ul className="mt-1 ml-4 space-y-1">
        {items.map((c) => (
          <li key={c.code}>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!excluded.has(c.code)}
                onChange={() => onToggle(c.code)}
                className="h-3.5 w-3.5"
              />
              <span className="font-mono text-xs">{c.code}</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {c.name}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </details>
  );
}
