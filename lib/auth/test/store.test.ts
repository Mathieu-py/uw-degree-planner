// @vitest-environment jsdom
import type { User } from "@supabase/supabase-js";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Set env BEFORE importing the store so SUPABASE_CONFIGURED is true at
// module-load time. The store reads NEXT_PUBLIC_* once via process.env and
// caches the result as a const.
const {
  createSupabaseBrowserClientMock,
  getSessionMock,
  onAuthStateChangeMock,
  maybeSingleMock,
} = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  return {
    createSupabaseBrowserClientMock: vi.fn(),
    getSessionMock: vi.fn(),
    onAuthStateChangeMock: vi.fn(),
    maybeSingleMock: vi.fn(),
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: createSupabaseBrowserClientMock,
}));

import { __resetAuthStoreForTests, useAuthState } from "../store";

function mkUser(
  id = "u1",
  email = "u1@example.com",
  user_metadata: Record<string, unknown> = {},
): User {
  return {
    id,
    email,
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00.000Z",
    app_metadata: {},
    user_metadata,
  } as User;
}

let authChangeCallback:
  | ((event: string, session: { user: User } | null) => void)
  | null = null;

beforeEach(() => {
  __resetAuthStoreForTests();
  authChangeCallback = null;

  // `from("profiles").select("username").eq("id", id).maybeSingle()` chain used
  // by the store's profile sync. Each step returns the next link.
  const queryChain = {
    select: () => queryChain,
    eq: () => queryChain,
    maybeSingle: maybeSingleMock,
  };
  createSupabaseBrowserClientMock.mockReturnValue({
    auth: {
      getSession: getSessionMock,
      onAuthStateChange: onAuthStateChangeMock,
    },
    from: () => queryChain,
  });
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({ data: { session: null } });
  maybeSingleMock.mockReset();
  maybeSingleMock.mockResolvedValue({ data: null });
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
      username: null,
      displayName: null,
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

  it("seeds username from user_metadata synchronously (no email flash)", async () => {
    const user = mkUser("u1", "u1@example.com", { username: "speedy" });
    getSessionMock.mockResolvedValueOnce({ data: { session: { user } } });
    // Profile fetch never resolves with a value — username must come from
    // metadata, and displayName must never fall back to the email.
    maybeSingleMock.mockResolvedValueOnce({ data: null });

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => expect(result.current.username).toBe("speedy"));
    expect(result.current.displayName).toBe("speedy");
  });

  it("fetches the profile username when a session exists and derives displayName", async () => {
    const user = mkUser();
    getSessionMock.mockResolvedValueOnce({ data: { session: { user } } });
    maybeSingleMock.mockResolvedValueOnce({ data: { username: "mathieu" } });

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => expect(result.current.username).toBe("mathieu"));
    expect(result.current.displayName).toBe("mathieu");
  });

  it("falls back to email for displayName when the profile has no username", async () => {
    const user = mkUser("u1", "u1@example.com");
    getSessionMock.mockResolvedValueOnce({ data: { session: { user } } });
    maybeSingleMock.mockResolvedValueOnce({ data: { username: null } });

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.username).toBeNull();
    expect(result.current.displayName).toBe("u1@example.com");
  });

  it("clears the username on sign-out", async () => {
    const user = mkUser();
    getSessionMock.mockResolvedValueOnce({ data: { session: { user } } });
    maybeSingleMock.mockResolvedValueOnce({ data: { username: "mathieu" } });

    const { result } = renderHook(() => useAuthState());
    await waitFor(() => expect(result.current.username).toBe("mathieu"));

    act(() => {
      authChangeCallback?.("SIGNED_OUT", null);
    });

    expect(result.current.user).toBeNull();
    expect(result.current.username).toBeNull();
    expect(result.current.displayName).toBeNull();
  });
});
