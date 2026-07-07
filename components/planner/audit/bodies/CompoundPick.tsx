"use client";

import { Fragment, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { type AuditNode, isSatisfied } from "@/lib/audit/compile";
import { pluralize } from "@/lib/format";
import type { RuleNode } from "@/lib/programs";
import { Recede } from "../cards/Recede";
import { RingLead } from "../cards/RingLead";
import { StatusCard } from "../cards/StatusCard";
import { StatusPill } from "../cards/StatusPill";
import { nodeProgress } from "../nodeProgress";
import { GENERIC_ALL, type OptionRenderProps } from "../types";
import { OptionChip } from "./OptionChip";

/** A→Z badge for an option's position in the choice. */
function optionBadge(index: number): string {
  return String.fromCharCode(65 + index);
}

/** All course codes an option's subtree names. Walks the RULE tree, not the
 *  compiled node: the compiler empties a pick's `children` (options move onto
 *  the rule), so a nested pick's codes would otherwise be dropped. Pools /
 *  excluded leaves carry no fixed list. */
function collectCourses(node: AuditNode): string[] {
  const walk = (r: RuleNode): string[] => {
    if (r.kind === "courses") return r.courses;
    if (r.kind === "subjectPool" || r.kind === "excluded") return [];
    return r.children.flatMap(walk);
  };
  return [...new Set(walk(node.ruleNode))];
}

function optionName(option: AuditNode, badge: string): string {
  return option.description && option.description !== GENERIC_ALL
    ? option.description
    : `Option ${badge}`;
}

/**
 * Element C — a compound `pick` whose options are multi-course bundles (A / B /
 * …), rendered as `.cd-opt` sub-cards separated by "or". Collapses to a green
 * recede row once one stream is complete, expandable to the other options.
 */
export function CompoundPickBody({
  node,
  placedCodes,
  illegalCodes,
  catalogByCode,
  onDrill,
  drag,
}: {
  node: AuditNode;
} & OptionRenderProps) {
  const r = node.ruleNode;
  const [showAll, setShowAll] = useState(false);
  const options = node.children;
  if (r.kind !== "pick") return null;

  const selectMin = r.selectMin ?? 1;
  const { needed, satisfied } = nodeProgress(node);
  const metOptions = options
    .map((opt, index) => ({ opt, index }))
    .filter(({ opt }) => isSatisfied(opt));
  const decided = metOptions.length >= selectMin;
  const title = node.description ?? "Choose one option";
  const caption = `choose ${selectMin} of ${options.length} ${pluralize(options.length, "option")}`;

  const chipsFor = (option: AuditNode) => {
    const codes = [...new Set(collectCourses(option))];
    return codes.map((code) => (
      <OptionChip
        key={code}
        code={code}
        placed={placedCodes.has(code)}
        illegal={illegalCodes.has(code)}
        catalogByCode={catalogByCode}
        onDrill={onDrill}
        drag={drag}
      />
    ));
  };

  // Satisfied → recede to the completed path; the others hide behind a toggle.
  if (decided && !showAll) {
    const others = options.length - metOptions.length;
    const win = metOptions[0];
    return (
      <Recede
        title={title}
        caption={`Completed — Option ${optionBadge(win.index)}`}
      >
        <div className="cd-chips">{chipsFor(win.opt)}</div>
        {others > 0 ? (
          <button
            type="button"
            className="cd-showothers"
            onClick={() => setShowAll(true)}
          >
            <Icon name="chevronRight" size="xs" aria-hidden="true" />
            show {others} other {pluralize(others, "option")}
          </button>
        ) : null}
      </Recede>
    );
  }

  const anyPartial = options.some((o) => o.status === "partial");
  const pct =
    needed > 0 ? Math.min(Math.round((satisfied / needed) * 100), 100) : 0;
  return (
    <StatusCard
      tone={anyPartial ? "partial" : "missing"}
      lead={<RingLead pct={pct} num={satisfied} tone="neutral" />}
      title={title}
      caption={caption}
      pill={
        <StatusPill
          variant="decide"
          label={selectMin === 1 ? "Choose 1" : `Choose ${selectMin}`}
        />
      }
    >
      <div className="cd-metaline">
        Commit to <b>one stream</b> — every course in it must be completed.
      </div>
      {options.map((opt, i) => {
        const badge = optionBadge(i);
        const codes = [...new Set(collectCourses(opt))];
        const met = codes.filter(
          (c) => placedCodes.has(c) && !illegalCodes.has(c),
        ).length;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: rule tree is stable
          <Fragment key={i}>
            {i > 0 ? <div className="cd-or">or</div> : null}
            <div className={`cd-opt${opt.status === "partial" ? " sel" : ""}`}>
              <div className="cd-opt-head">
                <span className="cd-opt-badge">{badge}</span>
                <span className="cd-opt-name">{optionName(opt, badge)}</span>
                <span className="cd-opt-mini">
                  {met}/{codes.length}
                </span>
              </div>
              <div className="cd-opt-body">{chipsFor(opt)}</div>
            </div>
          </Fragment>
        );
      })}
      {decided && showAll ? (
        <button
          type="button"
          className="cd-showothers"
          onClick={() => setShowAll(false)}
        >
          <Icon name="chevronRight" size="xs" aria-hidden="true" />
          hide other options
        </button>
      ) : null}
    </StatusCard>
  );
}
