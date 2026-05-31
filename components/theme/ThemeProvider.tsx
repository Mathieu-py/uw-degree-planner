"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

// Light / Dark only. Dark is the default for first-time visitors. Setting the
// mode writes data-mode on <html>, which the token CSS keys off.
export type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "udp-theme";
const DEFAULT_THEME: Theme = "dark";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (next: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  return raw === "light" || raw === "dark" ? raw : DEFAULT_THEME;
}

/**
 * Applies the theme to <html> by setting data-mode (the token CSS keys off it).
 * The anti-FOUC inline script in layout.tsx does the same on first load before
 * paint — including defaulting to dark when nothing is stored — so there's no
 * flash; this just keeps it in sync after hydration.
 */
function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-mode", theme);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);

  // Read the persisted choice once on mount (localStorage is client-only) and
  // re-assert it on <html> in case the document was server-rendered without it.
  useEffect(() => {
    const stored = readStoredTheme();
    setThemeState(stored);
    applyTheme(stored);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode / storage disabled — the in-memory choice still applies.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme }),
    [theme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
