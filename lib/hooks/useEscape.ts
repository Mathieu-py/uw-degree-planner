"use client";

import { useEffect } from "react";

/**
 * Attach a window-level `keydown` listener that invokes `onClose` when the
 * user presses Escape. Used by every modal in the planner. Listener is
 * registered for the lifetime of the calling component and cleaned up on
 * unmount; passing a fresh `onClose` reference re-registers, so callers
 * should `useCallback` the handler if it would otherwise re-create per
 * render.
 */
export function useEscape(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}
