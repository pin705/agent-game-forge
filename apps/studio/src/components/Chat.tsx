import { useCallback, useEffect, useRef, useState } from 'react';
import { Flame, Send, Square, Loader2, Pencil, Terminal, Image as ImageIcon, Sparkles, Wrench, AlertTriangle, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import {
  cancelRun,
  createRun,
  fetchActiveRun,
  fetchConversations,
  formatFormAnswers,
  subscribeRun,
  type AgentEvent,
  type QuestionForm,
  type QuestionFormAnswers,
  type ReasoningEffort,
} from '@/lib/runs';
import { QuestionFormCard } from '@/components/QuestionFormCard';
import { Markdown } from '@/components/Markdown';
import { useSettings } from '@/lib/settings';
import { useT, type TKey } from '@/lib/i18n';

type TFn = (key: TKey, vars?: Record<string, string | number>) => string;

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

export function Chat({ projectPath, initialPrompt, conversationId }: ChatProps) {
  const [turns, setTurns] = useState<UiTurn[]>([]);
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedForms, setSubmittedForms] = useState<Set<string>>(() => new Set());
  const { agentId, model, reasoning } = useSettings();
  const t = useT();

  const conversationIdRef = useRef<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const runUnsubRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoSentRef = useRef(false);

  const closeRunSub = useCallback(() => {
    if (runUnsubRef.current) {
      runUnsubRef.current();
      runUnsubRef.current = null;
    }
  }, []);

  // Tear down the SSE stream on unmount.
  useEffect(() => () => closeRunSub(), [closeRunSub]);

  // Auto-scroll the transcript to the bottom as turns / events stream in.
  useEffect(() => {
    const el = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]');
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

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
          runIdRef.current = null;
        } else if (e.type === 'end') {
          const status: TurnStatus =
            e.data.status === 'succeeded' ? 'done' : e.data.status === 'canceled' ? 'canceled' : 'failed';
          finalizeLastTurn(status);
          setRunning(false);
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

      setPrompt('');
      setError(null);
      setTurns((s) => [...s, { id: cryptoRandomId(), userText: text, events: [], status: 'streaming' }]);
      setRunning(true);

      try {
        const r = await createRun({
          agentId,
          model,
          reasoning: reasoning as ReasoningEffort | undefined,
          prompt: text,
          projectPath,
          conversationId: conversationIdRef.current ?? undefined,
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
        runIdRef.current = null;
      }
    },
    [prompt, running, projectPath, agentId, model, reasoning, subscribeToRun, finalizeLastTurn],
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
    runIdRef.current = null;
  }, []);

  // On mount: resume any in-flight run for the latest conversation, then
  // auto-send the initial prompt exactly once if one was provided.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let targetId = conversationId ?? null;
        if (!targetId) {
          const { conversations } = await fetchConversations(projectPath);
          targetId = conversations[0]?.id ?? null;
        }
        if (targetId && !cancelled) {
          conversationIdRef.current = targetId;
          const active = await fetchActiveRun(targetId).catch(() => ({ active: false }) as const);
          if (!cancelled && active.active) {
            runIdRef.current = active.runId;
            setRunning(true);
            subscribeToRun(active.runId);
          }
        }
      } catch {
        // No daemon / no conversations yet — first send() creates one.
      }
      if (!cancelled && initialPrompt && initialPrompt.trim() && !autoSentRef.current) {
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
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <span className="text-sm font-medium">{t('chat.title')}</span>
        {running ? (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="size-3 animate-spin" />
            {t('chat.working')}
          </Badge>
        ) : null}
      </div>

      <ScrollArea ref={scrollRef} className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          {turns.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('chat.empty')}
            </p>
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

      <div className="border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              const t = e.target;
              t.style.height = 'auto';
              t.style.height = Math.min(t.scrollHeight, 160) + 'px';
            }}
            onKeyDown={onKey}
            rows={1}
            placeholder={t('chat.placeholder')}
            className="max-h-40 min-h-[40px] resize-none"
          />
          {running ? (
            <Button size="icon" variant="secondary" onClick={() => void stop()} title={t('chat.stop')}>
              <Square />
            </Button>
          ) : (
            <Button size="icon" onClick={() => void send()} disabled={!prompt.trim()} title={t('chat.send')}>
              <Send />
            </Button>
          )}
        </div>
      </div>
    </div>
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
    <div className="space-y-3">
      {/* User bubble — right-aligned */}
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-xl bg-primary/15 px-3 py-2 text-sm">
          {turn.userText}
        </div>
      </div>

      {/* Assistant bubble — left-aligned with avatar */}
      <div className="flex gap-2">
        <Avatar className="mt-0.5 size-6">
          <AvatarFallback className="bg-primary text-primary-foreground">
            <Flame className="size-3" />
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 space-y-2">
          {blocks.length === 0 && streaming ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
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

// Collapsible tool call (Claude/Cursor-style): summary row + expandable
// input/output. Long output is capped + scrolls inside its own box.
function ToolCard({ family, items, streaming }: { family: ToolFamily; items: ToolItem[]; streaming: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const Icon = familyIcon(family);
  const running = streaming && items.some((it) => it.output === undefined);
  const anyError = items.some((it) => it.isError);
  const detail = chipDetail(family, items, t);

  return (
    <div className={cn('overflow-hidden rounded-lg border bg-card/60', anyError && 'border-destructive/40')}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-accent/40"
      >
        {running ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
        ) : (
          <Icon className={cn('size-3.5 shrink-0', anyError ? 'text-destructive' : 'text-muted-foreground')} />
        )}
        <span className="shrink-0 font-medium">{familyLabel(family, items, t)}</span>
        {detail ? <span className="min-w-0 truncate text-muted-foreground">{detail}</span> : null}
        {running ? <span className="ml-auto shrink-0 text-primary">{t('chat.running')}</span> : null}
        <ChevronRight
          className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', running ? '' : 'ml-auto', open && 'rotate-90')}
        />
      </button>
      {open ? (
        <div className="space-y-2 border-t bg-muted/20 p-2.5">
          {items.map((it) => {
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
                      'max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2 font-mono text-[11px] leading-relaxed',
                      it.isError && 'text-destructive',
                    )}
                  >
                    {clamp(it.output, 4000)}
                  </pre>
                ) : running ? (
                  <div className="text-[11px] text-primary">{t('chat.running')}</div>
                ) : null}
              </div>
            );
          })}
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
