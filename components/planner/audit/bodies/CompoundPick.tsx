"use client";

import { Fragment, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { AuditNode } from "@/lib/audit/compile";
import { optionMet, type ScoredNode } from "@/lib/audit/score";
import { fmtUnits, pluralize, progressPct } from "@/lib/format";
import { walkRule } from "@/lib/requirements/walk";
import { MetChip, WarnChip } from "../cards/Chip";
import { FindRow } from "../cards/FindRow";
import { Recede } from "../cards/Recede";
import { RingLead } from "../cards/RingLead";
import { StatusCard } from "../cards/StatusCard";
import { StatusPill } from "../cards/StatusPill";
import { GENERIC_ALL, type OptionRenderProps } from "../types";
import { OptionChip } from "./OptionChip";
import { poolLevels } from "./SubjectPoolBody";

/** A→Z badge for an option's position in the choice. */
function optionBadge(index: number): string {
  return String.fromCharCode(65 + index);
}

/** The fixed course codes an option's subtree names, walking the RULE tree (the
 *  compiler unions a flat pick's leaves onto the rule, so its codes only live
 *  there). Pools carry no fixed list — they're handled by {@link collectPools}. */
function collectCourses(node: AuditNode): string[] {
  const codes: string[] = [];
  walkRule(node.ruleNode, (r) => {
    if (r.kind === "courses") codes.push(...r.courses);
  });
  return [...new Set(codes)];
}

/** The scored subjectPool nodes inside an option (bare pool, or nested under an
 *  `all` bundle) — each keeps its `subjectCodes`/levels and its placed
 *  satisfiers, so it can render met chips + a scoped "Find courses" row. */
function collectPools(scored: ScoredNode): ScoredNode[] {
  if (scored.node.ruleNode.kind === "subjectPool") return [scored];
  return scored.children.flatMap(collectPools);
}

function optionName(option: AuditNode, badge: string): string {
  return option.description && option.description !== GENERIC_ALL
    ? option.description
    : `Option ${badge}`;
}

/** Placed satisfier chips for a met/receded option (met, or warn if illegal). */
function satisfierChips(
  codes: string[],
  illegalCodes: ReadonlySet<string>,
  catalogByCode: OptionRenderProps["catalogByCode"],
) {
  return [...new Set(codes)].map((code) =>
    illegalCodes.has(code) ? (
      <WarnChip key={code} code={code} name={catalogByCode.get(code)?.name} />
    ) : (
      <MetChip key={code} code={code} name={catalogByCode.get(code)?.name} />
    ),
  );
}

/** One subject-pool part of an option: its placed chips + a scoped browse row.
 *  Local-scored numbers — the match doesn't model partial options. */
function PoolPart({
  pool,
  illegalCodes,
  catalogByCode,
  onDrill,
}: { pool: ScoredNode } & Omit<OptionRenderProps, "placedCodes" | "drag">) {
  const r = pool.node.ruleNode;
  if (r.kind !== "subjectPool") return null;
  const subjects = r.subjectCodes.map((s) => s.toUpperCase());
  const chosen = pool.node.satisfiers.map((p) => p.code);
  const remaining = Math.max(0, pool.needed - pool.credit);
  return (
    <>
      {satisfierChips(chosen, illegalCodes, catalogByCode)}
      {onDrill && remaining > 0 ? (
        <FindRow
          label={`Add ${fmtUnits(remaining)} more`}
          onFind={() =>
            onDrill([], {
              includePrefixes: subjects,
              levels: poolLevels(r.minLevel, r.maxLevel),
            })
          }
        />
      ) : null}
    </>
  );
}

/** An option's body: fixed courses as chips, plus each pool's chips + browse. */
function OptionBody({
  opt,
  placedCodes,
  illegalCodes,
  catalogByCode,
  onDrill,
  drag,
}: { opt: ScoredNode } & OptionRenderProps) {
  return (
    <div className="cd-opt-body">
      {collectCourses(opt.node).map((code) => (
        <OptionChip
          key={code}
          code={code}
          placed={placedCodes.has(code)}
          illegal={illegalCodes.has(code)}
          catalogByCode={catalogByCode}
          onDrill={onDrill}
          drag={drag}
        />
      ))}
      {collectPools(opt).map((pool, pi) => (
        <PoolPart
          // biome-ignore lint/suspicious/noArrayIndexKey: rule tree is stable
          key={`pool-${pi}`}
          pool={pool}
          illegalCodes={illegalCodes}
          catalogByCode={catalogByCode}
          onDrill={onDrill}
        />
      ))}
    </div>
  );
}

/**
 * Element C — a compound `pick` whose options are multi-course bundles (A / B /
 * …), rendered as `.cd-opt` sub-cards separated by "or". Collapses to a green
 * recede row once enough streams are complete. The whole subtree is
 * local-scored (score.ts): each option counts its own satisfiers.
 */
export function CompoundPickBody({
  scored,
  placedCodes,
  illegalCodes,
  catalogByCode,
  onDrill,
  drag,
}: {
  scored: ScoredNode;
} & OptionRenderProps) {
  const node = scored.node;
  const r = node.ruleNode;
  const [showAll, setShowAll] = useState(false);
  const options = scored.children;
  if (r.kind !== "pick") return null;

  const selectMin = r.selectMin ?? 1;
  const { needed, credit: satisfied, complete: decided } = scored;
  // Same predicate as the recede gate (completeOf counts `optionMet` children),
  // so `decided` ⇒ metOptions non-empty by construction.
  const metOptions = options
    .map((opt, index) => ({ opt, index }))
    .filter(({ opt }) => optionMet(opt.node));
  const title = node.description ?? "Choose one option";
  const caption = `choose ${selectMin} of ${options.length} ${pluralize(options.length, "option")}`;

  // Satisfied → recede to the completed path(s); the rest hide behind a toggle.
  if (decided && !showAll) {
    const others = options.length - metOptions.length;
    const recedeCaption =
      metOptions.length > 1
        ? `Completed — Options ${metOptions.map((m) => optionBadge(m.index)).join(", ")}`
        : `Completed — Option ${optionBadge(metOptions[0].index)}`;
    const doneCodes = metOptions.flatMap(({ opt }) =>
      opt.node.satisfiers.map((p) => p.code),
    );
    return (
      <Recede title={title} caption={recedeCaption}>
        <div className="cd-chips">
          {satisfierChips(doneCodes, illegalCodes, catalogByCode)}
        </div>
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

  return (
    <StatusCard
      tone={satisfied > 0 ? "partial" : "missing"}
      lead={
        <RingLead
          pct={progressPct(satisfied, needed, 0)}
          num={satisfied}
          tone="neutral"
        />
      }
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
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: rule tree is stable
          <Fragment key={i}>
            {i > 0 ? <div className="cd-or">or</div> : null}
            <div
              className={`cd-opt${opt.node.status === "partial" ? " sel" : ""}`}
            >
              <div className="cd-opt-head">
                <span className="cd-opt-badge">{badge}</span>
                <span className="cd-opt-name">
                  {optionName(opt.node, badge)}
                </span>
                <span className="cd-opt-mini">
                  {fmtUnits(opt.credit)}/{fmtUnits(opt.needed)}
                </span>
              </div>
              <OptionBody
                opt={opt}
                placedCodes={placedCodes}
                illegalCodes={illegalCodes}
                catalogByCode={catalogByCode}
                onDrill={onDrill}
                drag={drag}
              />
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
