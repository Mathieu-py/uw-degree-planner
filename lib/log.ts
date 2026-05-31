/**
 * Logging seam: forwards to `console` today, but a single place to wire an
 * error reporter (Sentry, etc.) later. `logError` for recovered exceptions,
 * `logWarn` for degraded-but-non-fatal conditions.
 */

export function logError(message: string, ...detail: unknown[]): void {
  // TODO: forward to an error reporter (e.g. Sentry).
  console.error(message, ...detail);
}

export function logWarn(message: string, ...detail: unknown[]): void {
  console.warn(message, ...detail);
}
