import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Flame } from 'lucide-react';
import { LanguageToggle } from '@/components/LanguageToggle';
import { useT } from '@/lib/i18n';

export function AppShell({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const t = useT();
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 text-[15px] font-medium">
          <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
            <Flame className="size-4" />
          </span>
          {t('app.brand')}
        </Link>
        <div className="flex-1" />
        <LanguageToggle />
        {right}
        <div className="size-8 rounded-full bg-gradient-to-br from-primary to-emerald-400" aria-hidden />
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
