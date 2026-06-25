import { promises as fs } from "node:fs";
import path from "node:path";
import type { Sandbox, SandboxFile } from "@/lib/sandbox";

/**
 * Sandbox seeding — make a hosted build's sandbox carry the SAME build
 * knowledge as the local daemon's freshly-bootstrapped project.
 *
 * Two things get injected into every fresh sandbox:
 *
 *   1. The Python agent-tools (`apps/saas/agent-tools/`) under `agent-tools/`
 *      so the model can run them via run_shell (`python agent-tools/…`). This
 *      is the original P1 behavior (formerly `copyAgentTools`).
 *
 *   2. The build CORPUS (`apps/saas/agent-corpus/`) — conventions, the pipeline
 *      manifest + stage directors, per-genre recipes, foundation seed scaffolds,
 *      and the generate-2d skills — landed at the EXACT paths the daemon's
 *      `bootstrap.ts` writes them to, so the system prompt's file reads AND the
 *      Python tools' file lookups resolve identically to a local build.
 *
 * The daemon mapping we mirror (apps/daemon/src/templates/bootstrap.ts):
 *
 *   templates/conventions/**.md            → .ogf/conventions/**
 *   templates/recipes/**.md                → .ogf/recipes/**
 *   templates/pipelines/**.{yml,yaml,md,json} → .ogf/pipelines/**
 *   templates/skills/**.{md,yaml,py}       → .agents/skills/**
 *   templates/foundation/<genre>/seed/**   → .ogf/foundation-seeds/<genre>/seed/**
 *
 * `pipeline.py` walks up from CWD for a `.ogf/` dir, then reads
 * `.ogf/pipelines/game-build.yaml` (its MANIFEST) and prints `read: .ogf/<skill>`
 * pointing at `.ogf/pipelines/stages/*.md` — all of which now exist, so it reads
 * the real manifest instead of only its baked-in fallback.
 *
 * Located relative to this module (process.cwd() is the saas app root in dev,
 * build, and on the server) so it resolves regardless of cwd.
 *
 * Byte-accurate: every file transfers as raw bytes (binary seeds like the seed
 * PNGs survive). Junk (`__pycache__`, `.DS_Store`) is skipped.
 */

const SKIP_NAMES = new Set(["__pycache__", ".DS_Store"]);

function agentToolsDir(): string {
  // lib/agent/seed-sandbox.ts → ../../agent-tools
  return path.join(process.cwd(), "agent-tools");
}

function corpusDir(): string {
  // lib/agent/seed-sandbox.ts → ../../agent-corpus
  return path.join(process.cwd(), "agent-corpus");
}

/**
 * Recursively read every file under `base` as raw bytes, returning sandbox
 * files whose paths are `${destPrefix}/<relative path>`. Optional `filter`
 * (by file basename) restricts which files are taken; optional `mapRel`
 * rewrites the per-file relative path (used to splice the daemon's
 * `<genre>/seed/` layout into `.ogf/foundation-seeds/`).
 */
async function readDirInto(
  base: string,
  destPrefix: string,
  opts: {
    /** Keep a file? Receives the basename (e.g. "common.md"). Default: keep all. */
    keep?: (name: string) => boolean;
    /** Keep walking into a directory? Receives the basename. Default: all but SKIP_NAMES. */
    keepDir?: (name: string) => boolean;
    /** Rewrite a file's path relative to `base` before prefixing. Default: identity. */
    mapRel?: (rel: string) => string;
  } = {},
  rel = "",
): Promise<SandboxFile[]> {
  const dir = path.join(base, rel);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: SandboxFile[] = [];
  for (const e of entries) {
    if (SKIP_NAMES.has(e.name)) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (opts.keepDir && !opts.keepDir(e.name)) continue;
      out.push(...(await readDirInto(base, destPrefix, opts, childRel)));
    } else {
      if (opts.keep && !opts.keep(e.name)) continue;
      try {
        const bytes = new Uint8Array(await fs.readFile(path.join(base, childRel)));
        const mapped = opts.mapRel ? opts.mapRel(childRel) : childRel;
        out.push({ path: `${destPrefix}/${mapped}`, bytes });
      } catch {
        /* skip unreadable */
      }
    }
  }
  return out;
}

const hasExt = (...exts: string[]) => (name: string) =>
  exts.some((x) => name.toLowerCase().endsWith(x));

