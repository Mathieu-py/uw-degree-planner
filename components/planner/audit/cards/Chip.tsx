import { Icon } from "@/components/ui/Icon";
import { formatCourseCode } from "@/lib/format";

/** A satisfied course/option — the green "met" chip. Code only; the course
 *  name lives in the tooltip to keep the row compact. */
export function MetChip({ code, name }: { code: string; name?: string }) {
  const label = formatCourseCode(code);
  return (
    <span className="cd-chip met" title={name ? `${label} — ${name}` : label}>
      <Icon name="check" size="xs" aria-hidden="true" />
      {label}
    </span>
  );
}

/** A course placed illegally (before its prereqs / in an antireq conflict) —
 *  shown, but not credited until the placement is valid. */
export function WarnChip({ code, name }: { code: string; name?: string }) {
  const label = formatCourseCode(code);
  return (
    <span
      className="cd-chip warn"
      title={`${label}${name ? ` — ${name}` : ""} is placed before its prereqs or in an antireq conflict — it shows on your timeline, but doesn't credit the degree until the placement is valid.`}
    >
      <Icon name="warning" size="xs" aria-hidden="true" />
      {label}
    </span>
  );
}
