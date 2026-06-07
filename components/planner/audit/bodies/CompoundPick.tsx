"use client";

import { Fragment, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { type AuditNode, isSatisfied } from "@/lib/audit/compile";
import { countNoun, formatCourseCode, pluralize } from "@/lib/format";
import type { OptionRenderProps } from "../types";
import { NodeBody } from "./NodeBody";

/** A→Z badge for an option's position in the choice. */
function optionBadge(index: number): string {
  return String.fromCharCode(65 + index);
}

/**
 * A compound `pick` (options are multi-course bundles), rendered as mutually-
 * exclusive option cards; collapses to a summary + "show others" once satisfied.
 */
export function CompoundPickBody({
  node,
  depth,
  ...rest
}: {
  node: AuditNode;
  depth: number;
} & OptionRenderProps) {
  const r = node.ruleNode;
  const [showAll, setShowAll] = useState(false);
  // Local focus: which card is expanded. Placement (not this) decides what's
  // satisfied, so it needs no persistence — default to the in-progress option.
  const options = node.children;
  const [focused, setFocused] = useState(() => initialFocus(options));
  if (r.kind !== "pick") return null;

  const selectMin = r.selectMin ?? 1;
  const metOptions = options
    .map((opt, index) => ({ opt, index }))
    .filter(({ opt }) => isSatisfied(opt));
  const decided = metOptions.length >= selectMin;

  // A satisfied compound pick collapses to a summary + "show others".
  if (decided && !showAll) {
    return (
      <CompoundPickSummary
        metOptions={metOptions}
        total={options.length}
        onShowAll={() => setShowAll(true)}
      />
    );
  }

  return (
    <div className="av-choice">
      {/* Nested picks add the framing header; a top-level one already has it as
          its section title. */}
      {depth > 0 ? (
        <div className="av-choice-head">{pickFraming(r, options.length)}</div>
      ) : null}
      <div className="av-choice-opts">
        {options.map((opt, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rule tree is stable
          <Fragment key={i}>
            {i > 0 ? <div className="av-choice-or">or</div> : null}
            <ChoiceOption
              option={opt}
              index={i}
              expanded={i === focused}
              onSelect={() => setFocused(i)}
              {...rest}
            />
          </Fragment>
        ))}
      </div>
      {decided ? (
        <button
          type="button"
          className="av-opt-toggle is-open"
          onClick={() => setShowAll(false)}
        >
          <span className="av-opt-chev">
            <Icon name="chevronRight" size="xs" aria-hidden="true" />
          </span>
          Hide other options
        </button>
      ) : null}
    </div>
  );
}

/** Pick the option to expand first: one in progress, else a met one, else A. */
function initialFocus(options: AuditNode[]): number {
  const partial = options.findIndex((o) => o.status === "partial");
  if (partial >= 0) return partial;
  const met = options.findIndex(isSatisfied);
  return met >= 0 ? met : 0;
}

/** A one-line glance at a collapsed option: its course codes (+ pool/extra). */
function optionPreviewText(opt: AuditNode): string {
  const codes: string[] = [];
  let pools = 0;
  const walk = (n: AuditNode) => {
    const r = n.ruleNode;
    if (r.kind === "courses") codes.push(...r.courses);
    else if (r.kind === "subjectPool") pools += r.selectCount ?? 1;
    else n.children.forEach(walk);
  };
  walk(opt);
  const uniq = [...new Set(codes)];
  const parts = uniq.slice(0, 3).map(formatCourseCode);
  const extra = uniq.length - parts.length;
  if (extra > 0) parts.push(`+${extra}`);
  if (pools > 0) parts.push(`+${countNoun(pools, "course")}`);
  return parts.join("  ·  ") || "—";
}

/**
 * One alternative in a compound pick: a selectable row (badge + course preview)
 * that expands to the full requirement body and collapses its siblings.
 */
function ChoiceOption({
  option,
  index,
  expanded,
  onSelect,
  ...rest
}: {
  option: AuditNode;
  index: number;
  expanded: boolean;
  onSelect: () => void;
} & OptionRenderProps) {
  const met = isSatisfied(option);
  const cls = `av-choice-opt${expanded ? " is-open" : ""}${met ? " is-met" : ""}`;
  return (
    <div className={cls}>
      <button
        type="button"
        className="av-choice-sel"
        onClick={onSelect}
        aria-expanded={expanded}
      >
        <span className="av-choice-radio">
          {met ? (
            <Icon name="check" size="sm" aria-hidden="true" />
          ) : (
            optionBadge(index)
          )}
        </span>
        {expanded ? (
          <span className="av-choice-open-label">
            Option {optionBadge(index)}
          </span>
        ) : (
          <span className="av-choice-preview">{optionPreviewText(option)}</span>
        )}
        {expanded ? null : (
          <span className="av-choice-chev">
            <Icon name="chevronRight" size="xs" aria-hidden="true" />
          </span>
        )}
      </button>
      {/* Always in the DOM (just hidden when not expanded) — conditional
          rendering would drop these codes from the rendered audit. */}
      <div className="av-choice-body" hidden={!expanded}>
        <OptionBody node={option} {...rest} />
      </div>
    </div>
  );
}

/**
 * An option card's body. An `all` bundle renders its children directly (the card
 * is the "complete all" boundary); anything else renders as-is.
 */
function OptionBody({
  node,
  ...rest
}: { node: AuditNode } & OptionRenderProps) {
  if (node.ruleNode.kind === "all") {
    return (
      <div className="flex flex-col gap-1.5">
        {node.children.map((child, i) => (
          <NodeBody
            // biome-ignore lint/suspicious/noArrayIndexKey: rule tree is stable
            key={i}
            node={child}
            depth={1}
            {...rest}
          />
        ))}
      </div>
    );
  }
  return <NodeBody node={node} depth={1} {...rest} />;
}

/** Collapsed view of a satisfied compound pick: the completed path(s) + toggle. */
function CompoundPickSummary({
  metOptions,
  total,
  onShowAll,
}: {
  metOptions: { opt: AuditNode; index: number }[];
  total: number;
  onShowAll: () => void;
}) {
  const others = total - metOptions.length;
  // Completed path(s) + the "show others" control share one card, so the choice
  // reads as a single resolved block rather than a card with a stray link below.
  return (
    <div className="av-opt-summary">
      {metOptions.map(({ opt, index }) => (
        <div key={index} className="av-opt-summary-row">
          <span className="av-opt-summary-mark">
            <Icon name="check" size="sm" aria-hidden="true" />
          </span>
          <span className="av-opt-summary-body">
            <span className="av-opt-summary-label">
              Completed — Option {optionBadge(index)}
            </span>
            <span className="av-opt-summary-codes">
              {[...new Set(opt.satisfiers.map((s) => s.code))]
                .map(formatCourseCode)
                .join(" + ")}
            </span>
          </span>
        </div>
      ))}
      {others > 0 ? (
        <button
          type="button"
          className="av-opt-toggle av-opt-toggle--in-summary"
          onClick={onShowAll}
        >
          <span className="av-opt-chev">
            <Icon name="chevronRight" size="xs" aria-hidden="true" />
          </span>
          show {others} other {pluralize(others, "option")}
        </button>
      ) : null}
    </div>
  );
}

/** A concise "Choose N …" framing for a nested mixed pick's alternatives. */
function pickFraming(
  r: Extract<AuditNode["ruleNode"], { kind: "pick" }>,
  optionCount?: number,
): string {
  const min = r.selectMin;
  const max = r.selectMax;
  // Name the total when known: "Choose 1 of 3 options" > "Choose 1 of these…".
  if (optionCount != null && min != null && max != null && min === max)
    return `Choose ${min} of ${optionCount} options`;
  if (min != null && max != null)
    return min === max
      ? `Choose ${min} of these options:`
      : `Choose ${min}–${max} of these options:`;
  if (max != null) return `Choose up to ${max} of these options:`;
  if (min != null) return `Choose at least ${min} of these options:`;
  return "Choose from these options:";
}
