// Compuertas de la copy de clips, sin OpenAI:
//   npx tsx lib/copy.test.ts
import { buildCaption, captionSinElNumero, cifras, findProblems, hookNoEsClaim, normalizeHashtag, quoteIsReal, type CopyPieces } from "./copy.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FALLA:", msg);
    process.exitCode = 1;
  } else console.log("ok  ", msg);
}

// --- el titular tiene que ser un claim
assert(hookNoEsClaim("el") !== null, "«el» (una palabra) falla");
assert(hookNoEsClaim("ANA GÓMEZ", "Ana Gómez") !== null, "sólo el nombre falla");
assert(hookNoEsClaim("CON ANA GÓMEZ", "Ana Gómez") !== null, "«CON + nombre» falla");
assert(hookNoEsClaim("CREADOR DE CONTENIDO Y COMUNICADOR") !== null, "ocupación + complementos falla");
assert(hookNoEsClaim("COMO ESTUDIAR MEJOR") === null, "«COMO ESTUDIAR MEJOR» pasa");
assert(hookNoEsClaim("NUTRICIONISTA DESMIENTE EL 98%", "Ana Gómez") === null, "ocupación + verbo + dígito pasa");
assert(hookNoEsClaim("FUNDADOR QUEBRÓ TRES VECES", "Juan Pérez") === null, "ocupación + verbo pasa");
assert(hookNoEsClaim("ESPECIALISTA EN ORATORIA", "Ana Gómez") !== null, "una ocupación sola falla");

// --- verificación de citas
const transcript = "[0:12] ANA — Yo hago entre 300 y 400 sentadillas por día, y lo tengo medido.";
assert(quoteIsReal("Yo hago entre 300 y 400 sentadillas por día", transcript), "cita textual pasa");
assert(quoteIsReal("yo hago entre 300 y 400 sentadillas por dia", transcript), "sin tildes ni mayúsculas también pasa");
assert(!quoteIsReal("Yo hago 500 sentadillas por día", transcript), "cita inventada falla");
assert(!quoteIsReal("por día", transcript), "una cita de dos palabras no se verifica");

// --- integrado en findProblems
const base: CopyPieces = {
  molde: "revelacion",
  claim: "Hace entre 300 y 400 sentadillas por día y lo tiene medido",
  cita_textual: "",
  emoji: "🏋️",
  hashtags: ["entrenamiento", "sentadillas", "salud", "podcast", "habitos"],
  hashtags_tiktok: ["gym", "sentadillas", "rutina", "podcast", "habitos"],
  hook_edicion: "300 Y 400 SENTADILLAS POR DÍA",
};
const p0 = findProblems(base, transcript, { nombre: "Ana Gómez" });
assert(p0.length === 0, `una pieza correcta no dispara nada (${p0.join(" | ") || "sin problemas"})`);
const p1 = findProblems({ ...base, hook_edicion: "CON ANA GÓMEZ" }, transcript, { nombre: "Ana Gómez" });
assert(p1.some((x) => x.includes("sólo el nombre de quien habla")), "findProblems marca el titular = nombre");
const p2 = findProblems({ ...base, hashtags: ["fyp", "viral", "a", "b", "c"] }, transcript);
assert(p2.some((x) => x.includes("prohibidos")), "hashtags de spam en Instagram se frenan");
const p3 = findProblems({ ...base, molde: "cita", cita_textual: "Yo hago 500 sentadillas por día" }, transcript);
assert(p3.some((x) => x.startsWith("La cita")), "una cita inventada se frena");

// --- la línea 1 del caption trae el número del titular
assert(cifras("300 Y 400 SENTADILLAS POR DÍA").join(",") === "300,400" && cifras("20.000 neuronas menos").join(",") === "20000" && cifras("el 98%").join(",") === "98", "cifras normalizadas");
assert(captionSinElNumero(base, "Ana Gómez") === null, "caption con «300 y 400» pasa");
assert(captionSinElNumero({ ...base, claim: "Nuevo video, ya disponible" }, "Ana Gómez") !== null, "teaser falla");
assert(captionSinElNumero({ ...base, claim: "La rutina de sentadillas que cambió todo" }, "Ana Gómez") !== null, "claim sin el número del titular falla");
assert(captionSinElNumero({ ...base, hook_edicion: "LA CREATIVIDAD SE ENTRENA", claim: "La creatividad se entrena como un músculo" }) === null, "titular sin número: pasa");
assert(captionSinElNumero({ ...base, molde: "cita", cita_textual: "«Yo hago entre 300 y 400 por día»", claim: "otra cosa" }, "Ana Gómez") === null, "molde cita: la L1 es la cita");

// --- el armado del caption es código
const cap = buildCaption(base, "tiktok");
assert(cap.startsWith("Hace entre 300 y 400 sentadillas por día y lo tiene medido 🏋️"), "claim + emoji arriba");
assert(cap.endsWith("#gym #sentadillas #rutina #podcast #habitos"), "hashtags de TikTok abajo con #");
const capCita = buildCaption({ ...base, molde: "cita", cita_textual: "«Lo tengo medido»" });
assert(capCita.startsWith('"Lo tengo medido" 🏋️'), `cita: comillas + emoji, sin nombre (${capCita.split("\n")[0]})`);

// --- hashtags de una palabra y emoji sin duplicar (visto en la primera corrida real)
assert(normalizeHashtag("#Vaca Púrpura") === "vacapurpura", "normalizeHashtag une palabras y saca tildes");
const p5 = findProblems({ ...base, hashtags: ["habilidades blandas", "ventas", "comunicacion", "trabajo", "podcast"] }, transcript);
assert(p5.some((x) => x.includes("mal formados")), "un hashtag con espacio se frena");
const capDup = buildCaption({ ...base, claim: "Tres de cada cuatro son empleados 📊", emoji: "📊", hashtags_tiktok: ["vaca purpura", "b", "c", "d", "e"] }, "tiktok");
assert(capDup.split("📊").length === 2, `el emoji no se duplica (${capDup.split("\n")[0]})`);
assert(capDup.endsWith("#vacapurpura #b #c #d #e"), "los hashtags salen normalizados aunque el modelo los haya devuelto con espacio");
