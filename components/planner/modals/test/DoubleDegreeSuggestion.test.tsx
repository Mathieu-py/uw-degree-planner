// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DoubleDegreeSuggestion } from "../DoubleDegreeSuggestion";

afterEach(cleanup);

const KNOWN_PAIR = ["h-social-development-studies", "social-work"];
const KNOWN_DD = "h-ba-sds-and-h-bsw-double-degree";

describe("DoubleDegreeSuggestion", () => {
  it("renders a switch nudge for a known packaged pair", () => {
    render(
      <DoubleDegreeSuggestion programIds={KNOWN_PAIR} onAccept={() => {}} />,
    );
    expect(
      screen.getByText(/switch for an accurate combined audit/i),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /switch to packaged plan/i }),
    ).toBeTruthy();
  });

  it("renders nothing for an ad-hoc pair with no packaged plan", () => {
    const { container } = render(
      <DoubleDegreeSuggestion
        programIds={["h-social-development-studies", "h-computer-science-bcs"]}
        onAccept={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("calls onAccept with the packaged id when Switch is clicked", () => {
    const onAccept = vi.fn();
    render(
      <DoubleDegreeSuggestion programIds={KNOWN_PAIR} onAccept={onAccept} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /switch to packaged plan/i }),
    );
    expect(onAccept).toHaveBeenCalledWith(KNOWN_DD);
  });

  it("hides after dismiss", () => {
    const { container } = render(
      <DoubleDegreeSuggestion programIds={KNOWN_PAIR} onAccept={() => {}} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /dismiss double-degree suggestion/i }),
    );
    expect(container.firstChild).toBeNull();
  });
});
