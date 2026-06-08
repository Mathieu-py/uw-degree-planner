/**
 * Logging seam: forwards to `console`, but one place to wire a reporter (Sentry)
 * later. `logError` for recovered exceptions, `logWarn` for non-fatal issues.
 */

export function logError(message: string, ...detail: unknown[]): void {
  // TODO: forward to an error reporter (e.g. Sentry).
  console.error(message, ...detail);
}

export function logWarn(message: string, ...detail: unknown[]): void {
  console.warn(message, ...detail);
}
