import { useEffect, useRef, useState } from 'react';
import type { AgentInfo, FileNode, Project } from '@ogf/contracts';
import { I } from './icons.js';
import { FileTree } from './FileTree.js';

export type Theme = 'dark' | 'light';
export type Density = 'compact' | 'regular' | 'comfy';
export type SidebarTab = 'assets' | 'scenes' | 'play';

interface Props {
  agent: AgentInfo | null;
  agentLoading: boolean;
  project: Project | null;
  projects: Project[];
  onSelectProject: (p: Project) => void;
  onOpenProject: () => void;
  /** Remove project from OGF's list (doesn't touch disk). */
  onDeleteProject?: (p: Project) => void;
  theme: Theme;
  onToggleTheme: () => void;
  density: Density;
  onCycleDensity: () => void;
  tab: SidebarTab;
  onTabChange: (t: SidebarTab) => void;
  /** Project file tree — rendered as a "Files" section in the sidebar. */
  tree: FileNode | null;
  selectedFile?: { relPath: string; fileKind?: FileNode['fileKind'] } | null;
  onSelectFile: (relPath: string, fileKind: FileNode['fileKind']) => void;
  onNewFile?: () => void;
  onRefreshTree?: () => void;
  recentlyChanged?: Set<string>;
  usedAssets?: Set<string>;
  mainScene?: string | null;
  sceneFiles?: Set<string>;
}

