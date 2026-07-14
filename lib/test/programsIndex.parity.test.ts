import { describe, expect, it } from "vitest";
import committedIndex from "../../data/programs-index.json";
import { buildProgramIndex } from "../../scripts/build-program-index";
import { PROGRAMS } from "../programsRegistry";

// The client index (programsMeta) and the server registry are generated from
// the same data/programs.json, but only the scraper chains the two writes —
// a hand edit or a forgotten `pnpm build-program-index` would silently skew
// term spans, identity matching, and transcript matching on the client.
describe("programs-index.json parity", () => {
  it("matches an index rebuilt from data/programs.json (fix: pnpm build-program-index)", () => {
    expect(committedIndex).toEqual(buildProgramIndex(PROGRAMS));
  });
});
