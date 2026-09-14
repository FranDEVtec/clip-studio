// Estado del calendario, persistido en Postgres (lib/db.ts).
//
// El modelo en memoria es un State completo (videos, piezas, ajustes, log):
// toda la lógica del pipeline y de la UI trabaja sobre él. La base guarda cada
// entidad en su tabla con columnas clave (para consultar) + un JSONB con el
// contenido completo (para no migrar el schema cada vez que cambia una pieza).
// loadState arma el State desde las tablas; saveState hace upsert de todo y
// borra lo que ya no está, en una sola transacción. Volumen chico (decenas de
// filas), así que "guardar todo" es más simple y más seguro que diffs.

import { ensureSchema, sql } from "@/lib/db";
import type { CopyPieces } from "@/lib/copy";

export type Platform = "tiktok" | "instagram" | "youtube";

export type Cita = { texto: string; segundo: number };

/** Candidato a clip que Gemini detectó mirando el video completo. */
export type ClipCandidate = {
  inicio: number;
  fin: number;
  titulo: string;
  tema: string;
  transcripcion: string;
  citas: Cita[];
  gancho: string;
  motivo: string;
  /** La pregunta que la gente ya se hace sobre este tema: la puerta de entrada del clip. */
  curiosidad?: string;
  /** Índice del eje del video al que pertenece. */
  eje?: number;
  puntaje: number;
};

export type Eje = { nombre: string; idea: string; segundo: number };

export type VideoAnalysis = {
  tema: string;
  tesis: string;
  /** Los 3-5 temas que el video desarrolla de verdad. */
  ejes?: Eje[];
  clips: ClipCandidate[];
};

export type Video = {
  videoId: string;
  url: string;
  title: string;
  publishedAt: string; // ISO
  /** "ignored": estaba en el RSS al primer escaneo pero es viejo o corto; se analiza sólo a pedido. */
  status: "pending" | "analyzing" | "analyzed" | "error" | "ignored";
  error?: string;
  analyzedAt?: string;
  analysis?: VideoAnalysis;
  /** Cuántos clips ya se agendaron de este video. */
  scheduled?: { clips: number };
  /** Nota del planificador: hilo de la semana. */
  planNote?: string;
};

export type ClipItem = {
  inicio: number;
  fin: number;
  tituloInterno: string;
  /** Caption de Instagram: claim + CTA fijo + hashtags. */
  caption: string;
  /** Misma línea, con los hashtags de TikTok. */
  captionTikTok?: string;
  molde: string;
  transcripcion: string;
  avisos: string[];
  /** Piezas crudas del redactor: permiten re-armar el caption sin volver a llamar al modelo. */
  pieces: CopyPieces;
  /** Ángulo que planificó el agente. */
  angulo?: string;
};

/** Métricas de una pieza en una red (cargadas a mano o por el sync). */
export type Metrics = {
  views?: number;
  likes?: number;
  comments?: number;
  saves?: number;
  shares?: number;
  follows?: number;
  profileVisits?: number;
  /** Retención a los 3 s (%). */
  hookPct?: number;
  /** % que llegó al final (completion). */
  completionPct?: number;
  avgWatchSec?: number;
  /** % del alcance que vino de seguidores (vs. FYP/Explore). */
  followersReachPct?: number;
  /** Reposts (TikTok los cuenta aparte de los shares). */
  reposts?: number;
  /** Duración REAL del video publicado, en segundos. */
  duracionSeg?: number;
  /** Audio propio/original vs. sonido de la plataforma. */
  audioOriginal?: boolean;
  audioNombre?: string;
  /** Hashtags con los que efectivamente salió. */
  hashtags?: string[];
  /** Hora local de publicación (0-23). */
  hora?: number;
  /** Seguidores de la cuenta al momento del scrape. */
  seguidoresCuenta?: number;
  /** Post en colaboración. */
  colaboracion?: boolean;
  /** Imágenes del post (1 = video). */
  slides?: number;
  notes?: string;
  updatedAt: string;
  /** De dónde salió: "manual" | "apify:auto" | "apify:manual" | "youtube-api". */
  source?: string;
};

