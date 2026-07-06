"use client";

import type { FormEvent } from "react";
import { Icon } from "@/components/ui/Icon";

const focusOnMount = (el: HTMLInputElement | null) => el?.focus();

/**
 * Full-width rename bar shown in place of the plan switcher during a rename.
 * Presentational — the parent owns the name value and the rename call.
 */
export function RenameBar({
  containerClass,
  name,
  busy,
  onNameChange,
  onSubmit,
  onCancel,
}: {
  containerClass: string;
  name: string;
  busy: boolean;
  onNameChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <div className={containerClass}>
      <form
        onSubmit={onSubmit}
        // Pin the row to 48px — the height of the resting toolbar's tallest
        // control, the size="lg" "Edit plan" ActionMenu — so editing doesn't
        // shrink the toolbar. The delete bar pins the same way. #99
        className="flex items-center gap-1 flex-1 min-w-0 min-h-[48px]"
      >
        <input
          ref={focusOnMount}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
          }}
          className="flex-1 min-w-0 rounded border border-line-2 bg-bg px-3 py-2.5 text-sm"
          aria-label="New plan name"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          aria-label="Save rename"
          title="Save"
          className="h-8 w-8 inline-flex items-center justify-center rounded text-base text-ink-3 hover:text-ink hover:bg-bg-3 disabled:opacity-50"
        >
          <Icon name="check" size="sm" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel rename"
          title="Cancel"
          className="h-8 w-8 inline-flex items-center justify-center rounded text-base text-ink-3 hover:text-ink hover:bg-bg-3"
        >
          <Icon name="close" size="md" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}

/**
 * Full-width delete-confirmation bar shown during a pending delete.
 * Presentational — the parent owns the remove call.
 */
export function DeleteConfirmBar({
  containerClass,
  planName,
  busy,
  onConfirm,
  onCancel,
}: {
  containerClass: string;
  planName: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={containerClass}>
      {/* min-h pins the bar to 48px so the icon buttons don't shrink the toolbar. #99 */}
      <div className="flex items-center justify-between gap-2 flex-1 min-w-0 min-h-[48px]">
        <span className="text-sm truncate">Delete "{planName}"?</span>
        <div className="flex items-center gap-1 shrink-0">
          {/* Bigger than the dropdown/card icons — this bar spans the toolbar. */}
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            aria-label="Confirm delete"
            title="Delete"
            className="h-11 w-11 inline-flex items-center justify-center rounded-lg text-base text-danger hover:bg-danger-soft disabled:opacity-50"
          >
            <Icon name="check" size="md" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel delete"
            title="Cancel"
            className="h-11 w-11 inline-flex items-center justify-center rounded-lg text-base text-ink-3 hover:text-ink hover:bg-bg-3"
          >
            <Icon name="close" size="lg" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
