import { spawn, type ChildProcess } from 'node:child_process';
import type { AgentEvent, ReasoningEffort } from '@ogf/contracts';

export interface CodexRunOptions {
  bin: string;
  cwd: string;
  prompt: string;
  model?: string;
  reasoning?: ReasoningEffort;
  /** If set, resumes that Codex session instead of starting a new thread. */
  resumeThreadId?: string;
  env?: NodeJS.ProcessEnv;
}

export function buildCodexArgs(
  cwd: string,
  model?: string,
  reasoning?: ReasoningEffort,
  resumeThreadId?: string,
): string[] {
  // exec resume <session_id> reuses an existing rollout. Same flag set otherwise.
  const head = resumeThreadId
    ? ['exec', 'resume', resumeThreadId]
    : ['exec'];

  const tail = [
    '--json',
    '--skip-git-repo-check',
    '--full-auto',
    '-c',
    'sandbox_workspace_write.network_access=true',
  ];

  if (!resumeThreadId) {
    // -C is only valid on the base `exec` form; resume reuses the original cwd.
    tail.push('-C', cwd);
  }

  if (model && model !== 'default') {
    tail.push('--model', model);
  }
  if (reasoning) {
    tail.push('-c', `model_reasoning_effort="${reasoning}"`);
  }
  tail.push('-');
  return [...head, ...tail];
}

export function spawnCodex(opts: CodexRunOptions): ChildProcess {
  const { bin, cwd, prompt, model, reasoning, resumeThreadId, env } = opts;
  const args = buildCodexArgs(cwd, model, reasoning, resumeThreadId);
  const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);

  const child = spawn(bin, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: useShell,
    windowsHide: true,
  });

  if (child.stdin) {
    child.stdin.end(prompt, 'utf8');
  }

  return child;
}

interface CodexJsonEvent {
  type?: string;
  msg?: {
    type?: string;
    text?: string;
    command?: string;
    [k: string]: unknown;
  };
  item?: {
    id?: string;
    type?: string;
    text?: string;
    command?: string;
    aggregated_output?: string;
    output?: string;
    exit_code?: number;
    status?: string;
    changes?: { path?: string; kind?: string }[];
    [k: string]: unknown;
  };
  thread_id?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cached_input_tokens?: number;
  };
  [k: string]: unknown;
}

export function extractThreadId(raw: CodexJsonEvent): string | null {
  if (raw.type === 'thread.started' && typeof raw.thread_id === 'string') {
    return raw.thread_id;
  }
  return null;
}

