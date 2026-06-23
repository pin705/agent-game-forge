import { useCallback, useEffect, useRef, useState } from 'react';
import { Flame, Send, Square, Loader2, Pencil, Terminal, Image as ImageIcon, Sparkles, Wrench, AlertTriangle } from 'lucide-react';
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
  subscribeRun,
  type AgentEvent,
} from '@/lib/runs';

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
  | { kind: 'tool-group'; family: ToolFamily; items: ToolItem[] };

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
      // status / usage / form / raw: dropped for the v1 clean view.
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

function familyLabel(f: ToolFamily, items: ToolItem[]): string {
  if (f === 'edit') return 'Edited files';
  if (f === 'shell') return 'Ran command';
  if (f === 'thinking') return 'Thinking';
  if (f === 'image') return 'Generated image';
  return items[0]?.name ?? 'Tool';
}

function chipDetail(family: ToolFamily, items: ToolItem[]): string {
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
    if (changes.length > 1) return `${changes.length} files`;
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
}

export function Chat({ projectPath, initialPrompt }: ChatProps) {
  const [turns, setTurns] = useState<UiTurn[]>([]);
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
              ? 'Run stalled — the agent stopped emitting events for 5+ minutes.'
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
    [appendEventToLastTurn, finalizeLastTurn, closeRunSub],
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
          agentId: 'codex',
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
    [prompt, running, projectPath, subscribeToRun, finalizeLastTurn],
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
        const { conversations } = await fetchConversations(projectPath);
        const latest = conversations[0];
        if (latest && !cancelled) {
          conversationIdRef.current = latest.id;
          const active = await fetchActiveRun(latest.id).catch(() => ({ active: false }) as const);
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
        <span className="text-sm font-medium">Assistant</span>
        {running ? (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="size-3 animate-spin" />
            Working
          </Badge>
        ) : null}
      </div>

      <ScrollArea ref={scrollRef} className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          {turns.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Describe a change and the Assistant will build it.
            </p>
          ) : null}

          {turns.map((t) => (
            <TurnView key={t.id} turn={t} />
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
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            placeholder="Describe a change…"
            className="max-h-40 min-h-[40px] resize-none"
          />
          {running ? (
            <Button size="icon" variant="secondary" onClick={() => void stop()} title="Stop">
              <Square />
            </Button>
          ) : (
            <Button size="icon" onClick={() => void send()} disabled={!prompt.trim()} title="Send">
              <Send />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function TurnView({ turn }: { turn: UiTurn }) {
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
              Thinking…
            </div>
          ) : null}

          {blocks.map((b, i) =>
            b.kind === 'text' ? (
              <div key={i} className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {b.text}
              </div>
            ) : (
              <ToolChip key={i} family={b.family} items={b.items} streaming={streaming} />
            ),
          )}

          {turn.status !== 'streaming' ? <StatusLine status={turn.status} /> : null}
        </div>
      </div>
    </div>
  );
}

function ToolChip({ family, items, streaming }: { family: ToolFamily; items: ToolItem[]; streaming: boolean }) {
  const Icon = familyIcon(family);
  const running = streaming && items.some((it) => it.output === undefined);
  const anyError = items.some((it) => it.isError);
  const detail = chipDetail(family, items);

  return (
    <div
      className={cn(
        'inline-flex max-w-full items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-xs',
        anyError && 'border-destructive/40',
      )}
    >
      {running ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
      ) : (
        <Icon className={cn('size-3.5 shrink-0', anyError ? 'text-destructive' : 'text-muted-foreground')} />
      )}
      <span className="font-medium">{familyLabel(family, items)}</span>
      {detail ? <span className="truncate text-muted-foreground">{detail}</span> : null}
      {running ? <span className="shrink-0 text-primary">running…</span> : null}
    </div>
  );
}

function StatusLine({ status }: { status: TurnStatus }) {
  const map: Record<TurnStatus, string> = {
    streaming: 'Working…',
    done: 'Done',
    failed: 'Failed',
    canceled: 'Stopped',
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
