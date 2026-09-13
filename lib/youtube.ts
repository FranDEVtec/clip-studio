// Detección de episodios nuevos por el RSS público del canal.
//
// Por qué RSS y no la Data API: no necesita clave ni OAuth (el refresh token de
// la Data API caducaba cada 7 días en Vercel y tumbó la web app de carruseles),
// y desde una IP de datacenter funciona sin problema — a diferencia de bajar el
// video o los subtítulos, que YouTube bloquea. Trae los últimos 15 videos, que
// para un podcast semanal es más que suficiente.

import { YOUTUBE_CHANNEL_ID } from "@/lib/config";

export type FeedVideo = { videoId: string; title: string; publishedAt: string; url: string };

export async function fetchChannelFeed(channelId = YOUTUBE_CHANNEL_ID): Promise<FeedVideo[]> {
  if (!channelId) throw new Error("Falta YOUTUBE_CHANNEL_ID (el id UC… del canal)");
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, {
    headers: { "User-Agent": "Mozilla/5.0 (podcast-clip-studio)" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`RSS del canal devolvió ${res.status}`);
  const xml = await res.text();
  const out: FeedVideo[] = [];
  const entries = xml.split("<entry>").slice(1);
  for (const e of entries) {
    const videoId = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(e)?.[1];
    const title = /<title>([^<]*)<\/title>/.exec(e)?.[1];
    const publishedAt = /<published>([^<]+)<\/published>/.exec(e)?.[1];
    if (!videoId || !title || !publishedAt) continue;
    out.push({
      videoId,
      title: decodeXml(title),
      publishedAt,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    });
  }
  return out;
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Duración del video en segundos, leída de la página pública (`lengthSeconds`). El RSS no la
 * trae, y un canal que sube también cortes del episodio los haría pasar por episodios nuevos.
 * Devuelve null si la página no se pudo leer.
 */
export async function fetchVideoLengthSec(videoId: string): Promise<number | null> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "Accept-Language": "es-AR,es;q=0.9" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const m = /"lengthSeconds":"(\d+)"/.exec(await res.text());
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** Acepta URL de youtube.com / youtu.be / Shorts o un ID pelado. */
export function parseVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m =
    /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/.exec(s) ??
    /youtube\.com\/.*[?&]v=([\w-]{11})/.exec(s);
  return m?.[1] ?? null;
}

/** Los Shorts del canal también entran al RSS; se filtran por título/duración desconocida
 *  no se puede, así que se usa oEmbed sólo para confirmar que el video existe y es público. */
export async function fetchOEmbedTitle(videoId: string): Promise<string | null> {
  const res = await fetch(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
    { cache: "no-store" },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { title?: string };
  return data.title ?? null;
}