export type Item = {
  id: string;
  /** El video de YouTube del que sale el clip. */
  videoId: string;
  kind: "clip";
  /** Fecha local, YYYY-MM-DD. */
  date: string;
  time: string; // "21:00"
  /** "drafting": ya tiene fecha y plan pero todavía no se escribió. */
  status: "drafting" | "planned" | "published";
  createdAt: string;
  publishedAt?: string;
  /** Redes en las que ya se publicó (checklist de la vista Hoy). */
  publishedOn?: Platform[];
  clip?: ClipItem;
  /** Reserva del planner hasta que la pieza se escribe. */
  draft?: { candidateIndex?: number; angulo?: string };
  metrics?: Partial<Record<Platform, Metrics>>;
  /** El post publicado en cada red (URL pegada a mano o emparejada por el sync). */
  posts?: Partial<Record<Platform, { url: string; externalId?: string; matchedBy: "manual" | "auto"; matchedAt: string; publishedAt?: string }>>;
};

/**
 * Un post real de la cuenta, tal como lo devuelve el scraper.
 *
 * Existe aparte de Item porque son dos cosas distintas: Item es lo que el
 * sistema PLANIFICÓ, PublishedPost es lo que efectivamente está publicado.
 * Los posts NO se borran: un post que sale del feed de los últimos 30 sigue
 * contando como observación. Lo único acotado es el historial.
 */
export type PublishedPost = {
  network: Platform;
  /** Id del post en la red. La clave real es `${network}:${id}`. */
  id: string;
  url: string;
  publishedAt: string;
  kind: "clip" | "carousel";
  /** Caption tal como se publicó (recortado). */
  text: string;
  metrics: Metrics;
  /** Un snapshot por día, para ver la curva. Se guardan los últimos 12. */
  history?: Record<string, Metrics>;
  /** Pieza del calendario, si emparejó. Sin esto es un post suelto. */
  itemId?: string;
  matchedBy?: "manual" | "auto";
  firstSeenAt: string;
  lastSeenAt: string;
};

/** Ajustes editables desde la UI (nunca secretos: esos van por entorno). */
export type Settings = {
  /** Guía de estilo: va primero en todos los prompts de redacción. */
  styleGuide?: string;
};

export type State = {
  version: 1;
  videos: Video[];
  items: Item[];
  settings?: Settings;
  lastScanAt?: string;
  /** Qué leyó y qué emparejó el último sync, por red. */
  metricsSync?: Partial<Record<"tiktok" | "instagram", { leidos: number; emparejados: number; ultimoPost?: string; error?: string }>>;
  lastMetricsSyncAt?: string;
  /** Todo lo publicado en las cuentas, empareje o no con el calendario. */
  posts?: PublishedPost[];
  log: string[];
};

export function emptyState(): State {
  return { version: 1, videos: [], items: [], log: [] };
}

type VideoRow = { data: Video };
type ItemRow = { data: Item };
type MetaRow = { key: string; value: unknown };

export async function loadState(): Promise<State> {
  await ensureSchema();
  const q = sql();
  const [videos, items, meta] = (await Promise.all([
    q`SELECT data FROM videos ORDER BY published_at DESC NULLS LAST`,
    q`SELECT data FROM items ORDER BY date, time`,
    q`SELECT key, value FROM meta`,
  ])) as unknown as [VideoRow[], ItemRow[], MetaRow[]];
  const metaMap = new Map(meta.map((m) => [m.key, m.value]));
  return {
    version: 1,
    videos: videos.map((r) => r.data),
    items: items.map((r) => r.data),
    settings: (metaMap.get("settings") as Settings | undefined) ?? undefined,
    lastScanAt: (metaMap.get("lastScanAt") as string | undefined) ?? undefined,
    lastMetricsSyncAt: (metaMap.get("lastMetricsSyncAt") as string | undefined) ?? undefined,
    metricsSync: (metaMap.get("metricsSync") as State["metricsSync"]) ?? undefined,
    posts: (metaMap.get("posts") as PublishedPost[] | undefined) ?? [],
    log: (metaMap.get("log") as string[] | undefined) ?? [],
  };
}

