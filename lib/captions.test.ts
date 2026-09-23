// El anclaje a subtítulos, sin red:
//   npx tsx lib/captions.test.ts
import { findPhrase, parseJson3, snapToCaptions } from "./captions.ts";
import type { VideoAnalysis } from "./store.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FALLA:", msg);
    process.exitCode = 1;
  } else console.log("ok  ", msg);
}

// Un json3 mínimo: dos eventos, palabras con offset.
const json3 = JSON.stringify({
  events: [
    { tStartMs: 1000, segs: [{ utf8: "Hola" }, { utf8: " a", tOffsetMs: 300 }, { utf8: " todos", tOffsetMs: 600 }] },
    { tStartMs: 60000, segs: [{ utf8: "Salí" }, { utf8: " de", tOffsetMs: 200 }, { utf8: " mi", tOffsetMs: 400 }, { utf8: " hotel", tOffsetMs: 600 }, { utf8: " a", tOffsetMs: 900 }, { utf8: " las", tOffsetMs: 1000 }, { utf8: " doce", tOffsetMs: 1300 }] },
    { tStartMs: 120000, segs: [{ utf8: "y" }, { utf8: " eso", tOffsetMs: 100 }, { utf8: " fue", tOffsetMs: 300 }, { utf8: " todo", tOffsetMs: 500 }, { utf8: " gracias", tOffsetMs: 800 }] },
  ],
});
const words = parseJson3(json3);
assert(words.length === 15 && words[3].w === "sali" && words[3].t === 60, `parseJson3 normaliza y pone el segundo (${words[3].w}@${words[3].t})`);
assert(findPhrase(words, "Salí de mi hotel a las doce") === 60, "findPhrase encuentra la frase entera");
assert(findPhrase(words, "salí de mi HOTEL, a las... 12") === 60, "findPhrase tolera puntuación y mayúsculas (prefijo)");
assert(findPhrase(words, "hola a") === null, "una frase de dos palabras no se busca");
assert(findPhrase(words, "Salí de mi hotel", 70) === null, "no busca antes de `from`");

const base: VideoAnalysis = {
  tema: "", tesis: "", ejes: [],
  clips: [
    { inicio: 52, fin: 122, titulo: "hotel", tema: "", transcripcion: "[0:52] LUISITO — Salí de mi hotel a las doce y eso fue todo gracias", citas: [{ texto: "Salí de mi hotel a las doce", segundo: 52 }], gancho: "Salí de mi hotel a las doce", motivo: "", puntaje: 9 },
    { inicio: 500, fin: 570, titulo: "lejos", tema: "", transcripcion: "nada que exista", citas: [], gancho: "una frase que no está en los subtítulos", motivo: "", puntaje: 5 },
  ],
};
const { analysis, anclados } = snapToCaptions(base, words);
assert(anclados === 1, `ancla sólo el tramo cuyo gancho aparece cerca (${anclados})`);
const c0 = analysis.clips[0];
assert(c0.precision === "subtitulos" && c0.inicio === 59.6, `el inicio queda 0,4 s antes de la frase (${c0.inicio})`);
assert(c0.citas[0].segundo === 60, `la cita se re-ubica en su segundo real (${c0.citas[0].segundo})`);
assert(c0.fin === 121.4, `el fin se toma de las últimas palabras cuando caen cerca de lo esperado (${c0.fin})`);
assert(analysis.clips[1].precision === undefined && analysis.clips[1].inicio === 500, "el tramo sin ancla no se toca");
