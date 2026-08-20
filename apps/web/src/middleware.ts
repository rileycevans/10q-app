import { NextResponse, type NextRequest } from 'next/server';

/**
 * Cache headers only.
 *
 * This used to construct a cookie-backed Supabase client and call
 * `supabase.auth.getUser()` on every request to refresh the session, with a
 * comment saying it was "required for Server Components". That stopped being
 * true — if it ever was. There are no Server Actions, nothing calls
 * `cookies()`, and the only non-client pages are the static legal pages. Every
 * screen is a client component holding its own session and calling Edge
 * Functions with a bearer token.
 *
 * So the refresh was doing real work — a network round trip to Supabase on
 * every single page request — for a consumer that does not exist. Removing it
 * also lets the session move from cookies to localStorage, which is what makes
 * web and native share one client construction (see src/platform/session.*).
 *
 * There is no middleware in the native build at all; build-native.sh moves
 * this file aside. Anything essential must not live here.
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  // Prevent browsers from serving stale HTML after deployments or redirects.
  // Static assets (JS/CSS with content hashes) are excluded by the matcher below.
  response.headers.set('Cache-Control', 'no-store');

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
