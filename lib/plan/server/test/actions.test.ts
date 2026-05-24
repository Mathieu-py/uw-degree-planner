import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @/lib/supabase/server BEFORE importing the actions module, so the
// actions never touch next/headers (which only works inside Next.js).
// `vi.mock` is hoisted to the top of the file by Vitest's transform; the
// mock fn must be declared via `vi.hoisted` so it lives in the same hoisted
// scope as the factory below.
const { createSupabaseServerClientMock } = vi.hoisted(() => ({
  createSupabaseServerClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock,
}));

import {
  createPlan,
  deletePlan,
  listPlans,
  loadServerPlan,
  renamePlan,
  savePlanState,
} from "../actions";
import type { PlanSnapshot } from "../types";

// Awaitable PostgREST-shaped chain. Each builder method returns the chain
// (so `select().eq().order()` keeps chaining). Terminal access happens via
// `await chain` (PostgREST returns `{ data, error }` when awaited) or via
// `.single()` / `.maybeSingle()`. A single terminal is shared across both
// styles since every action picks one.
type ChainResult = { data: unknown; error: unknown };

function makeChain(terminal: ChainResult) {
  // biome-ignore lint/suspicious/noExplicitAny: test scaffolding for a fluent builder
  const chain: any = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(terminal)),
    maybeSingle: vi.fn(() => Promise.resolve(terminal)),
    // PostgREST builders are thenable so `await chain` resolves to
    // `{ data, error }`. The `then` property is intentional — biome's
    // thenable-object rule flags it, but that's exactly the shape we need.
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
  tables?: Record<string, ChainResult>;
  // Per-table queue: if defined, each call to `from(table)` pops the next
  // result so we can return different terminals to insert vs. delete on the
  // same table within one action.
  tableQueues?: Record<string, ChainResult[]>;
  rpc?: ChainResult;
}

