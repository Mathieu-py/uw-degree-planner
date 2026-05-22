import { expect, test } from "@playwright/test";

test("browse page renders course list and filters respond", async ({
  page,
}) => {
  await page.goto("/browse");

  await expect(
    page.getByRole("heading", { name: "Browse electives" }),
  ).toBeVisible();

  const table = page.locator("table");
  await expect(table).toBeVisible();

  const dataRows = table.locator("tbody tr");
  const initialCount = await dataRows.count();
  expect(initialCount).toBeGreaterThan(0);

  const search = page.getByPlaceholder("Search by code or name");
  await search.fill("CS115");

  await expect(page.getByText(/of .* matches/)).toBeVisible();

  const filteredCount = await dataRows.count();
  expect(filteredCount).toBeLessThan(initialCount);
  expect(filteredCount).toBeGreaterThan(0);
});
