"use client";

// Assets browser — the hosted-model port of apps/studio's AssetsPanel (+ a
// focused port of SpriteSlicerModal). Lists the project's image/audio files
// from the flat file list the workspace owns, shows byte-accurate thumbnails via
// the draft-preview route, joins CC0/CC-BY credits from data/asset-credits.json,
// and offers search + license/type filters + sortable columns — exactly like the
// studio. Cloud-model actions: copy the asset's path/reference, open the preview
// in a new tab, delete the file (DELETE /api/projects/:id/file), and slice a
// sprite sheet (writes the same `.ogf-slice.json` sidecar the engine reads).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  ExternalLink,
  ImageOff,
  Music,
  Scissors,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/lib/i18n";
import {
  assetReference,
  assetThumbUrl,
  licenseTone,
  listAssets,
  parseAssetCredits,
  type AssetCredit,
  type AssetItem,
  type LicenseTone,
} from "@/lib/editor/assets";
import { SpriteSlicerModal } from "@/components/sprite-slicer-modal";

function LicenseBadge({ license }: { license?: string | null }) {
  const tone: LicenseTone = licenseTone(license);
  const label = license ?? "Unknown";
  if (tone === "cc0") {
    return (
      <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500">
        {label}
      </Badge>
    );
  }
  if (tone === "cc-by") {
    return (
      <Badge variant="secondary" className="border-amber-500/40 bg-amber-500/10 text-amber-500">
        {label}
      </Badge>
    );
  }
  return <Badge variant="outline">{label}</Badge>;
}

function Thumb({ projectId, asset }: { projectId: string; asset: AssetItem }) {
  const [broken, setBroken] = useState(false);
  const base =
    "flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/30";
  if (asset.mediaKind === "audio") {
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
    <div className={base}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={assetThumbUrl(projectId, asset.relPath)}
        alt={asset.name}
        loading="lazy"
        className="size-full object-contain [image-rendering:pixelated]"
        onError={() => setBroken(true)}
      />
    </div>
  );
}

type SortKey = "name" | "license";
type SortDir = "asc" | "desc";
const ALL = "__all__";

