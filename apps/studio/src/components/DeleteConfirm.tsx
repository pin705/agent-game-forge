import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { deleteProject } from '@/lib/assets';

interface DeleteConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absolute project path passed to DELETE /api/projects. */
  projectPath: string;
  /** Display name shown in the confirmation copy. */
  projectName: string;
  /** Called after a successful delete (e.g. to refresh the list). */
  onDeleted?: () => void;
}

export function DeleteConfirm({
  open,
  onOpenChange,
  projectPath,
  projectName,
  onDeleted,
}: DeleteConfirmProps) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await deleteProject(projectPath);
      toast.success(`Removed “${projectName}”`);
      onDeleted?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete game?</DialogTitle>
          <DialogDescription>
            “{projectName}” will be removed from your games. The project files on
            disk are left untouched — only the studio listing is removed.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Removing…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
