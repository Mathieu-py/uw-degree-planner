import { describe, expect, it } from "vitest";
import { MATH_SUBJECTS, type UnitBucket } from "../../programs";
import { bucketTitle } from "../labels";

function bucket(
  scope: UnitBucket["scope"],
  label = "verbatim source",
): UnitBucket {
  return { id: "b", label, requiredUnits: 1, scope };
}

describe("bucketTitle", () => {
  it("names each program-scope kind concisely", () => {
    expect(bucketTitle(bucket({ kind: "required" }), "program")).toBe(
      "Required courses",
    );
    expect(bucketTitle(bucket({ kind: "open" }), "program")).toBe(
      "Free electives",
    );
    expect(bucketTitle(bucket({ kind: "list", courses: [] }), "program")).toBe(
      "Approved courses",
    );
    expect(
      bucketTitle(bucket({ kind: "subject", subjects: ["anth"] }), "program"),
    ).toBe("ANTH courses");
  });

  it("recognises the math subject set and its complement", () => {
    expect(
      bucketTitle(
        bucket({ kind: "subject", subjects: [...MATH_SUBJECTS] }),
        "program",
      ),
    ).toBe("Math courses");
    expect(
      bucketTitle(
        bucket({ kind: "subjectExcept", exclude: [...MATH_SUBJECTS] }),
        "program",
      ),
    ).toBe("Non-math courses");
  });

  it("annotates a subject minimum level", () => {
    expect(
      bucketTitle(
        bucket({ kind: "subject", subjects: ["hist"], minLevel: 300 }),
        "program",
      ),
    ).toBe("HIST courses (300-level+)");
  });

  it("distils a readable noun phrase for unscoped buckets, and passes degree breadth through", () => {
    // The noun after "N units of", with the unit prefix and trailing qualifier
    // clauses dropped — but no scope is assigned (the bucket stays unscoped).
    expect(
      bucketTitle(
        bucket({ kind: "unscoped" }, "8.0 units of Science courses."),
        "program",
      ),
    ).toBe("Science courses");
    expect(
      bucketTitle(
        bucket(
          { kind: "unscoped" },
          "9.5 units of Science and Mathematics courses, including the Undergraduate Communication Requirement course, listed below.",
        ),
        "program",
      ),
    ).toBe("Science and Mathematics courses");
    // No "units of" anchor → fall back to the whole label, gracefully.
    expect(
      bucketTitle(
        bucket({ kind: "unscoped" }, "Residency requirement"),
        "program",
      ),
    ).toBe("Residency requirement");
    // Breadth buckets already carry clean labels — pass them through untouched.
    expect(
      bucketTitle(
        bucket(
          { kind: "subject", subjects: ["a", "b"] },
          "Breadth — Humanities",
        ),
        "degree",
      ),
    ).toBe("Breadth — Humanities");
  });
});
