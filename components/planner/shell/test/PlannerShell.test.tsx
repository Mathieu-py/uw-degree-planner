// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
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

const { usePlanSyncMock } = vi.hoisted(() => {
  const setPlan = vi.fn();
  return {
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

describe("PlannerShell — demo first-run routing", () => {
  it("redirects a signed-out user with no local plan to /plan/new", async () => {
    // The inline EmptyState is gone: plan creation lives at /plan/new. A
    // signed-out visitor with no local plan (hydrated, plan === null) and no
    // ?planId should be redirected there.
    render(
      <PlannerShell
        programOptions={PROGRAM_OPTIONS}
        specializationsByProgram={{}}
        catalog={[]}
      />,
    );

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/plan/new");
    });
  });
});
