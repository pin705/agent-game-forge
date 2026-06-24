import Link from "next/link";
import { ChevronDown, LogOut } from "lucide-react";
import { signOut } from "@/app/auth/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * App top nav: wordmark + user email with a sign-out dropdown.
 * `email` and `credits` come from the protected layout (server-fetched).
 */
export function TopNav({ email, credits }: { email: string; credits: number | null }) {
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <Link href="/dashboard" className="flex items-center gap-2">
        <span className="text-sm font-semibold tracking-tight">Footage</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          P0
        </span>
      </Link>

      <div className="flex items-center gap-3">
        {credits !== null && (
          <span className="hidden text-xs text-muted-foreground sm:inline-block tabular-nums">
            {credits} credits
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-accent">
            <span className="max-w-[180px] truncate">{email}</span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
              {email}
            </DropdownMenuLabel>
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
