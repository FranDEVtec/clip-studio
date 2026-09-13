import { NextResponse } from "next/server";
import { clearSessionCookieHeader } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const res = NextResponse.redirect(new URL("/login", new URL(request.url).origin), { status: 303 });
  res.headers.append("Set-Cookie", clearSessionCookieHeader());
  return res;
}
