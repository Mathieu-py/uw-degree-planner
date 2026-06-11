"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEscape } from "@/lib/hooks/useEscape";
import { Button } from "./Button";
import { Icon } from "./Icon";

interface ModalProps {
  /**
   * True while the exit animation plays; drives the dialog/backdrop exit
   * classes. Caller owns it, usually via `useModalExit`.
   */
  isClosing: boolean;
  /**
   * Called by backdrop click and Escape. Caller triggers the exit animation and
   * unmount — typically `useModalExit().handleClose`.
   */
  onClose: () => void;
  /** Element id of the dialog's accessible title (set as aria-labelledby). */
  titleId: string;
  /** Extra classes for the dialog box (e.g. `max-w-5xl`). Defaults to `max-w-md`. */
  className?: string;
  /**
   * Pass -1 to drop the backdrop from tab order when the content has its own
   * autoFocus element (e.g. SlotPicker's search box).
   */
  backdropTabIndex?: number;
  /**
   * Render into `document.body` instead of inline. Needed when the modal opens
   * from inside another modal: the parent dialog box is `transform`-animated,
   * which makes it the containing block for a `position:fixed` overlay and would
   * otherwise trap/clip this one (e.g. the program search over Plan Settings).
   */
  portal?: boolean;
  children: ReactNode;
}

/**
 * Shared modal shell: fixed wrapper, dimmed backdrop, dialog box, entry/exit
 * animations, Escape handling. The caller owns the exit lifecycle via
 * `useModalExit` and passes `isClosing` + `onClose` in — keeping that hook at
 * the caller level gives it `animateOut`/`reset` for async close (see
 * HandoffModal).
 */
export function Modal({
  isClosing,
  onClose,
  titleId,
  className,
  backdropTabIndex,
  portal,
  children,
}: ModalProps) {
  useEscape(onClose);

  const shell = (
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
        className={`relative bg-bg rounded-[14px] shadow-card-lg w-full flex flex-col overflow-hidden border border-line transform transition-all duration-300 motion-safe:animate-scale-in ${isClosing ? "scale-95 opacity-0" : "scale-100 opacity-100"} ${className ?? "max-w-md"}`}
      >
        {children}
      </div>
    </div>
  );

  if (portal) {
    if (typeof document === "undefined") return null;
    return createPortal(shell, document.body);
  }
  return shell;
}

/**
 * Standard dialog header. Pass `onClose` for the right-aligned close button;
 * omit for a title-only header. `titleId` must match the parent {@link Modal}'s.
 */
export function ModalHeader({
  titleId,
  onClose,
  children,
}: {
  titleId: string;
  onClose?: () => void;
  children: ReactNode;
}) {
  if (!onClose) {
    return (
      <header className="border-b border-line px-4 py-2.5">
        <h2 id={titleId} className="text-[15px] font-bold tracking-tight">
          {children}
        </h2>
      </header>
    );
  }
  return (
    <header className="border-b border-line px-4 py-2.5 flex items-center justify-between gap-3">
      <h2
        id={titleId}
        className="text-[15px] font-bold tracking-tight truncate flex-1 min-w-0"
      >
        {children}
      </h2>
      <Button
        variant="icon"
        onClick={onClose}
        aria-label="Close"
        className="-mr-1"
      >
        <Icon name="close" size="sm" aria-hidden="true" />
      </Button>
    </header>
  );
}

/** Standard dialog footer: a hairline-topped action bar, right-aligned. */
export function ModalFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <footer
      className={`border-t border-line bg-bg-2 px-4 py-3 flex justify-end gap-2 ${className ?? ""}`.trim()}
    >
      {children}
    </footer>
  );
}
