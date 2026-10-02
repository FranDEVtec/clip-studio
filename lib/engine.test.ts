// Lógica pura del motor (tiempos de corte, parsing de URLs, cadena de modelos), sin red:
//   npx tsx lib/engine.test.ts
import { calibrate, modelChain } from "./video-engine.ts";
import { parseVideoId } from "./youtube.ts";
import type { ClipCandidate, VideoAnalysis } from "./store.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FALLA:", msg);
    process.exitCode = 1;
  } else console.log("ok  ", msg);
}

const clip = (inicio: number, fin: number, cita: number): ClipCandidate =>
  ({ inicio, fin, titulo: "t", tema: "t", transcripcion: "", citas: [{ texto: "x", segundo: cita }] }) as unknown as ClipCandidate;

const analysis = (dur: number, clips: ClipCandidate[]): VideoAnalysis => ({
  duracion_total: dur,
  tema: "t",
  tesis: "t",
  ejes: [{ nombre: "e", idea: "i", segundo: 100 } as never],
  clips,
});

// calibrate: escala la línea de tiempo cuando el modelo la estiró o comprimió
const stretched = calibrate(analysis(1600, [clip(800, 900, 850)]), 1000);
assert(Math.abs((stretched.escala ?? 0) - 0.625) < 1e-9, "detecta la escala real/percibida (1000/1600)");
assert(stretched.clips[0].inicio === 500 && stretched.clips[0].fin === 563, "escala inicio y fin del corte");
assert(stretched.clips[0].citas[0].segundo === 531, "escala el segundo de las citas");
assert(stretched.ejes?.[0].segundo === 63, "escala los ejes");

const close = calibrate(analysis(1020, [clip(100, 190, 120)]), 1000);
assert(close.escala === 1 && close.clips[0].inicio === 100, "diferencia menor al 5 %: no toca los tiempos");

const noReal = calibrate(analysis(1600, [clip(800, 900, 850)]), undefined);
assert(noReal.escala === 1 && noReal.clips[0].fin === 900, "sin duración real no calibra");

const outside = calibrate(analysis(500, [clip(-3, 520, 510)]), 2000);
assert(outside.clips.every((c) => c.inicio >= 0 && c.fin <= 2000), "ningún tiempo queda fuera del video");

const shrunk = calibrate(analysis(0, [clip(10, 1200, 30)]), 1000);
assert(shrunk.clips[0].fin <= 1000, "usa el fin del último clip si falta duracion_total, y recorta al largo real");

// parseVideoId
const id = "dQw4w9WgXcQ";
for (const url of [
  id,
  `https://www.youtube.com/watch?v=${id}`,
  `https://youtube.com/watch?feature=share&v=${id}`,
  `https://youtu.be/${id}?t=42`,
  `https://www.youtube.com/shorts/${id}`,
  `https://www.youtube.com/embed/${id}`,
  `https://www.youtube.com/live/${id}`,
  `  ${id}  `,
]) {
  assert(parseVideoId(url) === id, `parseVideoId(${url.trim()})`);
}
assert(parseVideoId("https://www.youtube.com/@handle") === null, "una URL de canal no es un video");
assert(parseVideoId("hola") === null, "texto suelto no es un video");

// modelChain
delete process.env.GEMINI_MODEL;
delete process.env.GEMINI_FALLBACK_MODEL;
assert(modelChain().length === 2, "por defecto: principal + fallback");
process.env.GEMINI_MODEL = "m";
process.env.GEMINI_FALLBACK_MODEL = "m";
assert(modelChain().join() === "m", "si principal y fallback son el mismo, se prueba una sola vez");
