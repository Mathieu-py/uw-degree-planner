import { termLabel } from "@/lib/terms";
import type { LocalPlan, Stream } from "./types";

/**
 * Human label for a co-op stream. Spells out "(no co-op)" for regular —
 * distinct from STREAM_OPTIONS' short segmented-control labels.
 */
export function streamLabel(stream: Stream): string {
  if (stream === "stream4") return "Stream 4 co-op";
  if (stream === "stream8") return "Stream 8 co-op";
  return "Regular (no co-op)";
}

/** One-line plan summary: stream · start term · slot count. */
export function planSubtitle(plan: LocalPlan): string {
  const start = plan.startTermId
    ? termLabel(plan.startTermId)
    : "no start term";
  return `${streamLabel(plan.stream)} · ${start} · ${plan.slots.length} slots`;
}
