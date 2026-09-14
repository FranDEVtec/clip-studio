// El modelo bayesiano, sin base:
//   npx tsx lib/stats.test.ts
import { analizarPalancas, conocimiento, decidir, posterior } from "./stats.ts";
import type { Item, State } from "./store.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FALLA:", msg);
    process.exitCode = 1;
  } else console.log("ok  ", msg);
}

// posterior: media entre lo y hi, y se estrecha con más datos
const a = posterior(5, 200, "saveRate");
const b = posterior(50, 2000, "saveRate");
assert(a.lo <= a.media && a.media <= a.hi, "el intervalo contiene la media");
assert(b.hi - b.lo < a.hi - a.lo, "más vistas → intervalo más angosto");
assert(posterior(5, 200, "saveRate").media === a.media, "determinista: el mismo estado da el mismo número");
assert(posterior(0, 0, "saveRate").media > 0, "sin datos, la media es el prior (no NaN)");

// palancas sobre un estado chico: no rompe y devuelve una por dimensión
const clip = (id: string, date: string, hora: number, views: number, saves: number): Item => ({
  id,
  videoId: "ep",
  kind: "clip",
  date,
  time: "21:00",
  status: "published",
  createdAt: "2026-01-01T00:00:00Z",
  clip: {
    inicio: 10,
    fin: 90,
    tituloInterno: id,
    caption: "",
    molde: "revelacion",
    transcripcion: "",
    avisos: [],
    pieces: { molde: "revelacion", claim: "El 98% no lo sabe", cita_textual: "", emoji: "", hashtags: [], hashtags_tiktok: [], hook_edicion: "EL 98% NO LO SABE" },
  },
  metrics: { tiktok: { views, saves, hora, duracionSeg: 80, updatedAt: "2026-01-02T00:00:00Z" } },
});
const state: State = {
  version: 1,
  videos: [{ videoId: "ep", url: "", title: "t", publishedAt: "2026-01-01T00:00:00Z", status: "analyzed" }],
  items: [clip("a", "2026-01-05", 21, 1000, 40), clip("b", "2026-01-06", 12, 1000, 5), clip("c", "2026-01-07", 21, 1200, 50)],
  log: [],
};
const palancas = analizarPalancas(state);
assert(palancas.length > 0, `hay palancas (${palancas.length})`);
const hora = palancas.find((p) => p.id === "hora");
assert(hora && hora.brazos.length === 2, "la palanca hora tiene dos brazos (21 hs y 12 hs)");
const dec = decidir(palancas);
assert(dec.every((d) => d.elegido), "cada decisión elige una opción");
const k = conocimiento(state, palancas);
assert(k.observaciones === 3 && k.veredicto.length > 0, `conocimiento cuenta 3 observaciones y tiene veredicto (${k.observaciones})`);
assert(conocimiento({ version: 1, videos: [], items: [], log: [] }, analizarPalancas({ version: 1, videos: [], items: [], log: [] })).veredicto.length > 0, "sin datos hay veredicto igual (no rompe)");