export function AssetsPanel({
  projectId,
  files,
  onChanged,
}: {
  projectId: string;
  files: string[];
  /** Bumped after a delete/slice so the workspace can refresh the file list. */
  onChanged?: () => void;
}) {
  const t = useT();
  const [credits, setCredits] = useState<Map<string, AssetCredit>>(new Map());

  const [query, setQuery] = useState("");
  const [licenseFilter, setLicenseFilter] = useState<string>(ALL);
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [slicing, setSlicing] = useState<string | null>(null);

  // Load the (optional) credits ledger; tolerant of a missing file.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/file?path=${encodeURIComponent("data/asset-credits.json")}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled) return;
        setCredits(parseAssetCredits(body?.content ?? null));
      })
      .catch(() => {
        if (!cancelled) setCredits(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, files]);

  const assets = useMemo<AssetItem[]>(() => listAssets(files, credits), [files, credits]);
  const creditedCount = assets.filter((a) => a.credit).length;

  const licenseOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of assets) if (a.credit?.license) set.add(a.credit.license);
    return Array.from(set).sort((x, y) => x.localeCompare(y));
  }, [assets]);

  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of assets) set.add(a.mediaKind);
    return Array.from(set).sort((x, y) => x.localeCompare(y));
  }, [assets]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = assets.filter((a) => {
      if (licenseFilter !== ALL && (a.credit?.license ?? "") !== licenseFilter) return false;
      if (typeFilter !== ALL && a.mediaKind !== typeFilter) return false;
      if (!q) return true;
      const hay = `${a.name} ${a.relPath} ${a.credit?.author ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
    rows = [...rows].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "license") {
        const la = a.credit?.license ?? "";
        const lb = b.credit?.license ?? "";
        const cmp = la.localeCompare(lb);
        if (cmp !== 0) return cmp * dir;
        return a.name.localeCompare(b.name) * dir;
      }
      return a.name.localeCompare(b.name) * dir;
    });
    return rows;
  }, [assets, query, licenseFilter, typeFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }
  function SortIndicator({ active }: { active: boolean }) {
    if (!active) return null;
    const Icon = sortDir === "asc" ? ArrowUp : ArrowDown;
    return <Icon className="size-3 shrink-0 opacity-70" aria-hidden />;
  }

  const copyPath = useCallback(
    async (a: AssetItem) => {
      try {
        await navigator.clipboard.writeText(assetReference(a.relPath));
        toast.success(t("assets.copied"));
      } catch {
        /* clipboard blocked — ignore */
      }
    },
    [t],
  );

  const deleteAsset = useCallback(
    async (a: AssetItem) => {
      if (!window.confirm(t("assets.deleteConfirm", { name: a.name }))) return;
      try {
        const r = await fetch(
          `/api/projects/${projectId}/file?path=${encodeURIComponent(a.relPath)}`,
          { method: "DELETE" },
        );
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? `${r.status}`);
        }
        onChanged?.();
      } catch (err) {
        toast.error(t("assets.deleteFailed", { error: err instanceof Error ? err.message : String(err) }));
      }
    },
    [projectId, onChanged, t],
  );

  const isEmpty = assets.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col p-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{t("assets.title")}</div>
          <p className="text-sm text-muted-foreground">{t("assets.subtitle")}</p>
        </div>
        {creditedCount > 0 ? (
          <Badge variant="outline" className="text-emerald-500">
            {creditedCount} {t("assets.freeBadge")}
          </Badge>
        ) : null}
      </div>

      {!isEmpty ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("assets.search")}
              className="pl-8"
              aria-label={t("assets.search")}
            />
          </div>

          <Select value={licenseFilter} onValueChange={setLicenseFilter}>
            <SelectTrigger className="h-9 w-auto min-w-[140px] gap-1 text-[13px]">
              <span className="text-muted-foreground">{t("assets.filterLicense")}:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("assets.all")}</SelectItem>
              {licenseOptions.map((lic) => (
                <SelectItem key={lic} value={lic}>
                  {lic}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-9 w-auto min-w-[120px] gap-1 text-[13px]">
              <span className="text-muted-foreground">{t("assets.filterType")}:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("assets.all")}</SelectItem>
              {typeOptions.map((k) => (
                <SelectItem key={k} value={k} className="capitalize">
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg border bg-card shadow-sm">
        {isEmpty ? (
          <div className="p-6 text-sm text-muted-foreground">{t("assets.empty")}</div>
        ) : visible.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">{t("assets.noMatch")}</div>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="w-[64px]">{t("assets.col.preview")}</TableHead>
                <TableHead>
                  <button
                    type="button"
                    onClick={() => toggleSort("name")}
                    className="-mx-1 flex items-center gap-1 rounded px-1 py-0.5 font-medium transition-colors hover:text-foreground"
                  >
                    {t("assets.col.asset")}
                    <SortIndicator active={sortKey === "name"} />
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    type="button"
                    onClick={() => toggleSort("license")}
                    className="-mx-1 flex items-center gap-1 rounded px-1 py-0.5 font-medium transition-colors hover:text-foreground"
                  >
                    {t("assets.col.license")}
                    <SortIndicator active={sortKey === "license"} />
                  </button>
                </TableHead>
                <TableHead>{t("assets.col.source")}</TableHead>
                <TableHead className="w-[128px] text-right">{t("assets.col.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((a) => (
                <TableRow key={a.relPath}>
                  <TableCell>
                    <Thumb projectId={projectId} asset={a} />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.relPath.replace(/^assets\//, "")}
                    </div>
                  </TableCell>
                  <TableCell>
                    {a.credit ? (
                      <LicenseBadge license={a.credit.license} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {a.credit ? (
                      <div className="text-xs text-muted-foreground">
                        <div>{a.credit.author ? `by ${a.credit.author}` : t("assets.unknownAuthor")}</div>
                        {a.credit.source ? <div>{a.credit.source}</div> : null}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("assets.local")}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      {a.mediaKind === "image" ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          title={t("assets.slice")}
                          onClick={() => setSlicing(a.relPath)}
                        >
                          <Scissors className="size-3.5" />
                        </Button>
                      ) : null}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        title={t("assets.copyPath")}
                        onClick={() => void copyPath(a)}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        title={t("assets.preview")}
                        onClick={() => window.open(assetThumbUrl(projectId, a.relPath), "_blank", "noopener")}
                      >
                        <ExternalLink className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-destructive hover:text-destructive"
                        title={t("assets.delete")}
                        onClick={() => void deleteAsset(a)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {slicing ? (
        <SpriteSlicerModal
          projectId={projectId}
          imageRelPath={slicing}
          onClose={() => setSlicing(null)}
          onSaved={() => {
            setSlicing(null);
            onChanged?.();
          }}
        />
      ) : null}
    </div>
  );
}
