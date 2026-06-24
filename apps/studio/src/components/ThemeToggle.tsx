import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

type Theme = 'light' | 'dark';
const LS_KEY = 'ogf-theme';

/** Read the current theme from the <html> class (set pre-paint by the inline
 *  script in index.html, default dark). */
function currentTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(LS_KEY, theme);
  } catch {
    /* storage disabled — runtime toggle still works for this session */
  }
}

/** Sun/Moon header button. Studio is light-first; this flips the `.dark` class
 *  on <html> and persists the choice. Shows the icon for the theme you'd
 *  switch TO (Sun while dark, Moon while light). */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useT();
  const [theme, setTheme] = useState<Theme>(() => currentTheme());

  // Keep local state in sync if some other surface changes the class.
  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={t('app.theme')}
      title={t('app.theme')}
      className={className}
    >
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  );
}

export default ThemeToggle;
