"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Coins,
  Cpu,
  FileText,
  Loader2,
  Paperclip,
  Send,
  Sparkles,
  Terminal,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { MODEL_OPTIONS, modelOption } from "@/lib/agent/catalog";
import { readDefaultModel, writeDefaultModel } from "@/lib/prefs";
import { Markdown } from "@/components/markdown";
import { QuestionFormCard, type FormAnswers } from "@/components/question-form-card";
import { useT, type TKey } from "@/lib/i18n";
import {
  fetchConversations,
  fetchMessages,
  uploadRefImage,
  type MessageDTO,
} from "@/lib/conversations/client";
import { formatFormAnswers } from "@/lib/agent/forms";
import { FOCUS_CHAT_EVENT } from "@/lib/command-palette";
import type { QuestionForm } from "@/lib/agent/events";

type TFn = (key: TKey, vars?: Record<string, string | number>) => string;

/** Cap on reference images attached to a single composer message. */
const MAX_REFS = 6;

/** Mirror of lib/agent/events.ts RunEvent (kept local so the client has no server import). */
type RunEvent =
  | { type: "run_start"; runId: string; sandboxId: string; model: string; conversationId: string | null; driver: { sandbox: string; storage: string; model: string } }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string }
  | { type: "file_write"; path: string; bytes: number }
  | { type: "shell"; cmd: string; code: number; stdoutPreview: string }
  | { type: "question"; id: string; form: QuestionForm }
  | { type: "step"; index: number; inputTokens: number; outputTokens: number }
  | { type: "done"; inputTokens: number; outputTokens: number; steps: number; files: string[]; status?: "complete" | "awaiting_input" }
  | { type: "charge"; credits: number; balanceAfter: number | null }
  | { type: "error"; message: string }
  // A non-streamed marker persisted on the user turn to record attached refs.
  | { type: "refs"; paths: string[] };

type TurnStatus = "streaming" | "done" | "failed";

/** One conversation turn: a user message + the assistant's streamed events. */
type UiTurn = {
  id: string;
  userText: string;
  /** Reference-image paths attached to this user message (for the thumbnail row). */
  refPaths: string[];
  events: RunEvent[];
  status: TurnStatus;
};

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

function isImageFile(f: File): boolean {
  if (f.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name);
}

function refBasename(relPath: string): string {
  return relPath.replace(/\\/g, "/").split("/").pop() || relPath;
}

/**
 * Rebuild the transcript from persisted messages so an existing conversation
 * shows its history on mount / refresh. A user message starts a turn; the next
 * assistant message's events attach to it. Ported from studio's rebuildTurns.
 */
function rebuildTurns(messages: MessageDTO[]): UiTurn[] {
  const ordered = [...messages].sort((a, b) => a.position - b.position);
  const turns: UiTurn[] = [];
  for (const m of ordered) {
    if (m.role === "user") {
      const refEv = (m.events as RunEvent[] | null)?.find((e) => e.type === "refs");
      turns.push({
        id: `m${m.id}`,
        userText: m.content ?? "",
        refPaths: refEv && refEv.type === "refs" ? refEv.paths : [],
        events: [],
        status: "done",
      });
    } else if (m.role === "assistant") {
      if (turns.length === 0)
        turns.push({ id: `m${m.id}`, userText: "", refPaths: [], events: [], status: "done" });
      const last = turns[turns.length - 1];
      const evs = (m.events as RunEvent[] | null) ?? (m.content ? [{ type: "text_delta", text: m.content } as RunEvent] : []);
      last.events = [...last.events, ...evs];
      // A persisted turn that ended awaiting input stays "done" in history.
    }
  }
  return turns;
}

/** Live "Working" elapsed timer (ticks once a second). Ported from studio. */
function RunTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const label = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
  return <span className="tabular-nums opacity-80">{label}</span>;
}

