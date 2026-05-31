import type { HTMLAttributes, ReactNode } from "react";

export type ChipVariant = "default" | "done" | "gold";

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: ChipVariant;
  children: ReactNode;
}

// Monospace status chip for course codes, counts, and small labels.
//   default — neutral surface
//   done    — met/completed (green)
//   gold    — accent (requirement focus)
const CHIP_VARIANTS: Record<ChipVariant, string> = {
  default: "bg-bg-3 text-ink border-line",
  done: "bg-met-soft text-met border-transparent",
  gold: "bg-accent-soft text-accent border-accent-line",
};

/** Mirrors the design's `.chip` (+`-done`/`-gold`). */
export function Chip({
  variant = "default",
  children,
  className,
  ...rest
}: ChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-xs font-semibold px-2 py-1 rounded-[6px] border ${CHIP_VARIANTS[variant]} ${className ?? ""}`.trim()}
      {...rest}
    >
      {children}
    </span>
  );
}
