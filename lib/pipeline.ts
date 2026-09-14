// Orquestación del calendario: escanear → analizar → planificar → redactar → agendar.
//
// Cada paso es idempotente sobre el State y deja rastro en state.log, así el
// cron diario y el botón "escanear ahora" corren exactamente el mismo código.

import type { Extraction } from "@/lib/engine";
import { buildCaption, writeCopy } from "@/lib/copy";
import { analyzeVideo } from "@/lib/video-engine";
import { CLIPS_PER_VIDEO, FRESH_DAYS, VIDEO_MIN_SEC } from "@/lib/config";
import { cederLaSemana, faltantesDeLaSemana, localDate, nextFreeSlots, PUBLISH_TIME, videoWeekStart, weekSlots } from "@/lib/planner";
import { logLine, saveState, type ClipCandidate, type ClipItem, type Item, type State, type Video } from "@/lib/store";
import { fetchChannelFeed, fetchOEmbedTitle, parseVideoId, fetchVideoLengthSec } from "@/lib/youtube";
import { reglasDelModelo } from "@/lib/stats";
import { planVideo, type VideoPlan } from "@/lib/agents";
import { doctrine } from "@/lib/style";
import { fmtTime } from "@/lib/openai";

export { CLIPS_PER_VIDEO, VIDEO_MIN_SEC };

// ─────────────────────────────────────────────────────────────────────────────

/** Registra videos nuevos del RSS. Devuelve cuántos entraron a la cola. */
export async function scanChannel(state: State): Promise<number> {
  const feed = await fetchChannelFeed();
  const known = new Set(state.videos.map((v) => v.videoId));
  const firstRun = state.videos.length === 0;
  const cutoff = Date.now() - FRESH_DAYS * 86400_000;
  let queued = 0;
  for (const v of feed) {
    if (known.has(v.videoId)) continue;
    const fresh = new Date(v.publishedAt).getTime() >= cutoff;
    // Los Shorts y los cortes ya publicados no se clipean: entran como
    // "ignored" para que no ocupen una semana.
    const len = await fetchVideoLengthSec(v.videoId);
    const corto = len !== null && len < VIDEO_MIN_SEC;
    // En el primer escaneo el RSS trae 15 videos viejos: no se analizan solos
    // (cuesta ~1 h de video de Gemini cada uno). Quedan como "ignored" para
    // analizarlos a pedido desde la UI.
    const status: Video["status"] = corto || (firstRun && !fresh) ? "ignored" : "pending";
    state.videos.push({ ...v, status });
    if (status === "pending") queued++;
    logLine(state, `Video nuevo en el canal: "${v.title}" (${v.videoId}) → ${status}${corto ? ` (dura ${Math.round((len as number) / 60)} min: es un Short o un corte, no se clipea)` : ""}`);
  }
  state.lastScanAt = new Date().toISOString();
  return queued;
}

/**
 * Agrega un video a mano por URL/ID (para videos viejos o pruebas).
 * `saleEl` (YYYY-MM-DD): el día en que el video se publica. Sirve para el
 * video que se sube NO LISTADO antes de la fecha de salida.
 */
export async function addVideoByUrl(state: State, input: string, opts: { saleEl?: string } = {}): Promise<Video> {
  const videoId = parseVideoId(input);
  if (!videoId) throw new Error("No reconozco esa URL de YouTube");
  if (opts.saleEl && !/^\d{4}-\d{2}-\d{2}$/.test(opts.saleEl)) throw new Error("La fecha de salida va como YYYY-MM-DD");
  const publishedAt = opts.saleEl ? `${opts.saleEl}T${PUBLISH_TIME}:00` : new Date().toISOString();
  const existing = state.videos.find((v) => v.videoId === videoId);
  if (existing) {
    if (existing.status === "ignored" || existing.status === "error") existing.status = "pending";
    if (opts.saleEl) existing.publishedAt = publishedAt;
    return existing;
  }
  const title = (await fetchOEmbedTitle(videoId)) ?? videoId;
  const video: Video = { videoId, url: `https://www.youtube.com/watch?v=${videoId}`, title, publishedAt, status: "pending" };
  state.videos.push(video);
  logLine(state, `Video agregado a mano: "${title}" (${videoId})`);
  return video;
}

// ─────────────────────────────────────────────────────────────────────────────

/** Analiza UN video pendiente (el más nuevo) y agenda sus piezas. */
export async function processNextPending(state: State): Promise<Video | null> {
  const video = [...state.videos].filter((v) => v.status === "pending").sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
  if (!video) return null;
  await processVideo(state, video);
  return video;
}

async function runAnalysis(state: State, video: Video): Promise<boolean> {
  video.status = "analyzing";
  video.error = undefined;
  try {
    logLine(state, `Analizando con Gemini: "${video.title}"…`);
    const analysis = await analyzeVideo(video.url, video.title);
    video.analysis = analysis;
    video.analyzedAt = new Date().toISOString();
    video.status = "analyzed";
    logLine(state, `Listo: ${analysis.clips.length} tramos candidatos en ${analysis.ejes?.length ?? 0} ejes.`);
    return true;
  } catch (err) {
    video.status = "error";
    video.error = err instanceof Error ? err.message : String(err);
    logLine(state, `ERROR en "${video.title}": ${video.error}`);
    return false;
  }
}

