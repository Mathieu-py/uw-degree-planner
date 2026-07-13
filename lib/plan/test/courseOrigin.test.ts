import { describe, expect, it } from "vitest";
import { makeTermId } from "@/lib/terms";
import { buildCourseOrigin, parseCourseOrigin } from "../courseOrigin";

const FALL_2025 = makeTermId(2025, "Fall"); // 1259

describe("buildCourseOrigin", () => {
  it("returns an empty string when nothing is set", () => {
    expect(buildCourseOrigin({})).toBe("");
  });

  it("emits `from` on its own", () => {
    expect(buildCourseOrigin({ from: "catalog" })).toBe("?from=catalog");
  });

  it("omits absent parts", () => {
    expect(buildCourseOrigin({ from: "plan", planId: "p1" })).toBe(
      "?from=plan&planId=p1",
    );
  });

  it("emits the full picker contract", () => {
    expect(
      buildCourseOrigin({ from: "picker", planId: "p1", term: FALL_2025 }),
    ).toBe(`?from=picker&planId=p1&term=${FALL_2025}`);
  });
});

describe("parseCourseOrigin", () => {
  it("round-trips a picker origin", () => {
    expect(
      parseCourseOrigin({
        from: "picker",
        planId: "p1",
        term: String(FALL_2025),
      }),
    ).toEqual({ from: "picker", planId: "p1", term: FALL_2025 });
  });

  it("drops an unknown `from`", () => {
    expect(parseCourseOrigin({ from: "bogus" }).from).toBeUndefined();
  });

  it("keeps a valid calendar term", () => {
    expect(parseCourseOrigin({ term: String(FALL_2025) }).term).toBe(FALL_2025);
  });

  it("drops a non-numeric or out-of-scheme term", () => {
    expect(parseCourseOrigin({ term: "abc" }).term).toBeUndefined();
    expect(parseCourseOrigin({ term: "9999" }).term).toBeUndefined(); // out of range
    expect(parseCourseOrigin({ term: "1250" }).term).toBeUndefined(); // bad season digit
  });

  it("treats an empty planId as absent", () => {
    expect(parseCourseOrigin({ planId: "" }).planId).toBeUndefined();
  });
});
