import { expect, type Page, test } from "@playwright/test";

// Demo (signed-out) plan creation now lives in the WelcomeFlow stepper at
// /plan/new. Visiting /plan with empty localStorage redirects there; the user
// picks program/term/stream (or imports a transcript), hits Continue → Review,
// then "Build my plan", which saves the local plan and routes back to /plan.
async function createDemoPlan(page: Page) {
  await page.goto("/plan");
  // Step 1 (Set up): the manual-setup defaults — first program, Fall start,
  // Regular stream — are valid out of the box, so advance straight through.
  await page.getByRole("button", { name: "Continue" }).click();
  // Step 2 (Review): commit. Anon flow persists to localStorage and pushes /plan.
  await page.getByRole("button", { name: /build my plan/i }).click();
}

test("planner front door redirects to the WelcomeFlow set-up stepper", async ({
  page,
}) => {
  // Empty localStorage on a fresh Playwright context → /plan has no demo plan,
  // so PlannerShell redirects to /plan/new. The stepper's headings + the
  // "Or set up manually" divider are the durable front-door anchors.
  await page.goto("/plan");
  await expect(page).toHaveURL(/\/plan\/new/);

  await expect(
    page.getByRole("heading", { name: "Let's set up your plan" }),
  ).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Start from your transcript" }),
  ).toBeVisible();

  await expect(page.getByText("Or set up manually")).toBeVisible();
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

// Transcript-upload scenario intentionally deferred: faithfully reproducing a
// Quest unofficial PDF requires a bytestream the project doesn't ship.
// We have unit + integration coverage for the parser and transcriptApply
// pipeline; an e2e on a fixture PDF will land alongside the next data drop.
