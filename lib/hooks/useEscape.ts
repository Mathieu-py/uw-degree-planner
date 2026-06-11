"use client";

import { useEffect, useRef } from "react";

/**
 * Stack of currently-active Escape handlers — one entry per mounted (or open)
 * {@link useEscape} consumer. Only the topmost (the most-recently-activated
 * overlay, e.g. a search palette opened over a modal) responds to Escape, so a
 * nested overlay dismisses on its own instead of also tearing down the layers
 * beneath it. Entries are the consumers' refs, so identity is stable across
 * renders.
 */
const escapeHandlers: Array<{ current: (() => void) | null }> = [];

/**
 * Window-level `keydown` listener that invokes `onClose` on Escape — but only
 * while this consumer is the frontmost active one (see {@link escapeHandlers}),
 * so stacked overlays close one at a time. Pass `null` to skip registration
 * (e.g. a closed dropdown with nothing to close). The latest `onClose` is read
 * from a ref, so changing its identity between renders never reorders the stack.
 */
export function useEscape(onClose: (() => void) | null): void {
  const ref = useRef(onClose);
  ref.current = onClose;

  const active = onClose != null;
  useEffect(() => {
    if (!active) return;
    escapeHandlers.push(ref);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Defer to the frontmost overlay; ignore the press if we're underneath it.
      if (escapeHandlers[escapeHandlers.length - 1] === ref) ref.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = escapeHandlers.lastIndexOf(ref);
      if (i >= 0) escapeHandlers.splice(i, 1);
    };
  }, [active]);
}
