import type { HTMLAttributes, ReactNode } from "react";
import { Button } from "@/components/ui/Button";

export type AlertVariant = "danger" | "success" | "partial";
export type AlertSize = "sm" | "md" | "lg";

const ALERT_VARIANTS: Record<AlertVariant, string> = {
  danger: "border-danger bg-danger-soft text-danger",
  success: "border-met bg-met-soft text-met",
  partial: "border-partial bg-partial-soft text-ink",
};

const ALERT_SIZES: Record<AlertSize, string> = {
  sm: "rounded-[8px] px-3 py-2 text-xs",
  md: "rounded-[10px] px-4 py-3 text-sm",
  lg: "rounded-[10px] px-4 py-6 text-sm",
};

// Retry layout: md is a single message + button row; sm/lg stack the button below.
const RETRY_LAYOUTS: Record<AlertSize, { box: string; button: string }> = {
  sm: { box: "flex flex-col gap-3", button: "self-center" },
  md: { box: "flex items-center justify-between gap-3", button: "shrink-0" },
  lg: { box: "flex flex-col items-start gap-3", button: "" },
};

interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  size?: AlertSize;
  /** Bold headline; children then render as smaller detail lines beneath it. */
  title?: string;
  /** Renders the standard outline "Try again" button wired to this handler. */
  onRetry?: () => void;
  children: ReactNode;
}

/**
 * Inline status box for form / action errors. Defaults to `role="alert"` so
 * assistive tech announces it the moment it mounts; pass `aria-live` to tune
 * the urgency. Mirrors the design's danger/success soft-fill boxes.
 */
export function Alert({
  variant = "danger",
  size = "sm",
  title,
  onRetry,
  className,
  children,
  ...rest
}: AlertProps) {
  const layout = onRetry ? RETRY_LAYOUTS[size] : null;
  return (
    <div
      role="alert"
      className={`${ALERT_SIZES[size]} border ${ALERT_VARIANTS[variant]} ${layout?.box ?? ""} ${className ?? ""}`
        .replace(/\s+/g, " ")
        .trim()}
      {...rest}
    >
      {title ? (
        <div className="flex flex-col gap-1">
          <p className="font-medium">{title}</p>
          <div className="flex flex-col gap-1 text-xs opacity-80">
            {children}
          </div>
        </div>
      ) : (
        children
      )}
      {onRetry ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className={layout?.button}
        >
          Try again
        </Button>
      ) : null}
    </div>
  );
}
