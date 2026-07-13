"use client";

import type { FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";

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
        // shrink the toolbar. The delete bar pins the same way.
        className="flex items-center gap-1 flex-1 min-w-0 min-h-[48px]"
      >
        <Input
          ref={focusOnMount}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
          }}
          className="flex-1 min-w-0"
          aria-label="New plan name"
        />
        {/* size="lg" to match the delete bar — both replace the full toolbar. */}
        <Button
          type="submit"
          variant="iconRaised"
          size="lg"
          disabled={busy || !name.trim()}
          aria-label="Save rename"
          title="Save"
        >
          <Icon name="check" size="md" aria-hidden="true" />
        </Button>
        <Button
          variant="iconRaised"
          size="lg"
          onClick={onCancel}
          aria-label="Cancel rename"
          title="Cancel"
        >
          <Icon name="close" size="lg" aria-hidden="true" />
        </Button>
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
      {/* min-h pins the bar to 48px so the icon buttons don't shrink the toolbar. */}
      <div className="flex items-center justify-between gap-2 flex-1 min-w-0 min-h-[48px]">
        <span className="text-sm truncate">Delete "{planName}"?</span>
        <div className="flex items-center gap-1 shrink-0">
          {/* size="lg" icon buttons — bigger than the dropdown/card; this bar spans the toolbar. */}
          <Button
            variant="iconDanger"
            size="lg"
            disabled={busy}
            onClick={onConfirm}
            aria-label="Confirm delete"
            title="Delete"
          >
            <Icon name="check" size="md" aria-hidden="true" />
          </Button>
          <Button
            variant="iconRaised"
            size="lg"
            onClick={onCancel}
            aria-label="Cancel delete"
            title="Cancel"
          >
            <Icon name="close" size="lg" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
