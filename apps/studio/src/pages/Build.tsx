import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Upload, Play, Layers, Image as ImageIcon, Code2, Database, MoreVertical, Sun, Moon, Settings, History, Package, Download, PanelLeftOpen } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { SettingsDialog } from '@/components/SettingsDialog';
import { useTheme } from '@/components/ThemeToggle';
import { GameIcon } from '@/components/GameThumb';
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [convOpen, setConvOpen] = useState<boolean>(() => localStorage.getItem('forge.convOpen') !== '0');
  const { theme, toggle: toggleTheme } = useTheme();

  const toggleConv = () =>
    setConvOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem('forge.convOpen', next ? '1' : '0');
      } catch {
        /* storage disabled — toggle still works for this session */
      }
      return next;
    });

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
        <GameIcon path={project?.path} name={project?.name} />
        <div className="font-medium">{project?.name ?? t('common.loading')}</div>
        <div className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 text-muted-foreground">
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={toggleTheme}>
              {theme === 'dark' ? <Sun /> : <Moon />}
              {t('app.theme')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
              <Settings />
              {t('app.settings')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setPendingOpen(true)}>
              <History />
              {t('build.pendingChanges')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setPackOpen(true)}>
              <Package />
              {t('build.reviewPack')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setImportOpen(true)}>
              <Download />
              {t('build.importSession')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" onClick={() => toast(t('common.comingSoon', { feature: t('build.publish') }))}>
          <Upload />
          {t('build.publish')}
        </Button>
      </header>

      <div
        className="grid min-h-0 flex-1"
        style={{ gridTemplateColumns: `${convOpen ? '210px' : '44px'} 360px 1fr` }}
      >
        {/* Conversations */}
        <div className="flex min-h-0 flex-col bg-muted/20">
          {project ? (
            convOpen ? (
              <ConversationList
                projectPath={project.path}
                conversationId={conversationId}
                onSelect={setConversationId}
                onCollapse={toggleConv}
              />
            ) : (
              <div className="flex flex-col items-center py-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground"
                  onClick={toggleConv}
                  title={t('conversations.expand')}
                >
                  <PanelLeftOpen className="size-4" />
                </Button>
              </div>
            )
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
            <div className="bg-muted/30 px-4 py-2">
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

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

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
