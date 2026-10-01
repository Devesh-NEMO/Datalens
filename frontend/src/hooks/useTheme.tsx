'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { THEME_STORAGE_KEY } from '@/lib/constants';

export type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    // Private mode or blocked storage: fall back to the media query.
    return null;
  }
}

function preferredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(theme);
  root.style.colorScheme = theme;
}

/**
 * The blocking script in layout.tsx has already put the correct class on <html>
 * before React hydrates, so there is no flash and no hidden pre-hydration frame.
 * This hook only syncs React state to that class and handles user changes.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(readStoredTheme() ?? preferredTheme());
  }, []);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    setThemeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable: the class is still applied for this session.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Storage unavailable.
      }
      return next;
    });
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>{children}</ThemeContext.Provider>;
}

/**
 * Safe to call outside a provider so components can be rendered in isolation by
 * tests and Storybook without a wrapper.
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context) return context;
  return { theme: 'dark', toggleTheme: () => {}, setTheme: () => {} };
}

// hello
