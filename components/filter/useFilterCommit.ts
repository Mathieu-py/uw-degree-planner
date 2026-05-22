"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";
import { buildBrowseUrl } from "@/lib/browseUrl";

/**
 * Commit a slice of catalog state to the URL via the supplied merger. The
 * merger is responsible for clearing only its own keys, so commits from one
 * slice never disturb sort params or the other slice's keys.
 *
 * `p` (page) is always cleared on commit — a filter or passage change
 * invalidates pagination.
 *
 * `router.replace` runs inside `startTransition` so concurrent commits don't
 * block typing/sliders.
 */
export function useFilterCommit<T>(
  merger: (params: URLSearchParams, next: T) => URLSearchParams,
): (next: T) => void {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  return useCallback(
    (next: T) => {
      const url = buildBrowseUrl(pathname, (params) => {
        const merged = merger(params, next);
        merged.delete("p");
        return merged;
      });
      startTransition(() => {
        router.replace(url, { scroll: false });
      });
    },
    [pathname, router, merger],
  );
}
