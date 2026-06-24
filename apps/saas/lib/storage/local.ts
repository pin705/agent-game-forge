import { promises as fs } from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/data-dir";
import type { ProjectFile, Storage } from "./types";

/**
 * Filesystem-backed storage for local dev. Project files live under
 * `.data/projects/<projectId>/`. No isolation, no auth — exists so P1 is
 * fully runtime-verifiable with zero external accounts.
 */
export class LocalStorage implements Storage {
  private root(projectId: string): string {
    return path.join(dataDir(), "projects", projectId);
  }

  /** Recursively list files relative to `base`. */
  private async walk(base: string, rel = ""): Promise<string[]> {
    const dir = path.join(base, rel);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...(await this.walk(base, childRel)));
      else out.push(childRel);
    }
    return out;
  }

  async getProjectFiles(projectId: string): Promise<ProjectFile[]> {
    const base = this.root(projectId);
    const paths = await this.walk(base);
    return Promise.all(
      paths.map(async (p) => ({
        path: p,
        content: await fs.readFile(path.join(base, p), "utf8"),
      })),
    );
  }

  async putProjectFiles(projectId: string, files: ProjectFile[]): Promise<void> {
    for (const f of files) await this.writeProjectFile(projectId, f.path, f.content);
  }

  async listProjectFiles(projectId: string): Promise<string[]> {
    return this.walk(this.root(projectId));
  }

  async readProjectFile(projectId: string, p: string): Promise<string | null> {
    try {
      return await fs.readFile(path.join(this.root(projectId), p), "utf8");
    } catch {
      return null;
    }
  }

  async writeProjectFile(projectId: string, p: string, content: string): Promise<void> {
    const full = path.join(this.root(projectId), p);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
  }
}
