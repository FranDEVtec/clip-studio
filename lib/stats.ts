// El modelo interno: qué funciona, qué no, y con cuánta certeza.
//
// Todo acá es matemática, no un LLM. Tres decisiones de diseño:
//
// 1. BAYESIANO, NO FRECUENTISTA. Con 3 piezas no hay p-valores que valgan: hay
//    creencias con incertidumbre. Cada tasa (guardados/vistas, compartidos/vistas)
//    se modela como Beta-Binomial con un prior débil del nicho, y se reporta la
//    MEDIA POSTERIOR con su intervalo creíble del 90%. Un intervalo ancho es
//    información: dice "todavía no sabemos".
//
// 2. MONTE CARLO EN VEZ DE FÓRMULAS CERRADAS. Muestreando de las posteriores se
//    obtienen cuantiles y P(A mejor que B) sin implementar la beta incompleta
//    inversa, y se generaliza a comparar N brazos a la vez.
//
// 3. BANDIDO, NO REPORTE. El objetivo no es describir el pasado sino decidir la
//    próxima pieza. Thompson sampling resuelve el dilema explorar/explotar de la
//    forma que la teoría de juegos considera óptima para este problema: se elige
//    cada opción con probabilidad igual a la probabilidad de que sea la mejor.

import type { Item, Platform, State } from "@/lib/store";

// ── Muestreo ────────────────────────────────────────────────────────────────
// Generador determinista: el mismo estado da el mismo informe (si no, los
// números bailan en cada refresco y no se le puede creer a ninguno).
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1e9) / 1e9;
  };
}

