// Percentage cutoffs for the rating-dot buckets: ≥70% reads as "good" (green),
// ≥50% as "mixed" (amber), below as "poor" (red).
const GOOD_PCT = 70;
const MIXED_PCT = 50;

// Shared bucketing for the small rating dots shown in the catalog and on the
// course detail page. `value` is a 0–1 ratio (or null/undefined when missing).
export function getRatingColor(
  value: number | null | undefined,
): "bg-missing" | "bg-met" | "bg-partial" | "bg-danger" {
  if (value == null) return "bg-missing";
  const pct = Math.round(value * 100);
  if (pct >= GOOD_PCT) return "bg-met";
  if (pct >= MIXED_PCT) return "bg-partial";
  return "bg-danger";
}
