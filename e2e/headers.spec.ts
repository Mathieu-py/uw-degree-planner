import { expect, test } from "@playwright/test";

// Assert only keys stable across dev and prod builds — the e2e server is
// `pnpm dev`, where next.config headers() also applies.
test("security headers are served on every response", async ({ page }) => {
  const response = await page.goto("/");
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
