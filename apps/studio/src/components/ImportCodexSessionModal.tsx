import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { GitBranch, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

// ---- Daemon client (mirrors apps/daemon/src/server.ts codex routes) --------
// These live here rather than in lib/api.ts because the studio's api.ts has no
// Codex surface yet and is out of scope to edit. Both routes already exist on
// the daemon:
//   GET  /api/codex/sessions?cwd=<projectPath>     → { sessions: [...] }
//   POST /api/conversations/import-codex           → { conversation, importedCount }

interface CodexSessionSummary {
  id: string;
  filePath: string;
  cwd: string;
  startedAt: string;
  cliVersion?: string;
  firstPrompt?: string;
  userMsgCount?: number;
  agentMsgCount?: number;
  fileSize: number;
}

interface ImportCodexResult {
  conversation: { id: string };
  importedCount: number;
}

async function fetchCodexSessions(cwd: string): Promise<CodexSessionSummary[]> {
  const r = await fetch(`/api/codex/sessions?cwd=${encodeURIComponent(cwd)}`);
  if (!r.ok) throw new Error(`sessions: ${r.status}`);
  const body = (await r.json()) as { sessions: CodexSessionSummary[] };
  return body.sessions;
}

async function importCodexSession(req: {
  projectPath: string;
  sessionId: string;
  replay?: boolean;
  title?: string;
}): Promise<ImportCodexResult> {
  const r = await fetch('/api/conversations/import-codex', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!r.ok) {
    let detail = `${r.status}`;
    try {
      const body = (await r.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      /* keep status code */
    }
    throw new Error(detail);
  }
  return r.json() as Promise<ImportCodexResult>;
}

// ---------------------------------------------------------------------------

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absolute project path; matched against each session's cwd. */
  projectPath: string;
  /** Called with the new conversation id after a successful import. */
  onImported?: (conversationId: string) => void;
}

export function ImportCodexSessionModal({
  open,
  onOpenChange,
  projectPath,
  onImported,
}: Props) {
  const t = useT();
  const [sessions, setSessions] = useState<CodexSessionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);

  // Load sessions whenever the dialog (re)opens for a project.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setSessions(null);
    fetchCodexSessions(projectPath)
      .then((s) => !cancelled && setSessions(s))
      .catch((e) => {
        if (cancelled) return;
        setSessions([]);
        toast.error(
          t('import.loadFailed', { error: e instanceof Error ? e.message : String(e) }),
        );
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, projectPath, t]);

  async function doImport(s: CodexSessionSummary) {
    setImporting(s.id);
    try {
      const r = await importCodexSession({
        projectPath,
        sessionId: s.id,
        replay: true,
        title: s.firstPrompt ? s.firstPrompt.slice(0, 60) : `Codex ${s.id.slice(0, 8)}`,
      });
      toast.success(
        t('import.success', { n: r.importedCount }),
      );
      onImported?.(r.conversation.id);
      onOpenChange(false);
    } catch (e) {
      toast.error(t('import.failed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setImporting(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="size-4 text-primary" />
            {t('import.title')}
          </DialogTitle>
          <DialogDescription className="truncate">{projectPath}</DialogDescription>
        </DialogHeader>

        <div className="-mx-6 min-h-0 flex-1 overflow-auto border-y bg-muted/20">
          {loading && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {t('import.scanning')}
            </div>
          )}

          {!loading && sessions?.length === 0 && (
            <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <Sparkles className="size-5" />
              <span>{t('import.empty')}</span>
              <span className="text-xs">
                {t('import.emptyHint')}
              </span>
            </div>
          )}

          {!loading &&
            sessions?.map((s) => (
              <div
                key={s.id}
                className="grid grid-cols-[1fr_auto] items-start gap-3 border-b px-6 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <code className="font-mono">{s.id.slice(0, 18)}…</code>
                    <span>{formatDate(s.startedAt)}</span>
                    {s.cliVersion && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                        v{s.cliVersion}
                      </span>
                    )}
                  </div>
                  {s.firstPrompt && (
                    <div className="mb-1.5 max-h-16 overflow-hidden whitespace-pre-wrap break-words rounded border-l-2 border-primary/50 bg-background px-2.5 py-1.5 text-[13px] text-foreground">
                      {s.firstPrompt}
                    </div>
                  )}
                  <div className="flex gap-3 font-mono text-[11px] text-muted-foreground">
                    <span>{s.userMsgCount ?? '?'} {t('import.user')}</span>
                    <span>{s.agentMsgCount ?? '?'} {t('import.agent')}</span>
                    <span>{formatSize(s.fileSize)}</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={importing !== null}
                  onClick={() => void doImport(s)}
                >
                  {importing === s.id ? t('import.importing') : t('import.import')}
                </Button>
              </div>
            ))}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {t('import.body')}
          </span>
          <DialogClose asChild>
            <Button variant="ghost" size="sm">
              {t('common.close')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
