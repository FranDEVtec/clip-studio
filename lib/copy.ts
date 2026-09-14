// Etapa 2 del motor: OpenAI redacta a partir de la transcripción que extrajo Gemini.
// Corre en el server (usa OPENAI_API_KEY). El armado final del caption lo hace
// el código, no el modelo: así el CTA y el formato nunca varían.

import { BANNED_HASHTAGS, BANNED_HASHTAGS_TIKTOK, COPY_INSTRUCTION, type Extraction } from "@/lib/engine";
import { BRAND_HASHTAG, CREATOR_NAME, CTA_TEXT } from "@/lib/config";
import { normalize, openaiJson } from "@/lib/openai";

export type CopyPieces = {
  molde: "cita" | "revelacion" | "pregunta";
  claim: string;
  cita_textual: string;
  emoji: string;
  /** Instagram: sobre el tema del clip. */
  hashtags: string[];
  /** TikTok: relacionados con lo que pasa en el video. */
  hashtags_tiktok: string[];
  /** Titular que el editor quema en pantalla en los primeros segundos del clip. */
  hook_edicion: string;
};

// Structured Outputs: el modelo no puede devolver otra forma. `strict` exige que
// todas las propiedades estén en `required`, por eso cita_textual es string vacío
// en vez de null cuando el molde no es "cita".
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["molde", "claim", "cita_textual", "emoji", "hashtags", "hashtags_tiktok", "hook_edicion"],
  properties: {
    molde: { type: "string", enum: ["cita", "revelacion", "pregunta"] },
    claim: { type: "string" },
    cita_textual: { type: "string", description: "Verbatim de la transcripción si molde es 'cita'. Si no, string vacío." },
    emoji: { type: "string" },
    hashtags: { type: "array", items: { type: "string" }, minItems: 5, maxItems: 5 },
    hashtags_tiktok: { type: "array", items: { type: "string" }, minItems: 5, maxItems: 5 },
    hook_edicion: { type: "string", description: "Titular en pantalla: 3-7 palabras, sin punto final, dice el payoff del clip." },
  },
} as const;

/** Un hashtag es una sola palabra: sin #, sin espacios, sin tildes. */
export function normalizeHashtag(h: string): string {
  return h
    .replace(/^#/, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_]/g, "");
}

/** ¿La cita existe realmente en lo que se dijo? */
export function quoteIsReal(quote: string, transcript: string): boolean {
  const q = normalize(quote);
  if (q.split(" ").length < 4) return false; // demasiado corta para verificar nada
  return normalize(transcript).includes(q);
}

export type CopyProblem = string;

// El titular tiene que ser un claim (verbo, dígito o predicado), nunca el nombre
// de quien habla, su ocupación ni una palabra suelta. Pedirlo en el prompt no
// alcanza: es una compuerta en código.
const ROLES =
  /^(fundadora?|cofundadora?|ceo|creadora?|especialista|nutricionista|m[eé]dic[oa]|psic[oó]log[oa]|psiquiatra|emprendedora?|directora?|comunicadora?|influencer|periodista|abogad[oa]|entrenadora?|coach|autora?|escritora?|inversora?|empresari[oa]|conductora?|host|streamer|youtuber|tiktoker|consultora?|ingenier[oa]|economista|contadora?|dueñ[oa]|soci[oa]|gerente|productora?|actor|actriz|cantante|deportista|jugadora?|campe[oó]na?|profesora?|docente|investigadora?|cient[ií]fic[oa]|biólog[oa]|kinesi[oó]log[oa]|filósof[oa]|historiadora?|arquitect[oa]|diseñadora?|programadora?|desarrolladora?|fot[oó]graf[oa]|chef|cociner[oa]|estudiante|viajer[oa]|vlogger)$/;
const CONECTORES = new Set(["con", "el", "la", "los", "las", "de", "del", "y", "e", "en", "al"]);

const tokens = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Devuelve el problema si hook_edicion no es un claim (nombre, ocupación o palabra suelta); null si pasa. */
export function hookNoEsClaim(hook: string, nombre?: string): string | null {
  const palabras = hook.trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 1) {
    return `hook_edicion es una sola palabra ("${hook.trim()}"): eso no es un titular. El frame 0 lleva un claim de 3 a 7 palabras con verbo, dígito o predicado.`;
  }
  const contenido = tokens(hook).filter((w) => !CONECTORES.has(w));
  if (!contenido.length) return null; // lo agarra la regla de 3-7 palabras
  const partesNombre = new Set(tokens(nombre ?? ""));
  if (partesNombre.size && contenido.every((w) => partesNombre.has(w))) {
    return `hook_edicion es sólo el nombre de quien habla ("${hook.trim()}"): el nombre no va en el titular. Escribí lo que dice o hizo: verbo, dígito o predicado.`;
  }
  // «CREADOR DE CONTENIDO Y COMUNICADOR»: una ocupación seguida sólo de complementos con conector.
  const esOcupacion =
    !/\d/.test(hook) &&
    ROLES.test(contenido[0]) &&
    tokens(hook)
      .slice(1)
      .every((w, i, arr) => CONECTORES.has(w) || (i > 0 && CONECTORES.has(arr[i - 1])));
  if (esOcupacion) {
    return `hook_edicion es una ocupación ("${hook.trim()}"), no un titular. El titular es un claim con verbo, dígito o predicado.`;
  }
  return null;
}

