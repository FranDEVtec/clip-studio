// El calendario semanal: qué se publica cada día.
//
// Default: la semana de un video arranca el domingo en que sale y lleva un
// clip por día de lunes a sábado. Se pisa con WEEKLY_PLAN="1,2,3,4,5,6" (días
// ISO, 1=lunes … 7=domingo) y PUBLISH_TIME="21:00".

import { PUBLISH_TIME as CONFIG_PUBLISH_TIME, TIMEZONE } from "@/lib/config";
import type { Item, Platform, State } from "@/lib/store";

export type PieceKind = "clip";
export type Slot = { dow: number; kind: PieceKind };

export const DEFAULT_PLAN: Slot[] = [1, 2, 3, 4, 5, 6].map((dow) => ({ dow, kind: "clip" as const }));

export const PUBLISH_TIME = CONFIG_PUBLISH_TIME;
export const TZ = TIMEZONE;

/** Redes a las que va cada tipo de pieza. */
export function redesDe(_kind: PieceKind): Platform[] {
  return ["tiktok", "instagram", "youtube"];
}

/** Null si la pieza puede marcarse publicada en esa red; si no, el motivo. */
export function redNoAdmitida(kind: PieceKind, network: Platform): string | null {
  if (redesDe(kind).includes(network)) return null;
  return `Una pieza de tipo ${kind} no se publica en ${network}.`;
}

/** Acepta "1,2,3" o el formato viejo "1:clip,2:clip". */
export function parseWeeklyPlan(raw: string | undefined): Slot[] {
  if (!raw) return DEFAULT_PLAN;
  const slots: Slot[] = [];
  for (const part of raw.split(",")) {
    const [d, k] = part.trim().split(":");
    const dow = Number(d);
    if (dow >= 1 && dow <= 7 && (!k || k === "clip")) slots.push({ dow, kind: "clip" });
  }
  return slots.length ? slots : DEFAULT_PLAN;
}

export function weeklyPlan(): Slot[] {
  return parseWeeklyPlan(process.env.WEEKLY_PLAN);
}

/** Fecha local YYYY-MM-DD para un instante dado. */
export function localDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Día ISO (1=lunes … 7=domingo) de una fecha YYYY-MM-DD. */
export function isoDow(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=domingo
  return dow === 0 ? 7 : dow;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Lunes de la semana de una fecha. */
export function weekStart(date: string): string {
  return addDays(date, 1 - isoDow(date));
}

/**
 * Devuelve las próximas `count` fechas libres a partir de `from` (INCLUSIVE),
 * respetando el plan semanal y saltando las fechas ya ocupadas por otro ítem
 * (un día lleva UNA pieza).
 */
export function nextFreeSlots(
  state: State,
  kind: PieceKind,
  from: string,
  count: number,
  opts: { ignoreItemIds?: Set<string> } = {},
): string[] {
  const plan = weeklyPlan().filter((s) => s.kind === kind);
  if (!plan.length || count <= 0) return [];
  const taken = new Set(state.items.filter((i) => !opts.ignoreItemIds?.has(i.id)).map((i) => i.date));
  const out: string[] = [];
  let date = addDays(from, -1);
  // Tope de 26 semanas para no iterar infinito si el plan está vacío para ese tipo.
  for (let i = 0; i < 26 * 7 && out.length < count; i++) {
    date = addDays(date, 1);
    if (!plan.some((s) => s.dow === isoDow(date))) continue;
    if (taken.has(date)) continue;
    taken.add(date);
    out.push(date);
  }
  return out;
}

/**
 * La SEMANA DE UN VIDEO: arranca el domingo en que sale y termina el sábado.
 * Cada video es dueño de su semana; si no, los videos se apilan en fila y
 * el nuevo cae dos semanas después.
 */
export function videoWeekStart(publishedAt: string, today: string): string {
  const pub = localDate(new Date(publishedAt));
  const domingo = addDays(pub, isoDow(pub) === 7 ? 0 : -isoDow(pub));
  const domingoActual = addDays(today, isoDow(today) === 7 ? 0 : -isoDow(today));
  return domingo >= domingoActual ? domingo : domingoActual;
}

/** Los días de la semana del video que todavía no pasaron. */
export function weekSlots(state: State, weekSunday: string, kind: PieceKind, today: string, opts: { ignoreItemIds?: Set<string> } = {}): string[] {
  const plan = weeklyPlan().filter((s) => s.kind === kind);
  const taken = new Set(state.items.filter((i) => !opts.ignoreItemIds?.has(i.id)).map((i) => i.date));
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekSunday, i);
    if (date < today) continue;
    if (!plan.some((sl) => sl.dow === isoDow(date))) continue;
    if (taken.has(date)) continue;
    out.push(date);
  }
  return out;
}

/**
 * La semana es del video. Lo que ocupa esos días (piezas de otro video,
 * recicladas o no) le cede el lugar: no se borra nada, se corre una semana al
 * mismo día de la semana siguiente que esté libre. Se mueve todo lo que no esté
 * publicado, incluso lo trabado en "drafting". Devuelve las piezas movidas.
 */
export function cederLaSemana(state: State, videoId: string, weekSunday: string): Item[] {
  const desplazadas = state.items.filter(
    (i) => i.videoId !== videoId && i.status !== "published" && i.date >= weekSunday && i.date <= addDays(weekSunday, 6),
  );
  if (!desplazadas.length) return [];
  const ocupadas = new Set(state.items.map((i) => i.date));
  for (const it of desplazadas) {
    let destino = addDays(it.date, 7);
    while (ocupadas.has(destino)) destino = addDays(destino, 7);
    ocupadas.delete(it.date);
    ocupadas.add(destino);
    it.date = destino;
  }
  return desplazadas;
}

/**
 * Qué le faltó a la semana y por qué. `weekSlots` devuelve menos fechas de las
 * pedidas sin avisar; salir con menos piezas sin que nadie se entere es el peor
 * resultado, así que al menos se nombra el motivo. `null` = la semana alcanzó.
 */
export function faltantesDeLaSemana(
  state: State,
  videoId: string,
  weekSunday: string,
  today: string,
  pedido: number,
  conseguido: number,
): { faltan: string; porQue: string } | null {
  if (conseguido >= pedido) return null;
  const tomados = state.items
    .filter((i) => i.videoId !== videoId && i.date >= weekSunday && i.date <= addDays(weekSunday, 6))
    .map((i) => `${i.date} → ${i.kind} de otro video (${i.status})`);
  const pasados = Array.from({ length: 7 }, (_, i) => addDays(weekSunday, i)).filter((d) => d < today);
  const porQue = [
    tomados.length ? `días tomados: ${tomados.join("; ")}` : "",
    pasados.length ? `días ya pasados: ${pasados.join(", ")}` : "",
  ].filter(Boolean);
  return { faltan: `${pedido - conseguido} clip(s)`, porQue: porQue.join(" | ") || "sin motivo identificable" };
}

/** Lunes siguiente a una fecha (si es domingo, el lunes que viene). */
export function nextMonday(date: string): string {
  const dow = isoDow(date);
  return addDays(date, dow === 7 ? 1 : 8 - dow);
}

export function itemsForWeek(state: State, monday: string): Record<string, Item[]> {
  const days: Record<string, Item[]> = {};
  for (let i = 0; i < 7; i++) days[addDays(monday, i)] = [];
  for (const it of state.items) if (it.date in days) days[it.date].push(it);
  for (const k of Object.keys(days)) days[k].sort((a, b) => a.time.localeCompare(b.time));
  return days;
}
