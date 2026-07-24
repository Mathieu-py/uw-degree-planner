import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Supabase server client before importing the actions, so they never
// reach next/headers. Mirrors lib/plan/server/test/actions.test.ts.
const { createSupabaseServerClientMock } = vi.hoisted(() => ({
  createSupabaseServerClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock,
}));

import { deleteAccount } from "../actions";

interface ClientHandlers {
  user?: { id: string } | null;
  rpc?: { data: unknown; error: unknown };
}

function installClient(h: ClientHandlers = {}) {
  // biome-ignore lint/suspicious/noExplicitAny: matches supabase-js loose typing
  const client: any = {
    auth: {
      getUser: vi.fn(async () =>
        h.user === null
          ? { data: { user: null }, error: null }
          : { data: { user: h.user ?? { id: "user-1" } }, error: null },
      ),
    },
    rpc: vi.fn(async () => h.rpc ?? { data: null, error: null }),
  };
  createSupabaseServerClientMock.mockResolvedValue(client);
  return { client };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deleteAccount", () => {
  it("returns not_authenticated with no session", async () => {
    installClient({ user: null });
    expect(await deleteAccount()).toEqual({
      ok: false,
      error: "not_authenticated",
    });
  });

  it("calls the delete_own_account RPC and succeeds", async () => {
    const { client } = installClient({ rpc: { data: null, error: null } });
    expect(await deleteAccount()).toEqual({ ok: true, data: undefined });
    expect(client.rpc).toHaveBeenCalledWith("delete_own_account");
  });

  it("returns a generic error when the RPC fails", async () => {
    installClient({ rpc: { data: null, error: { message: "nope" } } });
    expect(await deleteAccount()).toEqual({
      ok: false,
      error: "something_went_wrong",
    });
  });
});
