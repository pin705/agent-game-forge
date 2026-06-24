import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Layers, Image as ImageIcon, Code2, Database, Settings, MessageSquarePlus, SunMoon, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type TabValue = 'play' | 'scene' | 'assets' | 'data' | 'code';

type Group = 'tabs' | 'actions';

type Command = {
  id: string;
  group: Group;
  label: string;
  icon: React.ReactNode;
  run: () => void;
};

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Switch the active workspace tab. */
  onSelectTab: (tab: TabValue) => void;
  /** Open the settings dialog. */
  onOpenSettings: () => void;
  /** Start a fresh chat / conversation. */
  onNewChat: () => void;
  /** Flip light / dark theme. */
  onToggleTheme: () => void;
  /** Publish action (same handler as the header button). */
  onPublish: () => void;
}

/**
 * ⌘K command palette. Built from shadcn Dialog + Input plus a hand-rolled,
 * keyboard-navigable list (no cmdk dependency). Filters across two groups —
 * "Go to tab" and "Actions" — with arrow-key navigation, Enter to run and
 * Esc to close (Esc is handled by the Dialog).
 */
export function CommandPalette({
  open,
  onOpenChange,
  onSelectTab,
  onOpenSettings,
  onNewChat,
  onToggleTheme,
  onPublish,
}: CommandPaletteProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  const commands = useMemo<Command[]>(
    () => [
      { id: 'tab.play', group: 'tabs', label: t('tab.play'), icon: <Play />, run: () => run(() => onSelectTab('play')) },
      { id: 'tab.scene', group: 'tabs', label: t('tab.scene'), icon: <Layers />, run: () => run(() => onSelectTab('scene')) },
      { id: 'tab.assets', group: 'tabs', label: t('tab.assets'), icon: <ImageIcon />, run: () => run(() => onSelectTab('assets')) },
      { id: 'tab.data', group: 'tabs', label: t('tab.data'), icon: <Database />, run: () => run(() => onSelectTab('data')) },
      { id: 'tab.code', group: 'tabs', label: t('tab.code'), icon: <Code2 />, run: () => run(() => onSelectTab('code')) },
      { id: 'app.settings', group: 'actions', label: t('app.settings'), icon: <Settings />, run: () => run(onOpenSettings) },
      { id: 'conversations.new', group: 'actions', label: t('conversations.new'), icon: <MessageSquarePlus />, run: () => run(onNewChat) },
      { id: 'app.theme', group: 'actions', label: t('app.theme'), icon: <SunMoon />, run: () => run(onToggleTheme) },
      { id: 'build.publish', group: 'actions', label: t('build.publish'), icon: <Upload />, run: () => run(onPublish) },
    ],
    // run() is stable enough for this list; handlers come from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, onSelectTab, onOpenSettings, onNewChat, onToggleTheme, onPublish],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  // Reset query + selection each time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  // Keep the active index within the filtered range as the query narrows.
  useEffect(() => {
    setActive((i) => (filtered.length === 0 ? 0 : Math.min(i, filtered.length - 1)));
  }, [filtered.length]);

  // Scroll the active row into view as the selection moves.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      filtered[active]?.run();
    }
  };

  // Render the flat filtered list while tracking absolute indices so the
  // active row matches arrow-key navigation across both groups.
  const groups: { key: Group; label: string }[] = [
    { key: 'tabs', label: t('palette.tabs') },
    { key: 'actions', label: t('palette.actions') },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 shadow-lg sm:max-w-[520px]">
        <DialogTitle className="sr-only">{t('palette.placeholder')}</DialogTitle>
        <div className="border-b px-3 py-2.5">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('palette.placeholder')}
            className="h-9 border-0 px-1 text-sm shadow-none focus-visible:ring-0"
          />
        </div>
        <div ref={listRef} className="max-h-[320px] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">{t('palette.empty')}</div>
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
                        onClick={() => c.run()}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm outline-none transition-colors [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
                          isActive ? 'bg-accent text-accent-foreground' : 'text-foreground',
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