export function mapCodexEvent(raw: CodexJsonEvent): AgentEvent | null {
  const t = raw.type;

  if (t === 'thread.started') {
    return { type: 'status', label: 'initializing' };
  }
  if (t === 'turn.started') {
    return { type: 'status', label: 'running' };
  }

  if (t === 'item.started' && raw.item) {
    const itemType = raw.item.type;
    if (itemType === 'command_execution') {
      return {
        type: 'tool_use',
        id: String(raw.item.id ?? Math.random()),
        name: 'Bash',
        input: { command: raw.item.command ?? '' },
      };
    }
    if (itemType === 'file_change') {
      return {
        type: 'tool_use',
        id: String(raw.item.id ?? Math.random()),
        name: 'Edit',
        input: { changes: raw.item.changes ?? [] },
      };
    }
    // Image generation (built-in image_gen tool). The Codex CLI emits an
    // item with prompt + size on start; completed gives us the saved file
    // path(s). We capture whatever we can — the frontend reads input.prompt
    // for the head summary, and waits on tool_result for the image path
    // before rendering the preview.
    if (itemType === 'image_generation' || itemType === 'image_gen') {
      const prompt = String(raw.item.prompt ?? '');
      const size = String(raw.item.size ?? '');
      return {
        type: 'tool_use',
        id: String(raw.item.id ?? Math.random()),
        name: 'image_gen',
        input: { prompt, size, raw: raw.item },
      };
    }
    // Generic MCP / built-in tool calls we don't have a special view for.
    // Surface them so the user at least sees what's happening.
    if (itemType === 'mcp_tool_call') {
      const name = String(
        (raw.item as { tool_name?: string; name?: string; tool?: string })
          .tool_name ??
          (raw.item as { tool_name?: string; name?: string }).name ??
          (raw.item as { tool?: string }).tool ??
          'mcp',
      );
      const args = (raw.item as { arguments?: unknown }).arguments ?? raw.item;
      return {
        type: 'tool_use',
        id: String(raw.item.id ?? Math.random()),
        name,
        input: args,
      };
    }
  }

  if (t === 'item.completed' && raw.item) {
    const itemType = raw.item.type;
    if (itemType === 'command_execution') {
      const exit = raw.item.exit_code;
      const output = String(raw.item.aggregated_output ?? raw.item.output ?? '');
      return {
        type: 'tool_result',
        toolUseId: String(raw.item.id ?? ''),
        content: output,
        isError: typeof exit === 'number' && exit !== 0,
      };
    }
    if (itemType === 'file_change') {
      const changes = raw.item.changes ?? [];
      return {
        type: 'tool_result',
        toolUseId: String(raw.item.id ?? ''),
        content: JSON.stringify(changes),
        isError: false,
      };
    }
    if (itemType === 'agent_message') {
      return { type: 'text_delta', delta: String(raw.item.text ?? '') };
    }
    if (itemType === 'reasoning') {
      const text = String(raw.item.text ?? '').trim();
      return text
        ? { type: 'tool_use', id: String(raw.item.id ?? ''), name: 'Thinking', input: { text } }
        : null;
    }
    // image_gen result. Different Codex versions emit different field names
    // for the saved file(s). Collect every plausible candidate; the
    // frontend probes for any of these and renders the first match. We
    // serialize as JSON so frontend has structured access to all hints.
    if (itemType === 'image_generation' || itemType === 'image_gen') {
      const item = raw.item as {
        image_paths?: string[];
        output_path?: string;
        path?: string;
        file?: string;
        files?: string[];
        url?: string;
      };
      const paths: string[] = [];
      if (Array.isArray(item.image_paths)) paths.push(...item.image_paths);
      if (Array.isArray(item.files)) paths.push(...item.files);
      if (typeof item.output_path === 'string') paths.push(item.output_path);
      if (typeof item.path === 'string') paths.push(item.path);
      if (typeof item.file === 'string') paths.push(item.file);
      const payload = {
        paths,
        url: typeof item.url === 'string' ? item.url : undefined,
        raw: raw.item,
      };
      return {
        type: 'tool_result',
        toolUseId: String(raw.item.id ?? ''),
        content: JSON.stringify(payload),
        isError: false,
      };
    }
    if (itemType === 'mcp_tool_call') {
      const result = (raw.item as { result?: unknown }).result;
      return {
        type: 'tool_result',
        toolUseId: String(raw.item.id ?? ''),
        content: typeof result === 'string' ? result : JSON.stringify(result ?? raw.item),
        isError: !!(raw.item as { is_error?: boolean }).is_error,
      };
    }
  }

  if (t === 'turn.completed' && raw.usage) {
    return {
      type: 'usage',
      usage: {
        input: raw.usage.input_tokens,
        output: raw.usage.output_tokens,
        cachedRead: raw.usage.cached_input_tokens,
      },
    };
  }

  if (t === 'turn.failed' || t === 'error') {
    const msg =
      (raw as { error?: { message?: string }; message?: string }).error?.message ??
      (raw as { message?: string }).message ??
      'turn failed';
    return {
      type: 'tool_result',
      toolUseId: 'turn',
      content: typeof msg === 'string' ? msg : JSON.stringify(msg),
      isError: true,
    };
  }

  return { type: 'raw', raw };
}

export interface JsonlParserCallbacks {
  onEvent: (e: AgentEvent) => void;
  onThreadId?: (id: string) => void;
}

export function createJsonlParser(cb: JsonlParserCallbacks) {
  let buf = '';

  function consume(line: string) {
    if (!line) return;
    try {
      const obj = JSON.parse(line) as CodexJsonEvent;
      const tid = extractThreadId(obj);
      if (tid) cb.onThreadId?.(tid);
      const ev = mapCodexEvent(obj);
      if (ev) cb.onEvent(ev);
    } catch {
      cb.onEvent({ type: 'raw', raw: line });
    }
  }

  return {
    feed(chunk: Buffer | string) {
      buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        consume(buf.slice(0, nl).trim());
        buf = buf.slice(nl + 1);
      }
    },
    flush() {
      const tail = buf.trim();
      buf = '';
      consume(tail);
    },
  };
}
