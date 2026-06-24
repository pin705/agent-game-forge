"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Sonner Toaster, wired to the app's design tokens via CSS variables so it
 * matches the warm-paper / mono-ink theme in both light and dark. No
 * next-themes dependency in P0 — the toast surface inherits the page theme
 * through the CSS custom properties below.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      position="bottom-right"
      richColors
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
