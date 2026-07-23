// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgramOption } from "@/lib/programs";

const { routerReplaceMock } = vi.hoisted(() => ({
  routerReplaceMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
  useParams: () => ({}),
}));

const { usePlanSyncMock, usePlanListMock, useAuthStateMock } = vi.hoisted(
  () => ({
    usePlanSyncMock: vi.fn(),
    usePlanListMock: vi.fn(),
    useAuthStateMock: vi.fn(),
  }),
);
vi.mock("@/lib/plan/sync/usePlanSync", () => ({
  usePlanSync: usePlanSyncMock,
}));
vi.mock("@/lib/plan/sync/usePlanList", () => ({
  usePlanList: usePlanListMock,
}));
vi.mock("@/lib/plan/sync/useAnonHandoff", () => ({
  useAnonHandoff: () => ({ conflict: null, resolveConflict: vi.fn() }),
}));
// Configurable per test; defaults (signed-out, nothing loaded) set in beforeEach.
// SUPABASE_CONFIGURED:false keeps initAuth's real behavior out of the picture.
vi.mock("@/lib/auth/store", () => ({
  SUPABASE_CONFIGURED: false,
  useAuthState: useAuthStateMock,
}));

import { PlannerShell } from "../PlannerShell";

const PROGRAM_OPTIONS: ProgramOption[] = [
  { id: "se", name: "Software Engineering", kind: "engineering" },
];

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStateMock.mockReturnValue({
    user: null,
    ready: true,
    isAuthed: false,
  });
  usePlanSyncMock.mockReturnValue({
    plan: null,
    hydrated: true,
    saveStatus: { kind: "idle" },
    setPlan: vi.fn(),
    clearLocalPlan: vi.fn(),
    flushSave: vi.fn(),
  });
  usePlanListMock.mockReturnValue({
    plans: null,
    loading: false,
    error: null,
    loadError: null,
    refetch: vi.fn(),
    create: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    duplicate: vi.fn(),
    share: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
});

describe("PlannerShell — demo first-run routing", () => {
  it("redirects a signed-out user with no local plan to /plan/new", async () => {
    // Plan creation lives at /plan/new; hydrated null plan + no ?planId redirects there.
    render(
      <PlannerShell
        planId={null}
        initialPlan={null}
        initialLoadError={null}
        programOptions={PROGRAM_OPTIONS}
        specializationsByProgram={{}}
        catalog={[]}
      />,
    );

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/plan/new");
    });
  });

  it("strips a path planId for a signed-out user back to bare /plan", async () => {
    // A signed-out visitor has no server plans, so `/plan/<id>` can't resolve —
    // redirect to bare /plan rather than stick on an empty skeleton.
    render(
      <PlannerShell
        planId="some-foreign-id"
        initialPlan={null}
        initialLoadError={null}
        programOptions={PROGRAM_OPTIONS}
        specializationsByProgram={{}}
        catalog={[]}
      />,
    );

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/plan");
    });
  });
});

describe("PlannerShell — load-failure recovery", () => {
  const AUTHED = { user: { id: "u1" }, ready: true, isAuthed: true };

  it("shows a retryable error (not a redirect) when the plan list fails at /plan", async () => {
    useAuthStateMock.mockReturnValue(AUTHED);
    const refetch = vi.fn();
    usePlanListMock.mockReturnValue({
      plans: null,
      loading: false,
      error: null,
      loadError: "not_authenticated",
      refetch,
      create: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      duplicate: vi.fn(),
      share: vi.fn(),
    });
    render(
      <PlannerShell
        planId={null}
        initialPlan={null}
        initialLoadError={null}
        programOptions={PROGRAM_OPTIONS}
        specializationsByProgram={{}}
        catalog={[]}
      />,
    );

    expect(await screen.findByText(/couldn't load your plans/i)).toBeTruthy();
    // A load failure must not be mistaken for "zero plans" → no create redirect.
    expect(routerReplaceMock).not.toHaveBeenCalledWith("/plan/new");
    // Exactly one error surface: the fallback toolbar (which would render a
    // duplicate error bar for the same failure) must be suppressed.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows a not-found message when a specific plan is genuinely missing (no load error)", async () => {
    useAuthStateMock.mockReturnValue(AUTHED);
    // Server load produced no plan → the hook returns a null plan for this id.
    usePlanSyncMock.mockReturnValue({
      plan: null,
      hydrated: true,
      saveStatus: { kind: "idle" },
      setPlan: vi.fn(),
      clearLocalPlan: vi.fn(),
      flushSave: vi.fn(),
    });
    usePlanListMock.mockReturnValue({
      plans: [],
      loading: false,
      error: null,
      loadError: null,
      refetch: vi.fn(),
      create: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      duplicate: vi.fn(),
      share: vi.fn(),
    });
    render(
      <PlannerShell
        planId="p1"
        initialPlan={null}
        initialLoadError={null}
        programOptions={PROGRAM_OPTIONS}
        specializationsByProgram={{}}
        catalog={[]}
      />,
    );

    expect(await screen.findByText(/couldn't load that plan/i)).toBeTruthy();
  });

  it("shows a retryable error (not 'deleted') when the specific plan load failed", async () => {
    useAuthStateMock.mockReturnValue(AUTHED);
    usePlanSyncMock.mockReturnValue({
      plan: null,
      hydrated: true,
      saveStatus: { kind: "idle" },
      setPlan: vi.fn(),
      clearLocalPlan: vi.fn(),
      flushSave: vi.fn(),
    });
    usePlanListMock.mockReturnValue({
      plans: [],
      loading: false,
      error: null,
      loadError: null,
      refetch: vi.fn(),
      create: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      duplicate: vi.fn(),
      share: vi.fn(),
    });
    render(
      <PlannerShell
        planId="p1"
        initialPlan={null}
        initialLoadError="db_unavailable"
        programOptions={PROGRAM_OPTIONS}
        specializationsByProgram={{}}
        catalog={[]}
      />,
    );

    // A transient failure must read as retryable, not as a deletion.
    expect(await screen.findByText(/couldn't load this plan/i)).toBeTruthy();
    expect(screen.queryByText(/may have been deleted/i)).toBeNull();
  });
});
