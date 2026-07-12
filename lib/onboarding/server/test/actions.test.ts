import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub the `server-only` catalog module so the action imports under node; the
// guards under test short-circuit before loadTerm anyway.
vi.mock("@/lib/courses/data", () => ({ loadTerm: vi.fn(async () => []) }));

import { loadTerm } from "@/lib/courses/data";
import type { VariantSelection } from "@/lib/plan/variantPlacement";
import { placeVariantSelections } from "../actions";

const VALID_START = 1239; // Fall 2023 — a member of KNOWN_TERMS.

describe("placeVariantSelections hardening (#84)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns [] for an out-of-range startTermId instead of throwing", async () => {
    // 9999 has no valid term shape; unguarded, sequenceTerms throws → a 500.
    await expect(
      placeVariantSelections({
        programIds: [],
        startTermId: 9999,
        stream: "regular",
        selections: [{ code: "cs135", termLabel: null }],
      }),
    ).resolves.toEqual([]);
    expect(loadTerm).not.toHaveBeenCalled();
  });

  it("returns [] for an oversized selections payload without loading the catalog", async () => {
    const oversized: VariantSelection[] = Array.from(
      { length: 201 },
      (_, i) => ({
        code: `cs${100 + i}`,
        termLabel: null,
      }),
    );
    await expect(
      placeVariantSelections({
        programIds: [],
        startTermId: VALID_START,
        stream: "regular",
        selections: oversized,
      }),
    ).resolves.toEqual([]);
    // Short-circuited before the catalog read — work bounded.
    expect(loadTerm).not.toHaveBeenCalled();
  });
});
