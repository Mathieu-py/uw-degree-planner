import type { HTMLAttributes, ReactNode } from "react";

export type AlertVariant = "danger" | "success";

const ALERT_VARIANTS: Record<AlertVariant, string> = {
  danger: "border-danger bg-danger-soft text-danger",
  success: "border-met bg-met-soft text-met",
};

interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  children: ReactNode;
}

/**
 * Inline status box for form / action errors. Defaults to `role="alert"` so
 * assistive tech announces it the moment it mounts; pass `aria-live` to tune
 * the urgency. Mirrors the design's danger/success soft-fill boxes.
 */
export function Alert({
  variant = "danger",
  className,
  children,
  ...rest
}: AlertProps) {
  return (
    <div
      role="alert"
      className={`rounded-[8px] border px-3 py-2 text-xs ${ALERT_VARIANTS[variant]} ${className ?? ""}`.trim()}
      {...rest}
    >
      {children}
    </div>
  );
}
