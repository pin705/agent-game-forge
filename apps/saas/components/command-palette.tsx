"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import {
  GROUP_LABEL_KEYS,
  GROUP_ORDER,
  filterCommands,
  useCommandPalette,
  type CommandGroup,
} from "@/lib/command-palette";

/**
 * The ⌘K palette UI — mounted once in the app chrome. Reads open-state and the
 * flattened command registry from the context. Hand-rolled keyboard nav (arrow
 * keys + Enter), grouped headings, fuzzy-ish substring filter. On-brand: shadcn
 * Dialog + Input over the warm token theme.
 */
export function CommandPalette() {
  const t = useT();
  const { open, setOpen, commands } = useCommandPalette();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => filterCommands(commands, query), [commands, query]);

  // Reset query + selection each time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  // Keep the active index within range as the list narrows.
  useEffect(() => {
    setActive((i) => (filtered.length === 0 ? 0 : Math.min(i, filtered.length - 1)));
  }, [filtered.length]);

  // Scroll the active row into view as the selection moves.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const runAt = (idx: number) => {
    const cmd = filtered[idx];
    if (!cmd) return;
    setOpen(false);
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(active);
    }
  };

  const groups: { key: CommandGroup; label: string }[] = GROUP_ORDER.map((g) => ({
    key: g,
    label: t(GROUP_LABEL_KEYS[g]),
  }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[18%] translate-y-0 gap-0 overflow-hidden p-0 shadow-lg sm:max-w-[540px]">
        <DialogTitle className="sr-only">{t("palette.open")}</DialogTitle>
        <div className="border-b px-3 py-2.5">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("palette.placeholder")}
            className="h-9 border-0 px-1 text-sm shadow-none focus-visible:ring-0"
          />
        </div>
        <div ref={listRef} className="max-h-[360px] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {t("palette.empty")}
            </div>
          ) : (
            groups.map((g) => {
              const items = filtered.filter((c) => c.group === g.key);
              if (items.length === 0) return null;
              return (
                <div key={g.key} className="mb-1 last:mb-0">
                  <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {g.label}
                  </div>
                  {items.map((c) => {
                    const idx = filtered.indexOf(c);
                    const isActive = idx === active;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        data-index={idx}
                        role="option"
                        aria-selected={isActive}
                        onMouseMove={() => setActive(idx)}
                        onClick={() => runAt(idx)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm outline-none transition-colors [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
                          isActive ? "bg-accent text-accent-foreground" : "text-foreground",
                        )}
                      >
                        {c.icon}
                        <span className="truncate">{c.label}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
