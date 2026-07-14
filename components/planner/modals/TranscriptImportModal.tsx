"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui/Modal";
import { countNoun, pluralize } from "@/lib/format";
import { useModalExit } from "@/lib/hooks/useModalExit";
import { joinProgramNames, type TermLetter } from "@/lib/programs";
import { programMetaName } from "@/lib/programsMeta";
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
   * Called after the exit animation so the parent can unmount us. The component
   * is always "open" while mounted.
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

  // `included` = unrecognized codes the user opted IN (the bucket is excluded by
  // default to avoid polluting the completed list with placeholder rows).
  // Intersect with the current unrecognized set so a since-recategorized code
  // isn't double-counted by both the tallies and `included.size`.
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

  const detectedProgramName = joinProgramNames(
    parseResult.detectedProgramIds,
    (id) => programMetaName(id),
  );

  // Recognized total drives the headline ("N courses found …"); the unrecognized
  // bucket is opt-in and shown on its own line.
  const recognizedCount =
    categorized.passed.length +
    categorized.inProgress.length +
    categorized.transfer.length;

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
      <ModalHeader titleId="transcript-import-title" onClose={handleClose}>
        Import from transcript
      </ModalHeader>

      <div className="px-4 py-4 flex flex-col gap-4 overflow-y-auto">
        {/* The native file input is the actual control; once a file is chosen
            it's hidden and the file row's "Replace" re-triggers it. */}
        <input
          ref={fileInputRef}
          id="transcript-pdf-input"
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleFileChange}
          onClick={(e) => {
            // Clear so re-selecting the same PDF still fires onChange.
            (e.target as HTMLInputElement).value = "";
          }}
          disabled={isExtracting}
          className="sr-only"
        />

        {!fileName ? (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-line-2 bg-bg-2 px-4 py-8 text-center transition-colors hover:border-accent-bg hover:bg-accent-soft"
            >
              <span className="text-accent">
                <Icon name="upload" size="md" aria-hidden="true" />
              </span>
              <span className="text-sm font-semibold text-ink">
                Choose your Quest transcript (PDF)
              </span>
              <span className="u-small inline-flex items-center gap-1.5">
                <span className="text-met">
                  <Icon name="shield" size="xs" aria-hidden="true" />
                </span>
                Parsed in your browser · never uploaded
              </span>
            </button>
            <p className="u-small">
              Sign into Quest → Student Center → Other Academic… → Transcript:
              View Unofficial → save as PDF, then upload it here.
            </p>
          </div>
        ) : (
          <FileRow
            fileName={fileName}
            busy={isExtracting}
            onReplace={() => fileInputRef.current?.click()}
          />
        )}

        {extractError && (
          <p className="text-[13px] text-danger">{extractError}</p>
        )}

        {!isExtracting && !extractError && hasInput && !hasResults && (
          <p className="text-[13px] text-danger">
            No course codes found in the PDF — make sure you uploaded a Quest
            unofficial transcript.
          </p>
        )}

        {!isExtracting && !extractError && hasResults && (
          <div className="flex flex-col gap-4">
            <Headline
              count={recognizedCount}
              programName={detectedProgramName}
              currentTerm={parseResult.detectedCurrentTerm}
              rawPlan={parseResult.rawPlanText}
            />

            <div className="grid grid-cols-4 border border-line rounded-[11px] overflow-hidden divide-x divide-line">
              <Stat label="Passed" n={categorized.passed.length} />
              <Stat label="In progress" n={categorized.inProgress.length} />
              <Stat label="Transfer" n={categorized.transfer.length} />
              <Stat label="Skipped" n={categorized.skipped.length} muted />
            </div>

            {categorized.unrecognized.length > 0 && (
              <UnrecognizedLine
                items={categorized.unrecognized}
                included={included}
                onToggle={toggleIncluded}
              />
            )}

            {parseResult.warnings.length > 0 && (
              <div className="text-partial text-xs flex flex-col gap-1">
                {parseResult.warnings.map((w) => (
                  <p key={w} className="flex items-start gap-1.5">
                    <Icon
                      name="warning"
                      size="xs"
                      aria-hidden="true"
                      className="mt-0.5 shrink-0"
                    />
                    <span>{w}</span>
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={handleClose}>
          Cancel
        </Button>
        <Button onClick={handleApply} disabled={includedCount === 0}>
          Add {countNoun(includedCount, "course")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function FileRow({
  fileName,
  busy,
  onReplace,
}: {
  fileName: string;
  busy: boolean;
  onReplace: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 border border-line rounded-[10px] bg-bg-2">
      <span className="text-accent shrink-0">
        <Icon name="doc" size="sm" aria-hidden="true" />
      </span>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-[13px] font-semibold text-ink truncate">
          {fileName}
        </span>
        <span className="u-small inline-flex items-center gap-1.5">
          {busy ? (
            "Reading PDF…"
          ) : (
            <>
              <span className="text-met">
                <Icon name="shield" size="xs" aria-hidden="true" />
              </span>
              Parsed in your browser · never uploaded
            </>
          )}
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onReplace}
        disabled={busy}
        className="shrink-0"
      >
        Replace
      </Button>
    </div>
  );
}

function Headline({
  count,
  programName,
  currentTerm,
  rawPlan,
}: {
  count: number;
  programName: string | null | undefined;
  currentTerm: TermLetter | null;
  rawPlan: string | null;
}) {
  const programNode = programName ? (
    <b className="text-ink font-semibold">{programName}</b>
  ) : rawPlan ? (
    <span>
      <b className="text-ink font-semibold">{rawPlan}</b> (no matching program —
      pick after import)
    </span>
  ) : (
    <span>(no program detected — pick after import)</span>
  );
  const termNode = currentTerm ? (
    <>
      , through term <b className="text-ink font-semibold">{currentTerm}</b>
    </>
  ) : (
    <> (term not detected — pick after import)</>
  );
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[30px] font-bold tracking-tight leading-none tabular-nums">
        {count}
      </span>
      <span className="text-sm text-ink-2">
        {pluralize(count, "course")} found in {programNode}
        {termNode}.
      </span>
    </div>
  );
}

function Stat({
  label,
  n,
  muted = false,
}: {
  label: string;
  n: number;
  muted?: boolean;
}) {
  return (
    <div className="px-2.5 py-3 flex flex-col gap-0.5 items-start">
      <span
        className={`text-[22px] font-bold tracking-tight leading-none tabular-nums ${muted ? "text-ink-3" : "text-ink"}`}
      >
        {n}
      </span>
      <span className="text-[11px] text-ink-3 font-medium">{label}</span>
    </div>
  );
}

function UnrecognizedLine({
  items,
  included,
  onToggle,
}: {
  items: ParsedCourse[];
  included: Set<string>;
  onToggle: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const includedCount = items.filter((c) => included.has(c.code)).length;
  return (
    <div className="border border-partial bg-partial-soft rounded-[10px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between gap-2 w-full px-3 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-[12.5px]">
          <span className="text-partial inline-flex">
            <Icon name="bolt" size="xs" aria-hidden="true" />
          </span>
          <span>
            <b className="font-bold">{items.length} unrecognized codes</b> —{" "}
            {includedCount} included
          </span>
        </span>
        <span className="u-small font-semibold text-accent">
          {open ? "Hide" : "Review"}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-0.5 px-3 pb-2.5">
          {items.map((c) => (
            <label
              key={c.code}
              className="flex items-center gap-2 cursor-pointer py-[3px] text-xs"
            >
              <input
                type="checkbox"
                checked={included.has(c.code)}
                onChange={() => onToggle(c.code)}
                className="h-3.5 w-3.5 accent-accent-bg"
              />
              <span className="font-mono font-semibold">{c.code}</span>
              <span className="u-small truncate">{c.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
