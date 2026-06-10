import { expect, type Page, test } from "@playwright/test";

// Demo (signed-out) plan creation now lives in the WelcomeFlow stepper at
// /plan/new. Visiting /plan with empty localStorage redirects there; the user
// picks program/term/stream (or imports a transcript), hits Continue → Review,
// then "Build my plan", which saves the local plan and routes back to /plan.
async function createDemoPlan(page: Page) {
  await page.goto("/plan");
  // Step 1 (Set up): the program picker is now a multi-select that starts
  // empty (issue #32 double-degree), so Continue is gated until at least one
  // program is chosen. Pick the first real option; Fall start and Regular
  // stream defaults are fine, then advance.
  await page.getByLabel("Add a program").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Continue" }).click();
  // Step 2 (Review): commit. Anon flow persists to localStorage and pushes /plan.
  await page.getByRole("button", { name: /build my plan/i }).click();
  // Wait for the redirect so callers don't race the navigation.
  await page.waitForURL("/plan");
}

test("planner front door redirects to the WelcomeFlow set-up stepper", async ({
  page,
}) => {
  // Empty localStorage on a fresh Playwright context → /plan has no demo plan,
  // so PlannerShell redirects to /plan/new. The stepper heading + the split
  // card's two column headings are the durable front-door anchors.
  await page.goto("/plan");
  await expect(page).toHaveURL(/\/plan\/new/);

  await expect(
    page.getByRole("heading", { name: "Let's set up your plan" }),
  ).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Upload your transcript" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Set up manually" }),
  ).toBeVisible();
});

test("building an empty plan via manual setup renders the timeline", async ({
  page,
}) => {
  await createDemoPlan(page);

  // Back on /plan: the demo planner header exposes "Import transcript", and the
  // regular cadence puts 1A in the first term column.
  await expect(
    page.getByRole("button", { name: /import transcript/i }),
  ).toBeVisible();
  await expect(page.getByText("1A", { exact: true }).first()).toBeVisible();
});

test("opening the slot picker on an empty 1A slot lets the user add a course", async ({
  page,
}) => {
  await createDemoPlan(page);

  // The first slot's "+ add course" affordance opens the SlotPicker modal.
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
  // CS 115 now appears as a placed course inside the 1A slot column. The chip
  // renders the formatted code ("CS 115"), not the raw catalog key ("cs115").
  await expect(page.getByText("CS 115", { exact: true })).toBeVisible();
});

// Build a double-degree demo plan: pick TWO programs in the set-up stepper.
// Selecting index 1 twice picks two distinct programs — ProgramMultiSelect
// filters already-chosen ones out of the option list, so the second pick lands
// on the next available program.
async function createDoubleDegreePlan(page: Page) {
  await page.goto("/plan");
  const programSelect = page.getByLabel("Add a program");
  await programSelect.selectOption({ index: 1 });
  await programSelect.selectOption({ index: 1 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /build my plan/i }).click();
  await page.waitForURL("/plan");
}

// Open the anon "Plan settings" modal (Edit plan dropdown → Plan settings).
async function openPlanSettings(page: Page) {
  await page.getByRole("button", { name: "Edit plan" }).click();
  await page.getByRole("button", { name: "Plan settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("double degree — both programs show, removing one prunes it, and the selection persists", async ({
  page,
}) => {
  await createDoubleDegreePlan(page);

  // The audit rail renders per-program (not one combined score), so a two-
  // program plan announces "2 programs" in the audit header.
  await expect(page.getByText("2 programs")).toBeVisible();

  // Plan settings lists both programs as removable chips.
  await openPlanSettings(page);
  const dialog = page.getByRole("dialog");
  const removeButtons = dialog.getByRole("button", { name: /^Remove / });
  await expect(removeButtons).toHaveCount(2);

  // Remember the program we keep (chip 2) so we can confirm it survives the
  // reload. The remove button's accessible name is `Remove <program name>`.
  const keptLabel = await removeButtons.nth(1).getAttribute("aria-label");
  const keptName = (keptLabel ?? "").replace(/^Remove /, "");
  expect(keptName.length).toBeGreaterThan(0);

  // Remove the primary program; the staged chip count drops to one and its
  // specialization is pruned (patchPrograms drops keys not in the new list).
  await removeButtons.first().click();
  await expect(dialog.getByRole("button", { name: /^Remove / })).toHaveCount(1);

  // Settings stages edits — commit with "Save changes". The modal then closes
  // and the audit falls back to a single-program view.
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("2 programs")).toBeHidden();

  // Reload: the surviving program persists (localStorage round trip).
  await page.reload();
  await page.waitForURL("/plan");
  await openPlanSettings(page);
  const reopened = page.getByRole("dialog");
  await expect(reopened.getByRole("button", { name: /^Remove / })).toHaveCount(
    1,
  );
  await expect(
    reopened.getByRole("button", { name: `Remove ${keptName}` }),
  ).toBeVisible();
});

// Transcript-upload scenario intentionally deferred: faithfully reproducing a
// Quest unofficial PDF requires a bytestream the project doesn't ship.
// We have unit + integration coverage for the parser and transcriptApply
// pipeline; an e2e on a fixture PDF will land alongside the next data drop.
