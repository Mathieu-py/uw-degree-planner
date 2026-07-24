/**
 * Logging seam. `logError` for recovered exceptions (console + Sentry),
 * `logWarn` for non-fatal issues (console only — they land in server logs).
 *
 * Sentry gets ONLY the allowlisted {@link Telemetry} tags plus a derived
 * exception whose message is the caller-supplied (safe) string — never the raw
 * `detail` object. `sanitizeSentryEvent` is a second layer that scrubs anything
 * sensitive the SDK attaches on its own (request data, PII). Together they back
 * the legal page's "reported without personal data" claim.
 */

import type { ErrorEvent } from "@sentry/nextjs";

/** Stable, non-sensitive fields — the only app data forwarded to Sentry. Never
 *  derive these from user / DB / transcript content. */
export interface Telemetry {
  /** Stable operation name, e.g. "loadServerPlan.plan". */
  op: string;
  category?: "db" | "client" | "server";
  /** Stable code (SQLSTATE / app code) — never a message. */
  code?: string;
}

export function logError(
  message: string,
  detail?: unknown,
  telemetry?: Telemetry,
): void {
  if (detail === undefined) console.error(message);
  else console.error(message, detail);

  // Never send the raw detail: it may be a PostgrestError (schema internals) or
  // carry user data. Group under the safe caller message unless detail is
  // already a bare Error.
  const error = detail instanceof Error ? detail : new Error(message);

  const context: { tags?: Record<string, string> } = {};
  if (telemetry) {
    context.tags = { op: telemetry.op };
    if (telemetry.category) context.tags.category = telemetry.category;
    if (telemetry.code) context.tags.code = telemetry.code;
  }

  // Lazy import so logWarn-only consumers (the edge middleware) don't bundle
  // Sentry. Best-effort: no-op when the DSN is unset, and a failed load or send
  // must never surface.
  void import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.captureException(error, context);
    })
    .catch(() => {});
}

export function logWarn(message: string, ...detail: unknown[]): void {
  console.warn(message, ...detail);
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// A /p/<token> path segment is a capability link — the token grants read access
// to a shared plan, so it must never appear in telemetry.
const SHARE_PATH_RE = /\/p\/[^/?#\s]+/g;

/** Redact emails and share-plan tokens from a free-text field. */
function redactText<T extends string | undefined>(text: T): T {
  if (text == null) return text;
  return text
    .replace(SHARE_PATH_RE, "/p/[redacted]")
    .replace(EMAIL_RE, "[email]") as T;
}

/** Drop query/fragment (may carry emails, redirect targets) and redact share
 *  tokens from a URL. Unparseable input is redacted as free text. */
function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return redactText(u.toString());
  } catch {
    return redactText(url.split(/[?#]/)[0]);
  }
}

/**
 * Shared `beforeSend` for the server and client SDKs. Belt-and-suspenders over
 * `sendDefaultPii: false`: strips request cookies/headers/body/query and any
 * `extra`/`user`/host the SDK or `captureRequestError` attaches, and redacts
 * emails + share tokens from every free-text field. Pure — safe to unit-test.
 */
export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    event.request.cookies = undefined;
    event.request.headers = undefined;
    event.request.data = undefined; // request body
    event.request.query_string = undefined;
    if (typeof event.request.url === "string")
      event.request.url = redactUrl(event.request.url);
  }
  event.user = undefined;
  event.extra = undefined; // never forward arbitrary detail
  event.server_name = undefined; // host leak

  event.message = redactText(event.message);
  for (const ex of event.exception?.values ?? [])
    ex.value = redactText(ex.value);
  for (const bc of event.breadcrumbs ?? []) {
    bc.message = redactText(bc.message);
    bc.data = undefined;
  }
  return event;
}
