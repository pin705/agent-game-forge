"use client";

// ⌘K command palette (Batch 4) — ported & adapted from
// apps/studio/src/components/CommandPalette.tsx for the hosted SaaS.
//
// Architecture: a context provider mounted once in the app chrome owns the
// open/close state and a registry of "extra" commands. GLOBAL commands
// (navigate, preferences, sign-out) are always present. Surfaces with extra
// context — chiefly the build page — register PROJECT-scoped commands (publish,
// focus chat, open file, switch project) via `useRegisterCommands`; they appear
// only while that surface is mounted.
//
// No `cmdk` dependency — same hand-rolled, keyboard-navigable list as the
// studio original (arrow keys, Enter to run, Esc to close).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { TKey } from "@/lib/i18n";

export type CommandGroup = "navigate" | "project" | "files" | "preferences";

export interface Command {
  id: string;
  group: CommandGroup;
  /** Pre-resolved label (already run through t()). */
  label: string;
  /** Optional lucide icon node. */
  icon?: ReactNode;
  /** Extra terms to match against beyond the label (e.g. a file path). */
  keywords?: string;
  run: () => void;
}

interface CommandPaletteContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Replace the set of extra commands keyed by `key` (idempotent per surface). */
  register: (key: string, commands: Command[]) => void;
  unregister: (key: string) => void;
  /** All commands flattened (global + registered), for the palette UI. */
  commands: Command[];
}

const Ctx = createContext<CommandPaletteContextValue | null>(null);

/** Filter a command list by a free-text query (label + keywords). Pure — also
 *  exercised in scripts/ui-test.mjs. */
export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      (c.keywords ? c.keywords.toLowerCase().includes(q) : false),
  );
}

export function CommandPaletteProvider({
  /** Global commands always available regardless of route. */
  globalCommands,
  children,
}: {
  globalCommands: Command[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [extra, setExtra] = useState<Record<string, Command[]>>({});

  const register = useCallback((key: string, commands: Command[]) => {
    setExtra((prev) => ({ ...prev, [key]: commands }));
  }, []);
  const unregister = useCallback((key: string) => {
    setExtra((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // ⌘K / Ctrl-K toggles the palette anywhere in the app.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands = useMemo(
    () => [...globalCommands, ...Object.values(extra).flat()],
    [globalCommands, extra],
  );

  const value = useMemo<CommandPaletteContextValue>(
    () => ({ open, setOpen, register, unregister, commands }),
    [open, register, unregister, commands],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCommandPalette must be used within <CommandPaletteProvider>");
  return ctx;
}

/**
 * Register a set of commands for as long as the calling component is mounted.
 * `key` namespaces the set (a remount with the same key replaces it). The
 * commands array is rebuilt on every render, so memoize it in the caller.
 */
export function useRegisterCommands(key: string, commands: Command[]): void {
  const { register, unregister } = useCommandPalette();
  useEffect(() => {
    register(key, commands);
    return () => unregister(key);
  }, [key, commands, register, unregister]);
}

/** Label keys for group headings, resolved in the palette UI. */
export const GROUP_LABEL_KEYS: Record<CommandGroup, TKey> = {
  navigate: "palette.group.navigate",
  project: "palette.group.project",
  files: "palette.group.files",
  preferences: "palette.group.preferences",
};

/** Stable group render order. */
export const GROUP_ORDER: CommandGroup[] = ["navigate", "project", "files", "preferences"];
