"use client";

import type { SelectHTMLAttributes } from "react";
import { FIELD_CLASSES } from "./Input";

/**
 * Native `<select>` styled to match {@link Input} — same hairline border, height,
 * and gold focus ring, plus a pointer cursor. Pass `className` for one-off
 * layout needs and `children` for the `<option>` list.
 */
export function Select({
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`${FIELD_CLASSES} cursor-pointer px-[13px] ${className ?? ""}`.trim()}
      {...rest}
    />
  );
}
