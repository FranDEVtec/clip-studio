// Cron diario (vercel.json): mira el canal, analiza el episodio nuevo si lo hay
// y agenda sus piezas. También se puede disparar a mano desde la UI.
import { NextResponse, after } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { loadState, saveState, logLine } from "@/lib/store";
import { pendingDrafts, processNextPending, scanChannel, scheduleMissing } from "@/lib/pipeline";
import { continueStep, continueWriting, selfAuthHeaders, writeLoop } from "@/lib/chain";
import { runMetricCheckpoint, syncMetrics } from "@/lib/metrics-sync";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function authorized(request: Request): Promise<boolean> {
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return isAuthorized(request);
}

export async function GET(request: Request) {
  if (!(await authorized(request))) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const startedAt = Date.now();
  const url = new URL(request.url);
  const origin = url.origin;
  const step = url.searchParams.get("step");
  const state = await loadState();
  try {
    let queued = 0;
    if (step === "metrics-item") {
      const itemId = url.searchParams.get("itemId") ?? "";
      const cp = url.searchParams.get("cp") ?? "x";
      await runMetricCheckpoint(state, itemId, cp);
      await saveState(state);
      return NextResponse.json({ ok: true, itemId, cp });
    }
    if (step === "metrics") {
      // Paso separado: los scrapers tardan 1-3 min y no tienen por qué compartir invocación con Gemini.
      const r = await syncMetrics(state);
      await saveState(state);
      return NextResponse.json({ ok: true, metrics: r });
    }
    if (step === "analyze") {
      // Paso propio: Gemini mirando una hora de video se come casi toda la
      // invocación. Compartirla con el escaneo y la redacción la mata por tiempo.
      const ep = await processNextPending(state);
      await saveState(state);
      await scheduleMissing(state);
      await saveState(state);
      const quedan = state.episodes.some((e) => e.status === "pending");
      if (quedan) continueStep(origin, "analyze");
      else continueWriting(origin, pendingDrafts(state).length, state);
      return NextResponse.json({ ok: true, analizado: ep?.videoId ?? null, quedanPendientes: quedan });
    }
    if (step !== "write") {
      queued = await scanChannel(state);
      logLine(state, `Escaneo: ${queued} episodio(s) nuevo(s) en cola.`);
      await saveState(state);
      if (state.episodes.some((e) => e.status === "pending")) {
        continueStep(origin, "analyze");
        return NextResponse.json({ ok: true, queued, analisis: "encadenado" });
      }
      await scheduleMissing(state);
      await saveState(state);
    }
    // Redacción encadenada: de a 2 piezas mientras haya presupuesto; el resto, en la próxima invocación.
    const remaining = await writeLoop(state, startedAt, 200_000);
    continueWriting(origin, remaining, state);
    // Después del escaneo diario, sincronizar métricas en otra invocación.
    if (remaining <= 0 && step !== "write") {
      const headers = selfAuthHeaders();
      after(() => fetch(`${origin}/api/cron/scan?step=metrics`, { headers, cache: "no-store" }).catch(() => {}));
    }
    if (step !== "write") await saveState(state);
    return NextResponse.json({ ok: true, queued, remaining });
  } catch (err) {
    logLine(state, `ERROR en el escaneo: ${err instanceof Error ? err.message : String(err)}`);
    await saveState(state);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
