import { type AuditNode, isLegallyMet } from "@/lib/audit/compile";
import type { Course } from "@/lib/courses/types";
import { countNoun } from "@/lib/format";
import { CountedCard } from "../cards/CountedCard";
import { nodeProgress } from "../nodeProgress";
import { type DragWiring, type DrillFn, GENERIC_ALL } from "../types";
import { ChooseOneRow } from "./ChooseOneRow";
import { CompoundPickBody } from "./CompoundPick";
import { OptionChip } from "./OptionChip";
import { SubjectPoolBody } from "./SubjectPoolBody";

/**
 * Flatten a 1-of-1 pick whose every leaf is a single course into a list of
 * option codes, recursing through nested 1-of-1 picks. Returns `null` when any
 * option is genuinely compound (several courses, a subject pool, or not a
 * strict 1-of-1), so the caller keeps the structured rendering.
 */
function asFlatChoiceOptions(node: AuditNode): string[] | null {
  const r = node.ruleNode;
  if (r.kind === "courses")
    return r.courses.length === 1 ? [r.courses[0]] : null;
  if (r.kind !== "pick") return null;
  if ((r.selectMin ?? 1) !== 1 || (r.selectMax ?? 1) !== 1) return null;
  const opts: string[] = [];
  if (node.children.length === 0) {
    // Compiler-unioned course leaves: each code is its own option.
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

/** Element A — a fixed set of required courses rendered as one Status Card of
 *  met/warn/drag chips; recedes to a green confirmation once all are placed. */
function RequiredCoursesCard({
  node,
  placedCodes,
  illegalCodes,
  catalogByCode,
  onDrill,
  drag,
}: {
  node: AuditNode;
  placedCodes: ReadonlySet<string>;
  illegalCodes: ReadonlySet<string>;
  catalogByCode: Map<string, Course>;
  onDrill?: DrillFn;
  drag?: DragWiring;
}) {
  const r = node.ruleNode;
  if (r.kind !== "courses") return null;
  const { needed, satisfied } = nodeProgress(node);
  const caption = countNoun(needed, "required course");
  const chips = (
    <div className="cd-chips">
      {r.courses.map((code) => (
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
    </div>
  );

  // Recede only when every required course is placed *legally*. An illegal
  // placement (unmet prereq / antireq) isn't credited toward the degree, so keep
  // the card active/amber (with its WarnChip) rather than collapsing to a green
  // "done" that would contradict the degree bar.
  return (
    <CountedCard
      title="Required courses"
      caption={caption}
      done={satisfied}
      need={needed}
      num={satisfied}
      complete={isLegallyMet(node)}
      recedeMeta={`${needed}/${needed}`}
      recedeCaption={caption}
      recedeChildren={chips}
    >
      <div className="cd-metaline">
        <b>
          {satisfied} of {needed}
        </b>{" "}
        required courses placed.
      </div>
      {chips}
    </CountedCard>
  );
}

/**
 * Renders an audit node's body, dispatching on rule-node kind to the Status-Card
 * grammar: `courses` → required-courses card; `pick` → choose-one / compound
 * card; `subjectPool` → pool card; `all` → a stack of the above.
 */
export function NodeBody({
  node,
  placedCodes,
  illegalCodes,
  catalogByCode,
  onDrill,
  drag,
  depth = 0,
}: {
  node: AuditNode;
  placedCodes: ReadonlySet<string>;
  illegalCodes: ReadonlySet<string>;
  catalogByCode: Map<string, Course>;
  onDrill?: DrillFn;
  drag?: DragWiring;
  depth?: number;
}) {
  const r = node.ruleNode;

  if (r.kind === "courses") {
    return (
      <RequiredCoursesCard
        node={node}
        placedCodes={placedCodes}
        illegalCodes={illegalCodes}
        catalogByCode={catalogByCode}
        onDrill={onDrill}
        drag={drag}
      />
    );
  }

  if (r.kind === "pick") {
    // 1-of-N over `courses` leaves: the compiler unions them into one pool
    // (options on `r.children`). Mirrors `allCoursesLeaves`. Render "choose one".
    const allCourses =
      r.children.length > 0 && r.children.every((c) => c.kind === "courses");
    if (allCourses) {
      const options = [
        ...new Set(
          r.children.flatMap((c) => (c.kind === "courses" ? c.courses : [])),
        ),
      ];
      return (
        <ChooseOneRow
          node={node}
          options={options}
          catalogByCode={catalogByCode}
          onDrill={onDrill}
          drag={drag}
        />
      );
    }
    // A 1-of-1 pick whose options are all single courses — even nested — is one
    // flat choice (any course satisfies it). Collapse to a "choose one" card.
    const flat = asFlatChoiceOptions(node);
    if (flat && flat.length > 0) {
      return (
        <ChooseOneRow
          node={node}
          options={flat}
          catalogByCode={catalogByCode}
          onDrill={onDrill}
          drag={drag}
        />
      );
    }
    // Genuinely compound pick: render alternatives as distinct option cards that
    // read as mutually exclusive, collapsing to a summary once satisfied.
    return (
      <CompoundPickBody
        node={node}
        placedCodes={placedCodes}
        illegalCodes={illegalCodes}
        catalogByCode={catalogByCode}
        onDrill={onDrill}
        drag={drag}
      />
    );
  }

  if (r.kind === "subjectPool") {
    return (
      <SubjectPoolBody
        node={node}
        illegalCodes={illegalCodes}
        catalogByCode={catalogByCode}
        onDrill={onDrill}
      />
    );
  }

  if (r.kind === "all") {
    // Nested sub-groups show their own heading; the top-level group's is the
    // section title. Each child renders as its own card (self-spacing).
    return (
      <div>
        {depth > 0 && node.description && node.description !== GENERIC_ALL ? (
          <span className="u-small mt-1 mb-1.5 block">{node.description}</span>
        ) : null}
        {node.children.map((child, i) => (
          <NodeBody
            // biome-ignore lint/suspicious/noArrayIndexKey: rule tree is stable
            key={i}
            node={child}
            placedCodes={placedCodes}
            illegalCodes={illegalCodes}
            catalogByCode={catalogByCode}
            onDrill={onDrill}
            drag={drag}
            depth={depth + 1}
          />
        ))}
      </div>
    );
  }

  // excluded: violations surface as the section pill, no body.
  return null;
}
