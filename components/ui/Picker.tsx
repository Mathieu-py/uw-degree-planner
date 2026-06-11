"use client";

import { useEffect, useRef } from "react";
import {
  DropdownChevron,
  DropdownSurface,
} from "@/components/ui/DropdownSurface";
import { Icon } from "@/components/ui/Icon";
import { FIELD_CLASSES } from "@/components/ui/Input";
import { useDropdown } from "@/components/ui/useDropdown";
import { useListboxNavigation } from "@/lib/hooks/useListboxNavigation";

export interface PickerOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface PickerProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: PickerOption<T>[];
  /** Trigger text when `value` matches no option. */
  placeholder?: string;
  /** Labels the trigger + listbox when there's no associated `<label htmlFor>`. */
  ariaLabel?: string;
  /** Wire onto the trigger so a `<Field>`/`<label htmlFor>` associates with it. */
  id?: string;
  disabled?: boolean;
  /** Width/layout overrides for the trigger (defaults to full width). */
  className?: string;
}

function firstEnabled<T extends string>(options: PickerOption<T>[]): number {
  const i = options.findIndex((o) => !o.disabled);
  return i === -1 ? 0 : i;
}

/**
 * Custom value picker: a form control that looks like {@link Input}/the design's
 * `.input` but opens a styled listbox with the app's gold chevron, instead of
 * the browser's native `<select>` chrome. Replaces native selects so every
 * dropdown in the app shares one visual language ({@link useDropdown} +
 * {@link DropdownSurface}, also used by {@link ActionMenu}).
 *
 * Implements the ARIA listbox keyboard contract a native select gives for free:
 * arrow/Home/End navigation, Enter/Space to commit, Escape to dismiss, and
 * type-to-jump. Selection is tracked via `aria-activedescendant` (the listbox
 * holds focus; options never do).
 */
export function Picker<T extends string>({
  value,
  onChange,
  options,
  placeholder = "Select…",
  ariaLabel,
  id,
  disabled,
  className = "w-full",
}: PickerProps<T>) {
  const {
    open,
    setOpen,
    close,
    toggle,
    containerRef,
    id: genId,
  } = useDropdown();
  const listId = `${genId}-listbox`;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const typeahead = useRef<{ str: string; at: number }>({ str: "", at: 0 });

  const selectedIndex = options.findIndex((o) => o.value === value);

  // Arrow/Home/End cursor + Enter-to-commit, shared with the program search.
  // Space/Escape/Tab/type-ahead stay local below (Picker-specific).
  const {
    activeIndex,
    setActiveIndex,
    onKeyDown: navKeyDown,
  } = useListboxNavigation({
    count: options.length,
    onSelect: commit,
    isDisabled: (i) => !!options[i]?.disabled,
    homeEnd: true,
    scrollRef: listRef,
  });

  // Each open starts highlighting the current value (or the first selectable
  // option), then moves focus into the listbox for keyboard navigation.
  // selectedIndex/options are snapshotted at open; re-running on their change
  // would fight the user's arrow-key navigation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional open-only snapshot
  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabled(options));
    listRef.current?.focus();
  }, [open]);

  function commit(index: number) {
    const opt = options[index];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    close();
    triggerRef.current?.focus();
  }

  function dismiss() {
    close();
    triggerRef.current?.focus();
  }

  function onListKeyDown(e: React.KeyboardEvent) {
    if (navKeyDown(e)) return;
    switch (e.key) {
      case " ":
        e.preventDefault();
        commit(activeIndex);
        return;
      case "Escape":
        e.preventDefault();
        dismiss();
        return;
      case "Tab":
        close();
        return;
    }
    // Type-to-jump: accumulate printable keys within a 600ms window and land on
    // the first option whose label starts with what's been typed.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = e.timeStamp;
      const buf = now - typeahead.current.at < 600 ? typeahead.current.str : "";
      const str = (buf + e.key).toLowerCase();
      typeahead.current = { str, at: now };
      const match = options.findIndex(
        (o) => !o.disabled && o.label.toLowerCase().startsWith(str),
      );
      if (match >= 0) setActiveIndex(match);
    }
  }

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (open) return;
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  }

  const selectedLabel =
    selectedIndex >= 0 ? options[selectedIndex].label : null;

  return (
    <div ref={containerRef} className={`relative ${className}`.trim()}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={toggle}
        onKeyDown={onTriggerKeyDown}
        className={`${FIELD_CLASSES} flex items-center justify-between gap-2 pl-[13px] pr-3 text-left ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
      >
        <span
          className={`min-w-0 truncate ${selectedLabel === null ? "text-ink-3" : ""}`}
        >
          {selectedLabel ?? placeholder}
        </span>
        <DropdownChevron open={open} />
      </button>

      {open ? (
        <DropdownSurface
          className="left-0 w-full max-h-72 overflow-y-auto"
          {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
        >
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-activedescendant={`${listId}-opt-${activeIndex}`}
            onKeyDown={onListKeyDown}
            className="outline-none"
          >
            {options.map((opt, i) => {
              const isSelected = opt.value === value;
              const isActive = i === activeIndex;
              return (
                <button
                  key={opt.value}
                  type="button"
                  id={`${listId}-opt-${i}`}
                  data-nav-index={i}
                  role="option"
                  tabIndex={-1}
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled || undefined}
                  onClick={() => commit(i)}
                  onMouseMove={() => !opt.disabled && setActiveIndex(i)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                    opt.disabled
                      ? "cursor-not-allowed text-ink-3"
                      : "cursor-pointer text-ink"
                  } ${isActive && !opt.disabled ? "bg-bg-2" : ""} ${isSelected ? "font-medium" : ""}`}
                >
                  <span className="flex-1 min-w-0 truncate">{opt.label}</span>
                  {isSelected ? (
                    <Icon
                      name="check"
                      size="sm"
                      aria-hidden="true"
                      className="flex-none text-accent"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </DropdownSurface>
      ) : null}
    </div>
  );
}
