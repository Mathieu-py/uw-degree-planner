// Shared HTTP helpers for the scraper's data-source fetchers. The retry loop
// here was re-implemented verbatim in kualiCourses.ts and uwflowCourses.ts;
// centralizing it keeps their backoff/timeout behaviour identical.

/** Resolve after `ms` milliseconds. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` up to `attempts` times (default 3), awaiting `backoffMs(attempt)`
 * before each retry. Rethrows the last error once attempts are exhausted. `fn`
 * gets the 0-based attempt index. Every thrown error is retryable — a
 * `TimeoutError` from `AbortSignal.timeout` is treated like any other failure.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { attempts?: number; backoffMs?: (attempt: number) => number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const backoffMs = opts.backoffMs ?? ((a) => 500 * 2 ** a);
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt < attempts - 1) await sleep(backoffMs(attempt));
    }
  }
  throw lastErr;
}

/**
 * GET `url` and parse JSON, aborting after `timeoutMs` (default 15s). One
 * attempt — callers that need retries wrap this in {@link withRetry}. Throws on
 * a non-OK status. Used by the program scraper's Kuali calls.
 */
export async function fetchJson<T>(
  url: string,
  timeoutMs = 15_000,
): Promise<T> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(tid);
  }
}
