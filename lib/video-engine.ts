// Etapa 1: Gemini PERCIBE el video completo y busca los mejores tramos.
//
// Le pasamos la URL pública de YouTube (Gemini la ingiere directo — no hay que
// bajar el video, que desde un datacenter suele estar bloqueado) y sólo le
// pedimos HECHOS: dónde están los mejores tramos para clip, qué se dijo
// textualmente, de qué va el video. Nada de copy: eso lo redacta la etapa 2
// (lib/copy.ts) y lo verifica el código.

import { GoogleGenAI, MediaResolution, Type } from "@google/genai";
import { CHANNEL_DESCRIPTION, CONTENT_LANGUAGE, CREATOR_NAME } from "@/lib/config";
import type { VideoAnalysis } from "@/lib/store";

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

export const VIDEO_PROMPT = `Mirá el video completo y devolvé el JSON de hechos: tema, tesis, los ${CLIP_CANDIDATES} mejores tramos para clip (con transcripción verbatim, citas textuales, gancho, motivo, curiosidad, eje y puntaje) y los 3-5 ejes del video.`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
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
  required: ["tema", "tesis", "ejes", "clips"],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Analiza el video por su URL de YouTube.
 *
 * mediaResolution LOW + fps bajo: lo que importa es lo que se dice; con esto
 * un video de una hora entra cómodo en contexto y en el tiempo de la función.
 * Reintenta ante errores transitorios (503/429), normales en la API gratuita.
 */
export async function analyzeVideo(youtubeUrl: string, videoTitle = ""): Promise<VideoAnalysis> {
  if (!process.env.GEMINI_API_KEY) throw new Error("Falta GEMINI_API_KEY");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";

  let lastErr: unknown;
  const BACKOFF = [8000, 25000, 45000];
  for (let attempt = 0; attempt < 4; attempt++) {
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
      const parsed = JSON.parse(res.text ?? "{}") as VideoAnalysis;
      if (!parsed.clips?.length) throw new Error("Gemini no devolvió tramos para clip");
      parsed.clips = parsed.clips
        .filter((c) => c.fin > c.inicio && c.transcripcion && c.fin - c.inicio >= CLIP_MIN_SEC && c.fin - c.inicio <= CLIP_MAX_SEC)
        .sort((a, b) => b.puntaje - a.puntaje);
      parsed.ejes = parsed.ejes ?? [];
      return parsed;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < 3 && /503|429|overloaded|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand/i.test(msg)) {
        await sleep(BACKOFF[attempt]);
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
