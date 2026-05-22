"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PROGRAMS, type TermLetter } from "@/lib/programs";
import {
  buildImportPayload,
  type Categorized,
  categorize,
  type TranscriptImportPayload,
} from "@/lib/transcript/applyHelpers";
import { type ParsedCourse, parseTranscript } from "@/lib/transcript/parse";
import { extractTextFromPdf } from "@/lib/transcript/pdfText";

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [included, setIncluded] = useState<Set<string>>(new Set());

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setExtractError(null);
    setText("");
    setIncluded(new Set());
    setIsExtracting(true);
    try {
      const extracted = await extractTextFromPdf(file);
      setText(extracted);
    } catch (err) {
      setExtractError(
        err instanceof Error ? err.message : "Failed to read PDF.",
      );
    } finally {
      setIsExtracting(false);
    }
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Reset internal state on close so a stale upload doesn't leak into the
  // next open. Driven by user action (Cancel / Esc / Apply), not a render
  // effect. Also clear the file input so re-selecting the same file fires
  // an onChange.
  function handleClose() {
    setText("");
    setFileName(null);
    setExtractError(null);
    setIncluded(new Set());
    if (fileInputRef.current) fileInputRef.current.value = "";
    onClose();
  }

  const parseResult = useMemo(() => parseTranscript(text), [text]);
  const catalog = useMemo(() => new Set(allCourseCodes), [allCourseCodes]);
  const categorized = useMemo<Categorized>(
    () => categorize(parseResult, catalog),
    [parseResult, catalog],
  );

  // `included` is the set of unrecognized codes the user has opted IN. The
  // unrecognized bucket is excluded by default (Commit 4) because most
  // unrecognized entries are placeholder rows or codes the user actually
  // doesn't want as completed courses; check-to-include avoids silently
  // polluting the completed-courses list.
  //
  // Intersect with the currently-unrecognized codes: a code in `included`
  // that has since been re-categorized (e.g. catalog updated, parse re-ran)
  // would otherwise be double-counted by the passed/inProgress/transfer
  // tallies AND `included.size`.
  const unrecognizedCodes = new Set(
    categorized.unrecognized.map((c) => c.code),
  );
  const includedFromUnrecognized = [...included].filter((code) =>
    unrecognizedCodes.has(code),
  ).length;
  const includedCount =
    categorized.passed.length +
    categorized.inProgress.length +
    categorized.transfer.length +
    includedFromUnrecognized;

  const detectedProgramName = parseResult.detectedProgramId
    ? PROGRAMS[parseResult.detectedProgramId]?.name
    : null;

  function toggleIncluded(code: string) {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  // Esc fires `cancel` AND then `close` on <dialog>. Wiring both events to
  // handleClose would run it twice. preventDefault() on cancel suppresses
  // the native close, then we trigger it programmatically so only the
  // `close` event reaches handleClose.
  function handleCancel(e: React.SyntheticEvent<HTMLDialogElement>) {
    e.preventDefault();
    dialogRef.current?.close();
  }

  function handleApply() {
    onApply(buildImportPayload(parseResult, categorized, included));
    setText("");
    setFileName(null);
    setExtractError(null);
    setIncluded(new Set());
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const hasInput = text.trim().length > 0;
  const hasResults = parseResult.courses.length > 0;

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      onCancel={handleCancel}
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

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="transcript-pdf-input"
            className="text-xs text-zinc-600 dark:text-zinc-400"
          >
            Quest unofficial transcript (PDF)
          </label>
          <input
            ref={fileInputRef}
            id="transcript-pdf-input"
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleFileChange}
            disabled={isExtracting}
            className="block w-full text-xs text-zinc-700 dark:text-zinc-300 file:mr-3 file:rounded file:border file:border-zinc-300 dark:file:border-zinc-700 file:bg-zinc-100 dark:file:bg-zinc-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-900 dark:file:text-zinc-100 file:cursor-pointer hover:file:bg-zinc-200 dark:hover:file:bg-zinc-800 disabled:opacity-50"
          />
          {fileName && !isExtracting && !extractError && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {fileName}
            </p>
          )}
        </div>

        <div className="text-xs">
          {isExtracting && (
            <p className="text-zinc-500 dark:text-zinc-400">Reading PDF…</p>
          )}

          {extractError && (
            <p className="text-rose-600 dark:text-rose-400">{extractError}</p>
          )}

          {!isExtracting && !extractError && !hasInput && (
            <p className="text-zinc-500 dark:text-zinc-400">
              Sign into Quest → Student Center → Other Academic… → Transcript:
              View Unofficial → save as PDF, then upload it here.
            </p>
          )}

          {!isExtracting && !extractError && hasInput && !hasResults && (
            <p className="text-rose-600 dark:text-rose-400">
              No course codes found in the PDF — make sure you uploaded a Quest
              unofficial transcript.
            </p>
          )}

          {!isExtracting && !extractError && hasResults && (
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
                  included={included}
                  onToggle={toggleIncluded}
                />
              )}

              {parseResult.warnings.length > 0 && (
                <div className="text-amber-700 dark:text-amber-400 text-xs">
                  {parseResult.warnings.map((w) => (
                    <p key={w}>⚠ {w}</p>
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
  included,
  onToggle,
}: {
  items: ParsedCourse[];
  included: Set<string>;
  onToggle: (code: string) => void;
}) {
  return (
    <details open className="text-amber-700 dark:text-amber-400">
      <summary className="cursor-pointer select-none">
        ⚠ Unrecognized codes ({items.length}) — check to include
      </summary>
      <ul className="mt-1 ml-4 space-y-1">
        {items.map((c) => (
          <li key={c.code}>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={included.has(c.code)}
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
