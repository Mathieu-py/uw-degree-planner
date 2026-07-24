import { describe, expect, it, vi } from "vitest";
import { SITE_URL } from "@/lib/constants";

// Stub the catalog read so the test doesn't couple to the ~10k-course snapshot.
vi.mock("@/lib/courses/data", () => ({
  loadTerm: vi.fn(async () => [{ code: "cs135" }, { code: "math135" }]),
}));

import sitemap from "../sitemap";

describe("sitemap", () => {
  it("emits canonical static entries and one URL per course, all under the origin", async () => {
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain(SITE_URL);
    expect(urls).toContain(`${SITE_URL}/catalog`);
    expect(urls).toContain(`${SITE_URL}/legal`);
    expect(urls).toContain(`${SITE_URL}/course/cs135`);
    expect(urls).toContain(`${SITE_URL}/course/math135`);
    for (const u of urls) expect(u.startsWith(SITE_URL)).toBe(true);
  });
});