export function Sidebar(props: Props) {
  const agentState = props.agent?.available
    ? 'ok'
    : props.agentLoading
      ? 'off'
      : 'error';
  const stateLabel =
    agentState === 'ok'
      ? 'Codex ready'
      : agentState === 'error'
        ? 'Codex offline'
        : 'Detecting…';

  return (
    <aside className="side">
      {/* Brand head — pixel mascot + "Agent Game Forge" wordmark */}
      <div className="side-head">
        <div className="brand">
          <img
            className="mark"
            src="/ogf-logo-64.png"
            srcSet="/ogf-logo-32.png 1x, /ogf-logo-64.png 2x, /ogf-logo-128.png 4x"
            alt=""
            width={22}
            height={22}
          />
          <span className="brand-title" aria-label="Agent Game Forge">
            <span className="brand-agent">Agent</span>
            <span className="brand-game">Game</span>
            <span className="brand-forge">Forge</span>
          </span>
        </div>
      </div>

      {/* Project switcher + tab nav + (later) file groups live here */}
      <div className="side-nav">
        <div className="nav-section">Project</div>
        <ProjectSwitcher
          project={props.project}
          projects={props.projects}
          onSelect={props.onSelectProject}
          onOpen={props.onOpenProject}
          onDelete={props.onDeleteProject}
        />

        <div className="nav-section">Workspace</div>
        <button
          type="button"
          className={`nav-item ${props.tab === 'assets' ? 'active' : ''}`}
          onClick={() => props.onTabChange('assets')}
        >
          <span className="ico">{I.folder}</span>
          <span>Assets</span>
        </button>
        <button
          type="button"
          className={`nav-item ${props.tab === 'scenes' ? 'active' : ''}`}
          onClick={() => props.onTabChange('scenes')}
        >
          <span className="ico">{I.image}</span>
          <span>Scenes</span>
        </button>
        <button
          type="button"
          className={`nav-item ${props.tab === 'play' ? 'active' : ''}`}
          onClick={() => props.onTabChange('play')}
        >
          <span className="ico">{I.play}</span>
          <span>Play</span>
        </button>

        {/* Files section — shows the project's file tree as a nested list,
            consistent with v2 reference (Linear-style nav with file leaves). */}
        {props.project && (
          <>
            <div className="nav-section side-files-head">
              <span>Files</span>
              {props.onRefreshTree && (
                <button
                  className="icon-btn side-files-refresh"
                  title="Refresh tree"
                  onClick={props.onRefreshTree}
                >
                  {I.refresh}
                </button>
              )}
            </div>
            <div className="side-files">
              <FileTree
                tree={props.tree}
                selected={props.selectedFile?.relPath ?? null}
                onSelect={props.onSelectFile}
                onNewFile={props.onNewFile}
                onRefresh={props.onRefreshTree}
                recentlyChanged={props.recentlyChanged}
                usedAssets={props.usedAssets}
                mainScene={props.mainScene}
                sceneFiles={props.sceneFiles}
                filter="all"
                engine={props.project.engine}
                scopeKey={props.project.path}
              />
            </div>
          </>
        )}
      </div>

      {/* Foot: agent status + theme + density toggles */}
      <div className="side-foot">
        <button
          className="agent-pill"
          data-state={agentState}
          title={props.agent?.path ?? 'Codex agent status'}
        >
          <span className="dot" />
          <span className="lbl">{stateLabel}</span>
          {props.agent?.version && (
            <span className="ver">
              {props.agent.version.replace(/^codex-cli\s*/, 'v')}
            </span>
          )}
        </button>
        <span className="grow" />
        <button
          className="icon-btn"
          title={props.theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          onClick={props.onToggleTheme}
        >
          {props.theme === 'dark' ? I.sun : I.moon}
        </button>
        <button
          className="icon-btn"
          title={`Density · ${props.density} (click to cycle)`}
          onClick={props.onCycleDensity}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
        >
          {props.density.slice(0, 1).toUpperCase()}
        </button>
      </div>
    </aside>
  );
}

function ProjectSwitcher(props: {
  project: Project | null;
  projects: Project[];
  onSelect: (p: Project) => void;
  onOpen: () => void;
  onDelete?: (p: Project) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmingPath, setConfirmingPath] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (!open) setConfirmingPath(null);
  }, [open]);

  return (
    <div ref={ref} className="proj-switcher">
      <button
        type="button"
        className="nav-item proj-trigger"
        onClick={() => setOpen((v) => !v)}
        title={props.project?.path}
      >
        <svg className="ico" width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="2" y="2" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="7" cy="7" r="2" fill="currentColor" />
        </svg>
        <span className="proj-trigger-name">{props.project?.name ?? 'No project'}</span>
        <span className="proj-trigger-caret">{I.caret}</span>
      </button>
      {open && (
        <div className="proj-dropdown">
          {props.projects.length === 0 && (
            <div className="proj-dropdown-empty">No recent projects</div>
          )}
          {props.projects.map((p) => {
            const confirming = confirmingPath === p.path;
            return (
              <div
                key={p.path}
                className={`proj-dropdown-item ${props.project?.path === p.path ? 'active' : ''}`}
                onClick={() => {
                  setConfirmingPath(null);
                  props.onSelect(p);
                  setOpen(false);
                }}
                title={p.path}
              >
                <div className="proj-dropdown-row">
                  <div className="proj-dropdown-text">
                    <div className="proj-dropdown-name">{p.name}</div>
                    <div className="proj-dropdown-sub">
                      {p.engine} · {p.path}
                    </div>
                  </div>
                  {props.onDelete && (
                    <button
                      type="button"
                      className={`proj-dropdown-delete ${confirming ? 'confirming' : ''}`}
                      title={
                        confirming
                          ? 'Click again to confirm. Files on disk are NOT deleted.'
                          : 'Remove from OGF (files on disk are kept)'
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirming) {
                          props.onDelete!(p);
                          setConfirmingPath(null);
                        } else {
                          setConfirmingPath(p.path);
                        }
                      }}
                    >
                      {confirming ? 'remove?' : '×'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <div className="proj-dropdown-divider" />
          <div
            className="proj-dropdown-item action"
            onClick={() => {
              props.onOpen();
              setOpen(false);
            }}
          >
            + Open folder…
          </div>
        </div>
      )}
    </div>
  );
}
