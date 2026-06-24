"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileCode, History, MessageSquare, Rocket, Upload } from "lucide-react";
import { BuildChat } from "@/components/build-chat";
import { ConversationList } from "@/components/conversation-list";
import { EditorPanel } from "@/components/editor-panel";
import { PlayPane } from "@/components/play-pane";
import { useRouter } from "next/navigation";
import { StatusBar } from "@/components/status-bar";
import { UnsavedChangesModal } from "@/components/unsaved-changes-modal";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { NAV_GUARD_EVENT, type NavGuardDetail } from "@/lib/nav-guard";
import {
  requestFocusChat,
  requestPublish,
  useRegisterCommands,
  type Command,
} from "@/lib/command-palette";

/**
 * Resizable 3-pane builder shell: chat (left) · live preview (center) · code
 * editor (right). Ported from the studio's Build.tsx column-resize behaviour —
 * the chat and code columns are fixed-width-but-draggable; the preview is the
 * flexible `1fr` remainder. Pane widths persist to localStorage.
 *
 * The workspace owns the single source of truth for the project's file list +
 * its refresh, handing both to the code panel (tree) and the preview (whether a
 * playable index.html exists). An agent run (BuildChat.onFilesChanged) and a
 * manual save both trigger a refresh so the tree + preview stay current.
 */

const COLS_LS_KEY = "ogf.saas.build.cols";
const CHAT_MIN = 280;
const CHAT_MAX = 620;
const CHAT_DEFAULT = 380;
const CODE_MIN = 280;
const CODE_MAX = 760;
const CODE_DEFAULT = 480;

type ColWidths = { chat: number; code: number };

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function loadCols(): ColWidths {
  try {
    const raw = localStorage.getItem(COLS_LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ColWidths>;
      return {
        chat: clamp(Number(p.chat) || CHAT_DEFAULT, CHAT_MIN, CHAT_MAX),
        code: clamp(Number(p.code) || CODE_DEFAULT, CODE_MIN, CODE_MAX),
      };
    }
  } catch {
    /* storage disabled / bad JSON — fall back to defaults */
  }
  return { chat: CHAT_DEFAULT, code: CODE_DEFAULT };
}

