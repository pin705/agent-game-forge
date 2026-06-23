import { useEffect, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { renameProject } from '@/lib/assets';

interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absolute project path (the rename key on the daemon). */
  projectPath: string;
  /** Current display name, pre-filled into the input. */
  currentName: string;
  /** Called with the new name after a successful rename. */
  onRenamed?: (name: string) => void;
}

export function RenameDialog({
  open,
  onOpenChange,
  projectPath,
  currentName,
  onRenamed,
}: RenameDialogProps) {
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState(false);

  // Re-sync the field whenever the dialog (re)opens for a project.
  useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== currentName && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await renameProject(projectPath, trimmed);
      toast.success(`Renamed to “${trimmed}”`);
      onRenamed?.(trimmed);
      onOpenChange(false);
    } catch (err) {
      toast.error(`Rename failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Rename game</DialogTitle>
          <DialogDescription>Give this game a new name.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="rename-game-name">Name</Label>
          <Input
            id="rename-game-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My game"
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={() => void submit()} disabled={!canSubmit}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
