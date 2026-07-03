import { Icon } from "@/components/ui/Icon";
import { countNoun } from "@/lib/format";
import type { AcknowledgeFn } from "./types";

interface Props {
  programId: string;
  /** Every unverified requirement with whether it's been manually confirmed. */
  items: { text: string; acked: boolean }[];
  /** Prior acknowledgements no longer matching a current requirement (a re-scrape
   * changed the rule) — surfaced so a slip from 100% to 99% is explained. */
  staleCount?: number;
  /**
   * Toggle handler. When absent (read-only shared view) rows render as static
   * text with no checkbox.
   */
  onAcknowledge?: AcknowledgeFn;
}

/**
 * Collapsed "Unverified requirements" disclosure under an audit headline: the
 * calendar rules the scraper couldn't turn into machine-checkable structure
 * (discretionary "see your advisor" rules). Kept collapsed so it stays out of
 * the way, with a still-owed count in the summary for discoverability. Expanding
 * lets the student read each rule and check it off; acknowledging every item
 * lets the headline reach 100% (the audit's "complete, pending advisor
 * confirmation" state — "couldn't auto-verify" is not "unmet"). See
 * {@link computeDegreeProgress}.
 */
export function UnverifiedRequirements({
  programId,
  items,
  staleCount = 0,
  onAcknowledge,
}: Props) {
  if (items.length === 0) return null;
  const owed = items.filter((it) => !it.acked).length;

  return (
    <details className="av-note mt-2 group">
      <summary className="flex items-center gap-2 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
        <span className="av-sec-label flex-1 min-w-0">
          Unverified requirements
        </span>
        <span className="u-small shrink-0">
          {owed > 0
            ? `${countNoun(owed, "requirement")} to check`
            : "all confirmed"}
        </span>
        <span className="text-ink-3 inline-flex transition-transform group-open:rotate-90 shrink-0">
          <Icon name="chevronRight" size="xs" aria-hidden="true" />
        </span>
      </summary>
      <p className="u-small mt-1.5">
        These couldn&apos;t be auto-verified — check each with your advisor,
        then confirm it to count toward 100%.
      </p>
      {staleCount > 0 && (
        <p className="u-small mt-1.5 text-partial">
          {countNoun(staleCount, "requirement")} you previously confirmed
          changed in a calendar update — re-confirm any that still apply.
        </p>
      )}
      <ul className="mt-1.5 flex flex-col gap-1">
        {items.map((it) => (
          <li key={it.text}>
            <label
              className={`flex items-start gap-2 text-xs ${onAcknowledge ? "cursor-pointer" : ""}`}
            >
              <input
                type="checkbox"
                checked={it.acked}
                disabled={!onAcknowledge}
                onChange={(e) =>
                  onAcknowledge?.(programId, it.text, e.target.checked)
                }
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-accent-bg"
              />
              <span className={it.acked ? "text-ink-3 line-through" : ""}>
                {it.text}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </details>
  );
}
