import { Icon } from "@/components/ui/Icon";

/**
 * The browse action — a dashed split-row parked at the foot of a criteria-based
 * card body (subject pool / breadth / open elective). The left descriptor bakes
 * in the outstanding amount ("Add 1 more"); the right action opens the catalog
 * picker. Callers omit it entirely in the read-only view (no `onDrill`).
 */
export function FindRow({
  label,
  onFind,
}: {
  label: string;
  onFind: () => void;
}) {
  return (
    <button
      type="button"
      className="br4-dash br4-split"
      onClick={onFind}
      aria-label={`${label} — find courses`}
    >
      <span className="lbl">{label}</span>
      <span className="act">
        <Icon name="search" size="xs" aria-hidden="true" />
        Find courses
      </span>
    </button>
  );
}
