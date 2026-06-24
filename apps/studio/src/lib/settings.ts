// Settings store for the studio app: agent CLI + per-CLI model/reasoning
// memory (persisted to localStorage, mirroring apps/web/src/App.tsx), plus a
// thin client for the daemon's secrets + gen-image-cost endpoints (proxied at
// /api → :7621, same routes apps/web/src/lib/api.ts uses).
//
// The studio app deliberately does NOT depend on @ogf/contracts (see
// lib/runs.ts) — the wire types below are re-declared locally to match
// packages/contracts/src/api.ts.

import { useCallback, useEffect, useRef, useState } from 'react';

// -------------------- Types (mirror @ogf/contracts/api.ts) --------------------

export type AgentId = 'codex' | 'claude-code';
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/** Provider keys this UI exposes. The daemon also knows 'anthropic_api_key',
 *  but Claude Code authenticates via its own CLI login — only the two
 *  image-gen providers (Gemini, OpenAI) need keys entered here. */
export type SecretProvider = 'gemini' | 'openai';
export type SecretKey =
  | 'gemini_api_key'
  | 'openai_api_key'
  | 'anthropic_api_key'
  | 'cloudflare_api_token'
  | 'cloudflare_account_id';

export interface SecretStatus {
  key: SecretKey;
  /** True when a value resolves (env or file). */
  set: boolean;
  /** True when an env var (OPENAI_API_KEY etc.) shadows the file. */
  fromEnv: boolean;
  /** Masked display ("sk-•••••••a1b2"). Empty string when unset. */
  masked: string;
  /** Env var name that shadows this key — shown in UI as a hint. */
  envVarName: string;
}

export interface SecretsResponse {
  secrets: SecretStatus[];
}

export interface GenImageSummaryRow {
  provider: SecretProvider;
  count: number;
  okCount: number;
  errorCount: number;
  estCostUsd: number;
}

export interface GenImageSummary {
  windowMs: number;
  totalCount: number;
  totalEstCostUsd: number;
  byProvider: GenImageSummaryRow[];
}

export const PROVIDER_TO_SECRET_KEY: Record<SecretProvider, SecretKey> = {
  gemini: 'gemini_api_key',
  openai: 'openai_api_key',
};

// -------------------- localStorage keys --------------------
// Distinct from the web app's `ogf:` keys so the two frontends don't fight
// over the same values, while keeping the same per-CLI memory shape.

const LS_AGENT = 'ogf-studio:agent';
const LS_MODEL_BY_AGENT = 'ogf-studio:modelByAgent'; // { codex: 'gpt-5.5', 'claude-code': 'default' }
const LS_REASONING_BY_AGENT = 'ogf-studio:reasoningByAgent'; // { codex: 'xhigh', ... }

const REASONING_VALUES: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh'];

// Sensible per-CLI defaults (match apps/web/src/App.tsx bootstrap values).
const DEFAULT_MODEL: Record<AgentId, string> = {
  codex: 'gpt-5.5',
  'claude-code': 'default',
};
const DEFAULT_REASONING: ReasoningEffort = 'xhigh';

function isAgentId(v: unknown): v is AgentId {
  return v === 'codex' || v === 'claude-code';
}

function readJsonMap(key: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeJsonMap(key: string, map: Record<string, string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    /* quota / disabled storage — silently no-op */
  }
}

// -------------------- useSettings hook --------------------

export interface SettingsState {
  agentId: AgentId;
  setAgentId: (a: AgentId) => void;
  model?: string;
  setModel: (m: string) => void;
  reasoning?: string;
  setReasoning: (r: string) => void;
}

/**
 * Tiny settings store. Holds the active agent CLI plus that CLI's last-picked
 * model + reasoning. Switching CLIs swaps in the values previously saved for
 * the new CLI (so a Codex `gpt-5.5` selection doesn't leak into Claude Code,
 * which would fail the next run with "model not found" — the exact bug the web
 * app's per-agent memory was added to fix).
 *
 * Persists to localStorage. Multiple components calling this hook stay in sync
 * via a window event, so a header `<SettingsButton/>` and a composer model
 * picker observe the same state.
 */
