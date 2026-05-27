"use client";

import type { ReactNode } from "react";
import { useModalExit } from "@/lib/hooks/useModalExit";
import { Button } from "./Button";
import { Icon } from "./Icon";

interface BottomSheetProps {
  /** Called after the exit animation finishes so the parent can unmount. */
  onClose: () => void;
  titleId: string;
  title: string;
  children: ReactNode;
}

/**
 * Mobile-first bottom sheet. Mirrors Modal.tsx's lifecycle conventions but
 * owns its exit animation internally — mount/unmount in the parent with a
 * single boolean flag and pass `onClose` for the end-of-animation cleanup.
 *
 * Used for the audit panel on viewports below `lg`. The desktop layout
 * keeps AuditPanel inline in the planner grid.
 */
export function BottomSheet({
  onClose,
  titleId,
  title,
  children,
}: BottomSheetProps) {
  const { isClosing, handleClose } = useModalExit(onClose);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close sheet"
        onClick={handleClose}
        className={`absolute inset-0 bg-black/40 transition-opacity duration-300 motion-safe:animate-fade-in ${
          isClosing ? "opacity-0" : "opacity-100"
        }`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative bg-white dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 rounded-t-xl shadow-2xl flex flex-col max-h-[85vh] transform transition-transform duration-300 motion-safe:animate-slide-in-bottom ${
          isClosing ? "translate-y-full" : "translate-y-0"
        } pb-[env(safe-area-inset-bottom)]`}
      >
        <div className="flex items-center justify-center pt-2 pb-1">
          <span
            aria-hidden="true"
            className="w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700"
          />
        </div>
        <div className="flex items-center justify-between px-4 pb-2">
          <h2 id={titleId} className="text-sm font-medium">
            {title}
          </h2>
          <Button variant="icon" onClick={handleClose} aria-label="Close">
            <Icon name="close" size="sm" aria-hidden="true" />
          </Button>
        </div>
        <div className="overflow-y-auto px-4 pb-4">{children}</div>
      </div>
    </div>
  );
}
