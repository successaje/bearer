"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "bearer:theme";
export const DEFAULT_THEME: ThemePreference = "dark";

/**
 * Runs before first paint (see app/layout.tsx) so the page never flashes the wrong theme.
 * Kept as a string because it's inlined into <head>.
 */
export const themeScript = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}")||"${DEFAULT_THEME}";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light")}catch(e){document.documentElement.setAttribute("data-theme","dark")}})()`;

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(resolved: ResolvedTheme) {
  const root = document.documentElement;
  // Suppress transitions for the frame where every color changes at once.
  root.setAttribute("data-theme-switching", "");
  root.setAttribute("data-theme", resolved);
  requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute("data-theme-switching")));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>(DEFAULT_THEME);
  const [resolved, setResolved] = useState<ResolvedTheme>("dark");

  useEffect(() => {
    let stored: ThemePreference = DEFAULT_THEME;
    try {
      const v = localStorage.getItem(THEME_STORAGE_KEY);
      if (v === "light" || v === "dark" || v === "system") stored = v;
    } catch {}
    const r = stored === "system" ? systemTheme() : stored;
    // Sync React state with what the inline script already applied.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPref(stored);
    setResolved(r);
  }, []);

  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const r = systemTheme();
      setResolved(r);
      apply(r);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback((p: ThemePreference) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, p);
    } catch {}
    const r = p === "system" ? systemTheme() : p;
    setPref(p);
    setResolved(r);
    apply(r);
  }, []);

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
