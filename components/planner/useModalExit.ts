"use client";

import { useCallback, useRef, useState } from "react";

const EXIT_MS = 300;

export interface UseModalExitResult {
  /** When true, the modal should render its exit classes (scale-95 opacity-0). */
  isClosing: boolean;
  /**
   * Synchronous close: plays the exit animation, then calls `onClose` after
   * {@link EXIT_MS}. Subsequent calls during the animation are no-ops so
   * rapid Esc + click can't double-fire.
   */
  handleClose: () => void;
  /**
   * Async variant for modals whose close coincides with an awaited action
   * (e.g. HandoffModal's `pick` runs `onResolve` in parallel with the exit
   * animation via `Promise.all`). Returns a promise that resolves once the
   * animation duration has elapsed.
   */
  animateOut: () => Promise<void>;
  /**
   * Restore the modal to its visible state. Used when an async action
   * triggered the exit but failed — the parent didn't unmount us, so we
   * need to undo the closing class so the modal stays usable.
   */
  reset: () => void;
}

/**
 * Shared exit-animation lifecycle for the planner's modals. The CSS-side
 * pattern is `transition-all duration-300` + `isClosing ? "scale-95
 * opacity-0" : "scale-100 opacity-100"`; this hook owns the state flag and
 * the post-animation callback.
 *
 * Pass `onClose` for the common "close button / Esc / backdrop click → run
 * exit animation → unmount" flow. Omit it (or pass `undefined`) when the
 * caller wires the unmount themselves via `animateOut` + custom logic.
 */
export function useModalExit(onClose?: () => void): UseModalExitResult {
  const [isClosing, setIsClosing] = useState(false);
  const isClosingRef = useRef(false);

  const handleClose = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    setIsClosing(true);
    if (onClose) setTimeout(onClose, EXIT_MS);
  }, [onClose]);

  const animateOut = useCallback((): Promise<void> => {
    if (isClosingRef.current) return Promise.resolve();
    isClosingRef.current = true;
    setIsClosing(true);
    return new Promise((r) => setTimeout(r, EXIT_MS));
  }, []);

  const reset = useCallback(() => {
    isClosingRef.current = false;
    setIsClosing(false);
  }, []);

  return { isClosing, handleClose, animateOut, reset };
}
