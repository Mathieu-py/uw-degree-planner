import * as Sentry from "@sentry/nextjs";

/**
 * Logging seam. `logError` for recovered exceptions (console + Sentry),
 * `logWarn` for non-fatal issues (console only — they land in server logs).
 */

export function logError(message: string, ...detail: unknown[]): void {
  console.error(message, ...detail);
  // No-op when the DSN is unset (local/CI/tests).
  Sentry.captureException(
    detail.find((d) => d instanceof Error) ?? new Error(message),
    { extra: { message, detail } },
  );
}

export function logWarn(message: string, ...detail: unknown[]): void {
  console.warn(message, ...detail);
}
