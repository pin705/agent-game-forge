import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function AppShell({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
        <Link to="/" className="flex items-center gap-2.5" aria-label="Agent Game Footage">
          <img
            src="/ogf-logo-64.png"
            alt=""
            className="size-7 [image-rendering:pixelated]"
            aria-hidden
          />
          <span className="brand-title">
            <span className="brand-agent">Agent</span>
            <span className="brand-game">Game</span>
            <span className="brand-forge">Footage</span>
          </span>
        </Link>
        <div className="flex-1" />
        {right}
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
