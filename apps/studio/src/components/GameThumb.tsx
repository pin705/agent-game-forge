import { useEffect, useState } from 'react';
import { Gamepad2 } from 'lucide-react';
import { assetUrl, type FileNode } from '@/lib/assets';
import { cn } from '@/lib/utils';

// Asset names that read as a game's "face" — preferred over an arbitrary
// first sprite when building a thumbnail.
const PREFER = /(icon|logo|cover|title|hero|player|character|avatar|banner|splash|menu)/i;

/** Collect every image file's POSIX relPath in the project tree. */
function collectImages(node: FileNode | null): string[] {
  const out: string[] = [];
  const walk = (n: FileNode) => {
    if (n.kind === 'file') {
      if (n.fileKind === 'image') out.push(n.relPath.replace(/\\/g, '/'));
    } else {
      for (const c of n.children ?? []) walk(c);
    }
  };
  if (node) walk(node);
  return out;
}

/** Pick the most "thumbnail-worthy" image: name-matched first, then images
 *  under assets/, then the shallowest path. Reference uploads / .ogf
 *  internals are excluded so they never become a cover. */
function pickThumb(images: string[]): string | null {
  const candidates = images.filter((p) => !/(^|\/)(\.ogf|refs)(\/|$)/i.test(p) && !p.startsWith('.'));
  if (candidates.length === 0) return null;
  const score = (p: string): number => {
    let s = -p.split('/').length; // shallower paths rank higher
    if (PREFER.test(p)) s += 100;
    if (p.startsWith('assets/')) s += 10;
    return s;
  };
  return [...candidates].sort((a, b) => score(b) - score(a))[0];
}

/** Resolve a representative image for a project by scanning the whole file
 *  tree (not just assets/**), so games that keep art anywhere still get a
 *  cover. Returns null while loading or when no usable image exists. */
function useGameThumb(path: string | undefined): { src: string | null; failed: boolean } {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    if (!path) {
      setFailed(true);
      return;
    }
    fetch(`/api/files/tree?projectPath=${encodeURIComponent(path)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { tree?: FileNode }) => {
        if (cancelled) return;
        const pick = pickThumb(collectImages(data.tree ?? null));
        if (!pick) {
          setFailed(true);
          return;
        }
        setSrc(assetUrl(path, pick));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return { src, failed };
}

/** Small square game icon for headers. Falls back to a monogram (first letter
 *  of the game name) while loading or when no image is available. */
export function GameIcon({
  path,
  name,
  className,
}: {
  path: string | undefined;
  name?: string;
  className?: string;
}) {
  const { src, failed } = useGameThumb(path);
  const [imgError, setImgError] = useState(false);
  const monogram = name?.trim()?.[0]?.toUpperCase() ?? '?';
  const showImg = src && !failed && !imgError;

  return (
    <span
      className={cn(
        'grid size-7 shrink-0 place-items-center overflow-hidden rounded-md bg-primary text-[13px] font-semibold uppercase text-primary-foreground',
        className,
      )}
    >
      {showImg ? (
        <img
          src={src}
          alt=""
          className="size-full object-cover [image-rendering:pixelated]"
          onError={() => setImgError(true)}
        />
      ) : (
        monogram
      )}
    </span>
  );
}

/** Wide cover banner for project cards. Falls back to the gradient + gamepad
 *  placeholder while loading or when no image is available. */
export function GameCover({ path, className }: { path: string | undefined; className?: string }) {
  const { src, failed } = useGameThumb(path);
  const [imgError, setImgError] = useState(false);
  const showImg = src && !failed && !imgError;

  return (
    <div
      className={cn(
        'flex items-center justify-center overflow-hidden bg-gradient-to-br from-primary/20 to-emerald-500/10',
        className,
      )}
    >
      {showImg ? (
        <img
          src={src}
          alt=""
          className="size-full object-cover [image-rendering:pixelated]"
          onError={() => setImgError(true)}
        />
      ) : (
        <Gamepad2 className="size-8 text-primary/70" />
      )}
    </div>
  );
}
