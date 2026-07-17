"use client";

import { useState } from "react";
import type { TermId } from "@/lib/terms";
import { defaultStreamFor } from "./defaultStream";
import type { Stream } from "./types";

/**
 * Owns a plan's co-op stream plus the "suggest the program default unless the
 * user touched it" rule shared by onboarding and plan settings.
 * `suggestForPrograms` runs on a program change; a manual pick via
 * `setStreamManually` — or an explicit `locked` (e.g. a transcript already set
 * the stream) — stops future suggestions.
 */
export function useStreamSuggestion(initialStream: Stream) {
  const [stream, setStream] = useState<Stream>(initialStream);
  const [streamTouched, setStreamTouched] = useState(false);

  function setStreamManually(next: Stream) {
    setStream(next);
    setStreamTouched(true);
  }

  function suggestForPrograms(
    programIds: readonly string[],
    startTermId: TermId | null | undefined,
    locked = false,
  ) {
    if (streamTouched || locked) return;
    // Null default = no program to key on → leave the stream untouched.
    const suggested = defaultStreamFor(programIds, startTermId);
    if (suggested) setStream(suggested);
  }

  return {
    stream,
    setStream,
    streamTouched,
    setStreamManually,
    suggestForPrograms,
  };
}
