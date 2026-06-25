import Link from "next/link";
import { Coins, Compass, LogOut, Plus } from "lucide-react";
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
import { TopNavActions } from "@/components/top-nav-actions";
import { SettingsMenuItem } from "@/components/settings-menu-item";

/**
 * App top nav: wordmark + user email with a sign-out dropdown.
 * `email` and `credits` come from the protected layout (server-fetched).
 */
export function TopNav({ email, credits }: { email: string; credits: number | null }) {
  const initial = (email?.trim()?.[0] ?? "?").toUpperCase();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <Link
        href="/dashboard"
        className="flex items-center gap-2.5"
        aria-label="Agent Game Footage"
      >
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

      <div className="flex items-center gap-3">
        {/* Gallery → public discovery surface (P5). */}
        <Link
          href="/gallery"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Compass className="size-3.5" />
          <span className="hidden sm:inline">Gallery</span>
        </Link>
        {/* Credits chip → /billing top-up. Shows balance; doubles as the
            "buy credits" entry point (§5). */}
        <Link
          href="/billing"
          className="group flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Nạp credits (Top up)"
        >
          <Coins className="size-3.5" />
          {credits !== null ? (
            <span className="tabular-nums">{credits} credits</span>
          ) : (
            <span>Credits</span>
          )}
          <Plus className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
        </Link>
        <TopNavActions />
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
              {/* Server action sign-out; rendered as a menu item button. */}
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
