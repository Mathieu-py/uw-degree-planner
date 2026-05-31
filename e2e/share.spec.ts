import { expect, test } from "@playwright/test";

test("a bogus share token returns 404 and the not-found page", async ({
  page,
}) => {
  // No matching share_token in the DB → loadSharedPlan returns null →
  // the page calls notFound(), so the route responds with HTTP 404.
  const res = await page.goto("/p/not-a-real-token");
  expect(res?.status()).toBe(404);

  // Custom not-found.tsx (ErrorScreen kind="404") copy.
  await expect(page.getByText(/page not found/i)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /couldn.t find that page/i }),
  ).toBeVisible();
});

// Needs a real Supabase plan sharing this token; CI runs against placeholder
// env with no seeding harness. Run locally with `E2E_SHARE_TOKEN=<token>
// pnpm test:e2e` (share a plan on your dev DB to get one); skipped otherwise.
// Unblocking in CI would need a Playwright global-setup that seeds via a
// service-role client.
const SEEDED_TOKEN = process.env.E2E_SHARE_TOKEN;
(SEEDED_TOKEN ? test : test.skip)(
  "a valid share token shows the read-only plan",
  async ({ page }) => {
    await page.goto(`/p/${SEEDED_TOKEN}`);

    // Header shows the read-only badge.
    await expect(page.getByText("Shared · read-only")).toBeVisible();

    // read-only enforcement: no course-adding affordances are rendered.
    await expect(page.getByRole("button", { name: /add course/i })).toHaveCount(
      0,
    );
  },
);