export function BuildWorkspace({
  projectId,
  projectName = "",
}: {
  projectId: string;
  projectName?: string;
}) {
  const t = useT();
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  // Batch 4 status-bar / palette signals.
  const [modelId, setModelId] = useState<string | null>(null);
  const [driver, setDriver] = useState<{ model: string; sandbox: string; storage: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [openSignal, setOpenSignal] = useState<{ path: string; nonce: number } | null>(null);
  // Unsaved-changes nav guard (Batch 4): pending in-app navigation target.
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const router = useRouter();
  // Start at defaults for SSR determinism; hydrate persisted widths after mount.
  const [cols, setCols] = useState<ColWidths>({ chat: CHAT_DEFAULT, code: CODE_DEFAULT });
  // Chat history (Batch 2): which conversation the chat is bound to, whether the
  // history rail is open, and a key bumped to force the list to reload.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);

  const selectConversation = useCallback((id: string) => {
    setConversationId(id);
    setHistoryOpen(false);
  }, []);

  const onConversationCreated = useCallback((id: string) => {
    setConversationId(id);
    setHistoryRefresh((k) => k + 1);
  }, []);

  useEffect(() => {
    setCols(loadCols());
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/files`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files ?? []);
      }
    } catch {
      /* ignore — keep the last good list */
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Native guard: warn on tab close / reload / external nav while edits are dirty.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // In-app guard: the header's Dashboard link routes through requestGuardedNav.
  // Clean → navigate immediately; dirty → confirm via UnsavedChangesModal.
  useEffect(() => {
    function onNav(e: Event) {
      const href = (e as CustomEvent<NavGuardDetail>).detail?.href;
      if (!href) return;
      if (dirty) setPendingHref(href);
      else router.push(href);
    }
    window.addEventListener(NAV_GUARD_EVENT, onNav as EventListener);
    return () => window.removeEventListener(NAV_GUARD_EVENT, onNav as EventListener);
  }, [dirty, router]);

  const hasGame = files.includes("index.html");

  // ── ⌘K project-scoped commands (only while the build page is mounted) ──────
  const openFileInCode = useCallback((path: string) => {
    setOpenSignal({ path, nonce: Date.now() });
  }, []);

  const projectCommands = useMemo<Command[]>(() => {
    const base: Command[] = [
      {
        id: "project.publish",
        group: "project",
        label: t("palette.cmd.publish"),
        icon: <Rocket />,
        run: requestPublish,
      },
      {
        id: "project.focusChat",
        group: "project",
        label: t("palette.cmd.focusChat"),
        icon: <Upload />,
        run: requestFocusChat,
      },
    ];
    // One "open file" command per project file (jumps to the Code tab).
    const fileCmds: Command[] = files.map((path) => ({
      id: `file:${path}`,
      group: "files",
      label: t("palette.cmd.openFile", { name: path }),
      icon: <FileCode />,
      keywords: path,
      run: () => openFileInCode(path),
    }));
    return [...base, ...fileCmds];
  }, [t, files, openFileInCode]);

  useRegisterCommands(`build:${projectId}`, projectCommands);

  // ── Column resize (pointer drag) ──────────────────────────────────────
  const dragRef = useRef<{ edge: "chat" | "code"; startX: number; startW: number } | null>(null);

  const persistCols = useCallback((next: ColWidths) => {
    try {
      localStorage.setItem(COLS_LS_KEY, JSON.stringify(next));
    } catch {
      /* storage disabled — resize still applies for this session */
    }
  }, []);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const delta = e.clientX - d.startX;
      setCols((prev) =>
        d.edge === "chat"
          ? // dragging the LEFT divider widens/narrows chat directly
            { ...prev, chat: clamp(d.startW + delta, CHAT_MIN, CHAT_MAX) }
          : // dragging the RIGHT divider: moving right shrinks code (it's right-anchored)
            { ...prev, code: clamp(d.startW - delta, CODE_MIN, CODE_MAX) },
      );
    }
    function onUp() {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      setCols((cur) => {
        persistCols(cur);
        return cur;
      });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [persistCols]);

  const startDrag = (edge: "chat" | "code") => (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = {
      edge,
      startX: e.clientX,
      startW: edge === "chat" ? cols.chat : cols.code,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
    <div
      className="grid min-h-0 flex-1"
      style={{ gridTemplateColumns: `${cols.chat}px 6px 1fr 6px ${cols.code}px` }}
    >
      {/* Chat (with a collapsible conversation-history rail overlaid on top) */}
      <section className="relative flex min-h-0 flex-col overflow-hidden">
        <PaneHeader
          icon={<MessageSquare className="size-4" />}
          title={t("workspace.chat")}
          action={
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto size-7 text-muted-foreground"
              onClick={() => setHistoryOpen((v) => !v)}
              title={t("conversations.history")}
              aria-label={t("conversations.history")}
              aria-pressed={historyOpen}
            >
              <History className="size-4" />
            </Button>
          }
        />
        <div className="min-h-0 flex-1">
          <BuildChat
            projectId={projectId}
            conversationId={conversationId}
            onFilesChanged={refresh}
            onConversationCreated={onConversationCreated}
            onModelChange={setModelId}
            onDriverChange={setDriver}
          />
        </div>

        {historyOpen ? (
          <>
            <button
              type="button"
              className="absolute inset-0 z-10 cursor-default bg-foreground/5"
              aria-label={t("conversations.collapse")}
              onClick={() => setHistoryOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 z-20 flex w-72 max-w-[90%] flex-col border-r bg-background shadow-xl">
              <ConversationList
                projectId={projectId}
                conversationId={conversationId}
                onSelect={selectConversation}
                onCollapse={() => setHistoryOpen(false)}
                refreshKey={historyRefresh}
              />
            </div>
          </>
        ) : null}
      </section>

      {/* Resize: chat | preview */}
      <Divider edge="chat" label={t("workspace.resizeChat")} onPointerDown={startDrag("chat")} />

      {/* Preview (flexible center) */}
      <section className="flex min-h-0 flex-col overflow-hidden border-x">
        <PlayPane projectId={projectId} hasGame={hasGame} />
      </section>

      {/* Resize: preview | code */}
      <Divider edge="code" label={t("workspace.resizePreview")} onPointerDown={startDrag("code")} />

      {/* Tabbed editor (Code | Scene | Data | Assets) */}
      <section className="flex min-h-0 flex-col overflow-hidden">
        <EditorPanel
          projectId={projectId}
          files={files}
          onRefresh={refresh}
          loading={loading}
          onDirtyChange={setDirty}
          openSignal={openSignal}
        />
      </section>
    </div>

      {/* Slim builder status bar (Batch 4) */}
      <StatusBar projectName={projectName} modelId={modelId} driver={driver} dirty={dirty} />

      <UnsavedChangesModal
        open={pendingHref !== null}
        onOpenChange={(o) => !o && setPendingHref(null)}
        fileName={t("tab.code")}
        onDiscard={() => {
          const href = pendingHref;
          setPendingHref(null);
          if (href) router.push(href);
        }}
      />
    </div>
  );
}

function PaneHeader({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-sm font-medium">
      <span className="text-muted-foreground">{icon}</span>
      {title}
      {action}
    </div>
  );
}

/** A draggable vertical divider with a soft hover affordance (studio-style). */
function Divider({
  edge,
  label,
  onPointerDown,
}: {
  edge: "chat" | "code";
  label: string;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      className="group relative cursor-col-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      data-edge={edge}
    >
      <div className="absolute inset-y-0 -left-px -right-px transition-colors group-hover:bg-border" />
    </div>
  );
}
