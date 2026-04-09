import { NextResponse, type NextRequest } from 'next/server';

export function middleware(_request: NextRequest) {
  const response = NextResponse.next();

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
