import { describe, expect, it } from "vitest";
import type { Program, Specialization } from "../../lib/programs";
import {
  attachSpecsToParents,
  buildSpecialization,
  collectUniqueSpecIds,
  type ProgramDetail,
  resolveSpecSlug,
  type SpecializationRef,
} from "../scrape-programs";

const fakeDetail = (overrides: Partial<ProgramDetail> = {}): ProgramDetail => ({
  pid: "spec-pid",
  code: "FOO-Example Specialization",
  title: "FOO-Example Specialization",
  ...overrides,
});

const fakeProgram = (): Program => ({
  kind: "flexible",
  name: "Test Program",
  asOf: "2026-01-01",
  rules: { kind: "all", children: [] },
});

const fakeSpec = (slug: string, kualiId: string): Specialization => ({
  slug,
  name: slug,
  kualiId,
});

const FLEX_HTML = `
  <section>
    <header><h2 data-testid="grouping-label"><span>Required Courses</span></h2></header>
    <div><div><ul>
      <li data-test="ruleView-A"><div data-test="ruleView-A-result">
        Complete all the following:
        <a href="#">FOO101</a> <a href="#">FOO102</a>
      </div></li>
    </ul></div></div>
  </section>`;

describe("collectUniqueSpecIds", () => {
  it("returns empty array for empty input", () => {
    expect(collectUniqueSpecIds(new Map())).toEqual([]);
  });

  it("returns each id once when no parent shares ids", () => {
    const refs = new Map<string, SpecializationRef[]>([
      [
        "parent-a",
        [
          { id: "spec1", name: "S1" },
          { id: "spec2", name: "S2" },
        ],
      ],
      ["parent-b", [{ id: "spec3", name: "S3" }]],
    ]);
    expect(collectUniqueSpecIds(refs).sort()).toEqual([
      "spec1",
      "spec2",
      "spec3",
    ]);
  });

  it("dedupes ids referenced by multiple parents (3 parents × same id → 1)", () => {
    const shared: SpecializationRef = { id: "shared", name: "Shared" };
    const refs = new Map<string, SpecializationRef[]>([
      ["parent-a", [shared]],
      ["parent-b", [shared]],
      ["parent-c", [shared, { id: "unique-c", name: "C" }]],
    ]);
    expect(collectUniqueSpecIds(refs).sort()).toEqual(["shared", "unique-c"]);
  });

  it("preserves insertion order based on first occurrence", () => {
    const refs = new Map<string, SpecializationRef[]>([
      ["parent-a", [{ id: "spec1", name: "S1" }]],
      [
        "parent-b",
        [
          { id: "spec2", name: "S2" },
          { id: "spec1", name: "S1 again" },
        ],
      ],
    ]);
    expect(collectUniqueSpecIds(refs)).toEqual(["spec1", "spec2"]);
  });
});

describe("resolveSpecSlug", () => {
  it("returns the base slug unchanged when no slot is taken", () => {
    expect(resolveSpecSlug("foo", "id-1", new Map())).toEqual({ slug: "foo" });
  });

  it("is idempotent when the same id already owns the base slug", () => {
    const taken = new Map([["foo", "id-1"]]);
    expect(resolveSpecSlug("foo", "id-1", taken)).toEqual({ slug: "foo" });
  });

  it("appends -2 when a different id already owns the base slug, with a warning", () => {
    const taken = new Map([["foo", "id-1"]]);
    const { slug, warning } = resolveSpecSlug("foo", "id-2", taken);
    expect(slug).toBe("foo-2");
    expect(warning).toContain("slug collision");
    expect(warning).toContain("id id-1");
    expect(warning).toContain("foo-2");
    expect(warning).toContain("id id-2");
  });

  it("appends -3 when both base and -2 are taken by other ids", () => {
    const taken = new Map([
      ["foo", "id-1"],
      ["foo-2", "id-2"],
    ]);
    const { slug } = resolveSpecSlug("foo", "id-3", taken);
    expect(slug).toBe("foo-3");
  });

  it("does not mutate the input map (caller is responsible for .set)", () => {
    const taken = new Map([["foo", "id-1"]]);
    resolveSpecSlug("foo", "id-2", taken);
    expect(taken.size).toBe(1);
    expect(taken.get("foo")).toBe("id-1");
  });
});

