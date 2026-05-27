"use client";

import { type ReactNode, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { useModalExit } from "@/lib/hooks/useModalExit";
import { PROGRAMS, type TermLetter } from "@/lib/programs";
import {
  type Categorized,
  categorize,
  type ParsedCourse,
  parseTranscript,
} from "@/lib/transcript/parse";
import { extractTextFromPdf } from "@/lib/transcript/pdfText";
import type { TranscriptParseResult } from "@/lib/transcript/types";

interface Props {
  /**
   * Called after the exit animation completes so the parent can unmount
   * us. Mount/unmount is driven by the parent's conditional render — this
   * component is always considered "open" while mounted.
   */
  onClose: () => void;
  /** Hands the parsed transcript to the planner to build a `LocalPlan`. */
  onApplyPlan: (
    parseResult: TranscriptParseResult,
    includedUnrecognized: ReadonlySet<string>,
  ) => void;
  /** Catalog codes used to flag "unrecognized" courses in the parse result. */
  catalogCodes: ReadonlySet<string>;
}

export function TranscriptImportModal({
  onClose,
  onApplyPlan,
  catalogCodes,
}: Props) {
  const { isClosing, handleClose } = useModalExit(onClose);
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

  const parseResult = useMemo(() => parseTranscript(text), [text]);
  const categorized = useMemo<Categorized>(
    () => categorize(parseResult, catalogCodes),
    [parseResult, catalogCodes],
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

  function handleApply() {
    onApplyPlan(parseResult, included);
    handleClose();
  }

  const hasInput = text.trim().length > 0;
  const hasResults = parseResult.courses.length > 0;

  return (
    <Modal
      isClosing={isClosing}
      onClose={handleClose}
      titleId="transcript-import-title"
      className="max-w-2xl"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <h2 id="transcript-import-title" className="text-sm font-semibold">
            Import from transcript
          </h2>
          <Button variant="icon" onClick={handleClose} aria-label="Close">
            <Icon name="close" size="sm" aria-hidden="true" />
          </Button>
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
                  title={
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="check" size="xs" aria-hidden="true" />
                      Passed ({categorized.passed.length})
                    </span>
                  }
                  items={categorized.passed}
                />
              )}
              {categorized.inProgress.length > 0 && (
                <CategoryDetails
                  title={
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="check" size="xs" aria-hidden="true" />
                      In-progress ({categorized.inProgress.length})
                    </span>
                  }
                  items={categorized.inProgress}
                />
              )}
              {categorized.transfer.length > 0 && (
                <CategoryDetails
                  title={
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="check" size="xs" aria-hidden="true" />
                      Transfer credit ({categorized.transfer.length})
                    </span>
                  }
                  items={categorized.transfer}
                />
              )}
              {categorized.skipped.length > 0 && (
                <CategoryDetails
                  title={
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="close" size="xs" aria-hidden="true" />
                      Skipped (failed/withdrawn) ({categorized.skipped.length})
                    </span>
                  }
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
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={includedCount === 0}>
            Apply {includedCount} course{includedCount === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
    </Modal>
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
  title: ReactNode;
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
