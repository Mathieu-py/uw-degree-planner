/**
 * Logging seam. `logError` for recovered exceptions (console + Sentry),
 * `logWarn` for non-fatal issues (console only — they land in server logs).
 */

export function logError(message: string, ...detail: unknown[]): void {
  console.error(message, ...detail);
  const error = detail.find((d) => d instanceof Error) ?? new Error(message);
  // Lazy import so logWarn-only consumers (the edge middleware) don't bundle
  // Sentry. Best-effort telemetry: no-op when the DSN is unset, and a failed
  // load or send must never surface.
  void import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.captureException(error, { extra: { message, detail } });
    })
    .catch(() => {});
}

export function logWarn(message: string, ...detail: unknown[]): void {
  console.warn(message, ...detail);
}