export async function processVideo(state: State, video: Video): Promise<void> {
  if (!(await runAnalysis(state, video))) return;
  // El análisis se persiste ANTES de redactar: si la función se corta por
  // tiempo, el trabajo caro (Gemini) no se pierde y el próximo escaneo agenda lo que falte.
  video.scheduled = video.scheduled ?? { clips: 0 };
  await saveState(state);
  await scheduleVideo(state, video);
}

/** Vuelve a pasar el video por Gemini sin tocar el calendario. */
export async function processVideoAnalysisOnly(state: State, video: Video): Promise<void> {
  if (!(await runAnalysis(state, video))) return;
  // Marcar como "ya agendado" para que scheduleMissing no le invente piezas.
  video.scheduled = video.scheduled ?? { clips: CLIPS_PER_VIDEO };
}

/** Reserva los clips del video en su semana. La redacción corre después, encadenada. */
export async function scheduleVideo(state: State, video: Video): Promise<Item[]> {
  if (!video.analysis) throw new Error("El video no está analizado");
  const created: Item[] = [];
  const hoy = localDate();
  const domingo = videoWeekStart(video.publishedAt, hoy);
  // Contar las piezas que EXISTEN, no un contador guardado: las piezas del
  // calendario son la fuente de verdad.
  const already = state.items.filter((i) => i.videoId === video.videoId).length;
  const corto = video.title.length > 30 ? `${video.title.slice(0, 30)}…` : video.title;

  // La semana es del video: lo de otros videos que todavía no salió se corre una semana.
  const desplazadas = cederLaSemana(state, video.videoId, domingo);
  if (desplazadas.length) {
    logLine(state, `La semana del ${domingo} pasa a ser de "${corto}": ${desplazadas.length} pieza(s) de otros videos se corren una semana (ninguna se borra).`);
  }

  // Los mejores tramos que todavía no se agendaron (escritos o reservados), sin solaparse.
  const usedRanges = state.items
    .filter((i) => i.videoId === video.videoId)
    .map((i) => {
      if (i.clip) return [i.clip.inicio, i.clip.fin] as const;
      const c = i.draft?.candidateIndex !== undefined ? video.analysis!.clips[i.draft.candidateIndex] : undefined;
      return c ? ([c.inicio, c.fin] as const) : null;
    })
    .filter((r): r is readonly [number, number] => r !== null);
  const candidates = video.analysis.clips
    .map((c, index) => ({ c, index }))
    .filter(({ c }) => !usedRanges.some(([a, b]) => c.inicio < b && c.fin > a));
  const pideClips = Math.min(Math.max(0, CLIPS_PER_VIDEO - already), candidates.length);
  const clipDates = weekSlots(state, domingo, "clip", hoy).slice(0, pideClips);

  // Compuerta: la semana puede no dar los días que el video pide. Se nombra qué falta y por qué.
  const aviso = faltantesDeLaSemana(state, video.videoId, domingo, hoy, pideClips, clipDates.length);
  if (aviso) logLine(state, `AVISO: la semana del ${domingo} no da para ${aviso.faltan} de "${corto}" (${aviso.porQue}).`);
  if (!clipDates.length) return created;

  // El planificador decide qué tramo va cada día y con qué ángulo. Si falla, se cae al orden por puntaje.
  let plan: VideoPlan | null = null;
  try {
    plan = await planVideo(state, video, clipDates.length, candidates.map((x) => x.c));
    video.planNote = plan.nota_semana;
    if (plan.nota_semana) logLine(state, `Plan: ${plan.nota_semana}`);
  } catch (err) {
    logLine(state, `Planner falló (${err instanceof Error ? err.message : err}); se usa el orden por puntaje.`);
  }
  const ordered = plan
    ? plan.clips.map((c) => ({ index: candidates[c.candidate_index].index, angulo: c.angulo as string | undefined }))
    : candidates.map((x) => ({ index: x.index, angulo: undefined as string | undefined }));

  // Sólo se RESERVA (fecha + plan). La redacción corre en writePendingItems, de
  // a pocas piezas por invocación, para no chocar con el tope de la función.
  const stamp = Date.now();
  clipDates.forEach((date, i) => {
    const item: Item = {
      id: `${video.videoId}-clip-${stamp}-${i}`,
      videoId: video.videoId,
      kind: "clip",
      date,
      time: PUBLISH_TIME,
      status: "drafting",
      createdAt: new Date().toISOString(),
      draft: { candidateIndex: ordered[i].index, angulo: ordered[i].angulo },
    };
    state.items.push(item);
    created.push(item);
  });
  video.scheduled = { clips: already + created.length };
  state.items.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  logLine(state, `Reservados ${created.length} clips de "${corto}" — semana del ${domingo}: ${clipDates.join(", ")}.`);
  return created;
}

