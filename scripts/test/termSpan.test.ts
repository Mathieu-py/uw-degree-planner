import { describe, expect, it } from "vitest";
import type { Program } from "../../lib/programs";
import {
  deriveNumberOfTerms,
  termSpanFromUnits,
} from "../scrape/program/termSpan";

/** Minimal flexible-program stub — derivation only reads name + unitPlan. */
function flex(name: string, totalUnits?: number): Program {
  return {
    kind: "flexible",
    name,
    asOf: "2026-06-10",
    rules: { kind: "all", children: [] },
    ...(totalUnits != null ? { unitPlan: { totalUnits } } : {}),
  } as Program;
}

describe("termSpanFromUnits", () => {
  it("maps a full-time year (~5 units) to two terms, clamped to [2, 8]", () => {
    expect(termSpanFromUnits(15)).toBe(6); // three-year general
    expect(termSpanFromUnits(20)).toBe(8); // four-year
    expect(termSpanFromUnits(21)).toBe(8); // dense honours, still 4 years
    expect(termSpanFromUnits(26)).toBe(8); // 5-year double degree → clamped
  });
});

describe("deriveNumberOfTerms", () => {
  it("engineering is always 8 (structurally 1A–4B)", () => {
    const eng = {
      kind: "engineering",
      name: "Systems Design Engineering (BASc - Honours)",
      asOf: "2026-06-10",
      terms: {},
    } as unknown as Program;
    expect(deriveNumberOfTerms(eng)).toBe(8);
  });

  it("a single Three-Year General degree is 6, even with a mis-propagated total", () => {
    expect(
      deriveNumberOfTerms(flex("Anthropology (BA - Three-Year General)", 15)),
    ).toBe(6);
    // english-language-and-literature: name says three-year but total leaked 20.
    expect(
      deriveNumberOfTerms(flex("English (BA - Three-Year General)", 20)),
    ).toBe(6);
  });

  it("a double degree naming a three-year leg runs as long as its honours leg", () => {
    expect(
      deriveNumberOfTerms(
        flex(
          "SDS and Social Work Double Degree (BA - Three-Year General and BSW - Honours)",
          20,
        ),
      ),
    ).toBe(8);
  });

  it("holds an Honours / Four-Year clause at 8 over the unit total", () => {
    expect(
      deriveNumberOfTerms(flex("Gender and Social Justice (BA - Honours)", 20)),
    ).toBe(8);
    expect(
      deriveNumberOfTerms(
        flex("Peace and Conflict (BA - Four-Year General)", 20),
      ),
    ).toBe(8);
    // A joint honours' total is only its half of the degree (12.75 ⇒ 6 by units
    // alone); the clause overrides it.
    expect(deriveNumberOfTerms(flex("Physics (Joint Honours)", 12.75))).toBe(8);
  });

  it("falls back to 8 when, with no credential clause, units are missing or artifact-low", () => {
    expect(deriveNumberOfTerms(flex("Peace and Conflict (BA)", 8))).toBe(8);
    expect(deriveNumberOfTerms(flex("Some Program (BA)"))).toBe(8);
  });
});
