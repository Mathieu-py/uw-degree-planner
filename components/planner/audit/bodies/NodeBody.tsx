import type { AuditNode } from "@/lib/audit/compile";
import type { Course } from "@/lib/courses/types";
import { type DragWiring, type DrillFn, GENERIC_ALL } from "../types";
import { ChooseOneRow } from "./ChooseOneRow";
import { asFlatChoiceOptions, CompoundPickBody } from "./CompoundPick";
import { CourseRow } from "./CourseRow";
import { SubjectPoolBody } from "./SubjectPoolBody";

/**
 * Renders an audit node's body, dispatching on the rule-node kind so each gets
 * the right treatment: required `courses` → draggable rows; `pick` → a "choose
 * one" row; `subjectPool` → Browse (no drag); nested `all` → recurse.
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
    // The clean case: a 1-of-N choice over `courses` leaves. The compiler
    // unions those into one option pool (so `node.children` is empty and the
    // options live on `node.ruleNode.children`) — render a "choose one" row.
    // This mirrors the compiler's own `allCoursesLeaves` test exactly.
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
    // A 1-of-1 pick whose options are all individual courses — even when nested
    // ("AMATH 271, or one of {AMATH 333, …}") — is mathematically a single flat
    // choice: any one course satisfies it. Collapse it into one "choose one"
    // card rather than a course row + a nested choice card.
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
    // Genuinely compound pick (each option requires several courses, an open
    // pool, etc.): render the alternatives as clearly-delineated option cards
    // so they read as mutually-exclusive choices, not independent requirements
    // — and collapse to a summary once the choice is satisfied.
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
    // A nested sub-group shows its own framing heading; the top-level group's
    // framing is already the section title. Children render their own headings,
    // so the parent never adds one (which would double up on mixed picks).
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
