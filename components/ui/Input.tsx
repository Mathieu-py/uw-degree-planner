"use client";

import type { ComponentProps, ReactNode } from "react";

// ComponentProps (not InputHTMLAttributes) so `ref` flows through the spread.
interface InputProps extends ComponentProps<"input"> {
  /** Optional leading icon (rendered inside the field, left-aligned). */
  icon?: ReactNode;
}

// Shared base for the design's `.input`: hairline border, fixed height, gold
// focus ring. Reused by {@link Picker}'s trigger so it matches text fields.
export const FIELD_CLASSES =
  "h-[42px] w-full rounded-[9px] border border-line-2 bg-bg text-ink text-sm " +
  "placeholder:text-ink-3 outline-none transition-[border-color,box-shadow] " +
  "focus:border-accent-bg focus:shadow-[0_0_0_3px_var(--accent-soft)]";

/**
 * Text input matching the design's `.input`. Pass `icon` for the search-field
 * variant (`.input-icon`), which adds left padding and absolutely positions
 * the glyph. Focus shows a gold ring via the `--accent-soft` token.
 */
export function Input({ icon, className, ...rest }: InputProps) {
  if (icon) {
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-[13px] top-1/2 -translate-y-1/2 text-ink-3">
          {icon}
        </span>
        <input
          className={`${FIELD_CLASSES} pl-[38px] px-[13px] ${className ?? ""}`.trim()}
          {...rest}
        />
      </div>
    );
  }
  return (
    <input
      className={`${FIELD_CLASSES} px-[13px] ${className ?? ""}`.trim()}
      {...rest}
    />
  );
}
