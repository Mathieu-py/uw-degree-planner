import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverCatalogId } from "../scrape-programs";

const FALLBACK = "67e557ed6ed2fe2bd3a38956";

// Test "today" pinned to 2026-05-22 (the date in the user's CLAUDE.md) so
// the activity-window tests are deterministic regardless of when CI runs.
const NOW = new Date("2026-05-22T00:00:00Z");

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(responder: () => Response | Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(responder));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("discoverCatalogId", () => {
  it("picks the active undergraduate catalog from a bare array response", async () => {
    mockFetch(() =>
      jsonResponse([
        {
          _id: "old-grad",
          title: "Fall 2024 Graduate Calendar",
          startDate: "2024-08-22",
          endDate: "2024-12-19",
        },
        {
          _id: "current-ug",
          title: "2026-2027 Undergraduate Studies Academic Calendar",
          startDate: "2026-04-01",
          endDate: "2027-04-01",
        },
        {
          _id: "future-ug",
          title: "2027-2028 Undergraduate Studies Academic Calendar",
          startDate: "2027-04-01",
          endDate: "2028-04-01",
        },
        {
          _id: "expired-ug",
          title: "2025-2026 Undergraduate Studies Academic Calendar",
          startDate: "2025-04-01",
          endDate: "2026-04-01",
        },
      ]),
    );
    expect(await discoverCatalogId(NOW)).toBe("current-ug");
  });

  it("accepts the wrapped `{catalogs: [...]}` shape", async () => {
    mockFetch(() =>
      jsonResponse({
        catalogs: [
          {
            _id: "ug-1",
            title: "2026-2027 Undergraduate Studies Academic Calendar",
            startDate: "2026-04-01",
            endDate: "2027-04-01",
          },
        ],
      }),
    );
    expect(await discoverCatalogId(NOW)).toBe("ug-1");
  });

  it("accepts `id` and `_id` field names interchangeably", async () => {
    mockFetch(() =>
      jsonResponse([
        {
          id: "ug-by-id",
          title: "2026-2027 Undergraduate Studies Academic Calendar",
          startDate: "2026-04-01",
          endDate: "2027-04-01",
        },
      ]),
    );
    expect(await discoverCatalogId(NOW)).toBe("ug-by-id");
  });

  it("falls back when HTTP returns non-2xx", async () => {
    mockFetch(() => new Response("not found", { status: 404 }));
    expect(await discoverCatalogId(NOW)).toBe(FALLBACK);
  });

  it("falls back when JSON is malformed", async () => {
    mockFetch(() => new Response("{not json", { status: 200 }));
    expect(await discoverCatalogId(NOW)).toBe(FALLBACK);
  });

  it("falls back when no entry's title matches 'undergraduate'", async () => {
    mockFetch(() =>
      jsonResponse([
        {
          _id: "grad-only",
          title: "Fall 2026 Graduate Calendar",
          startDate: "2026-08-01",
          endDate: "2026-12-31",
        },
      ]),
    );
    expect(await discoverCatalogId(NOW)).toBe(FALLBACK);
  });

  it("falls back when no undergraduate catalog is currently active", async () => {
    mockFetch(() =>
      jsonResponse([
        {
          _id: "expired",
          title: "2025-2026 Undergraduate Studies Academic Calendar",
          startDate: "2025-04-01",
          endDate: "2026-04-01",
        },
        {
          _id: "future",
          title: "2027-2028 Undergraduate Studies Academic Calendar",
          startDate: "2027-04-01",
          endDate: "2028-04-01",
        },
      ]),
    );
    expect(await discoverCatalogId(NOW)).toBe(FALLBACK);
  });
});
