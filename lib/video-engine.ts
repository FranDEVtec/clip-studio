// Etapa 1: Gemini PERCIBE el video completo y busca los mejores tramos.
//
// Le pasamos la URL pública de YouTube (Gemini la ingiere directo — no hay que
// bajar el video, que desde un datacenter suele estar bloqueado) y sólo le
// pedimos HECHOS: dónde están los mejores tramos para clip, qué se dijo
// textualmente, de qué va el video. Nada de copy: eso lo redacta la etapa 2
// (lib/copy.ts) y lo verifica el código.

import { GoogleGenAI, MediaResolution, Type } from "@google/genai";
import { CHANNEL_DESCRIPTION, CONTENT_LANGUAGE, CREATOR_NAME } from "@/lib/config";
import type { ClipCandidate, VideoAnalysis } from "@/lib/store";

/** Duración de un tramo para clip, en segundos. */
export const CLIP_MIN_SEC = Number(process.env.CLIP_MIN_SEC || 45);
export const CLIP_MAX_SEC = Number(process.env.CLIP_MAX_SEC || 140);
export const CLIP_CANDIDATES = Number(process.env.CLIP_CANDIDATES || 10);

export const VIDEO_INSTRUCTION = `Sos el analista de contenido del canal de ${CREATOR_NAME}, ${CHANNEL_DESCRIPTION}. Mirás un VIDEO COMPLETO (audio + imagen) y extraés HECHOS para que después un redactor arme clips verticales. No escribís copy, no opinás. Respondés en ${CONTENT_LANGUAGE}, salvo las citas, que van tal cual se dicen.

# REGLA MADRE
Todo lo que devolvés tiene que estar literalmente en el video. Las citas se copian CARÁCTER POR CARÁCTER de lo que se escucha: no las pulas, no las acortes, no les arregles la gramática. Si se habló mal, va mal. Inventar un nombre, un número o una frase es el peor error posible.

# QUIÉN HABLA
Quien habla es ${CREATOR_NAME}, en primera persona. Si aparece otra persona con nombre (un amigo, un familiar, alguien entrevistado), nombrala en la transcripción sólo si el nombre se dice o se ve en pantalla; si no, "OTRA PERSONA".

# TEMA Y TESIS
- tema: una línea factual de qué trata el video.
- tesis: la idea que ${CREATOR_NAME} sostiene y repite a lo largo del video, en una frase, con sus palabras o casi. No es un resumen ni un elogio.

# EJES (de qué va el video, de verdad)
Identificá los 3 a 5 EJES del video: las ideas, momentos o temas que se desarrollan con más tiempo y profundidad (no lo que se menciona al pasar). Si el título del video promete algo, ese eje TIENE que estar. Cada eje: nombre corto, una línea factual de qué pasa o qué se sostiene, y el segundo donde arranca.

# CLIPS (los tramos que mejor funcionan cortados)
Elegí ${CLIP_CANDIDATES} tramos candidatos, ordenados de mejor a peor — el planificador elige menos, así que conviene tener de dónde. No seas selectivo de más: casi cualquier tramo de 40+ segundos con una frase fuerte, un momento que se entiende solo o un contraste sirve como candidato; el corte y el ritmo lo arregla la edición. Cada uno:
- **Dura entre 60 y 120 segundos** y cierra una idea o un momento completo. Si el momento bueno se pasa de 120 s, cortalo en dos tramos que se sostengan solos. inicio y fin en segundos desde el comienzo del video, en el borde de una frase (arranca donde empieza una oración y termina donde termina otra): el editor corta exactamente ahí.
- Se entiende SOLO, sin ver el resto del video.
- Contiene al menos una frase de ${CREATOR_NAME} que se sostiene sola.
- Lo que más rinde en un vlog, en este orden: una ANÉCDOTA con principio y final, una OPINIÓN fuerte o contraintuitiva dicha con convicción, un NÚMERO concreto (plata, tiempo, cantidad), un CONCEPTO CON NOMBRE PROPIO o una rutina paso a paso, un MOMENTO VISUAL que cambia el tono (algo que pasa en cámara, un lugar, una reacción). Una reflexión genérica no califica.
- transcripcion: verbatim del tramo, con speakers y timestamps en bloques cortos ("[12:04] ${CREATOR_NAME.toUpperCase()} — ...").
- citas: 1 a 3 frases de ${CREATOR_NAME} dentro del tramo, textuales, de 5 a 25 palabras, con el segundo exacto en que arrancan.
- gancho: la primera frase del tramo tal cual se dice (para el corte).
- motivo: en una línea, POR QUÉ este tramo engancha (qué anécdota/opinión/dato/momento tiene). Factual.
- curiosidad: la PREGUNTA QUE LA GENTE YA SE HACE sobre este tema, con las palabras que usaría al buscarlo — no el vocabulario del video. Es la puerta de entrada del clip. Tiene que ser una curiosidad que ESTE tramo efectivamente responde; si no la responde, no la escribas.
- eje: el índice (0-based) del eje al que pertenece.
- puntaje: 1 a 10 de potencial de reproducciones, según lo de arriba.
Evitá intros ("hola, bienvenidos"), pedidos de like y suscripción, publicidad, transiciones sin contenido y despedidas. Repartí los tramos entre los ejes: si te salen 8 del mismo tema, estás mirando un solo pedazo del video.`;

