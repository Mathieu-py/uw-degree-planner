import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerPlan } from "@/lib/plan/server/types";
import { serverPlanToLocal } from "@/lib/plan/sync/serverPlanToLocal";

const { loadServerPlanMock, loadTermMock } = vi.hoisted(() => ({
  loadServerPlanMock: vi.fn(),
  loadTermMock: vi.fn(),
}));
vi.mock("@/lib/plan/server/actions", () => ({
  loadServerPlan: loadServerPlanMock,
}));
vi.mock("@/lib/courses/data", () => ({ loadTerm: loadTermMock }));
vi.mock("@/lib/programs/registry", () => ({
  getProgramOptions: () => [],
  PROGRAMS: {},
}));
vi.mock("@/lib/terms", () => ({ PINNED_TERM: 1261 }));
// Stub the client shell — we only inspect the props the server passes it.
vi.mock("@/components/planner/shell/PlannerShell", () => ({
  PlannerShell: () => null,
}));

import { PlannerSkeleton } from "@/components/states/PlannerSkeleton";
import { AuthGate } from "@/lib/auth/store";
import { PlannerPageContent } from "../PlannerPageContent";

const SERVER_PLAN: ServerPlan = {
  id: "p1",
  name: "My plan",
  programIds: ["h-cs"],
  specializationIds: {},
  acknowledgedRequirements: {},
  stream: "regular",
  startTermId: 1239,
  programScrapeVersion: null,
  updatedAt: "2026-05-24T00:00:00.000Z",
  slots: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  loadTermMock.mockResolvedValue([]);
});

describe("PlannerPageContent — server-side plan load", () => {
  it("loads the plan and threads it as initialPlan behind the auth gate", async () => {
    loadServerPlanMock.mockResolvedValue({ ok: true, data: SERVER_PLAN });

    const el = await PlannerPageContent({ planId: "p1" });

    // The anon-flash guard lives here now.
    expect(el.type).toBe(AuthGate);
    expect(el.props.fallback.type).toBe(PlannerSkeleton);

    const shell = el.props.children;
    expect(loadServerPlanMock).toHaveBeenCalledWith("p1");
    expect(shell.props.planId).toBe("p1");
    expect(shell.props.initialPlan).toEqual(serverPlanToLocal(SERVER_PLAN));
  });

  it("passes a null initialPlan and no error when the plan is missing (ok, no row)", async () => {
    loadServerPlanMock.mockResolvedValue({ ok: true, data: null });

    const el = await PlannerPageContent({ planId: "missing" });

    const shell = el.props.children;
    expect(shell.props.initialPlan).toBeNull();
    // A clean not-found, not a failure — the shell shows "missing", not a retry.
    expect(shell.props.initialLoadError).toBeNull();
  });

  it("surfaces the load error (distinct from a clean not-found) when the load fails", async () => {
    loadServerPlanMock.mockResolvedValue({ ok: false, error: "boom" });

    const el = await PlannerPageContent({ planId: "p1" });

    const shell = el.props.children;
    expect(shell.props.initialPlan).toBeNull();
    expect(shell.props.initialLoadError).toBe("boom");
  });

  it("skips the server load for bare /plan (null planId)", async () => {
    const el = await PlannerPageContent({ planId: null });

    const shell = el.props.children;
    expect(loadServerPlanMock).not.toHaveBeenCalled();
    expect(shell.props.initialPlan).toBeNull();
    expect(shell.props.planId).toBeNull();
  });
});
