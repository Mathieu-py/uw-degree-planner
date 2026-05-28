"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useEscape } from "@/lib/hooks/useEscape";

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
 * Generic header dropdown menu: a trigger button that reveals a list of
 * actions in a popover. Used for both "Plan options" (rename/duplicate/
 * share/delete) and "Data & settings" (import transcript / plan settings)
 * — folding clusters of related actions into menus keeps the action row
 * quiet so the plan switcher + primary "+ New plan" stay legible.
 *
 * Closing behavior: click outside, Escape, or selecting an item all close
 * the menu. Click-outside uses `pointerdown` (not `click`) so the menu
 * dismisses before the target element receives the click — relevant when
 * the user clicks a different button while the menu is open.
 */
export function DropdownMenu({ label, icon, items }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  // Only hold the global Escape listener while the menu is open.
  const closeMenu = useCallback(() => setOpen(false), []);
  useEscape(open ? closeMenu : null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="secondary"
        size="lg"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5"
      >
        {icon ? <span aria-hidden="true">{icon}</span> : null}
        <span>{label}</span>
        <Icon name="chevronDown" size="xs" aria-hidden="true" className="opacity-70" />
      </Button>
      {open ? (
        <div
          id={menuId}
          className="absolute right-0 top-full mt-1 z-20 min-w-[10rem] rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-lg py-1"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`w-full text-left px-3 py-2 text-sm inline-flex items-center gap-2 disabled:opacity-50 ${
                item.destructive
                  ? "text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
              }`}
            >
              <span aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
