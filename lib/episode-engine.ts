// Etapa 1: Gemini PERCIBE el episodio completo y busca los mejores tramos.
//
// Le pasamos la URL pública de YouTube (Gemini la ingiere directo — no hay que
// bajar el video, que desde un datacenter suele estar bloqueado) y sólo le
// pedimos HECHOS: dónde están los mejores tramos para clip, qué dijo
// textualmente el invitado, de qué va el episodio. Nada de copy: eso lo
// redacta la etapa 2 (lib/copy.ts) y lo verifica el código.

import { GoogleGenAI, MediaResolution, Type } from "@google/genai";
import { CONTENT_LANGUAGE, PODCAST_DESCRIPTION, PODCAST_NAME } from "@/lib/config";
import type { EpisodeAnalysis } from "@/lib/store";

/** Duración de un tramo para clip, en segundos. */
export const CLIP_MIN_SEC = Number(process.env.CLIP_MIN_SEC || 45);
export const CLIP_MAX_SEC = Number(process.env.CLIP_MAX_SEC || 140);
export const CLIP_CANDIDATES = Number(process.env.CLIP_CANDIDATES || 10);

export const EPISODE_INSTRUCTION = `Sos el analista de contenido de ${PODCAST_NAME}, ${PODCAST_DESCRIPTION}. Mirás un EPISODIO COMPLETO (audio + imagen) y extraés HECHOS para que después un redactor arme clips. No escribís copy, no opinás. Respondés en ${CONTENT_LANGUAGE}, salvo las citas, que van tal cual se dicen.

# REGLA MADRE
Todo lo que devolvés tiene que estar literalmente en el episodio. Las citas se copian CARÁCTER POR CARÁCTER de lo que se escucha: no las pulas, no las acortes, no les arregles la gramática. Si el invitado habló mal, va mal. Inventar un nombre, un número o una frase es el peor error posible.

# INVITADO Y NÚMERO DE EPISODIO
- invitado: el nombre completo, sólo si se dice en el audio o se ve escrito en pantalla. Si no, string vacío.
- numero_episodio: sólo si se dice ("episodio 21") o se ve en pantalla. Si no, string vacío.
- credencial: a qué se dedica, con SUS palabras, 2 a 6 palabras y SIN su nombre ("Nutricionista deportivo", "Fundadora de X"). Suele salir de cómo se presenta al arrancar. Si no lo dice, string vacío.

# TEMA Y TESIS
- tema: una línea factual de qué trata el episodio.
- tesis: la idea que el invitado sostiene y repite a lo largo de la charla, en una frase, con sus palabras o casi. No es un resumen ni un elogio.

# EJES (de qué va el episodio, de verdad)
Identificá los 3 a 5 EJES del episodio: las ideas o temas que el invitado desarrolla con más tiempo y profundidad (no lo que se menciona al pasar). Si el título del video promete algo, ese eje TIENE que estar. Cada eje: nombre corto, una línea factual de qué sostiene el invitado, y el segundo donde arranca.

# CLIPS (los tramos que mejor funcionan cortados)
Elegí ${CLIP_CANDIDATES} tramos candidatos, ordenados de mejor a peor — el planificador elige menos, así que conviene tener de dónde. No seas selectivo de más: casi cualquier intercambio de 40+ segundos con una frase fuerte o un contraste sirve como candidato; el corte y el ritmo lo arregla la edición. Cada uno:
- **Dura entre 60 y 120 segundos** y cierra un insight completo. Si el momento bueno se pasa de 120 s, cortalo en dos tramos que se sostengan solos. inicio y fin en segundos desde el comienzo del video, en el borde de una frase (arranca donde empieza una oración y termina donde termina otra): el editor corta exactamente ahí.
- Se entiende SOLO, sin ver el resto del episodio.
- Contiene al menos una frase fuerte del invitado que se sostiene sola.
- Lo que más rinde, en este orden: un NÚMERO concreto, una ANÉCDOTA con principio y final, un CONCEPTO CON NOMBRE PROPIO, una opinión contraintuitiva. Una reflexión genérica no califica.
- transcripcion: verbatim del tramo, con speakers y timestamps en bloques cortos ("[12:04] INVITADO — ...").
- citas: 1 a 3 frases del invitado dentro del tramo, textuales, de 5 a 25 palabras, con el segundo exacto en que arrancan.
- gancho: la primera frase del tramo tal cual se dice (para el corte).
- motivo: en una línea, POR QUÉ este tramo engancha (qué dato/anécdota/concepto tiene). Factual.
- curiosidad: la PREGUNTA QUE LA GENTE YA SE HACE sobre este tema, con las palabras que usaría al buscarlo — no el vocabulario del episodio. Es la puerta de entrada del clip. Tiene que ser una curiosidad que ESTE tramo efectivamente responde; si no la responde, no la escribas.
- eje: el índice (0-based) del eje al que pertenece.
- puntaje: 1 a 10 de potencial de reproducciones, según lo de arriba.
Evitá tramos que dependen de una pregunta larga del conductor, publicidad, presentaciones y despedidas. Repartí los tramos entre los ejes: si te salen 8 del mismo tema, estás mirando un solo pedazo del episodio.`;

export const EPISODE_PROMPT = `Mirá el episodio completo y devolvé el JSON de hechos: invitado, número de episodio si se dice, su credencial, tema, tesis, los ${CLIP_CANDIDATES} mejores tramos para clip (con transcripción verbatim, citas textuales, gancho, motivo, curiosidad, eje y puntaje) y los 3-5 ejes del episodio.`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    invitado: { type: Type.STRING },
    numero_episodio: { type: Type.STRING },
    credencial: { type: Type.STRING },
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
  required: ["invitado", "numero_episodio", "credencial", "tema", "tesis", "ejes", "clips"],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Analiza el episodio por su URL de YouTube.
 *
 * mediaResolution LOW + fps bajo: un podcast es audio primero; con esto un
 * episodio de una hora entra cómodo en contexto y en el tiempo de la función.
 * Reintenta ante errores transitorios (503/429), normales en la API gratuita.
 */
export async function analyzeEpisode(youtubeUrl: string, extraRules = "", videoTitle = ""): Promise<EpisodeAnalysis> {
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
              { text: (videoTitle ? `TÍTULO DEL VIDEO EN YOUTUBE (lo que promete): ${videoTitle}\n\n` : "") + EPISODE_PROMPT },
            ],
          },
        ],
        config: {
          systemInstruction: EPISODE_INSTRUCTION + extraRules,
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: SCHEMA,
          mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
        },
      });
      const parsed = JSON.parse(res.text ?? "{}") as EpisodeAnalysis;
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
