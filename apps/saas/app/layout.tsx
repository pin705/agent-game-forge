import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
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
  // Light is the default theme (matches the studio's `:root`); `.dark` is
  // opt-in. No theme provider in P0 — keep the shell dependency-light.
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
