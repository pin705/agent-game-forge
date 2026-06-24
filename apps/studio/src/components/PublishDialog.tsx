import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Globe, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getPublishUrl, publishProject } from '@/lib/api';
import { useT } from '@/lib/i18n';

/** True when a publish failure looks like the daemon's "creds missing" 400 —
 *  the message asks the user to configure Cloudflare in Settings. We match a
 *  few loose markers so the Settings hint shows for either locale's text. */
function looksLikeMissingCreds(message: string): boolean {
  return /cloudflare|account id|api token|settings|cài đặt/i.test(message);
}

/** Controlled "Publish to web" dialog. On open it fetches the last-published
 *  URL (if any). The primary action deploys to Cloudflare Pages; on success it
 *  shows the live link with copy / open / re-publish; on failure it surfaces
 *  the daemon's message (plus a Settings hint when creds are missing). */
export function PublishDialog({
  open,
  onOpenChange,
  projectPath,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath: string;
}) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Re-fetch the existing link each time the dialog opens; reset transient
  // state so a previous error/copied flash doesn't linger on reopen.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setCopied(false);
    getPublishUrl(projectPath)
      .then((r) => !cancelled && setUrl(r.url))
      .catch(() => {
        /* no link yet / daemon hiccup — just show the publish CTA */
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectPath]);

  const publish = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await publishProject(projectPath);
      setUrl(r.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, projectPath]);

  const copy = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — Open button still works */
    }
  }, [url]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('publish.title')}</DialogTitle>
          <DialogDescription>{t('publish.description')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Live link — present when the game has been published this session
              or in a prior one. */}
          {url && (
            <div className="grid gap-2 rounded-lg bg-muted/40 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Globe className="size-4 text-muted-foreground" />
                {t('publish.live')}
              </div>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all font-mono text-xs text-primary underline-offset-4 hover:underline"
              >
                {url}
              </a>
              <div className="mt-1 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => void copy()}>
                  {copied ? <Check /> : <Copy />}
                  {copied ? t('publish.copied') : t('publish.copyLink')}
                </Button>
                <Button size="sm" variant="secondary" asChild>
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink />
                    {t('publish.openGame')}
                  </a>
                </Button>
              </div>
            </div>
          )}

          {/* Error — the daemon's message verbatim, with a Settings nudge when
              the failure is the missing-creds case. */}
          {error && (
            <div className="grid gap-1 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <p>{t('publish.failed', { error })}</p>
              {looksLikeMissingCreds(error) && (
                <p className="text-xs text-destructive/80">{t('publish.needCreds')}</p>
              )}
            </div>
          )}

          {/* Primary action: first publish, or re-publish once a link exists. */}
          <Button onClick={() => void publish()} disabled={busy} className="w-full">
            {busy ? (
              <>
                <Loader2 className="animate-spin" />
                {t('publish.publishing')}
              </>
            ) : url ? (
              <>
                <RefreshCw />
                {t('publish.republish')}
              </>
            ) : (
              <>
                <Globe />
                {t('publish.cta')}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PublishDialog;
