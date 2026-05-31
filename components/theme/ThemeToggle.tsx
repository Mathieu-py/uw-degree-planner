"use client";

import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { type Theme, useTheme } from "./ThemeProvider";

/**
 * Light / Dark control built on the Segmented primitive. Drives the
 * ThemeProvider, which sets data-mode on <html>.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <Segmented<Theme>
      ariaLabel="Appearance"
      value={theme}
      onChange={setTheme}
      className={className}
      options={[
        {
          value: "light",
          ariaLabel: "Light",
          label: <Icon name="sun" size="sm" />,
        },
        {
          value: "dark",
          ariaLabel: "Dark",
          label: <Icon name="moon" size="sm" />,
        },
      ]}
    />
  );
}
