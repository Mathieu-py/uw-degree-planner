// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgramOption } from "../PlannerShell";

const { routerReplaceMock, searchParamsRef } = vi.hoisted(() => ({
  routerReplaceMock: vi.fn(),
  searchParamsRef: { current: new URLSearchParams() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
  useSearchParams: () => searchParamsRef.current,
}));

const { usePlanSyncMock, setPlanMock } = vi.hoisted(() => {
  const setPlan = vi.fn();
  return {
    setPlanMock: setPlan,
    usePlanSyncMock: vi.fn(() => ({
      plan: null,
      source: "local" as const,
      hydrated: true,
      reloading: false,
      saveStatus: { kind: "idle" as const },
      setPlan,
      clearLocalPlan: vi.fn(),
      flushSave: vi.fn(),
    })),
  };
});
vi.mock("@/lib/plan/sync/usePlanSync", () => ({
  usePlanSync: usePlanSyncMock,
}));

const { usePlanListMock } = vi.hoisted(() => ({
  usePlanListMock: vi.fn(() => ({
    plans: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
    create: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
  })),
}));
vi.mock("@/lib/plan/sync/usePlanList", () => ({
  usePlanList: usePlanListMock,
}));

vi.mock("@/lib/plan/sync/useAnonHandoff", () => ({
  useAnonHandoff: () => ({ conflict: null, resolveConflict: vi.fn() }),
}));

// Stub the shared auth store so the test doesn't depend on initAuth's real
// behavior (which relies on NEXT_PUBLIC_SUPABASE_URL being unset to flip
// ready=true synchronously). Returning ready: true / isAuthed: false up front
// also lets us drop the awaited findByRole pre-amble below.
vi.mock("@/lib/auth/store", () => ({
  SUPABASE_CONFIGURED: false,
  useAuthState: () => ({ user: null, ready: true, isAuthed: false }),
}));

import { PlannerShell } from "../PlannerShell";

const PROGRAM_OPTIONS: ProgramOption[] = [
  { id: "se", name: "Software Engineering", kind: "engineering" },
];

beforeEach(() => {
  vi.clearAllMocks();
  searchParamsRef.current = new URLSearchParams();
});

afterEach(() => {
  cleanup();
});

describe("PlannerShell — anon /plan?new=1 strip after create (B1)", () => {
  it("strips ?new=1 from the URL after an anon user creates a local plan, so the loaded-plan branch wins on the next render", async () => {
    // Anon user landed on /plan?new=1 (e.g. via a bookmark). Without B1 the
    // URL flag survives setPlan, so the `newRequested` branch keeps
    // EmptyState on screen and the user thinks the button is broken.
    searchParamsRef.current = new URLSearchParams("new=1");

    render(
      <PlannerShell
        programOptions={PROGRAM_OPTIONS}
        specializationsByProgram={{}}
        catalog={[]}
      />,
    );

    // useAuthedFlag's effect resolves on the next tick (Supabase unconfigured
    // in tests → setReady(true) immediately) — wait for the EmptyState form.
    const createBtn = await screen.findByRole("button", {
      name: /Create empty plan/i,
    });

    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(setPlanMock).toHaveBeenCalled();
      expect(routerReplaceMock).toHaveBeenCalledWith("/plan");
    });
  });
});
