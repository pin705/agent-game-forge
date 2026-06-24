import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Send, Square, Loader2, Pencil, Terminal, Image as ImageIcon, Sparkles, Wrench, AlertTriangle, ChevronRight, Check, ChevronDown, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  cancelRun,
  createRun,
  fetchActiveRun,
  fetchConversations,
  fetchMessages,
  formatFormAnswers,
  subscribeRun,
  uploadRefImage,
  type AgentEvent,
  type Message,
  type QuestionForm,
  type QuestionFormAnswers,
  type ReasoningEffort,
} from '@/lib/runs';
import { assetUrl } from '@/lib/assets';
import { QuestionFormCard } from '@/components/QuestionFormCard';
import { Markdown } from '@/components/Markdown';
import { useSettings } from '@/lib/settings';
import { REASONING_OPTIONS, shortModelLabel, useAgentModels } from '@/lib/models';
import { useT, type TKey } from '@/lib/i18n';

type TFn = (key: TKey, vars?: Record<string, string | number>) => string;

/** Cap on reference images attached to a single composer message (mirrors
 *  Dropzone's MAX_REFS). */
const MAX_REFS = 10;

function isImageFile(f: File): boolean {
  if (f.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name);
}

/** Last path segment, for the thumbnail tooltip. */
function refBasename(relPath: string): string {
  return relPath.replace(/\\/g, '/').split('/').pop() || relPath;
}

// ---------------------------------------------------------------------------
// Turn model + block builder (simplified port of apps/web/src/lib/blocks.ts).
// Collapses an AgentEvent stream into text blocks + same-family tool groups.
// ---------------------------------------------------------------------------

type TurnStatus = 'streaming' | 'done' | 'failed' | 'canceled';
type ToolFamily = 'edit' | 'shell' | 'thinking' | 'image' | 'other';

interface ToolItem {
  id: string;
  name: string;
  family: ToolFamily;
  input: unknown;
  output?: string;
  isError?: boolean;
}

type Block =
  | { kind: 'text'; text: string }
  | { kind: 'tool-group'; family: ToolFamily; items: ToolItem[] }
  | { kind: 'form'; form: QuestionForm };

interface UiTurn {
  id: string;
  userText: string;
  events: AgentEvent[];
  status: TurnStatus;
}

function familyOf(name: string): ToolFamily {
  if (name === 'Edit' || name === 'Write') return 'edit';
  if (name === 'Bash') return 'shell';
  if (name === 'Thinking') return 'thinking';
  if (/^image[_-]?(gen|generation)$/i.test(name)) return 'image';
  return 'other';
}

function buildBlocks(events: AgentEvent[]): Block[] {
  const blocks: Block[] = [];
  let textBuf = '';
  let group: { family: ToolFamily; items: ToolItem[] } | null = null;

  const flushText = () => {
    if (textBuf.length > 0) {
      blocks.push({ kind: 'text', text: textBuf });
      textBuf = '';
    }
  };
  const flushGroup = () => {
    if (group) {
      blocks.push({ kind: 'tool-group', family: group.family, items: group.items });
      group = null;
    }
  };
  const attachResult = (toolUseId: string, content: string, isError: boolean) => {
    if (group) {
      for (let i = group.items.length - 1; i >= 0; i--) {
        if (group.items[i].id === toolUseId) {
          group.items[i].output = content;
          group.items[i].isError = isError;
          return;
        }
      }
    }
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b.kind === 'tool-group') {
        for (let j = b.items.length - 1; j >= 0; j--) {
          if (b.items[j].id === toolUseId) {
            b.items[j].output = content;
            b.items[j].isError = isError;
            return;
          }
        }
      }
    }
  };

  for (const ev of events) {
    switch (ev.type) {
      case 'text_delta':
        flushGroup();
        textBuf += ev.delta;
        break;
      case 'tool_use': {
        flushText();
        const family = familyOf(ev.name);
        const item: ToolItem = { id: ev.id, name: ev.name, family, input: ev.input };
        if (group && group.family === family) {
          group.items.push(item);
        } else {
          flushGroup();
          group = { family, items: [item] };
        }
        break;
      }
      case 'tool_result':
        attachResult(ev.toolUseId, ev.content, ev.isError);
        break;
      case 'form':
        flushText();
        flushGroup();
        blocks.push({ kind: 'form', form: ev.form });
        break;
      // status / usage / raw: dropped for the v1 clean view.
      default:
        break;
    }
  }
  flushText();
  flushGroup();
  return blocks;
}