// La línea 1 del caption tiene que traer el MISMO número que el titular (el
// que el audio dice en los primeros segundos). Cuando caption y audio se
// alinean, la pieza rinde; cuando se desacoplan, cae. Un teaser ("nuevo
// video…") o sólo el nombre como primera línea tampoco vale.
const TEASER = /^\s*(¡?nuevo video|ya (está |esta )?disponible|video (nuevo|completo)|no te (lo )?pierdas|mirá el video|salió el video)/i;

/** Números en cifra, normalizados: «20.000» → «20000», «1,5» → «1.5», «300 y 400» → «300», «400». */
export function cifras(s: string): string[] {
  return (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => (/^\d{1,3}(\.\d{3})+$/.test(n) ? n.replace(/\./g, "") : n.replace(",", ".")));
}

/** Primera línea del caption, tal como la arma buildCaption. */
export function captionL1(c: CopyPieces): string {
  return c.molde === "cita" ? c.cita_textual.trim().replace(/^["“«]+|["”»]+$/g, "") : c.claim.trim();
}

/** Devuelve el problema si la línea 1 del caption no repite el número del titular, o es teaser / nombre solo; null si pasa. */
export function captionSinElNumero(c: CopyPieces, nombre?: string): string | null {
  const l1 = captionL1(c);
  if (!l1) return null; // lo agarra la regla de claim vacío
  if (TEASER.test(l1)) return `La primera línea del caption ("${l1.slice(0, 60)}") es un teaser. Tiene que ser el claim del clip con su dato, no el anuncio del video.`;
  const contenido = tokens(l1).filter((w) => !CONECTORES.has(w));
  const partesNombre = new Set(tokens(nombre ?? ""));
  if (contenido.length && partesNombre.size && contenido.every((w) => partesNombre.has(w))) return `La primera línea del caption es sólo el nombre de quien habla ("${l1.slice(0, 60)}"): va el claim con el dato del titular.`;
  const delHook = cifras(c.hook_edicion ?? "");
  if (!delHook.length) return null; // sin número en el titular no hay qué alinear
  const enL1 = new Set(cifras(l1));
  const falta = delHook.filter((n) => !enL1.has(n));
  if (!falta.length) return null;
  return `La primera línea del caption ("${l1.slice(0, 70)}") no trae el número del titular (${falta.join(", ")}). Caption y titular tienen que decir el mismo dato, en cifra.`;
}

