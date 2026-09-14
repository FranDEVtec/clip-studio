#!/usr/bin/env tsx
// Onboarding: arma .env.local validando cada dato contra la API real.
//
//   npm run setup                      → interactivo (pregunta lo que falta)
//   npm run setup -- --channel=… --name=… --gemini=… --openai=… [--tiktok=… --instagram=… --apify=… --youtube-api=… --hashtag=… --cta=… --publish-time=… --timezone=… --plan=… --description=… --language=… --yes]
//
// Pensado para correrlo desde Claude Code o Codex (ver ONBOARDING.md): el
// agente pasa todo por flags y no hace falta un TTY. Las keys nunca se
// imprimen enteras: sólo los últimos 4 caracteres.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

type Flags = Record<string, string | boolean>;

const flags: Flags = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
  if (m) flags[m[1]] = m[2] ?? true;
}
const interactive = stdin.isTTY && !flags.yes;
const rl = interactive ? createInterface({ input: stdin, output: stdout }) : null;

const ok = (s: string) => console.log(`  ✓ ${s}`);
const warn = (s: string) => console.log(`  ! ${s}`);
const fail = (s: string): never => {
  console.error(`\n✗ ${s}\n`);
  process.exit(1);
};
const mask = (s: string) => (s.length <= 8 ? "••••" : `${"•".repeat(6)}${s.slice(-4)}`);

async function ask(flag: string, question: string, opts: { required?: boolean; secret?: boolean; fallback?: string } = {}): Promise<string> {
  const fromFlag = flags[flag];
  if (typeof fromFlag === "string" && fromFlag.trim()) return fromFlag.trim();
  if (!rl) {
    if (opts.required) fail(`Falta --${flag}. ${question}`);
    return opts.fallback ?? "";
  }
  const suffix = opts.fallback ? ` [${opts.fallback}]` : opts.required ? "" : " [enter para saltear]";
  const v = (await rl.question(`${question}${suffix}\n> `)).trim();
  if (!v && opts.required) return ask(flag, question, opts);
  return v || opts.fallback || "";
}

// ── YouTube ──────────────────────────────────────────────────────────────────

const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "Accept-Language": "es-AR,es;q=0.9,en;q=0.8" };

/** GET con un reintento: YouTube corta la primera conexión de vez en cuando. */
async function getText(url: string): Promise<{ status: number; text: string }> {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      return { status: res.status, text: await res.text() };
    } catch (e) {
      if (i === 1) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error("unreachable");
}