function familyIcon(f: ToolFamily) {
  if (f === 'edit') return Pencil;
  if (f === 'shell') return Terminal;
  if (f === 'thinking') return Sparkles;
  if (f === 'image') return ImageIcon;
  return Wrench;
}

function familyLabel(f: ToolFamily, items: ToolItem[], t: TFn): string {
  if (f === 'edit') return t('chat.tool.editedFiles');
  if (f === 'shell') return t('chat.tool.ranCommand');
  if (f === 'thinking') return t('chat.tool.thinking');
  if (f === 'image') return t('chat.tool.generatedImage');
  return items[0]?.name ?? t('chat.tool.fallback');
}

function chipDetail(family: ToolFamily, items: ToolItem[], t: TFn): string {
  if (family === 'shell') {
    const cmd = String((items[0]?.input as { command?: unknown })?.command ?? '');
    return cmd.length > 48 ? cmd.slice(0, 48) + '…' : cmd;
  }
  if (family === 'image') {
    const prompt = String((items[0]?.input as { prompt?: unknown })?.prompt ?? '');
    return prompt.length > 48 ? prompt.slice(0, 48) + '…' : prompt;
  }
  if (family === 'edit') {
    const changes = (items[0]?.input as { changes?: { path?: string }[] })?.changes ?? [];
    if (changes.length === 1 && changes[0].path) return shortPath(changes[0].path);
    if (changes.length > 1) return t('chat.tool.files', { n: changes.length });
  }
  return items.length > 1 ? `×${items.length}` : '';
}

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 2) return parts.join('/');
  return '…/' + parts.slice(-2).join('/');
}

// ---------------------------------------------------------------------------
// Chat panel
// ---------------------------------------------------------------------------

export interface ChatProps {
  projectPath: string;
  initialPrompt?: string;
  /** When set, this panel binds to a specific conversation (from the
   *  ConversationList). When undefined, it binds to the latest conversation. */
  conversationId?: string;
}

/** Rebuild the transcript from persisted messages so an existing / in-progress
 *  conversation shows its history on mount + refresh instead of starting blank.
 *  A user message starts a turn; the next agent message's events (or its text)
 *  attach to that turn. */
function rebuildTurns(messages: Message[]): UiTurn[] {
  const ordered = [...messages].sort((a, b) => a.position - b.position);
  const turns: UiTurn[] = [];
  for (const m of ordered) {
    if (m.role === 'user') {
      turns.push({ id: `m${m.id}`, userText: m.content, events: [], status: 'done' });
    } else {
      if (turns.length === 0) turns.push({ id: `m${m.id}`, userText: '', events: [], status: 'done' });
      const last = turns[turns.length - 1];
      const evs: AgentEvent[] =
        m.events && m.events.length ? m.events : m.content ? [{ type: 'text_delta', delta: m.content }] : [];
      last.events = [...last.events, ...evs];
    }
  }
  return turns;
}

/** Live "Working" elapsed timer (ticks once a second). */
function RunTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const label = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
  return <span className="tabular-nums opacity-80">{label}</span>;
}

