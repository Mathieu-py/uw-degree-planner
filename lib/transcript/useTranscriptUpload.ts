"use client";

import { useCallback, useState } from "react";
import { logError } from "@/lib/log";
import { parseTranscript } from "./parse";
import { extractTextFromPdf } from "./pdfText";
import type { TranscriptParseResult } from "./types";

/**
 * Shared client-side transcript intake: PDF → text → parse, plus the busy/error
 * state the onboarding flow and the import modal both need. `parseResult` is
 * null until a file lands.
 *
 * `onParsed` runs after a successful extract+parse, for caller-specific side
 * effects (e.g. syncing the detected program/stream).
 */
export function useTranscriptUpload(
  onParsed?: (result: TranscriptParseResult) => void,
) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<TranscriptParseResult | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setFileName(file.name);
      setError(null);
      setParseResult(null);
      setBusy(true);
      try {
        const result = parseTranscript(await extractTextFromPdf(file));
        setParseResult(result);
        onParsed?.(result);
      } catch (err) {
        // No filename/transcript content in telemetry — only the operation.
        logError("Transcript PDF extraction failed:", err, {
          op: "transcript.extract",
          category: "client",
        });
        // extractTextFromPdf throws actionable messages — surface them verbatim.
        setError(
          err instanceof Error
            ? err.message
            : "Couldn't read that PDF. Try a Quest transcript export.",
        );
      } finally {
        setBusy(false);
      }
    },
    [onParsed],
  );

  const reset = useCallback(() => {
    setFileName(null);
    setParseResult(null);
    setError(null);
  }, []);

  return { fileName, parseResult, busy, error, onFile, reset };
}
