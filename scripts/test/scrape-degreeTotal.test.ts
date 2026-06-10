import { describe, expect, it } from "vitest";
import { resolveDegreeTotalUnits } from "../scrape/degreeTotal";

describe("resolveDegreeTotalUnits", () => {
  it("overrides an honours major subtotal with the whole-degree total", () => {
    // h-sociology: page lists 8.0 (the major) but links to the 20.0 BA degree.
    expect(
      resolveDegreeTotalUnits("h-sociology", "Sociology (BA - Honours)", 8, {
        honoursTotal: 20,
      }),
    ).toBe(20);
  });

  it("uses the three-year total for a `3g-` program", () => {
    expect(
      resolveDegreeTotalUnits(
        "3g-sociology",
        "Sociology (BA - Three-Year General)",
        6,
        { generalTotal: 15, honoursTotal: 20 },
      ),
    ).toBe(15);
  });

  it("prefers the four-year total for a `4g-` program", () => {
    expect(
      resolveDegreeTotalUnits("4g-x", "X (BA - Four-Year General)", 8, {
        fourYearTotal: 20,
        generalTotal: 15,
        honoursTotal: 20,
      }),
    ).toBe(20);
  });

  it("never overrides a Joint Honours half-degree's own stated partial total", () => {
    // e.g. a Science joint plan that lists 12.75 on its own page.
    expect(
      resolveDegreeTotalUnits("jh-x", "X (Joint Honours)", 12, {
        honoursTotal: 20,
      }),
    ).toBe(null);
  });

  it("still propagates the degree total to a Joint Honours that states none", () => {
    // e.g. Math joint honours, whose 20.0 lives only on the BMath degree page.
    expect(
      resolveDegreeTotalUnits("jh-statistics", "Statistics (Joint Honours)", undefined, {
        honoursTotal: 20,
      }),
    ).toBe(20);
  });

  it("never shrinks a stated total larger than the degree total", () => {
    // Guards against a mis-parsed degree total clobbering a dense honours plan.
    expect(
      resolveDegreeTotalUnits("h-x", "X (BA - Honours)", 21, {
        honoursTotal: 20,
      }),
    ).toBe(null);
  });

  it("fills the degree total when the program states none (original behaviour)", () => {
    expect(
      resolveDegreeTotalUnits("h-x", "X (BA - Honours)", undefined, {
        honoursTotal: 20,
      }),
    ).toBe(20);
  });

  it("returns null when no degree total was parsed", () => {
    expect(resolveDegreeTotalUnits("h-x", "X (BA - Honours)", 8, {})).toBe(null);
  });
});
