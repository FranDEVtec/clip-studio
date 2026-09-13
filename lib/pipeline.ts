// Orquestación del calendario: escanear → analizar → planificar → redactar → agendar.
//
// Cada paso es idempotente sobre el State y deja rastro en state.log, así el
// cron diario y el botón "escanear ahora" corren exactamente el mismo código.

import type { Extraction } from "@/lib/engine";
import { buildCaption, writeCopy } from "@/lib/copy";
import { analyzeEpisode } from "@/lib/episode-engine";
import { CLIPS_PER_EPISODE, EPISODE_MIN_SEC, FRESH_DAYS, STRETCH_EXTRA_CLIPS } from "@/lib/config";
import { addDays, cederLaSemana, episodeWeekStart, faltantesDeLaSemana, isoDow, localDate, nextFreeSlots, PUBLISH_TIME, weekSlots } from "@/lib/planner";
import { logLine, saveState, type ClipCandidate, type ClipItem, type Episode, type Item, type State } from "@/lib/store";
import { fetchChannelFeed, fetchOEmbedTitle, parseVideoId, fetchVideoLengthSec } from "@/lib/youtube";
import { reglasDelModelo } from "@/lib/stats";
import { planEpisode, type EpisodePlan } from "@/lib/agents";
import { doctrine, rulesBlock } from "@/lib/style";
import { fmtTime } from "@/lib/openai";

export { CLIPS_PER_EPISODE, STRETCH_EXTRA_CLIPS, EPISODE_MIN_SEC };

// ─────────────────────────────────────────────────────────────────────────────

/** Registra episodios nuevos del RSS. Devuelve cuántos entraron a la cola. */
export async function scanChannel(state: State): Promise<number> {
  const feed = await fetchChannelFeed();
  const known = new Set(state.episodes.map((e) => e.videoId));
  const firstRun = state.episodes.length === 0;
  const cutoff = Date.now() - FRESH_DAYS * 86400_000;
  let queued = 0;
  for (const v of feed) {
    if (known.has(v.videoId)) continue;
    const fresh = new Date(v.publishedAt).getTime() >= cutoff;
    // Los cortes del episodio (partes de 5-10 min) no son episodios: entran
    // como "ignored" para que no ocupen una semana.
    const len = await fetchVideoLengthSec(v.videoId);
    const corto = len !== null && len < EPISODE_MIN_SEC;
    // En el primer escaneo el RSS trae 15 videos viejos: no se analizan solos
    // (cuesta ~1 h de video de Gemini cada uno). Quedan como "ignored" para
    // analizarlos a pedido desde la UI.
    const status: Episode["status"] = corto || (firstRun && !fresh) ? "ignored" : "pending";
    state.episodes.push({ ...v, status });
    if (status === "pending") queued++;
    logLine(state, `Episodio nuevo en el canal: "${v.title}" (${v.videoId}) → ${status}${corto ? ` (dura ${Math.round((len as number) / 60)} min: es un corte, no un episodio)` : ""}`);
  }
  state.lastScanAt = new Date().toISOString();
  return queued;
}

/**
 * Agrega un episodio a mano por URL/ID (para episodios viejos o pruebas).
 * `saleEl` (YYYY-MM-DD): el día en que el episodio se publica. Sirve para el
 * video que se sube NO LISTADO antes de la fecha de salida.
 */
export async function addEpisodeByUrl(state: State, input: string, opts: { saleEl?: string } = {}): Promise<Episode> {
  const videoId = parseVideoId(input);
  if (!videoId) throw new Error("No reconozco esa URL de YouTube");
  if (opts.saleEl && !/^\d{4}-\d{2}-\d{2}$/.test(opts.saleEl)) throw new Error("La fecha de salida va como YYYY-MM-DD");
  const publishedAt = opts.saleEl ? `${opts.saleEl}T${PUBLISH_TIME}:00` : new Date().toISOString();
  const existing = state.episodes.find((e) => e.videoId === videoId);
  if (existing) {
    if (existing.status === "ignored" || existing.status === "error") existing.status = "pending";
    if (opts.saleEl) existing.publishedAt = publishedAt;
    return existing;
  }
  const title = (await fetchOEmbedTitle(videoId)) ?? videoId;
  const ep: Episode = { videoId, url: `https://www.youtube.com/watch?v=${videoId}`, title, publishedAt, status: "pending" };
  state.episodes.push(ep);
  logLine(state, `Episodio agregado a mano: "${title}" (${videoId})`);
  return ep;
}

// ─────────────────────────────────────────────────────────────────────────────

