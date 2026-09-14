// El emparejamiento post ↔ pieza, sin Apify:
//   npx tsx lib/metrics-sync.test.ts
import { matchPosts, type SocialPost } from "./metrics-sync.ts";
import type { Item, State } from "./store.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FALLA:", msg);
    process.exitCode = 1;
  } else console.log("ok  ", msg);
}

const clip = (id: string, date: string, claim: string, url?: string): Item => ({
  id,
  videoId: "v1",
  kind: "clip",
  date,
  time: "21:00",
  status: "planned",
  createdAt: "2026-01-01T00:00:00Z",
  posts: url ? { tiktok: { url, matchedBy: "manual", matchedAt: "2026-01-01T00:00:00Z" } } : undefined,
  clip: {
    inicio: 0,
    fin: 80,
    tituloInterno: id,
    caption: claim,
    molde: "revelacion",
    transcripcion: "",
    avisos: [],
    pieces: { molde: "revelacion", claim, cita_textual: "", emoji: "", hashtags: [], hashtags_tiktok: [], hook_edicion: "" },
  },
});
const post = (id: string, publishedAt: string, text: string, kind: "clip" | "carousel" = "clip"): SocialPost => ({
  network: "tiktok",
  id,
  url: `https://www.tiktok.com/@x/video/${id}`,
  publishedAt,
  kind,
  text,
  metrics: { views: 100 },
});
const state = (items: Item[]): State => ({ version: 1, videos: [], items, log: [] });

// 1) la URL pegada a mano manda, aunque la fecha no coincida
const s1 = state([clip("a", "2026-03-02", "Lo que gasté viviendo solo un mes entero", "https://www.tiktok.com/@x/video/111")]);
const m1 = matchPosts(s1, [post("111", "2026-03-20T00:00:00Z", "cualquier cosa")]);
assert(m1.length === 1 && m1[0].how === "manual", "URL manual empareja sin mirar fecha ni texto");

// 2) caption parecido y fecha cercana: empareja solo
const s2 = state([clip("a", "2026-03-02", "Lo que gasté viviendo solo un mes entero, peso por peso"), clip("b", "2026-03-09", "Mi rutina de estudio de 4 horas sin celular")]);
const m2 = matchPosts(s2, [post("222", "2026-03-03T01:00:00Z", "Lo que gasté viviendo solo un mes entero, peso por peso #vida")]);
assert(m2.length === 1 && m2[0].item.id === "a" && m2[0].how === "auto", "caption parecido + fecha cercana empareja con la pieza correcta");

// 3) caption reescrito, pero es la única pieza a un día del post: empareja igual
const m3 = matchPosts(s2, [post("333", "2026-03-09T02:00:00Z", "esto me cambió la cabeza")]);
assert(m3.length === 1 && m3[0].item.id === "b", "una sola pieza vecina alcanza aunque el caption no se parezca");

// 4) dos piezas vecinas y caption distinto: no adivina
const s4 = state([clip("a", "2026-03-02", "Lo que gasté viviendo solo"), clip("b", "2026-03-03", "Mi rutina de estudio")]);
const m4 = matchPosts(s4, [post("444", "2026-03-03T12:00:00Z", "esto me cambió la cabeza")]);
assert(m4.length === 0, "con dos piezas vecinas y caption distinto, queda suelto");

// 5) un carrusel nunca empareja con un clip
const m5 = matchPosts(s2, [post("555", "2026-03-03T01:00:00Z", "Lo que gasté viviendo solo un mes entero", "carousel")]);
assert(m5.length === 0, "un carrusel no es un clip");
