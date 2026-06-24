import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Flame, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { createProject, fsList, projectId } from '@/lib/api';
import { useT, type TKey } from '@/lib/i18n';

// `seed` is the English genre phrase used to seed the project idea/slug (kept
// stable regardless of UI locale so generated folder names stay ASCII-friendly).
const GENRES: { key: TKey; seed: string }[] = [
  { key: 'genre.platformer', seed: 'Platformer' },
  { key: 'genre.topDown', seed: 'Top-down' },
  { key: 'genre.towerDefense', seed: 'Tower defense' },
  { key: 'genre.survivor', seed: 'Survivor' },
  { key: 'genre.shmup', seed: 'Shmup' },
  { key: 'genre.gridPuzzle', seed: 'Grid puzzle' },
  { key: 'genre.cardBattler', seed: 'Card battler' },
];

export function NewGame() {
  const t = useT();
  const nav = useNavigate();
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);

  async function create(seed?: string) {
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
      nav(`/build/${projectId(project)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('newGame.error'));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex h-14 items-center px-4">
        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeft />
            {t('newGame.back')}
          </Link>
        </Button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
        <span className="mb-6 grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Flame className="size-5" />
        </span>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('newGame.title')}</h1>
        <p className="mt-3 max-w-md text-muted-foreground">
          {t('newGame.subtitle')}
        </p>

        <div className="mt-7 w-full max-w-xl">
          <div className="rounded-xl border bg-card p-3 text-left shadow-sm focus-within:ring-2 focus-within:ring-ring">
            <Textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              rows={3}
              autoFocus
              placeholder={t('newGame.placeholder')}
              className="resize-none border-0 p-0 shadow-none focus-visible:ring-0"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void create();
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{t('newGame.hint')}</span>
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

          <div className="mt-4 flex flex-wrap justify-center gap-2">
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
      </div>
    </div>
  );
}
