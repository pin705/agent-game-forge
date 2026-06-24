import { promises as fs } from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/data-dir";
import { fileText, type ProjectFile, type Storage } from "./types";

/**
 * Filesystem-backed storage for local dev. Project files live under
 * `.data/projects/<projectId>/`. No isolation, no auth — exists so P1 is
 * fully runtime-verifiable with zero external accounts.
 *
 * Byte-accurate (P5 Item 1): reads/writes raw bytes via `fs` with NO utf-8
 * assumption, so binary assets round-trip intact.
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
        // Read as a raw Buffer (no encoding) → exact bytes for binary + text.
        bytes: new Uint8Array(await fs.readFile(path.join(base, p))),
      })),
    );
  }

  async putProjectFiles(projectId: string, files: ProjectFile[]): Promise<void> {
    for (const f of files) await this.writeProjectFile(projectId, f.path, f.bytes);
  }

  async listProjectFiles(projectId: string): Promise<string[]> {
    return this.walk(this.root(projectId));
  }

  async readProjectFile(projectId: string, p: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await fs.readFile(path.join(this.root(projectId), p)));
    } catch {
      return null;
    }
  }

  async readProjectFileText(projectId: string, p: string): Promise<string | null> {
    const bytes = await this.readProjectFile(projectId, p);
    return bytes === null ? null : fileText({ bytes });
  }

  async writeProjectFile(projectId: string, p: string, bytes: Uint8Array): Promise<void> {
    const full = path.join(this.root(projectId), p);
    await fs.mkdir(path.dirname(full), { recursive: true });
    // Write the raw bytes verbatim (no encoding).
    await fs.writeFile(full, bytes);
  }

  async deleteProjectFile(projectId: string, p: string): Promise<void> {
    try {
      await fs.unlink(path.join(this.root(projectId), p));
    } catch {
      /* already gone — idempotent delete */
    }
  }
}