export const VIDEO_PROMPT = `Mirá el video completo y devolvé el JSON de hechos: duracion_total (los segundos totales del video, hasta el último frame), tema, tesis, los ${CLIP_CANDIDATES} mejores tramos para clip (con transcripción verbatim, citas textuales, gancho, motivo, curiosidad, eje y puntaje) y los 3-5 ejes del video.`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    duracion_total: { type: Type.NUMBER, description: "Segundos totales del video" },
    tema: { type: Type.STRING },
    tesis: { type: Type.STRING },
    ejes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { nombre: { type: Type.STRING }, idea: { type: Type.STRING }, segundo: { type: Type.NUMBER } },
        required: ["nombre", "idea", "segundo"],
      },
    },
    clips: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          inicio: { type: Type.NUMBER },
          fin: { type: Type.NUMBER },
          titulo: { type: Type.STRING, description: "Nombre corto interno del tramo" },
          tema: { type: Type.STRING },
          transcripcion: { type: Type.STRING },
          citas: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { texto: { type: Type.STRING }, segundo: { type: Type.NUMBER } },
              required: ["texto", "segundo"],
            },
          },
          gancho: { type: Type.STRING },
          motivo: { type: Type.STRING },
          curiosidad: { type: Type.STRING },
          eje: { type: Type.NUMBER },
          puntaje: { type: Type.NUMBER },
        },
        required: ["inicio", "fin", "titulo", "tema", "transcripcion", "citas", "gancho", "motivo", "curiosidad", "eje", "puntaje"],
      },
    },
  },
  required: ["duracion_total", "tema", "tesis", "ejes", "clips"],
};

/**
 * Los segundos que devuelve el modelo no siempre están en la escala real: con
 * muestreo bajo, algunos modelos estiran o comprimen la línea de tiempo de
 * forma consistente (en una prueba, ×1,6 sobre un video de 17 min). Como la
 * duración real se conoce (página de YouTube), se calibra: todo tiempo se
 * multiplica por real/percibida cuando difieren más de un 5 %, y nada queda
 * fuera del video. Las citas siguen siendo verbatim; sólo se corrige DÓNDE están.
 */
