import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Play, Pencil, Upload, MoreVertical, Gamepad2, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { RenameDialog } from '@/components/RenameDialog';
import { DeleteConfirm } from '@/components/DeleteConfirm';
import { SettingsButton } from '@/components/SettingsDialog';
import { OpenProjectDialog } from '@/components/OpenProjectDialog';
import { fetchProjects, projectId, type Project } from '@/lib/api';
import { useT, type TKey } from '@/lib/i18n';

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
  const navigate = useNavigate();
  const t = useT();

  const reload = () =>
    fetchProjects()
      .then((r) => setProjects(r.projects))
      .catch(() => setProjects([]));

  useEffect(() => {
    void reload();
  }, []);

  return (
    <AppShell
      right={
        <>
          <SettingsButton />
          <Button variant="outline" size="sm" onClick={() => setOpenImport(true)}>
            <FolderOpen />
            {t('common.open')}
          </Button>
          <Button asChild size="sm">
            <Link to="/new">
              <Plus />
              {t('dashboard.newGame')}
            </Link>
          </Button>
        </>
      }
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">{t('dashboard.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('dashboard.subtitle')}
          </p>
        </div>

        {projects === null ? (
          <div className="text-sm text-muted-foreground">{t('common.loading')}</div>
        ) : projects.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-12 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted">
              <Gamepad2 className="size-6 text-muted-foreground" />
            </span>
            <div className="text-lg font-medium">{t('dashboard.empty.title')}</div>
            <p className="max-w-sm text-sm text-muted-foreground">{t('dashboard.empty.body')}</p>
            <Button asChild>
              <Link to="/new">
                <Plus />
                {t('dashboard.empty.cta')}
              </Link>
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => {
              const id = projectId(p);
              return (
                <Card key={p.path} className="overflow-hidden">
                  <Link to={`/build/${id}`} className="block">
                    <div className="flex h-28 items-center justify-center bg-gradient-to-br from-primary/20 to-emerald-500/10">
                      <Gamepad2 className="size-8 text-primary/70" />
                    </div>
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
      </div>

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