export function useSettings(): SettingsState {
  const [agentId, setAgentIdState] = useState<AgentId>(() => {
    const v = localStorage.getItem(LS_AGENT);
    return isAgentId(v) ? v : 'codex';
  });

  const readModel = useCallback((id: AgentId): string => {
    const map = readJsonMap(LS_MODEL_BY_AGENT);
    return map[id] ?? DEFAULT_MODEL[id];
  }, []);
  const readReasoning = useCallback((id: AgentId): ReasoningEffort => {
    const map = readJsonMap(LS_REASONING_BY_AGENT);
    const v = map[id];
    return REASONING_VALUES.includes(v as ReasoningEffort)
      ? (v as ReasoningEffort)
      : DEFAULT_REASONING;
  }, []);

  const [model, setModelState] = useState<string>(() => readModel(agentId));
  const [reasoning, setReasoningState] = useState<ReasoningEffort>(() =>
    readReasoning(agentId),
  );

  // Cross-component sync: any setter dispatches this event; every mounted
  // hook re-reads from localStorage. `internal` guards the dispatching
  // instance from redundantly re-reading what it just wrote.
  const internal = useRef(false);
  useEffect(() => {
    const onChange = () => {
      if (internal.current) {
        internal.current = false;
        return;
      }
      const a = localStorage.getItem(LS_AGENT);
      const nextAgent = isAgentId(a) ? a : 'codex';
      setAgentIdState(nextAgent);
      setModelState(readModel(nextAgent));
      setReasoningState(readReasoning(nextAgent));
    };
    window.addEventListener('ogf-studio:settings-changed', onChange);
    return () => window.removeEventListener('ogf-studio:settings-changed', onChange);
  }, [readModel, readReasoning]);

  const broadcast = useCallback(() => {
    internal.current = true;
    window.dispatchEvent(new Event('ogf-studio:settings-changed'));
  }, []);

  const setAgentId = useCallback(
    (a: AgentId) => {
      setAgentIdState(a);
      localStorage.setItem(LS_AGENT, a);
      // Load the new CLI's remembered model + reasoning so the dropdowns
      // (and the next run) use a value that CLI actually accepts.
      setModelState(readModel(a));
      setReasoningState(readReasoning(a));
      broadcast();
    },
    [readModel, readReasoning, broadcast],
  );

  const setModel = useCallback(
    (m: string) => {
      setModelState(m);
      const map = readJsonMap(LS_MODEL_BY_AGENT);
      map[agentId] = m;
      writeJsonMap(LS_MODEL_BY_AGENT, map);
      broadcast();
    },
    [agentId, broadcast],
  );

  const setReasoning = useCallback(
    (r: string) => {
      const next = REASONING_VALUES.includes(r as ReasoningEffort)
        ? (r as ReasoningEffort)
        : DEFAULT_REASONING;
      setReasoningState(next);
      const map = readJsonMap(LS_REASONING_BY_AGENT);
      map[agentId] = next;
      writeJsonMap(LS_REASONING_BY_AGENT, map);
      broadcast();
    },
    [agentId, broadcast],
  );

  return { agentId, setAgentId, model, setModel, reasoning, setReasoning };
}

// -------------------- Daemon secrets client --------------------

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json() as Promise<T>;
}
async function jpost<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json() as Promise<T>;
}

/** GET masked status for every secret. The raw key never reaches the client —
 *  only `set / masked / fromEnv`. */
export const getSecretsStatus = () => jget<SecretsResponse>('/api/secrets');

/** Save an image-gen provider's API key. Returns refreshed masked statuses. */
export const setSecret = (provider: SecretProvider, key: string) =>
  jpost<SecretsResponse>('/api/secrets', {
    key: PROVIDER_TO_SECRET_KEY[provider],
    value: key,
  });

/** Remove a provider's saved key (env-var override, if any, still applies). */
export const clearSecret = (provider: SecretProvider) =>
  jpost<SecretsResponse>('/api/secrets', {
    key: PROVIDER_TO_SECRET_KEY[provider],
    value: null,
  });

/** Save a secret by its raw key. The provider→key model only covers the two
 *  image-gen providers; this lets the UI set keys that have no provider entry
 *  (e.g. the Cloudflare publish creds). Returns refreshed masked statuses. */
export const setSecretKey = (key: SecretKey, value: string) =>
  jpost<SecretsResponse>('/api/secrets', { key, value });

/** Remove a secret by its raw key (env-var override, if any, still applies). */
export const clearSecretKey = (key: SecretKey) =>
  jpost<SecretsResponse>('/api/secrets', { key, value: null });

/** Gen-image call-count + heuristic-cost summary for the Settings panel.
 *  Resolves to null if the daemon doesn't expose the route (older builds). */
export async function getGenImageSummary(
  windowMs?: number,
): Promise<GenImageSummary | null> {
  try {
    return await jget<GenImageSummary>(
      `/api/gen-image/summary${windowMs ? `?windowMs=${windowMs}` : ''}`,
    );
  } catch {
    return null;
  }
}
