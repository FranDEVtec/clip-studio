import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { canonicalOrigin, finishGoogleAuth, sessionCookieHeader, STATE_COOKIE_NAME } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  try {
    if (!code || !state) throw new Error(url.searchParams.get("error") ?? "Sin code");
    const session = await finishGoogleAuth(url.origin, code, state, jar.get(STATE_COOKIE_NAME)?.value);
    const res = NextResponse.redirect(new URL("/app", canonicalOrigin(url.origin)));
    res.headers.append("Set-Cookie", sessionCookieHeader(session));
    res.headers.append("Set-Cookie", `${STATE_COOKIE_NAME}=; Path=/; Max-Age=0`);
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, canonicalOrigin(url.origin)));
  }
}
