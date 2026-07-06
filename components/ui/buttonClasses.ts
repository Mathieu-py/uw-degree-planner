// Button design-system class logic, in a plain (non-"use client") module so
// Server Components can call it too (e.g. a `<Link>` CTA). The interactive
// `<Button>` wrapper in Button.tsx is built on this.

// Design-system variants:
//   primary       — ink fill (black/white). The default CTA. NOT gold.
//   brand         — gold fill. Accent CTA only; use sparingly.
//   outline       — bordered, neutral surface.
//   ghost         — text-only, subtle hover fill.
//   danger        — solid destructive (delete/discard).
//   dangerOutline — bordered destructive.
//   icon          — square icon button, neutral tone (box comes from ICON_SIZES).
//   iconRaised    — like icon, but hover bg is a step darker (bg-3) so the square
//                   still shows when the button sits on a bg-2 surface (toolbar
//                   bars, dropdown rows). Plain `icon` is right on the base bg.
//   iconDanger    — square icon button, danger tone (destructive).
export type ButtonVariant =
  | "primary"
  | "brand"
  | "outline"
  | "ghost"
  | "danger"
  | "dangerOutline"
  | "icon"
  | "iconRaised"
  | "iconDanger";

export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full-width. Mirrors the design's `.btn-block`. */
  block?: boolean;
  /** Extra classes merged in for one-off layout needs (`w-full`, `self-start`). */
  className?: string;
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
  // Icon buttons take their box (size/radius) from ICON_SIZES; the variant sets tone only.
  icon: "text-ink-3 hover:text-ink hover:bg-bg-2",
  iconRaised: "text-ink-3 hover:text-ink hover:bg-bg-3",
  iconDanger: "text-danger hover:bg-danger-soft",
};

// height + horizontal padding + text size + radius per size.
const SIZES: Record<ButtonSize, string> = {
  sm: "h-[34px] px-[13px] text-[13px] rounded-[8px]",
  md: "h-[42px] px-[18px] text-sm rounded-[9px]",
  lg: "h-[48px] px-6 text-[15px] rounded-[10px]",
};

// Square sizing for icon buttons: sm/lg are fixed boxes (dense rows / prominent
// bars); md keeps the padding-based default that all existing icon buttons use.
const ICON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 w-8 rounded-[7px]",
  md: "p-2 rounded-[7px]",
  lg: "h-11 w-11 rounded-lg",
};

/**
 * The merged class string for the button visual, independent of the `<button>`
 * element — apply it directly to a non-button CTA like a `<Link>`. Prefer this
 * over wrapping a `<Link>` in `<Button>`: a Server Component passing a `<Link>`
 * into the client `<Button>` serializes it as a lazy element that can't be
 * cloned to merge classes, causing a hydration mismatch.
 */
export function buttonClasses({
  variant = "primary",
  size = "md",
  block = false,
  className,
}: ButtonClassOptions = {}): string {
  const isIcon =
    variant === "icon" || variant === "iconRaised" || variant === "iconDanger";
  const sizing = isIcon ? ICON_SIZES[size] : SIZES[size];
  return `${BASE} ${VARIANTS[variant]} ${sizing} ${block ? "w-full" : ""} ${className ?? ""}`
    .replace(/\s+/g, " ")
    .trim();
}
