// Compuertas puras del planner, sin base ni modelos:
//   npx tsx lib/planner.test.ts
import { cederLaSemana, videoWeekStart, faltantesDeLaSemana, isoDow, nextFreeSlots, parseWeeklyPlan, redesDe, redNoAdmitida, weekSlots } from "./planner.ts";
import type { Item, State } from "./store.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FALLA:", msg);
    process.exitCode = 1;
  } else console.log("ok  ", msg);
}

const item = (id: string, videoId: string, date: string, status: Item["status"] = "planned"): Item => ({
  id,
  videoId,
  kind: "clip",
  date,
  time: "21:00",
  status,
  createdAt: "2026-01-01T00:00:00Z",
});
const state = (items: Item[]): State => ({ version: 1, videos: [], items, log: [] });

assert(redesDe("clip").includes("tiktok") && redesDe("clip").includes("instagram") && redesDe("clip").includes("youtube"), "el clip va a las tres redes");
assert(redNoAdmitida("clip", "tiktok") === null, "clip + tiktok pasa");

assert(parseWeeklyPlan(undefined).length === 6, "plan por defecto: lunes a sábado");
assert(parseWeeklyPlan("1,3,5").map((s) => s.dow).join(",") === "1,3,5", "WEEKLY_PLAN=1,3,5");
assert(parseWeeklyPlan("1:clip,2:clip").length === 2, "formato viejo 1:clip sigue valiendo");
assert(parseWeeklyPlan("9,x").length === 6, "plan inválido cae al default");

assert(isoDow("2026-09-13") === 7, "2026-09-13 es domingo");
assert(videoWeekStart("2026-09-13T20:00:00Z", "2026-09-14") === "2026-09-13", "la semana del video arranca su domingo");
assert(videoWeekStart("2026-08-30T20:00:00Z", "2026-09-14") === "2026-09-13", "un video viejo usa la semana en curso");

// weekSlots: lunes a sábado libres, salta días pasados y ocupados
const s1 = state([item("a", "otro", "2026-09-15")]);
const slots = weekSlots(s1, "2026-09-13", "clip", "2026-09-14");
assert(slots.join(",") === "2026-09-14,2026-09-16,2026-09-17,2026-09-18,2026-09-19", `weekSlots salta el martes ocupado (${slots.join(",")})`);

// cederLaSemana: lo de otro video se corre 7 días, lo publicado no se toca
const s2 = state([item("x", "otro", "2026-09-15"), item("y", "otro", "2026-09-16", "published"), item("z", "otro", "2026-09-22")]);
const movidas = cederLaSemana(s2, "nuevo", "2026-09-13");
assert(movidas.length === 1 && movidas[0].id === "x" && movidas[0].date === "2026-09-29", `cede la semana: x se corre al 29 porque el 22 está ocupado (${movidas.map((m) => m.date).join(",")})`);
assert(s2.items.find((i) => i.id === "y")!.date === "2026-09-16", "lo publicado no se mueve");

// faltantes: se nombra qué faltó y por qué
const falt = faltantesDeLaSemana(state([item("p", "otro", "2026-09-17", "published")]), "nuevo", "2026-09-13", "2026-09-15", 5, 3);
assert(falt && /2 clip/.test(falt.faltan) && /tomados/.test(falt.porQue) && /pasados/.test(falt.porQue), `faltantes nombra días tomados y pasados (${falt?.porQue})`);
assert(faltantesDeLaSemana(state([]), "nuevo", "2026-09-13", "2026-09-13", 3, 3) === null, "si la semana alcanzó, no hay aviso");

// nextFreeSlots: días consecutivos del plan, salta los ocupados
const libres = nextFreeSlots(state([item("q", "otro", "2026-09-15")]), "clip", "2026-09-14", 3);
assert(libres.join(",") === "2026-09-14,2026-09-16,2026-09-17", `nextFreeSlots salta el martes ocupado (${libres.join(",")})`);
