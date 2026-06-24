"use client";

// Tabbed right-pane editor — ports the studio's Build.tsx right-pane tab set
// (Code | Scene | Data | Assets) into the SaaS workspace. The studio also had a
// Play tab there, but the SaaS keeps the live preview in the CENTER pane
// (PlayPane), so this pane is purely the editors. Code stays the Batch-1
// CodePanel. The active tab persists to localStorage. Every editor operates on
// the CURRENT project files (passed in from the workspace) and refreshes after
// an agent run via the same file-list refresh signal; a save in any editor calls
// onRefresh so the preview + file list reflect the change.

import { useEffect, useState } from "react";
import { Code2, Database, ImageIcon, Layers } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodePanel } from "@/components/code-panel";
import { ScenePanel } from "@/components/scene-panel";
import { DataPanel } from "@/components/data-panel";
import { AssetsPanel } from "@/components/assets-panel";
import { useT } from "@/lib/i18n";

type TabValue = "code" | "scene" | "data" | "assets";
const TABS: TabValue[] = ["code", "scene", "data", "assets"];
const LS_KEY = "ogf.saas.build.editorTab";

function loadTab(): TabValue {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw && (TABS as string[]).includes(raw)) return raw as TabValue;
  } catch {
    /* storage disabled — default */
  }
  return "code";
}

export function EditorPanel({
  projectId,
  files,
  onRefresh,
  loading,
  onDirtyChange,
  openSignal,
}: {
  projectId: string;
  files: string[];
  onRefresh: () => void;
  loading?: boolean;
  /** Bubbles the code editor's dirty state up (Batch 4 status bar / guard). */
  onDirtyChange?: (dirty: boolean) => void;
  /** {path, nonce} from the command palette to open a file in the Code tab. */
  openSignal?: { path: string; nonce: number } | null;
}) {
  const t = useT();
  // SSR-safe: render the default on the server + first client render, then
  // hydrate the persisted tab after mount (matches the i18n/cols pattern).
  const [tab, setTab] = useState<TabValue>("code");
  useEffect(() => {
    setTab(loadTab());
  }, []);

  // A palette file-open jumps to the Code tab so the file is visible.
  useEffect(() => {
    if (openSignal) selectTab("code");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal?.nonce]);

  function selectTab(v: string) {
    const next = (TABS as string[]).includes(v) ? (v as TabValue) : "code";
    setTab(next);
    try {
      localStorage.setItem(LS_KEY, next);
    } catch {
      /* storage disabled — applies for this session only */
    }
  }

  return (
    <Tabs value={tab} onValueChange={selectTab} className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 bg-muted/30 px-3 py-1.5">
        <TabsList className="h-8">
          <TabsTrigger value="code" className="gap-1.5 text-xs">
            <Code2 className="size-3.5" />
            {t("tab.code")}
          </TabsTrigger>
          <TabsTrigger value="scene" className="gap-1.5 text-xs">
            <Layers className="size-3.5" />
            {t("tab.scene")}
          </TabsTrigger>
          <TabsTrigger value="data" className="gap-1.5 text-xs">
            <Database className="size-3.5" />
            {t("tab.data")}
          </TabsTrigger>
          <TabsTrigger value="assets" className="gap-1.5 text-xs">
            <ImageIcon className="size-3.5" />
            {t("tab.assets")}
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="code" className="m-0 min-h-0 flex-1 overflow-hidden p-0">
        <CodePanel
          projectId={projectId}
          files={files}
          onRefresh={onRefresh}
          loading={loading}
          onDirtyChange={onDirtyChange}
          openSignal={openSignal}
        />
      </TabsContent>
      <TabsContent value="scene" className="m-0 min-h-0 flex-1 overflow-hidden p-0">
        <ScenePanel projectId={projectId} files={files} onSaved={onRefresh} />
      </TabsContent>
      <TabsContent value="data" className="m-0 min-h-0 flex-1 overflow-hidden p-0">
        <DataPanel projectId={projectId} files={files} onSaved={onRefresh} />
      </TabsContent>
      <TabsContent value="assets" className="m-0 min-h-0 flex-1 overflow-hidden p-0">
        <AssetsPanel projectId={projectId} files={files} onChanged={onRefresh} />
      </TabsContent>
    </Tabs>
  );
}
