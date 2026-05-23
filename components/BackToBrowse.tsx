"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BROWSE_QS_STORAGE_KEY } from "@/lib/filterState";
import { safeGetItem } from "@/lib/storage";

interface Props {
  className?: string;
  children: React.ReactNode;
}

/**
 * Link to /browse that preserves the user's last filter querystring (saved by
 * buildBrowseUrl on every browse-page URL write). Falls back to bare /browse
 * when nothing is stored — direct visits, never browsed, etc.
 *
 * The href starts as "/browse" so SSR and initial client render match; the
 * effect upgrades it after mount. A link the user has to click can absorb a
 * post-mount href update without anyone noticing.
 *
 * The saved value is stored without the leading "?", matching buildBrowseUrl
 * and the RestorePill's restore button.
 */
export function BackToBrowse({ className, children }: Props) {
  const [href, setHref] = useState("/browse");

  useEffect(() => {
    const saved = safeGetItem(BROWSE_QS_STORAGE_KEY);
    if (saved && saved !== "") setHref(`/browse?${saved}`);
  }, []);

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