/** Analiza UN episodio pendiente (el más nuevo) y agenda sus piezas. */
export async function processNextPending(state: State): Promise<Episode | null> {
  const ep = [...state.episodes].filter((e) => e.status === "pending").sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
  if (!ep) return null;
  await processEpisode(state, ep);
  return ep;
}

async function runAnalysis(state: State, ep: Episode): Promise<boolean> {
  ep.status = "analyzing";
  ep.error = undefined;
  try {
    logLine(state, `Analizando con Gemini: "${ep.title}"…`);
    const analysis = await analyzeEpisode(ep.url, rulesBlock(state), ep.title);
    ep.analysis = analysis;
    ep.analyzedAt = new Date().toISOString();
    if (!ep.guest) ep.guest = guessGuest(ep.title, analysis.invitado);
    if (!ep.episodeNumber && analysis.numero_episodio) ep.episodeNumber = analysis.numero_episodio.replace(/\D/g, "");
    ep.status = "analyzed";
    logLine(state, `Listo: ${analysis.clips.length} tramos candidatos en ${analysis.ejes?.length ?? 0} ejes. Invitado: ${ep.guest || "?"}`);
    return true;
  } catch (err) {
    ep.status = "error";
    ep.error = err instanceof Error ? err.message : String(err);
    logLine(state, `ERROR en "${ep.title}": ${ep.error}`);
    return false;
  }
}

export async function processEpisode(state: State, ep: Episode): Promise<void> {
  if (!(await runAnalysis(state, ep))) return;
  // El análisis se persiste ANTES de redactar: si la función se corta por
  // tiempo, el trabajo caro (Gemini) no se pierde y el próximo escaneo agenda lo que falte.
  ep.scheduled = ep.scheduled ?? { clips: 0 };
  await saveState(state);
  await scheduleEpisode(state, ep);
}

/** Vuelve a pasar el episodio por Gemini sin tocar el calendario. */
export async function processEpisodeAnalysisOnly(state: State, ep: Episode): Promise<void> {
  if (!(await runAnalysis(state, ep))) return;
  // Marcar como "ya agendado" para que scheduleMissing no le invente piezas.
  ep.scheduled = ep.scheduled ?? { clips: CLIPS_PER_EPISODE };
}

