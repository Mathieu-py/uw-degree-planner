import type { HTMLAttributes, ReactNode } from "react";

interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

/**
 * Small rounded label on a hairline border — used in proof strips, "Shared ·
 * read-only" badges, and metadata rows. Mirrors the design's `.pill`.
 */
export function Pill({ children, className, ...rest }: PillProps) {
  return (
    <span
      className={`inline-flex items-center gap-[7px] h-7 px-[11px] rounded-full border border-line-2 bg-bg text-xs font-medium text-ink-2 ${className ?? ""}`.trim()}
      {...rest}
    >
      {children}
    </span>
  );
}