/** Acepta UC…, /channel/UC…, /@handle, /c/nombre, /user/nombre o la URL de un video. */
async function resolveChannelId(input: string): Promise<string> {
  const s = input.trim();
  if (/^UC[\w-]{22}$/.test(s)) return s;
  const direct = /youtube\.com\/channel\/(UC[\w-]{22})/.exec(s);
  if (direct) return direct[1];
  let url = s;
  if (/^@[\w.-]+$/.test(s)) url = `https://www.youtube.com/${s}`;
  else if (!/^https?:\/\//.test(s)) url = `https://www.youtube.com/@${s.replace(/^@/, "")}`;
  const { status, text: html } = await getText(url);
  if (status !== 200) fail(`YouTube devolvió ${status} para ${url}. Pasá la URL del canal (youtube.com/@handle) o de un video.`);
  // En la página de un video, el canal es el de videoDetails; en la de un canal,
  // el canónico. Un "channelId" suelto puede ser el de un canal recomendado.
  const m =
    /"videoDetails":\{[^}]*?"channelId":"(UC[\w-]{22})"/.exec(html) ??
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(html) ??
    /<meta itemprop="identifier" content="(UC[\w-]{22})"/.exec(html) ??
    /"externalId":"(UC[\w-]{22})"/.exec(html);
  if (!m) fail(`No encontré el id del canal en ${url}. Probá con la URL de un video del canal.`);
  return m[1];
}

async function inspectChannel(channelId: string): Promise<{ title: string; videos: { id: string; title: string; seconds: number | null }[] }> {
  const { status, text: xml } = await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  if (status !== 200) fail(`El RSS del canal ${channelId} devolvió ${status}.`);
  const title = /<title>([^<]*)<\/title>/.exec(xml)?.[1] ?? channelId;
  const entries = xml.split("<entry>").slice(1, 6);
  const videos = [];
  for (const e of entries) {
    const id = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(e)?.[1];
    const t = /<title>([^<]*)<\/title>/.exec(e)?.[1] ?? "";
    if (!id) continue;
    let seconds: number | null = null;
    try {
      const m = /"lengthSeconds":"(\d+)"/.exec((await getText(`https://www.youtube.com/watch?v=${id}`)).text);
      seconds = m ? Number(m[1]) : null;
    } catch {}
    videos.push({ id, title: t, seconds });
  }
  return { title: decode(title), videos };
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// ── keys ─────────────────────────────────────────────────────────────────────

async function check(label: string, url: string, init: RequestInit = {}): Promise<void> {
  const res = await fetch(url, init).catch((e) => fail(`${label}: no pude conectar (${e instanceof Error ? e.message : e}).`));
  if (!res.ok) fail(`${label}: la API respondió ${res.status}. Revisá la key.`);
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nClip Studio · setup\n");

  const channelInput = await ask("channel", "URL de tu canal de YouTube (youtube.com/@handle, /channel/UC… o la URL de un video)", { required: true });
  const channelId = await resolveChannelId(channelInput);
  const ch = await inspectChannel(channelId);
  ok(`Canal: ${ch.title} (${channelId})`);
  const minSec = Number(flags["video-min-sec"] ?? 300);
  for (const v of ch.videos) {
    const min = v.seconds === null ? "?" : `${Math.round(v.seconds / 60)} min`;
    const clipea = v.seconds !== null && v.seconds >= minSec;
    console.log(`    ${clipea ? "▸" : "·"} ${v.title.slice(0, 60)} — ${min}${clipea ? "" : " (no se clipea: corto)"}`);
  }
  if (!ch.videos.some((v) => v.seconds !== null && v.seconds >= minSec)) warn(`Ninguno de los últimos ${ch.videos.length} videos dura más de ${Math.round(minSec / 60)} min. El motor sólo clipea videos largos.`);

  const name = await ask("name", "Tu nombre, como querés que aparezca en los prompts", { required: true, fallback: ch.title });
  const description = await ask("description", "De qué va tu canal, en una línea", { fallback: "un canal de YouTube de vlogs y videos hablados" });
  const language = await ask("language", "Idioma y registro del copy", { fallback: "español rioplatense, con voseo natural" });
  const tiktok = (await ask("tiktok", "Tu usuario de TikTok (sin @)")).replace(/^@/, "");
  const instagram = (await ask("instagram", "Tu usuario de Instagram (sin @)")).replace(/^@/, "");

  const gemini = await ask("gemini", "GEMINI_API_KEY (https://aistudio.google.com/apikey)", { required: true, secret: true });
  await check("Gemini", `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(gemini)}`);
  ok(`Gemini responde (${mask(gemini)})`);

  const openai = await ask("openai", "OPENAI_API_KEY (https://platform.openai.com/api-keys)", { required: true, secret: true });
  await check("OpenAI", "https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${openai}` } });
  ok(`OpenAI responde (${mask(openai)})`);

  const apify = await ask("apify", "APIFY_TOKEN, opcional (https://console.apify.com/account/integrations)", { secret: true });
  if (apify) {
    await check("Apify", `https://api.apify.com/v2/users/me?token=${encodeURIComponent(apify)}`);
    ok(`Apify responde (${mask(apify)})`);
    if (!tiktok && !instagram) warn("Apify sin TIKTOK_USERNAME ni INSTAGRAM_USERNAME no tiene qué leer.");
  }
  const youtubeApi = await ask("youtube-api", "YOUTUBE_API_KEY, opcional (métricas de Shorts)", { secret: true });
  if (youtubeApi) {
    await check("YouTube Data API", `https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=${encodeURIComponent(youtubeApi)}`);
    ok(`YouTube Data API responde (${mask(youtubeApi)})`);
  }

  const hashtag = (await ask("hashtag", "Hashtag de tu marca, sin # (va en todas las captions)")).replace(/^#/, "").toLowerCase();
  const cta = await ask("cta", "CTA que cierra cada caption", { fallback: "▶️ Video completo en YouTube" });
  const publishTime = await ask("publish-time", "Hora de publicación (HH:MM)", { fallback: "21:00" });
  const timezone = await ask("timezone", "Zona horaria (IANA)", { fallback: "America/Argentina/Buenos_Aires" });
  const plan = await ask("plan", "Días en que sale un clip, ISO separados por coma (1=lunes … 7=domingo)", { fallback: "1,2,3,4,5,6" });
  const accessCode = (typeof flags["access-code"] === "string" && flags["access-code"]) || randomBytes(9).toString("base64url");
  const cronSecret = randomBytes(32).toString("hex");
  const databaseUrl = typeof flags["database-url"] === "string" ? flags["database-url"] : "";

  const lines = [
    "# Generado por `npm run setup`. No lo subas a git: está en .gitignore.",
    `DATABASE_URL=${databaseUrl}`,
    `ACCESS_CODE=${accessCode}`,
    `CRON_SECRET=${cronSecret}`,
    "",
    `GEMINI_API_KEY=${gemini}`,
    `OPENAI_API_KEY=${openai}`,
    `APIFY_TOKEN=${apify}`,
    `YOUTUBE_API_KEY=${youtubeApi}`,
    "",
    `YOUTUBE_CHANNEL_ID=${channelId}`,
    `TIKTOK_USERNAME=${tiktok}`,
    `INSTAGRAM_USERNAME=${instagram}`,
    "",
    `NEXT_PUBLIC_BRAND_NAME=${name}`,
    `NEXT_PUBLIC_TIMEZONE=${timezone}`,
    `NEXT_PUBLIC_LOCALE=${language.toLowerCase().startsWith("espa") ? "es-AR" : "en-US"}`,
    `CREATOR_NAME=${name}`,
    `CHANNEL_DESCRIPTION=${description}`,
    `CONTENT_LANGUAGE=${language}`,
    `BRAND_HASHTAG=${hashtag}`,
    `CTA_TEXT=${cta}`,
    `PUBLISH_TIME=${publishTime}`,
    `WEEKLY_PLAN=${plan}`,
    "",
  ];
  const target = typeof flags.out === "string" ? flags.out : ".env.local";
  if (existsSync(target) && !flags.force) {
    const prev = readFileSync(target, "utf8");
    if (prev.trim() && !prev.includes("Generado por `npm run setup`")) fail(`${target} ya existe y no lo generó este script. Borralo o pasá --force.`);
  }
  writeFileSync(target, lines.join("\n"));
  console.log(`\n✓ ${target} escrito.`);
  console.log(`  Código de acceso a la app: ${accessCode}  (guardalo: es la contraseña para entrar)`);
  if (!databaseUrl) console.log("  Falta DATABASE_URL: se completa al crear la base (ver ONBOARDING.md, paso 4).");
  rl?.close();
}

main().catch((e) => fail(e instanceof Error ? `${e.message}${e.cause ? ` (${(e.cause as Error).message})` : ""}${process.env.DEBUG ? `\n${e.stack}` : ""}` : String(e)));