/** Reserva los clips del episodio en su semana. La redacción corre después, encadenada. */
export async function scheduleEpisode(state: State, ep: Episode): Promise<Item[]> {
  if (!ep.analysis) throw new Error("El episodio no está analizado");
  const created: Item[] = [];
  const hoy = localDate();
  const domingo = episodeWeekStart(ep.publishedAt, hoy);
  // Contar las piezas que EXISTEN, no un contador guardado: las piezas del
  // calendario son la fuente de verdad.
  const already = state.items.filter((i) => i.episodeId === ep.videoId).length;
  const targetClips = CLIPS_PER_EPISODE + (ep.stretch ? STRETCH_EXTRA_CLIPS : 0);

  // La semana es del episodio: lo de otros episodios que todavía no salió se corre una semana.
  const desplazadas = cederLaSemana(state, ep.videoId, domingo);
  if (desplazadas.length) {
    logLine(state, `La semana del ${domingo} pasa a ser de "${ep.guest ?? ep.title.slice(0, 30)}": ${desplazadas.length} pieza(s) de otros episodios se corren una semana (ninguna se borra).`);
  }

  // Los mejores tramos que todavía no se agendaron (escritos o reservados), sin solaparse.
  const usedRanges = state.items
    .filter((i) => i.episodeId === ep.videoId)
    .map((i) => {
      if (i.clip) return [i.clip.inicio, i.clip.fin] as const;
      const c = i.draft?.candidateIndex !== undefined ? ep.analysis!.clips[i.draft.candidateIndex] : undefined;
      return c ? ([c.inicio, c.fin] as const) : null;
    })
    .filter((r): r is readonly [number, number] => r !== null);
  const candidates = ep.analysis.clips
    .map((c, index) => ({ c, index }))
    .filter(({ c }) => !usedRanges.some(([a, b]) => c.inicio < b && c.fin > a));
  const pideClips = Math.min(Math.max(0, targetClips - already), candidates.length);
  const clipDates = weekSlots(state, domingo, "clip", hoy).slice(0, pideClips);

  // Compuerta: la semana puede no dar los días que el episodio pide. Se nombra qué falta y por qué.
  const aviso = faltantesDeLaSemana(state, ep.videoId, domingo, hoy, pideClips, clipDates.length);
  if (aviso) logLine(state, `AVISO: la semana del ${domingo} no da para ${aviso.faltan} de "${ep.guest ?? ep.title.slice(0, 30)}" (${aviso.porQue}).`);
  if (!clipDates.length) return created;

  // El planificador decide qué tramo va cada día y con qué ángulo. Si falla, se cae al orden por puntaje.
  let plan: EpisodePlan | null = null;
  try {
    plan = await planEpisode(state, ep, clipDates.length, candidates.map((x) => x.c));
    ep.planNote = plan.nota_semana;
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
      id: `${ep.videoId}-clip-${stamp}-${i}`,
      episodeId: ep.videoId,
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
  ep.scheduled = { clips: already + created.length };
  state.items.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  logLine(state, `Reservados ${created.length} clips de "${ep.title}" — semana del ${domingo}: ${clipDates.join(", ")}.`);
  return created;
}

/** Piezas reservadas que todavía no se escribieron. */
export function pendingDrafts(state: State): Item[] {
  return state.items.filter((i) => i.status === "drafting" && !i.clip);
}

/**
 * Domingo sin episodio nuevo: en vez de dejar el día vacío, se recicla la pieza
 * que mejor rindió (save rate) de hace más de 30 días.
 */
export function scheduleRecycleIfEmpty(state: State): Item | null {
  const hoy = localDate();
  const dow = isoDow(hoy);
  const domingo = dow === 7 ? hoy : addDays(hoy, 7 - dow);
  if (state.items.some((i) => i.date === domingo)) return null;
  if (state.episodes.some((e) => e.analysis && episodeWeekStart(e.publishedAt, hoy) === domingo)) return null;

  const limite = addDays(hoy, -30);
  const candidatas = state.items
    .filter((i) => i.status === "published" && i.date <= limite && !i.recycleOf && i.clip)
    .map((i) => {
      const best = (["tiktok", "instagram"] as const).reduce((acc, n) => {
        const m = i.metrics?.[n];
        const sr = m?.views ? (m.saves ?? 0) / m.views : 0;
        return Math.max(acc, sr);
      }, 0);
      return { i, sr: best };
    })
    .filter((x) => x.sr > 0)
    .sort((a, b) => b.sr - a.sr);
  const mejor = candidatas[0]?.i;
  if (!mejor) return null;

  const item: Item = {
    id: `recycle-${mejor.id}-${Date.now()}`,
    episodeId: mejor.episodeId,
    kind: "clip",
    date: domingo,
    time: PUBLISH_TIME,
    status: "planned",
    createdAt: new Date().toISOString(),
    recycleOf: mejor.id,
    clip: mejor.clip,
  };
  state.items.push(item);
  state.items.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  logLine(state, `Domingo ${domingo} sin episodio nuevo: se recicla la pieza del ${mejor.date}, la de mejor save rate.`);
  return item;
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
      const ep = state.episodes.find((e) => e.videoId === it.episodeId);
      if (!ep?.analysis) {
        it.status = "planned";
        return;
      }
      try {
        const cand = it.draft?.candidateIndex !== undefined ? ep.analysis.clips[it.draft.candidateIndex] : ep.analysis.clips[0];
        logLine(state, `Redactando clip del ${it.date}: "${cand.titulo}" (${fmtTime(cand.inicio)}–${fmtTime(cand.fin)})…`);
        it.clip = await buildClipItem(cand, ep, state, it.draft?.angulo);
        it.status = "planned";
        it.draft = undefined;
      } catch (err) {
        logLine(state, `ERROR redactando clip del ${it.date}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
  return { remaining: pendingDrafts(state).length, written: batch.map((b) => b.id) };
}

export async function buildClipItem(cand: ClipCandidate, ep: Episode, state: State, angulo?: string): Promise<ClipItem> {
  const invitado = ep.guest || ep.analysis?.invitado || "";
  const ex: Extraction = { titulo: cand.titulo, transcripcion: cand.transcripcion, invitado, tema: cand.tema, citas: cand.citas };
  const angleRule = angulo ? `\n\n# ÁNGULO PLANIFICADO PARA ESTE CLIP\n${angulo}` : "";
  const a = await writeCopy(
    ex,
    invitado,
    doctrine(state),
    rulesBlock(state) + reglasDelModelo(state) + angleRule,
    ep.analysis ? { tema: ep.analysis.tema, tesis: ep.analysis.tesis, credencial: ep.analysis.credencial, curiosidad: cand.curiosidad } : undefined,
  );
  let pieces = a.pieces;
  // La credencial no puede quedar vacía si el episodio la tiene: recorte determinista.
  if (!pieces.credencial?.trim() && ep.analysis?.credencial) {
    pieces = { ...pieces, credencial: ep.analysis.credencial.split(/[,;]/)[0].split(/\s+/).slice(0, 5).join(" ").trim() };
  }
  return {
    inicio: cand.inicio,
    fin: cand.fin,
    tituloInterno: cand.titulo,
    caption: buildCaption(pieces, invitado, "instagram"),
    captionTikTok: buildCaption(pieces, invitado, "tiktok"),
    molde: pieces.molde,
    transcripcion: cand.transcripcion,
    avisos: [...a.problemas],
    pieces,
    angulo,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export function reassembleEpisodeItems(state: State, ep: Episode) {
  const invitado = ep.guest || ep.analysis?.invitado || "";
  for (const it of state.items) {
    if (it.episodeId !== ep.videoId || !it.clip) continue;
    it.clip.caption = buildCaption(it.clip.pieces, invitado, "instagram");
    it.clip.captionTikTok = buildCaption(it.clip.pieces, invitado, "tiktok");
  }
}

/** Vuelve a redactar un ítem (nuevo copy sobre los mismos hechos). */
export async function regenerateItem(state: State, itemId: string) {
  const it = state.items.find((i) => i.id === itemId);
  if (!it?.clip) throw new Error("Ítem no encontrado");
  const ep = state.episodes.find((e) => e.videoId === it.episodeId);
  if (!ep?.analysis) throw new Error("El episodio no tiene análisis");
  const cand = ep.analysis.clips.find((c) => c.inicio === it.clip!.inicio && c.fin === it.clip!.fin) ?? {
    ...it.clip,
    titulo: it.clip.tituloInterno,
    tema: "",
    citas: [],
    gancho: "",
    motivo: "",
    puntaje: 0,
  };
  it.clip = await buildClipItem(cand, ep, state, it.clip.angulo);
  logLine(state, `Copy regenerado para el clip del ${it.date}.`);
}

/**
 * Muchos canales titulan "Tema | Nombre Apellido". Ese nombre le gana al del
 * modelo cuando el modelo sólo escuchó el apodo.
 */
export function guessGuest(videoTitle: string, fromModel: string): string {
  const tail = videoTitle.split("|").pop()?.trim() ?? "";
  const looksLikeName = /^[A-ZÁÉÍÓÚÑ][\wáéíóúñü'.-]+(?: [A-ZÁÉÍÓÚÑ][\wáéíóúñü'.-]+){1,3}$/u.test(tail);
  if (looksLikeName && videoTitle.includes("|")) {
    if (!fromModel || fromModel.split(" ").length < 2) return tail;
    if (tail.toLowerCase().includes(fromModel.toLowerCase().split(" ")[0])) return tail;
  }
  return fromModel || tail;
}

/** Episodios analizados a los que les faltan piezas por agendar (p. ej. tras un timeout). */
export async function scheduleMissing(state: State): Promise<number> {
  let n = 0;
  for (const ep of state.episodes) {
    if (ep.status !== "analyzed" || !ep.analysis) continue;
    const target = CLIPS_PER_EPISODE + (ep.stretch ? STRETCH_EXTRA_CLIPS : 0);
    if ((ep.scheduled?.clips ?? 0) >= target) continue;
    // Sólo episodios recientes: los viejos analizados a mano no se re-agendan solos.
    if (Date.now() - new Date(ep.analyzedAt ?? 0).getTime() > 3 * 86400_000) continue;
    const created = await scheduleEpisode(state, ep);
    n += created.length;
    if (created.length === 0) ep.scheduled = { clips: target };
  }
  if (scheduleRecycleIfEmpty(state)) n++;
  return n;
}

/**
 * Re-distribuye las piezas NO publicadas de un episodio desde `from` (hoy por
 * defecto), respetando el plan y el modo extendido. Las publicadas no se tocan.
 */
export function replanEpisode(state: State, ep: Episode, from = localDate()): number {
  const mine = state.items.filter((i) => i.episodeId === ep.videoId && i.status !== "published").sort((a, b) => a.date.localeCompare(b.date));
  const ids = new Set(mine.map((i) => i.id));
  const dates = nextFreeSlots(state, "clip", from, mine.length, { stretch: ep.stretch, ignoreItemIds: ids });
  mine.forEach((it, i) => {
    if (dates[i]) it.date = dates[i];
  });
  state.items.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  logLine(state, `Re-planificadas ${mine.length} piezas de "${ep.title}" desde ${from}${ep.stretch ? " (semana extendida)" : ""}.`);
  return mine.length;
}
