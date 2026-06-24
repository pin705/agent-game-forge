import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Upload, Play, Layers, Image as ImageIcon, Code2, Database, Flame, MoreVertical } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { fetchProjects, projectId, type Project } from '@/lib/api';
import { Chat } from '@/components/Chat';
import { PlayPane } from '@/components/PlayPane';
import { GodotPlayPane } from '@/components/GodotPlayPane';
import { SceneEditor } from '@/components/SceneEditor';
import { AssetsPanel } from '@/components/AssetsPanel';
import { CodePanel } from '@/components/CodePanel';
import { DataTab } from '@/components/DataTab';
import { ConversationList } from '@/components/ConversationList';
import { SettingsButton } from '@/components/SettingsDialog';
import { StatusBar } from '@/components/StatusBar';
import { PendingChangesModal } from '@/components/PendingChangesModal';
import { PackReviewModal } from '@/components/PackReviewModal';
import { ImportCodexSessionModal } from '@/components/ImportCodexSessionModal';
import { useT } from '@/lib/i18n';

export function Build() {
  const t = useT();
  const { id } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [idea] = useState<string>(() => (id ? (localStorage.getItem(`forge.idea.${id}`) ?? '') : ''));
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [packOpen, setPackOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    fetchProjects()
      .then((r) => {
        const p = r.projects.find((x) => projectId(x) === id);
        if (p) setProject(p);
      })
      .catch(() => {});
  }, [id]);

  const isGodot = project?.engine === 'godot';

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
        <div className="font-medium">{project?.name ?? t('common.loading')}</div>
        {project ? (
          <Badge variant="secondary" className="capitalize">
            {project.engine}
          </Badge>
        ) : null}
        <div className="flex-1" />
        <Badge variant="outline" className="text-emerald-500">
          {t('build.free')}
        </Badge>
        <SettingsButton />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 text-muted-foreground">
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setPendingOpen(true)}>{t('build.pendingChanges')}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setPackOpen(true)}>{t('build.reviewPack')}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setImportOpen(true)}>{t('build.importSession')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" onClick={() => toast(t('common.comingSoon', { feature: t('build.publish') }))}>
          <Upload />
          {t('build.publish')}
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[210px_360px_1fr]">
        {/* Conversations */}
        <div className="flex min-h-0 flex-col border-r">
          {project ? (
            <ConversationList projectPath={project.path} conversationId={conversationId} onSelect={setConversationId} />
          ) : null}
        </div>

        {/* Assistant */}
        <div className="flex min-h-0 flex-col border-r">
          {project ? (
            <Chat
              key={conversationId ?? 'latest'}
              projectPath={project.path}
              initialPrompt={conversationId ? undefined : idea}
              conversationId={conversationId ?? undefined}
            />
          ) : (
            <div className="grid flex-1 place-items-center text-sm text-muted-foreground">{t('common.loading')}</div>
          )}
        </div>

        {/* Preview / Scene / Assets / Data / Code */}
        <div className="flex min-h-0 flex-col">
          <Tabs defaultValue="play" className="flex min-h-0 flex-1 flex-col">
            <div className="border-b px-4 py-2">
              <TabsList>
                <TabsTrigger value="play">
                  <Play />
                  {t('tab.play')}
                </TabsTrigger>
                <TabsTrigger value="scene">
                  <Layers />
                  {t('tab.scene')}
                </TabsTrigger>
                <TabsTrigger value="assets">
                  <ImageIcon />
                  {t('tab.assets')}
                </TabsTrigger>
                <TabsTrigger value="data">
                  <Database />
                  {t('tab.data')}
                </TabsTrigger>
                <TabsTrigger value="code">
                  <Code2 />
                  {t('tab.code')}
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="play" className="m-0 min-h-0 flex-1 p-0">
              {project ? isGodot ? <GodotPlayPane projectPath={project.path} /> : <PlayPane projectPath={project.path} /> : null}
            </TabsContent>
            <TabsContent value="scene" className="m-0 min-h-0 flex-1 p-0">
              {project ? <SceneEditor projectPath={project.path} /> : null}
            </TabsContent>
            <TabsContent value="assets" className="m-0 min-h-0 flex-1 overflow-auto p-6">
              {project ? <AssetsPanel projectPath={project.path} /> : null}
            </TabsContent>
            <TabsContent value="data" className="m-0 min-h-0 flex-1 p-0">
              {project ? <DataTab projectPath={project.path} /> : null}
            </TabsContent>
            <TabsContent value="code" className="m-0 min-h-0 flex-1 p-0">
              {project ? <CodePanel projectPath={project.path} /> : null}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <StatusBar project={project} />

      {project ? (
        <>
          <PendingChangesModal
            open={pendingOpen}
            onOpenChange={setPendingOpen}
            projectPath={project.path}
            engine={project.engine}
          />
          <PackReviewModal open={packOpen} onOpenChange={setPackOpen} projectPath={project.path} />
          <ImportCodexSessionModal
            open={importOpen}
            onOpenChange={setImportOpen}
            projectPath={project.path}
            onImported={(cid: string) => setConversationId(cid)}
          />
        </>
      ) : null}
    </div>
  );
}