function normal(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Gamma(shape,1) por Marsaglia-Tsang; es la base para muestrear una Beta. */
function gamma(shape: number, rand: () => number): number {
  if (shape < 1) return gamma(shape + 1, rand) * Math.pow(Math.max(rand(), 1e-12), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = normal(rand);
    const v = Math.pow(1 + c * x, 3);
    if (v <= 0) continue;
    const u = rand();
    if (Math.log(Math.max(u, 1e-12)) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

function sampleBeta(a: number, b: number, rand: () => number): number {
  const x = gamma(a, rand);
  return x / (x + gamma(b, rand));
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

// ── Prior del nicho ─────────────────────────────────────────────────────────
// Save rate mediano del nicho ≈ 2,5 %; 5 % ya es clase mundial (DOC2). El prior
// pesa como ~300 vistas: suficiente para que una pieza con 500 vistas no dispare
// conclusiones, e irrelevante cuando haya 50.000.
const PRIOR_VIEWS = 300;
export const PRIORS: Record<string, number> = { saveRate: 0.025, shareRate: 0.012, commentRate: 0.004, likeRate: 0.05 };

export type Posterior = { media: number; lo: number; hi: number; n: number; vistas: number };

/** Posterior Beta de una tasa, con el prior del nicho como anclaje. */
export function posterior(exitos: number, vistas: number, metrica: keyof typeof PRIORS | string, seed = 7): Posterior {
  const p0 = PRIORS[metrica] ?? 0.02;
  const a = p0 * PRIOR_VIEWS + exitos;
  const b = (1 - p0) * PRIOR_VIEWS + Math.max(0, vistas - exitos);
  const rand = rng(seed + Math.round(exitos * 131 + vistas));
  const draws: number[] = [];
  for (let i = 0; i < 4000; i++) draws.push(sampleBeta(a, b, rand));
  draws.sort((x, y) => x - y);
  return { media: a / (a + b), lo: quantile(draws, 0.05), hi: quantile(draws, 0.95), n: 0, vistas };
}

/** Muestras de la posterior de un brazo (para comparar brazos entre sí). */
function draws(exitos: number, vistas: number, metrica: string, seed: number, k = 4000): number[] {
  const p0 = PRIORS[metrica] ?? 0.02;
  const a = p0 * PRIOR_VIEWS + exitos;
  const b = (1 - p0) * PRIOR_VIEWS + Math.max(0, vistas - exitos);
  const rand = rng(seed);
  const out: number[] = [];
  for (let i = 0; i < k; i++) out.push(sampleBeta(a, b, rand));
  return out;
}

// ── Palancas ────────────────────────────────────────────────────────────────
export type Brazo = {
  valor: string;
  piezas: number;
  vistas: number;
  exitos: number;
  post: Posterior;
  /** P(este brazo es el mejor de su palanca). */
  pMejor: number;
};
export type Palanca = {
  id: string;
  nombre: string;
  pregunta: string;
  brazos: Brazo[];
  /** Cuánta evidencia hay: "nada" | "indicio" | "señal" | "confirmado". */
  evidencia: "nada" | "indicio" | "señal" | "confirmado";
  /** Vistas que faltarían en el brazo más flojo para poder decidir. */
  faltan?: string;
  conclusion: string;
};

const NETS: Platform[] = ["tiktok", "instagram"];

/**
 * Una observación: un post publicado con métricas, en una red.
 *
 * `it` es opcional a propósito. La mayor parte de lo que está publicado no
 * empareja con una pieza del calendario —2 de 30 en TikTok— y antes eso lo
 * dejaba afuera del modelo. Un post suelto igual responde casi todas las
 * palancas: red, formato, día, hora, duración, audio, hashtags, slides y
 * colaboración salen del post mismo. La que necesita la pieza (señal del
 * hook) devuelve null y esa observación no cuenta para ESA palanca, que es
 * exactamente lo que corresponde.
 */
type Obs = {
  it?: Item;
  fecha: string;
  kind: "clip" | "carousel" | "highlight";
  red: Platform;
  vistas: number;
  /**
   * `undefined` = la red no lo reporta. NO es cero.
   *
   * Instagram no expone guardados ni compartidos a nadie que no sea el dueño
   * en la app. Contarlos como 0 mete una observación de "0 guardados en 12.480
   * vistas" que no es una medición sino una ausencia, y hace que cualquier
   * comparación contra TikTok la gane TikTok por construcción.
   */
  saves?: number;
  shares?: number;
  comments?: number;
  m: NonNullable<Item["metrics"]>[Platform];
};

function observaciones(state: State): Obs[] {
  const out: Obs[] = [];
  const items = new Map(state.items.map((i) => [i.id, i]));
  // Cubierto: (pieza, red) que ya aporta un post guardado. Evita contar dos
  // veces lo mismo cuando la pieza también tiene las métricas copiadas.
  const cubierto = new Set<string>();

  for (const p of state.posts ?? []) {
    const m = p.metrics;
    if (!m?.views) continue;
    const it = p.itemId ? items.get(p.itemId) : undefined;
    if (it) cubierto.add(`${it.id}:${p.network}`);
    out.push({
      it,
      fecha: p.publishedAt.slice(0, 10),
      kind: it?.kind ?? p.kind,
      red: p.network,
      vistas: m.views,
      saves: m.saves,
      shares: m.shares === undefined && m.reposts === undefined ? undefined : (m.shares ?? 0) + (m.reposts ?? 0),
      comments: m.comments,
      m,
    });
  }

  // Piezas con métricas cargadas a mano y sin post scrapeado detrás — el caso
  // típico es Instagram, que no expone guardados.
  for (const it of state.items) {
    for (const red of NETS) {
      const m = it.metrics?.[red];
      if (!m?.views || cubierto.has(`${it.id}:${red}`)) continue;
      out.push({ it, fecha: it.date, kind: it.kind, red, vistas: m.views, saves: m.saves, shares: m.shares === undefined && m.reposts === undefined ? undefined : (m.shares ?? 0) + (m.reposts ?? 0), comments: m.comments, m });
    }
  }
  return out;
}

/** Señal costosa (Spence): lo que no se puede fingir barato. 0-3. */
export function senalCostosa(it: Item): number {
  const t = [it.clip?.pieces?.hook_edicion ?? "", it.clip?.pieces?.claim ?? ""].join(" ");
  let s = 0;
  if (/\d/.test(t)) s++; // un número exacto
  if (/[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+ [A-ZÁÉÍÓÚÑ][a-záéíóúñ]+/.test(t)) s++; // un nombre propio
  if (/(nunca|error|dej[eé]|me equivoqu|fracas|perd[íi]|aburrid)/i.test(t)) s++; // confesión o contraintuición
  return s;
}

/** La duración REAL del video publicado si la red la reporta; si no, la del corte. */
function bucketDuracion(o: Obs): string | null {
  const d = o.m?.duracionSeg ?? (o.it?.clip ? o.it.clip.fin - o.it.clip.inicio : null);
  if (!d) return null;
  return d < 45 ? "menos de 45 s" : d < 60 ? "45-60 s" : d <= 120 ? "60-120 s" : "más de 120 s";
}

function bucketHora(o: Obs): string | null {
  const h = o.m?.hora;
  if (h === undefined) return null;
  return h < 12 ? "mañana (antes de 12)" : h < 18 ? "tarde (12-18)" : h < 21 ? "18-21" : "21 en adelante";
}

const DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
function diaSemana(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return DIAS[dow === 0 ? 6 : dow - 1];
}

type Dim = { id: string; nombre: string; pregunta: string; valor: (o: Obs) => string | null };

const DIMENSIONES: Dim[] = [
  { id: "formato", nombre: "Formato", pregunta: "¿Qué formato se guarda más?", valor: (o) => (o.kind === "clip" ? "clip" : o.kind === "carousel" ? "carrusel" : "highlight") },
  { id: "red", nombre: "Red", pregunta: "¿Dónde rinde mejor lo mismo?", valor: (o) => o.red },
  { id: "duracion", nombre: "Duración real", pregunta: "¿60-120 s rinde más que los cortos?", valor: (o) => bucketDuracion(o) },
  { id: "hora", nombre: "Hora de publicación", pregunta: "¿Las 21 hs son realmente el mejor momento?", valor: (o) => bucketHora(o) },
  { id: "audio", nombre: "Audio", pregunta: "¿El audio original rinde más que el de la plataforma?", valor: (o) => (o.m?.audioOriginal === undefined ? null : o.m.audioOriginal ? "original / propio" : "sonido de la plataforma") },
  { id: "colab", nombre: "Colaboración", pregunta: "¿Publicar en colaboración con otra cuenta presta alcance?", valor: (o) => (o.m?.colaboracion === undefined ? null : o.m.colaboracion ? "en colaboración" : "solos") },
  { id: "hashtags", nombre: "Cantidad de hashtags", pregunta: "¿5 hashtags es el número correcto?", valor: (o) => (o.m?.hashtags ? (o.m.hashtags.length <= 3 ? "3 o menos" : o.m.hashtags.length <= 5 ? "4-5" : "6 o más") : null) },
  { id: "slides", nombre: "Slides del carrusel", pregunta: "¿Cuántas slides se guardan más?", valor: (o) => (o.m?.slides && o.m.slides > 1 ? (o.m.slides <= 5 ? "hasta 5" : o.m.slides <= 7 ? "6-7" : "8 o más") : null) },
  { id: "dia", nombre: "Día de publicación", pregunta: "¿Hay días que rinden mejor?", valor: (o) => diaSemana(o.fecha) },
  { id: "senal", nombre: "Señal del hook", pregunta: "¿El hook con dato duro se guarda más que el genérico?", valor: (o) => (o.it ? ["sin señal costosa", "1 señal", "2 señales", "3 señales"][senalCostosa(o.it)] : null) },
];

/** Cuántas vistas más harían falta para separar los dos mejores brazos. */
function vistasFaltantes(brazos: Brazo[], metrica: string): string | undefined {
  const orden = [...brazos].sort((a, b) => b.post.media - a.post.media);
  const [a, b] = orden;
  if (!a || !b) return undefined;
  const dif = Math.abs(a.post.media - b.post.media);
  if (dif < 1e-6) return "la diferencia entre las dos mejores opciones es nula: no hay nada que decidir todavía";
  // n ≈ 2·p(1-p)·(1,64/dif)² por brazo (dos colas al 90 %).
  const p = (a.post.media + b.post.media) / 2;
  const necesarias = Math.ceil((2 * p * (1 - p) * Math.pow(1.645 / dif, 2)) / 100) * 100;
  const faltan = Math.max(0, necesarias - Math.min(a.vistas, b.vistas));
  if (faltan <= 0) return undefined;
  // Redondeado a la centena: dar "3.317" finge una precisión que la estimación
  // no tiene, y "puntos de diferencia" no le dice nada a quien publica.
  const redondo = Math.round(faltan / 100) * 100;
  return `hacen falta ~${redondo.toLocaleString("es-AR")} vistas más en «${b.valor}» para separarlo de «${a.valor}»`;
}

/** Qué le falta exactamente a una palanca con señal para pasar a confirmada. */
function paraConfirmar(lider: Brazo, segundo?: Brazo): string {
  const falta: string[] = [];
  const l = Math.max(0, 5 - lider.piezas);
  const g = Math.max(0, 3 - (segundo?.piezas ?? 0));
  if (l) falta.push(`${l} pieza(s) más en "${lider.valor}"`);
  if (g) falta.push(`${g} en "${segundo?.valor ?? "la otra opción"}"`);
  if (lider.pMejor <= 0.9) falta.push("que la ventaja se sostenga");
  return falta.length ? `${falta.join(" y ")}` : "que la ventaja se sostenga con más piezas";
}

export function analizarPalancas(state: State, metrica: "saveRate" | "shareRate" | "commentRate" = "saveRate"): Palanca[] {
  const exitoDe = (o: Obs) => (metrica === "saveRate" ? o.saves : metrica === "shareRate" ? o.shares : o.comments);
  // Sólo entra al modelo lo que la red MIDIÓ para esta métrica. Una pieza sin
  // guardados reportados no aporta un 0: no aporta nada.
  const obs = observaciones(state).filter((o) => exitoDe(o) !== undefined);
  const out: Palanca[] = [];

  DIMENSIONES.forEach((dim, di) => {
    const grupos = new Map<string, Obs[]>();
    for (const o of obs) {
      const v = dim.valor(o);
      if (!v) continue;
      grupos.set(v, [...(grupos.get(v) ?? []), o]);
    }
    if (grupos.size === 0) return;
    const brazos: Brazo[] = [...grupos.entries()].map(([valor, os], i) => {
      const vistas = os.reduce((t, o) => t + o.vistas, 0);
      const exitos = os.reduce((t, o) => t + (exitoDe(o) ?? 0), 0);
      return { valor, piezas: os.length, vistas, exitos, post: posterior(exitos, vistas, metrica, 11 + di * 7 + i), pMejor: 0 };
    });
    // P(cada brazo es el mejor), por Monte Carlo conjunto.
    const muestras = brazos.map((b, i) => draws(b.exitos, b.vistas, metrica, 101 + di * 31 + i));
    const K = muestras[0]?.length ?? 0;
    const ganadas = new Array(brazos.length).fill(0);
    for (let k = 0; k < K; k++) {
      let mejor = 0;
      for (let j = 1; j < brazos.length; j++) if (muestras[j][k] > muestras[mejor][k]) mejor = j;
      ganadas[mejor]++;
    }
    brazos.forEach((b, i) => (b.pMejor = K ? ganadas[i] / K : 0));
    brazos.sort((a, b) => b.pMejor - a.pMejor);

    const totalPiezas = brazos.reduce((t, b) => t + b.piezas, 0);
    const lider = brazos[0];
    const segundo = brazos[1];
    // Guarda contra la trampa clásica: con UNA pieza por opción, la "mejor
    // opción" es simplemente la mejor pieza. Por muchas vistas que tenga, no se
    // puede separar el efecto de la palanca del efecto de esa pieza puntual.
    // Por eso la evidencia se mide en PIEZAS, no en vistas ni en probabilidad.
    const evidencia: Palanca["evidencia"] =
      brazos.length < 2 || totalPiezas < 2
        ? "nada"
        : lider.pMejor > 0.9 && lider.piezas >= 5 && (segundo?.piezas ?? 0) >= 3
          ? "confirmado"
          : lider.pMejor > 0.8 && lider.piezas >= 3 && (segundo?.piezas ?? 0) >= 2
            ? "señal"
            : "indicio";
    const conclusion =
      evidencia === "nada"
        ? `Sin comparación posible todavía: ${brazos.length < 2 ? "hay una sola opción con datos" : "faltan piezas"}.`
        : evidencia === "confirmado"
          ? `"${lider.valor}" es la mejor opción con ${(lider.pMejor * 100).toFixed(0)} % de probabilidad. Usalo por defecto.`
          : evidencia === "señal"
            ? `"${lider.valor}" rinde más (${(lider.pMejor * 100).toFixed(0)} % de probabilidad de ser el mejor) con ${lider.piezas} pieza(s) contra ${segundo?.piezas ?? 0}. Para confirmarlo ${paraConfirmar(lider, segundo)}.`
            : lider.pMejor > 0.8
              ? `"${lider.valor}" va adelante (${(lider.pMejor * 100).toFixed(0)} %), pero con ${lider.piezas} pieza(s) eso puede ser el efecto de ESA pieza y no de la palanca. Hacen falta ${Math.max(0, 3 - lider.piezas)} más en "${lider.valor}" y ${Math.max(0, 2 - (segundo?.piezas ?? 0))} en "${segundo?.valor ?? "la otra opción"}" para que cuente como señal.`
              : `Nada distinguible: el líder tiene ${(lider.pMejor * 100).toFixed(0)} % y el azar solo daría ${(100 / brazos.length).toFixed(0)} %.`;

    out.push({ id: dim.id, nombre: dim.nombre, pregunta: dim.pregunta, brazos, evidencia, faltan: vistasFaltantes(brazos, metrica), conclusion });
  });

  return out;
}

// ── La decisión ─────────────────────────────────────────────────────────────
export type Decision = { palanca: string; elegido: string; motivo: string; explorando: boolean };

/**
 * Thompson sampling: se saca UNA muestra de la posterior de cada brazo y gana la
 * más alta. Con poca evidencia las posteriores se pisan y el resultado varía →
 * el sistema explora solo. A medida que un brazo se despega, gana casi siempre
 * → explota. No hace falta fijar a mano cuánto explorar: sale de la matemática.
 */
export function decidir(palancas: Palanca[], seed = 3): Decision[] {
  return palancas
    .filter((p) => p.brazos.length >= 2)
    .map((p, i) => {
      const rand = rng(seed + i * 17);
      let mejor = p.brazos[0];
      let mejorMuestra = -1;
      for (const b of p.brazos) {
        const a0 = (PRIORS.saveRate ?? 0.02) * PRIOR_VIEWS + b.exitos;
        const b0 = (1 - (PRIORS.saveRate ?? 0.02)) * PRIOR_VIEWS + Math.max(0, b.vistas - b.exitos);
        const m = sampleBeta(a0, b0, rand);
        if (m > mejorMuestra) {
          mejorMuestra = m;
          mejor = b;
        }
      }
      const explorando = mejor.valor !== p.brazos[0].valor || p.evidencia === "indicio" || p.evidencia === "nada";
      return {
        palanca: p.nombre,
        elegido: mejor.valor,
        motivo: explorando
          ? `Todavía no hay ganador claro: el sistema prueba "${mejor.valor}" para juntar evidencia.`
          : `"${mejor.valor}" es el que más rinde (${(mejor.pMejor * 100).toFixed(0)} % de probabilidad de ser el mejor).`,
        explorando,
      };
    });
}

// ── Estado del conocimiento ─────────────────────────────────────────────────
export type Conocimiento = {
  observaciones: number;
  piezasPublicadas: number;
  vistasTotales: number;
  conRetencion: number;
  /** Lo que hoy se puede afirmar. */
  sabemos: string[];
  /** Lo que falta para poder afirmar el resto. */
  faltan: string[];
  /** La respuesta a "¿qué funciona?", en una frase. */
  veredicto: string;
  /** Por qué esa es la respuesta, en una frase. */
  porQue: string;
  /** Qué hacer ahora, en acciones — no en unidades del modelo. */
  tareas: { texto: string; detalle: string }[];
  /** Avance hacia la primera conclusión posible. */
  meta: { hechas: number; total: number };
};

/** Piezas con métricas que hacen falta antes de que cualquier comparación se sostenga. */
const MINIMO_OBS = 10;

export function conocimiento(state: State, palancas: Palanca[]): Conocimiento {
  // Las que sirven para la métrica que el modelo optimiza (guardados).
  const obs = observaciones(state).filter((o) => o.saves !== undefined);
  const vistas = obs.reduce((t, o) => t + o.vistas, 0);
  // La retención sale de la pieza: es lo único que se carga a mano.
  const conRet = obs.filter((o) => o.m?.hookPct || o.m?.completionPct).length;
  const sabemos = palancas.filter((p) => p.evidencia === "confirmado" || p.evidencia === "señal").map((p) => `${p.nombre}: ${p.conclusion}`);
  const faltan: string[] = [];
  if (obs.length < MINIMO_OBS) faltan.push(`Sólo hay ${obs.length} observación(es) con métricas. Con menos de ${MINIMO_OBS} ninguna comparación se sostiene: cargá las que ya publicaste o esperá a que el sync las tome.`);
  if (conRet === 0) faltan.push("Ninguna pieza tiene hook % ni completion %. Sin eso no se puede leer la forma de la curva, que es lo que dice QUÉ romper (packaging, setup, escalada).");
  for (const p of palancas) if (p.faltan && p.evidencia !== "confirmado") faltan.push(`${p.nombre}: ${p.faltan}.`);

  // El veredicto es la respuesta a la pregunta con la que se entra a la vista.
  // Si no hay respuesta, lo dice y explica por qué — no deja un hueco.
  const veredicto = sabemos.length
    ? sabemos.length === 1
      ? "Hay una palanca con señal."
      : `Hay ${sabemos.length} palancas con señal.`
    : "Todavía no se puede decir qué funciona.";
  const porQue = sabemos.length
    ? "El resto sigue sin distinguirse del azar: mirá el detalle antes de cambiar nada más."
    : obs.length === 0
      ? "No hay ninguna pieza con métricas cargadas todavía."
      : `Con ${obs.length} pieza${obs.length === 1 ? "" : "s"} medida${obs.length === 1 ? "" : "s"}, cualquier conclusión sería ruido presentado como certeza.`;

  // Las tareas son lo que hace avanzar el modelo, en el idioma de quien publica.
  // Las palancas sin repetición se agrupan en UNA línea: cinco variantes de
  // "faltan ~3.300 vistas" es la contabilidad interna filtrándose a la vista.
  const tareas: Conocimiento["tareas"] = [];
  if (obs.length < MINIMO_OBS)
    tareas.push({
      texto: `Medí ${MINIMO_OBS - obs.length} pieza${MINIMO_OBS - obs.length === 1 ? "" : "s"} más`,
      detalle: "El sync trae TikTok solo. En Instagram los guardados no son públicos: esos se cargan a mano en el detalle de la pieza.",
    });
  if (conRet === 0)
    tareas.push({
      texto: "Cargá hook % y completion % de 3 clips",
      detalle: "Son los dos números del panel de TikTok. Sin ellos no se ve la forma de la curva, que es lo que dice qué romper: el packaging, el desarrollo o el final.",
    });
  const sinRepetir = palancas.filter((p) => p.evidencia === "indicio" || p.evidencia === "nada");
  if (sinRepetir.length)
    tareas.push({
      texto: "Repetí cada opción al menos 3 veces antes de comparar",
      detalle: `${sinRepetir.slice(0, 4).map((p) => p.nombre.toLowerCase()).join(", ")}${sinRepetir.length > 4 ? " y otras" : ""} tienen una sola pieza por opción: la que va ganando es simplemente la única que probaste.`,
    });

  return {
    observaciones: obs.length,
    piezasPublicadas: state.items.filter((i) => i.status === "published").length,
    vistasTotales: vistas,
    conRetencion: conRet,
    sabemos,
    faltan,
    veredicto,
    porQue,
    tareas,
    meta: { hechas: Math.min(obs.length, MINIMO_OBS), total: MINIMO_OBS },
  };
}

/**
 * El puente entre el modelo y la creación: convierte lo que el modelo ya sabe
 * en instrucciones para los agentes que escriben. Sin esto el análisis es un
 * informe lindo que no cambia nada de lo que se produce.
 *
 * Sólo se emiten reglas con evidencia "señal" o "confirmado". Las palancas que
 * todavía están en "indicio" NO generan orden: el bandido las sigue explorando.
 */
export function reglasDelModelo(state: State): string {
  const palancas = analizarPalancas(state, "saveRate");
  const firmes = palancas.filter((p) => p.evidencia === "confirmado" || p.evidencia === "señal");
  const explorar = decidir(palancas).filter((d) => d.explorando);
  if (!firmes.length && !explorar.length) return "";
  const lineas = [
    "",
    "",
    "# LO QUE DICEN LOS NÚMEROS DE ESTA CUENTA (modelo interno, actualizado solo)",
    "Esto NO es teoría: sale de las piezas publicadas de esta cuenta y de su propia tasa base. Si contradice una preferencia de estilo, ganan los números.",
  ];
  for (const p of firmes) {
    const l = p.brazos[0];
    lineas.push(`- ${p.nombre}: usá "${l.valor}" — save rate ${(l.post.media * 100).toFixed(2)} % sobre ${l.piezas} piezas, ${(l.pMejor * 100).toFixed(0)} % de probabilidad de ser la mejor opción.`);
  }
  if (explorar.length) {
    lineas.push("", "# LO QUE TODAVÍA NO SE SABE — probá esto para que el sistema aprenda");
    for (const d of explorar.slice(0, 4)) lineas.push(`- ${d.palanca}: probá "${d.elegido}". Ninguna opción se despegó todavía y hace falta evidencia.`);
  }
  return lineas.join("\n");
}

export function modelo(state: State) {
  const palancas = analizarPalancas(state, "saveRate");
  return { palancas, decisiones: decidir(palancas), conocimiento: conocimiento(state, palancas) };
}
