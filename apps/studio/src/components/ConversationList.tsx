import { useCallback, useEffect, useState } from 'react';
import { Plus, MessageSquare, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  fetchConversations,
  createConversation,
  removeConversation,
  type Conversation,
} from '@/lib/files';
import { useT } from '@/lib/i18n';

interface ConversationListProps {
  projectPath: string;
  conversationId: string | null;
  onSelect: (id: string) => void;
}

export function ConversationList({ projectPath, conversationId, onSelect }: ConversationListProps) {
  const t = useT();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground">{t('conversations.title')}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2"
          onClick={() => void onNew()}
          disabled={creating}
        >
          {creating ? <Loader2 className="animate-spin" /> : <Plus />}
          {t('conversations.new')}
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-0.5 px-2 pb-2">
          {conversations === null ? (
            <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('common.loading')}
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">{t('conversations.empty')}</div>
          ) : (
            conversations.map((c) => {
              const active = c.id === conversationId;
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
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    title={title(c)}
                  >
                    <MessageSquare
                      className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')}
                    />
                    <span className="truncate">{title(c)}</span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0 text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                    title={t('conversations.deleteChat')}
                    disabled={deletingId === c.id}
                    onClick={() => void onDelete(c.id)}
                  >
                    {deletingId === c.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
