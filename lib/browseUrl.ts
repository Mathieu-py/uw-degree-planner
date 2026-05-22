/**
 * Shared plumbing for the three browse-page URL writers (FilterPanel.commit,
 * CourseBrowser.setPageInUrl, CourseBrowser.setPresentation): read the live
 * querystring, let the caller mutate it, persist to localStorage, and hand
 * back a URL string for the caller to push via `router.replace`. The
 * transform may mutate in place or return a fresh URLSearchParams (the codec
 * helpers in filterState.ts do the latter).
 *
 * Caller does the router.replace itself so callers that need
 * startTransition (filter edits) can wrap it without forcing transitions on
 * the sort/page paths.
 */

import { BROWSE_QS_STORAGE_KEY } from "./filterState";
import { safeSetItem } from "./storage";

export function buildBrowseUrl(
  pathname: string,
  // biome-ignore lint/suspicious/noConfusingVoidType: callbacks may either mutate params in place (return void) or return a replacement URLSearchParams
  transform: (params: URLSearchParams) => URLSearchParams | void,
): string {
  const params = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : "",
  );
  const result = transform(params) ?? params;
  const qs = result.toString();
  safeSetItem(BROWSE_QS_STORAGE_KEY, qs);
  return qs ? `${pathname}?${qs}` : pathname;
}
