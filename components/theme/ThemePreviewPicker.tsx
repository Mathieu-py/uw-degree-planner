"use client";

import { useRef } from "react";
import { type Theme, useTheme } from "./ThemeProvider";

/**
 * Fixed hexes mirroring the light/dark token values in globals.css — not token
 * utilities, because tokens re-theme with <html data-mode> and a light preview
 * must stay light while dark mode is active.
 */
const MOCKS: {
  value: Theme;
  label: string;
  bg: string;
  surface: string;
  line: string;
  ink: string;
  muted: string;
  accent: string;
}[] = [
  {
    value: "light",
    label: "Light",
    bg: "#ffffff",
    surface: "#f7f6f2",
    line: "#e8e5dd",
    ink: "#17150f",
    muted: "#d9d5ca",
    accent: "#e8a81c",
  },
  {
    value: "dark",
    label: "Dark",
    bg: "#0b0a07",
    surface: "#14120c",
    line: "#262216",
    ink: "#f6f3ea",
    muted: "#352f1f",
    accent: "#f0b429",
  },
];

/**
 * Appearance picker in the style of macOS Settings: a miniature mock of the
 * app per theme, selectable as a radio group. The only theme control in the
 * app — the header intentionally has none.
 */
export function ThemePreviewPicker({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function move(from: number, delta: number) {
    const next = (from + delta + MOCKS.length) % MOCKS.length;
    setTheme(MOCKS[next].value);
    btnRefs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className={`grid grid-cols-2 gap-3 max-w-[360px] ${className ?? ""}`.trim()}
    >
      {MOCKS.map((mock, i) => {
        const active = mock.value === theme;
        return (
          // biome-ignore lint/a11y/useSemanticElements: styled-button radiogroup (not a native radio input) so each option can render a preview card; arrow-key roving is implemented below.
          <button
            key={mock.value}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={mock.value === theme ? 0 : -1}
            onClick={() => setTheme(mock.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(i, -1);
              }
            }}
            className={`flex flex-col gap-1.5 rounded-[12px] border p-2 pb-1.5 transition-colors ${
              active
                ? "border-accent ring-1 ring-accent"
                : "border-line hover:border-line-strong"
            }`}
          >
            <span
              aria-hidden
              className="block overflow-hidden rounded-[8px] border"
              style={{ backgroundColor: mock.bg, borderColor: mock.line }}
            >
              {/* Mini top nav: brand dot + a nav dash */}
              <span
                className="flex items-center gap-1 px-2 py-1.5 border-b"
                style={{ borderColor: mock.line }}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: mock.accent }}
                />
                <span
                  className="h-1 w-6 rounded-full"
                  style={{ backgroundColor: mock.muted }}
                />
              </span>
              {/* Mini page: heading, two text lines, accent action */}
              <span className="flex flex-col gap-1 px-2 py-2">
                <span
                  className="h-1.5 w-1/2 rounded-full"
                  style={{ backgroundColor: mock.ink }}
                />
                <span
                  className="h-1 w-full rounded-full"
                  style={{ backgroundColor: mock.muted }}
                />
                <span
                  className="h-1 w-3/4 rounded-full"
                  style={{ backgroundColor: mock.muted }}
                />
                <span
                  className="mt-0.5 h-2 w-8 rounded-[3px]"
                  style={{ backgroundColor: mock.accent }}
                />
              </span>
              {/* Mini card row on a raised surface */}
              <span
                className="mx-2 mb-2 block rounded-[4px] border px-1.5 py-1"
                style={{
                  backgroundColor: mock.surface,
                  borderColor: mock.line,
                }}
              >
                <span
                  className="block h-1 w-2/3 rounded-full"
                  style={{ backgroundColor: mock.muted }}
                />
              </span>
            </span>
            <span
              className={`text-[13px] font-semibold ${active ? "text-ink" : "text-ink-2"}`}
            >
              {mock.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
