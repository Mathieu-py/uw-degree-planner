// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the exit-animation hook so close is synchronous and observable.
// ShareModal only reads `isClosing` + `handleClose`, so a partial mock is fine.
const { mockClose } = vi.hoisted(() => ({ mockClose: vi.fn() }));
vi.mock("@/lib/hooks/useModalExit", () => ({
  useModalExit: () => ({ isClosing: false, handleClose: mockClose }),
}));

import { ShareModal } from "../ShareModal";

const TOKEN = "abc123_token-XYZ";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function stubClipboard(impl: () => Promise<void>) {
  const writeText = vi.fn(impl);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  return writeText;
}

describe("ShareModal", () => {
  it("shows the generating placeholder when shareToken is null", () => {
    render(
      <ShareModal planName="My plan" shareToken={null} onClose={vi.fn()} />,
    );
    expect(screen.getByText("Generating link…")).toBeTruthy();
    expect(screen.queryByLabelText("Share URL")).toBeNull();
  });

  it("renders the share URL input when a token is provided", () => {
    render(
      <ShareModal planName="My plan" shareToken={TOKEN} onClose={vi.fn()} />,
    );
    const input = screen.getByLabelText("Share URL") as HTMLInputElement;
    expect(input.value).toBe(`${window.location.origin}/p/${TOKEN}`);
  });

  it("copies the full URL to the clipboard and flips the label to Copied!", async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    render(
      <ShareModal planName="My plan" shareToken={TOKEN} onClose={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    });

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/p/${TOKEN}`,
    );
    expect(screen.getByRole("button", { name: "Copied!" })).toBeTruthy();
  });

  it("falls back to selecting the input when clipboard.writeText rejects", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    const selectSpy = vi.spyOn(HTMLInputElement.prototype, "select");
    render(
      <ShareModal planName="My plan" shareToken={TOKEN} onClose={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    });

    expect(selectSpy).toHaveBeenCalled();
    // Label stays "Copy link" — the copy didn't succeed.
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
  });

  it("resets the Copied! label back to Copy link after 1500ms", async () => {
    vi.useFakeTimers();
    stubClipboard(() => Promise.resolve());
    render(
      <ShareModal planName="My plan" shareToken={TOKEN} onClose={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    });
    expect(screen.getByRole("button", { name: "Copied!" })).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
  });

  it("calls onClose (via handleClose) when the × button is clicked", () => {
    render(
      <ShareModal planName="My plan" shareToken={TOKEN} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(mockClose).toHaveBeenCalledOnce();
  });
});
