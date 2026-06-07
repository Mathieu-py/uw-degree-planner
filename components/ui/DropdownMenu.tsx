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
 * Generic header dropdown menu: a trigger button revealing a popover of actions
 * (e.g. "Plan options", "Data & settings"). Closes on click-outside, Escape, or
 * item select. Click-outside uses `pointerdown` (not `click`) so the menu
 * dismisses before another button receives the click.
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
        variant="outline"
        size="lg"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5"
      >
        {icon ? (
          <span aria-hidden="true" className="inline-flex shrink-0">
            {icon}
          </span>
        ) : null}
        <span>{label}</span>
        <Icon
          name="chevronDown"
          size="xs"
          aria-hidden="true"
          className="opacity-70"
        />
      </Button>
      {open ? (
        <div
          id={menuId}
          className="absolute right-0 top-full mt-1 z-20 min-w-[10rem] rounded-[10px] border border-line bg-bg shadow-card-md py-1"
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
        </div>
      ) : null}
    </div>
  );
}
