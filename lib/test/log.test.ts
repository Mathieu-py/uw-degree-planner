import type { ErrorEvent } from "@sentry/nextjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureExceptionMock } = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: captureExceptionMock }));

import { logError, sanitizeSentryEvent } from "../log";

// logError fires a dynamic import(); flush it before asserting.
async function flushCapture() {
  await vi.waitFor(() => expect(captureExceptionMock).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("logError → Sentry", () => {
  it("forwards a DB error as allowlisted tags only, never the raw message", async () => {
    const raw = {
      code: "42P01",
      message: 'relation "public.secret_table" does not exist',
    };
    logError("[db] loadServerPlan.plan", raw, {
      op: "loadServerPlan.plan",
      category: "db",
      code: "42P01",
    });
    await flushCapture();

    const [error, context] = captureExceptionMock.mock.calls[0];
    // Grouped under the safe caller message — the raw Postgres message is gone.
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("[db] loadServerPlan.plan");
    expect(context).toEqual({
      tags: { op: "loadServerPlan.plan", category: "db", code: "42P01" },
    });
    expect(context.extra).toBeUndefined();
    // The schema-leaking string appears nowhere in what Sentry receives.
    expect(JSON.stringify([error.message, context])).not.toContain(
      "secret_table",
    );
  });

  it("sends a transcript error without filename or user data", async () => {
    logError(
      "Transcript PDF extraction failed:",
      new Error("Not a PDF file. Upload a Quest unofficial transcript PDF."),
      { op: "transcript.extract", category: "client" },
    );
    await flushCapture();

    const [, context] = captureExceptionMock.mock.calls[0];
    expect(Object.keys(context.tags)).toEqual(["op", "category"]);
    expect(context.tags).toEqual({
      op: "transcript.extract",
      category: "client",
    });
    expect(context.extra).toBeUndefined();
  });

  it("omits absent optional tags and sends no context without telemetry", async () => {
    logError("boom", new Error("x"));
    await flushCapture();
    const [, context] = captureExceptionMock.mock.calls[0];
    expect(context).toEqual({});
  });

  it("is harmless when the Sentry transport throws", async () => {
    captureExceptionMock.mockImplementation(() => {
      throw new Error("send failed");
    });
    // Best-effort: the rejection is swallowed and nothing surfaces to the caller.
    expect(() => logError("boom", new Error("x"), { op: "t" })).not.toThrow();
    await flushCapture();
  });
});

describe("sanitizeSentryEvent", () => {
  function eventWithRequest(): ErrorEvent {
    return {
      type: undefined,
      message: "failed for user alice@uwaterloo.ca",
      request: {
        url: "https://plan.example/p/SECRETTOKEN?email=bob@x.com#frag",
        query_string: "email=bob@x.com",
        cookies: { session: "abc" },
        headers: { authorization: "Bearer xyz", cookie: "session=abc" },
        data: { grade: "97", plan: "My secret plan" },
      },
      user: { id: "u1", email: "alice@uwaterloo.ca", ip_address: "1.2.3.4" },
      extra: { detail: { message: "raw pg error" } },
      server_name: "prod-box-01",
      exception: {
        values: [{ type: "Error", value: "duplicate share /p/OTHERTOKEN" }],
      },
      breadcrumbs: [
        { message: "navigated to /p/CRUMBTOKEN", data: { plan: "secret" } },
      ],
    };
  }

  it("strips request cookies, headers, body, and query string", () => {
    const out = sanitizeSentryEvent(eventWithRequest());
    expect(out.request?.cookies).toBeUndefined();
    expect(out.request?.headers).toBeUndefined();
    expect(out.request?.data).toBeUndefined();
    expect(out.request?.query_string).toBeUndefined();
  });

  it("redacts share tokens and query/fragment from the request url", () => {
    const out = sanitizeSentryEvent(eventWithRequest());
    expect(out.request?.url).toBe("https://plan.example/p/[redacted]");
  });

  it("drops user, extra, and server_name", () => {
    const out = sanitizeSentryEvent(eventWithRequest());
    expect(out.user).toBeUndefined();
    expect(out.extra).toBeUndefined();
    expect(out.server_name).toBeUndefined();
  });

  it("redacts emails and share tokens in message, exceptions, and breadcrumbs", () => {
    const out = sanitizeSentryEvent(eventWithRequest());
    expect(out.message).toBe("failed for user [email]");
    expect(out.exception?.values?.[0].value).toBe(
      "duplicate share /p/[redacted]",
    );
    expect(out.breadcrumbs?.[0].message).toBe("navigated to /p/[redacted]");
    expect(out.breadcrumbs?.[0].data).toBeUndefined();
  });

  it("leaves an event without request/exception/breadcrumbs intact", () => {
    const out = sanitizeSentryEvent({ type: undefined, message: "plain" });
    expect(out.message).toBe("plain");
  });
});
