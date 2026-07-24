import { expect, test } from "@playwright/test";

// Headers apply to every route (next.config source: "/(.*)"), so sample a few
// to catch route-specific regressions. Assert only keys stable across dev and
// prod builds — the e2e server is `pnpm dev`, where next.config headers() also
// applies.
for (const route of ["/", "/legal"]) {
  test(`security headers are served on ${route}`, async ({ page }) => {
    const response = await page.goto(route);
    const headers = response?.headers() ?? {};

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["x-powered-by"]).toBeUndefined();
  });
}
