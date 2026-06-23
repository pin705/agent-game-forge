import { useEffect, useState } from 'react';
import { Music, ImageOff } from 'lucide-react';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  listAssets,
  assetUrl,
  licenseTone,
  type AssetItem,
  type LicenseTone,
} from '@/lib/assets';

interface AssetsPanelProps {
  /** Absolute project path. */
  projectPath: string;
}

function LicenseBadge({ license }: { license?: string | null }) {
  const tone: LicenseTone = licenseTone(license);
  const label = license ?? 'Unknown';
  if (tone === 'cc0') {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
      >
        {label}
      </Badge>
    );
  }
  if (tone === 'cc-by') {
    return (
      <Badge
        variant="secondary"
        className="border-amber-500/40 bg-amber-500/10 text-amber-500"
      >
        {label}
      </Badge>
    );
  }
  return <Badge variant="outline">{label}</Badge>;
}

function Thumb({ projectPath, asset }: { projectPath: string; asset: AssetItem }) {
  const [broken, setBroken] = useState(false);
  const base =
    'flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/30';

  if (asset.mediaKind === 'audio') {
    return (
      <div className={base}>
        <Music className="size-5 text-muted-foreground" />
      </div>
    );
  }
  if (broken) {
    return (
      <div className={base}>
        <ImageOff className="size-5 text-muted-foreground" />
      </div>
    );
  }
  return (
    <div className={cn(base, 'bg-[length:12px_12px]')}>
      <img
        src={assetUrl(projectPath, asset.relPath)}
        alt={asset.name}
        loading="lazy"
        className="size-full object-contain"
        onError={() => setBroken(true)}
      />
    </div>
  );
}

export function AssetsPanel({ projectPath }: AssetsPanelProps) {
  const [assets, setAssets] = useState<AssetItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAssets(null);
    setError(null);
    listAssets(projectPath)
      .then((items) => {
        if (!cancelled) setAssets(items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  const creditedCount = assets?.filter((a) => a.credit).length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">Assets</div>
          <p className="text-sm text-muted-foreground">
            Fetched free, with CC0 / CC-BY license badges.
          </p>
        </div>
        {creditedCount > 0 ? (
          <Badge variant="outline" className="text-emerald-500">
            {creditedCount} fetched free · $0.00
          </Badge>
        ) : null}
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg border">
        {error ? (
          <div className="p-6 text-sm text-destructive">Failed to load assets: {error}</div>
        ) : assets === null ? (
          <div className="p-6 text-sm text-muted-foreground">Loading assets…</div>
        ) : assets.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            No assets yet. They appear here once the Assistant fetches free art
            and audio into <code className="text-xs">assets/</code>.
          </div>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="w-[64px]">Preview</TableHead>
                <TableHead>Asset</TableHead>
                <TableHead>License</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.map((a) => (
                <TableRow key={a.relPath}>
                  <TableCell>
                    <Thumb projectPath={projectPath} asset={a} />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.relPath.replace(/^assets\//, '')}
                    </div>
                  </TableCell>
                  <TableCell>
                    {a.credit ? (
                      <div className="flex flex-col items-start gap-1">
                        <LicenseBadge license={a.credit.license} />
                        <span className="text-xs text-emerald-500">fetched free</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {a.credit ? (
                      <div className="text-xs text-muted-foreground">
                        <div>{a.credit.author ? `by ${a.credit.author}` : 'unknown author'}</div>
                        {a.credit.source ? <div>{a.credit.source}</div> : null}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">local</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
