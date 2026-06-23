import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Flame, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { createProject, fsList, projectId } from '@/lib/api';

const GENRES = ['Platformer', 'Top-down', 'Tower defense', 'Survivor', 'Shmup', 'Grid puzzle', 'Card battler'];

export function NewGame() {
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
      toast.error(e instanceof Error ? e.message : 'Could not create game');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex h-14 items-center px-4">
        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeft />
            Dashboard
          </Link>
        </Button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
        <span className="mb-6 grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Flame className="size-5" />
        </span>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">What do you want to make?</h1>
        <p className="mt-3 max-w-md text-muted-foreground">
          Describe a game — Forge builds it with free assets and a live preview. Ships at $0.
        </p>

        <div className="mt-7 w-full max-w-xl">
          <div className="rounded-xl border bg-card p-3 text-left shadow-sm focus-within:ring-2 focus-within:ring-ring">
            <Textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              rows={3}
              autoFocus
              placeholder="A sokoban puzzle in a stone dungeon — push crates onto glowing targets…"
              className="resize-none border-0 p-0 shadow-none focus-visible:ring-0"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void create();
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">⌘ / Ctrl + Enter</span>
              <Button disabled={busy} onClick={() => void create()}>
                {busy ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <>
                    Create
                    <ArrowRight />
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {GENRES.map((g) => (
              <Badge
                key={g}
                variant="secondary"
                className="cursor-pointer px-3 py-1 hover:bg-accent"
                onClick={() => void create(`A ${g.toLowerCase()} game`)}
              >
                {g}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
