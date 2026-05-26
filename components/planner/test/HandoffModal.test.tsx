// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LocalPlan, PLAN_SCHEMA_VERSION } from "@/lib/plan/types";
import { HandoffModal } from "../HandoffModal";

function mkPlan(overrides: Partial<LocalPlan> = {}): LocalPlan {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    programId: "h-cs",
    specializationId: null,
    stream: "regular",
    startTermId: 1239,
    slots: [
      {
        id: "s1",
        termId: 1239,
        position: "1A",
        isCoop: false,
        courses: [{ code: "cs115" }, { code: "math115" }],
      },
    ],
    updatedAt: "2026-05-25T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("HandoffModal", () => {
  // onResolve is called via Promise.all([onResolve(...), minDelay]) so the
  // exit animation plays in parallel with the work. Tests use waitFor to
  // wait for the call rather than asserting synchronously.

  it("resolves with 'import' when the import button is clicked", async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(<HandoffModal localPlan={mkPlan()} onResolve={onResolve} />);
    fireEvent.click(
      screen.getByRole("button", { name: /import as another plan/i }),
    );
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith("import"));
  });

  it("resolves with 'discard' when the discard button is clicked", async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(<HandoffModal localPlan={mkPlan()} onResolve={onResolve} />);
    fireEvent.click(
      screen.getByRole("button", { name: /discard local plan/i }),
    );
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith("discard"));
  });

  it("resolves with 'cancel' on the decide-later button", async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(<HandoffModal localPlan={mkPlan()} onResolve={onResolve} />);
    fireEvent.click(screen.getByRole("button", { name: /decide later/i }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith("cancel"));
  });

  it("resolves with 'cancel' on Escape", async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(<HandoffModal localPlan={mkPlan()} onResolve={onResolve} />);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith("cancel"));
  });
});
