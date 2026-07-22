import { vi } from "vitest";

// Sets the Supabase env at module load — import this harness ABOVE the store
// import so SUPABASE_CONFIGURED (computed once, at the store's module load) is
// true. Not a *.test.* file, so Vitest doesn't collect it as a suite.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

export const createSupabaseBrowserClientMock = vi.fn();
export const getSessionMock = vi.fn();
export const onAuthStateChangeMock = vi.fn();
export const maybeSingleMock = vi.fn();

/**
 * Point the client mock at a fresh Supabase stub: the auth surface plus the
 * `from("profiles").select().eq().maybeSingle()` chain the store's profile
 * sync walks (each step returns the next link).
 */
export function stubSupabaseClient(): void {
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
}
