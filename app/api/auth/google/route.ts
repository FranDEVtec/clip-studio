import { NextResponse } from "next/server";
import { beginGoogleAuth, canonicalOrigin, googleConfigured, stateCookieHeader } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  // La cookie de estado tiene que vivir en el host canónico (donde vuelve Google).
  if (canonicalOrigin(origin) !== origin) return NextResponse.redirect(`${canonicalOrigin(origin)}/api/auth/google`);
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL("/login?error=google-no-configurado", origin));
  }
  const { url, cookie } = await beginGoogleAuth(origin);
  const res = NextResponse.redirect(url);
  res.headers.append("Set-Cookie", stateCookieHeader(cookie));
  return res;
}