/** Files the model invokes via run_shell — `python agent-tools/<tool>.py …`. */
export async function copyAgentTools(sandbox: Sandbox): Promise<void> {
  const files = await readDirInto(agentToolsDir(), "agent-tools");
  if (files.length) await sandbox.writeFiles(files);
}

/**
 * Inject the build corpus at the daemon-equivalent paths. Returns the list of
 * sandbox paths written (handy for tests / logging).
 *
 * What lands ALWAYS (small, pure text/code the agent reads every build):
 *   - `.ogf/conventions/**`   (schema, runtime patterns, genres, juice, …)
 *   - `.ogf/pipelines/**`     (game-build.yaml manifest + stage directors)
 *   - `.ogf/recipes/**`       (per-genre paste-ready patterns)
 *   - `.agents/skills/**`     (generate2dmap / generate2dsprite)
 *
 * Foundation SEEDS land too (the daemon stages every genre's seed under
 * `.ogf/foundation-seeds/`; the agent copies its genre's seed to root during
 * scaffold). We inject the full seed SOURCE/DATA/MD verbatim, but SKIP the
 * out-of-band `.ogf-qa/*.png` reference screenshots — nothing in any seed loads
 * them (verified), and they are ~3 MB of dead weight per ephemeral sandbox. The
 * load-bearing seed scaffolds are mirrored exactly; only the QA screenshots
 * (pure visual references) are omitted.
 */
export async function copyCorpus(sandbox: Sandbox): Promise<string[]> {
  const base = corpusDir();
  const files: SandboxFile[] = [];

  // conventions/**.md → .ogf/conventions/**
  files.push(
    ...(await readDirInto(path.join(base, "conventions"), ".ogf/conventions", {
      keep: hasExt(".md"),
    })),
  );

  // recipes/**.md → .ogf/recipes/**
  files.push(
    ...(await readDirInto(path.join(base, "recipes"), ".ogf/recipes", {
      keep: hasExt(".md"),
    })),
  );

  // pipelines/**.{yml,yaml,md,json} → .ogf/pipelines/**
  files.push(
    ...(await readDirInto(path.join(base, "pipelines"), ".ogf/pipelines", {
      keep: hasExt(".yml", ".yaml", ".md", ".json"),
    })),
  );

  // skills/**.{md,yaml,py} → .agents/skills/**
  files.push(
    ...(await readDirInto(path.join(base, "skills"), ".agents/skills", {
      keep: hasExt(".md", ".yaml", ".py"),
    })),
  );

  // foundation/<genre>/seed/** → .ogf/foundation-seeds/<genre>/seed/**
  // The daemon walks each `foundation/<genre>/seed/` and re-roots it under
  // `.ogf/foundation-seeds/`. Our source dir already has the `<genre>/seed/`
  // shape, so the identity rel preserves it. We skip `.ogf-qa` dirs (QA shots).
  files.push(
    ...(await readDirInto(path.join(base, "foundation"), ".ogf/foundation-seeds", {
      keepDir: (name) => name !== ".ogf-qa",
    })),
  );

  if (files.length) await sandbox.writeFiles(files);
  return files.map((f) => f.path);
}

/**
 * Path prefixes that `seedSandbox` injects (the Python tools, the build corpus
 * at its daemon-equivalent roots, and the skills). The Python tools also write
 * their scratch state UNDER `.ogf/` (`pipeline.py` → `.ogf/pipeline/state.json`,
 * `verify-game.py` → `.ogf/debug-protocol.json`), so excluding the whole `.ogf/`
 * prefix covers both the seeded guidance AND the tool scratch.
 */
const SEEDED_PREFIXES = ["agent-tools/", ".ogf/", ".agents/"];

/**
 * True if `p` is something WE seeded (or a tool's scratch under `.ogf/`), not
 * the agent's actual project output. Used by run.ts to exclude these from the
 * files pushed back to project storage — so storage holds only the real game,
 * never the injected corpus/tools. (The game never writes under these roots.)
 */
export function isSeededPath(p: string): boolean {
  const norm = p.replace(/^\.?\//, "");
  return SEEDED_PREFIXES.some((pre) => norm === pre.slice(0, -1) || norm.startsWith(pre));
}

/**
 * Seed a fresh sandbox with EVERYTHING a hosted build needs beyond the user's
 * project files: the Python agent-tools + the build corpus. Single entry point
 * called by `runAgent` (run.ts) right after the project files are hydrated.
 */
export async function seedSandbox(sandbox: Sandbox): Promise<void> {
  await copyAgentTools(sandbox);
  await copyCorpus(sandbox);
}
