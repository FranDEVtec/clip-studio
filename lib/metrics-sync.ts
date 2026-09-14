// Métricas automáticas: Apify (TikTok + Instagram) y YouTube Data API.
//
// Por qué así y no las APIs oficiales de TikTok/Instagram: las oficiales dan
// las métricas propias completas pero exigen crear apps y pasar revisión de
// Meta/TikTok. Apify scrapea los perfiles públicos sin aprobaciones: TikTok devuelve views, likes, comments, shares y SAVES
// (collectCount); Instagram devuelve likes, comments y plays (saves/shares sólo
// los ve el dueño en la app: se cargan a mano si hacen falta). YouTube da
// views/likes/comments de los Shorts con una API key.
//
// Emparejamiento: cada post del perfil se compara con las piezas del calendario
// por tipo (video↔clip), fecha (±3 días) y caption. Si se pegó la URL del
// post en la pieza, esa manda. Un post de video publicado el mismo día que
// una única pieza agendada también empareja aunque el caption se haya
// reescrito al publicar. Se guarda de dónde salió cada dato (source: "auto")
// y no se pisan los campos que sólo se cargan a mano.

import type { Item, Metrics, Platform, PublishedPost, State } from "@/lib/store";
import { logLine } from "@/lib/store";
import { normalize } from "@/lib/openai";
import { BRAND_HASHTAG, INSTAGRAM_USERNAME, PUBLISH_TIME, TIKTOK_USERNAME, TIMEZONE } from "@/lib/config";
const APIFY = "https://api.apify.com/v2/acts";

export type SocialPost = {
  network: Platform;
  id: string;
  url: string;
  publishedAt: string; // ISO
  kind: "clip" | "carousel";
  text: string;
  metrics: Partial<Metrics>;
};

export function metricsConfigured(): { apify: boolean; youtube: boolean; tiktok: boolean; instagram: boolean } {
  return {
    apify: Boolean(process.env.APIFY_TOKEN),
    youtube: Boolean(process.env.YOUTUBE_API_KEY),
    tiktok: Boolean(process.env.APIFY_TOKEN && TIKTOK_USERNAME),
    instagram: Boolean(process.env.APIFY_TOKEN && INSTAGRAM_USERNAME),
  };
}

async function apifyRun(actor: string, input: unknown, timeoutSec = 240): Promise<unknown[]> {
  const res = await fetch(`${APIFY}/${actor}/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}&timeout=${timeoutSec}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Apify ${actor} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function fetchTikTok(limit = 30): Promise<SocialPost[]> {
  const rows = (await apifyRun("clockworks~tiktok-profile-scraper", {
    profiles: [TIKTOK_USERNAME],
    resultsPerPage: limit,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadSubtitles: false,
    shouldDownloadSlideshowImages: false,
  })) as Record<string, unknown>[];
  return rows
    .filter((r) => r.id && r.createTimeISO)
    .map((r) => ({
      network: "tiktok" as const,
      id: String(r.id),
      url: String(r.webVideoUrl ?? `https://www.tiktok.com/@${TIKTOK_USERNAME}/video/${r.id}`),
      publishedAt: String(r.createTimeISO),
      // imagePost no es fiable; la cantidad de imágenes sí.
      kind: (Array.isArray(r.slideshowImageLinks) && r.slideshowImageLinks.length > 1 ? "carousel" : "clip") as "clip" | "carousel",
      text: String(r.text ?? ""),
      metrics: {
        views: num(r.playCount),
        likes: num(r.diggCount),
        comments: num(r.commentCount),
        shares: num(r.shareCount),
        saves: num(r.collectCount),
        reposts: num(r.repostCount),
        duracionSeg: num((r.videoMeta as Record<string, unknown> | undefined)?.duration),
        audioOriginal: Boolean((r.musicMeta as Record<string, unknown> | undefined)?.musicOriginal),
        audioNombre: String((r.musicMeta as Record<string, unknown> | undefined)?.musicName ?? "") || undefined,
        hashtags: Array.isArray(r.hashtags) ? (r.hashtags as { name?: string }[]).map((h) => h.name ?? "").filter(Boolean) : undefined,
        hora: r.createTimeISO ? horaLocal(String(r.createTimeISO)) : undefined,
        seguidoresCuenta: num((r.authorMeta as Record<string, unknown> | undefined)?.fans),
        slides: Array.isArray(r.slideshowImageLinks) ? (r.slideshowImageLinks as unknown[]).length : undefined,
      },
    }));
}

