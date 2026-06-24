import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Play, Pencil, Upload, MoreVertical, FolderOpen, Sun, Moon, Settings, ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { RenameDialog } from '@/components/RenameDialog';
import { DeleteConfirm } from '@/components/DeleteConfirm';
import { SettingsDialog } from '@/components/SettingsDialog';
import { useTheme } from '@/components/ThemeToggle';
import { GameCover } from '@/components/GameThumb';
import { OpenProjectDialog } from '@/components/OpenProjectDialog';
import { fetchProjects, projectId, createProject, fsList, type Project } from '@/lib/api';
import { useT, type TKey } from '@/lib/i18n';

// English genre seeds — kept stable regardless of UI locale so generated
// folder names stay ASCII-friendly.
const GENRES: { key: TKey; seed: string }[] = [
  { key: 'genre.platformer', seed: 'Platformer' },
  { key: 'genre.topDown', seed: 'Top-down' },
  { key: 'genre.towerDefense', seed: 'Tower defense' },
  { key: 'genre.survivor', seed: 'Survivor' },
  { key: 'genre.shmup', seed: 'Shmup' },
  { key: 'genre.gridPuzzle', seed: 'Grid puzzle' },
  { key: 'genre.cardBattler', seed: 'Card battler' },
];

function timeAgo(ts: number | undefined, t: (key: TKey, vars?: Record<string, string | number>) => string) {
  if (!ts) return t('time.recently');
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return t('time.justNow');
  if (s < 3600) return t('time.minutesAgo', { n: Math.floor(s / 60) });
  if (s < 86400) return t('time.hoursAgo', { n: Math.floor(s / 3600) });
  return t('time.daysAgo', { n: Math.floor(s / 86400) });
}

export function Dashboard() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [renameFor, setRenameFor] = useState<Project | null>(null);
  const [deleteFor, setDeleteFor] = useState<Project | null>(null);
  const [openImport, setOpenImport] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const t = useT();
  const { theme, toggle: toggleTheme } = useTheme();

  const reload = () =>
    fetchProjects()
      .then((r) => setProjects(r.projects))
      .catch(() => setProjects([]));

  useEffect(() => {
    void reload();
  }, []);

  // Create a fresh project from the prompt and jump straight into Build. The
  // idea is stashed under forge.idea.<id> so the Chat auto-sends it on mount.
  async function create(seed?: string) {
    if (busy) return;
    const text = (seed ?? idea).trim() || 'A simple game';
    setBusy(true);
    try {
      const { cwd } = await fsList('');
      const sep = cwd.includes('\\') ? '\\' : '/';
      const base = text.split(/\s+/).slice(0, 4).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'my-game';
      const slug = `${base}-${Date.now().toString(36).slice(-4)}`;
      const full = `${cwd}${cwd.endsWith(sep) ? '' : sep}GameForge${sep}${slug}`;
      const { project } = await createProject({ path: full, engine: 'web', name: slug });
      localStorage.setItem(`forge.idea.${projectId(project)}`, text);
      navigate(`/build/${projectId(project)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('newGame.error'));
      setBusy(false);
    }
  }

  return (
    <AppShell
      right={
        <>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={() => setOpenImport(true)}
          >
            <FolderOpen />
            {t('common.open')}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            onClick={toggleTheme}
            title={t('app.theme')}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            onClick={() => setSettingsOpen(true)}
            title={t('app.settings')}
          >
            <Settings />
          </Button>
        </>
      }
    >
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        {/* Hero — prompt-first creation */}
        <section className="flex flex-col items-center text-center">
          {/* <span className="brand-title brand-title-large mb-6" aria-label="Agent Game Footage">
            <span className="brand-agent">Agent</span>
            <span className="brand-game">Game</span>
            <span className="brand-forge">Footage</span>
          </span> */}
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('newGame.title')}</h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">{t('newGame.subtitle')}</p>

          <div className="mt-6 w-full max-w-xl">
            <div className="rounded-xl border bg-card p-3 text-left shadow-sm transition focus-within:ring-2 focus-within:ring-ring">
              <Textarea
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                rows={3}
                autoFocus
                placeholder={t('newGame.placeholder')}
                className="resize-none border-0 p-0 shadow-none focus-visible:ring-0"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void create();
                  }
                }}
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-muted-foreground">{t('dashboard.createHint')}</span>
                <Button disabled={busy} onClick={() => void create()}>
                  {busy ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <>
                      {t('newGame.create')}
                      <ArrowRight />
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {GENRES.map((g) => (
                <Badge
                  key={g.key}
                  variant="secondary"
                  className="cursor-pointer px-3 py-1 hover:bg-accent"
                  onClick={() => void create(`A ${g.seed.toLowerCase()} game`)}
                >
                  {t(g.key)}
                </Badge>
              ))}
            </div>
          </div>
        </section>

        {/* Games list */}
        <section className="mt-14">
          <h2 className="mb-4 text-sm font-medium tracking-wide text-muted-foreground">
            {t('dashboard.gamesHeading')}
          </h2>

          {projects === null ? (
            <div className="text-sm text-muted-foreground">{t('common.loading')}</div>
          ) : projects.length === 0 ? (
            <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
              {t('dashboard.empty.body')}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => {
                const id = projectId(p);
                return (
                  <Card key={p.path} className="overflow-hidden">
                    <Link to={`/build/${id}`} className="block">
                      <GameCover path={p.path} className="h-28" />
                    </Link>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <Link to={`/build/${id}`} className="truncate font-medium hover:underline">
                          {p.name}
                        </Link>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground">
                              <MoreVertical />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setRenameFor(p)}>
                              <Pencil />
                              {t('common.rename')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => toast(t('common.comingSoon', { feature: t('dashboard.duplicate') }))}>
                              {t('dashboard.duplicate')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteFor(p)}>
                              {t('common.remove')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge variant="secondary" className="capitalize">
                          {p.engine}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{t('dashboard.card.editedAgo', { when: timeAgo(p.updatedAt, t) })}</span>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button asChild size="sm" variant="secondary" className="flex-1">
                          <Link to={`/build/${id}`}>
                            <Play />
                            {t('dashboard.card.play')}
                          </Link>
                        </Button>
                        <Button asChild size="sm" variant="secondary" className="flex-1">
                          <Link to={`/build/${id}`}>
                            <Pencil />
                            {t('dashboard.card.edit')}
                          </Link>
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => toast(t('common.comingSoon', { feature: t('dashboard.publish') }))}>
                          <Upload />
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <OpenProjectDialog
        open={openImport}
        onOpenChange={setOpenImport}
        onOpened={(p) => {
          setOpenImport(false);
          navigate(`/build/${projectId(p)}`);
        }}
      />
      <RenameDialog
        open={!!renameFor}
        onOpenChange={(o) => !o && setRenameFor(null)}
        projectPath={renameFor?.path ?? ''}
        currentName={renameFor?.name ?? ''}
        onRenamed={reload}
      />
      <DeleteConfirm
        open={!!deleteFor}
        onOpenChange={(o) => !o && setDeleteFor(null)}
        projectPath={deleteFor?.path ?? ''}
        projectName={deleteFor?.name ?? ''}
        onDeleted={reload}
      />
    </AppShell>
  );
}
