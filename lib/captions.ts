// Subtítulos automáticos de YouTube: la línea de tiempo REAL del video.
//
// Los segundos que devuelve Gemini se calibran contra la duración total
// (lib/video-engine.ts → calibrate), pero eso deja un error de ±10-20 s, y un
// corte necesita el borde exacto de la frase. La página pública del video trae
// las pistas de subtítulos (captionTracks) con una URL firmada que sirve desde
// la misma IP: se baja en json3 y queda una lista de palabras con su segundo.
// Con eso, cada tramo se ANCLA: el gancho (primera frase) fija el inicio y las
// últimas palabras de la transcripción fijan el fin. Si el video no tiene
// subtítulos (privado, sin ASR), se sigue con los tiempos calibrados.

import { normalize } from "@/lib/openai";
import type { ClipCandidate, VideoAnalysis } from "@/lib/store";

export type Word = { t: number; w: string };

const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "Accept-Language": "es-AR,es;q=0.9,en;q=0.8" };

/** Palabras con timestamp del track de subtítulos (preferentemente el del idioma del canal). Vacío si no hay. */
export async function fetchCaptions(videoId: string, preferLang = "es"): Promise<Word[]> {
  try {
    const page = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers: UA, cache: "no-store" });
    if (!page.ok) return [];
    const m = /"captionTracks":(\[.*?\])/.exec(await page.text());
    if (!m) return [];
    const tracks = JSON.parse(m[1]) as { baseUrl: string; languageCode?: string; kind?: string }[];
    const track = tracks.find((t) => (t.languageCode ?? "").startsWith(preferLang)) ?? tracks[0];
    if (!track?.baseUrl) return [];
    const res = await fetch(`${track.baseUrl}&fmt=json3`, { headers: UA, cache: "no-store" });
    if (!res.ok) return [];
    return parseJson3(await res.text());
  } catch {
    return [];
  }
}

/** json3 → palabras normalizadas con su segundo. */
export function parseJson3(text: string): Word[] {
  const out: Word[] = [];
  let data: { events?: { tStartMs?: number; segs?: { utf8?: string; tOffsetMs?: number }[] }[] };
  try {
    data = JSON.parse(text);
  } catch {
    return out;
  }
  for (const ev of data.events ?? []) {
    for (const seg of ev.segs ?? []) {
      const t = ((ev.tStartMs ?? 0) + (seg.tOffsetMs ?? 0)) / 1000;
      for (const w of normalize(seg.utf8 ?? "").split(" ")) if (w) out.push({ t, w });
    }
  }
  return out;
}

/** Segundo en que empieza `phrase` dentro de `words`, buscando desde `from`. Prueba con la frase entera y después con sus primeras 5 y 4 palabras. */
export function findPhrase(words: Word[], phrase: string, from = 0): number | null {
  const p = normalize(phrase).split(" ").filter(Boolean);
  if (p.length < 3) return null;
  const seq = words.map((x) => x.w);
  let start = 0;
  while (start < words.length && words[start].t < from) start++;
  for (const n of [...new Set([p.length, 6, 5, 4])].filter((n) => n <= p.length && n >= 3)) {
    const needle = p.slice(0, n);
    for (let i = start; i <= seq.length - n; i++) {
      let ok = true;
      for (let j = 0; j < n; j++) if (seq[i + j] !== needle[j]) { ok = false; break; }
      if (ok) return words[i].t;
    }
  }
  return null;
}

/** Segundo en que termina la última frase de `transcript`, buscando cerca de `near`. */
function findEnd(words: Word[], transcript: string, near: number): number | null {
  const p = normalize(transcript.replace(/\[\d+:\d+\][^—]*—/g, " ")).split(" ").filter(Boolean);
  if (p.length < 4) return null;
  const tail = p.slice(-5);
  const seq = words.map((x) => x.w);
  let best: number | null = null;
  for (let i = 0; i <= seq.length - tail.length; i++) {
    let ok = true;
    for (let j = 0; j < tail.length; j++) if (seq[i + j] !== tail[j]) { ok = false; break; }
    if (!ok) continue;
    const t = words[i + tail.length - 1].t;
    if (best === null || Math.abs(t - near) < Math.abs(best - near)) best = t;
  }
  return best;
}

/**
 * Ancla cada tramo a los subtítulos. Devuelve el análisis con inicio/fin
 * corregidos y cuántos tramos se anclaron. Un tramo se ancla sólo si su gancho
 * (o su primera cita) aparece a menos de `window` segundos del tiempo calibrado:
 * una frase repetida en otra parte del video no lo tiene que arrastrar.
 */
export function snapToCaptions(a: VideoAnalysis, words: Word[], window = 120): { analysis: VideoAnalysis; anclados: number } {
  if (!words.length) return { analysis: a, anclados: 0 };
  let anclados = 0;
  // Las palabras traen su INICIO: la última termina un poco después.
  const last = words[words.length - 1].t + 1.5;
  const clips: ClipCandidate[] = a.clips.map((c) => {
    const dur = c.fin - c.inicio;
    const from = Math.max(0, c.inicio - window);
    const candidates = [c.gancho, c.citas[0]?.texto, c.transcripcion.replace(/\[\d+:\d+\][^—]*—/g, " ").trim()].filter((s): s is string => Boolean(s));
    let start: number | null = null;
    for (const phrase of candidates) {
      const t = findPhrase(words, phrase, from);
      if (t !== null && Math.abs(t - c.inicio) <= window) { start = t; break; }
    }
    if (start === null) return c;
    anclados++;
    const inicio = Math.max(0, Math.round((start - 0.4) * 10) / 10);
    // El fin sólo se toma de los subtítulos si cae cerca de donde el modelo lo
    // puso: las últimas palabras de una transcripción pueden repetirse antes.
    const end = findEnd(words, c.transcripcion, inicio + dur);
    const cerca = end !== null && Math.abs(end - (inicio + dur)) <= Math.max(12, dur * 0.25);
    const fin = cerca ? Math.min(last, Math.round((end + 0.6) * 10) / 10) : Math.min(last, inicio + dur);
    const citas = c.citas.map((q) => {
      const t = findPhrase(words, q.texto, Math.max(0, inicio - 5));
      return t !== null && t <= fin + 5 ? { ...q, segundo: Math.round(t) } : q;
    });
    return { ...c, inicio, fin, citas, precision: "subtitulos" };
  });
  return { analysis: { ...a, clips }, anclados };
}
