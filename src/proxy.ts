import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function proxy(request: NextRequest) {
  // Auth check: redirect to login if not authenticated
  const token = await getToken({ req: request });
  if (!token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // CSP: generate nonce and set headers
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const response = NextResponse.next();

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: tile.openstreetmap.org *.tile.openstreetmap.org server.arcgisonline.com",
    "connect-src 'self' www.strava.com",
    "font-src 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-nonce", nonce);

  return response;
}

export const config = {
  matcher: [
    "/((?!login|privacy|toolbox|api|_next/static|_next/image|favicon.svg|sitemap.xml|robots.txt).*)",
  ],
};
