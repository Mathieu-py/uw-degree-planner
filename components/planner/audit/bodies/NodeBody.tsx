import { pickOptions, type ScoredNode } from "@/lib/audit/score";
import { GENERIC_ALL } from "@/lib/audit/view/types";
import { countNoun } from "@/lib/format";
import { CountedCard } from "../cards/CountedCard";
import type { OptionRenderProps } from "../types";
import { ChooseOneRow } from "./ChooseOneRow";
import { CompoundPickBody } from "./CompoundPick";
import { OptionChip } from "./OptionChip";
import { SubjectPoolBody } from "./SubjectPoolBody";

/** Element A — a fixed set of required courses rendered as one Status Card of
 *  met/warn/drag chips; recedes to a green confirmation once all are placed. */
function RequiredCoursesCard({
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
  if (r.kind !== "courses") return null;
  const { needed, complete } = scored;
  // Count placement reality like the chips: match credit reads 0 for a leaf
  // whose codes' buckets an earlier same-code leaf owns (progress.ts required
  // is first-wins), contradicting a placed chip. `complete` gates the recede.
  const placed = Math.max(
    0,
    node.satisfiers.length - (node.illegalSatisfiers?.length ?? 0),
  );
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

  // `complete` is legality-based (score.ts): an illegal placement keeps the
  // card active/amber rather than collapsing to a green "done".
  return (
    <CountedCard
      title="Required courses"
      caption={caption}
      done={placed}
      need={needed}
      num={placed}
      complete={complete}
      recedeMeta={`${needed}/${needed}`}
      recedeCaption={caption}
      recedeChildren={chips}
    >
      <div className="cd-metaline">
        <b>
          {placed} of {needed}
        </b>{" "}
        required courses placed.
      </div>
      {chips}
    </CountedCard>
  );
}

/**
 * Renders a scored node's body, dispatching on rule kind to the Status-Card
 * grammar: `courses` → required card; `pick` → choose-one / compound card;
 * `subjectPool` → pool card; `all` → a stack of the above. Counts and recede
 * come off the ScoredNode; `scored.node` supplies presentation only.
 */
export function NodeBody({
  scored,
  placedCodes,
  illegalCodes,
  catalogByCode,
  onDrill,
  drag,
  depth = 0,
}: {
  scored: ScoredNode;
  depth?: number;
} & OptionRenderProps) {
  const node = scored.node;
  const r = node.ruleNode;

  if (r.kind === "courses") {
    return (
      <RequiredCoursesCard
        scored={scored}
        placedCodes={placedCodes}
        illegalCodes={illegalCodes}
        catalogByCode={catalogByCode}
        onDrill={onDrill}
        drag={drag}
      />
    );
  }

  if (r.kind === "pick") {
    // score.ts keys the scoring source on this same helper: a flat choice is
    // always match-scored, a CompoundPickBody subtree always local.
    const options = pickOptions(node);
    if (options) {
      return (
        <ChooseOneRow
          scored={scored}
          options={options}
          illegalCodes={illegalCodes}
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
        scored={scored}
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
        scored={scored}
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
        {scored.children.map((child, i) => (
          <NodeBody
            // biome-ignore lint/suspicious/noArrayIndexKey: rule tree is stable
            key={i}
            scored={child}
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