/** Chequeos que no necesitan un modelo: son reglas duras del formato. */
export function findProblems(c: CopyPieces, transcript: string, ctx: { nombre?: string } = {}): CopyProblem[] {
  const p: CopyProblem[] = [];
  const sinNumero = captionSinElNumero(c, ctx.nombre);
  if (sinNumero) p.push(sinNumero);

  if (c.molde === "cita" && !quoteIsReal(c.cita_textual, transcript)) {
    p.push(`La cita "${c.cita_textual}" no aparece en la transcripción. Copiala carácter por carácter o cambiá de molde.`);
  }
  const low = (arr: string[]) => (arr ?? []).map((h) => h.replace(/^#/, "").toLowerCase());
  const malFormados = [...low(c.hashtags), ...low(c.hashtags_tiktok ?? [])].filter((h) => !/^[a-z0-9_]+$/.test(h));
  if (malFormados.length) p.push(`Hashtags mal formados (van en una sola palabra, sin espacios, tildes ni símbolos): ${malFormados.join(", ")}.`);
  if (c.hashtags.length !== 5) p.push(`Devolviste ${c.hashtags.length} hashtags de Instagram, tienen que ser exactamente 5.`);
  const banned = low(c.hashtags).filter((h) => BANNED_HASHTAGS.includes(h));
  if (banned.length) p.push(`Hashtags prohibidos en Instagram: ${banned.join(", ")}.`);
  // El prompt lo pide, pero pedirlo no alcanza: el modelo devuelve 5 hashtags
  // correctos y se olvida justo el de la marca.
  if (BRAND_HASHTAG && !low(c.hashtags).includes(BRAND_HASHTAG)) p.push(`Falta el hashtag ${BRAND_HASHTAG} en Instagram, que va siempre.`);
  const tt = low(c.hashtags_tiktok ?? []);
  if (tt.length !== 5) p.push(`Devolviste ${tt.length} hashtags de TikTok, tienen que ser exactamente 5.`);
  if (BRAND_HASHTAG && !tt.includes(BRAND_HASHTAG)) p.push(`En TikTok falta ${BRAND_HASHTAG}.`);
  const bannedTt = tt.filter((h) => BANNED_HASHTAGS_TIKTOK.includes(h));
  if (bannedTt.length) p.push(`Hashtags prohibidos en TikTok: ${bannedTt.join(", ")}.`);
  if (/\n/.test(c.claim)) p.push("El claim tiene que ser UNA sola línea.");
  if (!c.claim.trim() && c.molde !== "cita") p.push("Falta el claim.");
  const hook = (c.hook_edicion ?? "").trim();
  if (!hook) p.push("Falta hook_edicion: el titular en pantalla.");
  else {
    if (/\n/.test(hook)) p.push("hook_edicion tiene que ser UNA sola línea.");
    if (hook.length > 60) p.push(`hook_edicion tiene ${hook.length} caracteres, máximo 60.`);
    if (/["“”]/.test(hook)) p.push("hook_edicion va sin comillas.");
    if (/\.$/.test(hook)) p.push("hook_edicion va sin punto final (es un titular, no una oración).");
    const w = hook.split(/\s+/).filter(Boolean).length;
    if (w < 3 || w > 7) p.push(`hook_edicion tiene ${w} palabras; el formato son 3 a 7.`);
    if (/^¿|\?$/.test(hook)) p.push("hook_edicion no es una pregunta: escribí la afirmación más fuerte del clip como titular.");
    const noClaim = hookNoEsClaim(hook, ctx.nombre);
    if (noClaim) p.push(noClaim);
  }

  return p;
}

/**
 * Redacta y reintenta UNA vez con los problemas encontrados como feedback.
 * Si el segundo intento tampoco pasa la verificación de cita, se degrada el molde
 * a "revelacion" en vez de publicar una cita que nunca se dijo.
 */
export async function writeCopy(
  ex: Extraction,
  /** Preámbulo del system prompt (guía de estilo) y reglas extra. */
  systemPreamble: string,
  extraRules = "",
  /** Contexto del video completo. El tramo solo no lo dice. */
  video?: { tema: string; tesis: string; curiosidad?: string },
): Promise<{ pieces: CopyPieces; problemas: CopyProblem[] }> {
  const brief = [
    `TEMA DEL CLIP: ${ex.tema}`,
    `QUIÉN HABLA: ${CREATOR_NAME}`,
    ...(video?.curiosidad ? [`CURIOSIDAD DE ENTRADA (con estas palabras busca la gente este tema): ${video.curiosidad}`] : []),
    ...(video ? [`TEMA DEL VIDEO COMPLETO: ${video.tema}`, `TESIS DEL VIDEO: ${video.tesis}`] : []),
    "",
    "CITAS TEXTUALES DETECTADAS:",
    ...ex.citas.map((c) => `- [${c.segundo}s] "${c.texto}"`),
    "",
    "TRANSCRIPCIÓN COMPLETA:",
    ex.transcripcion,
  ].join("\n");

  const messages: unknown[] = [
    { role: "system", content: systemPreamble + "\n\n---\n" + COPY_INSTRUCTION + extraRules },
    { role: "user", content: brief },
  ];

  const ctx = { nombre: CREATOR_NAME };
  let pieces = await openaiJson<CopyPieces>(messages, SCHEMA, "clip_copy");
  let problemas = findProblems(pieces, ex.transcripcion, ctx);

  if (problemas.length) {
    messages.push({ role: "assistant", content: JSON.stringify(pieces) });
    messages.push({
      role: "user",
      content: `Tu respuesta tiene estos problemas. Corregilos y devolvé el JSON de nuevo:\n${problemas.map((p) => `- ${p}`).join("\n")}`,
    });
    pieces = await openaiJson<CopyPieces>(messages, SCHEMA, "clip_copy");
    problemas = findProblems(pieces, ex.transcripcion, ctx);
  }

  // Última red: nunca publicar una cita inventada.
  if (pieces.molde === "cita" && !quoteIsReal(pieces.cita_textual, ex.transcripcion)) {
    pieces = { ...pieces, molde: "revelacion", cita_textual: "" };
    problemas = problemas.filter((p) => !p.startsWith("La cita"));
    problemas.push("La cita no se pudo verificar contra la transcripción, así que el caption salió sin comillas.");
  }

  return { pieces, problemas };
}

/** El ensamblado final es código, no modelo: así el formato nunca varía. */
export function buildCaption(c: CopyPieces, network: "instagram" | "tiktok" = "instagram"): string {
  // El modelo a veces devuelve la cita ya entre comillas: se sacan para no duplicarlas.
  const cita = c.cita_textual.trim().replace(/^["“«]+|["”»]+$/g, "");
  const emoji = (c.emoji ?? "").trim();
  // Y a veces pega el emoji al final del claim: no se repite.
  const claim = emoji && c.claim.trim().endsWith(emoji) ? c.claim.trim().slice(0, -emoji.length).trim() : c.claim.trim();
  const head = c.molde === "cita" ? `"${cita}" ${emoji}`.trim() : `${claim} ${emoji}`.trim();
  const list = network === "tiktok" && c.hashtags_tiktok?.length ? c.hashtags_tiktok : c.hashtags;
  const tags = list.map((h) => `#${normalizeHashtag(h)}`).join(" ");
  return [head, CTA_TEXT, tags].filter(Boolean).join("\n\n");
}
