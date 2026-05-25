"use client";

import { useMemo, useState } from "react";
import type { Stream } from "@/lib/plan/types";
import { KNOWN_TERMS, makeTermId } from "@/lib/terms";
import type { ProgramOption } from "./PlannerShell";

interface Props {
  programOptions: ProgramOption[];
  onCreate: (params: {
    programId: string;
    startTermId: number;
    stream: Stream;
  }) => void;
  onUploadTranscript: () => void;
  /** While true, all create-flow buttons are disabled so a double-click
   * during the network round-trip can't spawn duplicate server plans. */
  busy?: boolean;
}

const STREAM_LABELS: Array<{ value: Stream; label: string }> = [
  { value: "regular", label: "Regular (no co-op)" },
  { value: "stream4", label: "Stream 4 co-op (January start)" },
  { value: "stream8", label: "Stream 8 co-op (May start)" },
];

const INPUT =
  "w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm";

export function EmptyState({
  programOptions,
  onCreate,
  onUploadTranscript,
  busy = false,
}: Props) {
  const fallTerms = useMemo(
    () => KNOWN_TERMS.filter((t) => t.season === "Fall"),
    [],
  );
  const [programId, setProgramId] = useState<string>(
    programOptions[0]?.id ?? "",
  );
  // Default to the current calendar year's Fall term if KNOWN_TERMS covers it;
  // otherwise fall back to the first available Fall option so the controlled
  // <select>'s value always matches an actual <option>.
  const [startTermId, setStartTermId] = useState<number>(() => {
    const currentFall = makeTermId(new Date().getFullYear(), "Fall");
    if (fallTerms.some((t) => t.id === currentFall)) return currentFall;
    return fallTerms[0]?.id ?? currentFall;
  });
  const [stream, setStream] = useState<Stream>("regular");

  const canSubmit = programId && startTermId > 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-900/40 px-6 py-8 flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Upload your Quest transcript</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-xl">
          Get an instant degree plan with every past term pre-filled. The PDF is
          parsed locally in your browser; nothing is uploaded.
        </p>
        <button
          type="button"
          onClick={onUploadTranscript}
          disabled={busy}
          className="self-start rounded bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 text-sm font-medium px-4 py-2 disabled:opacity-50"
        >
          Upload transcript
        </button>
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-6 py-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Or set up manually</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Pick your program, start term, and co-op stream to scaffold an empty
            plan. You can fill the slots in as you go.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              Program
            </span>
            <select
              className={INPUT}
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
            >
              {programOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              Start term (1A)
            </span>
            <select
              className={INPUT}
              value={startTermId}
              onChange={(e) => setStartTermId(Number(e.target.value))}
            >
              {fallTerms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              Co-op stream
            </span>
            <select
              className={INPUT}
              value={stream}
              onChange={(e) => setStream(e.target.value as Stream)}
            >
              {STREAM_LABELS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="button"
          disabled={!canSubmit || busy}
          onClick={() =>
            canSubmit && !busy && onCreate({ programId, startTermId, stream })
          }
          className="self-start rounded bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 text-sm font-medium px-4 py-2 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create empty plan"}
        </button>
      </div>
    </div>
  );
}
