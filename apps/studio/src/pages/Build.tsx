import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Upload, Play, Layers, Image as ImageIcon, Flame } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { fetchProjects, projectId, type Project } from '@/lib/api';
import { Chat } from '@/components/Chat';
import { PlayPane } from '@/components/PlayPane';
import { SceneEditor } from '@/components/SceneEditor';
import { AssetsPanel } from '@/components/AssetsPanel';
import { SettingsButton } from '@/components/SettingsDialog';
import { StatusBar } from '@/components/StatusBar';

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
        <SettingsButton />
        <Button size="sm" onClick={() => toast('Publish — coming soon')}>
          <Upload />
          Publish
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[360px_1fr]">
        {/* Assistant — primary column */}
        <div className="flex min-h-0 flex-col border-r">
          {project ? (
            <Chat projectPath={project.path} initialPrompt={idea} />
          ) : (
            <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Loading…</div>
          )}
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
            <TabsContent value="play" className="m-0 min-h-0 flex-1 p-0">
              {project ? <PlayPane projectPath={project.path} /> : null}
            </TabsContent>
            <TabsContent value="scene" className="m-0 min-h-0 flex-1 p-0">
              {project ? <SceneEditor projectPath={project.path} /> : null}
            </TabsContent>
            <TabsContent value="assets" className="m-0 min-h-0 flex-1 overflow-auto p-6">
              {project ? <AssetsPanel projectPath={project.path} /> : null}
            </TabsContent>
          </Tabs>
        </div>
      </div>
      <StatusBar project={project} />
    </div>
  );
}
