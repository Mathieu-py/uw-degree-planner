"use client";

import { useEffect } from "react";

/**
 * Window-level `keydown` listener that invokes `onClose` on Escape, cleaned up
 * on unmount. A fresh `onClose` re-registers, so `useCallback` it. Pass `null`
 * to skip registration (e.g. a closed dropdown with nothing to close).
 */
export function useEscape(onClose: (() => void) | null): void {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}
