import { describe, expect, it } from "vitest";
import { UNIT_EPS } from "../../format";
import type { Program } from "../../programs";
import { deriveElectiveSections } from "../electives";
import { int, lcg, pick, type Rand, shuffle } from "./fuzzRand";
import { progressOf } from "./helpers";

/**
 * Integration fuzz: random unit-pool programs × random plans, end-to-end
 * through compile + progress. No oracle — instead the invariants that must
 * hold for ANY input, chiefly order-independence (the #121 bug class: a
 * satisfiable plan reading 99% because of elective/course order).
 */

const SUBJECTS = ["cs", "math", "stat", "phys"] as const;
const LEVELS = [201, 250, 301, 350] as const;

const poolProse = (units: number, subjects: readonly string[]) =>
  `Complete a minimum of ${units} unit of ${subjects
    .map((s) => s.toUpperCase())
    .join(" or ")} courses at the 200-level or above`;

/**
 * ≤3 pools and ≤8 placed courses keeps the solver inside its guards even with
 * every course contested (worst tree ≈ 4^8 ≪ node budget), so BOTH objective
 * dimensions — total shortfall, then total consumed weight — are optimal.
 * Optimal totals are order-independent, hence so are pct/creditedUnits.
 * Weights stay on the quarter grid, so unit sums are exact in floats and
 * strict equality is safe.
 */
function randomScenario(rand: Rand) {
  const raw = Array.from({ length: int(rand, 1, 3) }, () => ({
    units: pick(rand, [0.5, 1.0, 1.5] as const),
    subjects: shuffle(rand, [...SUBJECTS]).slice(0, int(rand, 1, 2)),
  }));
  // Drop exact duplicates so section derivation can't merge/disambiguate them.
  const seen = new Set<string>();
  const poolSpecs = raw.filter((p) => {
    const k = `${p.units}|${p.subjects.join(",")}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const program: Program = {
    kind: "flexible",
    name: "Fuzz",
    asOf: "2026",
    rules: { kind: "all", children: [] },
    electives: poolSpecs.map((p) => ({
      description: poolProse(p.units, p.subjects),
    })),
    unitPlan: { totalUnits: poolSpecs.reduce((s, p) => s + p.units, 0) },
  };
  const universe = SUBJECTS.flatMap((s) => LEVELS.map((l) => `${s}${l}`));
  const weight = new Map(
    universe.map((c) => [c, pick(rand, [0.25, 0.5, 1.0])]),
  );
  const codes = shuffle(rand, universe)
    .filter(() => rand() < 0.5)
    .slice(0, 8);
  return { program, codes, unitsOf: (c: string) => weight.get(c) ?? 0.5 };
}

describe("computeDegreeProgress — integration fuzz", () => {
  it("generated prose parses into subjectPool sections (fuzz is honest)", () => {
    // If the templates ever stop parsing, every invariant below would pass
    // vacuously on empty pools — this canary fails loudly instead.
    const { program } = randomScenario(lcg(1234567));
    const sections = deriveElectiveSections(program);
    expect(sections.length).toBe(program.electives?.length ?? 0);
    for (const s of sections) expect(s.kind).toBe("subjectPool");
  });

  it("end-to-end anchor: a pool shortfall yields a known pct", () => {
    // One "1.0 unit CS" pool, 0.5 CS placed + an off-subject 0.5 with no free
    // room: credited 0.5 of denom 1.0 → 50%, incomplete. Pins the pool phase
    // active through compile + progress — the section-parsing canary above
    // can't detect pools silently dropped inside the pipeline.
    const program: Program = {
      kind: "flexible",
      name: "Anchor",
      asOf: "2026",
      rules: { kind: "all", children: [] },
      electives: [{ description: poolProse(1.0, ["cs"]) }],
      unitPlan: { totalUnits: 1.0 },
    };
    const p = progressOf(program, ["cs201", "phys201"], () => 0.5);
    expect(p.pct).toBe(50);
    expect(p.allComplete).toBe(false);
  });

  it("invariants + order-independence over 150 random programs/plans", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const rand = lcg(seed * 2654435761 + 11);
      const { program, codes, unitsOf } = randomScenario(rand);
      const p = progressOf(program, codes, unitsOf);

      // Conservation: credit can never exceed the real placed volume (a
      // double-credited course would break this; the output's own clamps
      // can't).
      const placedVolume = codes.reduce((s, c) => s + unitsOf(c), 0);
      expect(p.creditedUnits, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(p.creditedUnits, `seed ${seed}`).toBeLessThanOrEqual(
        placedVolume + UNIT_EPS,
      );
      expect(p.creditedUnits, `seed ${seed}`).toBeLessThanOrEqual(
        p.denom + UNIT_EPS,
      );
      if (p.pct === 100) expect(p.allComplete, `seed ${seed}`).toBe(true);

      // The #121 property: shuffling electives and plan order must not move
      // the audit. (Quarter-grid weights ⇒ exact float sums ⇒ strict equality.)
      const shuffledProgram: Program = {
        ...program,
        electives: shuffle(rand, program.electives ?? []),
      };
      const q = progressOf(shuffledProgram, shuffle(rand, codes), unitsOf);
      expect(q.pct, `seed ${seed}: order changed pct`).toBe(p.pct);
      expect(q.creditedUnits, `seed ${seed}: order changed credit`).toBe(
        p.creditedUnits,
      );
      expect(q.allComplete, `seed ${seed}: order changed completion`).toBe(
        p.allComplete,
      );
    }
  });

  it("stays sane past the solver guard (12 heavily overlapping pools)", () => {
    // Every course is eligible for ~6 of the 12 pools, so contested count (40)
    // exceeds maxContested and assignUnitPools falls back to greedy inside the
    // audit. With abundant uniform supply greedy still completes the degree;
    // order-independence is deliberately NOT asserted here (greedy is
    // order-sensitive by design — that's what the guard trades away).
    const electives = Array.from({ length: 12 }, (_, i) => ({
      description: poolProse(i % 3 ? 1.0 : 0.5, [
        SUBJECTS[i % 4],
        SUBJECTS[(i + 1) % 4],
      ]),
    }));
    const program: Program = {
      kind: "flexible",
      name: "Guard stress",
      asOf: "2026",
      rules: { kind: "all", children: [] },
      electives,
      unitPlan: { totalUnits: 10.0 }, // 4×0.5 + 8×1.0
    };
    const universe = SUBJECTS.flatMap((s) =>
      Array.from({ length: 10 }, (_, k) => `${s}${200 + k}`),
    ); // 40 × 0.5 = 20 units of supply for 10 of demand
    const p = progressOf(program, universe, () => 0.5);
    expect(p.pct).toBe(100);
    expect(p.allComplete).toBe(true);
  });
});
