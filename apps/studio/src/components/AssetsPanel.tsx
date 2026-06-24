import { useEffect, useMemo, useState } from 'react';
import { Music, ImageOff, Search, ArrowUp, ArrowDown } from 'lucide-react';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  listAssets,
  assetUrl,
  licenseTone,
  type AssetItem,
  type LicenseTone,
} from '@/lib/assets';
import { useT } from '@/lib/i18n';

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
    'flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/30';

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

interface AssetsPanelProps {
  /** Absolute project path. */
  projectPath: string;
}

// View-only sorting: which column, and direction. License sort keys off the
// credit's license string; name sort keys off the displayed filename.
type SortKey = 'name' | 'license';
type SortDir = 'asc' | 'desc';

const ALL = '__all__';

export function AssetsPanel({ projectPath }: AssetsPanelProps) {
  const t = useT();
  const [assets, setAssets] = useState<AssetItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Toolbar state (view-only; never mutates asset data).
  const [query, setQuery] = useState('');
  const [licenseFilter, setLicenseFilter] = useState<string>(ALL);
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

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

  // Free-count badge reflects the FULL set, independent of search/filters.
  const creditedCount = assets?.filter((a) => a.credit).length ?? 0;

  // Distinct license + type option lists, built from the assets actually
  // present so empty buckets never appear. Sorted for stable menus.
  const licenseOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of assets ?? []) {
      if (a.credit?.license) set.add(a.credit.license);
    }
    return Array.from(set).sort((x, y) => x.localeCompare(y));
  }, [assets]);

  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of assets ?? []) set.add(a.mediaKind);
    return Array.from(set).sort((x, y) => x.localeCompare(y));
  }, [assets]);

  // Filter → search → sort. Pure derivation, never touches `assets`.
  const visible = useMemo(() => {
    if (!assets) return [];
    const q = query.trim().toLowerCase();
    let rows = assets.filter((a) => {
      if (licenseFilter !== ALL && (a.credit?.license ?? '') !== licenseFilter) {
        return false;
      }
      if (typeFilter !== ALL && a.mediaKind !== typeFilter) return false;
      if (!q) return true;
      const hay = `${a.name} ${a.relPath} ${a.credit?.author ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
    rows = [...rows].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'license') {
        const la = a.credit?.license ?? '';
        const lb = b.credit?.license ?? '';
        const cmp = la.localeCompare(lb);
        if (cmp !== 0) return cmp * dir;
        // Tie-break on name so order is deterministic.
        return a.name.localeCompare(b.name) * dir;
      }
      return a.name.localeCompare(b.name) * dir;
    });
    return rows;
  }, [assets, query, licenseFilter, typeFilter, sortKey, sortDir]);

  // Clicking a header toggles direction when already active, else selects it asc.
  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function SortIndicator({ active }: { active: boolean }) {
    if (!active) return null;
    const Icon = sortDir === 'asc' ? ArrowUp : ArrowDown;
    return <Icon className="size-3 shrink-0 opacity-70" aria-hidden />;
  }

  const ready = assets !== null && !error && assets.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{t('assets.title')}</div>
          <p className="text-sm text-muted-foreground">
            {t('assets.subtitle')}
          </p>
        </div>
        {creditedCount > 0 ? (
          <Badge variant="outline" className="text-emerald-500">
            {creditedCount} {t('assets.freeBadge')}
          </Badge>
        ) : null}
      </div>

      {ready ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('assets.search')}
              className="pl-8"
              aria-label={t('assets.search')}
            />
          </div>

          <Select value={licenseFilter} onValueChange={setLicenseFilter}>
            <SelectTrigger className="h-8 w-auto min-w-[140px] gap-1 text-[13px]">
              <span className="text-muted-foreground">{t('assets.filterLicense')}:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('assets.all')}</SelectItem>
              {licenseOptions.map((lic) => (
                <SelectItem key={lic} value={lic}>
                  {lic}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-8 w-auto min-w-[120px] gap-1 text-[13px]">
              <span className="text-muted-foreground">{t('assets.filterType')}:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('assets.all')}</SelectItem>
              {typeOptions.map((k) => (
                <SelectItem key={k} value={k} className="capitalize">
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg bg-card shadow-sm">
        {error ? (
          <div className="p-6 text-sm text-destructive">{t('assets.loadFailed', { error })}</div>
        ) : assets === null ? (
          <div className="p-6 text-sm text-muted-foreground">{t('assets.loading')}</div>
        ) : assets.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            {t('assets.empty')}
          </div>
        ) : visible.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            {t('assets.noMatch')}
          </div>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="w-[64px]">{t('assets.col.preview')}</TableHead>
                <TableHead>
                  <button
                    type="button"
                    onClick={() => toggleSort('name')}
                    aria-sort={sortKey === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className="-mx-1 flex items-center gap-1 rounded px-1 py-0.5 font-medium transition-colors hover:text-foreground"
                  >
                    {t('assets.col.asset')}
                    <SortIndicator active={sortKey === 'name'} />
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    type="button"
                    onClick={() => toggleSort('license')}
                    aria-sort={sortKey === 'license' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className="-mx-1 flex items-center gap-1 rounded px-1 py-0.5 font-medium transition-colors hover:text-foreground"
                  >
                    {t('assets.col.license')}
                    <SortIndicator active={sortKey === 'license'} />
                  </button>
                </TableHead>
                <TableHead>{t('assets.col.source')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((a) => (
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
                        <span className="text-xs text-emerald-500">{t('assets.fetchedFree')}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {a.credit ? (
                      <div className="text-xs text-muted-foreground">
                        <div>{a.credit.author ? `by ${a.credit.author}` : t('assets.unknownAuthor')}</div>
                        {a.credit.source ? <div>{a.credit.source}</div> : null}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t('assets.local')}</span>
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
