import { expect, test } from "@playwright/test";

test("planner front door renders empty state with manual-setup form", async ({
  page,
}) => {
  // Empty localStorage on a fresh Playwright context → planner shows the
  // empty state (upload-transcript card + manual-setup form).
  await page.goto("/plan");

  await expect(
    page.getByRole("heading", { name: "Plan your degree" }),
  ).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Upload your Quest transcript" }),
  ).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Or set up manually" }),
  ).toBeVisible();

  await expect(
    page.getByRole("button", { name: "Create empty plan" }),
  ).toBeVisible();
});

test("creating an empty plan via manual setup renders the timeline", async ({
  page,
}) => {
  await page.goto("/plan");

  // Manual setup form is the second card. The defaults (first program in
  // the list, Fall 2023 start, Regular stream) are valid out of the box —
  // we just click through.
  await page.getByRole("button", { name: "Create empty plan" }).click();

  // After creation: the "Reset plan" button appears in the planner header,
  // and the empty-state form is gone.
  await expect(page.getByRole("button", { name: "Reset plan" })).toBeVisible();

  // At least one academic term column rendered — the regular cadence puts
  // 1A in the first position.
  await expect(page.getByText("1A", { exact: true }).first()).toBeVisible();
});
