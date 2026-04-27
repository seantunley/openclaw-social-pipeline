/**
 * Theme system. Tokens live in CSS variables (see index.css) — switching
 * themes is a single className flip on <html>, no React rerender of color
 * values. Persists choice in localStorage; honours system preference when
 * nothing is stored.
 *
 * Initial paint is handled by an inline script in index.html that runs
 * before React mounts, so the page never flashes the wrong theme.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemeId = 'light' | 'dark';

const STORAGE_KEY = 'social-pipeline-theme';

interface ThemeContextValue {
  theme: ThemeId;
  /** Explicitly set; overrides system preference. */
  setTheme: (id: ThemeId) => void;
  /** Convenience flip. */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialTheme(): ThemeId {
  if (typeof window === 'undefined') return 'dark';
  // Trust the class the inline script applied — it already resolved
  // localStorage and system preference. This avoids a second lookup
  // diverging from what's painted.
  if (document.documentElement.classList.contains('theme-light')) return 'light';
  return 'dark';
}

function applyTheme(theme: ThemeId) {
  const root = document.documentElement;
  root.classList.remove('theme-light', 'theme-dark', 'dark');
  if (theme === 'light') {
    root.classList.add('theme-light');
  } else {
    // Keep `dark` alongside `theme-dark` so any Tailwind `dark:` variants
    // continue working unchanged.
    root.classList.add('theme-dark', 'dark');
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(readInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage may be disabled (private mode); the class flip still works.
    }
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme: setThemeState,
      toggle: () => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')),
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
