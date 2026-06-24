import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Shape of the array `@supabase/ssr` passes to the `setAll` cookie writer. */
type CookiesToSet = { name: string; value: string; options: CookieOptions }[];

/**
 * Protected path prefixes — the URL-visible routes inside the `app/(app)`
 * route group. (Route-group folders like `(app)` do NOT appear in the URL,
 * so we match the real pathnames they render.)
 */
const PROTECTED_PREFIXES = ["/dashboard", "/build"];

/**
 * Auth-only routes — an already-authenticated user hitting these is bounced to
 * the dashboard (no point showing login/signup when signed in).
 */
const AUTH_ROUTES = ["/login", "/signup"];

/**
 * Refreshes the Supabase session on every request and guards protected
 * routes. Must run in middleware so the refreshed auth cookie is written
 * back on the response (Server Components can't set cookies).
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run logic between createServerClient and getUser() — it
  // refreshes the token and keeps server/browser sessions in sync.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(url);
  }

  // Signed-in users have no business on /login or /signup → send to dashboard.
  const isAuthRoute = AUTH_ROUTES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (isAuthRoute && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
