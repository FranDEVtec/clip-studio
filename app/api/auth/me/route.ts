import { NextResponse } from "next/server";
import { authConfigured, getSession, googleConfigured } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET() {
  const s = await getSession();
  return NextResponse.json({
    session: s ? { email: s.email, name: s.name, picture: s.picture } : null,
    googleConfigured: googleConfigured(),
    authConfigured: authConfigured(),
  });
}
