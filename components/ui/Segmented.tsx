"use client";

import type { ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible label when `label` is an icon. */
  ariaLabel?: string;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible group label (e.g. "Appearance", "View mode"). */
  ariaLabel: string;
  className?: string;
}

/**
 * Segmented control matching the design's `.seg`. The active button gets a
 * raised surface (bg-bg + shadow-card-sm) over the inset track. Used by the
 * dashboard grid/list switch.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedProps<T>) {
  return (
    <fieldset
      aria-label={ariaLabel}
      className={`inline-flex gap-0.5 p-[3px] m-0 rounded-[10px] border border-line bg-bg-3 ${className ?? ""}`.trim()}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            aria-label={opt.ariaLabel}
            onClick={() => onChange(opt.value)}
            className={`inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-[7px] text-[13px] font-semibold transition-colors ${
              active
                ? "bg-bg text-ink shadow-card-sm"
                : "text-ink-2 hover:text-ink"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </fieldset>
  );
}
