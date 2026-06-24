import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, MessageSquare, Trash2, Loader2, PanelLeftClose, Search, MoreHorizontal, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  fetchConversations,
  createConversation,
  removeConversation,
  type Conversation,
} from '@/lib/files';
import { renameConversation } from '@/lib/runs';
import { useT } from '@/lib/i18n';

interface ConversationListProps {
  projectPath: string;
  conversationId: string | null;
  onSelect: (id: string) => void;
  /** When provided, renders a collapse button in the header. */
  onCollapse?: () => void;
}

type BucketKey = 'today' | 'yesterday' | 'previous7' | 'previous30' | 'older';

const BUCKET_ORDER: BucketKey[] = ['today', 'yesterday', 'previous7', 'previous30', 'older'];
const BUCKET_LABEL: Record<BucketKey, `conversations.${BucketKey}`> = {
  today: 'conversations.today',
  yesterday: 'conversations.yesterday',
  previous7: 'conversations.previous7',
  previous30: 'conversations.previous30',
  older: 'conversations.older',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Bucket a conversation's updatedAt relative to `now` by calendar day. */
function bucketFor(updatedAt: number, startOfToday: number): BucketKey {
  if (updatedAt >= startOfToday) return 'today';
  if (updatedAt >= startOfToday - DAY_MS) return 'yesterday';
  if (updatedAt >= startOfToday - 7 * DAY_MS) return 'previous7';
  if (updatedAt >= startOfToday - 30 * DAY_MS) return 'previous30';
  return 'older';
}

export function ConversationList({ projectPath, conversationId, onSelect, onCollapse }: ConversationListProps) {
  const t = useT();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Inline rename: which row is being edited, its draft text, and whether the
  // PATCH is in flight. A ref flag lets us ignore the blur that fires when Esc
  // cancels (and the double-commit when Enter is followed by blur).
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const skipBlurRef = useRef(false);

  const title = useCallback(
    (c: Conversation): string => (c.title && c.title.trim() ? c.title : t('conversations.untitled')),
    [t],
  );

  const reload = useCallback(
    () =>
      fetchConversations(projectPath)
        .then((r) => setConversations(r.conversations))
        .catch((e) => {
          setConversations([]);
          toast.error(t('conversations.loadFailed', { error: e instanceof Error ? e.message : String(e) }));
        }),
    [projectPath, t],
  );

  useEffect(() => {
    setConversations(null);
    setRenamingId(null);
    void reload();
  }, [reload]);

  async function onNew() {
    if (creating) return;
    setCreating(true);
    try {
      const { conversation } = await createConversation(projectPath);
      setConversations((prev) => (prev ? [conversation, ...prev] : [conversation]));
      onSelect(conversation.id);
    } catch (e) {
      toast.error(t('conversations.newFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(id: string) {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await removeConversation(id);
      setConversations((prev) => prev?.filter((c) => c.id !== id) ?? null);
      if (conversationId === id) {
        const next = conversations?.find((c) => c.id !== id);
        if (next) onSelect(next.id);
      }
    } catch (e) {
      toast.error(t('conversations.deleteFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setDeletingId(null);
    }
  }

  function startRename(c: Conversation) {
    setRenamingId(c.id);
    setDraft(c.title && c.title.trim() ? c.title : '');
  }

  function cancelRename() {
    setRenamingId(null);
    setDraft('');
  }

  async function commitRename(c: Conversation) {
    if (savingId) return;
    const next = draft.trim();
    const current = c.title?.trim() ?? '';
    // Nothing to do on empty or unchanged — just drop back to the static row.
    if (!next || next === current) {
      cancelRename();
      return;
    }
    setSavingId(c.id);
    try {
      const updated = await renameConversation(c.id, next);
      setConversations((prev) =>
        prev ? prev.map((x) => (x.id === c.id ? { ...x, title: updated.title } : x)) : prev,
      );
      setRenamingId(null);
      setDraft('');
    } catch (e) {
      // Revert: keep the static row with its original title; surface the error.
      toast.error(t('rename.failed', { error: e instanceof Error ? e.message : String(e) }));
      setRenamingId(null);
      setDraft('');
    } finally {
      setSavingId(null);
    }
  }

  const q = query.trim().toLowerCase();

  /** Flat, case-insensitive filter on title (fallback: id). */
  const filtered = useMemo(() => {
    if (!conversations) return null;
    if (!q) return conversations;
    return conversations.filter((c) => {
      const label = (c.title && c.title.trim() ? c.title : c.id).toLowerCase();
      return label.includes(q) || c.id.toLowerCase().includes(q);
    });
  }, [conversations, q]);

  /** Date buckets (only when not searching), newest-first within each. */
  const groups = useMemo(() => {
    if (!conversations) return [];
    const now = Date.now();
    const startOfToday = new Date(now).setHours(0, 0, 0, 0);
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    const map = new Map<BucketKey, Conversation[]>();
    for (const c of sorted) {
      const key = bucketFor(c.updatedAt, startOfToday);
      const arr = map.get(key);
      if (arr) arr.push(c);
      else map.set(key, [c]);
    }
    return BUCKET_ORDER.flatMap((key) => {
      const items = map.get(key);
      return items && items.length ? [{ key, items }] : [];
    });
  }, [conversations]);

  const renderRow = (c: Conversation) => {
    const active = c.id === conversationId;
    const editing = renamingId === c.id;
    const saving = savingId === c.id;

    if (editing) {
      return (
        <div
          key={c.id}
          className={cn(
            'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
            active ? 'bg-muted text-foreground' : 'bg-muted/40',
          )}
        >
          <MessageSquare className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
          <Input
            autoFocus
            value={draft}
            disabled={saving}
            aria-label={t('conversations.rename')}
            className="h-7 min-w-0 flex-1 px-2 py-1"
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                skipBlurRef.current = true;
                void commitRename(c);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                skipBlurRef.current = true;
                cancelRename();
              }
            }}
            onBlur={() => {
              // Enter/Esc already handled this edit — don't double-act on blur.
              if (skipBlurRef.current) {
                skipBlurRef.current = false;
                return;
              }
              void commitRename(c);
            }}
          />
          {saving ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : null}
        </div>
      );
    }

    return (
      <div
        key={c.id}
        className={cn(
          'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
          active ? 'bg-muted text-foreground' : 'hover:bg-muted/60',
        )}
      >
        <button
          type="button"
          onClick={() => onSelect(c.id)}
          onDoubleClick={() => startRename(c)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={title(c)}
        >
          <MessageSquare
            className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')}
          />
          <span className="truncate">{title(c)}</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
              title={t('common.rename')}
              disabled={deletingId === c.id}
            >
              {deletingId === c.id ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[8rem]">
            <DropdownMenuItem onSelect={() => startRename(c)}>
              <Pencil />
              {t('common.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => void onDelete(c.id)}
            >
              <Trash2 />
              {t('conversations.deleteChat')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-2 py-2">
        <div className="flex min-w-0 items-center gap-1">
          {onCollapse ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-muted-foreground"
              onClick={onCollapse}
              title={t('conversations.collapse')}
            >
              <PanelLeftClose className="size-4" />
            </Button>
          ) : null}
          <span className="truncate text-xs font-medium tracking-wide text-muted-foreground">{t('conversations.title')}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1 px-2"
          onClick={() => void onNew()}
          disabled={creating}
        >
          {creating ? <Loader2 className="animate-spin" /> : <Plus />}
          {t('conversations.new')}
        </Button>
      </div>

      <div className="px-2 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('conversations.search')}
            aria-label={t('conversations.search')}
            className="h-8 pl-8"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pb-2">
          {conversations === null ? (
            <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('common.loading')}
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">{t('conversations.empty')}</div>
          ) : q ? (
            filtered && filtered.length ? (
              <div className="space-y-0.5">{filtered.map(renderRow)}</div>
            ) : (
              <div className="px-2 py-3 text-sm text-muted-foreground">{t('conversations.noMatch')}</div>
            )
          ) : (
            <div className="space-y-3">
              {groups.map(({ key, items }) => (
                <div key={key} className="space-y-0.5">
                  <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {t(BUCKET_LABEL[key])}
                  </div>
                  {items.map(renderRow)}
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
