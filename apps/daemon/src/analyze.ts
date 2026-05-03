import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { EngineKind } from './projects.js';

const IGNORED = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.ogf',
  '.next',
  '.vite',
  '.cache',
  '.godot',
  '.import',
  'dist',
  'build',
  '.idea',
  '.vscode',
]);

const MAX_FILES_TO_SCAN = 5000;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // skip files bigger than 5 MB

export interface AnalyzeResult {
  engine: EngineKind;
  /** Relative POSIX paths (without engine prefix) that are referenced from somewhere. */
  usedAssets: string[];
  /** Total scanned source files (.tscn / .tres / .gd / etc.). */
  scanned: number;
  /** Project-relative path to the main scene (Godot only), if discovered. */
  mainScene?: string;
}

export function analyzeProject(rootAbs: string, engine: EngineKind): AnalyzeResult {
  const used = new Set<string>();
  let scanned = 0;
  const seen = { count: 0 };
  let mainScene: string | undefined;

  // Godot main scene is declared in project.godot — count it as referenced.
  if (engine === 'godot') {
    try {
      const projectGodot = readFileSync(path.join(rootAbs, 'project.godot'), 'utf8');
      const m = /run\/main_scene\s*=\s*"res:\/\/([^"]+)"/m.exec(projectGodot);
      if (m) {
        mainScene = m[1].replace(/\\/g, '/');
        used.add(mainScene);
      }
    } catch {
      // project.godot missing or unreadable — skip
    }
  }

  function walk(dirAbs: string) {
    if (seen.count >= MAX_FILES_TO_SCAN) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dirAbs);
    } catch {
      return;
    }
    for (const name of entries) {
      if (IGNORED.has(name)) continue;
      const childAbs = path.join(dirAbs, name);
      let st;
      try {
        st = statSync(childAbs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(childAbs);
      } else if (st.isFile()) {
        seen.count++;
        if (seen.count >= MAX_FILES_TO_SCAN) return;
        if (st.size > MAX_FILE_BYTES) continue;
        scanFile(childAbs);
      }
    }
  }

  function scanFile(filePath: string) {
    const ext = path.extname(filePath).toLowerCase();
    // Launcher scripts (.bat / .cmd / .ps1 / .sh) often reference scenes that
    // aren't loaded at runtime (dev-only tool scenes like MapEdit.tscn). We
    // scan them for any engine so res:// links get picked up.
    const isLauncher =
      ext === '.bat' || ext === '.cmd' || ext === '.ps1' || ext === '.sh';

    if (engine === 'godot') {
      if (
        ext !== '.tscn' &&
        ext !== '.tres' &&
        ext !== '.gd' &&
        ext !== '.gdshader' &&
        !isLauncher
      ) {
        return;
      }
    } else if (engine === 'unity') {
      if (!isLauncher) return;
    } else if (engine === 'web') {
      if (
        ext !== '.html' &&
        ext !== '.htm' &&
        ext !== '.js' &&
        ext !== '.jsx' &&
        ext !== '.ts' &&
        ext !== '.tsx' &&
        ext !== '.css' &&
        ext !== '.json' &&
        !isLauncher
      ) {
        return;
      }
    } else {
      if (!isLauncher) return;
    }

    let content: string;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      return;
    }
    scanned++;

    if (engine === 'godot' || isLauncher) {
      // path="res://assets/foo.png" — also matches `"res://..."` in .bat files.
      const re1 = /res:\/\/([^"\s)]+)/g;
      let m: RegExpExecArray | null;
      while ((m = re1.exec(content)) !== null) {
        const p = m[1].replace(/\\/g, '/').replace(/\/+$/, '');
        if (p) used.add(p);
      }
    }
    if (engine === 'web') {
      // Quoted relative path with a known extension. Catches:
      //   <link href="styles.css">  <script src="src/game.js">
      //   import './scene.js'  fetch('data/level1.json')
      //   "image": "assets/props/x.png"  (inside JSON catalogs)
      //   "file": "data/level2.json"     (inside levels.json)
      // Group 1 = leading prefix (./ or ../ or /), group 2 = the path itself.
      const re =
        /["'](\.{0,2}\/)?([^"'\s]+\.(?:png|jpg|jpeg|gif|webp|bmp|svg|mp3|wav|ogg|webm|mp4|json|js|jsx|ts|tsx|css|html|htm))["']/gi;
      let m: RegExpExecArray | null;
      const fileDir = path
        .relative(rootAbs, path.dirname(filePath))
        .replace(/\\/g, '/');
      while ((m = re.exec(content)) !== null) {
        const prefix = m[1] ?? '';
        const captured = m[2].replace(/\\/g, '/');
        // ./ or ../ → resolve relative to the file's directory.
        // Bare relative (no prefix) is ambiguous: HTML attrs like src="src/game.js"
        // are project-root-relative, but JS imports are file-relative. We add
        // BOTH interpretations to the set; harmless if one doesn't exist.
        if (prefix.startsWith('.')) {
          used.add(normalizeRel(path.posix.join(fileDir, prefix + captured)));
        } else if (prefix === '/') {
          used.add(captured);
        } else {
          used.add(captured);
          if (fileDir) used.add(normalizeRel(path.posix.join(fileDir, captured)));
        }
      }
    }
  }

  function normalizeRel(p: string): string {
    // collapse ../ segments, strip leading ./
    const parts: string[] = [];
    for (const seg of p.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    }
    return parts.join('/');
  }

  walk(rootAbs);
  return {
    engine,
    usedAssets: [...used].sort(),
    scanned,
    mainScene,
  };
}
