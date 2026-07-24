import { expect, test } from "@playwright/test";

// E2E_PROD runs against `next build && next start`, where the production CSP
// differs from dev (no 'unsafe-eval', adds upgrade-insecure-requests).
const PROD = process.env.E2E_PROD === "1";

// Headers apply to every route (next.config source: "/(.*)"), so sample a few
// to catch route-specific regressions.
for (const route of ["/", "/legal"]) {
  test(`security headers are served on ${route}`, async ({ page }) => {
    const response = await page.goto(route);
    const headers = response?.headers() ?? {};
    const csp = headers["content-security-policy"] ?? "";

    // Stable across dev and prod.
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("geolocation=()");
    expect(headers["x-powered-by"]).toBeUndefined();
    for (const directive of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ]) {
      expect(csp).toContain(directive);
    }

    if (PROD) {
      // Prod-only: dev keeps 'unsafe-eval' (React stacks) and ws (HMR) and
      // skips upgrade-insecure-requests.
      expect(csp).toContain("upgrade-insecure-requests");
      expect(csp).not.toContain("'unsafe-eval'");
      expect(headers["strict-transport-security"]).toBe(
        "max-age=63072000; includeSubDomains",
      );
    }
  });
}

// When a Sentry DSN is configured (the prod job sets a placeholder), its ingest
// origin must be in connect-src so the browser SDK can POST events past the CSP.
test("CSP connect-src includes the Sentry origin when a DSN is set", async ({
  page,
}) => {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  test.skip(!dsn, "no Sentry DSN configured");
  const response = await page.goto("/");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("connect-src");
  // biome-ignore lint/style/noNonNullAssertion: guarded by test.skip above.
  expect(csp).toContain(new URL(dsn!).origin);
});
