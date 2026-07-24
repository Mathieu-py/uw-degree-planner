import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySeating, refreshSeating } from "../build-catalog";

// A valid snapshot carrying non-section fields (units/crossListed/prereqAst)
// that a seats-only refresh must preserve. Fresh object per call.
function snapshot() {
  return {
    termId: 1269,
    fetchedAt: "2026-01-01T00:00:00.000Z",
    courseCount: 2,
    courses: [
      {
        id: 1,
        code: "cs135",
        name: "Designing Functional Programs",
        prereqs: null,
        coreqs: null,
        antireqs: null,
        rating: null,
        sections: [{ id: 1, enrollment_total: 5, enrollment_capacity: 20 }],
        units: 0.5,
        crossListed: ["cs145"],
        prereqAst: { kind: "course" as const, code: "cs115" },
      },
      {
        id: 2,
        code: "math135",
        name: "Algebra",
        prereqs: null,
        coreqs: null,
        antireqs: null,
        rating: null,
        sections: [],
      },
    ],
  };
}

const fresh = [{ id: 9, enrollment_total: 3, enrollment_capacity: 10 }];

describe("applySeating", () => {
  it("replaces sections but preserves every other field", () => {
    const out = applySeating(
      snapshot(),
      { cs135: fresh },
      "2030-01-01T00:00:00.000Z",
    );
    expect(out.courses[0].sections).toEqual(fresh);
    expect(out.courses[0].units).toBe(0.5);
    expect(out.courses[0].crossListed).toEqual(["cs145"]);
    expect(out.courses[0].prereqAst).toEqual({ kind: "course", code: "cs115" });
    expect(out.courses[0].name).toBe("Designing Functional Programs");
    expect(out.courses[1].sections).toEqual([]); // absent from map → emptied
    expect(out.termId).toBe(1269);
    expect(out.fetchedAt).toBe("2030-01-01T00:00:00.000Z");
  });
});

describe("refreshSeating", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "seats-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const write = (term: number, obj: unknown) =>
    writeFileSync(path.join(dir, `courses.${term}.json`), JSON.stringify(obj));
  const read = (term: number) =>
    JSON.parse(readFileSync(path.join(dir, `courses.${term}.json`), "utf-8"));

  it("refuses an empty upstream seating map and leaves the snapshot untouched", async () => {
    write(1269, snapshot());
    await expect(refreshSeating(1269, {}, dir)).rejects.toThrow(
      /refusing to overwrite/,
    );
    expect(read(1269).courses[0].sections).toHaveLength(1); // original intact
  });

  it("throws an actionable error on a missing snapshot", async () => {
    await expect(refreshSeating(9999, { cs135: fresh }, dir)).rejects.toThrow(
      /No usable snapshot/,
    );
  });

  it("throws on an invalid snapshot", async () => {
    writeFileSync(path.join(dir, "courses.1269.json"), "{ not valid json");
    await expect(refreshSeating(1269, { cs135: fresh }, dir)).rejects.toThrow(
      /No usable snapshot/,
    );
  });

  it("patches sections into a valid snapshot, preserving other fields", async () => {
    write(1269, snapshot());
    const res = await refreshSeating(1269, { cs135: fresh }, dir);
    expect(res.withSeating).toBe(1);
    const after = read(1269);
    expect(after.courses[0].sections).toEqual(fresh);
    expect(after.courses[0].units).toBe(0.5); // preserved
    expect(after.courses[1].sections).toEqual([]); // absent from map
  });
});
