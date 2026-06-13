import { describe, expect, it } from "vitest";
import { parseAdditionalConstraints } from "../scrape/programs-parser";

describe("parseAdditionalConstraints", () => {
  it("returns [] for empty / undefined input", () => {
    expect(parseAdditionalConstraints(undefined)).toEqual([]);
    expect(parseAdditionalConstraints("")).toEqual([]);
    expect(parseAdditionalConstraints("   ")).toEqual([]);
  });

  it("emits one tag-free informational item per top-level <li>", () => {
    const html =
      "<ol><li>Undergraduates are not allowed to enrol in 600-level courses.</li>" +
      "<li>List 1: CS 600-/700-level courses may be taken only with special " +
      "permission from the instructor and a CS academic advisor.</li></ol>";
    const items = parseAdditionalConstraints(html);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.label === "Additional constraint")).toBe(true);
    expect(items[0].text).toBe(
      "Undergraduates are not allowed to enrol in 600-level courses.",
    );
    expect(items[1].text).toContain("special permission");
    // Tags are stripped.
    expect(items.some((i) => i.text.includes("<"))).toBe(false);
  });

  it("keeps a nested sub-list with its parent heading (one item, not split)", () => {
    const html =
      "<ol><li>Elective Requirement:<ol><li>one Arts elective</li>" +
      "<li>one Science elective</li></ol></li></ol>";
    const items = parseAdditionalConstraints(html);
    expect(items).toHaveLength(1);
    expect(items[0].text).toContain("Elective Requirement:");
    expect(items[0].text).toContain("one Arts elective");
    expect(items[0].text).toContain("one Science elective");
  });

  it("strips anchor markup but keeps the link text", () => {
    const html =
      '<ol><li>See <a href="#/x">Course Subjects Offered</a> for details.</li></ol>';
    const items = parseAdditionalConstraints(html);
    expect(items[0].text).toBe("See Course Subjects Offered for details.");
  });

  it("falls back to paragraphs when there is no list", () => {
    const html = "<p>First note.</p><p>Second note.</p>";
    const items = parseAdditionalConstraints(html);
    expect(items.map((i) => i.text)).toEqual(["First note.", "Second note."]);
  });

  it("falls back to the whole cleaned blob when there is neither list nor <p>", () => {
    const items = parseAdditionalConstraints("Just  some   prose.");
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("Just some prose.");
  });
});
