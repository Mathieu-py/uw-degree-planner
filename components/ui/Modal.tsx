"use client";

import type { ReactNode } from "react";
import { useEscape } from "@/lib/hooks/useEscape";

interface ModalProps {
  /**
   * True while the exit animation is playing. Drives the dialog's
   * `scale-95 opacity-0` and the backdrop's `opacity-0` classes. The
   * caller owns this flag — usually via `useModalExit`.
   */
  isClosing: boolean;
  /**
   * Called by backdrop click and Escape. The caller is responsible for
   * triggering the exit animation and unmounting; this prop is typically
   * wired to `useModalExit().handleClose`.
   */
  onClose: () => void;
  /** Element id of the dialog's accessible title (set as aria-labelledby). */
  titleId: string;
  /**
   * Extra classes for the dialog box (e.g. `max-w-md`, `max-w-5xl
   * max-h-[90vh]`). Defaults to `max-w-md`.
   */
  className?: string;
  /**
   * Pass -1 to remove the backdrop from tab order. Useful when the dialog
   * content has its own primary autoFocus element (SlotPicker's search box)
   * and we don't want the first Tab to land on the invisible "Close dialog"
   * button.
   */
  backdropTabIndex?: number;
  children: ReactNode;
}

/**
 * Shared modal shell for the planner's custom-div modals. Renders the
 * fixed-position wrapper, dimmed backdrop, dialog box, entry+exit
 * animations, and Escape handling. The caller owns the exit-animation
 * lifecycle via `useModalExit` and passes `isClosing` + `onClose` in —
 * keeping that hook at the caller level avoids a split into wrapper +
 * Content components and lets the caller access `animateOut`/`reset` for
 * async close flows (see HandoffModal).
 */
export function Modal({
  isClosing,
  onClose,
  titleId,
  className,
  backdropTabIndex,
  children,
}: ModalProps) {
  useEscape(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        tabIndex={backdropTabIndex}
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 transition-opacity duration-300 motion-safe:animate-fade-in ${isClosing ? "opacity-0" : "opacity-100"}`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative bg-white dark:bg-zinc-950 rounded-lg shadow-2xl w-full flex flex-col overflow-hidden border border-zinc-200 dark:border-zinc-800 transform transition-all duration-300 motion-safe:animate-scale-in ${isClosing ? "scale-95 opacity-0" : "scale-100 opacity-100"} ${className ?? "max-w-md"}`}
      >
        {children}
      </div>
    </div>
  );
}
