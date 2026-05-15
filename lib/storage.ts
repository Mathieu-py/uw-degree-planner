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

export function safeSetItem(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Quota exceeded or storage disabled (Safari private mode). The caller's
    // primary state path (URL, in-memory) is already authoritative.
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
