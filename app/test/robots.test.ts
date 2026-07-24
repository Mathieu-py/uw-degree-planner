import { describe, expect, it } from "vitest";
import { SITE_URL } from "@/lib/constants";
import robots from "../robots";

describe("robots", () => {
  it("points the sitemap at the canonical origin and disallows private surfaces", () => {
    const r = robots();
    expect(r.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
    const rules = r.rules as { allow: string; disallow: string[] };
    expect(rules.allow).toBe("/");
    expect(rules.disallow).toEqual(
      expect.arrayContaining(["/p/", "/api/", "/settings", "/auth/"]),
    );
  });
});
