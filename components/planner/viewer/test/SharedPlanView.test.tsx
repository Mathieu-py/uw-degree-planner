// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerPlan } from "@/lib/plan/server/types";

// Capture the props Timeline is rendered with so we can assert readOnly.
const { timelineProps } = vi.hoisted(() => ({
  timelineProps: { current: null as Record<string, unknown> | null },
}));

vi.mock("@/components/planner/timeline/Timeline", () => ({
  Timeline: (props: Record<string, unknown>) => {
    timelineProps.current = props;
    return <div data-testid="timeline" />;
  },
}));

vi.mock("@/components/planner/audit/AuditPanel", () => ({
  AuditPanel: () => <div data-testid="audit-panel" />,
}));

vi.mock("@/lib/plan/validate", () => ({
  validatePlan: () => [],
  issuesBySlot: () => new Map(),
}));

// PlannerShell is a heavy client module; we only need planSubtitle here.
vi.mock("@/components/planner/shell/PlannerShell", () => ({
  planSubtitle: () => "Co-op · 8 terms",
}));

// The "Duplicate to my plans" action pulls in router + auth + plan-list +
// storage. Stub them so the view mounts in isolation; capture create() to
// assert the duplicate flow.
const { routerPushMock, createMock, savePlanMock } = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
  createMock: vi.fn().mockResolvedValue("new-plan-id"),
  savePlanMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));
vi.mock("@/lib/auth/store", () => ({
  useAuthState: () => ({ user: null, ready: true, isAuthed: true }),
}));
vi.mock("@/lib/plan/sync/usePlanList", () => ({
  usePlanList: () => ({ create: createMock }),
}));
vi.mock("@/lib/plan/storage", () => ({ savePlan: savePlanMock }));
vi.mock("@/lib/plan/server/serialize", () => ({
  toSnapshot: (p: unknown) => ({ ...(p as object), slots: [] }),
}));

import { SharedPlanView } from "../SharedPlanView";

const PROGRAM_OPTIONS = [
  { id: "h-cs", name: "Computer Science", kind: "flexible" as const },
];

function makePlan(overrides: Partial<ServerPlan> = {}): ServerPlan {
  return {
    id: "plan-1",
    name: "My shared plan",
    programId: "h-cs",
    specializationId: null,
    stream: "regular",
    startTermId: 1239,
    programScrapeVersion: null,
    slots: [],
    updatedAt: "2026-05-24T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  timelineProps.current = null;
});

describe("SharedPlanView", () => {
  it("renders the plan name in the header", () => {
    render(
      <SharedPlanView
        plan={makePlan()}
        catalog={[]}
        programOptions={PROGRAM_OPTIONS}
      />,
    );
    expect(screen.getByText("My shared plan")).toBeTruthy();
  });

  it("renders the Shared · read-only badge", () => {
    render(
      <SharedPlanView
        plan={makePlan()}
        catalog={[]}
        programOptions={PROGRAM_OPTIONS}
      />,
    );
    expect(screen.getByText("Shared · read-only")).toBeTruthy();
  });

  it("passes readOnly to the Timeline", () => {
    render(
      <SharedPlanView
        plan={makePlan()}
        catalog={[]}
        programOptions={PROGRAM_OPTIONS}
      />,
    );
    expect(screen.getByTestId("timeline")).toBeTruthy();
    expect(timelineProps.current?.readOnly).toBe(true);
  });

  it("renders the AuditPanel", () => {
    render(
      <SharedPlanView
        plan={makePlan()}
        catalog={[]}
        programOptions={PROGRAM_OPTIONS}
      />,
    );
    expect(screen.getByTestId("audit-panel")).toBeTruthy();
  });

  it("renders without crashing when plan.stream is null (defaults to regular)", () => {
    render(
      <SharedPlanView
        plan={makePlan({ stream: null })}
        catalog={[]}
        programOptions={PROGRAM_OPTIONS}
      />,
    );
    expect(screen.getByTestId("timeline")).toBeTruthy();
  });

  it("duplicates to a server plan and routes to it when authed", async () => {
    render(
      <SharedPlanView
        plan={makePlan()}
        catalog={[]}
        programOptions={PROGRAM_OPTIONS}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /duplicate to my plans/i }),
    );
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith(
        "My shared plan (copy)",
        expect.anything(),
      );
    });
    expect(routerPushMock).toHaveBeenCalledWith("/plan?planId=new-plan-id");
  });
});
