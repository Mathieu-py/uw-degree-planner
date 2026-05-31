import type { ReactNode } from "react";

interface EyebrowProps {
  children: ReactNode;
  className?: string;
}

/**
 * Small uppercase section label with a gold dot, used above page/section
 * headlines. Wraps the `.u-eyebrow` class from globals.css.
 */
export function Eyebrow({ children, className }: EyebrowProps) {
  return (
    <span className={`u-eyebrow ${className ?? ""}`.trim()}>
      <span className="dot" aria-hidden="true" />
      {children}
    </span>
  );
}
