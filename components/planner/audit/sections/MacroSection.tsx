import { Icon } from "@/components/ui/Icon";
import { Ring } from "@/components/ui/Ring";
import { NodeBody } from "../bodies/NodeBody";
import { ringFor } from "../nodeProgress";
import type { Macro, OptionRenderProps } from "../types";
import { isIncomplete, SectionRow } from "./SectionRow";

/**
 * One of the three top-level collapsible macro-sections (Degree requirements /
 * Electives / Co-op & other). A `node` block renders the rule tree flat via
 * `NodeBody`; a `sections` block renders the existing Section rows inline.
 */
export function MacroSection({
  macro,
  placedCodes,
  illegalCodes,
  catalog,
  catalogByCode,
  onDrill,
  drag,
}: { macro: Macro } & OptionRenderProps) {
  return (
    <details className="av-macro group/macro" open={macro.defaultOpen}>
      <summary className="av-macro-head list-none select-none [&::-webkit-details-marker]:hidden">
        <span className="av-macro-label">{macro.label}</span>
        {macro.count ? (
          <span className="av-macro-count u-mono">
            {macro.count.satisfied} / {macro.count.needed}
          </span>
        ) : null}
        <span className="av-macro-chev inline-flex transition-transform group-open/macro:rotate-90">
          <Icon name="chevronRight" size="xs" aria-hidden="true" />
        </span>
      </summary>
      <div className="av-macro-body">
        {macro.blocks.map((block, i) => {
          const body =
            block.content.kind === "node" ? (
              <NodeBody
                node={block.content.node}
                placedCodes={placedCodes}
                illegalCodes={illegalCodes}
                catalog={catalog}
                catalogByCode={catalogByCode}
                onDrill={onDrill}
                drag={drag}
              />
            ) : (
              block.content.sections.map((s) => (
                <SectionRow
                  key={s.key}
                  section={s}
                  open={isIncomplete(s)}
                  placedCodes={placedCodes}
                  illegalCodes={illegalCodes}
                  catalog={catalog}
                  catalogByCode={catalogByCode}
                  onDrill={onDrill}
                  drag={drag}
                />
              ))
            );
          // A sub-labeled block (a term, "Specialization", "Degree minimums", a
          // named rule sub-group) is independently collapsible, so long lists —
          // e.g. an engineering program's eight terms — can be folded away. A
          // node block also carries a small progress ring (completion at a glance).
          if (block.subLabel) {
            const ring =
              block.content.kind === "node"
                ? ringFor(block.content.node)
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
