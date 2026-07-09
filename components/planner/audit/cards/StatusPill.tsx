export type PillVariant = "progress" | "none" | "decide" | "note";

/** The status pill parked top-right in a Status Card header. */
export function StatusPill({
  variant,
  label,
}: {
  variant: PillVariant;
  label: string;
}) {
  return <span className={`cd-pill ${variant}`}>{label}</span>;
}