export async function fetchInstagram(limit = 30): Promise<SocialPost[]> {
  const rows = (await apifyRun("apify~instagram-scraper", {
    directUrls: [`https://www.instagram.com/${INSTAGRAM_USERNAME}/`],
    resultsType: "posts",
    resultsLimit: limit,
    addParentData: false,
  })) as Record<string, unknown>[];
  return rows
    .filter((r) => r.url && r.timestamp)
    .map((r) => ({
      network: "instagram" as const,
      id: String(r.shortCode ?? r.id ?? r.url),
      url: String(r.url),
      publishedAt: String(r.timestamp),
      kind: (r.type === "Sidecar" || (Array.isArray(r.childPosts) && r.childPosts.length > 1) ? "carousel" : "clip") as "clip" | "carousel",
      text: String(r.caption ?? ""),
      metrics: {
        views: num(r.videoPlayCount) ?? num(r.videoViewCount),
        likes: num(r.likesCount),
        comments: num(r.commentsCount),
        hashtags: Array.isArray(r.hashtags) ? (r.hashtags as string[]) : undefined,
        hora: r.timestamp ? horaLocal(String(r.timestamp)) : undefined,
        colaboracion: Array.isArray(r.coauthorProducers) && r.coauthorProducers.length > 0,
        slides: Array.isArray(r.childPosts) ? (r.childPosts as unknown[]).length : undefined,
      },
    }));
}

