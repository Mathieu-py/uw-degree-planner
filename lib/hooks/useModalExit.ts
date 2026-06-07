"use client";

import { useCallback, useRef, useState } from "react";

const EXIT_MS = 300;

export interface UseModalExitResult {
  /** When true, the modal should render its exit classes (scale-95 opacity-0). */
  isClosing: boolean;
  /**
   * Synchronous close: play the exit animation, then call `onClose` after
   * {@link EXIT_MS}. Re-entrant calls during the animation are no-ops.
   */
  handleClose: () => void;
  /**
   * Async variant for a close that coincides with an awaited action (e.g.
   * HandoffModal runs `onResolve` in parallel with the exit). Resolves once the
   * animation duration elapses.
   */
  animateOut: () => Promise<void>;
  /**
   * Restore the modal to visible. Used when an async action triggered the exit
   * but failed and the parent didn't unmount us.
   */
  reset: () => void;
}

/**
 * Shared exit-animation lifecycle for the planner's modals (CSS side:
 * `transition-all duration-300` + an `isClosing` scale/opacity toggle). Owns the
 * state flag and post-animation callback.
 *
 * Pass `onClose` for the common "close → animate → unmount" flow; omit it when
 * the caller wires unmount itself via `animateOut`.
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
