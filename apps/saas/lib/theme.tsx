"use client";

// Lightweight, class-based theme system for the Footage SaaS (Batch 4).
//
// Ported in spirit from apps/studio/src/components/ThemeToggle.tsx but extended
// to a light/dark/SYSTEM tri-state with a React context so any surface (top-nav
// toggle, settings dialog, command palette) shares one source of truth.
//
//   • Persisted to localStorage under THEME_LS_KEY ("light" | "dark" | "system").
//   • Applied by toggling the `.dark` class on <html>; the `.dark` token block
//     already exists in globals.css.
//   • SSR-safe / NO hydration flash: the actual class is set BEFORE React
//     hydrates by a tiny inline script (themeScript below) injected in
//     app/layout.tsx <head>. The provider then reads the class already on
//     <html> for its initial state, so server and client agree.
//   • "system" tracks prefers-color-scheme live via a matchMedia listener.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemePref = "light" | "dark" | "system";
/** The two concrete schemes the `.dark` class encodes. */
export type ResolvedTheme = "light" | "dark";

export const THEME_LS_KEY = "ogf_saas_theme";

// ── Pure logic (unit-tested in scripts/ui-test.mjs) ────────────────────────

/** A persisted value is only a valid pref if it's one of the three tokens. */
export function isThemePref(v: unknown): v is ThemePref {
  return v === "light" || v === "dark" || v === "system";
}

/**
 * Resolve a pref + the OS preference into the concrete scheme. "system" maps to
 * the OS; an explicit pref wins. Pure — no DOM access — so it's trivially
 * testable and shared by the inline script's logic.
 */
export function resolveThemeClass(pref: ThemePref, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === "system") return systemPrefersDark ? "dark" : "light";
  return pref;
}

/**
 * The inline pre-hydration script (stringified). Runs in <head> before paint so
 * the `.dark` class is correct on the very first frame — no flash, no mismatch.
 * Mirrors resolveThemeClass; kept dependency-free because it executes raw.
 */
export const themeScript = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_LS_KEY,
)});if(p!=="light"&&p!=="dark"&&p!=="system")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

// ── Provider ────────────────────────────────────────────────────────────

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readPersistedPref(): ThemePref {
  try {
    const saved = localStorage.getItem(THEME_LS_KEY);
    if (isThemePref(saved)) return saved;
  } catch {
    /* storage disabled */
  }
  return "system";
}

function applyResolved(resolved: ResolvedTheme): void {
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

interface ThemeContextValue {
  /** The user's preference ("system" follows the OS). */
  theme: ThemePref;
  /** The concrete scheme currently applied. */
  resolved: ResolvedTheme;
  setTheme: (pref: ThemePref) => void;
  /** Convenience: flip between explicit light and dark. */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // The inline script has ALREADY set the right class before hydration; start
  // from the persisted pref so the toggle reflects "system" vs explicit.
  const [theme, setThemeState] = useState<ThemePref>("system");
  const [resolved, setResolved] = useState<ResolvedTheme>("light");

  // Sync from storage + the class the inline script applied (post-mount only,
  // so SSR stays deterministic).
  useEffect(() => {
    const pref = readPersistedPref();
    setThemeState(pref);
    setResolved(resolveThemeClass(pref, systemPrefersDark()));
  }, []);

  // When the pref is "system", track OS changes live.
  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const r = resolveThemeClass("system", mq.matches);
      setResolved(r);
      applyResolved(r);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((pref: ThemePref) => {
    setThemeState(pref);
    const r = resolveThemeClass(pref, systemPrefersDark());
    setResolved(r);
    applyResolved(r);
    try {
      localStorage.setItem(THEME_LS_KEY, pref);
    } catch {
      /* storage disabled — applies for this session only */
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(resolved === "dark" ? "light" : "dark");
  }, [resolved, setTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolved, setTheme, toggle }),
    [theme, resolved, setTheme, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>");
  return ctx;
}
