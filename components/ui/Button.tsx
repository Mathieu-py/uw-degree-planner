"use client";

import type { ButtonHTMLAttributes } from "react";
import {
  type ButtonSize,
  type ButtonVariant,
  buttonClasses,
} from "./buttonClasses";

export type { ButtonSize, ButtonVariant } from "./buttonClasses";

interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full-width. Mirrors the design's `.btn-block`. */
  block?: boolean;
  /** Defaults to "button" so the component doesn't accidentally submit forms. */
  type?: "button" | "submit" | "reset";
}

/**
 * Shared button primitive for the gold/ink design system. Variants cover the
 * recurring visual styles; sizes scale height/padding/text for the solid
 * variants (icon ignores size). `className` merges in for one-off layout needs
 * (`w-full`, `self-start`, etc.).
 *
 * For a `<Link>` that should look like a button, use `buttonClasses(...)`
 * directly instead of wrapping it — see the note on that helper.
 *
 * Defaults: `variant="primary"`, `size="md"`, `type="button"`.
 */
export function Button({
  variant = "primary",
  size = "md",
  block = false,
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, block, className })}
      {...props}
    >
      {children}
    </button>
  );
}
