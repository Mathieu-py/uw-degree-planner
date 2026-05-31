// Shared bucketing for the small rating dots shown in the catalog and on the
// course detail page. `value` is a 0–1 ratio (or null/undefined when missing).
export function getRatingColor(
  value: number | null | undefined,
): "bg-missing" | "bg-met" | "bg-partial" | "bg-danger" {
  if (value == null) return "bg-missing";
  const pct = Math.round(value * 100);
  if (pct >= 70) return "bg-met";
  if (pct >= 50) return "bg-partial";
  return "bg-danger";
}
