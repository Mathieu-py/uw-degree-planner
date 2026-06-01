"use client";

import type { InputHTMLAttributes, ReactNode } from "react";
import { FIELD_CLASSES } from "./fieldClasses";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Optional leading icon (rendered inside the field, left-aligned). */
  icon?: ReactNode;
}

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
