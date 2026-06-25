import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";
import { themeScript } from "@/lib/theme";
import "./globals.css";

// Fonts: we deliberately do NOT use next/font/google (it fetches font FILES at
// build time, which would break offline / network-less builds). Instead we load
// the SAME Google Fonts stylesheet the studio uses via a plain <link> in <head>
// (runtime fetch only — the build stays offline-safe). The CSS stacks in
// globals.css (--font-sans / --font-mono / .brand-*) reference these families:
// Inter, JetBrains Mono, Press Start 2P. This makes the SaaS render in Inter
// (matching the studio) instead of falling back to the system font.

export const metadata: Metadata = {
  title: "Footage — build games with AI",
  description:
    "Lovable for games. Describe a game, watch it build in the cloud.",
  icons: { icon: "/ogf-logo-64.png" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Theme (Batch 4): light / dark / system, class-based on <html>. The inline
  // script below runs BEFORE hydration so the `.dark` class is correct on the
  // first paint — no flash, no SSR/client mismatch (see lib/theme.tsx).
  // suppressHydrationWarning: the script legitimately mutates <html>'s class
  // before React hydrates, which would otherwise warn.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Same font stack as the studio (apps/studio/index.html). Runtime
            <link> fetch — keeps the build offline-safe (no next/font). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;600;700&family=JetBrains+Mono:wght@400;500&family=Press+Start+2P&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
