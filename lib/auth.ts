// Acceso: login con Google restringido a una lista de mails, o código de acceso.
//
// Sin dependencias: OAuth 2.0 (authorization code + PKCE) contra Google, se
// verifica el id_token con el endpoint tokeninfo de Google, y si el mail está
// en ALLOWED_EMAILS se firma una cookie de sesión (HMAC-SHA256 con AUTH_SECRET,
// 30 días). Requiere GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET y la redirect URI
// https://<tu-dominio>/api/auth/callback/google.
//
// Si Google no está configurado, la app acepta el código de acceso
// (ACCESS_CODE). Si no hay NADA configurado, la app falla cerrada: nadie entra.

import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "studio_session";
const STATE_COOKIE = "studio_oauth";
const SESSION_DAYS = 30;

export const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.AUTH_SECRET && ALLOWED_EMAILS.length);
}

/** ¿Hay alguna forma de entrar? Sin esto, todo responde 503 en vez de abrir la app al mundo. */
export function authConfigured(): boolean {
  return googleConfigured() || Boolean(process.env.ACCESS_CODE && process.env.ACCESS_CODE.length >= 8);
}

/** Origen canónico de la app; las redirect URIs de OAuth siempre apuntan ahí. */
export function canonicalOrigin(origin: string): string {
  return process.env.CANONICAL_ORIGIN || origin;
}

export function redirectUri(origin: string): string {
  return process.env.GOOGLE_REDIRECT_URI || `${canonicalOrigin(origin)}/api/auth/callback/google`;
}

// ── firma ─────────────────────────────────────────────────────────────────────
function sign(payload: string): string {
  // Sin AUTH_SECRET no hay sesiones firmadas: se deriva del código de acceso
  // para que las cookies sigan valiendo algo, y se exige uno u otro.
  const secret = process.env.AUTH_SECRET || (process.env.ACCESS_CODE ? `code:${process.env.ACCESS_CODE}` : "");
  if (!secret) throw new Error("Falta AUTH_SECRET");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export type Session = { email: string; name?: string; picture?: string; exp: number };

export function encodeSession(s: Session): string {
  const payload = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(token: string | undefined): Session | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    if (!s.email || s.exp < Date.now()) return null;
    if (!ALLOWED_EMAILS.includes(s.email.toLowerCase())) return null;
    return s;
  } catch {
    return null;
  }
}

/** Sesión actual desde la cookie (server side). */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return decodeSession(jar.get(SESSION_COOKIE)?.value);
}

/**
 * ¿La request está autorizada? Sesión de Google válida, o el código de acceso
 * (header x-access-code o cookie del gate viejo). El código sigue valiendo para
 * curl/cron y como respaldo hasta que Google esté configurado.
 */
export async function isAuthorized(request: Request): Promise<boolean> {
  if (!authConfigured()) return false;
  const jar = await cookies();
  if (decodeSession(jar.get(SESSION_COOKIE)?.value)) return true;
  const code = request.headers.get("x-access-code") ?? "";
  const expected = process.env.ACCESS_CODE ?? "";
  if (!expected || code.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(code), Buffer.from(expected));
}

// ── OAuth ─────────────────────────────────────────────────────────────────────
export async function beginGoogleAuth(origin: string): Promise<{ url: string; cookie: string }> {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  u.searchParams.set("redirect_uri", redirectUri(origin));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("prompt", "select_account");
  const cookie = `${STATE_COOKIE}=${encodeSession({ email: `${state}|${verifier}`, exp: Date.now() + 10 * 60_000 } as Session)}`;
  return { url: u.toString(), cookie };
}

export async function finishGoogleAuth(origin: string, code: string, state: string, stateCookie: string | undefined): Promise<Session> {
  const [payload, sig] = (stateCookie ?? "").split(".");
  if (!payload || sig !== sign(payload)) throw new Error("Estado OAuth inválido");
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as { email: string; exp: number };
  const [savedState, verifier] = parsed.email.split("|");
  if (savedState !== state || parsed.exp < Date.now()) throw new Error("Estado OAuth vencido");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`Google token: ${res.status}`);
  const t = (await res.json()) as { id_token: string };
  const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(t.id_token)}`);
  if (!info.ok) throw new Error("No pude verificar el id_token");
  const claims = (await info.json()) as { email?: string; email_verified?: string; aud?: string; name?: string; picture?: string };
  if (claims.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error("id_token de otro cliente");
  const email = (claims.email ?? "").toLowerCase();
  if (claims.email_verified !== "true" || !ALLOWED_EMAILS.includes(email)) {
    throw new Error(`La cuenta ${email || "?"} no está habilitada`);
  }
  return { email, name: claims.name, picture: claims.picture, exp: Date.now() + SESSION_DAYS * 86400_000 };
}

export function sessionCookieHeader(s: Session): string {
  return `${SESSION_COOKIE}=${encodeSession(s)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}
export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
export function stateCookieHeader(cookie: string): string {
  return `${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}
export const STATE_COOKIE_NAME = STATE_COOKIE;
