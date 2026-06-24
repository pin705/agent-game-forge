"use client";

import type { ReactNode } from "react";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";

/**
 * Client-side provider tree mounted once at the app root (app/layout.tsx).
 *
 * Kept as a thin client boundary so the root layout itself stays a Server
 * Component. Carries the cross-cutting client context shared by EVERY route
 * (auth, dashboard, build, gallery, billing): i18n (en + vi, persisted) and the
 * class-based theme (light / dark / system, persisted, no-flash). Route-scoped
 * chrome (command palette + settings) lives in <AppChrome>, mounted in the
 * protected layout where the signed-in email is known.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <ThemeProvider>{children}</ThemeProvider>
    </I18nProvider>
  );
}
