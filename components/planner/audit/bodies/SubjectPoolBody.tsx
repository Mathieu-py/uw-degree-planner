import { type AuditNode, isSatisfied } from "@/lib/audit/compile";
import type { Course } from "@/lib/courses/types";
import { fmtUnits, formatLevelRange, joinWithOverflow } from "@/lib/format";
import { MetChip, WarnChip } from "../cards/Chip";
import { FindRow } from "../cards/FindRow";
import { Recede } from "../cards/Recede";
import { RingLead } from "../cards/RingLead";
import { StatusCard } from "../cards/StatusCard";
import { StatusPill } from "../cards/StatusPill";
import { nodeProgress } from "../nodeProgress";
import type { DrillFn } from "../types";

/** Level buckets within a pool's [min,max] range (bucketed values). [] = all. */
function poolLevels(min?: number, max?: number): number[] {
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
  node,
  illegalCodes,
  catalogByCode,
  onDrill,
}: {
  node: AuditNode;
  illegalCodes: ReadonlySet<string>;
  catalogByCode: Map<string, Course>;
  onDrill?: DrillFn;
}) {
  const r = node.ruleNode;
  if (r.kind !== "subjectPool") return null;
  const subjects = r.subjectCodes.map((s) => s.toUpperCase());
  const levelText = formatLevelRange(r.minLevel, r.maxLevel);
  const unitBased = r.needUnits !== undefined;
  const { needed, satisfied } = nodeProgress(node);
  const remaining = Math.max(0, needed - satisfied);
  const chosenCodes = [...new Set(node.satisfiers.map((p) => p.code))];

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

  if (isSatisfied(node)) {
    return (
      <Recede title={title} meta={`${fmt(needed)}/${fmt(needed)}`}>
        {chips}
      </Recede>
    );
  }

  const pct =
    needed > 0 ? Math.min(Math.round((satisfied / needed) * 100), 100) : 100;
  return (
    <StatusCard
      tone={satisfied > 0 ? "partial" : "missing"}
      lead={<RingLead pct={pct} num={fmt(satisfied)} />}
      title={title}
      pill={
        satisfied > 0 ? (
          <StatusPill variant="progress" label="In progress" />
        ) : undefined
      }
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
      {onDrill ? (
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
    </StatusCard>
  );
}
