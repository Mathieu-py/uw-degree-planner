"use client";

import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant =
  | "primary"
  | "accent"
  | "secondary"
  | "destructive"
  | "destructiveOutline"
  | "ghost"
  | "icon";

export type ButtonSize = "xs" | "sm" | "md" | "lg";

interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Defaults to "button" so the component doesn't accidentally submit forms. */
  type?: "button" | "submit" | "reset";
}

const BASE =
  "rounded transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200",
  accent: "bg-violet-600 text-white font-medium hover:bg-violet-500",
  secondary:
    "border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-900",
  destructive: "bg-rose-600 text-white font-medium hover:bg-rose-700",
  destructiveOutline:
    "border border-rose-300 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 font-medium hover:bg-rose-50 dark:hover:bg-rose-950/40",
  ghost:
    "text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-50 underline-offset-4 hover:underline",
  icon: "p-1.5 text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50 hover:bg-zinc-100 dark:hover:bg-zinc-800",
};

const SIZES: Record<ButtonSize, { padding: string; text: string }> = {
  // xs and sm share text-[11px]; the difference is vertical padding. xs is
  // for tight inline confirms (PlanToolbar's delete row), sm for compact
  // form actions (inline rename Save/Cancel), md for modal footers, lg for
  // page-level CTAs (EmptyState).
  xs: { padding: "px-2 py-0.5", text: "text-[11px]" },
  sm: { padding: "px-2 py-1", text: "text-[11px]" },
  md: { padding: "px-3 py-1.5", text: "text-xs" },
  lg: { padding: "px-4 py-2.5", text: "text-sm" },
};

function sizeClasses(variant: ButtonVariant, size: ButtonSize): string {
  const { padding, text } = SIZES[size];
  // Icon ships its own padding (p-1.5) and has no text; size is ignored.
  if (variant === "icon") return "";
  // Ghost is text-only by default — no padding. Callers that need padding
  // (e.g. PlanToolbar's "+ New plan" full-width row) add it via className.
  if (variant === "ghost") return text;
  return `${padding} ${text}`;
}

/**
 * Shared button primitive. Variants cover the recurring visual styles
 * across the planner; sizes scale padding + text size for the solid
 * variants. `className` merges in for one-off needs (layout-specific
 * `w-full`, `self-start`, extra padding on ghost buttons, etc).
 *
 * Defaults: `variant="primary"`, `size="md"`, `type="button"`.
 */
export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className,
  ...props
}: ButtonProps) {
  const sizing = sizeClasses(variant, size);
  const classes =
    `${BASE} ${VARIANTS[variant]} ${sizing} ${className ?? ""}`.trim();
  return <button type={type} className={classes} {...props} />;
}