export function BuildChat({
  projectId,
  conversationId,
  onFilesChanged,
  onConversationCreated,
  onModelChange,
  onDriverChange,
}: {
  projectId: string;
  /** When set, binds to a specific conversation; else the latest one. */
  conversationId?: string | null;
  onFilesChanged: () => void;
  /** Fired when a run creates a brand-new conversation (so the list refreshes). */
  onConversationCreated?: (id: string) => void;
  /** Reports the active build-model id (Batch 4 status bar). */
  onModelChange?: (id: string) => void;
  /** Reports the live run driver (sandbox/storage/model) once a run starts. */
  onDriverChange?: (driver: { model: string; sandbox: string; storage: string } | null) => void;
}) {
  const t = useT();
  const [turns, setTurns] = useState<UiTurn[]>([]);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [meta, setMeta] = useState<{ model: string; sandbox: string; storage: string } | null>(null);
  const [submittedForms, setSubmittedForms] = useState<Set<string>>(() => new Set());
  const [refPaths, setRefPaths] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // SSR-safe: start at the first enabled model on the server + first client
  // render, then hydrate the persisted default-model pref after mount (mirrors
  // the i18n/theme/cols pattern). Changing the model persists it as the default.
  const [model, setModelState] = useState<string>(
    () => MODEL_OPTIONS.find((m) => m.enabled)?.id ?? "deepseek-chat",
  );
  useEffect(() => {
    const id = readDefaultModel();
    setModelState(id);
    onModelChange?.(id);
  }, [onModelChange]);
  const setModel = useCallback(
    (id: string) => {
      setModelState(id);
      writeDefaultModel(id);
      onModelChange?.(id);
    },
    [onModelChange],
  );

  const conversationIdRef = useRef<string | null>(conversationId ?? null);
  // Guards the one-shot onboarding auto-send (?idea=…): set the moment we fire
  // (or decide not to) so a re-render / refresh can never double-send.
  const autoSentRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragDepthRef = useRef(0);

  // ⌘K "Focus chat" command → focus the composer textarea.
  useEffect(() => {
    function onFocus() {
      textareaRef.current?.focus();
    }
    window.addEventListener(FOCUS_CHAT_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_CHAT_EVENT, onFocus);
  }, []);

  // Auto-scroll the transcript as turns / events stream in.
  useEffect(() => {
    const el = scrollRef.current?.querySelector("[data-radix-scroll-area-viewport]");
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, running]);

  const appendEventToLastTurn = useCallback((ev: RunEvent) => {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const last = { ...next[next.length - 1] };
      last.events = [...last.events, ev];
      next[next.length - 1] = last;
      return next;
    });
  }, []);

  const finalizeLastTurn = useCallback((status: TurnStatus) => {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      next[next.length - 1] = { ...next[next.length - 1], status };
      return next;
    });
  }, []);

  // ── Attachments ───────────────────────────────────────────────────────────
  const addFiles = useCallback(
    async (files: File[] | FileList) => {
      if (uploading) return;
      const images = Array.from(files).filter(isImageFile);
      if (images.length === 0) {
        toast.error(t("dropzone.dropFiles"));
        return;
      }
      let slots = 0;
      setRefPaths((cur) => {
        slots = MAX_REFS - cur.length;
        return cur;
      });
      if (slots <= 0) {
        toast.error(t("dropzone.limit", { max: MAX_REFS }));
        return;
      }
      const accepted = images.slice(0, slots);
      setUploading(true);
      const added: string[] = [];
      try {
        for (const file of accepted) added.push(await uploadRefImage(projectId, file));
        setRefPaths((cur) => [...cur, ...added].slice(0, MAX_REFS));
        toast.success(
          added.length === 1 ? t("dropzone.refAdded") : t("dropzone.refsAdded", { n: added.length }),
        );
      } catch (err) {
        toast.error(t("dropzone.uploadFailed", { error: err instanceof Error ? err.message : String(err) }));
      } finally {
        setUploading(false);
      }
    },
    [projectId, uploading, t],
  );

  const removeRef = useCallback((relPath: string) => {
    setRefPaths((cur) => cur.filter((p) => p !== relPath));
  }, []);

  const hasFiles = (e: DragEvent<HTMLDivElement>) =>
    Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const onDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragOver(true);
  }, []);
  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
  }, []);
  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  }, []);
  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragDepthRef.current = 0;
      setDragOver(false);
      if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  // ── Run a turn (stream SSE) ─────────────────────────────────────────────────
  const send = useCallback(
    async (overridePrompt?: string, attachedRefs?: string[]) => {
      const text = (overridePrompt ?? prompt).trim();
      if (!text || running) return;
      if (uploading) {
        toast.error(t("dropzone.uploading"));
        return;
      }

      const refImagePaths = attachedRefs ?? (refPaths.length > 0 ? refPaths : undefined);

      setPrompt("");
      setRefPaths([]);
      setError(null);
      setRunning(true);
      setRunStartedAt(Date.now());
      setTurns((s) => [
        ...s,
        { id: cryptoRandomId(), userText: text, refPaths: refImagePaths ?? [], events: [], status: "streaming" },
      ]);

      const hadConversation = conversationIdRef.current !== null;

      try {
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            prompt: text,
            model,
            conversationId: conversationIdRef.current ?? undefined,
            refImagePaths,
          }),
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          const msg =
            res.status === 402
              ? err.message ?? "Out of credits — top up to continue."
              : err.message ?? err.error ?? "run failed";
          setError(msg);
          finalizeLastTurn("failed");
          setRunning(false);
          setRunStartedAt(null);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            let ev: RunEvent;
            try {
              ev = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            handleEvent(ev);
          }
        }
        finalizeLastTurn("done");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        finalizeLastTurn("failed");
      } finally {
        setRunning(false);
        setRunStartedAt(null);
        onFilesChanged();
      }

      function handleEvent(ev: RunEvent) {
        switch (ev.type) {
          case "run_start":
            setMeta(ev.driver);
            onDriverChange?.(ev.driver);
            if (ev.conversationId) {
              const isNew = conversationIdRef.current === null;
              conversationIdRef.current = ev.conversationId;
              if (isNew && !hadConversation) onConversationCreated?.(ev.conversationId);
            }
            break;
          case "text_delta":
          case "tool_result":
          case "shell":
          case "file_write":
          case "question":
          case "charge":
            appendEventToLastTurn(ev);
            if (ev.type === "file_write") onFilesChanged();
            break;
          case "done":
            appendEventToLastTurn(ev);
            onFilesChanged();
            break;
          case "error":
            setError(ev.message);
            break;
        }
      }
    },
    [prompt, running, uploading, refPaths, projectId, model, appendEventToLastTurn, finalizeLastTurn, onFilesChanged, onConversationCreated, onDriverChange, t],
  );

  // Keep a stable handle to the latest `send` so the mount effect (which must
  // NOT depend on `send` — its deps include `prompt`, so re-running it on every
  // keystroke would wipe the in-progress transcript) can fire the onboarding
  // auto-send without re-subscribing.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const onSubmitForm = useCallback(
    (formId: string, answers: FormAnswers) => {
      setSubmittedForms((prev) => new Set(prev).add(formId));
      // The answers become the next user turn; a follow-up run resumes the agent.
      void send(formatFormAnswers(formId, answers), []);
    },
    [send],
  );

  // ── Mount / conversation switch: load history (no auto-run) ──────────────────
  //
  // Onboarding auto-send: the dashboard "create" flow redirects here with a
  // `?idea=<text>` query param. On mount we send that idea as the FIRST user
  // turn — but ONLY for a brand-new project (no existing conversation/messages)
  // and exactly once (autoSentRef + history.replaceState clears the param so a
  // refresh never re-fires). A project that already has history NEVER auto-sends.
  useEffect(() => {
    // The parent flips `conversationId` null→<newId> the moment a run creates a
    // conversation (onConversationCreated). That's the SAME conversation this
    // component is already streaming into — re-running the reset+reload here
    // would wipe the in-flight turn (and its assistant transcript) mid-stream.
    // Skip when the incoming id already matches what the stream adopted.
    if (conversationId != null && conversationId === conversationIdRef.current) {
      return;
    }
    let cancelled = false;
    conversationIdRef.current = conversationId ?? null;
    setTurns([]);
    setError(null);
    (async () => {
      let hadHistory = false;
      try {
        let targetId = conversationId ?? null;
        if (!targetId) {
          const { conversations } = await fetchConversations(projectId);
          targetId = conversations[0]?.id ?? null;
        }
        if (targetId && !cancelled) {
          conversationIdRef.current = targetId;
          const { messages } = await fetchMessages(targetId).catch(() => ({ messages: [] as MessageDTO[] }));
          if (messages.length) hadHistory = true;
          if (!cancelled && messages.length) setTurns(rebuildTurns(messages));
        }
      } catch {
        // No conversations yet — the first send() creates one. Never auto-fire.
      }
      if (cancelled || autoSentRef.current) return;
      // Only the latest-conversation binding (no explicit conversationId) is a
      // fresh-project onboarding context. Read + immediately strip ?idea=.
      if (conversationId == null && !hadHistory) {
        const params = new URLSearchParams(window.location.search);
        const idea = params.get("idea")?.trim();
        if (idea) {
          autoSentRef.current = true;
          params.delete("idea");
          const qs = params.toString();
          window.history.replaceState(
            null,
            "",
            window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
          );
          void sendRef.current(idea, []);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, conversationId]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea ref={scrollRef} className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {turns.length === 0 && !running ? (
            <div className="px-1 py-6 text-center text-xs text-muted-foreground">
              <p className="font-medium text-foreground">{t("chat.empty.title")}</p>
              <p className="mt-1">{t("chat.empty.body")}</p>
            </div>
          ) : null}

          {turns.map((turn) => (
            <TurnView
              key={turn.id}
              turn={turn}
              projectId={projectId}
              submittedForms={submittedForms}
              onSubmitForm={onSubmitForm}
              t={t}
            />
          ))}

          {running ? (
            <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t("chat.working")} {runStartedAt != null ? <RunTimer startedAt={runStartedAt} /> : null}
              {meta ? (
                <span className="ml-auto opacity-70">
                  {meta.model} · {meta.sandbox} · {meta.storage}
                </span>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <div className="shrink-0 p-3">
        <div className="mb-2 flex items-center gap-2">
          <ModelPicker value={model} onChange={setModel} disabled={running} />
        </div>
        <div
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={cn(
            "relative rounded-xl border border-input bg-background px-3 py-2 shadow-sm transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25",
            dragOver && "border-ring/60 bg-accent/40 ring-2 ring-ring/30",
          )}
        >
          {(refPaths.length > 0 || uploading) && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {refPaths.map((relPath) => (
                <div
                  key={relPath}
                  title={refBasename(relPath)}
                  className="group relative size-11 shrink-0 overflow-hidden rounded-md border bg-muted/40"
                >
                  <img
                    src={`/build/${projectId}/preview/${relPath}`}
                    alt={refBasename(relPath)}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeRef(relPath)}
                    title={t("dropzone.remove")}
                    aria-label={t("dropzone.remove")}
                    className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-foreground/70 text-background opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
              {uploading && (
                <div className="flex size-11 shrink-0 items-center justify-center rounded-md border border-dashed text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                </div>
              )}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKey}
            placeholder={t("chat.placeholder")}
            rows={2}
            disabled={running}
            className="max-h-40 w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          <div className="mt-1.5 flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || refPaths.length >= MAX_REFS}
              aria-label={t("dropzone.addReference")}
              title={t("dropzone.addReference")}
            >
              <Paperclip className="size-3.5" />
            </Button>
            <span className="flex-1" />
            {uploading ? (
              <span className="mr-1 shrink-0 text-[11px] text-muted-foreground">{t("dropzone.uploading")}</span>
            ) : null}
            <Button
              size="icon"
              className="size-7 shrink-0"
              onClick={() => void send()}
              disabled={running || !prompt.trim() || uploading}
              title={t("chat.send")}
            >
              {running ? <Loader2 className="animate-spin" /> : <Send className="size-3.5" />}
            </Button>
          </div>

          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-accent/55 text-xs font-medium text-foreground">
              {t("dropzone.dropImages")}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** Compact model selector for the composer (unchanged from Batch 1). */
function ModelPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const selected = modelOption(value) ?? MODEL_OPTIONS[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <Cpu className="size-3.5" />
        <span className="font-medium text-foreground/80">{selected.label}</span>
        <span className="opacity-70" title="Rough relative credit weighting">
          ~{selected.creditWeight}×
        </span>
        <ChevronDown className="size-3 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-muted-foreground">Build model</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {MODEL_OPTIONS.map((m) => (
          <DropdownMenuItem
            key={m.id}
            disabled={!m.enabled}
            onSelect={(e) => {
              if (!m.enabled) {
                e.preventDefault();
                return;
              }
              onChange(m.id);
            }}
            className="flex items-start gap-2"
          >
            <Check
              className={
                m.id === value && m.enabled ? "mt-0.5 size-3.5 opacity-100" : "mt-0.5 size-3.5 opacity-0"
              }
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{m.label}</span>
                <span className="text-[10px] tabular-nums text-muted-foreground">~{m.creditWeight}×</span>
              </span>
              <span className="block text-xs text-muted-foreground">{m.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Render a single turn: user bubble (+ ref thumbnails) then the assistant
 *  events collapsed into markdown text, tool chips, and any question form. */
function TurnView({
  turn,
  projectId,
  submittedForms,
  onSubmitForm,
  t,
}: {
  turn: UiTurn;
  projectId: string;
  submittedForms: Set<string>;
  onSubmitForm: (formId: string, answers: FormAnswers) => void;
  t: TFn;
}) {
  const streaming = turn.status === "streaming";

  // Collapse the event stream into ordered render blocks: contiguous text is
  // merged into one markdown block; tools/files/shell/forms render inline.
  const blocks: Array<
    | { kind: "text"; text: string }
    | { kind: "tool"; name: string; ok: boolean; summary: string }
    | { kind: "shell"; cmd: string; code: number }
    | { kind: "file"; path: string }
    | { kind: "form"; form: QuestionForm }
    | { kind: "done"; inputTokens: number; outputTokens: number; steps: number; awaiting: boolean }
    | { kind: "charge"; credits: number; balanceAfter: number | null }
  > = [];
  let textBuf = "";
  const flush = () => {
    if (textBuf) {
      blocks.push({ kind: "text", text: textBuf });
      textBuf = "";
    }
  };
  for (const ev of turn.events) {
    switch (ev.type) {
      case "text_delta":
        textBuf += ev.text;
        break;
      case "tool_result":
        flush();
        blocks.push({ kind: "tool", name: ev.name, ok: ev.ok, summary: ev.summary });
        break;
      case "shell":
        flush();
        blocks.push({ kind: "shell", cmd: ev.cmd, code: ev.code });
        break;
      case "file_write":
        flush();
        blocks.push({ kind: "file", path: ev.path });
        break;
      case "question":
        flush();
        blocks.push({ kind: "form", form: ev.form });
        break;
      case "done":
        flush();
        blocks.push({
          kind: "done",
          inputTokens: ev.inputTokens,
          outputTokens: ev.outputTokens,
          steps: ev.steps,
          awaiting: ev.status === "awaiting_input",
        });
        break;
      case "charge":
        flush();
        blocks.push({ kind: "charge", credits: ev.credits, balanceAfter: ev.balanceAfter });
        break;
      default:
        break;
    }
  }
  flush();

  return (
    <div className="space-y-2">
      {turn.userText ? (
        <div className="flex flex-col items-end gap-1">
          {turn.refPaths.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-1.5">
              {turn.refPaths.map((p) => (
                <img
                  key={p}
                  src={`/build/${projectId}/preview/${p}`}
                  alt={refBasename(p)}
                  title={refBasename(p)}
                  className="size-12 rounded-md border object-cover"
                />
              ))}
            </div>
          ) : null}
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[11px_11px_3px_11px] bg-primary px-3 py-1.5 text-[13px] leading-snug text-primary-foreground">
            {turn.userText}
          </div>
        </div>
      ) : null}

      <div className="min-w-0 space-y-1.5 text-sm leading-normal">
        {blocks.length === 0 && streaming ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Sparkles className="size-4 shrink-0 animate-pulse" />
            {t("chat.thinking")}
          </div>
        ) : null}

        {blocks.map((b, i) => {
          switch (b.kind) {
            case "text":
              return <Markdown key={i} text={b.text} />;
            case "form":
              return (
                <QuestionFormCard
                  key={i}
                  form={b.form}
                  locked={submittedForms.has(b.form.id)}
                  onSubmit={onSubmitForm}
                />
              );
            case "tool":
              return (
                <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  {b.ok ? (
                    <Wrench className="mt-0.5 size-3.5 text-emerald-600" />
                  ) : (
                    <XCircle className="mt-0.5 size-3.5 text-destructive" />
                  )}
                  <span>
                    <span className="font-medium text-foreground/80">{b.name}</span> — {b.summary}
                  </span>
                </div>
              );
            case "shell":
              return (
                <div key={i} className="flex items-start gap-2 font-mono text-xs text-muted-foreground">
                  <Terminal className="mt-0.5 size-3.5" />
                  <span>
                    <span className="text-foreground/80">$ {b.cmd.slice(0, 80)}</span>{" "}
                    <span className={b.code === 0 ? "text-emerald-600" : "text-destructive"}>
                      (exit {b.code})
                    </span>
                  </span>
                </div>
              );
            case "file":
              return (
                <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileText className="size-3.5" />
                  <span className="font-mono">{b.path}</span>
                </div>
              );
            case "done":
              return b.awaiting ? (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                >
                  <Sparkles className="size-3.5" />
                  {t("chat.awaitingInput")}
                </div>
              ) : (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-md bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                >
                  <CheckCircle2 className="size-3.5" />
                  {t("chat.done", { steps: b.steps, tokens: b.inputTokens + b.outputTokens })}
                </div>
              );
            case "charge":
              return (
                <div key={i} className="flex items-center gap-2 px-1 text-xs text-muted-foreground tabular-nums">
                  <Coins className="size-3.5" />
                  <span>
                    −{b.credits} {b.credits === 1 ? t("chat.credit") : t("chat.credits")}
                    {b.balanceAfter !== null ? (
                      <span className="opacity-70"> · {t("chat.balance", { n: b.balanceAfter })}</span>
                    ) : null}
                  </span>
                </div>
              );
          }
        })}
      </div>
    </div>
  );
}