export function calibrate(a: VideoAnalysis, realSec: number | undefined): VideoAnalysis {
  const perceived = Math.max(a.duracion_total ?? 0, ...a.clips.map((c) => c.fin), ...(a.ejes ?? []).map((e) => e.segundo));
  if (!realSec || !perceived) return { ...a, escala: 1 };
  const k = realSec / perceived;
  const scale = Math.abs(k - 1) > 0.05 ? k : 1;
  const t = (x: number) => Math.min(realSec, Math.max(0, Math.round(x * scale)));
  return {
    ...a,
    escala: scale,
    ejes: (a.ejes ?? []).map((e) => ({ ...e, segundo: t(e.segundo) })),
    clips: a.clips.map((c) => ({ ...c, inicio: t(c.inicio), fin: t(c.fin), citas: c.citas.map((q) => ({ ...q, segundo: t(q.segundo) })) })),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Modelos a probar, en orden. El primero es el configurado (o el alias "latest");
 * el segundo es el fallback: en el plan gratis, el alias "flash-latest" pasa
 * días devolviendo 503 por demanda mientras "flash-lite-latest" sigue
 * ingiriendo video. Un 404 (modelo retirado) también pasa al siguiente.
 */
export function modelChain(): string[] {
  const primary = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const fallback = process.env.GEMINI_FALLBACK_MODEL || "gemini-flash-lite-latest";
  return primary === fallback ? [primary] : [primary, fallback];
}

const TRANSIENT = /503|429|overloaded|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|fetch failed|ECONNRESET|ETIMEDOUT/i;
const GONE = /404|NOT_FOUND|no longer available|not found for API version/i;

/**
 * Analiza el video por su URL de YouTube.
 *
 * mediaResolution LOW + fps bajo: lo que importa es lo que se dice; con esto
 * un video de una hora entra cómodo en contexto y en el tiempo de la función.
 * Reintenta ante errores transitorios (503/429), normales en la API gratuita,
 * y cae al modelo de fallback si el principal no responde o ya no existe.
 */
export async function analyzeVideo(youtubeUrl: string, videoTitle = "", realSec?: number): Promise<VideoAnalysis> {
  if (!process.env.GEMINI_API_KEY) throw new Error("Falta GEMINI_API_KEY");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  let lastErr: unknown;
  const BACKOFF = [8000, 25000];
  for (const model of modelChain()) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                { fileData: { fileUri: youtubeUrl, mimeType: "video/*" }, videoMetadata: { fps: 0.2 } },
                { text: (videoTitle ? `TÍTULO DEL VIDEO EN YOUTUBE (lo que promete): ${videoTitle}\n\n` : "") + VIDEO_PROMPT },
              ],
            },
          ],
          config: {
            systemInstruction: VIDEO_INSTRUCTION,
            temperature: 0.2,
            responseMimeType: "application/json",
            responseSchema: SCHEMA,
            mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
          },
        });
        const raw = JSON.parse(res.text ?? "{}") as VideoAnalysis;
        if (!raw.clips?.length) throw new Error("Gemini no devolvió tramos para clip");
        const parsed = calibrate({ ...raw, ejes: raw.ejes ?? [] }, realSec);
        parsed.clips = parsed.clips
          .filter((c) => c.fin > c.inicio && c.transcripcion && c.fin - c.inicio >= CLIP_MIN_SEC && c.fin - c.inicio <= CLIP_MAX_SEC)
          .sort((a, b) => b.puntaje - a.puntaje);
        if (!parsed.clips.length) throw new Error("Ningún tramo quedó dentro de 45-140 s después de calibrar los tiempos");
        parsed.modelo = model;
        return parsed;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (GONE.test(msg)) break; // este modelo no existe: probar el siguiente
        if (TRANSIENT.test(msg)) {
          if (attempt < 2) await sleep(BACKOFF[attempt]);
          continue; // agotados los intentos, se pasa al siguiente modelo
        }
        throw err; // error de verdad (schema, key, video privado…): no insistir
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Afina el corte de UN tramo con un segundo pase sobre su ventana.
 *
 * Sobre el video entero el reloj del modelo se estira (ver `calibrate`), pero
 * sobre una ventana de ~2 minutos es exacto. Se le pasa sólo el fragmento
 * [inicio−20 s, fin+20 s] y se le pregunta en qué segundo del fragmento
 * empieza el gancho y termina la última frase de la transcripción. Cuesta una
 * llamada por clip; se hace sólo para los tramos que se van a publicar.
 * Devuelve null si el modelo no responde o si lo que devuelve no es creíble.
 */
