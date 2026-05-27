"use client";

import { useEffect } from "react";

/**
 * Attach a window-level `keydown` listener that invokes `onClose` when the
 * user presses Escape. Used by every modal in the planner. Listener is
 * registered for the lifetime of the calling component and cleaned up on
 * unmount; passing a fresh `onClose` reference re-registers, so callers
 * should `useCallback` the handler if it would otherwise re-create per
 * render.
 *
 * Pass `null` to skip registration entirely — lets callers (e.g. a closed
 * dropdown) avoid holding a global listener when there's nothing to close.
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
