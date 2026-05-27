import { expect, test } from "@playwright/test";

test("a bogus share token returns 404 and the not-found page", async ({
  page,
}) => {
  // No matching share_token in the DB → loadSharedPlan returns null →
  // the page calls notFound(), so the route responds with HTTP 404.
  const res = await page.goto("/p/not-a-real-token");
  expect(res?.status()).toBe(404);

  // Next.js default not-found page copy.
  await expect(page.getByText(/this page could not be found/i)).toBeVisible();
});

// Needs a plan seeded with a known share_token. The e2e suite runs against a
// live Supabase project with no seeding harness (see playwright.config.ts),
// so this is skipped until a fixture token is available.
test.skip("a valid share token shows the read-only plan", async ({ page }) => {
  const SEEDED_TOKEN = "REPLACE_WITH_SEEDED_TOKEN";
  await page.goto(`/p/${SEEDED_TOKEN}`);

  // Header shows the plan name and the read-only badge.
  await expect(page.getByText("Shared · read-only")).toBeVisible();

  // read-only enforcement: no course-adding affordances are rendered.
  await expect(page.getByRole("button", { name: /add course/i })).toHaveCount(
    0,
  );
});