export async function refineCut(youtubeUrl: string, cand: ClipCandidate, realSec?: number): Promise<{ inicio: number; fin: number } | null> {
  if (!process.env.GEMINI_API_KEY || !cand.gancho) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const pad = 20;
  const start = Math.max(0, Math.floor(cand.inicio - pad));
  const end = Math.ceil(Math.min(realSec ?? Infinity, cand.fin + pad));
  const len = end - start;
  if (len < 30) return null;
  const ultima = cand.transcripcion.replace(/\[\d+:\d+\][^—]*—/g, " ").trim().split(/(?<=[.!?…])\s+/).filter(Boolean).slice(-1)[0] ?? "";
  // El gancho a veces es una muletilla que el modelo no ubica ("No, pues sí…"):
  // se pide también la primera cita, que suele ser más distintiva.
  const cita = cand.citas[0]?.texto ?? "";
  const prompt = `Este fragmento dura ${len} segundos (el segundo 0 es su primer frame). Devolvé JSON con: duracion_fragmento (los segundos totales del fragmento), segundo_inicio (segundo del fragmento en que EMPIEZA a decirse «${cand.gancho}»)${cita ? `, segundo_cita (segundo del fragmento en que EMPIEZA a decirse «${cita.slice(0, 160)}»)` : ""}${ultima ? `, segundo_fin (segundo del fragmento en que TERMINA de decirse «${ultima.slice(0, 160)}»)` : ""}. Si una frase no está en el fragmento, devolvé -1 en ese campo.`;
  const schema = { type: Type.OBJECT, properties: { duracion_fragmento: { type: Type.NUMBER }, segundo_inicio: { type: Type.NUMBER }, segundo_cita: { type: Type.NUMBER }, segundo_fin: { type: Type.NUMBER } }, required: ["duracion_fragmento", "segundo_inicio", "segundo_cita", "segundo_fin"] };
  for (const model of modelChain()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ fileData: { fileUri: youtubeUrl, mimeType: "video/*" }, videoMetadata: { startOffset: `${start}s`, endOffset: `${end}s`, fps: 1 } }, { text: prompt }] }],
          config: { temperature: 0, responseMimeType: "application/json", responseSchema: schema, mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW },
        });
        const j = JSON.parse(res.text ?? "{}") as { duracion_fragmento?: number; segundo_inicio?: number; segundo_cita?: number; segundo_fin?: number };
        const k = j.duracion_fragmento && j.duracion_fragmento > 0 ? len / j.duracion_fragmento : 1;
        // Un "0" es sospechoso salvo que la ventana arranque en el segundo 0 del
        // video: el modelo lo devuelve cuando el fragmento empieza a mitad de frase.
        // La cita es tan buena como el gancho para fijar el inicio; si las dos
        // respuestas se contradicen, gana la cita, que es la frase más distintiva.
        const creible = (x?: number): x is number => x !== undefined && x > (start === 0 ? -1 : 1) && start + x * k <= cand.fin;
        const g = creible(j.segundo_inicio) ? j.segundo_inicio : null;
        const c = creible(j.segundo_cita) ? j.segundo_cita : null;
        const segInicio = g !== null && c !== null ? (Math.abs(g - c) <= 8 ? g : c) : (g ?? c);
        if (segInicio === null) {
          console.warn(`[refine] "${cand.titulo}": el modelo no ubicó el gancho ni la cita en la ventana`, j);
          return null;
        }
        const inicio = Math.round((start + segInicio * k - 0.4) * 10) / 10;
        const dur = cand.fin - cand.inicio;
        const finModelo = j.segundo_fin !== undefined && j.segundo_fin > 0 ? start + j.segundo_fin * k + 0.6 : null;
        // El fin del modelo vale si deja un clip de duración parecida; si no, se conserva la duración original.
        const fin = finModelo !== null && finModelo > inicio + 20 && Math.abs(finModelo - inicio - dur) <= Math.max(12, dur * 0.35) ? Math.round(finModelo * 10) / 10 : Math.round((inicio + dur) * 10) / 10;
        // Un salto mayor a la ventana no es un afinado: es otro momento del video.
        if (Math.abs(inicio - cand.inicio) > pad + 10) {
          console.warn(`[refine] "${cand.titulo}": el inicio afinado (${inicio}) se aleja demasiado del original (${cand.inicio})`);
          return null;
        }
        return { inicio: Math.max(0, inicio), fin: Math.min(realSec ?? fin, fin) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (GONE.test(msg)) break;
        if (TRANSIENT.test(msg)) {
          if (attempt < 1) await sleep(8000);
          continue;
        }
        console.warn(`[refine] "${cand.titulo}": ${msg.slice(0, 200)}`);
        return null;
      }
    }
  }
  return null;
}
