import { useEffect, useState } from 'react';
import { Gamepad2 } from 'lucide-react';
import { listAssets, assetUrl } from '@/lib/assets';
import { cn } from '@/lib/utils';

// Asset names that read as a game's "face" — preferred over an arbitrary
// first sprite when building a thumbnail.
const PREFER = /(icon|logo|cover|title|hero|player|character|avatar|banner)/i;

/** Resolve a representative image for a project: a name-matched asset if one
 *  exists, else the first image under assets/**. Returns null while loading
 *  or when the project has no usable image. */
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
    listAssets(path)
      .then((assets) => {
        if (cancelled) return;
        const imgs = assets.filter((a) => a.mediaKind === 'image');
        if (imgs.length === 0) {
          setFailed(true);
          return;
        }
        const pick = imgs.find((a) => PREFER.test(a.relPath)) ?? imgs[0];
        setSrc(assetUrl(path, pick.relPath));
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
