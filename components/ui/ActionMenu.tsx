"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import {
  DropdownChevron,
  DropdownSurface,
} from "@/components/ui/DropdownSurface";
import { useDropdown } from "@/components/ui/useDropdown";

export interface MenuItem {
  /** Stable test/aria id (e.g. "rename", "delete"). */
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

interface Props {
  /** Visible label on the trigger button. Doubles as the menu's aria-label. */
  label: string;
  /** Optional glyph or icon element rendered before the label. */
  icon?: ReactNode;
  items: MenuItem[];
}

/**
 * Command menu: a trigger button revealing a popover of *actions* (e.g. "Edit
 * plan" → Plan settings / Reset). Each row fires an `onSelect` callback — there
 * is no selected value, so this is not a form control. For choosing a value
 * from a list, use {@link Picker} instead.
 *
 * Shares its open/close behaviour, gold chevron, and popover surface with the
 * rest of the app's dropdowns ({@link useDropdown}, {@link DropdownSurface}).
 */
export function ActionMenu({ label, icon, items }: Props) {
  const { open, toggle, close, containerRef, id } = useDropdown();

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="outline"
        size="lg"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={toggle}
        className="inline-flex items-center gap-1.5"
      >
        {icon ? (
          <span aria-hidden="true" className="inline-flex shrink-0">
            {icon}
          </span>
        ) : null}
        <span>{label}</span>
        <DropdownChevron open={open} />
      </Button>
      {open ? (
        <DropdownSurface
          id={id}
          role="menu"
          aria-label={label}
          className="right-0 min-w-[10rem]"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                close();
                item.onSelect();
              }}
              className={`w-full text-left px-3 py-2 text-sm inline-flex items-center gap-2 disabled:opacity-50 ${
                item.destructive
                  ? "text-danger hover:bg-danger-soft"
                  : "text-ink hover:bg-bg-2"
              }`}
            >
              <span aria-hidden="true" className="inline-flex shrink-0">
                {item.icon}
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </DropdownSurface>
      ) : null}
    </div>
  );
}
