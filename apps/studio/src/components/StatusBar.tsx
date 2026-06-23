import { type Project } from '@/lib/api';

export function StatusBar({ project }: { project: Project | null }) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-t bg-muted/30 px-4 text-xs text-muted-foreground">
      <span className="capitalize">{project?.engine ?? '—'}</span>
      <span className="truncate font-mono opacity-70">{project?.path ?? ''}</span>
      <span className="ml-auto text-emerald-500">$0.00 · assets free</span>
    </div>
  );
}
