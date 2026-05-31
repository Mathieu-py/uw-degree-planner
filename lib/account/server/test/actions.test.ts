import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Supabase server client before importing the actions, so they never
// reach next/headers. Mirrors lib/plan/server/test/actions.test.ts.
const { createSupabaseServerClientMock } = vi.hoisted(() => ({
  createSupabaseServerClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock,
}));

import { deleteAccount, updateProfile } from "../actions";

type ChainResult = { data: unknown; error: unknown };

// A thenable PostgREST-shaped chain: from('profiles').update().eq().select()
// resolves (via await) to the supplied terminal.
function makeChain(terminal: ChainResult) {
  // biome-ignore lint/suspicious/noExplicitAny: test scaffolding for a fluent builder
  const chain: any = {
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    select: vi.fn(() => chain),
    // biome-ignore lint/suspicious/noThenProperty: emulating a PostgREST query builder
    then: (
      onFulfilled?: (v: ChainResult) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve(terminal).then(onFulfilled, onRejected),
  };
  return chain;
}

interface ClientHandlers {
  user?: { id: string } | null;
  profiles?: ChainResult;
  rpc?: ChainResult;
  updateUserError?: unknown;
}

function installClient(h: ClientHandlers = {}) {
  const updateUser = vi.fn(async () => ({
    data: {},
    error: h.updateUserError ?? null,
  }));
  // biome-ignore lint/suspicious/noExplicitAny: matches supabase-js loose typing
  const client: any = {
    auth: {
      getUser: vi.fn(async () =>
        h.user === null
          ? { data: { user: null }, error: null }
          : { data: { user: h.user ?? { id: "user-1" } }, error: null },
      ),
      updateUser,
    },
    from: vi.fn(() => makeChain(h.profiles ?? { data: [], error: null })),
    rpc: vi.fn(async () => h.rpc ?? { data: null, error: null }),
  };
  createSupabaseServerClientMock.mockResolvedValue(client);
  return { client, updateUser };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth guard", () => {
  it("updateProfile returns not_authenticated with no session", async () => {
    installClient({ user: null });
    expect(await updateProfile({ username: "alice" })).toEqual({
      ok: false,
      error: "not_authenticated",
    });
  });

  it("deleteAccount returns not_authenticated with no session", async () => {
    installClient({ user: null });
    expect(await deleteAccount()).toEqual({
      ok: false,
      error: "not_authenticated",
    });
  });
});

describe("updateProfile", () => {
  it("rejects an empty username", async () => {
    installClient();
    expect(await updateProfile({ username: "   " })).toEqual({
      ok: false,
      error: "username_required",
    });
  });

  it.each([
    "ab",
    "a".repeat(21),
    "bad name",
    "no-dashes",
    "emoji😀",
  ])("rejects invalid username %j", async (username) => {
    installClient();
    expect(await updateProfile({ username })).toEqual({
      ok: false,
      error: "username_invalid",
    });
  });

  it("updates the profile and syncs auth metadata on success", async () => {
    const { updateUser } = installClient({
      profiles: { data: [{ username: "alice" }], error: null },
    });
    const result = await updateProfile({ username: "alice" });
    expect(result).toEqual({ ok: true, data: { username: "alice" } });
    expect(updateUser).toHaveBeenCalledWith({ data: { username: "alice" } });
  });

  it("trims the username before writing", async () => {
    const { client } = installClient({
      profiles: { data: [{ username: "alice" }], error: null },
    });
    await updateProfile({ username: "  alice  " });
    const chain = client.from.mock.results[0].value;
    expect(chain.update).toHaveBeenCalledWith({ username: "alice" });
  });

  it("maps a unique-violation to username_taken", async () => {
    installClient({
      profiles: { data: null, error: { code: "23505", message: "dup" } },
    });
    expect(await updateProfile({ username: "alice" })).toEqual({
      ok: false,
      error: "username_taken",
    });
  });

  it("detects the constraint name even without the code", async () => {
    installClient({
      profiles: {
        data: null,
        error: { message: "duplicate key value violates profiles_username" },
      },
    });
    expect(await updateProfile({ username: "alice" })).toEqual({
      ok: false,
      error: "username_taken",
    });
  });

  it("returns a generic error for other DB failures (no raw message leak)", async () => {
    installClient({
      profiles: { data: null, error: { code: "08006", message: "db down" } },
    });
    expect(await updateProfile({ username: "alice" })).toEqual({
      ok: false,
      error: "something_went_wrong",
    });
  });

  it("returns not_found when RLS hid the row (no rows updated)", async () => {
    installClient({ profiles: { data: [], error: null } });
    expect(await updateProfile({ username: "alice" })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("deleteAccount", () => {
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
