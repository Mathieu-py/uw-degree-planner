// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanSummary } from "@/lib/plan/server/types";

const { routerReplaceMock, routerPushMock } = vi.hoisted(() => ({
  routerReplaceMock: vi.fn(),
  routerPushMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: routerPushMock }),
}));

const { usePlanListMock } = vi.hoisted(() => ({
  usePlanListMock: vi.fn(),
}));
vi.mock("@/lib/plan/sync/usePlanList", () => ({
  usePlanList: usePlanListMock,
}));

import { PlanToolbar } from "../PlanToolbar";

function mkSummary(overrides: Partial<PlanSummary> = {}): PlanSummary {
  return {
    id: "p1",
    name: "Plan one",
    programIds: [],
    specializationIds: {},
    stream: null,
    startTermId: null,
    shareToken: null,
    updatedAt: "2026-05-24T00:00:00.000Z",
    ...overrides,
  };
}

function mount(opts: {
  plans?: PlanSummary[] | null;
  currentPlanId?: string | null;
  create?: ReturnType<typeof vi.fn>;
  rename?: ReturnType<typeof vi.fn>;
  remove?: ReturnType<typeof vi.fn>;
  duplicate?: ReturnType<typeof vi.fn>;
  share?: ReturnType<typeof vi.fn>;
  isAuthed?: boolean;
}) {
  // Preserve a caller-passed `null` (loading state); only fall back to []
  // when the caller didn't specify plans at all.
  const plans = "plans" in opts ? opts.plans : [];
  usePlanListMock.mockReturnValue({
    plans,
    loading: false,
    error: null,
    refetch: vi.fn(),
    create: opts.create ?? vi.fn(),
    rename: opts.rename ?? vi.fn(),
    remove: opts.remove ?? vi.fn(),
    duplicate: opts.duplicate ?? vi.fn(),
    share: opts.share ?? vi.fn(),
  });

  return render(
    <PlanToolbar
      isAuthed={opts.isAuthed ?? true}
      planId={opts.currentPlanId ?? null}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("PlanToolbar — visibility", () => {
  it("renders nothing when isAuthed is false", () => {
    const { container } = render(
      <PlanToolbar isAuthed={false} planId={null} />,
    );
    expect(container.textContent).toBe("");
  });

  it("renders nothing while plans is null (loading)", () => {
    const { container } = mount({ plans: null, currentPlanId: null });
    expect(container.textContent).toBe("");
  });

  it("renders nothing when plans is empty (EmptyState owns this state)", () => {
    const { container } = mount({ plans: [], currentPlanId: null });
    expect(container.textContent).toBe("");
  });

  it("falls back to the first plan when ?planId is stale", () => {
    // Plans exist but ?planId points at a stale id — rather than hiding the
    // bar (which would strand the user), fall back to the first plan so the
    // selector stays reachable and they can switch.
    const { container } = mount({
      plans: [mkSummary({ id: "a", name: "Plan A" })],
      currentPlanId: "missing",
    });
    expect(container.textContent).toContain("Plan A");
  });
});

describe("PlanToolbar — list + switch", () => {
  it("renders a dropdown listing every plan with the current selected", () => {
    mount({
      plans: [
        mkSummary({ id: "a", name: "Plan A" }),
        mkSummary({ id: "b", name: "Plan B" }),
      ],
      currentPlanId: "a",
    });
    // Trigger button shows the current plan and opens the listbox on click.
    const trigger = screen.getByRole("button", { name: /switch plan/i });
    expect(trigger.textContent).toContain("Plan A");
    fireEvent.click(trigger);

    const listbox = screen.getByRole("listbox", { name: /plans/i });
    const options = Array.from(
      listbox.querySelectorAll('[role="option"]'),
    ) as HTMLElement[];
    expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
    ]);
    // Each option also contains hover-revealed rename/delete affordances —
    // pluck the name span (the first child) and assert on its text.
    expect(options.map((o) => o.firstElementChild?.textContent)).toEqual([
      "Plan A",
      "Plan B",
    ]);
  });

  it("navigates to the chosen plan when the dropdown value changes", async () => {
    mount({
      plans: [
        mkSummary({ id: "a", name: "Plan A" }),
        mkSummary({ id: "b", name: "Plan B" }),
      ],
      currentPlanId: "a",
    });
    fireEvent.click(screen.getByRole("button", { name: /switch plan/i }));
    const planBOption = screen
      .getAllByRole("option")
      .find((o) => o.textContent?.includes("Plan B"));
    if (!planBOption) throw new Error("Plan B option not rendered");
    await act(async () => {
      fireEvent.click(planBOption);
    });
    expect(routerReplaceMock).toHaveBeenCalledWith("/plan/b");
  });
});