describe("buildSpecialization", () => {
  it("builds a flexible-shape spec from a flexible detail", () => {
    const taken = new Map<string, string>();
    const { spec, warnings } = buildSpecialization(
      fakeDetail({ requirements: FLEX_HTML }),
      "abc123",
      taken,
      "https://example.com/programs",
    );
    expect(spec.slug).toBe("foo-example");
    expect(spec.name).toBe("FOO-Example Specialization");
    expect(spec.kualiId).toBe("abc123");
    expect(spec.source).toBe("https://example.com/programs/view/abc123");
    expect(spec.rules?.kind).toBe("all");
    expect(warnings).toEqual([]);
    expect(taken.get("foo-example")).toBe("abc123");
  });

  it("falls back to code when title is missing on the Kuali response", () => {
    const taken = new Map<string, string>();
    const detail = {
      ...fakeDetail({ requirements: FLEX_HTML }),
      title: undefined,
    } as unknown as ProgramDetail;
    const { spec } = buildSpecialization(
      detail,
      "id-1",
      taken,
      "https://example.com/programs",
    );
    expect(spec.name).toBe("FOO-Example Specialization");
  });

  it("emits the unexpected-engineering warning and produces no rules when requiredCoursesTermByTerm is populated", () => {
    const ENG_HTML = `
      <section>
        <header><h2 data-testid="grouping-label"><span>1A Term</span></h2></header>
        <div><div><ul>
          <li data-test="ruleView-A"><div data-test="ruleView-A-result">
            Complete all the following: <a href="#">FOO101</a>
          </div></li>
        </ul></div></div>
      </section>`;
    const taken = new Map<string, string>();
    const { spec, warnings } = buildSpecialization(
      fakeDetail({ requiredCoursesTermByTerm: ENG_HTML }),
      "id-1",
      taken,
      "https://example.com/programs",
    );
    expect(warnings.some((w) => /unexpected kind:"engineering"/.test(w))).toBe(
      true,
    );
    expect(spec.rules).toBeUndefined();
  });

  it("emits a collision warning when the base slug is already taken", () => {
    const taken = new Map([["foo-example", "earlier-id"]]);
    const { spec, warnings } = buildSpecialization(
      fakeDetail({ requirements: FLEX_HTML }),
      "later-id",
      taken,
      "https://example.com/programs",
    );
    expect(spec.slug).toBe("foo-example-2");
    expect(warnings.some((w) => /slug collision/.test(w))).toBe(true);
    expect(taken.get("foo-example-2")).toBe("later-id");
    expect(taken.get("foo-example")).toBe("earlier-id");
  });

  it("omits rules when parse returns empty (no requirement fields)", () => {
    const taken = new Map<string, string>();
    const { spec } = buildSpecialization(
      fakeDetail({}),
      "id-1",
      taken,
      "https://example.com/programs",
    );
    expect(spec.rules).toBeUndefined();
    expect(spec.electives).toBeUndefined();
  });

  it("populates electives when graduationRequirements yields buckets", () => {
    const taken = new Map<string, string>();
    const { spec } = buildSpecialization(
      fakeDetail({
        requirements: FLEX_HTML,
        graduationRequirements: `<ul><li>2.0 units of approved courses.</li></ul>`,
      }),
      "id-1",
      taken,
      "https://example.com/programs",
    );
    expect(spec.electives).toEqual([
      { description: "2.0 units of approved courses", unitRequirement: 2.0 },
    ]);
  });

  it("url-encodes the id in source", () => {
    const taken = new Map<string, string>();
    const { spec } = buildSpecialization(
      fakeDetail({ requirements: FLEX_HTML }),
      "abc 123",
      taken,
      "https://example.com/programs",
    );
    expect(spec.source).toBe("https://example.com/programs/view/abc%20123");
  });
});

