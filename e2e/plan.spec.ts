import { expect, test } from "@playwright/test";

test("planner front door renders empty state with manual-setup form", async ({
  page,
}) => {
  // Empty localStorage on a fresh Playwright context → planner shows the
  // empty state (upload-transcript card + manual-setup form). The page-
  // level "Plan your degree" h1 was dropped in the PR-3 IU refactor (the
  // PlannerToolbar now owns the active-plan label); the EmptyState's two
  // section headings + the Create button are the durable front-door anchors.
  await page.goto("/plan");

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

  // After creation: the "Edit plan" dropdown trigger appears in the planner
  // header (the IU refactor folded Reset plan into this menu), and the
  // empty-state form is gone.
  await expect(page.getByRole("button", { name: "Edit plan" })).toBeVisible();

  // At least one academic term column rendered — the regular cadence puts
  // 1A in the first position.
  await expect(page.getByText("1A", { exact: true }).first()).toBeVisible();
});

test("opening the slot picker on an empty 1A slot lets the user add a course", async ({
  page,
}) => {
  await page.goto("/plan");
  await page.getByRole("button", { name: "Create empty plan" }).click();

  // The first slot's "+ Add course" affordance opens the SlotPicker modal.
  await page
    .getByRole("button", { name: /add course/i })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByPlaceholder(/search by code or name/i)).toBeVisible();

  // Type to narrow the catalog. CS 115 is one of the most common 1A
  // courses across UW programs and is reliably present in the snapshot.
  await page.getByPlaceholder(/search by code or name/i).fill("cs 115");

  // Click the first matching row; the picker calls onPick which closes
  // the modal and adds the course to the slot.
  await page
    .getByRole("button", { name: /CS\s*115/ })
    .first()
    .click();

  await expect(page.getByRole("dialog")).not.toBeVisible();
  // CS 115 now appears as a placed course inside the 1A slot column.
  await expect(page.getByText("cs115", { exact: true })).toBeVisible();
});

// Transcript-upload scenario intentionally deferred: faithfully reproducing a
// Quest unofficial PDF requires a bytestream the project doesn't ship.
// We have unit + integration coverage for the parser and transcriptApply
// pipeline; an e2e on a fixture PDF will land alongside the next data drop.
