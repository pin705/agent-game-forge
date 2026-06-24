import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Shape of the array `@supabase/ssr` passes to the `setAll` cookie writer. */
type CookiesToSet = { name: string; value: string; options: CookieOptions }[];

/**
 * Server-side Supabase client (Server Components, Server Actions, Route
 * Handlers). Bound to the request cookie store via Next's async `cookies()`.
 *
 * Created lazily at request time — never at module load — so a placeholder
 * env never crashes the build. In a pure Server Component render, cookie
 * writes are not allowed; we swallow that error because `middleware.ts`
 * already refreshes the session cookie on every request.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore; middleware
            // refreshes the session.
          }
        },
      },
    },
  );
}

/**
 * Service-role client (server-only, bypasses RLS). Use sparingly for trusted
 * server work (e.g. webhooks in later phases). Never expose to the browser.
 * Falls back gracefully: still lazy, never throws at import.
 */
export function createServiceRoleClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          /* no-op: service-role client is stateless */
        },
      },
    },
  );
}
