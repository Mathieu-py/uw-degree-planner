// @vitest-environment jsdom
import type { User } from "@supabase/supabase-js";
import { act, renderHook, waitFor } from "@testing-library/react";
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

import { __resetAuthStoreForTests, useAuthState } from "../store";

function mkUser(id = "u1", email = "u1@example.com"): User {
  return {
    id,
    email,
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00.000Z",
    app_metadata: {},
    user_metadata: {},
  } as User;
}

let authChangeCallback:
  | ((event: string, session: { user: User } | null) => void)
  | null = null;

beforeEach(() => {
  __resetAuthStoreForTests();
  authChangeCallback = null;

  stubSupabaseClient();
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({ data: { session: null } });
  onAuthStateChangeMock.mockReset();
  onAuthStateChangeMock.mockImplementation((cb) => {
    authChangeCallback = cb;
    return { data: { subscription: { unsubscribe: () => {} } } };
  });
});

afterEach(() => {
  __resetAuthStoreForTests();
});

describe("useAuthState — auth store via useSyncExternalStore", () => {
  it("starts as { user: null, ready: false } and flips ready=true after getSession resolves", async () => {
    getSessionMock.mockResolvedValueOnce({ data: { session: null } });

    const { result } = renderHook(() => useAuthState());

    expect(result.current).toEqual({
      user: null,
      ready: false,
      isAuthed: false,
    });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthed).toBe(false);
  });

  it("populates user from getSession when a session exists at mount", async () => {
    const user = mkUser();
    getSessionMock.mockResolvedValueOnce({ data: { session: { user } } });

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.user).toEqual(user);
    expect(result.current.isAuthed).toBe(true);
  });

  it("updates user when onAuthStateChange fires (sign in)", async () => {
    const { result } = renderHook(() => useAuthState());
    await waitFor(() => expect(result.current.ready).toBe(true));

    const signedIn = mkUser("u2", "u2@example.com");
    act(() => {
      authChangeCallback?.("SIGNED_IN", { user: signedIn });
    });

    expect(result.current.user).toEqual(signedIn);
    expect(result.current.isAuthed).toBe(true);
  });

  it("nulls user when onAuthStateChange fires with null session (sign out)", async () => {
    const user = mkUser();
    getSessionMock.mockResolvedValueOnce({ data: { session: { user } } });

    const { result } = renderHook(() => useAuthState());
    await waitFor(() => expect(result.current.user).not.toBeNull());

    act(() => {
      authChangeCallback?.("SIGNED_OUT", null);
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthed).toBe(false);
  });

  it("is idempotent — multiple consumers don't trigger duplicate subscriptions", async () => {
    const { result: r1 } = renderHook(() => useAuthState());
    const { result: r2 } = renderHook(() => useAuthState());

    await waitFor(() => expect(r1.current.ready).toBe(true));
    expect(r2.current.ready).toBe(true);

    expect(getSessionMock).toHaveBeenCalledTimes(1);
    expect(onAuthStateChangeMock).toHaveBeenCalledTimes(1);
  });

  it("broadcasts auth changes to every mounted consumer", async () => {
    const { result: r1 } = renderHook(() => useAuthState());
    const { result: r2 } = renderHook(() => useAuthState());
    await waitFor(() => expect(r1.current.ready).toBe(true));

    const signedIn = mkUser();
    act(() => {
      authChangeCallback?.("SIGNED_IN", { user: signedIn });
    });

    expect(r1.current.user).toEqual(signedIn);
    expect(r2.current.user).toEqual(signedIn);
  });

  it("still flips ready=true when getSession rejects (network/auth error)", async () => {
    getSessionMock.mockRejectedValueOnce(new Error("network down"));

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.user).toBeNull();
  });
});
