// Shared model + reasoning option tables for the studio app.
//
// Both the Settings dialog (full Select pickers) and the chat composer (compact
// DropdownMenu pickers) read from here so they stay in lockstep. Fallbacks
// mirror apps/daemon/src/agents.ts `fallbackModels`; at mount `useAgentModels()`
// fetches /api/agents for the live list (so a daemon update surfaces without a
// code change), falling back to the static lists below when offline.

import { useEffect, useState } from 'react';
import type { AgentId, ReasoningEffort } from '@/lib/settings';

export interface ModelOption {
  id: string;
  label: string;
}

export const FALLBACK_MODELS: Record<AgentId, ModelOption[]> = {
  codex: [
    { id: 'default', label: 'Default · CLI default' },
    { id: 'gpt-5.5', label: 'gpt-5.5 · frontier coding' },
    { id: 'gpt-5.4', label: 'gpt-5.4 · everyday' },
    { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini · cheap & fast' },
    { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex · coding-tuned' },
    { id: 'gpt-5.3-codex-spark', label: 'gpt-5.3-codex-spark · ultra fast' },
    { id: 'gpt-5.2', label: 'gpt-5.2 · long-running agents' },
  ],
  'claude-code': [
    { id: 'default', label: 'Default · CLI default' },
    { id: 'claude-opus-4-7', label: 'Opus 4.7 · frontier' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 · everyday' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5 · cheap & fast' },
  ],
};

export const REASONING_OPTIONS: { id: ReasoningEffort; label: string }[] = [
  { id: 'minimal', label: 'Minimal · fastest' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high · most thorough' },
];

/** Short id for a model option, dropping any " · …" descriptor suffix so the
 *  composer trigger reads `gpt-5.5` rather than `gpt-5.5 · frontier coding`. */
export function shortModelLabel(idOrLabel: string): string {
  return idOrLabel.split('·')[0]!.trim();
}

/** Live model options for an agent — daemon list if loaded, else the static
 *  fallback. */
export function useAgentModels(): Record<AgentId, ModelOption[]> {
  const [models, setModels] = useState<Record<AgentId, ModelOption[]>>(FALLBACK_MODELS);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/agents')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { agents?: { id: AgentId; models?: ModelOption[] }[] }) => {
        if (cancelled || !data?.agents) return;
        const next = { ...FALLBACK_MODELS };
        for (const a of data.agents) {
          if ((a.id === 'codex' || a.id === 'claude-code') && a.models?.length) {
            next[a.id] = a.models;
          }
        }
        setModels(next);
      })
      .catch(() => {
        /* offline / older daemon — keep fallbacks */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return models;
}
