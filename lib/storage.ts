/**
 * Browser localStorage wrappers that swallow access errors (Safari private mode
 * throws SecurityError; setItem throws on quota). Reads return `null` on
 * failure, writes/removes are best-effort. SSR-safe: each call checks for
 * `window` first.
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
 * Returns `true` on a successful write, `false` if storage is unavailable or the
 * write threw (quota, Safari private mode, SSR). Check the return value to
 * surface a "couldn't save" affordance; ignore it for best-effort persistence.
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
