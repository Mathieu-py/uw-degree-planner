import { Icon } from "@/components/ui/Icon";
import { formatCourseCode } from "@/lib/format";

/**
 * A criteria-based requirement (subject pool / faculty breadth) — defined by a
 * subject + level filter, not a fixed course list. Renders as one "search the
 * catalog" card summarizing the criteria; clicking it opens the picker
 * pre-filtered to those subjects/levels (so the sidebar shows the filter).
 * Placed courses that count show as met chips above.
 */
export function PoolCard({
  lead,
  subjects,
  levelText,
  satisfiers,
  onBrowse,
}: {
  lead: string;
  subjects: string[];
  levelText: string | null;
  satisfiers: string[];
  onBrowse: (() => void) | null;
}) {
  const shown = subjects.slice(0, 3);
  const extra = subjects.length - shown.length;
  const sub = [shown.join(" · ") + (extra > 0 ? ` +${extra}` : ""), levelText]
    .filter(Boolean)
    .join("  ·  ");
  const inner = (
    <span className="av-poolbtn-text">
      <span className="av-poolbtn-lead">{lead}</span>
      {sub ? <span className="av-poolbtn-sub">{sub}</span> : null}
    </span>
  );
  return (
    <div className="av-pool">
      {satisfiers.length > 0 ? (
        <div className="av-chips">
          {satisfiers.map((code) => (
            <span
              key={code}
              className="av-chip met"
              title={formatCourseCode(code)}
            >
              <Icon name="check" size="xs" aria-hidden="true" />
              {formatCourseCode(code)}
            </span>
          ))}
        </div>
      ) : null}
      {onBrowse ? (
        <button type="button" className="av-poolbtn" onClick={onBrowse}>
          <span className="av-poolbtn-ico">
            <Icon name="search" size="sm" aria-hidden="true" />
          </span>
          {inner}
          <Icon name="arrow" size="xs" aria-hidden="true" />
        </button>
      ) : (
        <div className="av-poolbtn is-static">
          <span className="av-poolbtn-ico">
            <Icon name="search" size="sm" aria-hidden="true" />
          </span>
          {inner}
        </div>
      )}
    </div>
  );
}
