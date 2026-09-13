// Estado del calendario + acciones de la UI.
import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { loadState, saveState, logLine, type Metrics, type Platform, type State } from "@/lib/store";
import { redesDe, redNoAdmitida } from "@/lib/planner";
import { continueWriting } from "@/lib/chain";
import { metricsConfigured, scheduleMetricCheckpoints, syncMetrics } from "@/lib/metrics-sync";
import { modelo } from "@/lib/stats";
import { publicConfig } from "@/lib/config";
import { DEFAULT_STYLE_GUIDE } from "@/lib/style";
import {
  addEpisodeByUrl,
  processEpisode,
  processEpisodeAnalysisOnly,
  processNextPending,
  reassembleEpisodeItems,
  scheduleMissing,
  pendingDrafts,
  regenerateItem,
  replanEpisode,
  scanChannel,
  scheduleEpisode,
} from "@/lib/pipeline";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const ok = (request: Request) => isAuthorized(request);

export async function GET(request: Request) {
  if (!(await ok(request))) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const state = await loadState();
  return NextResponse.json(payload(state));
}

/** Lo que la UI necesita además del State: configuración pública, fuentes de métricas y el modelo. */
function payload(state: State) {
  return {
    ...state,
    config: publicConfig(),
    defaultStyleGuide: DEFAULT_STYLE_GUIDE,
    metricsSources: metricsConfigured(),
    modelo: modelo(state),
  };
}

type Action =
  | { action: "scan" }
  | { action: "addEpisode"; url: string; saleEl?: string }
  | { action: "analyze" | "reanalyze"; videoId: string }
  | { action: "reschedule"; videoId: string }
  | { action: "ignoreEpisode"; videoId: string }
  | { action: "publish" | "unpublish" | "delete" | "regenerate"; itemId: string }
  | { action: "move"; itemId: string; date: string; time?: string }
  | { action: "meta"; videoId: string; guest?: string; episodeNumber?: string }
  | { action: "metrics"; itemId: string; network: Platform; metrics: Partial<Metrics> }
  | { action: "publishedOn"; itemId: string; network: Platform; on: boolean }
  | { action: "retencion"; itemId: string; network: Platform; hookPct?: number; completionPct?: number }
  | { action: "stretch"; videoId: string; stretch: boolean }
  | { action: "replan"; videoId: string; from?: string }
  | { action: "syncMetrics" }
  | { action: "postUrl"; itemId: string; network: Platform; url: string }
  | { action: "clearPost"; itemId: string; network: Platform }
  | { action: "styleGuide"; text: string }
  | { action: "rule"; text?: string; ruleId?: string; active?: boolean; delete?: boolean };

