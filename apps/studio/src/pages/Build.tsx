import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Upload, Play, Layers, Image as ImageIcon, Send, Flame } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { fetchProjects, projectId, type Project } from '@/lib/api';

export function Build() {
  const { id } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [idea] = useState<string>(() => (id ? (localStorage.getItem(`forge.idea.${id}`) ?? '') : ''));

  useEffect(() => {
    fetchProjects()
      .then((r) => {
        const p = r.projects.find((x) => projectId(x) === id);
        if (p) setProject(p);
      })
      .catch(() => {});
  }, [id]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Button asChild variant="ghost" size="icon" className="size-8">
          <Link to="/">
            <ArrowLeft />
          </Link>
        </Button>
        <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
          <Flame className="size-4" />
        </span>
        <div className="font-medium">{project?.name ?? 'Loading…'}</div>
        {project ? (
          <Badge variant="secondary" className="capitalize">
            {project.engine}
          </Badge>
        ) : null}
        <div className="flex-1" />
        <Badge variant="outline" className="text-emerald-500">
          $0.00 · free
        </Badge>
        <Button size="sm" onClick={() => toast('Publish — coming soon')}>
          <Upload />
          Publish
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[360px_1fr]">
        {/* Assistant (chat) — the primary column */}
        <div className="flex min-h-0 flex-col border-r">
          <div className="border-b px-4 py-3 text-sm font-medium">Assistant</div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {idea ? (
              <div className="ml-auto max-w-[85%] rounded-xl bg-primary/15 px-3 py-2 text-sm">{idea}</div>
            ) : (
              <div className="text-sm text-muted-foreground">Describe a change and the Assistant will build it.</div>
            )}
            <div className="flex max-w-[90%] gap-2">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
                <Flame className="size-3" />
              </span>
              <div className="rounded-xl border bg-card px-3 py-2 text-sm text-muted-foreground">
                Connect your Claude / Codex CLI and I’ll build this game with free assets. (chat streaming wires in next)
              </div>
            </div>
          </div>
          <div className="border-t p-3">
            <div className="flex gap-2">
              <Input placeholder="Describe a change…" />
              <Button size="icon" onClick={() => toast('Chat wiring — coming next')}>
                <Send />
              </Button>
            </div>
          </div>
        </div>

        {/* Preview / Scene / Assets */}
        <div className="flex min-h-0 flex-col">
          <Tabs defaultValue="play" className="flex min-h-0 flex-1 flex-col">
            <div className="border-b px-4 py-2">
              <TabsList>
                <TabsTrigger value="play">
                  <Play />
                  Play
                </TabsTrigger>
                <TabsTrigger value="scene">
                  <Layers />
                  Scene
                </TabsTrigger>
                <TabsTrigger value="assets">
                  <ImageIcon />
                  Assets
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="play" className="m-0 flex min-h-0 flex-1 items-center justify-center bg-muted/30 p-6">
              <div className="flex aspect-video w-full max-w-2xl items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground">
                Live preview — the game runs here (PlayPane ports in next)
              </div>
            </TabsContent>
            <TabsContent value="scene" className="m-0 flex-1 p-6 text-sm text-muted-foreground">
              Scene editor — drag-edit levels (ports in next).
            </TabsContent>
            <TabsContent value="assets" className="m-0 flex-1 p-6">
              <div className="text-sm font-medium">Assets</div>
              <p className="text-sm text-muted-foreground">Fetched free, with CC0 / CC-BY license badges.</p>
              <Separator className="my-3" />
              <div className="text-xs text-muted-foreground">No assets yet.</div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
