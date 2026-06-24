"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Coins,
  FileText,
  Loader2,
  Send,
  Terminal,
  Wrench,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

/** Mirror of lib/agent/events.ts RunEvent (kept local so the client has no server import). */
type RunEvent =
  | { type: "run_start"; runId: string; sandboxId: string; model: string; driver: { sandbox: string; storage: string; model: string } }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string }
  | { type: "file_write"; path: string; bytes: number }
  | { type: "shell"; cmd: string; code: number; stdoutPreview: string }
  | { type: "question"; id: string; payload: Record<string, unknown> }
  | { type: "step"; index: number; inputTokens: number; outputTokens: number }
  | { type: "done"; inputTokens: number; outputTokens: number; steps: number; files: string[] }
  | { type: "charge"; credits: number; balanceAfter: number | null }
  | { type: "error"; message: string };

type LogLine =
  | { kind: "user"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; ok: boolean; summary: string }
  | { kind: "shell"; cmd: string; code: number }
  | { kind: "file"; path: string }
  | { kind: "done"; inputTokens: number; outputTokens: number; steps: number }
  | { kind: "charge"; credits: number; balanceAfter: number | null }
  | { kind: "error"; text: string };

export function BuildChat({
  projectId,
  onFilesChanged,
}: {
  projectId: string;
  onFilesChanged: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [meta, setMeta] = useState<{ model: string; sandbox: string; storage: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [log]);

  const push = useCallback((line: LogLine) => setLog((l) => [...l, line]), []);

  const submit = useCallback(async () => {
    const p = prompt.trim();
    if (!p || running) return;
    setPrompt("");
    setRunning(true);
    setElapsed(0);
    push({ kind: "user", text: p });

    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, prompt: p }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        // 402: out of credits — surface the clear top-up message (P3 adds the
        // actual top-up flow).
        const text =
          res.status === 402
            ? err.message ?? "Out of credits — top up to continue."
            : err.message ?? err.error ?? "run failed";
        push({ kind: "error", text });
        setRunning(false);
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
    } catch (err) {
      push({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
      onFilesChanged();
    }

    function handleEvent(ev: RunEvent) {
      switch (ev.type) {
        case "run_start":
          setMeta(ev.driver);
          break;
        case "text_delta":
          push({ kind: "text", text: ev.text });
          break;
        case "tool_result":
          push({ kind: "tool", name: ev.name, ok: ev.ok, summary: ev.summary });
          break;
        case "shell":
          push({ kind: "shell", cmd: ev.cmd, code: ev.code });
          break;
        case "file_write":
          push({ kind: "file", path: ev.path });
          break;
        case "done":
          push({
            kind: "done",
            inputTokens: ev.inputTokens,
            outputTokens: ev.outputTokens,
            steps: ev.steps,
          });
          onFilesChanged();
          break;
        case "charge":
          push({ kind: "charge", credits: ev.credits, balanceAfter: ev.balanceAfter });
          break;
        case "error":
          push({ kind: "error", text: ev.message });
          break;
      }
    }
  }, [prompt, running, projectId, push, onFilesChanged]);

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="flex flex-col gap-2 p-3 text-sm">
          {log.length === 0 && (
            <div className="px-1 py-6 text-center text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Describe your game</p>
              <p className="mt-1">
                e.g. &ldquo;a tiny platformer with a player on two platforms&rdquo;. The agent
                builds it in a cloud sandbox and streams every step here.
              </p>
            </div>
          )}
          {log.map((line, i) => (
            <LogRow key={i} line={line} />
          ))}
          {running && (
            <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Working… {elapsed}s
              {meta && (
                <span className="ml-auto opacity-70">
                  {meta.model} · {meta.sandbox} · {meta.storage}
                </span>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t p-3">
        <div className="flex items-end gap-2 rounded-lg border border-input bg-background px-3 py-2 shadow-sm">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Message the agent…"
            rows={2}
            disabled={running}
            className="max-h-32 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          <Button size="icon" onClick={submit} disabled={running || !prompt.trim()} className="shrink-0">
            {running ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
      </div>
    </div>
  );
}

function LogRow({ line }: { line: LogLine }) {
  switch (line.kind) {
    case "user":
      return (
        <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-primary-foreground">
          {line.text}
        </div>
      );
    case "text":
      return <div className="max-w-[90%] text-foreground/90">{line.text}</div>;
    case "tool":
      return (
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          {line.ok ? (
            <Wrench className="mt-0.5 size-3.5 text-emerald-600" />
          ) : (
            <XCircle className="mt-0.5 size-3.5 text-destructive" />
          )}
          <span>
            <span className="font-medium text-foreground/80">{line.name}</span> — {line.summary}
          </span>
        </div>
      );
    case "shell":
      return (
        <div className="flex items-start gap-2 font-mono text-xs text-muted-foreground">
          <Terminal className="mt-0.5 size-3.5" />
          <span>
            <span className="text-foreground/80">$ {line.cmd.slice(0, 80)}</span>{" "}
            <span className={line.code === 0 ? "text-emerald-600" : "text-destructive"}>
              (exit {line.code})
            </span>
          </span>
        </div>
      );
    case "file":
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileText className="size-3.5" />
          <span className="font-mono">{line.path}</span>
        </div>
      );
    case "done":
      return (
        <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="size-3.5" />
          Done · {line.steps} steps · {line.inputTokens + line.outputTokens} tokens
          <span className="opacity-70">
            ({line.inputTokens} in / {line.outputTokens} out)
          </span>
        </div>
      );
    case "charge":
      return (
        <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground tabular-nums">
          <Coins className="size-3.5" />
          <span>
            &minus;{line.credits} {line.credits === 1 ? "credit" : "credits"}
            {line.balanceAfter !== null && (
              <span className="opacity-70"> · balance {line.balanceAfter}</span>
            )}
          </span>
        </div>
      );
    case "error":
      return (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
          <XCircle className="size-3.5" />
          {line.text}
        </div>
      );
  }
}
