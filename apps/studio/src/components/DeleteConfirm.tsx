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
import { useT } from '@/lib/i18n';

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
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await deleteProject(projectPath);
      toast.success(t('delete.success', { name: projectName }));
      onDeleted?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(t('delete.failed', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('delete.title')}</DialogTitle>
          <DialogDescription>
            {t('delete.description', { name: projectName })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              {t('common.cancel')}
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
            {busy ? t('delete.removing') : t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
