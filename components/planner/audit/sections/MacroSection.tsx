import { Icon, type IconName } from "@/components/ui/Icon";
import { Ring } from "@/components/ui/Ring";
import { ringFor } from "@/lib/audit/score";
import { NodeBody } from "../bodies/NodeBody";
import type { Macro, OptionRenderProps } from "../types";
import { SectionRow } from "./SectionRow";

/** Head-tile glyph per macro; the complete state swaps in a check. */
const TILE_ICON: Record<Macro["key"], IconName> = {
  degree: "lock",
  specialization: "bolt",
  electives: "search",
  other: "doc",
};

/**
 * One of the top-level collapsible macro-sections (Degree requirements /
 * Electives / Co-op & other). A `node` block renders the rule tree flat via
 * `NodeBody`; a `sections` block renders the existing Section rows inline.
 */
export function MacroSection({
  macro,
  placedCodes,
  illegalCodes,
  catalogByCode,
  onDrill,
  drag,
}: { macro: Macro } & OptionRenderProps) {
  const complete =
    macro.count != null && macro.count.satisfied >= macro.count.needed;
  return (
    <details
      className={complete ? "av-macro is-complete" : "av-macro"}
      open={macro.defaultOpen}
    >
      <summary className="av-macro-head list-none select-none [&::-webkit-details-marker]:hidden">
        <span className="av-macro-tile" aria-hidden="true">
          <Icon name={complete ? "check" : TILE_ICON[macro.key]} size="md" />
        </span>
        <span className="av-macro-label">{macro.label}</span>
        {macro.count ? (
          complete ? (
            <span
              className="av-macro-done"
              role="img"
              aria-label={`${macro.count.satisfied} of ${macro.count.needed} complete`}
            >
              <Icon name="check" size="md" aria-hidden="true" />
            </span>
          ) : (
            <span className="av-macro-count">
              <span className="big">{macro.count.satisfied}</span>
              <span className="small">/{macro.count.needed}</span>
            </span>
          )
        ) : null}
        <span className="av-macro-chev">
          <Icon name="chevronRight" size="xs" aria-hidden="true" />
        </span>
      </summary>
      <div className="av-macro-rule" aria-hidden="true" />
      <div className="av-macro-body">
        {macro.blocks.map((block, i) => {
          const body =
            block.content.kind === "node" ? (
              <NodeBody
                scored={block.content.scored}
                placedCodes={placedCodes}
                illegalCodes={illegalCodes}
                catalogByCode={catalogByCode}
                onDrill={onDrill}
                drag={drag}
              />
            ) : (
              block.content.sections.map((s) => (
                <SectionRow
                  key={s.key}
                  section={s}
                  placedCodes={placedCodes}
                  illegalCodes={illegalCodes}
                  catalogByCode={catalogByCode}
                  onDrill={onDrill}
                  drag={drag}
                />
              ))
            );
          // A sub-labeled block (a term, "Specialization", a named sub-group) is
          // independently collapsible, so long lists fold away; a node block
          // also carries a small progress ring.
          if (block.subLabel) {
            const ring =
              block.content.kind === "node"
                ? ringFor(block.content.scored)
                : null;
            return (
              <details
                // biome-ignore lint/suspicious/noArrayIndexKey: blocks are derived deterministically
                key={i}
                className="group/strata"
                open
              >
                <summary className="av-substrata av-substrata-sum list-none select-none [&::-webkit-details-marker]:hidden">
                  {ring ? (
                    <span className="av-ring-wrap av-strata-ring">
                      <Ring
                        pct={ring.pct}
                        size={24}
                        stroke={3}
                        tone={ring.optional ? "neutral" : undefined}
                      />
                      <span className="av-ring-num">{ring.num}</span>
                    </span>
                  ) : null}
                  <span className="av-substrata-text">{block.subLabel}</span>
                  <span className="av-substrata-chev inline-flex transition-transform group-open/strata:rotate-90">
                    <Icon name="chevronRight" size="xs" aria-hidden="true" />
                  </span>
                </summary>
                <div className="av-substrata-body">{body}</div>
              </details>
            );
          }
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: blocks are derived deterministically
              key={i}
              className="av-macro-block"
            >
              {body}
            </div>
          );
        })}
        {macro.hint ? (
          <p className="av-hint av-macro-hint">{macro.hint}</p>
        ) : null}
      </div>
    </details>
  );
}