export async function POST(request: Request) {
  if (!(await ok(request))) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const origin = new URL(request.url).origin;
  const body = (await request.json()) as Action;
  const state = await loadState();
  // Acciones que reservan piezas: después redactan lo que puedan y encadenan el resto.
  const reserves = ["scan", "addEpisode", "analyze", "reschedule", "stretch"].includes(body.action);
  try {
    switch (body.action) {
      case "scan": {
        const queued = await scanChannel(state);
        logLine(state, `Escaneo manual: ${queued} episodio(s) nuevo(s).`);
        await saveState(state);
        await processNextPending(state);
        await scheduleMissing(state);
        break;
      }
      case "addEpisode": {
        const ep = await addEpisodeByUrl(state, body.url, { saleEl: body.saleEl || undefined });
        await saveState(state);
        if (ep.status === "pending") await processEpisode(state, ep);
        break;
      }
      case "analyze": {
        const ep = state.episodes.find((e) => e.videoId === body.videoId);
        if (!ep) throw new Error("Episodio no encontrado");
        ep.status = "pending";
        await saveState(state);
        await processEpisode(state, ep);
        break;
      }
      case "reanalyze": {
        const ep = state.episodes.find((e) => e.videoId === body.videoId);
        if (!ep) throw new Error("Episodio no encontrado");
        await processEpisodeAnalysisOnly(state, ep);
        break;
      }
      // Carga en tanda de la retención. NO usa "metrics" porque esa acción
      // reemplaza el objeto entero de la red: acá se fusiona sobre lo que ya está.
      case "retencion": {
        const it = state.items.find((i) => i.id === body.itemId);
        if (!it) throw new Error("Ítem no encontrado");
        const prev = it.metrics?.[body.network] ?? {};
        const nums: Partial<Metrics> = {};
        for (const k of ["hookPct", "completionPct"] as const) {
          const v = body[k];
          if (v === undefined || v === null) continue;
          const n = Number(v);
          if (Number.isFinite(n) && n >= 0 && n <= 100) nums[k] = n;
        }
        if (!Object.keys(nums).length) throw new Error("Nada para guardar: el hook % y el completion % van entre 0 y 100.");
        it.metrics = { ...(it.metrics ?? {}), [body.network]: { ...prev, ...nums, updatedAt: new Date().toISOString() } };
        logLine(state, `Retención ${body.network} cargada para el clip del ${it.date}: hook ${nums.hookPct ?? "—"} % · completion ${nums.completionPct ?? "—"} %.`);
        break;
      }
      case "reschedule": {
        const ep = state.episodes.find((e) => e.videoId === body.videoId);
        if (!ep) throw new Error("Episodio no encontrado");
        await scheduleEpisode(state, ep);
        break;
      }
      case "publishedOn": {
        const it = state.items.find((i) => i.id === body.itemId);
        if (!it) throw new Error("Ítem no encontrado");
        const set = new Set(it.publishedOn ?? []);
        if (body.on) {
          const motivo = redNoAdmitida(it.kind, body.network);
          if (motivo) throw new Error(motivo);
          set.add(body.network);
        } else set.delete(body.network);
        it.publishedOn = [...set];
        const needed: Platform[] = redesDe(it.kind);
        const done = needed.every((n) => set.has(n));
        if (done && it.status !== "published") {
          it.status = "published";
          it.publishedAt = it.publishedAt ?? new Date().toISOString();
        } else if (!done && set.size === 0 && it.status === "published") {
          it.status = "planned";
          it.publishedAt = undefined;
        }
        // Apenas hay una red marcada se programan los checkpoints de métricas (5h / 24h / 7d).
        if (set.size > 0) await scheduleMetricCheckpoints(state, it, origin);
        break;
      }
      case "publish":
      case "unpublish": {
        const it = state.items.find((i) => i.id === body.itemId);
        if (!it) throw new Error("Ítem no encontrado");
        it.status = body.action === "publish" ? "published" : "planned";
        it.publishedAt = body.action === "publish" ? new Date().toISOString() : undefined;
        if (body.action === "publish") await scheduleMetricCheckpoints(state, it, origin);
        break;
      }
      // Un video que entró como episodio y no lo es: se ignora y se sueltan sus
      // piezas no publicadas. Lo publicado queda: ya está en la calle.
      case "ignoreEpisode": {
        const ep = state.episodes.find((e) => e.videoId === body.videoId);
        if (!ep) throw new Error("Episodio no encontrado");
        ep.status = "ignored";
        const antes = state.items.length;
        state.items = state.items.filter((i) => i.episodeId !== ep.videoId || i.status === "published");
        logLine(state, `Episodio ignorado: "${ep.title}" (${ep.videoId}); ${antes - state.items.length} pieza(s) no publicadas quitadas del calendario.`);
        break;
      }
      case "delete": {
        const idx = state.items.findIndex((i) => i.id === body.itemId);
        if (idx < 0) throw new Error("Ítem no encontrado");
        const [it] = state.items.splice(idx, 1);
        const ep = state.episodes.find((e) => e.videoId === it.episodeId);
        if (ep?.scheduled) ep.scheduled.clips = Math.max(0, ep.scheduled.clips - 1);
        logLine(state, `Ítem borrado: clip del ${it.date}.`);
        break;
      }
      case "regenerate":
        await regenerateItem(state, body.itemId);
        break;
      case "clearPost": {
        const it = state.items.find((i) => i.id === body.itemId);
        if (!it) throw new Error("Ítem no encontrado");
        if (it.posts) delete it.posts[body.network];
        if (it.metrics?.[body.network]?.source?.startsWith("apify")) delete it.metrics[body.network];
        const quedanMetricas = Object.values(it.metrics ?? {}).some((m) => (m?.views ?? 0) > 0 || (m?.likes ?? 0) > 0);
        if (it.status === "published" && !quedanMetricas && !Object.keys(it.posts ?? {}).length) {
          it.status = "planned";
          it.publishedAt = undefined;
        }
        logLine(state, `Emparejamiento borrado: clip del ${it.date} en ${body.network}.`);
        break;
      }
      case "move": {
        const it = state.items.find((i) => i.id === body.itemId);
        if (!it) throw new Error("Ítem no encontrado");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) throw new Error("Fecha inválida");
        it.date = body.date;
        if (body.time && /^\d{2}:\d{2}$/.test(body.time)) it.time = body.time;
        state.items.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
        break;
      }
      case "meta": {
        const ep = state.episodes.find((e) => e.videoId === body.videoId);
        if (!ep) throw new Error("Episodio no encontrado");
        if (body.guest !== undefined) ep.guest = body.guest.trim().slice(0, 120);
        if (body.episodeNumber !== undefined) ep.episodeNumber = body.episodeNumber.replace(/\D/g, "").slice(0, 6);
        reassembleEpisodeItems(state, ep);
        break;
      }
      case "metrics": {
        const it = state.items.find((i) => i.id === body.itemId);
        if (!it) throw new Error("Ítem no encontrado");
        const clean: Metrics = { updatedAt: new Date().toISOString() };
        for (const [k, v] of Object.entries(body.metrics ?? {})) {
          if (k === "notes") clean.notes = String(v ?? "").slice(0, 2000);
          else if (k !== "updatedAt" && v !== "" && v !== null && v !== undefined && Number.isFinite(Number(v)))
            (clean as Record<string, unknown>)[k] = Number(v);
        }
        const empty = Object.keys(clean).length === 1 || (Object.keys(clean).length === 2 && clean.notes === "");
        if (empty) {
          // Formulario vacío = borrar las métricas de esa red.
          const rest = { ...(it.metrics ?? {}) };
          delete rest[body.network];
          it.metrics = rest;
          logLine(state, `Métricas ${body.network} borradas para el clip del ${it.date}.`);
          break;
        }
        it.metrics = { ...(it.metrics ?? {}), [body.network]: clean };
        if (it.status !== "published") {
          it.status = "published";
          it.publishedAt = it.publishedAt ?? new Date().toISOString();
        }
        logLine(state, `Métricas ${body.network} cargadas para el clip del ${it.date}.`);
        break;
      }
      case "stretch": {
        const ep = state.episodes.find((e) => e.videoId === body.videoId);
        if (!ep) throw new Error("Episodio no encontrado");
        ep.stretch = body.stretch;
        replanEpisode(state, ep);
        if (body.stretch && ep.status === "analyzed") {
          await saveState(state);
          await scheduleEpisode(state, ep);
        }
        break;
      }
      case "replan": {
        const ep = state.episodes.find((e) => e.videoId === body.videoId);
        if (!ep) throw new Error("Episodio no encontrado");
        replanEpisode(state, ep, body.from);
        break;
      }
      case "syncMetrics":
        await syncMetrics(state);
        break;
      case "postUrl": {
        const it = state.items.find((i) => i.id === body.itemId);
        if (!it) throw new Error("Ítem no encontrado");
        const url = body.url.trim().slice(0, 500);
        if (url && !/^https:\/\/([\w-]+\.)*(tiktok\.com|instagram\.com|youtube\.com|youtu\.be)\//i.test(url)) throw new Error("La URL tiene que ser de TikTok, Instagram o YouTube");
        const posts = { ...(it.posts ?? {}) };
        if (!url) delete posts[body.network];
        else posts[body.network] = { url, matchedBy: "manual", matchedAt: new Date().toISOString() };
        it.posts = posts;
        break;
      }
      case "styleGuide": {
        state.settings = { ...(state.settings ?? {}), styleGuide: String(body.text ?? "").slice(0, 20_000) };
        logLine(state, "Guía de estilo actualizada.");
        break;
      }
      case "rule": {
        const rules = [...(state.settings?.rules ?? [])];
        if (body.ruleId) {
          const idx = rules.findIndex((r) => r.id === body.ruleId);
          if (idx < 0) throw new Error("Regla no encontrada");
          if (body.delete) rules.splice(idx, 1);
          else if (typeof body.active === "boolean") rules[idx] = { ...rules[idx], active: body.active };
        } else {
          const text = String(body.text ?? "").trim().slice(0, 600);
          if (!text) throw new Error("La regla está vacía");
          rules.push({ id: `rule-${Date.now()}`, text, active: true, createdAt: new Date().toISOString() });
        }
        state.settings = { ...(state.settings ?? {}), rules };
        break;
      }
      default:
        throw new Error("Acción desconocida");
    }
    if (reserves) {
      // No se escribe inline: la UI responde ya y la cadena corre en invocaciones propias.
      continueWriting(origin, pendingDrafts(state).length, state);
    }
    await saveState(state);
    return NextResponse.json(payload(state));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    logLine(state, `ERROR: ${msg}`);
    await saveState(state);
    return NextResponse.json({ error: msg, ...payload(state) }, { status: 500 });
  }
}
