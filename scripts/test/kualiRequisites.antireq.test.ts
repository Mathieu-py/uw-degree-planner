import { describe, expect, it } from "vitest";
import { parseKualiAntireqCodes } from "../scrape/kualiRequisites";

// Markup mirrors real Kuali `antirequisites` payloads (see CS245, CS136, CS200).
const courseLink = (id: string, code: string) =>
  `<li><span><a href="#/courses/view/${id}" target="_blank">${code}</a> <!-- -->-<!-- --> <!-- -->Some Title<!-- --> <span style="margin-left:5px">(0.50)</span></span></li>`;

const antireqList = (...links: string[]) =>
  `<div><div><div><ul><li data-test="ruleView-A"><div data-test="ruleView-A-result">Not completed nor concurrently enrolled in any of the following: <div><ul style="margin-top:5px;margin-bottom:5px">${links.join("")}</ul></div></div></li></ul></div></div></div>`;

describe("parseKualiAntireqCodes", () => {
  it("extracts a single named antirequisite course", () => {
    const html = antireqList(courseLink("65b27f613f91c708bb68e35a", "CS245E"));
    expect(parseKualiAntireqCodes(html)).toEqual(["cs245e"]);
  });

  it("extracts every named course, normalized and deduped", () => {
    const html = antireqList(
      courseLink("a", "CS 137"),
      courseLink("b", "CS138"),
      courseLink("c", "CS137"), // duplicate of the first, different id
    );
    expect(parseKualiAntireqCodes(html)).toEqual(["cs137", "cs138"]);
  });

  it("collects across multiple rule-view groups under one 'Complete all'", () => {
    const html = `<div><div><div><ul><li><span>Complete all of the following</span><ul><li data-test="ruleView-A.1"><div data-test="ruleView-A.1-result">Not completed nor concurrently enrolled in any of the following: <div><ul>${courseLink("a", "CS246E")}</ul></div></div></li><li data-test="ruleView-A.2"><div data-test="ruleView-A.2-result">Not completed nor concurrently enrolled in any of the following: <div><ul>${courseLink("b", "CS247")}</ul></div></div></li></ul></li></ul></div></div></div>`;
    expect(parseKualiAntireqCodes(html)).toEqual(["cs246e", "cs247"]);
  });

  it("ignores program restrictions in the antireqs field (CS200 'Not open to …')", () => {
    // The antireqs field sometimes carries an enrolment restriction whose links
    // point to PROGRAMS, not courses — those are not course antirequisites.
    const html = `<div><div><div><ul><li data-test="ruleView-A"><div data-test="ruleView-A-result">Not open to students enrolled in <span><a href="#/programs/view/69b9a1d" target="_blank">H-BBA &amp; BCS Double Degree</a>, <a href="#/programs/view/67cb0e1" target="_blank">H-Computer Science (BCS)</a></span></div></li></ul></div></div></div>`;
    expect(parseKualiAntireqCodes(html)).toEqual([]);
  });

  it("returns [] for empty/missing input", () => {
    expect(parseKualiAntireqCodes(null)).toEqual([]);
    expect(parseKualiAntireqCodes(undefined)).toEqual([]);
    expect(parseKualiAntireqCodes("")).toEqual([]);
    expect(parseKualiAntireqCodes("   ")).toEqual([]);
  });

  it("extracts anchor-less TEXT-form codes (AFM 205-style rules)", () => {
    // Kuali renders many antireq rules as plain text with no course anchor:
    // missing these silently drops a real antireq (and would let the
    // empty-list-is-authoritative contract erase it).
    expect(
      parseKualiAntireqCodes(
        "<div>Not completed any of the following: AFM204</div>",
      ),
    ).toEqual(["afm204"]);
    expect(
      parseKualiAntireqCodes(
        "<div>Not completed nor concurrently enrolled in AFM 273 or BUS 127W</div>",
      ),
    ).toEqual(["afm273", "bus127w"]);
  });

  it("dedupes a code present both as anchor and text", () => {
    const html = antireqList(courseLink("a", "CS137")).replace(
      "</div></li>",
      " Also listed as CS137.</div></li>",
    );
    expect(parseKualiAntireqCodes(html)).toEqual(["cs137"]);
  });

  it("ignores prose that is not an all-caps course code", () => {
    // Case-sensitive subject match: "Fall 2015" and years never read as codes.
    expect(
      parseKualiAntireqCodes(
        "<div>CS245 taken in Fall 2015 or later; see the calendar from 2015 onward</div>",
      ),
    ).toEqual(["cs245"]);
  });
});