describe("attachSpecsToParents", () => {
  it("attaches specs in source order (parent's ref order, not specsById iteration order)", () => {
    const programs: Record<string, Program> = { parent: fakeProgram() };
    const refs = new Map<string, SpecializationRef[]>([
      [
        "parent",
        [
          { id: "id-2", name: "Two" },
          { id: "id-1", name: "One" },
          { id: "id-3", name: "Three" },
        ],
      ],
    ]);
    const specsById = new Map<string, Specialization>([
      ["id-1", fakeSpec("one", "id-1")],
      ["id-2", fakeSpec("two", "id-2")],
      ["id-3", fakeSpec("three", "id-3")],
    ]);
    const result = attachSpecsToParents(programs, refs, specsById);
    expect(programs.parent.specializations?.map((s) => s.slug)).toEqual([
      "two",
      "one",
      "three",
    ]);
    expect(result).toEqual({ parentsAttached: 1, specsAttached: 3 });
  });

  it("silently skips missing specs (failed Phase B fetches)", () => {
    const programs: Record<string, Program> = { parent: fakeProgram() };
    const refs = new Map<string, SpecializationRef[]>([
      [
        "parent",
        [
          { id: "id-1", name: "One" },
          { id: "missing", name: "Missing" },
          { id: "id-2", name: "Two" },
        ],
      ],
    ]);
    const specsById = new Map<string, Specialization>([
      ["id-1", fakeSpec("one", "id-1")],
      ["id-2", fakeSpec("two", "id-2")],
    ]);
    const result = attachSpecsToParents(programs, refs, specsById);
    expect(programs.parent.specializations?.map((s) => s.slug)).toEqual([
      "one",
      "two",
    ]);
    expect(result.specsAttached).toBe(2);
  });

  it("skips parents not present in the programs map (parent failed Phase A)", () => {
    const programs: Record<string, Program> = {};
    const refs = new Map<string, SpecializationRef[]>([
      ["missing-parent", [{ id: "id-1", name: "One" }]],
    ]);
    const specsById = new Map([["id-1", fakeSpec("one", "id-1")]]);
    const result = attachSpecsToParents(programs, refs, specsById);
    expect(result).toEqual({ parentsAttached: 0, specsAttached: 0 });
  });

  it("does NOT set the specializations key when all refs are missing", () => {
    const programs: Record<string, Program> = { parent: fakeProgram() };
    const refs = new Map<string, SpecializationRef[]>([
      ["parent", [{ id: "missing", name: "Missing" }]],
    ]);
    const result = attachSpecsToParents(programs, refs, new Map());
    expect(programs.parent.specializations).toBeUndefined();
    expect(result).toEqual({ parentsAttached: 0, specsAttached: 0 });
  });

  it("aggregates counts across multiple parents", () => {
    const programs: Record<string, Program> = {
      a: fakeProgram(),
      b: fakeProgram(),
    };
    const refs = new Map<string, SpecializationRef[]>([
      ["a", [{ id: "id-1", name: "One" }]],
      [
        "b",
        [
          { id: "id-1", name: "One" },
          { id: "id-2", name: "Two" },
        ],
      ],
    ]);
    const specsById = new Map([
      ["id-1", fakeSpec("one", "id-1")],
      ["id-2", fakeSpec("two", "id-2")],
    ]);
    const result = attachSpecsToParents(programs, refs, specsById);
    expect(result).toEqual({ parentsAttached: 2, specsAttached: 3 });
  });

  it("attaches the same Specialization instance shared across parents (no deep clone)", () => {
    // Cross-parent dedup relies on referential sharing — saves memory and
    // keeps JSON output consistent when the same spec is referenced by
    // multiple credential variants of the same program.
    const programs: Record<string, Program> = {
      a: fakeProgram(),
      b: fakeProgram(),
    };
    const shared = fakeSpec("shared", "id-shared");
    const specsById = new Map([["id-shared", shared]]);
    const refs = new Map<string, SpecializationRef[]>([
      ["a", [{ id: "id-shared", name: "Shared" }]],
      ["b", [{ id: "id-shared", name: "Shared" }]],
    ]);
    attachSpecsToParents(programs, refs, specsById);
    expect(programs.a.specializations?.[0]).toBe(
      programs.b.specializations?.[0],
    );
  });
});