/**
 * OJO: esto NO serializa State entero. Cada campo suelto se escribe a mano en
 * la tabla `meta`, y `loadState` lo lee a mano también. Un campo nuevo en State
 * que no se agregue en LOS DOS lados compila, pasa los tests y se pierde en
 * silencio al guardar.
 */
export async function saveState(state: State): Promise<void> {
  await ensureSchema();
  const q = sql();
  // Log acotado: las últimas 400 líneas.
  state.log = state.log.slice(-400);
  const j = (x: unknown) => JSON.stringify(x ?? null);
  const meta = (key: string, value: unknown) =>
    q`INSERT INTO meta (key, value, updated_at) VALUES (${key}, ${j(value)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  const queries = [
    ...state.videos.map(
      (v) =>
        q`INSERT INTO videos (video_id, status, published_at, title, data, updated_at)
          VALUES (${v.videoId}, ${v.status}, ${v.publishedAt}, ${v.title}, ${j(v)}::jsonb, now())
          ON CONFLICT (video_id) DO UPDATE SET status = EXCLUDED.status, published_at = EXCLUDED.published_at, title = EXCLUDED.title, data = EXCLUDED.data, updated_at = now()`,
    ),
    q`DELETE FROM videos WHERE NOT (video_id = ANY(${state.videos.map((v) => v.videoId)}::text[]))`,
    ...state.items.map(
      (i) =>
        q`INSERT INTO items (id, video_id, kind, date, time, status, data, updated_at)
          VALUES (${i.id}, ${i.videoId}, ${i.kind}, ${i.date}, ${i.time}, ${i.status}, ${j(i)}::jsonb, now())
          ON CONFLICT (id) DO UPDATE SET video_id = EXCLUDED.video_id, kind = EXCLUDED.kind, date = EXCLUDED.date, time = EXCLUDED.time, status = EXCLUDED.status, data = EXCLUDED.data, updated_at = now()`,
    ),
    q`DELETE FROM items WHERE NOT (id = ANY(${state.items.map((i) => i.id)}::text[]))`,
    meta("version", 1),
    meta("settings", state.settings ?? null),
    meta("lastScanAt", state.lastScanAt ?? null),
    meta("lastMetricsSyncAt", state.lastMetricsSyncAt ?? null),
    meta("metricsSync", state.metricsSync ?? null),
    meta("posts", state.posts ?? []),
    meta("log", state.log),
  ];
  await q.transaction(queries);
}

/**
 * Guardado parcial para las cadenas de redacción: relee la base y aplica
 * SÓLO las piezas indicadas (si alguien las borró entre medio, no se resucitan),
 * más las líneas de log nuevas. Evita que una invocación larga pise con su
 * estado viejo lo que la UI cambió mientras tanto.
 */
export async function mergeSave(state: State, itemIds: string[]): Promise<State> {
  const fresh = await loadState();
  const byId = new Map(state.items.map((i) => [i.id, i]));
  for (const id of itemIds) {
    const updated = byId.get(id);
    if (!updated) continue;
    const idx = fresh.items.findIndex((i) => i.id === id);
    if (idx >= 0) fresh.items[idx] = updated; // si ya no existe, se respeta el borrado
  }
  const have = new Set(fresh.log);
  for (const line of state.log) if (!have.has(line)) fresh.log.push(line);
  for (const v of state.videos) {
    const idx = fresh.videos.findIndex((f) => f.videoId === v.videoId);
    if (idx >= 0 && (v.analyzedAt ?? "") >= (fresh.videos[idx].analyzedAt ?? "")) {
      fresh.videos[idx] = {
        ...fresh.videos[idx],
        status: v.status,
        error: v.error,
        analysis: v.analysis ?? fresh.videos[idx].analysis,
        analyzedAt: v.analyzedAt ?? fresh.videos[idx].analyzedAt,
        planNote: v.planNote ?? fresh.videos[idx].planNote,
        scheduled: v.scheduled ?? fresh.videos[idx].scheduled,
      };
    }
  }
  await saveState(fresh);
  return fresh;
}

export function logLine(state: State, msg: string) {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  state.log.push(`${stamp} ${msg}`);
  console.log(`[studio] ${msg}`);
}
