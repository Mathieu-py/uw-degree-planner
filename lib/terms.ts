import type { TermId } from "./types";

/**
 * UWFlow term IDs look like `1<YY><digit>` (1261, 1265, …) but the digit's
 * meaning isn't stable across what we've observed, so we treat IDs as
 * opaque and pin season/year via this hand-maintained table.
 */
export type TermSeason = "Winter" | "Spring" | "Fall";

export interface TermInfo {
  id: TermId;
  year: number;
  season: TermSeason;
  label: string;
}

export const KNOWN_TERMS: TermInfo[] = [
  { id: 1255, year: 2025, season: "Spring", label: "Spring 2025" },
  { id: 1259, year: 2025, season: "Fall", label: "Fall 2025" },
  { id: 1261, year: 2026, season: "Winter", label: "Winter 2026" },
  { id: 1265, year: 2026, season: "Spring", label: "Spring 2026" },
  { id: 1269, year: 2026, season: "Fall", label: "Fall 2026" },
];

export function termLabel(id: TermId): string {
  return KNOWN_TERMS.find((t) => t.id === id)?.label ?? `Term ${id}`;
}