export function Chat({ projectPath, initialPrompt, conversationId }: ChatProps) {
  const [turns, setTurns] = useState<UiTurn[]>([]);
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedForms, setSubmittedForms] = useState<Set<string>>(() => new Set());
  // Reference images attached to the *next* message — project-relative paths
  // returned by uploadRefImage(). Cleared after each successful send().
  const [refPaths, setRefPaths] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // Epoch ms the active run started (for the "Working …" elapsed timer). Null
  // when idle. Set from the run start on send, or from the daemon's startedAt on
  // resume.
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const { agentId, model, reasoning } = useSettings();
  const t = useT();

  const conversationIdRef = useRef<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const runUnsubRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoSentRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  // Depth counter so nested dragenter/dragleave (over children) don't flicker
  // the drag-over highlight off prematurely.
  const dragDepthRef = useRef(0);

  const closeRunSub = useCallback(() => {
    if (runUnsubRef.current) {
      runUnsubRef.current();
      runUnsubRef.current = null;
    }
  }, []);

  // Upload dropped / picked image files to the project's ref store, appending
  // the returned relPaths to the composer attachments (capped at MAX_REFS).
  const addFiles = useCallback(
    async (files: File[] | FileList) => {
      if (!projectPath || uploading) return;

      const images = Array.from(files).filter(isImageFile);
      if (images.length === 0) {
        toast.error(t('dropzone.dropFiles'));
        return;
      }

      // Read remaining slots from the latest state (avoids a stale closure
      // when several drops land in quick succession).
      let slots = 0;
      setRefPaths((current) => {
        slots = MAX_REFS - current.length;
        return current;
      });
      if (slots <= 0) {
        toast.error(t('dropzone.limit', { max: MAX_REFS }));
        return;
      }
      const accepted = images.slice(0, slots);

      setUploading(true);
      const added: string[] = [];
      try {
        for (const file of accepted) {
          added.push(await uploadRefImage(projectPath, file));
        }
        setRefPaths((current) => [...current, ...added].slice(0, MAX_REFS));
        toast.success(
          added.length === 1 ? t('dropzone.refAdded') : t('dropzone.refsAdded', { n: added.length }),
        );
      } catch (err) {
        toast.error(
          t('dropzone.uploadFailed', { error: err instanceof Error ? err.message : String(err) }),
        );
      } finally {
        setUploading(false);
      }
    },
    [projectPath, uploading, t],
  );

  const removeRef = useCallback((relPath: string) => {
    setRefPaths((current) => current.filter((p) => p !== relPath));
  }, []);

  // Drag-and-drop over the composer card. A depth counter keeps the highlight
  // stable while the cursor moves across child nodes.
  const onDragEnter = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!projectPath) return;
      if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setDragOver(true);
    },
    [projectPath],
  );
  const onDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!projectPath) return;
      if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
      e.preventDefault();
    },
    [projectPath],
  );
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
      if (!projectPath) return;
      if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files);
    },
    [projectPath, addFiles],
  );

  // Tear down the SSE stream on unmount.
  useEffect(() => () => closeRunSub(), [closeRunSub]);

  // Auto-scroll the transcript to the bottom as turns / events stream in.
  useEffect(() => {
    const el = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]');
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  // Keep the composer textarea's height in sync with its content. Keying off
  // `prompt` (not just onChange) means a programmatic clear on send — or setting
  // the initialPrompt — also resets the height, instead of the box staying tall
  // and empty after sending.
  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [prompt]);

  const appendEventToLastTurn = useCallback((ev: AgentEvent) => {
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

  const subscribeToRun = useCallback(
    (runId: string) => {
      closeRunSub();
      runUnsubRef.current = subscribeRun(runId, (e) => {
        if (e.type === 'agent') {
          appendEventToLastTurn(e.data);
        } else if (e.type === 'error') {
          const msg =
            e.data.reason === 'stalled'
              ? t('chat.stalled')
              : e.data.message;
          setError(msg);
          finalizeLastTurn('failed');
          setRunning(false);
          setRunStartedAt(null);
          runIdRef.current = null;
        } else if (e.type === 'end') {
          const status: TurnStatus =
            e.data.status === 'succeeded' ? 'done' : e.data.status === 'canceled' ? 'canceled' : 'failed';
          finalizeLastTurn(status);
          setRunning(false);
          setRunStartedAt(null);
          runIdRef.current = null;
        }
      });
    },
    [appendEventToLastTurn, finalizeLastTurn, closeRunSub, t],
  );

  const send = useCallback(
    async (overridePrompt?: string) => {
      const text = (overridePrompt ?? prompt).trim();
      if (!text || running || !projectPath) return;
      // Don't fire a run while attachments are still uploading.
      if (uploading) {
        toast.error(t('dropzone.uploading'));
        return;
      }

      // Snapshot + clear attachments so the next message starts fresh.
      const refImagePaths = refPaths.length > 0 ? refPaths : undefined;

      setPrompt('');
      setRefPaths([]);
      setError(null);
      setTurns((s) => [...s, { id: cryptoRandomId(), userText: text, events: [], status: 'streaming' }]);
      setRunning(true);
      setRunStartedAt(Date.now());

      try {
        const r = await createRun({
          agentId,
          model,
          reasoning: reasoning as ReasoningEffort | undefined,
          prompt: text,
          projectPath,
          conversationId: conversationIdRef.current ?? undefined,
          refImagePaths,
        });

        if ('duplicate' in r) {
          runIdRef.current = r.existingRunId;
          subscribeToRun(r.existingRunId);
          return;
        }

        runIdRef.current = r.runId;
        conversationIdRef.current = r.conversationId;
        subscribeToRun(r.runId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        finalizeLastTurn('failed');
        setRunning(false);
        setRunStartedAt(null);
        runIdRef.current = null;
      }
    },
    [prompt, running, projectPath, uploading, refPaths, agentId, model, reasoning, subscribeToRun, finalizeLastTurn, t],
  );

  const onSubmitForm = useCallback(
    (a: QuestionFormAnswers) => {
      setSubmittedForms((prev) => new Set(prev).add(a.formId));
      void send(formatFormAnswers(a));
    },
    [send],
  );

  const stop = useCallback(async () => {
    const id = runIdRef.current;
    if (id) {
      try {
        await cancelRun(id);
      } catch {
        /* run already ended — fall through and clear UI state anyway */
      }
    }
    setRunning(false);
    setRunStartedAt(null);
    runIdRef.current = null;
  }, []);

  // On mount / refresh / conversation switch: rebuild the transcript from
  // persisted history, resume any in-flight run (keep streaming + show Working),
  // and auto-send the initial idea ONLY for a brand-new project (no conversation
  // yet) — never on refresh of an existing one (that re-fired "Working" before).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let hadConversation = false;
      try {
        let targetId = conversationId ?? null;
        if (!targetId) {
          const { conversations } = await fetchConversations(projectPath);
          targetId = conversations[0]?.id ?? null;
        }
        if (targetId && !cancelled) {
          hadConversation = true;
          conversationIdRef.current = targetId;
          // 1) Replay persisted history so the chat isn't blank on entry/F5.
          const { messages } = await fetchMessages(targetId).catch(() => ({ messages: [] as Message[] }));
          if (!cancelled && messages.length) setTurns(rebuildTurns(messages));
          // 2) Re-attach to an in-flight run so it keeps streaming + shows Working.
          const active = await fetchActiveRun(targetId).catch(() => ({ active: false }) as const);
          if (!cancelled && active.active) {
            runIdRef.current = active.runId;
            setRunStartedAt(active.startedAt ?? Date.now());
            setRunning(true);
            // Ensure the streaming run has a turn to append to + mark it live.
            setTurns((prev) => {
              if (prev.length === 0)
                return [{ id: cryptoRandomId(), userText: '', events: [], status: 'streaming' }];
              const next = [...prev];
              next[next.length - 1] = { ...next[next.length - 1], status: 'streaming' };
              return next;
            });
            subscribeToRun(active.runId);
          }
        }
      } catch {
        // No daemon / no conversations yet — first send() creates one.
      }
      if (!cancelled && !hadConversation && initialPrompt && initialPrompt.trim() && !autoSentRef.current) {
        autoSentRef.current = true;
        void send(initialPrompt);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only: projectPath identifies this panel; send/subscribeToRun are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2.5 bg-muted/20 px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">{t('chat.title')}</span>
        {running ? (
          <Badge variant="secondary" className="ml-auto gap-1">
            <Loader2 className="size-3 animate-spin" />
            {t('chat.working')}
            {runStartedAt != null ? <RunTimer startedAt={runStartedAt} /> : null}
          </Badge>
        ) : null}
      </div>

      <ScrollArea ref={scrollRef} className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {turns.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="size-4 shrink-0" />
              {t('chat.empty')}
            </div>
          ) : null}

          {turns.map((turn) => (
            <TurnView
              key={turn.id}
              turn={turn}
              projectPath={projectPath}
              submittedForms={submittedForms}
              onSubmitForm={onSubmitForm}
            />
          ))}

          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <div className="shrink-0 p-3">
        <div
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={cn(
            'relative rounded-xl border bg-background px-3 py-2 shadow-sm transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25',
            dragOver && 'border-ring/60 bg-accent/40 ring-2 ring-ring/30',
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
                    src={assetUrl(projectPath, relPath)}
                    alt={refBasename(relPath)}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeRef(relPath)}
                    title={t('dropzone.remove')}
                    aria-label={t('dropzone.remove')}
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

          <Textarea
            ref={promptRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            placeholder={t('chat.placeholder')}
            className="max-h-40 min-h-[24px] w-full resize-none border-0 bg-transparent p-0 text-[13px] shadow-none focus-visible:ring-0"
          />
          <div className="mt-1.5 flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => fileInputRef.current?.click()}
              disabled={!projectPath || uploading || refPaths.length >= MAX_REFS}
              aria-label={t('dropzone.addReference')}
              title={!projectPath ? t('dropzone.openProject') : t('dropzone.addReference')}
            >
              <Paperclip className="size-3.5" />
            </Button>
            <ComposerControls />
            <span className="flex-1" />
            {uploading ? (
              <span className="mr-1 shrink-0 text-[11px] text-muted-foreground">{t('dropzone.uploading')}</span>
            ) : null}
            {running ? (
              <Button size="icon" variant="ghost" className="size-7 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => void stop()} title={t('chat.stop')}>
                <Square className="size-3.5" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="size-7 shrink-0"
                onClick={() => void send()}
                disabled={!prompt.trim() || uploading}
                title={t('chat.send')}
              >
                <Send className="size-3.5" />
              </Button>
            )}
          </div>

          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-accent/55 text-xs font-medium text-foreground">
              {t('dropzone.dropImages')}
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
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** Compact, quiet model + reasoning pickers for the composer action row.
 *  Reads/writes the same `useSettings()` store the header dialog uses, so a
 *  change here live-updates Settings (and vice versa). Reasoning is Codex-only,
 *  mirroring the Settings dialog. */
function ComposerControls() {
  const t = useT();
  const { agentId, model, setModel, reasoning, setReasoning } = useSettings();
  const modelsByAgent = useAgentModels();
  const models = modelsByAgent[agentId] ?? [];

  // Prefer the option's label (drops the " · …" descriptor); fall back to the
  // raw model id when the persisted value isn't in this agent's list.
  const activeModel = models.find((m) => m.id === model);
  const modelText = activeModel
    ? shortModelLabel(activeModel.label)
    : model
      ? shortModelLabel(model)
      : t('settings.model.placeholder');

  const activeReasoning = REASONING_OPTIONS.find((r) => r.id === reasoning);
  const reasoningText = shortModelLabel(activeReasoning?.label ?? reasoning ?? '');

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('settings.model')}
            title={t('settings.model')}
            className="h-7 max-w-[10rem] gap-1 px-1.5 text-xs font-normal text-muted-foreground hover:text-foreground"
          >
            <span className="truncate font-mono">{modelText}</span>
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
          {models.map((m) => (
            <DropdownMenuItem
              key={m.id}
              onSelect={() => setModel(m.id)}
              className="gap-2 font-mono text-xs"
            >
              <Check className={cn('size-3.5', m.id === model ? 'opacity-100' : 'opacity-0')} />
              <span className="truncate">{m.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {agentId === 'codex' ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('settings.reasoning')}
              title={t('settings.reasoning')}
              className="h-7 max-w-[8rem] gap-1 px-1.5 text-xs font-normal text-muted-foreground hover:text-foreground"
            >
              <span className="truncate">{reasoningText}</span>
              <ChevronDown className="size-3 shrink-0 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {REASONING_OPTIONS.map((r) => (
              <DropdownMenuItem
                key={r.id}
                onSelect={() => setReasoning(r.id)}
                className="gap-2 text-xs"
              >
                <Check className={cn('size-3.5', r.id === reasoning ? 'opacity-100' : 'opacity-0')} />
                <span className="truncate">{r.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}

function TurnView({
  turn,
  projectPath,
  submittedForms,
  onSubmitForm,
}: {
  turn: UiTurn;
  projectPath: string;
  submittedForms: Set<string>;
  onSubmitForm: (a: QuestionFormAnswers) => void;
}) {
  const t = useT();
  const blocks = buildBlocks(turn.events);
  const streaming = turn.status === 'streaming';

  return (
    <div className="space-y-2">
      {/* User message — right-aligned, solid high-contrast bubble with tail */}
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[11px_11px_3px_11px] bg-foreground px-3 py-1.5 text-[13px] leading-snug text-background">
          {turn.userText}
        </div>
      </div>

      {/* Assistant — flush prose, no avatar / rail (web style) */}
      <div className="min-w-0 space-y-1.5 text-sm leading-normal">
        {blocks.length === 0 && streaming ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-foreground" />
            {t('chat.thinking')}
          </div>
        ) : null}

        {blocks.map((b, i) =>
          b.kind === 'text' ? (
            <Markdown key={i} text={b.text} />
          ) : b.kind === 'form' ? (
            <QuestionFormCard
              key={i}
              form={b.form}
              projectPath={projectPath}
              locked={submittedForms.has(b.form.id)}
              onSubmit={onSubmitForm}
            />
          ) : (
            <ToolCard key={i} family={b.family} items={b.items} streaming={streaming} />
          ),
        )}

        {turn.status !== 'streaming' ? <StatusLine status={turn.status} /> : null}
      </div>
    </div>
  );
}

function toolInputText(it: ToolItem): string {
  const inp = it.input as Record<string, unknown> | undefined;
  if (it.family === 'shell') return String(inp?.command ?? '');
  if (it.family === 'image') return String(inp?.prompt ?? '');
  if (it.family === 'edit') {
    const ch = (inp?.changes as { path?: string }[] | undefined) ?? [];
    return ch.map((c) => c.path).filter(Boolean).join('\n');
  }
  try {
    return JSON.stringify(it.input, null, 2);
  } catch {
    return String(it.input ?? '');
  }
}

function clamp(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '\n…(truncated)' : s;
}

// Per-family colored icon chip (matches the web app's edit=purple / shell=green
// / thinking=blue / image=accent palette, mapped onto the dark studio theme).
function familyChip(f: ToolFamily): string {
  if (f === 'edit') return 'bg-violet-500/15 text-violet-400';
  if (f === 'shell') return 'bg-emerald-500/15 text-emerald-400';
  if (f === 'thinking') return 'bg-sky-500/15 text-sky-400';
  if (f === 'image') return 'bg-amber-500/15 text-amber-400';
  return 'bg-muted text-muted-foreground';
}

function fileKind(kind: string): { label: string; cls: string } {
  if (kind === 'add') return { label: 'add', cls: 'bg-emerald-500/15 text-emerald-400' };
  if (kind === 'delete') return { label: 'del', cls: 'bg-rose-500/15 text-rose-400' };
  return { label: 'edit', cls: 'bg-amber-500/15 text-amber-400' };
}

// Collapsible tool call (Claude/Cursor-style): summary row + expandable
// input/output. Long output is capped + scrolls inside its own box.
function ToolCard({ family, items, streaming }: { family: ToolFamily; items: ToolItem[]; streaming: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const Icon = familyIcon(family);
  const running = streaming && items.some((it) => it.output === undefined);
  const anyError = items.some((it) => it.isError);
  const detail = chipDetail(family, items, t);

  // Flatten edit changes across grouped items so the body can render a
  // file list with add/edit/del badges instead of a raw JSON dump.
  const editChanges =
    family === 'edit'
      ? items.flatMap(
          (it) => ((it.input as { changes?: { path?: string; kind?: string }[] })?.changes ?? []),
        )
      : [];

  return (
    <div className={cn('overflow-hidden rounded-md bg-muted/40', anyError && 'bg-destructive/10')}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-accent/40"
      >
        <span className={cn('grid size-[18px] shrink-0 place-items-center rounded', familyChip(family))}>
          {running ? <Loader2 className="size-3 animate-spin" /> : <Icon className="size-3" />}
        </span>
        <span className="shrink-0 font-medium">{familyLabel(family, items, t)}</span>
        {detail ? <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{detail}</span> : null}
        {running ? <span className="ml-auto shrink-0 text-primary">{t('chat.running')}</span> : null}
        <ChevronRight
          className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', running ? '' : 'ml-auto', open && 'rotate-90')}
        />
      </button>
      {open ? (
        <div className="space-y-2 bg-muted/20 p-2.5">
          {editChanges.length > 0 ? (
            <ul className="space-y-1">
              {editChanges.map((c, i) => {
                const k = fileKind(c.kind ?? 'modify');
                return (
                  <li key={i} className="flex items-center gap-2 font-mono text-[11px]">
                    <span className={cn('min-w-9 rounded px-1.5 py-0.5 text-center text-[9px] uppercase tracking-wide', k.cls)}>
                      {k.label}
                    </span>
                    <code className="truncate text-muted-foreground" title={c.path}>
                      {shortPath(c.path ?? '')}
                    </code>
                  </li>
                );
              })}
            </ul>
          ) : (
            items.map((it) => {
              const input = toolInputText(it);
              return (
                <div key={it.id} className="min-w-0 space-y-1">
                  <div className="font-mono text-[11px] text-muted-foreground">{it.name}</div>
                  {input ? (
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2 font-mono text-[11px] leading-relaxed">
                      {clamp(input, 2000)}
                    </pre>
                  ) : null}
                  {it.output !== undefined ? (
                    <pre
                      className={cn(
                        'max-h-44 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-[11px] leading-relaxed',
                        it.isError && 'text-destructive',
                      )}
                    >
                      {clamp(it.output, 1600)}
                    </pre>
                  ) : running ? (
                    <div className="text-[11px] text-primary">{t('chat.running')}</div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

function StatusLine({ status }: { status: TurnStatus }) {
  const t = useT();
  const map: Record<TurnStatus, string> = {
    streaming: t('chat.status.streaming'),
    done: t('chat.status.done'),
    failed: t('chat.status.failed'),
    canceled: t('chat.status.canceled'),
  };
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={cn(
          'size-1.5 rounded-full',
          status === 'done' && 'bg-emerald-500',
          status === 'failed' && 'bg-destructive',
          status === 'canceled' && 'bg-muted-foreground',
        )}
      />
      {map[status]}
    </div>
  );
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}
