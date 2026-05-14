import type { TermId } from "~/types";

/**
 * UWaterloo term IDs follow the format `1<YY><N>` where N is:
 *   1 = Winter, 5 = Spring, 9 = Fall
 * So 1261 = Spring 2026 (year 26, term digit 5? Actually...)
 *
 * Empirically observed in UWFlow:
 *   1255 = Spring 2025
 *   1259 = Fall 2025
 *   1261 = Winter 2026     <-- but our legacy script calls this "Spring 2026"
 *   1265 = Spring 2026
 *
 * Until we confirm the formula, treat term IDs as opaque tokens with a
 * human label looked up from this table.
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
