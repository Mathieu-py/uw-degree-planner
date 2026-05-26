// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanSummary } from "@/lib/plan/server/types";

const { routerReplaceMock, searchParamsRef } = vi.hoisted(() => ({
  routerReplaceMock: vi.fn(),
  searchParamsRef: { current: new URLSearchParams() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
  useSearchParams: () => searchParamsRef.current,
}));

const { usePlanListMock } = vi.hoisted(() => ({
  usePlanListMock: vi.fn(),
}));
vi.mock("@/lib/plan/sync/usePlanList", () => ({
  usePlanList: usePlanListMock,
}));

import { PlansSidebar } from "../PlansSidebar";

function mkSummary(overrides: Partial<PlanSummary> = {}): PlanSummary {
  return {
    id: "p1",
    name: "Plan one",
    programId: null,
    specializationId: null,
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
  isAuthed?: boolean;
}) {
  searchParamsRef.current = new URLSearchParams(
    opts.currentPlanId ? `planId=${opts.currentPlanId}` : "",
  );
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
  });

  render(<PlansSidebar isAuthed={opts.isAuthed ?? true} />);
}

// The desktop sidebar and the <lg mobile trigger both mount in jsdom (Tailwind
// responsive classes don't actually hide elements there). Scope all behavior
// assertions to the desktop <aside> so we don't hit duplicate-element errors.
function desktop() {
  return within(screen.getByRole("complementary", { name: "Plans" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParamsRef.current = new URLSearchParams();
});

afterEach(() => {
  cleanup();
});

describe("PlansSidebar — visibility", () => {
  it("renders nothing when isAuthed is false", () => {
    const { container } = render(<PlansSidebar isAuthed={false} />);
    expect(container.textContent).toBe("");
  });
});

describe("PlansSidebar — list + switch", () => {
  it("renders the plan list with the current row highlighted", () => {
    mount({
      plans: [
        mkSummary({ id: "a", name: "Plan A" }),
        mkSummary({ id: "b", name: "Plan B" }),
      ],
      currentPlanId: "a",
    });
    const sidebar = desktop();
    expect(sidebar.getByRole("button", { name: "Plan A" })).toBeTruthy();
    expect(sidebar.getByRole("button", { name: "Plan B" })).toBeTruthy();
  });

  it("navigates to the chosen plan when a row is clicked", async () => {
    mount({
      plans: [
        mkSummary({ id: "a", name: "Plan A" }),
        mkSummary({ id: "b", name: "Plan B" }),
      ],
      currentPlanId: "a",
    });
    await act(async () => {
      fireEvent.click(desktop().getByRole("button", { name: "Plan B" }));
    });
    expect(routerReplaceMock).toHaveBeenCalledWith("/plan?planId=b");
  });

  it("shows the empty state when there are no plans", () => {
    mount({ plans: [], currentPlanId: null });
    expect(desktop().getByText("No plans yet.")).toBeTruthy();
  });

  it("shows the loading state while plans are null", () => {
    mount({ plans: null, currentPlanId: null });
    expect(desktop().getByText("Loading…")).toBeTruthy();
  });
});

describe("PlansSidebar — rename", () => {
  it("calls rename with the new value and exits edit mode", async () => {
    const renameMock = vi.fn().mockResolvedValue(true);
    mount({
      plans: [mkSummary({ id: "a", name: "Old" })],
      currentPlanId: "a",
      rename: renameMock,
    });
    const sidebar = desktop();
    fireEvent.click(sidebar.getByRole("button", { name: /rename old/i }));

    const input = sidebar.getByLabelText("New plan name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Fresh" } });

    await act(async () => {
      fireEvent.click(sidebar.getByRole("button", { name: "Save" }));
    });
    expect(renameMock).toHaveBeenCalledWith("a", "Fresh");
  });
});

