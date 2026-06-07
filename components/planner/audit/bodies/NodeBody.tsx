import type { AuditNode } from "@/lib/audit/compile";
import type { Course } from "@/lib/courses/types";
import { type DragWiring, type DrillFn, GENERIC_ALL } from "../types";
import { ChooseOneRow } from "./ChooseOneRow";
import { CompoundPickBody } from "./CompoundPick";
import { CourseRow } from "./CourseRow";
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

/**
 * Renders an audit node's body, dispatching on rule-node kind: `courses` →
 * draggable rows; `pick` → "choose one" row; `subjectPool` → Browse (no drag);
 * `all` → recurse.
 */
export function NodeBody({
  node,
  placedCodes,
  illegalCodes,
  catalog,
  catalogByCode,
  onDrill,
  drag,
  depth = 0,
}: {
  node: AuditNode;
  placedCodes: ReadonlySet<string>;
  illegalCodes: ReadonlySet<string>;
  catalog?: Course[];
  catalogByCode: Map<string, Course>;
  onDrill?: DrillFn;
  drag?: DragWiring;
  depth?: number;
}) {
  const r = node.ruleNode;

  if (r.kind === "courses") {
    return (
      <>
        {r.courses.map((code) => (
          <CourseRow
            key={code}
            code={code}
            placed={placedCodes.has(code)}
            illegal={illegalCodes.has(code)}
            catalogByCode={catalogByCode}
            onDrill={onDrill}
            drag={drag}
          />
        ))}
      </>
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
        catalog={catalog}
        catalogByCode={catalogByCode}
        onDrill={onDrill}
        drag={drag}
        depth={depth}
      />
    );
  }

  if (r.kind === "subjectPool") {
    return <SubjectPoolBody node={r} onDrill={onDrill} />;
  }

  if (r.kind === "all") {
    // Nested sub-groups show their own heading; the top-level group's is the
    // section title. The parent never adds one (would double up on mixed picks).
    return (
      <div className="flex flex-col gap-1.5">
        {depth > 0 && node.description && node.description !== GENERIC_ALL ? (
          <span className="u-small mt-1">{node.description}</span>
        ) : null}
        {node.children.map((child, i) => (
          <NodeBody
            // biome-ignore lint/suspicious/noArrayIndexKey: rule tree is stable
            key={i}
            node={child}
            placedCodes={placedCodes}
            illegalCodes={illegalCodes}
            catalog={catalog}
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
