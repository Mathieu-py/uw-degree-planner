// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UnverifiedRequirements } from "../UnverifiedRequirements";

afterEach(cleanup);

const items = [{ text: "A co-op work-term sequence.", acked: false }];

describe("UnverifiedRequirements — stale acknowledgement note (#3)", () => {
  it("explains that a previously-confirmed requirement changed on re-scrape", () => {
    // Regression: a calendar re-scrape can reword a rule, orphaning the student's
    // acknowledgement and silently dropping the headline 100% → 99%. The note
    // tells them WHY, so it isn't a mystery regression.
    render(
      <UnverifiedRequirements
        programId="p"
        items={items}
        staleCount={2}
        onAcknowledge={() => {}}
      />,
    );
    expect(
      screen.getByText(/previously confirmed changed in a calendar update/i),
    ).toBeTruthy();
  });

  it("shows no such note when nothing is stale", () => {
    render(
      <UnverifiedRequirements
        programId="p"
        items={items}
        staleCount={0}
        onAcknowledge={() => {}}
      />,
    );
    expect(
      screen.queryByText(/previously confirmed changed in a calendar update/i),
    ).toBeNull();
  });
});
