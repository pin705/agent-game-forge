import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** Project file tree — fills the bulk of the sidebar. */
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

  // Project-scoped search. State is local to this Sidebar — empty when there
  // is no project, reset when switching projects (re-render of <Sidebar> for
  // a different project clears the input naturally because we tie the key
  // through React tree, but we also reset on project path change to be safe).
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setSearch('');
  }, [props.project?.path]);
  // Cmd/Ctrl+K → focus search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const onSearchKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setSearch('');
      (e.currentTarget as HTMLInputElement).blur();
    }
  }, []);

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

      {/* Project switcher up top — compact button that drops the recent-projects
          list. Workspace tab nav lives in the editor topbar (not here) so the
          sidebar stays focused on its primary job: the file tree. */}
      <div className="side-top">
        <ProjectSwitcher
          project={props.project}
          projects={props.projects}
          onSelect={props.onSelectProject}
          onOpen={props.onOpenProject}
          onDelete={props.onDeleteProject}
        />
      </div>

      {/* Project search — substring filter over file paths. ⌘K / Ctrl+K
          jumps focus here from anywhere in the app. The FileTree below
          auto-expands every dir containing a match; clearing restores
          the user's prior expansion state. */}
      {props.project && (
        <div className="side-search">
          <span className="side-search-icon" aria-hidden>{I.search ?? '⌕'}</span>
          <input
            ref={searchInputRef}
            type="text"
            className="side-search-input"
            placeholder="Search files…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKey}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
          {search && (
            <button
              type="button"
              className="side-search-clear"
              onClick={() => {
                setSearch('');
                searchInputRef.current?.focus();
              }}
              title="Clear (Esc)"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
          {!search && <span className="side-search-kbd">⌘K</span>}
        </div>
      )}

      {/* The full file tree fills the rest of the sidebar with its v1 chrome
          intact — head row (file count + 'show only used' toggle + refresh)
          on top, scrolling list below. */}
      {props.project && (
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
            searchQuery={search}
          />
        </div>
      )}

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
        title={props.project ? `${props.project.path}\nEngine: ${props.project.engine}` : undefined}
      >
        <svg className="ico" width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="2" y="2" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="7" cy="7" r="2" fill="currentColor" />
        </svg>
        <span className="proj-trigger-name">{props.project?.name ?? 'No project'}</span>
        {props.project && (
          <span
            className="proj-trigger-engine"
            data-engine={props.project.engine}
            aria-label={`Engine: ${props.project.engine}`}
          >
            {props.project.engine}
          </span>
        )}
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