describe("PlanToolbar — rename", () => {
  it("calls rename with the new value and exits edit mode", async () => {
    const renameMock = vi.fn().mockResolvedValue(true);
    mount({
      plans: [mkSummary({ id: "a", name: "Old" })],
      currentPlanId: "a",
      rename: renameMock,
    });
    fireEvent.click(screen.getByRole("button", { name: /edit plan/i }));
    fireEvent.click(screen.getByRole("button", { name: /rename/i }));

    const input = screen.getByLabelText("New plan name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Fresh" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save rename/i }));
    });
    expect(renameMock).toHaveBeenCalledWith("a", "Fresh");
  });
});

describe("PlanToolbar — delete", () => {
  it("requires confirmation then calls remove on the current plan", async () => {
    const removeMock = vi.fn().mockResolvedValue(true);
    mount({
      plans: [
        mkSummary({ id: "a", name: "Plan A" }),
        mkSummary({ id: "b", name: "Plan B" }),
      ],
      currentPlanId: "a",
      remove: removeMock,
    });
    fireEvent.click(screen.getByRole("button", { name: /edit plan/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    // First click just shows the confirmation row — no server call yet.
    expect(removeMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    });
    expect(removeMock).toHaveBeenCalledWith("a");
  });

  it("returns to the plans list when the active plan is deleted", async () => {
    const removeMock = vi.fn().mockResolvedValue(true);
    mount({
      plans: [
        mkSummary({ id: "a", name: "Plan A" }),
        mkSummary({ id: "b", name: "Plan B" }),
      ],
      currentPlanId: "a",
      remove: removeMock,
    });
    fireEvent.click(screen.getByRole("button", { name: /edit plan/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    });
    // Return to the plans list rather than auto-opening a remaining plan.
    expect(routerReplaceMock).toHaveBeenCalledWith("/plans");
  });

  it("returns to the plans list when the last plan is deleted", async () => {
    const removeMock = vi.fn().mockResolvedValue(true);
    mount({
      plans: [mkSummary({ id: "a", name: "Only" })],
      currentPlanId: "a",
      remove: removeMock,
    });
    fireEvent.click(screen.getByRole("button", { name: /edit plan/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    });
    expect(routerReplaceMock).toHaveBeenCalledWith("/plans");
  });
});

describe("PlanToolbar — duplicate", () => {
  it("calls duplicate on the current plan then navigates to the new id", async () => {
    const duplicateMock = vi.fn().mockResolvedValue("copy-1");
    mount({
      plans: [
        mkSummary({ id: "a", name: "Plan A" }),
        mkSummary({ id: "b", name: "Plan B" }),
      ],
      currentPlanId: "a",
      duplicate: duplicateMock,
    });
    fireEvent.click(screen.getByRole("button", { name: /edit plan/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /duplicate/i }));
    });
    expect(duplicateMock).toHaveBeenCalledWith("a");
    expect(routerReplaceMock).toHaveBeenCalledWith("/plan/copy-1");
  });

  it("does not navigate when duplicate fails (returns null)", async () => {
    const duplicateMock = vi.fn().mockResolvedValue(null);
    mount({
      plans: [mkSummary({ id: "a", name: "Plan A" })],
      currentPlanId: "a",
      duplicate: duplicateMock,
    });
    fireEvent.click(screen.getByRole("button", { name: /edit plan/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /duplicate/i }));
    });
    expect(duplicateMock).toHaveBeenCalledWith("a");
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });
});

describe("PlanToolbar — create", () => {
  it("routes to /plan/new so the create stepper collects metadata", () => {
    // Previously create() ran with no seed, producing an empty server plan
    // with no slots. Now "New plan" routes to the /plan/new stepper where the
    // user picks program/term (or imports a transcript) first.
    const createMock = vi.fn();
    mount({
      plans: [mkSummary({ id: "a", name: "Plan A" })],
      currentPlanId: "a",
      create: createMock,
    });
    fireEvent.click(screen.getByRole("button", { name: /^new plan$/i }));
    expect(createMock).not.toHaveBeenCalled();
    expect(routerPushMock).toHaveBeenCalledWith("/plan/new");
  });
});

describe("PlanToolbar — share", () => {
  it("auto-enables sharing and opens the share modal when the menu item is clicked", () => {
    const shareMock = vi.fn().mockResolvedValue("tok-123");
    mount({
      plans: [mkSummary({ id: "a", name: "Plan A", shareToken: null })],
      currentPlanId: "a",
      share: shareMock,
    });
    fireEvent.click(screen.getByRole("button", { name: /edit plan/i }));
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    expect(shareMock).toHaveBeenCalledWith("a", true);
    // The modal is mounted; its dialog has aria-label "Close dialog" on the
    // backdrop button plus the share-modal title.
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("skips the share call when the plan is already shared", () => {
    const shareMock = vi.fn();
    mount({
      plans: [mkSummary({ id: "a", name: "Plan A", shareToken: "existing" })],
      currentPlanId: "a",
      share: shareMock,
    });
    fireEvent.click(screen.getByRole("button", { name: /edit plan/i }));
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    expect(shareMock).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