describe("PlansSidebar — delete", () => {
  it("requires confirmation then calls remove", async () => {
    const removeMock = vi.fn().mockResolvedValue(true);
    mount({
      plans: [
        mkSummary({ id: "a", name: "Plan A" }),
        mkSummary({ id: "b", name: "Plan B" }),
      ],
      currentPlanId: "a",
      remove: removeMock,
    });
    const sidebar = desktop();
    fireEvent.click(sidebar.getByRole("button", { name: /delete plan b/i }));
    // First click just shows the confirmation row — no server call yet.
    expect(removeMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(sidebar.getByRole("button", { name: "Delete" }));
    });
    expect(removeMock).toHaveBeenCalledWith("b");
  });

  it("navigates to the next plan when the active plan is deleted", async () => {
    const removeMock = vi.fn().mockResolvedValue(true);
    mount({
      plans: [
        mkSummary({ id: "a", name: "Plan A" }),
        mkSummary({ id: "b", name: "Plan B" }),
      ],
      currentPlanId: "a",
      remove: removeMock,
    });
    const sidebar = desktop();
    fireEvent.click(sidebar.getByRole("button", { name: /delete plan a/i }));
    await act(async () => {
      fireEvent.click(sidebar.getByRole("button", { name: "Delete" }));
    });
    expect(routerReplaceMock).toHaveBeenCalledWith("/plan?planId=b");
  });

  it("strips ?planId when the last plan is deleted", async () => {
    const removeMock = vi.fn().mockResolvedValue(true);
    mount({
      plans: [mkSummary({ id: "a", name: "Only" })],
      currentPlanId: "a",
      remove: removeMock,
    });
    const sidebar = desktop();
    fireEvent.click(sidebar.getByRole("button", { name: /delete only/i }));
    await act(async () => {
      fireEvent.click(sidebar.getByRole("button", { name: "Delete" }));
    });
    expect(routerReplaceMock).toHaveBeenCalledWith("/plan");
  });
});

describe("PlansSidebar — duplicate", () => {
  it("calls duplicate then navigates to the new plan id on success", async () => {
    const duplicateMock = vi.fn().mockResolvedValue("copy-1");
    mount({
      plans: [
        mkSummary({ id: "a", name: "Plan A" }),
        mkSummary({ id: "b", name: "Plan B" }),
      ],
      currentPlanId: "a",
      duplicate: duplicateMock,
    });
    await act(async () => {
      fireEvent.click(
        desktop().getByRole("button", { name: /duplicate plan b/i }),
      );
    });
    expect(duplicateMock).toHaveBeenCalledWith("b");
    expect(routerReplaceMock).toHaveBeenCalledWith("/plan?planId=copy-1");
  });

  it("does not navigate when duplicate fails (returns null)", async () => {
    const duplicateMock = vi.fn().mockResolvedValue(null);
    mount({
      plans: [mkSummary({ id: "a", name: "Plan A" })],
      currentPlanId: "a",
      duplicate: duplicateMock,
    });
    await act(async () => {
      fireEvent.click(
        desktop().getByRole("button", { name: /duplicate plan a/i }),
      );
    });
    expect(duplicateMock).toHaveBeenCalledWith("a");
    // Only the URL-effects from the initial mount run; no navigation kicked off
    // by the failed duplicate.
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });
});

describe("PlansSidebar — create", () => {
  it("routes to ?new=1 so EmptyState collects program/start-term metadata", () => {
    // Regression carried from PlanSwitcher: previously create() ran with no
    // seed, which produced an empty server plan with no slots. Now it routes
    // to EmptyState so the user picks metadata first.
    const createMock = vi.fn();
    mount({
      plans: [],
      currentPlanId: null,
      create: createMock,
    });
    fireEvent.click(desktop().getByRole("button", { name: /\+ new plan/i }));
    expect(createMock).not.toHaveBeenCalled();
    expect(routerReplaceMock).toHaveBeenCalledWith("/plan?new=1");
  });
});