/** Piezas reservadas que todavía no se escribieron. */
export function pendingDrafts(state: State): Item[] {
  return state.items.filter((i) => i.status === "drafting" && !i.clip);
}

/**
 * Escribe hasta `max` piezas pendientes en paralelo. Devuelve cuántas quedan.
 * Idempotente: si la función muere a mitad, la pieza sigue en "drafting" y la
 * próxima invocación la retoma.
 */
export async function writePendingItems(state: State, max = 2): Promise<{ remaining: number; written: string[] }> {
  const batch = pendingDrafts(state).slice(0, max);
  await Promise.all(
    batch.map(async (it) => {
      const video = state.videos.find((v) => v.videoId === it.videoId);
      if (!video?.analysis) {
        it.status = "planned";
        return;
      }
      try {
        const cand = it.draft?.candidateIndex !== undefined ? video.analysis.clips[it.draft.candidateIndex] : video.analysis.clips[0];
        logLine(state, `Redactando clip del ${it.date}: "${cand.titulo}" (${fmtTime(cand.inicio)}–${fmtTime(cand.fin)})…`);
        it.clip = await buildClipItem(cand, video, state, it.draft?.angulo);
        it.status = "planned";
        it.draft = undefined;
      } catch (err) {
        logLine(state, `ERROR redactando clip del ${it.date}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
  return { remaining: pendingDrafts(state).length, written: batch.map((b) => b.id) };
}

export async function buildClipItem(cand: ClipCandidate, video: Video, state: State, angulo?: string): Promise<ClipItem> {
  const ex: Extraction = { titulo: cand.titulo, transcripcion: cand.transcripcion, tema: cand.tema, citas: cand.citas };
  const angleRule = angulo ? `\n\n# ÁNGULO PLANIFICADO PARA ESTE CLIP\n${angulo}` : "";
  const a = await writeCopy(
    ex,
    doctrine(state),
    reglasDelModelo(state) + angleRule,
    video.analysis ? { tema: video.analysis.tema, tesis: video.analysis.tesis, curiosidad: cand.curiosidad } : undefined,
  );
  return {
    inicio: cand.inicio,
    fin: cand.fin,
    tituloInterno: cand.titulo,
    caption: buildCaption(a.pieces, "instagram"),
    captionTikTok: buildCaption(a.pieces, "tiktok"),
    molde: a.pieces.molde,
    transcripcion: cand.transcripcion,
    avisos: [...a.problemas],
    pieces: a.pieces,
    angulo,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/** Vuelve a redactar un ítem (nuevo copy sobre los mismos hechos). */
export async function regenerateItem(state: State, itemId: string) {
  const it = state.items.find((i) => i.id === itemId);
  if (!it?.clip) throw new Error("Ítem no encontrado");
  const video = state.videos.find((v) => v.videoId === it.videoId);
  if (!video?.analysis) throw new Error("El video no tiene análisis");
  const cand = video.analysis.clips.find((c) => c.inicio === it.clip!.inicio && c.fin === it.clip!.fin) ?? {
    ...it.clip,
    titulo: it.clip.tituloInterno,
    tema: "",
    citas: [],
    gancho: "",
    motivo: "",
    puntaje: 0,
  };
  it.clip = await buildClipItem(cand, video, state, it.clip.angulo);
  logLine(state, `Copy regenerado para el clip del ${it.date}.`);
}

/** Videos analizados a los que les faltan piezas por agendar (p. ej. tras un timeout). */
export async function scheduleMissing(state: State): Promise<number> {
  let n = 0;
  for (const video of state.videos) {
    if (video.status !== "analyzed" || !video.analysis) continue;
    if ((video.scheduled?.clips ?? 0) >= CLIPS_PER_VIDEO) continue;
    // Sólo videos recientes: los viejos analizados a mano no se re-agendan solos.
    if (Date.now() - new Date(video.analyzedAt ?? 0).getTime() > 3 * 86400_000) continue;
    const created = await scheduleVideo(state, video);
    n += created.length;
    if (created.length === 0) video.scheduled = { clips: CLIPS_PER_VIDEO };
  }
  return n;
}

/**
 * Re-distribuye las piezas NO publicadas de un video desde `from` (hoy por
 * defecto), respetando el plan. Las publicadas no se tocan.
 */
export function replanVideo(state: State, video: Video, from = localDate()): number {
  const mine = state.items.filter((i) => i.videoId === video.videoId && i.status !== "published").sort((a, b) => a.date.localeCompare(b.date));
  const ids = new Set(mine.map((i) => i.id));
  const dates = nextFreeSlots(state, "clip", from, mine.length, { ignoreItemIds: ids });
  mine.forEach((it, i) => {
    if (dates[i]) it.date = dates[i];
  });
  state.items.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  logLine(state, `Re-planificadas ${mine.length} piezas de "${video.title}" desde ${from}.`);
  return mine.length;
}
