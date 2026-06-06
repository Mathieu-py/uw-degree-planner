"use client";

import { Fragment, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { AuditNode } from "@/lib/audit/compile";
import { formatCourseCode } from "@/lib/format";
import type { OptionRenderProps } from "../types";
import { NodeBody } from "./NodeBody";

/** When true, a satisfied compound pick collapses to a summary + "show others". */
const COLLAPSE_WHEN_DECIDED = true;

/** Does this option's placement actually satisfy it (vs. a vacuous "met")? */
function optionMet(opt: AuditNode): boolean {
  return (
    (opt.status === "met" || opt.status === "overSatisfied") &&
    opt.satisfiers.length > 0
  );
}

/** A→Z badge for an option's position in the choice. */
function optionBadge(index: number): string {
  return String.fromCharCode(65 + index);
}

/**
 * A compound `pick` whose options are multi-course bundles. Renders each
 * alternative as a delineated option card so they read as mutually-exclusive
 * choices; once enough options are satisfied it collapses to a compact summary
 * of the completed path with a "show other options" toggle.
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
  // Local "which option am I considering" focus — it only drives which card is
  // expanded; placement alone decides what's actually satisfied, so it needs no
  // persistence. Default to the option already in progress, else the first.
  const options = r.kind === "pick" ? node.children : [];
  const [focused, setFocused] = useState(() => initialFocus(options));
  if (r.kind !== "pick") return null;

  const selectMin = r.selectMin ?? 1;
  const metOptions = options
    .map((opt, index) => ({ opt, index }))
    .filter(({ opt }) => optionMet(opt));
  const decided = metOptions.length >= selectMin;

  if (COLLAPSE_WHEN_DECIDED && decided && !showAll) {
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
      {/* A top-level compound pick (rare; none in current data) already has the
          framing as its section title, so only nested ones add the header. */}
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
          className="av-opt-toggle"
          onClick={() => setShowAll(false)}
        >
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
  const met = options.findIndex(optionMet);
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
  if (pools > 0) parts.push(`+${pools} course${pools === 1 ? "" : "s"}`);
  return parts.join("  ·  ") || "—";
}

/**
 * One alternative in a compound pick. Collapsed, it's a single selectable row
 * (radio badge + a preview of its courses); selecting it expands the full
 * requirement body and collapses the siblings, so the group reads as an active
 * "pick one of these" rather than a stack of competing cards.
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
  const met = optionMet(option);
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
      {/* The body is ALWAYS in the DOM — every option's courses stay present
          (data integrity + reachable), just hidden when this option isn't the
          expanded one. Conditional-rendering it would silently drop those codes
          from the rendered audit. */}
      <div className="av-choice-body" hidden={!expanded}>
        <OptionBody node={option} {...rest} />
      </div>
    </div>
  );
}

/**
 * The body of an option card. An option is usually an `all` bundle — render its
 * children directly so the card boundary stands in for "Complete all of the
 * following". A non-`all` option (a bare multi-code courses leaf, or a single
 * nested pick) renders as-is.
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
  return (
    <div className="flex flex-col gap-1.5">
      {metOptions.map(({ opt, index }) => (
        <div key={index} className="av-opt-summary">
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
        <button type="button" className="av-opt-toggle" onClick={onShowAll}>
          <Icon name="chevronRight" size="xs" aria-hidden="true" /> show{" "}
          {others} other option{others === 1 ? "" : "s"}
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
  // With a known option count and an exact N-of-M choice, name the total:
  // "Choose 1 of 3 options" reads better than "Choose 1 of these options:".
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

/**
 * Collapse a 1-of-1 pick whose every leaf is a single course into a flat list
 * of option codes — even across nested 1-of-1 picks. Returns `null` when an
 * option is genuinely compound (requires several courses, is an open subject
 * pool, or the pick isn't a strict 1-of-1), so the caller keeps the structured
 * rendering. Mirrors the compiler's option semantics: a `courses` leaf directly
 * under a pick contributes each of its codes as a separate option, but a
 * `courses` leaf reached as a mixed pick's compiled child means "all of these"
 * and so can't be a single chip.
 */
export function asFlatChoiceOptions(node: AuditNode): string[] | null {
  const r = node.ruleNode;
  if (r.kind === "courses")
    return r.courses.length === 1 ? [r.courses[0]] : null;
  if (r.kind !== "pick") return null;
  if ((r.selectMin ?? 1) !== 1 || (r.selectMax ?? 1) !== 1) return null;
  const opts: string[] = [];
  if (node.children.length === 0) {
    // All-courses pick the compiler unioned: each code is its own option.
    for (const c of r.children) {
      if (c.kind !== "courses") return null;
      opts.push(...c.courses);
    }
  } else {
    for (const child of node.children) {
      const sub = asFlatChoiceOptions(child);
      if (!sub) return null;
      opts.push(...sub);
    }
  }
  return [...new Set(opts)];
}
