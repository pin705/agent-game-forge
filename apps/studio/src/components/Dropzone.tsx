import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import { toast } from 'sonner';
import { ImagePlus, Loader2, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  assetUrl,
  deleteRef,
  fileToBase64,
  uploadRef,
  type RefImage,
} from '@/lib/assets';
import { useT } from '@/lib/i18n';

interface DropzoneProps {
  /** Absolute project path. Uploads are disabled until this is set. */
  projectPath: string | null;
  /** Reference images already attached to the project. */
  refs: RefImage[];
  /** Called whenever the ref list changes (after upload / delete). */
  onChange: (refs: RefImage[]) => void;
  disabled?: boolean;
  className?: string;
}

export interface DropzoneHandle {
  /** Open the OS file picker. */
  openFilePicker: () => void;
  /** Upload a list of files programmatically (e.g. from a parent drop handler). */
  uploadFiles: (files: File[] | FileList) => Promise<void>;
}

const MAX_REFS = 10;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

function fileExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function shortName(name: string, maxLen = 18): string {
  const base = name.split('/').pop() ?? name;
  if (base.length <= maxLen) return base;
  const ext = fileExt(base);
  return `${base.slice(0, maxLen - ext.length - 1)}…${ext}`;
}

/**
 * Drag-and-drop image uploader backed by the daemon's reference-image store
 * (POST /api/files/refs). Shows thumbnails of attached refs with a remove
 * button, and exposes an imperative handle so a parent can trigger the file
 * picker or feed it dropped files.
 */
export const Dropzone = forwardRef<DropzoneHandle, DropzoneProps>(function Dropzone(
  props,
  fwdRef,
) {
  const t = useT();
  const { projectPath, refs, onChange, disabled } = props;
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canUpload = !!projectPath && !disabled && !busy;

  async function uploadFiles(files: File[] | FileList) {
    if (!projectPath || disabled || busy) return;
    const slots = MAX_REFS - refs.length;
    if (slots <= 0) {
      toast.error(t('dropzone.limit', { max: MAX_REFS }));
      return;
    }
    // Only image files are accepted by the ref store.
    const accepted = Array.from(files)
      .filter((f) => IMAGE_EXT.has(fileExt(f.name)) || f.type.startsWith('image/'))
      .slice(0, slots);
    if (accepted.length === 0) {
      toast.error(t('dropzone.dropFiles'));
      return;
    }

    setBusy(true);
    const next: RefImage[] = [];
    try {
      for (const file of accepted) {
        const base64 = await fileToBase64(file);
        const r = await uploadRef({ projectPath, filename: file.name, base64 });
        next.push({ relPath: r.relPath, size: r.size, mtimeMs: Date.now() });
      }
      onChange([...next, ...refs]);
      toast.success(
        next.length === 1 ? t('dropzone.refAdded') : t('dropzone.refsAdded', { n: next.length }),
      );
    } catch (err) {
      toast.error(
        t('dropzone.uploadFailed', { error: err instanceof Error ? err.message : String(err) }),
      );
    } finally {
      setBusy(false);
    }
  }

  useImperativeHandle(fwdRef, () => ({
    openFilePicker: () => fileInputRef.current?.click(),
    uploadFiles,
  }));

  async function removeRef(relPath: string) {
    if (!projectPath) return;
    try {
      await deleteRef(projectPath, relPath);
      onChange(refs.filter((r) => r.relPath !== relPath));
    } catch (err) {
      toast.error(
        t('dropzone.removeFailed', { error: err instanceof Error ? err.message : String(err) }),
      );
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) void uploadFiles(e.dataTransfer.files);
  }

  return (
    <div className={cn('flex flex-col gap-2', props.className)}>
      <div
        role="button"
        tabIndex={canUpload ? 0 : -1}
        aria-disabled={!canUpload}
        onClick={() => canUpload && fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (canUpload && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          if (!canUpload) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center transition-colors',
          canUpload ? 'cursor-pointer hover:bg-accent/50' : 'cursor-not-allowed opacity-60',
          dragOver
            ? 'border-primary bg-accent text-foreground'
            : 'border-input text-muted-foreground',
        )}
      >
        {busy ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <Upload className="size-5" />
        )}
        <div className="text-sm">
          {busy ? (
            t('dropzone.uploading')
          ) : !projectPath ? (
            t('dropzone.openProject')
          ) : (
            <>
              <span className="font-medium text-foreground">{t('dropzone.dropImages')}</span>{' '}
              {t('dropzone.clickAttach')}
            </>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {refs.length}/{MAX_REFS} · {t('dropzone.formats')}
        </div>
      </div>

      {refs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {refs.map((r) => (
            <div
              key={r.relPath}
              title={r.relPath}
              className="group relative size-16 overflow-hidden rounded-md border bg-muted/30"
            >
              {projectPath && (
                <img
                  src={assetUrl(projectPath, r.relPath)}
                  alt={r.relPath}
                  loading="lazy"
                  className="size-full object-cover [image-rendering:pixelated]"
                />
              )}
              <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-[10px] text-white">
                {shortName(r.relPath)}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void removeRef(r.relPath);
                }}
                title={t('dropzone.remove')}
                className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          {canUpload && refs.length < MAX_REFS && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title={t('dropzone.addReference')}
              className="flex size-16 items-center justify-center rounded-md border border-dashed text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
            >
              <ImagePlus className="size-5" />
            </button>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void uploadFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
});
