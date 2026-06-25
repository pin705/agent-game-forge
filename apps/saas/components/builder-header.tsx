import Link from "next/link";
import { Coins, LogOut, Plus } from "lucide-react";
import { signOut } from "@/app/auth/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { TopNavActions } from "@/components/top-nav-actions";
import { SettingsMenuItem } from "@/components/settings-menu-item";
import { BuilderBrandLink } from "@/components/builder-brand-link";
import { PublishButton } from "@/components/publish-button";
import { RemixButton } from "@/components/remix-button";

type PublishInitial = {
  isPublished: boolean;
  url: string | null;
  playCount: number;
};

/**
 * Single compact build header (~h-12) — replaces the OLD stack of the global
 * TopNav (h-14) + the build sub-header (~h-12). It folds BOTH into one bar so
 * the editor reclaims a full header's worth of vertical space:
 *
 *   Left  : brand logo → /dashboard (through the unsaved-changes nav guard) +
 *           project name + /slug (compact, truncating).
 *   Right : credits chip (→ /billing), ⌘K palette trigger, Remix, Publish, and
 *           the account avatar dropdown (Settings + Sign out) — every affordance
 *           the global TopNav used to carry.
 *
 * The standalone "DeepSeek" model chip is dropped: the StatusBar already shows
 * the active model, so it was redundant. On small screens the credits/⌘K labels
 * collapse to icons but Publish stays visible.
 */
export function BuilderHeader({
  projectId,
  projectName,
  projectSlug,
  email,
  credits,
  publishInitial,
}: {
  projectId: string;
  projectName: string;
  projectSlug: string;
  email: string;
  credits: number | null;
  publishInitial: PublishInitial;
}) {
  const initial = (email?.trim()?.[0] ?? "?").toUpperCase();
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b bg-background/80 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {/* Left: brand → dashboard (guarded) + project name/slug. */}
      <BuilderBrandLink />
      <Separator orientation="vertical" className="h-5" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium leading-tight">{projectName}</p>
        <p className="truncate text-xs leading-tight text-muted-foreground">/{projectSlug}</p>
      </div>

      {/* Right: credits + ⌘K + Remix + Publish + account. */}
      <div className="ml-auto flex items-center gap-2">
        <Link
          href="/billing"
          className="group flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Nạp credits (Top up)"
        >
          <Coins className="size-3.5" />
          {credits !== null ? (
            <span className="hidden tabular-nums sm:inline">{credits} credits</span>
          ) : (
            <span className="hidden sm:inline">Credits</span>
          )}
          <Plus className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
        </Link>
        <TopNavActions />
        <RemixButton srcRef={projectId} variant="ghost" />
        <PublishButton projectId={projectId} initial={publishInitial} />
        <DropdownMenu>
          <DropdownMenuTrigger
            className="rounded-full outline-none ring-offset-0 focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Account"
          >
            <Avatar className="size-8 transition-opacity hover:opacity-90">
              <AvatarFallback className="bg-primary text-xs font-medium text-primary-foreground">
                {initial}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
              {email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <SettingsMenuItem />
            <DropdownMenuSeparator />
            <form action={signOut}>
              <button type="submit" className="w-full">
                <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive">
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </button>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