function installClient(h: ClientHandlers = {}) {
  const fromCalls: string[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: matches supabase-js loose typing
  const client: any = {
    auth: {
      getUser: vi.fn(async () =>
        h.user === null
          ? { data: { user: null }, error: null }
          : h.user
            ? { data: { user: h.user }, error: null }
            : { data: { user: { id: "user-1" } }, error: null },
      ),
    },
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      const queue = h.tableQueues?.[table];
      const next = queue?.shift();
      if (next) return makeChain(next);
      const fallback = h.tables?.[table] ?? { data: [], error: null };
      return makeChain(fallback);
    }),
    rpc: vi.fn(async () => h.rpc ?? { data: null, error: null }),
  };
  createSupabaseServerClientMock.mockResolvedValue(client);
  return { client, fromCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

const SNAPSHOT: PlanSnapshot = {
  programId: "h-cs",
  specializationId: null,
  stream: "regular",
  startTermId: 1239,
  programScrapeVersion: null,
  slots: [
    {
      id: "s1",
      termId: 1239,
      position: "1A",
      isCoop: false,
      courses: [{ code: "cs115" }],
    },
  ],
};

describe("auth guard", () => {
  it.each([
    ["listPlans", () => listPlans()],
    ["loadServerPlan", () => loadServerPlan("plan-1")],
    ["savePlanState", () => savePlanState("plan-1", SNAPSHOT)],
    ["renamePlan", () => renamePlan("plan-1", "new name")],
    ["deletePlan", () => deletePlan("plan-1")],
    ["createPlan", () => createPlan({ name: "P" })],
  ])("%s returns not_authenticated when no session", async (_name, run) => {
    installClient({ user: null });
    const result = await run();
    expect(result).toEqual({ ok: false, error: "not_authenticated" });
  });
});

describe("listPlans", () => {
  it("maps rows to summaries on success", async () => {
    const { client } = installClient({
      tables: {
        plans: {
          data: [
            {
              id: "p1",
              name: "A",
              program_id: null,
              specialization_id: null,
              system_of_study: "regular",
              start_term_id: 1239,
              program_scrape_version: null,
              updated_at: "2026-05-24T00:00:00.000Z",
            },
          ],
          error: null,
        },
      },
    });
    const result = await listPlans();
    expect(result).toEqual({
      ok: true,
      data: [
        {
          id: "p1",
          name: "A",
          programId: null,
          specializationId: null,
          stream: "regular",
          startTermId: 1239,
          updatedAt: "2026-05-24T00:00:00.000Z",
        },
      ],
    });
    expect(client.from).toHaveBeenCalledWith("plans");
  });

  it("returns the error message when supabase fails", async () => {
    installClient({
      tables: {
        plans: { data: null, error: { message: "boom" } },
      },
    });
    const result = await listPlans();
    expect(result).toEqual({ ok: false, error: "boom" });
  });
});

describe("createPlan", () => {
  it("rejects empty / whitespace-only names", async () => {
    installClient();
    expect(await createPlan({ name: "" })).toEqual({
      ok: false,
      error: "name_required",
    });
    expect(await createPlan({ name: "   " })).toEqual({
      ok: false,
      error: "name_required",
    });
  });

  it("inserts and returns the new id", async () => {
    installClient({
      tables: {
        plans: { data: { id: "new-plan" }, error: null },
      },
    });
    const result = await createPlan({ name: "Fresh" });
    expect(result).toEqual({ ok: true, data: { id: "new-plan" } });
  });

  it("seeds via save_plan_state when a snapshot is provided", async () => {
    const { client } = installClient({
      tables: {
        plans: { data: { id: "new-plan" }, error: null },
      },
    });
    const result = await createPlan({ name: "Fresh", seed: SNAPSHOT });
    expect(result).toEqual({ ok: true, data: { id: "new-plan" } });
    expect(client.rpc).toHaveBeenCalledWith("save_plan_state", {
      p_plan_id: "new-plan",
      p_snapshot: SNAPSHOT,
    });
  });

  it("rolls the new plan back if the seed save fails", async () => {
    const { client } = installClient({
      // First `from('plans')` is the insert (success). Second is the delete
      // (rollback). The delete's data shape doesn't matter here.
      tableQueues: {
        plans: [
          { data: { id: "new-plan" }, error: null },
          { data: [], error: null },
        ],
      },
      rpc: { data: null, error: { message: "rpc failed" } },
    });
    const result = await createPlan({ name: "Fresh", seed: SNAPSHOT });
    expect(result).toEqual({ ok: false, error: "rpc failed" });
    // Ensure the rollback actually ran (second from + delete on the chain).
    expect(client.from).toHaveBeenCalledTimes(2);
  });
});

describe("renamePlan", () => {
  it("rejects empty names", async () => {
    installClient();
    expect(await renamePlan("p1", "   ")).toEqual({
      ok: false,
      error: "name_required",
    });
  });

  it("returns not_found_or_unauthorized when zero rows update", async () => {
    installClient({
      tables: { plans: { data: [], error: null } },
    });
    expect(await renamePlan("p1", "new")).toEqual({
      ok: false,
      error: "not_found_or_unauthorized",
    });
  });

  it("succeeds when one row updates", async () => {
    installClient({
      tables: { plans: { data: [{ id: "p1" }], error: null } },
    });
    expect(await renamePlan("p1", "new")).toEqual({
      ok: true,
      data: undefined,
    });
  });
});

describe("deletePlan", () => {
  it("returns not_found_or_unauthorized when zero rows deleted", async () => {
    installClient({
      tables: { plans: { data: [], error: null } },
    });
    expect(await deletePlan("p1")).toEqual({
      ok: false,
      error: "not_found_or_unauthorized",
    });
  });

  it("succeeds when at least one row deleted", async () => {
    installClient({
      tables: { plans: { data: [{ id: "p1" }], error: null } },
    });
    expect(await deletePlan("p1")).toEqual({ ok: true, data: undefined });
  });
});

describe("loadServerPlan", () => {
  it("returns null when plan row is not found", async () => {
    installClient({
      tables: { plans: { data: null, error: null } },
    });
    expect(await loadServerPlan("p1")).toEqual({ ok: true, data: null });
  });

  it("assembles plan + slots + courses on success", async () => {
    installClient({
      tableQueues: {
        plans: [
          {
            data: {
              id: "p1",
              name: "My plan",
              program_id: "h-cs",
              specialization_id: null,
              system_of_study: "regular",
              start_term_id: 1239,
              program_scrape_version: null,
              updated_at: "2026-05-24T00:00:00.000Z",
            },
            error: null,
          },
        ],
        plan_slots: [
          {
            data: [
              {
                id: "s1",
                plan_id: "p1",
                term_id: 1239,
                position: "1A",
                is_coop: false,
                ordinal: 0,
              },
            ],
            error: null,
          },
        ],
        plan_courses: [
          {
            data: [
              {
                id: "c1",
                slot_id: "s1",
                course_code: "cs115",
                grade: null,
                ordinal: 0,
              },
            ],
            error: null,
          },
        ],
      },
    });
    const result = await loadServerPlan("p1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data?.id).toBe("p1");
    expect(result.data?.slots).toHaveLength(1);
    expect(result.data?.slots[0].courses).toEqual([{ code: "cs115" }]);
  });

  it("returns an error when the plan query fails", async () => {
    installClient({
      tables: {
        plans: { data: null, error: { message: "db down", code: "08006" } },
      },
    });
    const result = await loadServerPlan("p1");
    expect(result).toEqual({ ok: false, error: "db down" });
  });

  it("returns an error when the slot query fails", async () => {
    installClient({
      tableQueues: {
        plans: [
          {
            data: {
              id: "p1",
              name: "My plan",
              program_id: null,
              specialization_id: null,
              system_of_study: null,
              start_term_id: null,
              program_scrape_version: null,
              updated_at: "2026-05-24T00:00:00.000Z",
            },
            error: null,
          },
        ],
        plan_slots: [{ data: null, error: { message: "slot error" } }],
      },
    });
    const result = await loadServerPlan("p1");
    expect(result).toEqual({ ok: false, error: "slot error" });
  });

  it("returns an error when the course query fails", async () => {
    installClient({
      tableQueues: {
        plans: [
          {
            data: {
              id: "p1",
              name: "My plan",
              program_id: null,
              specialization_id: null,
              system_of_study: null,
              start_term_id: null,
              program_scrape_version: null,
              updated_at: "2026-05-24T00:00:00.000Z",
            },
            error: null,
          },
        ],
        plan_slots: [
          {
            data: [
              {
                id: "s1",
                plan_id: "p1",
                term_id: 1239,
                position: "1A",
                is_coop: false,
                ordinal: 0,
              },
            ],
            error: null,
          },
        ],
        plan_courses: [{ data: null, error: { message: "course error" } }],
      },
    });
    const result = await loadServerPlan("p1");
    expect(result).toEqual({ ok: false, error: "course error" });
  });

  it("skips the courses query when there are no slots", async () => {
    const { client } = installClient({
      tableQueues: {
        plans: [
          {
            data: {
              id: "p1",
              name: "Empty",
              program_id: null,
              specialization_id: null,
              system_of_study: null,
              start_term_id: null,
              program_scrape_version: null,
              updated_at: "2026-05-24T00:00:00.000Z",
            },
            error: null,
          },
        ],
        plan_slots: [{ data: [], error: null }],
      },
    });
    const result = await loadServerPlan("p1");
    expect(result.ok).toBe(true);
    // Only plans + plan_slots queried — plan_courses skipped when slot list
    // is empty (avoids a wasted round trip on every freshly-created plan).
    expect(client.from).toHaveBeenCalledTimes(2);
    expect(client.from).not.toHaveBeenCalledWith("plan_courses");
  });
});

describe("savePlanState", () => {
  it("calls the save_plan_state RPC with the snapshot", async () => {
    const { client } = installClient();
    const result = await savePlanState("p1", SNAPSHOT);
    expect(result).toEqual({ ok: true, data: undefined });
    expect(client.rpc).toHaveBeenCalledWith("save_plan_state", {
      p_plan_id: "p1",
      p_snapshot: SNAPSHOT,
    });
  });

  it("surfaces RPC errors", async () => {
    installClient({
      rpc: { data: null, error: { message: "rls denied" } },
    });
    const result = await savePlanState("p1", SNAPSHOT);
    expect(result).toEqual({ ok: false, error: "rls denied" });
  });
});
