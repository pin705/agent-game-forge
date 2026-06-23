import { useEffect, useState } from 'react';
import { fetchFileContent } from '../lib/api.js';

// The cost story, made visible. Reads data/asset-credits.json (the broker's
// attribution ledger) and shows how many assets were fetched FREE — generation
// cost stays $0. Hidden when there's no ledger yet.
export function CostChip({ projectPath, rev }: { projectPath: string; rev?: number }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCount(null);
    fetchFileContent(projectPath, 'data/asset-credits.json')
      .then((r) => {
        if (cancelled) return;
        try {
          const parsed = JSON.parse(r.content ?? '[]');
          if (Array.isArray(parsed)) setCount(parsed.length);
        } catch {
          /* keep hidden */
        }
      })
      .catch(() => {
        /* no ledger → keep hidden */
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, rev]);

  const label = count && count > 0 ? `$0.00 · ${count} free` : '$0.00';
  return (
    <span
      className="cost-chip"
      title={count ? `${count} assets fetched free · $0 generation cost` : 'Free-first · $0 generation cost'}
    >
      {label}
    </span>
  );
}
