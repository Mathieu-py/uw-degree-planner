"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useEscape } from "@/lib/hooks/useEscape";

/**
 * Headless open/close behaviour shared by every gold-chevron dropdown
 * ({@link ActionMenu} command menus and {@link Picker} value selectors). Owns
 * the open state and dismissal rules so the two stay in lockstep: closes on
 * Escape, and on a pointer press anywhere outside `containerRef`. Click-outside
 * uses `pointerdown` (not `click`) so the popover dismisses *before* another
 * button receives the click. `id` is a stable handle for wiring
 * `aria-controls` ↔ the popover's `id`.
 */
export function useDropdown() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const id = useId();

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  // Only hold the global Escape listener while open.
  useEscape(open ? close : null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return { open, setOpen, close, toggle, containerRef, id };
}
