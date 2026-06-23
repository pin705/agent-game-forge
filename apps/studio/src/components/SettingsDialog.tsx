import { useCallback, useEffect, useState } from 'react';
import { Settings } from 'lucide-react';
import * as RadioGroup from '@radix-ui/react-radio-group';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  clearSecret,
  getGenImageSummary,
  getSecretsStatus,
  setSecret,
  useSettings,
  type AgentId,
  type GenImageSummary,
  type ReasoningEffort,
  type SecretKey,
  type SecretProvider,
  type SecretStatus,
} from '@/lib/settings';
import { cn } from '@/lib/utils';

// ── Model + reasoning option tables ──
// Fallbacks mirror apps/daemon/src/agents.ts `fallbackModels`. At mount we
// fetch /api/agents for the live list (so a daemon update surfaces here
// without a code change); the static lists below are the offline default.

interface ModelOption {
  id: string;
  label: string;
}

const FALLBACK_MODELS: Record<AgentId, ModelOption[]> = {
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

const REASONING_OPTIONS: { id: ReasoningEffort; label: string }[] = [
  { id: 'minimal', label: 'Minimal · fastest' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high · most thorough' },
];

const AGENTS: { id: AgentId; name: string; hint: string }[] = [
  { id: 'codex', name: 'Codex', hint: 'OpenAI · built-in image generation' },
  {
    id: 'claude-code',
    name: 'Claude Code',
    hint: 'Anthropic · images via daemon + your keys',
  },
];

const PROVIDERS: {
  provider: SecretProvider;
  key: SecretKey;
  label: string;
  hint: string;
  placeholder: string;
}[] = [
  {
    provider: 'gemini',
    key: 'gemini_api_key',
    label: 'Google Gemini',
    hint: 'Gemini 2.5 Flash Image (Nano Banana)',
    placeholder: 'AIza…',
  },
  {
    provider: 'openai',
    key: 'openai_api_key',
    label: 'OpenAI',
    hint: 'gpt-image-1 / gpt-image-2',
    placeholder: 'sk-…',
  },
];

/** Live model options for an agent — daemon list if loaded, else the static
 *  fallback. */
function useAgentModels(): Record<AgentId, ModelOption[]> {
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

function SecretRow({
  spec,
  status,
  onSaved,
}: {
  spec: (typeof PROVIDERS)[number];
  status: SecretStatus | undefined;
  onSaved: (next: SecretStatus[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const fromEnv = status?.fromEnv ?? false;
  const isSet = status?.set ?? false;

  async function save() {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      const r = await setSecret(spec.provider, draft.trim());
      onSaved(r.secrets);
      setDraft('');
    } finally {
      setBusy(false);
    }
  }
  async function clear() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await clearSecret(spec.provider);
      onSaved(r.secrets);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <Label className="text-sm">{spec.label}</Label>
        <span className="font-mono text-xs text-muted-foreground">{spec.hint}</span>
        <span className="flex-1" />
        {fromEnv ? (
          <Badge variant="secondary" title={`Shadowed by ${status?.envVarName}`}>
            env
          </Badge>
        ) : isSet ? (
          <Badge variant="outline" className="border-success/40 text-success">
            set
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            missing
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="password"
          autoComplete="off"
          className="font-mono"
          placeholder={
            fromEnv
              ? `(from ${status?.envVarName})`
              : isSet
                ? status?.masked
                : spec.placeholder
          }
          value={draft}
          disabled={fromEnv || busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
        />
        <Button size="sm" onClick={() => void save()} disabled={fromEnv || busy || !draft.trim()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {isSet && !fromEnv && (
          <Button size="sm" variant="ghost" onClick={() => void clear()} disabled={busy}>
            Clear
          </Button>
        )}
      </div>
      {fromEnv && (
        <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
          Override via <code>{status?.envVarName}</code>. Unset that env var to use a value
          saved here.
        </p>
      )}
    </div>
  );
}

function SettingsDialogBody() {
  const { agentId, setAgentId, model, setModel, reasoning, setReasoning } = useSettings();
  const modelsByAgent = useAgentModels();
  const [secrets, setSecrets] = useState<SecretStatus[] | null>(null);
  const [usage, setUsage] = useState<GenImageSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getSecretsStatus()
      .then((r) => !cancelled && setSecrets(r.secrets))
      .catch(() => !cancelled && setSecrets([]));
    void getGenImageSummary().then((u) => !cancelled && setUsage(u));
    return () => {
      cancelled = true;
    };
  }, []);

  const statusFor = useCallback(
    (key: SecretKey) => secrets?.find((s) => s.key === key),
    [secrets],
  );

  const models = modelsByAgent[agentId] ?? [];
  // If the persisted model isn't in this agent's list, show it anyway so the
  // Select reflects the real value rather than appearing blank.
  const modelInList = models.some((m) => m.id === model);

  return (
    <div className="grid gap-6">
      {/* Agent CLI */}
      <section className="grid gap-3">
        <div>
          <h3 className="text-sm font-medium">Agent</h3>
          <p className="text-xs text-muted-foreground">
            Default CLI for new conversations.
          </p>
        </div>
        <RadioGroup.Root
          value={agentId}
          onValueChange={(v) => setAgentId(v as AgentId)}
          className="grid gap-2 sm:grid-cols-2"
        >
          {AGENTS.map((a) => (
            <Label
              key={a.id}
              htmlFor={`agent-${a.id}`}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors',
                agentId === a.id ? 'border-primary bg-accent' : 'hover:bg-accent/50',
              )}
            >
              <RadioGroup.Item
                id={`agent-${a.id}`}
                value={a.id}
                className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-input shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:border-primary"
              >
                <RadioGroup.Indicator className="size-2 rounded-full bg-primary" />
              </RadioGroup.Item>
              <span className="grid gap-0.5">
                <span className="text-sm font-medium leading-none">{a.name}</span>
                <span className="text-xs font-normal text-muted-foreground">{a.hint}</span>
              </span>
            </Label>
          ))}
        </RadioGroup.Root>
      </section>

      {/* Model + reasoning */}
      <section className="grid gap-3">
        <div className="grid gap-2">
          <Label>Model</Label>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="font-mono">
              <SelectValue placeholder="Select a model" />
            </SelectTrigger>
            <SelectContent>
              {!modelInList && model && (
                <SelectItem value={model} className="font-mono">
                  {model} · (custom)
                </SelectItem>
              )}
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id} className="font-mono">
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {agentId === 'codex' && (
          <div className="grid gap-2">
            <Label>Reasoning effort</Label>
            <Select value={reasoning} onValueChange={setReasoning}>
              <SelectTrigger>
                <SelectValue placeholder="Select reasoning" />
              </SelectTrigger>
              <SelectContent>
                {REASONING_OPTIONS.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Codex only — higher effort trades latency for thoroughness.
            </p>
          </div>
        )}
      </section>

      <Separator />

      {/* API keys */}
      <section className="grid gap-4">
        <div>
          <h3 className="text-sm font-medium">Image generation API keys</h3>
          <p className="text-xs text-muted-foreground">
            For agents without built-in image gen (e.g. Claude Code). Stored by the daemon
            at <code>~/.ogf/secrets.json</code> (mode 600). The key never reaches this UI —
            only a masked status.
          </p>
        </div>
        {PROVIDERS.map((spec) => (
          <SecretRow
            key={spec.key}
            spec={spec}
            status={statusFor(spec.key)}
            onSaved={setSecrets}
          />
        ))}
      </section>

      {/* Gen-image cost summary */}
      {usage && usage.totalCount > 0 && (
        <>
          <Separator />
          <section className="grid gap-1">
            <h3 className="text-sm font-medium">Image-gen usage · last 24h</h3>
            <div className="flex items-baseline justify-between font-mono text-xs">
              <span className="text-muted-foreground">
                {usage.totalCount} {usage.totalCount === 1 ? 'call' : 'calls'}
              </span>
              <span className="tabular-nums">~${usage.totalEstCostUsd.toFixed(3)}</span>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Heuristic estimate (per-image list price × call count). Check the provider
              dashboard for actual billing.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

/** Ghost icon button that opens the Settings dialog. Drop into any header. */
export function SettingsButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Settings" className={className}>
          <Settings />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Agent, model, and image-generation API keys.
          </DialogDescription>
        </DialogHeader>
        {/* Mount the body only while open so secrets/usage re-fetch on each open. */}
        {open && <SettingsDialogBody />}
      </DialogContent>
    </Dialog>
  );
}

export default SettingsButton;
