import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";
import { themeScript } from "@/lib/theme";
import "./globals.css";

// Fonts are pure CSS stacks (--font-sans / --font-mono live in globals.css).
// We deliberately do NOT use next/font/google: it fetches font files at build
// time, which would break offline / network-less builds. The CSS stacks fall
// back to Inter / JetBrains Mono if installed, else system fonts — same look.

export const metadata: Metadata = {
  title: "Footage — build games with AI",
  description:
    "Lovable for games. Describe a game, watch it build in the cloud.",
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
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
