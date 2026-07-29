import { creditedChipCodes, type ScoredNode } from "@/lib/audit/score";
import type { Course } from "@/lib/courses/types";
import { fmtUnits, formatLevelRange, joinWithOverflow } from "@/lib/format";
import { CountedCard, FindRow, MetChip, WarnChip } from "../cards";
import type { DrillFn } from "../types";

/** Level buckets within a pool's [min,max] range (bucketed values). [] = all. */
export function poolLevels(min?: number, max?: number): number[] {
  const all = [100, 200, 300, 400];
  const sub = all.filter(
    (b) => (min == null || b >= min) && (max == null || b <= max),
  );
  return sub.length === all.length ? [] : sub;
}

/**
 * Element D (the issue's headline) — "choose N courses in these subjects/levels".
 * Now shows what already counts (met chips) and how many remain, not just a
 * browse link; recedes to a green confirmation once the pool is complete.
 */
export function SubjectPoolBody({
  scored,
  illegalCodes,
  catalogByCode,
  onDrill,
}: {
  scored: ScoredNode;
  illegalCodes: ReadonlySet<string>;
  catalogByCode: Map<string, Course>;
  onDrill?: DrillFn;
}) {
  const node = scored.node;
  const r = node.ruleNode;
  if (r.kind !== "subjectPool") return null;
  const subjects = r.subjectCodes.map((s) => s.toUpperCase());
  const levelText = formatLevelRange(r.minLevel, r.maxLevel);
  const unitBased = r.needUnits !== undefined;
  const { needed, credit: satisfied, complete } = scored;
  const remaining = Math.max(0, needed - satisfied);
  // Match-scored: chip only what credits THIS pool — "N additional courses"
  // means beyond the named list, so a course claimed elsewhere isn't re-shown.
  // Local-scored falls back to every matching satisfier.
  const chosenCodes =
    scored.source === "match"
      ? [...creditedChipCodes(scored, illegalCodes)]
      : [...new Set(node.satisfiers.map((p) => p.code))];

  const title = node.description ?? "Subject pool";
  const fmt = (n: number) => (unitBased ? fmtUnits(n) : String(n));
  const unitWord = unitBased ? " units" : "";
  // formatLevelRange already includes the word "level" (e.g. "300–400 level").
  const levelPhrase = levelText ? ` at ${levelText}` : "";

  const chips = (
    <div className="cd-chips">
      {chosenCodes.map((code) =>
        illegalCodes.has(code) ? (
          <WarnChip
            key={code}
            code={code}
            name={catalogByCode.get(code)?.name}
          />
        ) : (
          <MetChip
            key={code}
            code={code}
            name={catalogByCode.get(code)?.name}
          />
        ),
      )}
    </div>
  );

  return (
    <CountedCard
      title={title}
      done={satisfied}
      need={needed}
      num={fmt(satisfied)}
      complete={complete}
      recedeMeta={`${fmt(needed)}/${fmt(needed)}`}
      recedeChildren={chips}
    >
      <div className="cd-metaline">
        <b>
          {fmt(satisfied)} of {fmt(needed)}
          {unitWord}
        </b>{" "}
        chosen
        {remaining > 0 ? (
          <>
            {" "}
            · {fmt(remaining)} more from <b>{joinWithOverflow(subjects)}</b>
            {levelPhrase}
          </>
        ) : null}
        .
      </div>
      {chosenCodes.length > 0 ? chips : null}
      {/* Nothing to add when the count is met but blocked by an illegal
          placement (remaining 0, not yet satisfied) — fix that placement, don't
          browse for more. */}
      {onDrill && remaining > 0 ? (
        <FindRow
          label={`Add ${fmt(remaining)} more${unitWord}`}
          onFind={() =>
            onDrill([], {
              includePrefixes: subjects,
              levels: poolLevels(r.minLevel, r.maxLevel),
            })
          }
        />
      ) : null}
    </CountedCard>
  );
}