/** Shorts del canal: RSS ya los lista; las estadísticas salen de la Data API. */
export async function fetchYouTubeStats(videoIds: string[]): Promise<Record<string, Partial<Metrics>>> {
  const out: Record<string, Partial<Metrics>> = {};
  if (!process.env.YOUTUBE_API_KEY || !videoIds.length) return out;
  for (let i = 0; i < videoIds.length; i += 50) {
    const ids = videoIds.slice(i, i + 50).join(",");
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids}&key=${process.env.YOUTUBE_API_KEY}`);
    if (!res.ok) throw new Error(`YouTube API ${res.status}`);
    const data = (await res.json()) as { items: { id: string; statistics: Record<string, string> }[] };
    for (const it of data.items ?? []) {
      out[it.id] = { views: num(it.statistics.viewCount), likes: num(it.statistics.likeCount), comments: num(it.statistics.commentCount) };
    }
  }
  return out;
}

function num(x: unknown): number | undefined {
  if (x === null || x === undefined || x === "") return undefined;
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

// ── emparejamiento ────────────────────────────────────────────────────────────

function itemText(it: Item): string {
  if (it.clip) return `${it.clip.caption} ${it.clip.tituloInterno} ${it.clip.pieces.claim} ${it.clip.pieces.cita_textual}`;
  return "";
}

// Palabras que aparecen en TODAS las piezas y no distinguen nada.
const STOP = new Set(
  [BRAND_HASHTAG, ...
  "video videos completo canal youtube comentá comenta mandamos pasamos link cosas contó conto aprendimos sentamos nuestro nuestra sobre para como cuando donde entre desde hasta también tambien porque pero este esta estos estas ese esa eso aquel mira mirá tiktok instagram reels reel clip carrusel hoy disponible nuevo nueva".split(" ")].filter(Boolean),
);
function words(t: string): Set<string> {
  return new Set(
    normalize(t.replace(/#\S+/g, " ").replace(/@\S+/g, " "))
      .split(" ")
      .filter((w) => w.length > 3 && !STOP.has(w)),
  );
}

/** Similitud: proporción de palabras distintivas del post que aparecen en la pieza. */
function similarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.size < 3 || !wb.size) return 0;
  let hit = 0;
  for (const w of wa) if (wb.has(w)) hit++;
  return hit / Math.min(wa.size, 12);
}

/** Hora local de un ISO: la hora de publicación es una palanca. */
function horaLocal(iso: string): number | undefined {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", hour12: false }).format(d));
}

/** Instante UTC de una fecha local a la hora de publicación, en la zona configurada. */
function localInstant(date: string, time = PUBLISH_TIME): number {
  const naive = Date.parse(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(naive));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asLocal = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return naive - (asLocal - naive);
}

function daysBetween(isoA: string, dateB: string): number {
  const a = new Date(isoA).getTime();
  return Math.abs(a - localInstant(dateB)) / 86400_000;
}

export function matchPosts(state: State, posts: SocialPost[]): { item: Item; post: SocialPost; how: "manual" | "auto"; score: number }[] {
  const out: { item: Item; post: SocialPost; how: "manual" | "auto"; score: number }[] = [];
  const takenItems = new Set<string>();
  // 1) URLs pegadas a mano mandan.
  for (const it of state.items) {
    for (const p of posts) {
      const manual = it.posts?.[p.network]?.url;
      if (manual && sameUrl(manual, p.url)) {
        out.push({ item: it, post: p, how: "manual", score: 1 });
        takenItems.add(`${it.id}:${p.network}`);
      }
    }
  }
  // 2) El resto, por tipo + fecha + texto.
  for (const p of posts) {
    if (out.some((m) => m.post.id === p.id && m.post.network === p.network)) continue;
    if (p.kind !== "clip") continue;
    const libres = state.items.filter((it) => it.clip && !takenItems.has(`${it.id}:${p.network}`));
    // Piezas a un día o menos del post. Si hay UNA sola, el calendario ya
    // dice cuál es aunque el caption se haya reescrito al publicar.
    const vecinas = libres.filter((it) => daysBetween(p.publishedAt, it.date) <= 1);
    let best: { item: Item; score: number } | null = null;
    for (const it of libres) {
      const days = daysBetween(p.publishedAt, it.date);
      if (days > 3) continue;
      const sim = similarity(p.text, itemText(it));
      const unica = vecinas.length === 1 && vecinas[0] === it;
      if (sim < 0.35 && !unica) continue;
      const score = sim * 0.6 + (unica ? 0.25 : 0) + (1 - days / 3) * 0.15;
      if (!best || score > best.score) best = { item: it, score };
    }
    if (best) {
      out.push({ item: best.item, post: p, how: "auto", score: best.score });
      takenItems.add(`${best.item.id}:${p.network}`);
    }
  }
  return out;
}

function sameUrl(a: string, b: string): boolean {
  const clean = (u: string) => u.trim().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/$/, "");
  return clean(a) === clean(b);
}

/** Aplica métricas de un post a una pieza sin pisar lo cargado a mano que el scraper no trae. */
export function applyMetrics(it: Item, network: Platform, incoming: Partial<Metrics>, source: string, opts: { autoPublish?: boolean } = {}): boolean {
  const prev = it.metrics?.[network];
  const merged: Metrics = { ...(prev ?? { updatedAt: "" }), updatedAt: new Date().toISOString(), source } as Metrics;
  let changed = false;
  for (const [k, v] of Object.entries(incoming)) {
    if (v === undefined) continue;
    if ((merged as Record<string, unknown>)[k] !== v) changed = true;
    (merged as Record<string, unknown>)[k] = v;
  }
  if (!changed && prev) return false;
  it.metrics = { ...(it.metrics ?? {}), [network]: merged };
  // Sólo se marca publicada si el emparejamiento es confiable Y la fecha ya
  // pasó. Un emparejamiento automático flojo marcaba como publicadas piezas
  // FUTURAS y desordenaba el calendario.
  const yaPaso = it.date <= new Date().toISOString().slice(0, 10);
  if (it.status !== "published" && opts.autoPublish !== false && yaPaso) {
    it.status = "published";
    it.publishedAt = it.publishedAt ?? new Date().toISOString();
  }
  return true;
}

/**
 * Guarda todo lo leído, empareje o no.
 *
 * El scraper trae los últimos 30 posts de cada cuenta; antes sólo sobrevivían
 * los que matcheaban una pieza del calendario. Acá se hace upsert por
 * `${network}:${id}`: si el post ya estaba se le actualizan las métricas y se
 * le agrega un snapshot al historial (uno por día, los últimos 12), y si es
 * nuevo se da de alta. Nada se borra: un post que cae del feed de los últimos
 * 30 sigue siendo una observación válida para el modelo.
 */
function guardarPosts(
  state: State,
  posts: SocialPost[],
  matches: Map<string, { item: Item; how: "manual" | "auto" }>,
): { nuevos: number; actualizados: number } {
  const ahora = new Date().toISOString();
  const hoy = ahora.slice(0, 10);
  const guardados = state.posts ?? [];
  const porClave = new Map(guardados.map((p) => [`${p.network}:${p.id}`, p]));
  let nuevos = 0;
  let actualizados = 0;

  for (const p of posts) {
    const clave = `${p.network}:${p.id}`;
    const m = matches.get(clave);
    const metrics = p.metrics as Metrics;
    const prev = porClave.get(clave);
    if (prev) {
      prev.metrics = { ...prev.metrics, ...metrics };
      prev.text = p.text || prev.text;
      prev.url = p.url || prev.url;
      prev.lastSeenAt = ahora;
      if (m) {
        prev.itemId = m.item.id;
        prev.matchedBy = m.how;
      }
      const hist = { ...(prev.history ?? {}), [hoy]: prev.metrics };
      const dias = Object.keys(hist).sort().slice(-12);
      prev.history = Object.fromEntries(dias.map((d) => [d, hist[d]]));
      actualizados++;
    } else {
      guardados.push({
        network: p.network,
        id: p.id,
        url: p.url,
        publishedAt: p.publishedAt,
        kind: p.kind,
        text: p.text,
        metrics,
        history: { [hoy]: metrics },
        itemId: m?.item.id,
        matchedBy: m?.how,
        firstSeenAt: ahora,
        lastSeenAt: ahora,
      });
      nuevos++;
    }
  }

  state.posts = guardados.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  if (nuevos) logLine(state, `Publicaciones: ${nuevos} nuevas, ${actualizados} actualizadas (${state.posts.length} en total).`);
  return { nuevos, actualizados };
}

export async function syncMetrics(state: State): Promise<{ matched: number; updated: number; posts: number; errors: string[] }> {
  const errors: string[] = [];
  const posts: SocialPost[] = [];
  const cfg = metricsConfigured();
  if (cfg.apify) {
    const [tt, ig] = await Promise.allSettled([
      cfg.tiktok ? fetchTikTok(30) : Promise.reject(new Error("falta TIKTOK_USERNAME")),
      cfg.instagram ? fetchInstagram(30) : Promise.reject(new Error("falta INSTAGRAM_USERNAME")),
    ]);
    if (tt.status === "fulfilled") posts.push(...tt.value);
    else errors.push(`TikTok: ${tt.reason instanceof Error ? tt.reason.message : tt.reason}`);
    if (ig.status === "fulfilled") posts.push(...ig.value);
    else errors.push(`Instagram: ${ig.reason instanceof Error ? ig.reason.message : ig.reason}`);
  } else {
    errors.push("Falta APIFY_TOKEN: sin TikTok/Instagram automáticos.");
  }

  const matches = matchPosts(state, posts);
  const itemDe = new Map(matches.map((m) => [`${m.post.network}:${m.post.id}`, m]));
  guardarPosts(state, posts, itemDe);
  let updated = 0;
  for (const m of matches) {
    const it = m.item;
    it.posts = { ...(it.posts ?? {}), [m.post.network]: { url: m.post.url, externalId: m.post.id, matchedBy: m.how, matchedAt: new Date().toISOString(), publishedAt: m.post.publishedAt } };
    if (applyMetrics(it, m.post.network, m.post.metrics, `apify:${m.how}`, { autoPublish: m.how === "manual" || m.score >= 0.7 })) updated++;
  }

  // YouTube: piezas con URL de YouTube pegada a mano (Shorts) → Data API.
  if (cfg.youtube) {
    const targets = state.items.filter((i) => i.posts?.youtube?.url).map((i) => ({ it: i, id: ytId(i.posts!.youtube!.url) })).filter((t) => t.id);
    try {
      const stats = await fetchYouTubeStats(targets.map((t) => t.id!));
      for (const t of targets) {
        const s = stats[t.id!];
        if (s && applyMetrics(t.it, "youtube", s, "youtube-api")) updated++;
      }
    } catch (err) {
      errors.push(`YouTube: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  state.lastMetricsSyncAt = new Date().toISOString();
  // Por red, no en total: si Instagram lee 14 posts y empareja 0, hay que poder
  // ver que SÍ se leyó y que el último post es viejo — no que "no busca en IG".
  const porRed: NonNullable<State["metricsSync"]> = {};
  for (const n of ["tiktok", "instagram"] as const) {
    const leidos = posts.filter((p) => p.network === n);
    const ultimo = leidos.map((p) => p.publishedAt).sort().slice(-1)[0];
    porRed[n] = {
      leidos: leidos.length,
      emparejados: matches.filter((m) => m.post.network === n).length,
      ultimoPost: ultimo,
      error: errors.find((e) => e.toLowerCase().startsWith(n === "tiktok" ? "tiktok" : "instagram")),
    };
  }
  state.metricsSync = porRed;
  const detalle = (["tiktok", "instagram"] as const)
    .map((n) => `${n}: ${porRed[n]!.leidos} leídos / ${porRed[n]!.emparejados} emparejados${porRed[n]!.ultimoPost ? ` (último ${porRed[n]!.ultimoPost!.slice(0, 10)})` : ""}`)
    .join(" · ");
  logLine(state, `Métricas — ${detalle} · ${updated} piezas actualizadas${errors.length ? ` · avisos: ${errors.join(" | ")}` : ""}.`);
  return { matched: matches.length, updated, posts: posts.length, errors };
}

function ytId(url: string): string | null {
  const m = /(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/.exec(url);
  return m?.[1] ?? null;
}
