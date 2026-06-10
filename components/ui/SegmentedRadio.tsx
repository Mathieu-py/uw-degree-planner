"use client";

import { type ReactNode, useRef } from "react";

export interface SegmentedRadioOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible label when `label` is not plain text (e.g. an icon). */
  ariaLabel?: string;
}

interface SegmentedRadioProps<T extends string> {
  options: readonly SegmentedRadioOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible group label, e.g. "Co-op stream". */
  ariaLabel: string;
  className?: string;
}

/**
 * Full-width segmented control built as a proper radio group: the track fills
 * its column and each segment is an equal `flex-1` `role="radio"` button.
 * Left/Right arrows move and commit the selection (roving tabindex). Distinct
 * from `Segmented` (auto-width `aria-pressed` toggles) — used where exactly one
 * of a few options is chosen and the control should span its field, e.g. the
 * co-op stream picker in onboarding and Plan Settings.
 */
export function SegmentedRadio<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedRadioProps<T>) {
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Roving tabindex needs exactly one focusable target. If `value` matches no
  // option (e.g. a stale/cleared value), fall back to the first segment so the
  // group stays keyboard-reachable instead of every button going tabIndex={-1}.
  const selectedIndex = options.findIndex((opt) => opt.value === value);
  const focusIndex = selectedIndex === -1 ? 0 : selectedIndex;

  function move(from: number, delta: number) {
    const next = (from + delta + options.length) % options.length;
    onChange(options[next].value);
    btnRefs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`inline-flex w-full gap-0.5 p-[3px] rounded-[10px] border border-line-2 bg-bg-2 ${className ?? ""}`.trim()}
    >
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: styled-button radiogroup (not a native radio input) so the active segment carries a raised surface; arrow-key roving is implemented below.
          <button
            key={opt.value}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.ariaLabel}
            tabIndex={i === focusIndex ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(i, -1);
              }
            }}
            className={`flex-1 whitespace-nowrap rounded-[7px] px-2.5 py-[9px] text-[13px] font-semibold transition-colors ${
              active
                ? "bg-bg text-ink shadow-card-sm dark:bg-line-2"
                : "text-ink-2 hover:text-ink"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
