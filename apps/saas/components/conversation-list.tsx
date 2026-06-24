"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { DeleteConfirm } from "@/components/delete-confirm";
import {
  createConversation,
  deleteConversation,
  fetchConversations,
  renameConversation,
  type ConversationDTO,
} from "@/lib/conversations/client";
import { useT, type TKey } from "@/lib/i18n";

type BucketKey = "today" | "yesterday" | "previous7" | "earlier";

const BUCKET_ORDER: BucketKey[] = ["today", "yesterday", "previous7", "earlier"];
const BUCKET_LABEL: Record<BucketKey, TKey> = {
  today: "conversations.today",
  yesterday: "conversations.yesterday",
  previous7: "conversations.previous7",
  earlier: "conversations.earlier",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function bucketFor(updatedAt: number, startOfToday: number): BucketKey {
  if (updatedAt >= startOfToday) return "today";
  if (updatedAt >= startOfToday - DAY_MS) return "yesterday";
  if (updatedAt >= startOfToday - 7 * DAY_MS) return "previous7";
  return "earlier";
}

/**
 * Per-project conversation history (Batch 2 ConversationList), ported from
 * studio: date-grouped, selectable rows with inline rename + delete + a "New
 * conversation" button. The active conversation is highlighted. Selecting a row
 * loads its messages into the chat (via `onSelect`).
 */
export function ConversationList({
  projectId,
  conversationId,
  onSelect,
  onCollapse,
  refreshKey,
}: {
  projectId: string;
  conversationId: string | null;
  onSelect: (id: string) => void;
  onCollapse?: () => void;
  /** Bump to force a reload (e.g. after a run creates a new conversation). */
  refreshKey?: number;
}) {
  const t = useT();
  const [conversations, setConversations] = useState<ConversationDTO[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  // The conversation queued for deletion → drives the DeleteConfirm dialog
  // (replaces the native window.confirm with the on-brand dialog, Batch 4).
  const [pendingDelete, setPendingDelete] = useState<ConversationDTO | null>(null);
  const skipBlurRef = useRef(false);

  const title = useCallback(
    (c: ConversationDTO): string => (c.title && c.title.trim() ? c.title : t("conversations.untitled")),
    [t],
  );

  const reload = useCallback(
    () =>
      fetchConversations(projectId)
        .then((r) => setConversations(r.conversations))
        .catch((e) => {
          setConversations([]);
          toast.error(t("conversations.loadFailed", { error: e instanceof Error ? e.message : String(e) }));
        }),
    [projectId, t],
  );

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  async function onNew() {
    if (creating) return;
    setCreating(true);
    try {
      const conversation = await createConversation(projectId);
      setConversations((prev) => (prev ? [conversation, ...prev] : [conversation]));
      onSelect(conversation.id);
    } catch (e) {
      toast.error(t("conversations.newFailed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setCreating(false);
    }
  }

  async function doDelete(id: string) {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await deleteConversation(id);
      setConversations((prev) => prev?.filter((c) => c.id !== id) ?? null);
      if (conversationId === id) {
        const next = conversations?.find((c) => c.id !== id);
        if (next) onSelect(next.id);
      }
    } catch (e) {
      toast.error(t("conversations.deleteFailed", { error: e instanceof Error ? e.message : String(e) }));
      throw e; // keep the confirm dialog open on failure
    } finally {
      setDeletingId(null);
    }
  }

  function startRename(c: ConversationDTO) {
    setRenamingId(c.id);
    setDraft(c.title && c.title.trim() ? c.title : "");
  }

  function cancelRename() {
    setRenamingId(null);
    setDraft("");
  }

  async function commitRename(c: ConversationDTO) {
    if (savingId) return;
    const next = draft.trim();
    const current = c.title?.trim() ?? "";
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
      setDraft("");
    } catch (e) {
      toast.error(t("conversations.renameFailed", { error: e instanceof Error ? e.message : String(e) }));
      setRenamingId(null);
      setDraft("");
    } finally {
      setSavingId(null);
    }
  }

  const groups = useMemo(() => {
    if (!conversations) return [];
    const now = Date.now();
    const startOfToday = new Date(now).setHours(0, 0, 0, 0);
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    const map = new Map<BucketKey, ConversationDTO[]>();
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

  const renderRow = (c: ConversationDTO) => {
    const active = c.id === conversationId;
    const editing = renamingId === c.id;
    const saving = savingId === c.id;

    if (editing) {
      return (
        <div
          key={c.id}
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
            active ? "bg-muted text-foreground" : "bg-muted/40",
          )}
        >
          <MessageSquare className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
          <Input
            autoFocus
            value={draft}
            disabled={saving}
            aria-label={t("conversations.rename")}
            className="h-7 min-w-0 flex-1 px-2 py-1"
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                skipBlurRef.current = true;
                void commitRename(c);
              } else if (e.key === "Escape") {
                e.preventDefault();
                skipBlurRef.current = true;
                cancelRename();
              }
            }}
            onBlur={() => {
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
          "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
          active ? "bg-muted text-foreground" : "hover:bg-muted/60",
        )}
      >
        <button
          type="button"
          onClick={() => onSelect(c.id)}
          onDoubleClick={() => startRename(c)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={title(c)}
        >
          <MessageSquare className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
          <span className="truncate">{title(c)}</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
              title={t("common.rename")}
              disabled={deletingId === c.id}
            >
              {deletingId === c.id ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[8rem]">
            <DropdownMenuItem onSelect={() => startRename(c)}>
              <Pencil />
              {t("common.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setPendingDelete(c)}
            >
              <Trash2 />
              {t("conversations.deleteChat")}
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
              title={t("conversations.collapse")}
            >
              <PanelLeftClose className="size-4" />
            </Button>
          ) : null}
          <span className="truncate text-xs font-medium tracking-wide text-muted-foreground">
            {t("conversations.title")}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1 px-2"
          onClick={() => void onNew()}
          disabled={creating}
        >
          {creating ? <Loader2 className="animate-spin" /> : <Plus />}
          {t("conversations.new")}
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pb-2">
          {conversations === null ? (
            <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("common.loading")}
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">{t("conversations.empty")}</div>
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

      <DeleteConfirm
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        name={pendingDelete ? title(pendingDelete) : ""}
        onConfirm={async () => {
          if (pendingDelete) await doDelete(pendingDelete.id);
        }}
      />
    </div>
  );
}
