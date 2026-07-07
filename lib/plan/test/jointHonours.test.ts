import { describe, expect, it } from "vitest";
import { PROGRAMS } from "@/lib/programs";
import {
  isHonours,
  isJointHonours,
  jointHonoursWarning,
  unpairedJointHonours,
} from "../jointHonours";

describe("isJointHonours", () => {
  it("flags plans that carry 'Joint Honours' in the name", () => {
    expect(isJointHonours(PROGRAMS["jh-physics"])).toBe(true);
  });

  it("flags Joint Honours plans WITHOUT the jh- id prefix", () => {
    // Both have the credential in the name but a non-jh- id — name detection
    // is why we don't key on the prefix.
    expect(isJointHonours(PROGRAMS["earth-sciences"])).toBe(true);
    expect(isJointHonours(PROGRAMS["science-with-arts-major"])).toBe(true);
  });

  it("does not flag honours / general plans", () => {
    for (const id of Object.keys(PROGRAMS)) {
      const program = PROGRAMS[id];
      if (/joint honours/i.test(program.name)) continue;
      expect(isJointHonours(program)).toBe(false);
    }
  });
});

describe("isHonours", () => {
  it("is true for an Honours plan and for a Joint Honours plan", () => {
    expect(isHonours(PROGRAMS["h-chemistry"])).toBe(true);
    expect(isHonours(PROGRAMS["jh-physics"])).toBe(true);
  });

  it("is false for General and professional plans (no valid partner)", () => {
    expect(isHonours(PROGRAMS["3g-psychology"])).toBe(false);
    expect(isHonours(PROGRAMS["4g-history"])).toBe(false);
    expect(isHonours(PROGRAMS.optometry)).toBe(false);
  });
});

describe("unpairedJointHonours", () => {
  it("returns the lone Joint Honours plan when it's the only program", () => {
    expect(unpairedJointHonours(["jh-physics"])?.name).toContain("Physics");
  });

  it("clears once an honours-level partner is added", () => {
    expect(unpairedJointHonours(["jh-physics", "h-chemistry"])).toBeNull();
    expect(unpairedJointHonours(["jh-physics", "jh-mathematics"])).toBeNull();
  });

  it("does not treat a duplicated id as its own partner", () => {
    // Same plan listed twice is still half a degree — the second copy must not
    // satisfy the honours-partner check.
    expect(
      unpairedJointHonours(["jh-physics", "jh-physics"])?.name,
    ).toContain("Physics");
  });

  it("stays unpaired when the only partner is a General plan", () => {
    // A Three-/Four-Year General plan is neither joint nor honours.
    expect(
      unpairedJointHonours(["jh-physics", "3g-psychology"])?.name,
    ).toContain("Physics");
    expect(unpairedJointHonours(["jh-physics", "4g-history"])?.name).toContain(
      "Physics",
    );
  });

  it("returns null for a single non-Joint-Honours plan", () => {
    expect(unpairedJointHonours(["h-physics"])).toBeNull();
  });

  it("returns null for an empty selection", () => {
    expect(unpairedJointHonours([])).toBeNull();
  });
});

describe("jointHonoursWarning", () => {
  it("names the subject and prompts for a partner", () => {
    expect(jointHonoursWarning(["jh-physics"])).toBe(
      "Joint Honours is only half a degree — pair Physics with a second honours plan to complete it.",
    );
  });

  it("is null once paired", () => {
    expect(jointHonoursWarning(["jh-physics", "h-chemistry"])).toBeNull();
  });
});
