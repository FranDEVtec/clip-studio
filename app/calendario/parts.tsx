"use client";

import { useEffect, useState } from "react";
import type { Episode, Item, Metrics, Platform, State } from "@/lib/store";

export const CODE_KEY = "studio-access-code";
export const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
export const TZ = process.env.NEXT_PUBLIC_TIMEZONE || "America/Argentina/Buenos_Aires";
export const LOCALE = process.env.NEXT_PUBLIC_LOCALE || "es-AR";
export const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME || "Clip Studio";

export function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function isoDow(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}
export function weekStart(date: string): string {
  return addDays(date, 1 - isoDow(date));
}
export function fmtDay(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(d)}/${Number(m)}`;
}
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(LOCALE, { timeZone: TZ });
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(LOCALE, { timeZone: TZ });
export const NETWORKS: { id: Platform; label: string }[] = [
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram" },
  { id: "youtube", label: "YouTube" },
];
export const METRIC_FIELDS: { key: keyof Metrics; label: string; hint?: string }[] = [
  { key: "views", label: "views" },
  { key: "likes", label: "likes" },
  { key: "comments", label: "comments" },
  { key: "saves", label: "saves" },
  { key: "shares", label: "shares / sends" },
  { key: "follows", label: "follows" },
  { key: "profileVisits", label: "profile visits" },
  { key: "hookPct", label: "hook %", hint: "retención a 3 s" },
  { key: "completionPct", label: "completion %" },
  { key: "avgWatchSec", label: "avg watch (s)" },
  { key: "followersReachPct", label: "% seguidores", hint: "del alcance" },
];
export function median(xs: number[]): number | undefined {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return undefined;
  const mid = (v.length - 1) / 2;
  return (v[Math.floor(mid)] + v[Math.ceil(mid)]) / 2;
}
export const fmtNum = (x?: number) => (x === undefined ? "—" : Math.round(x).toLocaleString(LOCALE));
export const fmtPct = (x?: number) =>
  x === undefined ? "—" : `${(x * 100).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;

export type Act = (b: Record<string, unknown>, label: string) => Promise<void>;

// ─────────────────────────────────────────────────────────────────────────────

export function ItemDetail({
  item: it,
  episode: ep,
  busy,
  copied,
  onCopy,
  onAct,
  onClose,
}: {
  item: Item;
  episode?: Episode;
  busy: string | null;
  copied: string | null;
  onCopy: (t: string, which: string) => void;
  onAct: Act;
  onClose: () => void;
}) {
  const [date, setDate] = useState(it.date);
  const [time, setTime] = useState(it.time);
  useEffect(() => {
    setDate(it.date);
    setTime(it.time);
  }, [it]);

  const Copy = ({ text, id, label }: { text: string; id: string; label?: string }) => (
    <button className={`copy-btn ${copied === id ? "copied" : ""}`} onClick={() => onCopy(text, id)}>
      {copied === id ? "copiado ✓" : label ?? "copiar"}
    </button>
  );

  const pack = it.clip
    ? [
        `${ep?.title ?? ""}`,
        `CORTE: ${fmtTime(it.clip.inicio)} → ${fmtTime(it.clip.fin)} (${Math.round(it.clip.fin - it.clip.inicio)} s)${ep ? ` · ${ep.url}&t=${Math.floor(it.clip.inicio)}s` : ""}`,
        `PUBLICAR: ${it.date} ${it.time} hs`,
        "",
        ...(it.clip.pieces.hook_edicion ? [`TITULAR EN PANTALLA: ${it.clip.pieces.hook_edicion}`, ""] : []),
        ...(it.clip.pieces.credencial ? [`INVITADO: ${ep?.guest ?? ""} · ${it.clip.pieces.credencial}`, ""] : []),
        "CAPTION TIKTOK:",
        it.clip.captionTikTok ?? it.clip.caption,
        "",
        "CAPTION INSTAGRAM:",
        it.clip.caption,
      ].join("\n")
    : "";

  return (
    <section className="detail">
      <div className="detail-head">
        <div>
          <div className="kicker">
            Clip · {DAY_NAMES[isoDow(it.date) - 1]} {fmtDay(it.date)} · {it.time} hs
            {it.status === "published" && " · PUBLICADO"}
            {it.recycleOf && " · REPOST"}
          </div>
          <h2 className="detail-title">{ep?.title}</h2>
          <div className="detail-sub">
            {ep?.guest ? `Invitado: ${ep.guest}` : "Invitado sin confirmar"}
            {ep?.episodeNumber ? ` · Episodio ${ep.episodeNumber}` : ""}
            {ep && (
              <>
                {" · "}
                <a href={ep.url} target="_blank" rel="noreferrer">YouTube ↗</a>
              </>
            )}
          </div>
        </div>
        <button className="link-btn" onClick={onClose}>cerrar ✕</button>
      </div>

      <div className="detail-actions">
        {it.clip && <Copy id="pack" label="copiar paquete completo" text={pack} />}
        <button className="copy-btn" disabled={!!busy} onClick={() => onAct({ action: it.status === "published" ? "unpublish" : "publish", itemId: it.id }, "pub")}>
          {it.status === "published" ? "Marcar como pendiente" : "Marcar como publicado ✓"}
        </button>
        <label className="inline-field">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <button className="copy-btn" disabled={!!busy || (date === it.date && time === it.time)} onClick={() => onAct({ action: "move", itemId: it.id, date, time }, "move")}>
            mover
          </button>
        </label>
        {it.clip && (
          <button className="copy-btn" disabled={!!busy} onClick={() => onAct({ action: "regenerate", itemId: it.id }, "regen")}>
            {busy === "regen" ? "Redactando…" : "Regenerar copy"}
          </button>
        )}
        <button
          className="copy-btn danger"
          disabled={!!busy}
          onClick={() => {
            if (window.confirm("¿Borrar esta pieza del calendario?")) onAct({ action: "delete", itemId: it.id }, "del");
          }}
        >
          borrar
        </button>
      </div>

      {it.status === "drafting" && <div className="avisos">⏳ El redactor está escribiendo esta pieza. Se actualiza sola en unos segundos.</div>}

      {it.status !== "drafting" && <Tracking item={it} busy={busy} onAct={onAct} />}

      {it.clip && (
        <div className="results">
          <div className="card">
            <div className="card-head">
              <span className="platform">Corte del episodio</span>
              <Copy text={`${fmtTime(it.clip.inicio)} - ${fmtTime(it.clip.fin)}`} id="ts" />
            </div>
            <div className="card-body">
              <div className="big-ts">
                {fmtTime(it.clip.inicio)} → {fmtTime(it.clip.fin)} <span className="dim">({Math.round(it.clip.fin - it.clip.inicio)} s)</span>
                {ep && (
                  <>
                    {" · "}
                    <a href={`${ep.url}&t=${Math.floor(it.clip.inicio)}s`} target="_blank" rel="noreferrer">ver en YouTube ↗</a>
                  </>
                )}
              </div>
              <div className="dim small">{it.clip.tituloInterno}</div>
              {it.clip.angulo && <div className="dim small">Ángulo: {it.clip.angulo}</div>}
              {(() => {
                const dur = Math.round(it.clip!.fin - it.clip!.inicio);
                const ok = dur >= 60 && dur <= 120;
                return (
                  <div className={`dur-note ${ok ? "ok" : ""}`}>
                    {ok
                      ? `${dur} s · dentro de la franja objetivo (60-120 s)`
                      : dur < 60
                        ? `${dur} s · corto: si el insight se sostiene, estirá el corte.`
                        : `${dur} s · largo: cortalo en dos piezas o acelerá levemente.`}
                  </div>
                );
              })()}
            </div>
          </div>

          {it.clip.pieces.hook_edicion && (
            <div className="card">
              <div className="card-head">
                <span className="platform">Titular en pantalla</span>
                <Copy text={it.clip.pieces.hook_edicion} id="hook-ed" />
              </div>
              <div className="card-body">
                <div className="hook-ed">{it.clip.pieces.hook_edicion}</div>
                {it.clip.pieces.credencial && (
                  <div className="mini-copy-row" style={{ marginTop: 10 }}>
                    <span className="dim small">Invitado: <b>{ep?.guest ?? ""}</b> · {it.clip.pieces.credencial}</span>
                    <Copy text={`${it.clip.pieces.credencial}\n${ep?.guest ?? ""}`} id="lt" label="copiar nombre y credencial" />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <span className="platform">Caption TikTok</span>
              <Copy text={it.clip.captionTikTok ?? it.clip.caption} id="caption-tt" />
            </div>
            <div className="card-body">
              <pre className="caption-pre">{it.clip.captionTikTok ?? it.clip.caption}</pre>
              <div className="dim small">molde: {it.clip.molde}</div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <span className="platform">Caption Instagram</span>
              <Copy text={it.clip.caption} id="caption-ig" />
            </div>
            <div className="card-body">
              <pre className="caption-pre">{it.clip.caption}</pre>
            </div>
          </div>

          {it.clip.avisos.length > 0 && (
            <div className="avisos">
              {it.clip.avisos.map((a, i) => (
                <div key={i}>⚠ {a}</div>
              ))}
            </div>
          )}

          <details className="transcript">
            <summary>Transcripción del tramo</summary>
            <pre className="transcript-body">{it.clip.transcripcion}</pre>
          </details>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function EpisodeRow({ ep, busy, onAct, state }: { ep: Episode; busy: string | null; onAct: Act; state: State }) {
  const [guest, setGuest] = useState(ep.guest ?? "");
  const [num, setNum] = useState(ep.episodeNumber ?? "");
  const [showClips, setShowClips] = useState(false);
  useEffect(() => {
    setGuest(ep.guest ?? "");
    setNum(ep.episodeNumber ?? "");
  }, [ep]);
  const nItems = state.items.filter((i) => i.episodeId === ep.videoId).length;
  const statusLabel: Record<Episode["status"], string> = {
    pending: "en cola",
    analyzing: "analizando…",
    analyzed: `analizado · ${nItems} piezas`,
    error: "error",
    ignored: "no analizado",
  };
  return (
    <div className={`episode-row ep-${ep.status}`}>
      <div className="episode-main">
        <div className="episode-title">
          <a href={ep.url} target="_blank" rel="noreferrer">{ep.title}</a>
        </div>
        <div className="dim small">
          {fmtDate(ep.publishedAt)} · {statusLabel[ep.status]}
          {ep.error && <span className="err"> — {ep.error}</span>}
        </div>
      </div>
      <div className="episode-actions">
        <input type="text" placeholder="invitado" value={guest} onChange={(e) => setGuest(e.target.value)} />
        <input type="text" placeholder="# ep" value={num} onChange={(e) => setNum(e.target.value)} style={{ width: 64 }} />
        <button
          className="copy-btn"
          disabled={!!busy || (guest === (ep.guest ?? "") && num === (ep.episodeNumber ?? ""))}
          onClick={() => onAct({ action: "meta", videoId: ep.videoId, guest, episodeNumber: num }, `meta:${ep.videoId}`)}
        >
          guardar
        </button>
        {(ep.status === "ignored" || ep.status === "error" || ep.status === "pending") && (
          <button className="copy-btn ghost" disabled={!!busy} onClick={() => onAct({ action: "analyze", videoId: ep.videoId }, `an:${ep.videoId}`)}>
            {busy === `an:${ep.videoId}` ? "Analizando…" : "Analizar y agendar"}
          </button>
        )}
        {ep.status === "analyzed" && (
          <>
            <button className="copy-btn" disabled={!!busy} onClick={() => onAct({ action: "reschedule", videoId: ep.videoId }, `re:${ep.videoId}`)}>
              {busy === `re:${ep.videoId}` ? "Agendando…" : "Agendar más clips"}
            </button>
            <button className="copy-btn ghost" disabled={!!busy} onClick={() => onAct({ action: "replan", videoId: ep.videoId }, "rp")}>
              re-planificar desde hoy
            </button>
            <button className="copy-btn ghost" disabled={!!busy} onClick={() => onAct({ action: "reanalyze", videoId: ep.videoId }, `rean:${ep.videoId}`)} title="Vuelve a pasar el episodio por Gemini sin tocar el calendario">
              {busy === `rean:${ep.videoId}` ? "Analizando…" : "re-analizar"}
            </button>
            <label className="toggle" title="No hay episodio la semana que viene: estirar las piezas a 14 días y sumar clips">
              <input type="checkbox" checked={!!ep.stretch} disabled={!!busy} onChange={(e) => onAct({ action: "stretch", videoId: ep.videoId, stretch: e.target.checked }, "st")} />
              <span>Semana extendida</span>
            </label>
            {ep.analysis && (
              <button className="link-btn" onClick={() => setShowClips(!showClips)}>
                {showClips ? "ocultar tramos" : `ver ${ep.analysis.clips.length} tramos`}
              </button>
            )}
          </>
        )}
        {ep.status !== "ignored" && (
          <button
            className="link-btn"
            disabled={!!busy}
            title="Marca el video como no-episodio y saca sus piezas no publicadas del calendario"
            onClick={() => {
              if (window.confirm("¿Ignorar este video? Sus piezas no publicadas salen del calendario.")) onAct({ action: "ignoreEpisode", videoId: ep.videoId }, `ig:${ep.videoId}`);
            }}
          >
            ignorar
          </button>
        )}
      </div>
      {ep.planNote && <div className="dim small plan-note">Plan de la semana: {ep.planNote}</div>}
      {showClips && ep.analysis && (
        <div className="candidates">
          {ep.analysis.tesis && <div className="dim small" style={{ marginBottom: 8 }}>Tesis: {ep.analysis.tesis}</div>}
          {ep.analysis.clips.map((c, i) => {
            const usado = state.items.some((it) => it.episodeId === ep.videoId && (it.clip ? it.clip.inicio === c.inicio : it.draft?.candidateIndex === i));
            return (
              <div key={i} className={`candidate ${usado ? "used" : ""}`}>
                <span className="cand-score">{c.puntaje}</span>
                <div>
                  <div className="cand-title">
                    <a href={`${ep.url}&t=${Math.floor(c.inicio)}s`} target="_blank" rel="noreferrer">{fmtTime(c.inicio)} → {fmtTime(c.fin)} ↗</a>
                    {" · "}
                    {c.titulo}
                    {usado && <span className="chip-kind faint"> · agendado</span>}
                  </div>
                  <div className="dim small">{c.motivo}</div>
                  {c.curiosidad && <div className="dim small">Entrada: {c.curiosidad}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Seguimiento: métricas por red.

export function Tracking({ item: it, busy, onAct }: { item: Item; busy: string | null; onAct: Act }) {
  const [net, setNet] = useState<Platform>("tiktok");
  const [form, setForm] = useState<Record<string, string>>({});
  const [postUrl, setPostUrl] = useState("");
  const m = it.metrics?.[net];
  useEffect(() => setPostUrl(it.posts?.[net]?.url ?? ""), [it.id, net, it.posts]);
  useEffect(() => {
    const f: Record<string, string> = {};
    for (const { key } of METRIC_FIELDS) f[key] = m?.[key] === undefined ? "" : String(m[key]);
    f.notes = m?.notes ?? "";
    setForm(f);
  }, [it.id, net, m]);

  const views = m?.views ?? 0;
  const rate = (x?: number) => (views && x !== undefined ? fmtPct(x / views) : "—");

  return (
    <div className="tracking">
      <div className="card-head">
        <span className="platform">Seguimiento · métricas</span>
        <div className="net-tabs">
          {NETWORKS.map((n) => (
            <button key={n.id} className={`link-btn ${net === n.id ? "net-on" : ""}`} onClick={() => setNet(n.id)}>
              {n.label}
              {it.metrics?.[n.id]?.views ? " ●" : ""}
            </button>
          ))}
        </div>
      </div>
      <label className="metric-field metric-notes" style={{ marginBottom: 10 }}>
        <span>URL del post publicado en {NETWORKS.find((n) => n.id === net)?.label} (para el sync automático)</span>
        <div className="inline-field" style={{ width: "100%" }}>
          <input type="url" placeholder={it.posts?.[net]?.url ?? "https://…"} value={postUrl} onChange={(e) => setPostUrl(e.target.value)} style={{ flex: 1 }} />
          <button className="copy-btn ghost" disabled={!!busy || postUrl === (it.posts?.[net]?.url ?? "")} onClick={() => onAct({ action: "postUrl", itemId: it.id, network: net, url: postUrl }, "purl")}>
            guardar URL
          </button>
        </div>
        {it.posts?.[net] && (
          <span className="dim small" style={{ textTransform: "none", letterSpacing: 0 }}>
            {it.posts[net]!.matchedBy === "auto" ? "emparejado automáticamente" : "URL cargada a mano"} · <a href={it.posts[net]!.url} target="_blank" rel="noreferrer">abrir ↗</a>
            {m?.source ? ` · métricas: ${m.source}` : ""}
            {" · "}
            <button className="link-btn" disabled={!!busy} title="Si emparejó el post equivocado, borralo y pegá la URL correcta" onClick={() => onAct({ action: "clearPost", itemId: it.id, network: net }, "clrpost")}>
              no es este post
            </button>
          </span>
        )}
      </label>
      {m?.views ? (
        <div className="metrics-summary">
          {(
            [
              ["views", m.views],
              ["likes", m.likes],
              ["comments", m.comments],
              ["saves", m.saves],
              ["shares", m.shares],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="metric-stat">
              <span className="metric-stat-label">{k}</span>
              <span className="metric-stat-val">{v === undefined ? "—" : Number(v).toLocaleString(LOCALE)}</span>
            </div>
          ))}
          <div className="metric-stat">
            <span className="metric-stat-label">save rate</span>
            <span className="metric-stat-val">{rate(m.saves)}</span>
          </div>
          <div className="metric-stat">
            <span className="metric-stat-label">share rate</span>
            <span className="metric-stat-val">{rate(m.shares)}</span>
          </div>
        </div>
      ) : (
        <div className="dim small" style={{ marginBottom: 10 }}>
          Sin métricas todavía. Con Apify configurado, se traen solas después de publicar (5 h, 24 h y 7 días si hay QStash; si no, con el sync diario). Si el post no se emparejó, pegá la URL arriba.
        </div>
      )}
      <div className="retention">
        <div className="platform">Retención · lo único que ningún scraper trae</div>
        <div className="retention-row">
          {(
            [
              { key: "hookPct" as const, label: "Hook %", hint: "retención a 3 s", target: 65 },
              { key: "completionPct" as const, label: "Completion %", hint: "llegó al final", target: 50 },
              { key: "avgWatchSec" as const, label: "Avg watch (s)", hint: "comparalo contra la duración", target: 0 },
            ] as const
          ).map((f) => {
            const val = Number(form[f.key]);
            const ok = f.target > 0 && Number.isFinite(val) && val >= f.target;
            const bad = f.target > 0 && Number.isFinite(val) && val > 0 && val < f.target;
            return (
              <label key={f.key} className={`retention-field ${ok ? "ok" : bad ? "bad" : ""}`} title={f.hint}>
                <span>
                  {f.label}
                  {f.target > 0 && <i> meta ≥ {f.target}</i>}
                </span>
                <input type="number" inputMode="decimal" value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              </label>
            );
          })}
          <button className="copy-btn" disabled={!!busy} onClick={() => onAct({ action: "metrics", itemId: it.id, network: net, metrics: form }, "metrics")}>
            {busy === "metrics" ? "Guardando…" : "Guardar"}
          </button>
        </div>
        <div className="dim tiny">
          La forma de la curva dice qué romper: caída en los primeros 2 s = packaging · a los 5-8 s = demasiado setup · declive suave = falta escalada · sube al final = está loopeando, no toques nada.
        </div>
      </div>

      <details className="manual-metrics">
        <summary className="dim small">Cargar o corregir a mano (YouTube, hook %, completion, notas)</summary>
        <div className="metrics-grid">
          {METRIC_FIELDS.map((f) => (
            <label key={f.key} className="metric-field" title={f.hint}>
              <span>{f.label}</span>
              <input type="number" inputMode="decimal" value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            </label>
          ))}
          <label className="metric-field metric-notes">
            <span>notas (qué viste en analytics, comentarios, contexto)</span>
            <input type="text" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
        </div>
        <button className="copy-btn" disabled={!!busy} onClick={() => onAct({ action: "metrics", itemId: it.id, network: net, metrics: form }, "metrics")}>
          {busy === "metrics" ? "Guardando…" : "Guardar métricas"}
        </button>
      </details>
      <div className="detail-actions">
        {it.status === "published" && (
          <button className="copy-btn ghost" disabled={!!busy} onClick={() => onAct({ action: "syncMetrics" }, "sync")}>
            {busy === "sync" ? "Sincronizando…" : "Sincronizar ahora"}
          </button>
        )}
        {m && (
          <span className="toolbar-status">
            save rate {rate(m.saves)} · share rate {rate(m.shares)} · comment rate {rate(m.comments)} · cargado {fmtDate(m.updatedAt)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function StatsSection({ state, defaultOpen = false }: { state: State; defaultOpen?: boolean }) {
  const [show, setShow] = useState(defaultOpen);
  const rows: { net: string; n: number; views?: number; saveRate?: number; shareRate?: number; commentRate?: number; likes?: number }[] = [];
  for (const n of NETWORKS) {
    const ms = state.items.filter((i) => (i.metrics?.[n.id]?.views ?? 0) > 0).map((i) => i.metrics![n.id]!);
    if (!ms.length) continue;
    const r = (f: (m: Metrics) => number | undefined) => median(ms.map(f).filter((x): x is number => x !== undefined));
    rows.push({
      net: n.label,
      n: ms.length,
      views: r((m) => m.views),
      likes: r((m) => m.likes),
      saveRate: r((m) => (m.saves === undefined ? undefined : m.saves / (m.views || 1))),
      shareRate: r((m) => (m.shares === undefined ? undefined : m.shares / (m.views || 1))),
      commentRate: r((m) => (m.comments === undefined ? undefined : m.comments / (m.views || 1))),
    });
  }
  const top = state.items
    .flatMap((i) =>
      NETWORKS.flatMap((n) => {
        const m = i.metrics?.[n.id];
        if (!m?.views || m.saves === undefined) return [];
        return [{ item: i, net: n.label, views: m.views, saveRate: m.saves / m.views }];
      }),
    )
    .sort((a, b) => b.saveRate - a.saveRate)
    .slice(0, 5);
  const published = state.items.filter((i) => i.status === "published").length;
  const withMetrics = state.items.filter((i) => i.metrics && Object.keys(i.metrics).length).length;

  return (
    <section className="stats">
      <button className="link-btn section-toggle" onClick={() => setShow(!show)}>
        {show ? "▾" : "▸"} Medianas propias · {published} publicadas · {withMetrics} con métricas
      </button>
      {show && (
        <div className="stats-body">
          {rows.length === 0 ? (
            <div className="dim small">Todavía no hay métricas cargadas. Abrí una pieza publicada, cargá lo que muestra la app y guardá: la mediana propia se arma sola.</div>
          ) : (
            <div className="table-scroll">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th scope="col">Red</th>
                    <th scope="col" className="num">Piezas</th>
                    <th scope="col" className="num">Views (mediana)</th>
                    <th scope="col" className="num">Save rate</th>
                    <th scope="col" className="num">Share rate</th>
                    <th scope="col" className="num">Comment rate</th>
                    <th scope="col" className="num">Likes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <th scope="row">{r.net}</th>
                      <td className="num">{r.n}</td>
                      <td className="num">{fmtNum(r.views)}</td>
                      <td className="num">{fmtPct(r.saveRate)}</td>
                      <td className="num">{fmtPct(r.shareRate)}</td>
                      <td className="num">{fmtPct(r.commentRate)}</td>
                      <td className="num">{fmtNum(r.likes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {top.length > 0 && (
            <div className="top-list">
              <div className="platform">Top por save rate (la señal que más pesa)</div>
              {top.map((t, i) => (
                <div key={i} className="small">
                  {fmtPct(t.saveRate)} · {t.net} · {t.item.date} · {t.item.clip?.tituloInterno} ({fmtNum(t.views)} views)
                </div>
              ))}
            </div>
          )}
          <div className="dim small" style={{ marginTop: 10 }}>
            Save rate = saves / views. Prioridad: saves &gt; shares &gt; comments &gt; likes.
          </div>
        </div>
      )}
    </section>
  );
}
