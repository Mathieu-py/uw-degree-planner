"use client";

import {
  type ButtonHTMLAttributes,
  cloneElement,
  isValidElement,
  type ReactElement,
} from "react";

// Design-system variants:
//   primary       — ink fill (black/white). The default CTA. NOT gold.
//   brand         — gold fill. Accent CTA only; use sparingly.
//   outline       — bordered, neutral surface.
//   ghost         — text-only, subtle hover fill.
//   danger        — solid destructive (delete/discard).
//   dangerOutline — bordered destructive.
//   icon          — square icon button (ignores size/text).
export type ButtonVariant =
  | "primary"
  | "brand"
  | "outline"
  | "ghost"
  | "danger"
  | "dangerOutline"
  | "icon";

export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full-width. Mirrors the design's `.btn-block`. */
  block?: boolean;
  /** Defaults to "button" so the component doesn't accidentally submit forms. */
  type?: "button" | "submit" | "reset";
  /**
   * Render the single child element with the button styling merged in instead
   * of a `<button>`. Use for `<Link>` CTAs that should look like buttons.
   */
  asChild?: boolean;
}

const BASE =
  "inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap " +
  "border border-transparent transition-[background-color,color,border-color,box-shadow] " +
  "duration-150 active:translate-y-px cursor-pointer " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-ink hover:bg-primary-hover",
  brand: "bg-accent-bg text-accent-ink hover:brightness-105",
  outline:
    "bg-bg text-ink border-line-2 hover:bg-bg-2 hover:border-line-strong",
  ghost: "text-ink-2 hover:bg-bg-2 hover:text-ink",
  danger: "bg-danger text-bg hover:brightness-105",
  dangerOutline: "border-danger/40 text-danger hover:bg-danger-soft",
  icon: "p-2 rounded-[7px] text-ink-3 hover:text-ink hover:bg-bg-2",
};

// height + horizontal padding + text size + radius per size.
const SIZES: Record<ButtonSize, string> = {
  sm: "h-[34px] px-[13px] text-[13px] rounded-[8px]",
  md: "h-[42px] px-[18px] text-sm rounded-[9px]",
  lg: "h-[48px] px-6 text-[15px] rounded-[10px]",
};

/**
 * Shared button primitive for the gold/ink design system. Variants cover the
 * recurring visual styles; sizes scale height/padding/text for the solid
 * variants (icon ignores size). `className` merges in for one-off layout needs
 * (`w-full`, `self-start`, etc.).
 *
 * Defaults: `variant="primary"`, `size="md"`, `type="button"`.
 */
export function Button({
  variant = "primary",
  size = "md",
  block = false,
  type = "button",
  asChild = false,
  className,
  children,
  ...props
}: ButtonProps) {
  const sizing = variant === "icon" ? "" : SIZES[size];
  const classes =
    `${BASE} ${VARIANTS[variant]} ${sizing} ${block ? "w-full" : ""} ${className ?? ""}`
      .replace(/\s+/g, " ")
      .trim();

  // asChild: style the single child (e.g. a <Link>) instead of rendering a
  // <button>. Merges classes; drops button-only props like `type`.
  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<{ className?: string }>;
    return cloneElement(child, {
      className: `${classes} ${child.props.className ?? ""}`.trim(),
    });
  }

  return (
    <button type={type} className={classes} {...props}>
      {children}
    </button>
  );
}
