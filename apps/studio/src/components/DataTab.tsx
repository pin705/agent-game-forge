import { useEffect, useState } from 'react';
import { Database } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TableEditor } from '@/components/TableEditor';
import { fetchFileTree } from '@/lib/files';

// Surfaces TableEditor over the project's editable data/*.json catalogs.
export function DataTab({ projectPath }: { projectPath: string }) {
  const [files, setFiles] = useState<string[]>([]);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFileTree(projectPath)
      .then((res) => {
        if (cancelled) return;
        const out: string[] = [];
        const walk = (n: any) => {
          if (!n) return;
          if (n.kind === 'file' && typeof n.relPath === 'string') {
            const p = n.relPath.replace(/\\/g, '/');
            if (p.startsWith('data/') && p.endsWith('.json')) out.push(p);
          }
          (n.children ?? []).forEach(walk);
        };
        const root: any = (res as any)?.tree ?? (res as any)?.root ?? res;
        Array.isArray(root) ? root.forEach(walk) : walk(root);
        out.sort();
        setFiles(out);
        setSel((s) => s ?? out[0] ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  if (files.length === 0) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
        <div>
          <Database className="mx-auto mb-2 size-6 opacity-60" />
          No editable data files yet. The Assistant writes catalogs into <code>data/*.json</code>.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <span className="text-xs text-muted-foreground">Catalog</span>
        <Select value={sel ?? undefined} onValueChange={setSel}>
          <SelectTrigger className="h-8 w-[280px]">
            <SelectValue placeholder="Pick a data file" />
          </SelectTrigger>
          <SelectContent>
            {files.map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {sel ? <TableEditor key={sel} projectPath={projectPath} relPath={sel} /> : null}
      </div>
    </div>
  );
}
