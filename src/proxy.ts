import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SCOPE_COOKIE, newScope, scopeCookieOptions } from "@/lib/session";

/**
 * Guarantees an anonymous scope cookie exists before any page renders.
 *
 * Doing this here rather than in a layout means the very first server render
 * of the suite already knows which session it is reading, so a visitor never
 * sees a populated page belong to somebody else and never gets a flash of
 * "empty" before their own rows appear.
 */
export function proxy(request: NextRequest): NextResponse {
  const existing = request.cookies.get(SCOPE_COOKIE)?.value;

  if (existing && /^[0-9a-f]{32}$/.test(existing)) {
    return NextResponse.next();
  }

  const scope = newScope();
  const response = NextResponse.next();
  response.cookies.set(SCOPE_COOKIE, scope, scopeCookieOptions());
  return response;
}

export const config = {
  matcher: [
    // Everything that can render or mutate, and nothing static.
    "/((?!_next/static|_next/image|favicon.ico|mcp.json|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};