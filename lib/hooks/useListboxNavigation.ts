"use client";

import {
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";

interface Options {
  /** Number of navigable items (the cursor is clamped to `[0, count)`). */
  count: number;
  /** Commit the item at `index` — fired on Enter. */
  onSelect: (index: number) => void;
  /** Mark an index as skippable so Arrow/Home/End jump over it. */
  isDisabled?: (index: number) => boolean;
  /**
   * Also handle Home/End. Off by default so they keep editing a focused text
   * field (e.g. the program search input); on when focus is on the list itself.
   */
  homeEnd?: boolean;
  /**
   * Scroll container. When set, the active item — which must carry
   * `data-nav-index={i}` — is scrolled into view on *keyboard* moves only, not on
   * programmatic `setActiveIndex` (so a mouse hover doesn't yank the list).
   */
  scrollRef?: RefObject<HTMLElement | null>;
  /** Starting cursor position. Default 0. */
  initialIndex?: number;
}

interface ListboxNavigation {
  activeIndex: number;
  setActiveIndex: Dispatch<SetStateAction<number>>;
  /**
   * Attach to the focused element (the search input or the listbox). Returns
   * `true` when it consumed the key, so a caller can layer its own keys
   * (Escape/Tab/type-ahead) after it: `if (onKeyDown(e)) return;`.
   */
  onKeyDown: (e: ReactKeyboardEvent) => boolean;
}

/** Next selectable index from `from` in `dir` (+1/-1), skipping disabled; clamped (no wrap). */
function step(
  count: number,
  from: number,
  dir: 1 | -1,
  isDisabled?: (i: number) => boolean,
): number {
  for (let i = from + dir; i >= 0 && i < count; i += dir) {
    if (!isDisabled?.(i)) return i;
  }
  return from;
}

/** First (`dir` 1) or last (`dir` -1) selectable index. */
function edge(
  count: number,
  dir: 1 | -1,
  isDisabled?: (i: number) => boolean,
): number {
  const found = step(count, dir === 1 ? -1 : count, dir, isDisabled);
  if (found >= 0 && found < count) return found;
  return dir === 1 ? 0 : Math.max(0, count - 1);
}

/**
 * Keyboard cursor for a vertical listbox: ↑/↓ (and optionally Home/End) move a
 * clamped `activeIndex` skipping disabled rows, Enter commits it, and the active
 * row is kept in view on keyboard moves. Pattern-agnostic about where it's
 * attached — a focused search input (combobox) or the list element itself
 * (`aria-activedescendant`). Shared by {@link Picker} and the program search.
 */
export function useListboxNavigation({
  count,
  onSelect,
  isDisabled,
  homeEnd = false,
  scrollRef,
  initialIndex = 0,
}: Options): ListboxNavigation {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  // Set by the key handlers so the scroll effect follows the cursor only for
  // keyboard moves — a mouse hover sets `activeIndex` too but shouldn't scroll.
  const keyboardRef = useRef(false);

  useEffect(() => {
    if (!keyboardRef.current) return;
    keyboardRef.current = false;
    const el = scrollRef?.current?.querySelector<HTMLElement>(
      `[data-nav-index="${activeIndex}"]`,
    );
    el?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, scrollRef]);

  function onKeyDown(e: ReactKeyboardEvent): boolean {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        keyboardRef.current = true;
        setActiveIndex((i) => step(count, i, 1, isDisabled));
        return true;
      case "ArrowUp":
        e.preventDefault();
        keyboardRef.current = true;
        setActiveIndex((i) => step(count, i, -1, isDisabled));
        return true;
      case "Home":
        if (!homeEnd) return false;
        e.preventDefault();
        keyboardRef.current = true;
        setActiveIndex(edge(count, 1, isDisabled));
        return true;
      case "End":
        if (!homeEnd) return false;
        e.preventDefault();
        keyboardRef.current = true;
        setActiveIndex(edge(count, -1, isDisabled));
        return true;
      case "Enter":
        e.preventDefault();
        onSelect(activeIndex);
        return true;
      default:
        return false;
    }
  }

  return { activeIndex, setActiveIndex, onKeyDown };
}
