/**
 * Browser localStorage wrappers that swallow access errors. Safari private
 * mode throws `SecurityError` on every call and quota-exceeded throws on
 * setItem; without these wrappers a single failure crashes the rendering
 * component. Reads return `null` on failure, writes/removes are best-effort.
 *
 * SSR-safe: every call checks for `window` before touching it, so these
 * helpers are callable from useEffect bodies and event handlers in client
 * components without conditional imports.
 */

export function safeGetItem(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Returns `true` on a successful write, `false` if storage is unavailable or
 * the write threw (QuotaExceededError, SecurityError in Safari private mode,
 * SSR). Callers that need to surface a "couldn't save" affordance should check
 * the return value; callers that only want best-effort persistence can ignore
 * it.
 */
export function safeSetItem(key: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeRemoveItem(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
