// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The harness sets the Supabase env, so ../store (imported below, after it)
// computes SUPABASE_CONFIGURED=true at module load.
import {
  getSessionMock,
  onAuthStateChangeMock,
  stubSupabaseClient,
} from "./harness";

vi.mock("@/lib/supabase/client", async () => ({
  createSupabaseBrowserClient: (await import("./harness"))
    .createSupabaseBrowserClientMock,
}));

import { __resetAuthStoreForTests, AuthGate } from "../store";

// Deferred getSession keeps `ready` false until a test resolves it.
let resolveSession: (value: { data: { session: null } }) => void;

function Probe({ onMount }: { onMount: () => void }) {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return <div>child-content</div>;
}

beforeEach(() => {
  __resetAuthStoreForTests();
  stubSupabaseClient();
  getSessionMock.mockReset();
  getSessionMock.mockReturnValue(
    new Promise((resolve) => {
      resolveSession = resolve;
    }),
  );
  onAuthStateChangeMock.mockReset();
  onAuthStateChangeMock.mockReturnValue({
    data: { subscription: { unsubscribe: () => {} } },
  });
});

afterEach(() => {
  cleanup();
  __resetAuthStoreForTests();
});

describe("AuthGate — shared auth-readiness gate (#179)", () => {
  it("renders the fallback, not children, while auth is unresolved", () => {
    render(
      <AuthGate fallback={<div>fallback-content</div>}>
        <div>child-content</div>
      </AuthGate>,
    );

    expect(screen.getByText("fallback-content")).toBeTruthy();
    expect(screen.queryByText("child-content")).toBeNull();
  });

  it("keeps children's effects from running until auth resolves", async () => {
    const onMount = vi.fn();
    render(
      <AuthGate fallback={<div>fallback-content</div>}>
        <Probe onMount={onMount} />
      </AuthGate>,
    );

    expect(onMount).not.toHaveBeenCalled();

    await act(async () => {
      resolveSession({ data: { session: null } });
    });

    expect(screen.getByText("child-content")).toBeTruthy();
    expect(screen.queryByText("fallback-content")).toBeNull();
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it("renders nothing before ready when no fallback is given", () => {
    const { container } = render(
      <AuthGate>
        <div>child-content</div>
      </AuthGate>,
    );

    expect(container.firstChild).toBeNull();
  });

  it("boots the store when the gate is the only auth consumer", () => {
    render(
      <AuthGate>
        <div>child-content</div>
      </AuthGate>,
    );

    expect(getSessionMock).toHaveBeenCalledTimes(1);
  });
});
